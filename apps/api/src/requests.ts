/**
 * The single "raise a water request" path (B9 extraction).
 *
 * `POST /api/requests` (`routes/write.ts`) and the telephony webhook's `raiseRequest` dep both have to
 * create exactly the same two events — `request.raised` by the farmer, then `request.triaged` by
 * System 1 — and read the request back. Before B9 that logic lived inline in the route, so a voice
 * request would have needed a second copy. It lives here instead, and both callers go through it.
 *
 * System 1 only *scores* the request (`triage_score`, `intent`); it never decides water. The
 * coordinator's approval is a separate step (`request.decided` in `routes/write.ts`).
 *
 * Since task B the same path also **phones the coordinator**, because persisting a request without
 * telling anyone about it left the approval queue invisible: a farmer could ask for water on three
 * channels and no human was ever prompted to decide. The call is placed here — after the request is
 * durable, in one place — so `POST /api/requests` and the telephony webhook's `raiseRequest` dep
 * both get it and neither can drift. It is best-effort by construction: see
 * `notifyCoordinatorOfRequest`, which returns a result rather than throwing.
 */

import type { WaterRequest } from "@jadal/contracts";

import { notifyCoordinatorOfRequest } from "./coordinator-alert";
import { now } from "./db/clock";
import { newId } from "./db/id";
import { getFarmer, getRequest } from "./db/repo";
import { appendEvent } from "./db/store";
import { DEMO_CANAL_ID } from "./demo";
import type { Env } from "./env";
import { HttpError, notFound, providerEnv } from "./http";
import { classify } from "./system1";

const SYSTEM1_ACTOR = { kind: "agent", id: "system1" } as const;

/** Everything needed to raise a request, with the id and status minted here. */
export interface RaiseRequestInput {
  readonly farmer_id: string;
  readonly type: WaterRequest["type"];
  readonly volume_m3: number;
  readonly reason: string;
  readonly channel: WaterRequest["channel"];
  readonly crop_plan_id?: string;
}

/**
 * Append `request.raised` + `request.triaged` and return the stored request.
 *
 * @throws {import("./http").HttpError} `404 farmer_not_found` when the farmer is unknown, and
 *   `500 internal_error` if the request cannot be read back after the append.
 */
export async function raiseRequest(env: Env, input: RaiseRequestInput): Promise<WaterRequest> {
  const farmer = await getFarmer(env, input.farmer_id);
  if (farmer === null) {
    throw notFound("farmer_not_found", `no farmer ${input.farmer_id}`);
  }

  const at = await now(env);
  const triage = await classify(providerEnv(env), input.reason);
  const request: WaterRequest = {
    id: newId("req"),
    farmer_id: input.farmer_id,
    ...(input.crop_plan_id === undefined ? {} : { crop_plan_id: input.crop_plan_id }),
    type: input.type,
    volume_m3: input.volume_m3,
    reason: input.reason,
    channel: input.channel,
    status: "raised",
    raised_at: at,
    triage_score: triage.urgency,
  };

  await appendEvent(env, {
    id: newId("evt"),
    at,
    canal_id: DEMO_CANAL_ID,
    actor: { kind: "farmer", id: input.farmer_id },
    type: "request.raised",
    request,
  });
  await appendEvent(env, {
    id: newId("evt"),
    at,
    canal_id: DEMO_CANAL_ID,
    actor: SYSTEM1_ACTOR,
    type: "request.triaged",
    request_id: request.id,
    triage_score: triage.urgency,
    intent: triage.intent,
  });

  const stored = await getRequest(env, request.id);
  if (stored === null) {
    throw new HttpError("internal_error", `request ${request.id} vanished after being raised`, 500);
  }

  // Task B: the coordinator is phoned for approval. Deliberately after the read-back, so the call is
  // only ever about a request that really exists, and deliberately awaited for ordering rather than
  // for failure: `notifyCoordinatorOfRequest` returns a result and catches everything, so this line
  // cannot throw and cannot take the farmer's request down with it. With `COORDINATOR_PHONE` unset
  // or no Twilio env it is a clean no-op returning `{ simulated: true }`.
  await notifyCoordinatorOfRequest(env, stored);

  return stored;
}
