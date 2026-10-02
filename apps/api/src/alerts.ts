/**
 * `POST /api/alerts` — the coordinator's "Alert the farmer" action (task B, task 2 critical path).
 *
 * ## Why this route is declared here and not in `packages/contracts`
 *
 * Every other route in this API is declared in `@jadal/contracts`'s `routes` object and registered
 * from that declaration. This one is **not**: the web lane froze the shape below and is coding against
 * it, but `packages/contracts` is the integration agreement, only the orchestrator changes it, and a
 * change needs the `contracts-ok` label. Adding a route there from this lane would be exactly the
 * contract edit the rules forbid.
 *
 * So the path, the body schema and the response schema are declared **here**, in this lane's own file,
 * with the frozen shape written out exactly as agreed. The route is registered from `routes/write.ts`
 * (in this lane's scope). The consequence, stated plainly: the web client and this route agree on a
 * shape that the shared contract does not yet know about. Promoting it to `packages/contracts` is a
 * one-file follow-up for whoever holds `contracts-ok`; nothing here would need to change but the
 * import.
 *
 * ## The frozen shape
 *
 * ```
 * POST /api/alerts
 * { "farmer_id": "f1", "channel": "call"|"sms"|"whatsapp",
 *   "severity": "info"|"warning"|"urgent"|"emergency",
 *   "message": "<optional>",
 *   "allocation": { "volume_m3": 120, "start": "<ISO>", "end": "<ISO>" } }
 * -> 200 { "ok": true, "contact_id": "<id>", "simulated": <boolean>, "detail": "<string>" }
 * ```
 *
 * `allocation` is optional and additive. When present **and** `channel` is `"call"`, the spoken message
 * states the allocated volume and the window from which to use it, in Telugu and English — that is the
 * whole point of the endpoint, and it is satisfied by composing the existing templates rather than by
 * writing a new sentence.
 *
 * ## Honesty
 *
 * `channel: "sms"` and `"whatsapp"` are **accepted and audited, but nothing is sent**: this module owns
 * the voice path, and `placeCall` is a voice primitive. Such an alert is recorded as a `queued`
 * contact and returned with `simulated: true` and a `detail` that says no transport delivered it. A
 * `call` with no Twilio env is likewise `simulated: true`. `simulated` and `detail` are the only
 * truthful account of what happened and are never dressed up.
 */

import { z } from "zod";

import { getFarmer } from "./db/repo";
import { badRequest, notFound } from "./http";
import { notifyFarmerOfAlert, type AlertChannel, type AlertSeverity } from "./coordinator-alert";

/** `POST /api/alerts` — the path, frozen with the web lane. */
export const ALERTS_PATH = "/api/alerts";

/** The four severities the coordinator can choose, matching the frozen shape. */
const AlertSeveritySchema = z.enum(["info", "warning", "urgent", "emergency"]);

/** The three channels the frozen shape accepts. Only `call` is dispatched. */
const AlertChannelSchema = z.enum(["call", "sms", "whatsapp"]);

/**
 * The allocation an alert may carry.
 *
 * All three fields are optional except the volume: a coordinator who knows how much water is being
 * allocated but not yet when can still alert, and the spoken message then states the volume with no
 * time clause rather than inventing one. `start`/`end` are ISO-8601 instants, rendered in IST.
 */
export const AlertAllocationSchema = z.object({
  volume_m3: z.number(),
  start: z.string().datetime().optional(),
  end: z.string().datetime().optional(),
});

/** The request body, exactly the frozen shape. */
export const AlertRequestSchema = z.object({
  farmer_id: z.string().min(1),
  channel: AlertChannelSchema,
  severity: AlertSeveritySchema,
  message: z.string().optional(),
  allocation: AlertAllocationSchema.optional(),
});

/** The response body, exactly the frozen shape. */
export const AlertResponseSchema = z.object({
  ok: z.boolean(),
  contact_id: z.string(),
  simulated: z.boolean(),
  detail: z.string(),
});

export type AlertRequestBody = z.infer<typeof AlertRequestSchema>;
export type AlertResponseBody = z.infer<typeof AlertResponseSchema>;

/** A one-line, human-readable account of what actually happened — the `detail` field. */
export function describeAlertOutcome(
  channel: AlertChannel,
  outcome: {
    simulated: boolean;
    alerted: boolean;
    to: string | null;
    /** The number Twilio actually rang; differs from `to` when a demo mapping is in force. */
    dialled?: string | null;
    skipped?: string;
    error?: string;
  },
): string {
  if (outcome.error !== undefined) {
    return `${channel} alert failed: ${outcome.error}`;
  }
  if (outcome.skipped !== undefined) {
    return `${channel} alert not dispatched: ${outcome.skipped}`;
  }
  if (channel !== "call") {
    // Deliberately blunt: this app has no messaging transport at all, so the only
    // true account is that nothing left the building. The contact is audited as
    // `queued` for the coordinator's list, but "queued" must never read as "sent".
    return `${channel} alert NOT SENT: no ${channel} transport exists in this app; the alert is recorded as a queued contact only, and nothing reached the farmer`;
  }
  return outcome.simulated
    ? `call simulated (no real call placed)${
        outcome.to === null ? "" : `; destination would be ${outcome.to}`
      }`
    : `call placed to ${outcome.dialled ?? outcome.to ?? "unknown"}`;
}

/**
 * Handle one `POST /api/alerts`.
 *
 * Throws the API's usual `HttpError`s for bad input (`400`) and an unknown farmer (`404`); every
 * downstream failure is reported in the response body rather than thrown, because a coordinator's
 * alert that cannot be delivered must still tell the coordinator so — and must never 500 in a way
 * that hides *which* part failed.
 */
export async function handleAlert(env: Parameters<typeof notifyFarmerOfAlert>[0], body: AlertRequestBody): Promise<AlertResponseBody> {
  const farmer = await getFarmer(env, body.farmer_id);
  if (farmer === null) {
    throw notFound("farmer_not_found", `no farmer ${body.farmer_id}`);
  }

  if (body.channel === "call" && farmer.farmer.phone.trim().length === 0) {
    throw badRequest("farmer_has_no_phone", `farmer ${body.farmer_id} has no phone number to call`);
  }

  const outcome = await notifyFarmerOfAlert(env, {
    farmer_id: body.farmer_id,
    channel: body.channel,
    severity: body.severity,
    ...(body.message === undefined ? {} : { message: body.message }),
    ...(body.allocation === undefined
      ? {}
      : {
          allocation: {
            volume_m3: body.allocation.volume_m3,
            ...(body.allocation.start === undefined ? {} : { start: body.allocation.start }),
            ...(body.allocation.end === undefined ? {} : { end: body.allocation.end }),
          },
        }),
  });

  return {
    ok: true,
    contact_id: outcome.contactId ?? "",
    simulated: outcome.simulated,
    detail: describeAlertOutcome(body.channel, outcome),
  };
}

/** Narrow the parsed body's enums to the notifier's own types (they are the same string unions). */
export const ALERT_SEVERITIES: readonly AlertSeverity[] = ["info", "warning", "urgent", "emergency"];
export const ALERT_CHANNELS: readonly AlertChannel[] = ["call", "sms", "whatsapp"];
