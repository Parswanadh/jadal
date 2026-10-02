/**
 * Inbound calls: the agent **answers** a call the farmer placed, speaks Telugu, and understands the reply.
 *
 * This is the flow the user asked for — "raise an urgent request from the farmer side where the agent
 * should answer the phone and speak". It is mounted by {@link createTelephonyRoutes} on the same
 * `/api/telephony` sub-app as the outbound flow, so `app.ts` needs no change to make it live.
 *
 * The call, verbatim:
 *
 *   1. `POST /inbound`  — Twilio's voice webhook. Answer with Sarvam Telugu audio: a greeting, then a
 *      one-digit DTMF `<Gather>` whose prompt offers "1 = confirm, 2 = urgent request, or speak".
 *      A caller who speaks instead of pressing a key falls through to step 3.
 *   2. `POST /inbound/respond` — the keypress. `1` records the acknowledgement (when the caller maps to
 *      an open contact) and thanks them; `2` goes straight to `<Record>`; anything else listens.
 *   3. `POST /inbound/listen` — a spoken cue, then `<Record>`.
 *   4. `POST /inbound/recording` — download the recording, transcribe it (Deepgram first per task 3,
 *      Sarvam second), feed the transcript to the **same** `classify` dep the text flow uses, raise the
 *      request through the **same** `raiseRequest` dep, and speak a confirmation.
 *
 * Honesty (task 5) is structural, not a convention:
 *
 *   * The reply is always recorded and transcribed by a provider we can name, so the engine recorded is
 *     never a guess. Twilio's own `<Gather input="speech">` recogniser is deliberately unused.
 *   * `<Play>` is emitted only when Sarvam really returned audio; otherwise the same sentence goes out
 *     as `<Say language="te-IN">` and the path is recorded through `onSpeechPath` and `X-Jadal-Speech`.
 *   * If the transcript cannot be classified as a request, the agent says so; it never confirms a
 *     request that was not written.
 *
 * The one thing this module needs but does not own is the caller→farmer mapping (`resolveCaller` in
 * `TelephonyDeps`). Without it the agent still answers and understands, and says honestly that the
 * number is not on the roster. `docs/VOICE.md` names the exact wiring.
 */

import type { Hono } from "hono";

import {
  messageFromParams,
  scriptAudioUrl,
  spokenEnglish,
  spokenTelugu,
  type SpokenMessage,
} from "../voice/script";
import type { MessageFacts } from "../voice/telugu";
import { phraseAudio, recordSpeechPath, spokenPart } from "./audio";
import { transcribe } from "./speech";
import { DEFAULT_MOUNT } from "./twilio";
import {
  inboundRecordTwiml,
  inboundTwiml,
  inboundUrls,
  listenTwiml,
  speakAndHangupTwiml,
  spokenPath,
} from "./twiml";
import type { InboundCaller, SttEngine, TelephonyDeps } from "./types";
import { fetchTwilioRecording, guardTwilioRequest, isTwilioHost, twimlResponse } from "./webhook";

/**
 * Inbound replies are transcribed Deepgram-first.
 *
 * ADR-005 makes Sarvam the primary engine for the **outbound** recording path (best on rural Telugu
 * and code-mixing) and that order is unchanged there. Task 3 asks specifically that the farmer's reply
 * to an inbound call be wired through Deepgram, with Sarvam/keyword as the fallback, so the inbound
 * order is reversed. Both orders end at the same `classify` dep, so only *who* transcribes changes.
 */
export const INBOUND_STT_ORDER: readonly SttEngine[] = ["deepgram", "sarvam"];

/** How long Twilio waits for a keypress before the flow falls through to the recording step. */
export const INBOUND_GATHER_TIMEOUT_SEC = 5;

/** The caller fields copied onto every recorded speech-path line. */
interface CallerMeta {
  readonly caller?: string;
  readonly farmerId?: string;
  readonly contactId?: string;
}

/** `PUBLIC_BASE_URL` + the mount path — the root every `<Play>` URL is built under. */
function telephonyRoot(deps: TelephonyDeps): string {
  return `${(deps.env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "")}${deps.mountPath ?? DEFAULT_MOUNT}`;
}

/** Resolve an inbound caller, treating a missing dep or a thrown lookup as "unknown". */
async function resolveCaller(deps: TelephonyDeps, from: string): Promise<InboundCaller | null> {
  const phone = from.trim();
  if (phone.length === 0 || deps.resolveCaller === undefined) return null;
  try {
    return await deps.resolveCaller(phone);
  } catch {
    return null;
  }
}

function callerMeta(from: string, caller: InboundCaller | null): CallerMeta {
  return {
    ...(from.trim().length === 0 ? {} : { caller: from.trim() }),
    ...(caller === null ? {} : { farmerId: caller.farmerId }),
    ...(caller?.contactId === undefined ? {} : { contactId: caller.contactId }),
  };
}

