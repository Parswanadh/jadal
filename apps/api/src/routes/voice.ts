/**
 * Voice routes: the simulated phone's two ends.
 *
 *  * `intake` (`POST /api/intake`) is the farmer speaking *to* Jadal — a Telugu transcript (typed, or
 *    transcribed from audio by Sarvam) is scored by System 1, and an urgent/buffer intent optionally
 *    becomes a real `WaterRequest` appended to the log.
 *  * `phoneReply` (`POST /api/phone/:contactId/reply`) is the farmer answering a call. The dialogue
 *    belongs to the caller agent, so this route only validates the body and delegates to `callerTurn`.
 *
 * Both work with **no API keys**: `stt` returns `null` without a key (and without a network call), so
 * a missing or empty audio payload degrades to the typed `text`, and an empty transcript still gets a
 * deterministic rules classification. No test needs the network.
 */

import type { Hono } from "hono";

import { routes } from "@jadal/contracts";
import type { WaterRequest } from "@jadal/contracts";

import { callerTurn } from "../agents/caller";
import { classify, extractVolumeM3 } from "../system1";
import { now } from "../db/clock";
import { newId } from "../db/id";
import { getContact, getFarmer, getRequest } from "../db/repo";
import { appendEvent } from "../db/store";
import { DEMO_CANAL_ID } from "../demo";
import type { Env } from "../env";
import { HttpError, notFound, parseBody, parseResponse, providerEnv } from "../http";
import { stt } from "../voice/sarvam";

const SYSTEM1_ACTOR = { kind: "agent", id: "system1" } as const;

/**
 * The request type an intent maps to, or `undefined` when the message is not asking for water.
 *
 * `schedule_question`, `harvested`, `acknowledge`, `not_needed_this_week` and `other` are
 * conversations, not requests; only an explicit ask creates a `WaterRequest`.
 */
function requestTypeFor(intent: string): WaterRequest["type"] | undefined {
  if (intent === "urgent_request") return "urgent";
  if (intent === "buffer_request") return "buffer";
  return undefined;
}

/** Register the two voice routes on `app`. */
export function registerVoiceRoutes(app: Hono<{ Bindings: Env }>): void {
  app.post(routes.intake.path, async (c) => {
    const body = await parseBody(c, routes.intake.body);
    const farmer = await getFarmer(c.env, body.farmer_id);
    if (farmer === null) {
      throw notFound("farmer_not_found", `no farmer ${body.farmer_id}`);
    }

    // Text wins when present; audio is only transcribed when there is nothing typed. Without a
    // Sarvam key `stt` returns null immediately and the transcript stays empty.
    const typed = (body.text ?? "").trim();
    const transcript =
      typed.length > 0
        ? typed
        : ((await stt(providerEnv(c.env), body.audio_base64 ?? "", body.mime)) ?? "").trim();

    const triage = await classify(providerEnv(c.env), transcript);
    const at = await now(c.env);

    let request: WaterRequest | undefined;
    const type = requestTypeFor(triage.intent);
    if (type !== undefined) {
      const raised: WaterRequest = {
        id: newId("req"),
        farmer_id: body.farmer_id,
        type,
        volume_m3: extractVolumeM3(transcript) ?? 0,
        reason: transcript,
        channel: "voice",
        status: "raised",
        raised_at: at,
        triage_score: triage.urgency,
      };

      await appendEvent(c.env, {
        id: newId("evt"),
        at,
        canal_id: DEMO_CANAL_ID,
        actor: { kind: "farmer", id: body.farmer_id },
        type: "request.raised",
        request: raised,
      });
      await appendEvent(c.env, {
        id: newId("evt"),
        at,
        canal_id: DEMO_CANAL_ID,
        actor: SYSTEM1_ACTOR,
        type: "request.triaged",
        request_id: raised.id,
        triage_score: triage.urgency,
        intent: triage.intent,
      });

      const stored = await getRequest(c.env, raised.id);
      if (stored === null) {
        throw new HttpError("internal_error", `request ${raised.id} vanished after intake`, 500);
      }
      request = stored;
    }

    return c.json(
      parseResponse(routes.intake.response, {
        transcript_te: transcript,
        intent: triage.intent,
        urgency: triage.urgency,
        ...(request === undefined ? {} : { request }),
      }),
    );
  });

  app.post(routes.phoneReply.path, async (c) => {
    const body = await parseBody(c, routes.phoneReply.body);
    const contactId = c.req.param("contactId");
    const contact = await getContact(c.env, contactId);
    if (contact === null) {
      throw notFound("contact_not_found", `no contact ${contactId}`);
    }

    const reply = {
      ...(body.text === undefined ? {} : { text: body.text }),
      ...(body.audio_base64 === undefined ? {} : { audio_base64: body.audio_base64 }),
      ...(body.mime === undefined ? {} : { mime: body.mime }),
    };
    const result = await callerTurn(c.env, contactId, reply);

    return c.json(parseResponse(routes.phoneReply.response, result));
  });
}