/** Speak one message and hang up, choosing `<Play>` vs `<Say>` honestly. */
async function sayBack(
  deps: TelephonyDeps,
  root: string,
  message: SpokenMessage,
  meta: CallerMeta,
): Promise<Response> {
  const text = spokenTelugu(message);
  const part = await spokenPart(deps, text, scriptAudioUrl(root, message), "confirmation", meta);
  return twimlResponse(speakAndHangupTwiml(part), { speechPath: part.play !== undefined ? "sarvam" : "say" });
}

/** Raise a request through the shared dep. `false` when there is no caller or the write failed. */
async function raiseFromInbound(
  deps: TelephonyDeps,
  caller: InboundCaller | null,
  type: "urgent" | "buffer",
  reason: string,
): Promise<boolean> {
  if (caller === null) return false;
  try {
    await deps.raiseRequest({ farmerId: caller.farmerId, type, reason, channel: "voice" });
    return true;
  } catch {
    return false;
  }
}

/** The farmer's next-turn facts, when the wiring can supply them. Never throws. */
async function nextTurnFacts(deps: TelephonyDeps, farmerId: string): Promise<MessageFacts | null> {
  if (deps.nextTurnFor === undefined) return null;
  try {
    return await deps.nextTurnFor(farmerId);
  } catch {
    return null;
  }
}

/** Register the inbound answer flow and the call-script audio/text routes on `app`. */
export function registerInboundRoutes(app: Hono, deps: TelephonyDeps): void {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  // 1. Twilio's voice webhook for a call the farmer placed. Answer and start listening.
  app.on(["GET", "POST"], "/inbound", async (c) => {
    const g = await guardTwilioRequest(deps, c);
    if (g instanceof Response) return g;

    const root = telephonyRoot(deps);
    const urls = inboundUrls(deps.env.PUBLIC_BASE_URL ?? "", deps.mountPath ?? DEFAULT_MOUNT);
    const from = g.get("From") ?? "";
    const caller = await resolveCaller(deps, from);
    const meta = callerMeta(from, caller);

    const greeting: SpokenMessage =
      caller?.farmerName === undefined
        ? { kind: "inbound_greeting" }
        : { kind: "inbound_greeting", farmerName: caller.farmerName };
    const prompt: SpokenMessage = { kind: "inbound_prompt" };

    const greetingPart = await spokenPart(deps, spokenTelugu(greeting), scriptAudioUrl(root, greeting), "greeting", meta);
    const promptPart = await spokenPart(deps, spokenTelugu(prompt), scriptAudioUrl(root, prompt), "prompt", meta);

    return twimlResponse(
      inboundTwiml({ urls, greeting: greetingPart, prompt: promptPart, gatherTimeoutSec: INBOUND_GATHER_TIMEOUT_SEC }),
      { speechPath: spokenPath(greetingPart, promptPart) },
    );
  });

  // 2. The keypress. 1 = acknowledge, 2 = record a request, anything else = listen.
  app.post("/inbound/respond", async (c) => {
    const g = await guardTwilioRequest(deps, c);
    if (g instanceof Response) return g;

    const root = telephonyRoot(deps);
    const urls = inboundUrls(deps.env.PUBLIC_BASE_URL ?? "", deps.mountPath ?? DEFAULT_MOUNT);
    const from = g.get("From") ?? "";
    const caller = await resolveCaller(deps, from);
    const meta = callerMeta(from, caller);
    const digits = (g.get("Digits") ?? "").trim();

    if (digits === "1") {
      // Only an open contact can be acknowledged; a caller with no contact is still thanked.
      if (caller?.contactId !== undefined) {
        try {
          await deps.recordAck(caller.contactId, true, "inbound:dtmf:1");
        } catch {
          /* thanking the farmer must not depend on the write */
        }
      }
      return sayBack(deps, root, { kind: "acknowledge" }, meta);
    }

    if (digits === "2") {
      // `?urgent=1` rides on the action URL so the keypad signal survives the recording step.
      return twimlResponse(inboundRecordTwiml(urls.recordingUrgent), { speechPath: "none" });
    }

    return listenResponse(deps, root, urls, meta);
  });

  // 3. No keypress: cue the farmer and record their free speech.
  app.post("/inbound/listen", async (c) => {
    const g = await guardTwilioRequest(deps, c);
    if (g instanceof Response) return g;

    const root = telephonyRoot(deps);
    const urls = inboundUrls(deps.env.PUBLIC_BASE_URL ?? "", deps.mountPath ?? DEFAULT_MOUNT);
    const from = g.get("From") ?? "";
    const caller = await resolveCaller(deps, from);
    return listenResponse(deps, root, urls, callerMeta(from, caller));
  });

  // 4. The recording: transcribe -> System 1 -> raise -> confirm.
  app.post("/inbound/recording", async (c) => {
    const g = await guardTwilioRequest(deps, c);
    if (g instanceof Response) return g;

    const root = telephonyRoot(deps);
    const from = g.get("From") ?? "";
    const caller = await resolveCaller(deps, from);
    const meta = callerMeta(from, caller);
    const urgent = c.req.query("urgent") === "1";
    const recordingUrl = g.get("RecordingUrl");

    if (recordingUrl === null || recordingUrl.length === 0 || !isTwilioHost(recordingUrl)) {
      return failedReply(deps, root, caller, meta, urgent, "no usable RecordingUrl on the webhook");
    }

    const wav = await fetchTwilioRecording(deps, recordingUrl, sleep);
    const outcome =
      wav === null
        ? ({ ok: false, reason: "recording could not be downloaded" } as const)
        : await transcribe(deps.fetch, deps.env, wav, INBOUND_STT_ORDER);

    if (!outcome.ok) {
      // No engine produced a transcript. Record the keyword fallback and never pretend we heard them.
      await recordSpeechPath(deps, { phase: "transcript", path: "keyword", reason: outcome.reason, ...meta });
      return failedReply(deps, root, caller, meta, urgent, outcome.reason);
    }

    await recordSpeechPath(deps, {
      phase: "transcript",
      path: outcome.engine,
      text: outcome.transcript,
      ...meta,
    });
    if (caller?.contactId !== undefined) {
      try {
        await deps.onTranscript?.(caller.contactId, outcome.transcript, outcome.engine);
      } catch {
        /* the transcript is a bonus; the call continues */
      }
    }

    // The same classifier the text/typed flow uses — intent, urgency and the release-time question.
    const result = await deps.classify(outcome.transcript);
    const facts = (caller === null ? null : await nextTurnFacts(deps, caller.farmerId)) ?? {};

    if (result.intent === "urgent_request" || result.intent === "buffer_request") {
      if (caller === null) return sayBack(deps, root, { kind: "caller_unknown" }, meta);
      const type = result.intent === "urgent_request" ? "urgent" : "buffer";
      const raised = await raiseFromInbound(deps, caller, type, outcome.transcript);
      return sayBack(deps, root, raised ? { kind: "request_recorded", facts } : { kind: "request_failed" }, meta);
    }

    if (result.intent === "schedule_question") {
      if (caller === null) return sayBack(deps, root, { kind: "caller_unknown" }, meta);
      const hasFacts = Object.keys(facts).length > 0;
      return sayBack(deps, root, hasFacts ? { kind: "next_turn", facts } : { kind: "schedule_hold" }, meta);
    }

    if (caller === null) return sayBack(deps, root, { kind: "caller_unknown" }, meta);
    return sayBack(deps, root, { kind: "acknowledge" }, meta);
  });

  /* ---------------------------------------------------------------- the call script, spoken */

  /**
   * The Telugu (and English) text of any scripted message. Pure — no key, no network — so the portal
   * and the tests can read exactly what the agent would say.
   */
  app.get("/script/text", (c) => {
    const message = messageFromParams(new URL(c.req.url).searchParams);
    if (message === null) return c.text("unknown script message", 400);
    return c.json({ kind: message.kind, te: spokenTelugu(message), en: spokenEnglish(message) });
  });

  /**
   * Real Sarvam audio for any scripted message: the "SPEAK" surface of task 2.
   *
   * Unsigned, like the other `<Play>` targets, and it can only synthesise messages the script knows
   * (never arbitrary text), so it is not an open TTS proxy. 503 without a Sarvam key, 502 when Sarvam
   * fails — never a 200 with silence.
   */
  app.get("/script/audio", async (c) => {
    const message = messageFromParams(new URL(c.req.url).searchParams);
    if (message === null) return c.text("unknown script message", 400);
    if (!deps.env.SARVAM_API_KEY) return c.text("tts not configured", 503);

    const { audio, reason } = await phraseAudio(deps, spokenTelugu(message));
    if (audio === null) return c.text(`tts failed: ${reason ?? "unknown"}`, 502);
    return new Response(audio, {
      headers: { "Content-Type": "audio/wav", "Cache-Control": "private, max-age=3600" },
    });
  });
}

/** The "no keypress, so listen" response: a cue, then `<Record>`. */
async function listenResponse(
  deps: TelephonyDeps,
  root: string,
  urls: ReturnType<typeof inboundUrls>,
  meta: CallerMeta,
): Promise<Response> {
  const cue: SpokenMessage = { kind: "listen_cue" };
  const cuePart = await spokenPart(deps, spokenTelugu(cue), scriptAudioUrl(root, cue), "listen_cue", meta);
  return twimlResponse(listenTwiml(urls, cuePart), { speechPath: cuePart.play !== undefined ? "sarvam" : "say" });
}

/**
 * The reply when no transcript could be produced.
 *
 * A keypad `2` is still an urgent request — ADR-005's rule — so it is raised with a note that the audio
 * was not transcribed; otherwise the agent says it could not hear the farmer.
 */
async function failedReply(
  deps: TelephonyDeps,
  root: string,
  caller: InboundCaller | null,
  meta: CallerMeta,
  urgent: boolean,
  reason: string,
): Promise<Response> {
  if (!urgent) return sayBack(deps, root, { kind: "not_understood" }, meta);
  const raised = await raiseFromInbound(
    deps,
    caller,
    "urgent",
    `Urgent request by keypad (2) on an inbound call; the recording could not be transcribed (${reason}).`,
  );
  return sayBack(deps, root, raised ? { kind: "request_recorded", facts: {} } : { kind: "request_failed" }, meta);
}
