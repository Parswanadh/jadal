/**
 * Coordinator alerting (task B) — the two phone calls the water-approval loop was missing.
 *
 * The gap this closes: `raiseRequest()` in `requests.ts` persisted a request and System 1 scored it,
 * but **nothing ever told the coordinator**. A farmer could ask for water on the voice keypad, in the
 * portal or on the phone and the request would sit in `raised`/`triaged` with no human ever prompted
 * to decide it. Symmetrically, when the coordinator *did* decide, the farmer was never called with
 * the number that had been allocated to them or the time from which they may take it.
 *
 * Two entry points, one per direction:
 *
 *  * {@link notifyCoordinatorOfRequest} — a farmer raised a request; ring the coordinator and read out
 *    who is asking, for what, how much, and that it needs their approval.
 *  * {@link notifyFarmerOfAllocation} — the coordinator approved a volume over a window; ring the
 *    farmer with the allocated volume and the start of the window.
 *
 * ## The rules this module is built around
 *
 *  * **No keys, no problem.** With `COORDINATOR_PHONE` unset, or Twilio env absent (or
 *    `REAL_TELEPHONY` off), the call is a clean no-op that returns `{ simulated: true }`. The request
 *    is still created and the app still works (ADR-003).
 *  * **A notification can never fail the request.** `placeCall` already never throws, and every
 *    effect here is additionally wrapped: a missing contact, a store rejection, a malformed phone
 *    number — all of them are logged and reported in the result, never propagated. The farmer's
 *    request is the important thing.
 *  * **Simulated is never reported as real.** {@link AlertOutcome} carries `simulated` straight from
 *    `placeCall`, and the audit event is only written once the dispatch has actually happened.
 *  * **No second Twilio client.** Every call goes through `placeCall` in `src/telephony/twilio.ts`,
 *    reached through `placeCallDeps`/`placeCallFromCampaign` in `src/telephony-deps.ts` — the same
 *    seam the escalation ladder uses, so `TWILIO_FORWARD_TO` and the `REAL_TELEPHONY` kill switch
 *    behave identically here.
 *
 * ## Prose: composed, not invented
 *
 * Task 2 requires the spoken text to come from the existing Telugu templates "where possible", and
 * forbids editing `src/voice/**` (another lane owns it). Both farmer-facing allocation messages are
 * therefore **composed from {@link templateForPurpose}** — a `request_update` contact carries exactly
 * the facts this call has to say (allocated volume, window start) — so the sentence a farmer hears on
 * the allocation call is the same sentence the existing templates already produce. No new Telugu
 * phrase is introduced for the farmer path.
 *
 * The **coordinator** line has no existing template at all: `voice/telugu.ts` renders farmer-facing
 * messages keyed by `Contact.purpose`, a vocabulary that has nothing to say to a coordinator about an
 * approval queue. It is therefore built here from {{@link COORDINATOR_REQUEST_TE}} /
 * {{@link COORDINATOR_REQUEST_EN}}, the one clearly-named constant pair this module owns, and it is
 * flagged in the task-B report as the phrase that had to be added rather than borrowed.
 *
 * ## Audit trail
 *
 * `packages/contracts`' `JadalEvent` has no `notification.*` variant and contracts are immutable
 * without the orchestrator's `contracts-ok` label, so nothing is invented. Instead each attempt
 * writes **one `contact.updated`** event carrying a real `Contact` row for the person who was
 * rung — exactly the idiom `telephony-deps.ts` and `campaigns/escalation.ts` already use. The
 * contact's `channel` is `voice`, its `purpose` is mapped from what the call was about, and its
 * `status` records the dispatch outcome (`quoted` below), which is what makes the trail honest: a
 * coordinators' contact list shows the call as *sent* only when Twilio really took it.
 *
 * KNOWN GAP (reported, not papered over): `Contact` has no field for the recipient's phone number,
 * the Twilio `CallSid`, the spoken text of a coordinator call, or the fact that a call was
 * *simulated*. A simulated dispatch therefore has to be recorded as `failed` — the honest reading of
 * "nobody was actually rung" — but that is indistinguishable from a genuine Twilio rejection in the
 * log. Fixing it properly needs an additive contracts change (a `notification.attempted` event, or
 * `Contact.simulated`), which needs `contracts-ok`; this module does not take that decision.
 */

import type { Contact, WaterRequest } from "@jadal/contracts";

import { now } from "./db/clock";
import { newId } from "./db/id";
import { getFarmer } from "./db/repo";
import { appendEvent } from "./db/store";
import { DEMO_CANAL_ID } from "./demo";
import type { Env } from "./env";
import { placeCallFromCampaign, type TelephonyBindings } from "./telephony-deps";
import type { PlaceCallResult } from "./telephony";
import { formatVolumeM3, templateForPurpose } from "./voice/telugu";

/* ------------------------------------------------------------------ spoken text */

/**
 * The one phrase this lane had to add.
 *
 * Farmer-facing prose is composed from `voice/telugu.ts` (see the module header). A coordinator is
 * not a `Contact.purpose` and no template addresses them, so the approval prompt is defined here,
 * where it is clearly owned by this module rather than buried in another lane's file.
 *
 * `{volume}` is the volume the farmer asked for in m³, digit-formatted by
 * {@link formatVolumeM3} — the same formatter the farmer templates use, so the number the
 * coordinator hears is the number the farmer typed. `{reason}` is spoken verbatim because it is the
 * farmer's own words (or the transcript of them).
 */
export const COORDINATOR_REQUEST_TE =
  "నమస్కారం, జడల్ కాలువ కార్యాలయం నుండి కాల్. {farmer} గారు {volume} ఘన మీటర్ల నీటి కోసం " +
  "అభ్యర్థన పెట్టారు. కారణం: {reason}. ఈ అభ్యర్థనకు మీ ఆమోదం కావాలి. " +
  "ఆమోదించడానికి వన్ నొక్కండి, తిరస్కరించడానికి టూ నొక్కండి.";

export const COORDINATOR_REQUEST_EN =
  "Hello, this is the Jadal canal office calling. {farmer} has raised a request for {volume} cubic " +
  "metres of water. Reason: {reason}. This request needs your approval. " +
  "Press 1 to approve, or press 2 to reject.";

/** Fill `{placeholder}`s, or `""` for a placeholder with no value. */
function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}

/** The facts a coordinator call reads out. A structural subset of `WaterRequest` plus the name. */
export interface CoordinatorRequestFacts {
  readonly farmerName: string;
  readonly reason: string;
  readonly volume_m3: number;
  readonly type: WaterRequest["type"];
}

/* ------------------------------------------------------------------ outcomes */

/**
 * What happened to one notification attempt.
 *
 * `simulated` is copied straight from `placeCall` and is the only thing that may be reported as the
 * truth about whether a call went out. `alerted` is the weaker question "is the recipient now
 * reachable because of this attempt" — true for a real accepted call, true for the simulated phone
 * (the in-browser demo vehicle, ADR-003), false when a real call was attempted and Twilio refused it.
 */
export interface AlertOutcome {
  /** True when no real call was placed (no `COORDINATOR_PHONE`, no Twilio env, or `REAL_TELEPHONY` off). */
  readonly simulated: boolean;
  /** True when the recipient should be considered notified. */
  readonly alerted: boolean;
  /** The number dialled, or `null` when there was nothing to dial. */
  readonly to: string | null;
  /** `placeCall`'s own result, verbatim, or `null` when the call was skipped before dispatch. */
  readonly placed: PlaceCallResult | null;
  /** The audit `Contact` appended for this attempt, or `null` when nothing was appended. */
  readonly contactId: string | null;
  /** Why the attempt did nothing, when it did nothing. Human-readable and safe to log. */
  readonly skipped?: string;
  /** A failure that was caught rather than propagated. Never surfaces as a request failure. */
  readonly error?: string;
}

/** The shape every branch of this module returns, so callers never have to ask "did it throw?". */
function outcome(partial: Partial<AlertOutcome> & Pick<AlertOutcome, "simulated" | "alerted">): AlertOutcome {
  return { to: null, placed: null, contactId: null, ...partial };
}

/* ------------------------------------------------------------------ dispatch */

/** `Contact.purpose` values, so a notification's audit row is typed by the contract, not by a string. */
type ContactPurpose = Contact["purpose"];

/** The purpose that best describes what a notification was about. */
export interface AlertContext {
  readonly purpose: ContactPurpose;
  /** The request the call is about, when there is one. Recorded, never re-derived. */
  readonly requestId?: string;
}

/**
 * Place one call and record it, without ever throwing.
 *
 * The order is deliberate: dial first, audit second. A `contact.updated` row means "we tried to ring
 * this person", so writing it before the dispatch would put a call in the audit trail that never
 * happened. The cost is that a crash between the two leaves an unlogged call; that is the safer of
 * the two lies for an audit surface a coordinator reasons about.
 *
 * `to === null` (or blank) is the no-op path: no fetch, no event, `{ simulated: true, alerted: false }`.
 */
async function dispatch(
  env: Env,
  input: {
    readonly to: string | null;
    readonly farmer_id: string;
    readonly channel: Contact["channel"];
    readonly messageTe: string;
    readonly messageEn: string;
    readonly context: AlertContext;
    readonly at: string;
  },
): Promise<AlertOutcome> {
  const to = input.to?.trim();
  if (to === undefined || to.length === 0) {
    return outcome({ simulated: true, alerted: false, skipped: "no destination number" });
  }

  // One id for the attempt, used for both the Twilio call and its audit row, so the call the log
  // describes and the call we asked for are recognisably the same attempt.
  const contactId = newId("contact");

  // `placeCallFromCampaign` is the shared seam: it builds the deps from the bindings and calls
  // `placeCall` in the telephony module. The cast only exposes the bindings `Env` already declares.
  const placed = await placeCallFromCampaign(env as unknown as TelephonyBindings, {
    contactId,
    to,
    messageTe: input.messageTe,
  });

  const contact: Contact = {
    id: contactId,
    farmer_id: input.farmer_id,
    channel: input.channel,
    purpose: input.context.purpose,
    // A real accepted call is `sent`. A simulated dispatch was never actually rung, and a refused one
    // was never answered, so both are `failed` — see the module header for what that costs.
    status: !placed.simulated && placed.ok ? "sent" : "failed",
    attempt: 1,
    message_te: input.messageTe,
    message_en: input.messageEn,
    at: input.at,
  };

  try {
    await appendEvent(env, {
      id: newId("evt"),
      at: input.at,
      canal_id: DEMO_CANAL_ID,
      actor: { kind: "agent", id: "caller" },
      type: "contact.updated",
      contact,
    });
  } catch (error) {
    // An audit write must never take the request down with it. The call has already happened (or
    // been refused); the outcome is still returned accurately, just without a trail entry.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`coordinator-alert: could not audit ${input.context.purpose}: ${message}`);
    return outcome({
      simulated: placed.simulated,
      alerted: placed.simulated || placed.ok,
      to,
      placed,
      error: `audit_failed: ${message}`,
    });
  }

  return outcome({
    simulated: placed.simulated,
    alerted: placed.simulated || placed.ok,
    to,
    placed,
    contactId,
    ...(placed.simulated || placed.ok ? {} : { error: placed.error }),
  });
}

/**
 * Run one attempt, converting *any* throw into a reported failure.
 *
 * The belt to `placeCall`'s braces: a database that refuses the audit read, a malformed recipient, a
 * bug in the alerting code itself — none of them may fail the farmer's request.
 *
 * Generic in what the work returns, so a caller that enriches the outcome (the allocation call adds
 * the composed message text) keeps that enrichment without a cast.
 */
async function attempt<T extends AlertOutcome>(what: string, work: () => Promise<T>): Promise<T | AlertOutcome> {
  try {
    return await work();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`coordinator-alert: ${what} failed: ${message}`);
    return outcome({ simulated: true, alerted: false, error: message });
  }
}

/** Static, per-direction facts that do not depend on a database read. */
function describePlacement(placed: PlaceCallResult): string {
  if (placed.simulated) return "simulated (no real call placed)";
  if (placed.ok) return `real call ${placed.callSid} (${placed.status})`;
  return `real call failed${placed.httpStatus === undefined ? "" : ` HTTP ${placed.httpStatus}`}: ${placed.error}`;
}

/* ------------------------------------------------------------------ coordinator direction */

/** The env slice the coordinator alert needs; `Env` satisfies it structurally. */
export interface CoordinatorAlertEnv {
  readonly COORDINATOR_PHONE?: string | undefined;
  readonly TWILIO_ACCOUNT_SID?: string | undefined;
  readonly TWILIO_AUTH_TOKEN?: string | undefined;
  readonly TWILIO_FROM_NUMBER?: string | undefined;
  readonly TWILIO_FORWARD_TO?: string | undefined;
  readonly PUBLIC_BASE_URL?: string | undefined;
  readonly REAL_TELEPHONY?: string | undefined;
}

/**
 * The E.164 number to ring the coordinator on, or `null` when alerting is not configured.
 *
 * `COORDINATOR_PHONE` is the only switch. A blank or obviously malformed value is treated as unset
 * rather than dialled: an empty string would otherwise be sent to Twilio as a destination.
 *
 * NOTE — `TWILIO_FORWARD_TO` still applies (it is honoured inside `placeCall`, deliberately, so a
 * demo can be pointed at a real handset without editing secrets). During a demo that means the
 * coordinator's approval call rings the forwarding number, not `COORDINATOR_PHONE` itself.
 */
export function coordinatorPhone(env: CoordinatorAlertEnv): string | null {
  const raw = env.COORDINATOR_PHONE;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return /^\+\d{8,15}$/.test(trimmed) ? trimmed : null;
}

/**
 * Phone the coordinator because a farmer has raised a request that needs approval.
 *
 * Called from `raiseRequest()` after the request is durable. It must be impossible for this to fail
 * the farmer's request, so every path returns rather than throws.
 *
 * Reads the farmer's name itself (`getFarmer`) so the caller does not have to thread it through;
 * a farmer that cannot be read falls back to a generic addressee rather than blocking the call —
 * the coordinator still needs to know a request is waiting.
 */
export async function notifyCoordinatorOfRequest(
  env: Env,
  request: WaterRequest,
): Promise<AlertOutcome> {
  return attempt(`coordinator alert for request ${request.id}`, async () => {
    const to = coordinatorPhone(env);
    const at = await now(env);

    const record = await getFarmer(env, request.farmer_id);
    const farmerName = record?.farmer.name ?? request.farmer_id;

    const values = {
      farmer: farmerName,
      reason: request.reason,
      volume: formatVolumeM3(request.volume_m3),
      type: request.type,
    };
    const messageTe = fill(COORDINATOR_REQUEST_TE, values);
    const messageEn = fill(COORDINATOR_REQUEST_EN, values);

    const result = await dispatch(env, {
      to,
      farmer_id: request.farmer_id,
      channel: "voice",
      messageTe,
      messageEn,
      context: { purpose: "request_update", requestId: request.id },
      at,
    });

    if (result.skipped !== undefined) {
      console.log(`coordinator-alert: no call for request ${request.id} — ${result.skipped}`);
    } else if (result.placed !== null) {
      console.log(`coordinator-alert: request ${request.id} → ${describePlacement(result.placed)}`);
    }
    return result;
  });
}

/* ------------------------------------------------------------------ farmer direction */

/** A volume allocated to a farmer over a window, as the coordinator's decision records it. */
export interface AllocationAlertInput {
  readonly farmer_id: string;
  /** Allocated volume at the field gate, m³. */
  readonly volume_m3: number;
  /** Start of the window from which the water may be used, ISO-8601 UTC. */
  readonly windowStart?: string;
  /** End of the window, when known. */
  readonly windowEnd?: string;
  /** The request the allocation came from, for the audit trail. */
  readonly requestId?: string;
}

/** The allocation outcome, plus the exact text the farmer is told (empty only if the attempt threw). */
export interface AllocationAlertOutcome extends AlertOutcome {
  readonly messageTe: string;
  readonly messageEn: string;
}

/**
 * Ring the farmer with the volume allocated to them and the time from which to use it.
 *
 * The spoken text is composed by `templateForPurpose("request_update", …)`, so it is the same
 * Telugu the portal, the WhatsApp body and the simulated phone already render for a decided
 * request — this function adds the call, not a new sentence. The window start is rendered in IST by
 * that template's own formatter, because a farmer reads a clock time off the roster sheet.
 *
 * The status is pinned to `approved`: this call only ever goes out for a granted allocation, so the
 * farmer hears "approved" and the number they were actually granted, never the number they asked
 * for. The template is given the granted volume in both its volume slots for that reason.
 *
 * The message is built before the dispatch, so the text the farmer is told is returned in the
 * outcome even when no call could be placed (a test, or a coordinator demoing offline, can show it).
 */
export async function notifyFarmerOfAllocation(
  env: Env,
  input: AllocationAlertInput,
): Promise<AllocationAlertOutcome> {
  const result = await attempt(`farmer allocation alert for ${input.farmer_id}`, async () => {
    const at = await now(env);
    const record = await getFarmer(env, input.farmer_id);

    const message = templateForPurpose("request_update", {
      farmerName: record?.farmer.name,
      allocatedM3: input.volume_m3,
      requestVolumeM3: input.volume_m3,
      requestStatus: "approved",
      ...(input.windowStart === undefined ? {} : { windowStart: input.windowStart }),
      ...(input.windowEnd === undefined ? {} : { windowEnd: input.windowEnd }),
    });

    const dispatched = await dispatch(env, {
      // The farmer's own registered number; `TWILIO_FORWARD_TO` may redirect it (see `placeCall`).
      to: record?.farmer.phone ?? null,
      farmer_id: input.farmer_id,
      channel: "voice",
      messageTe: message.te,
      messageEn: message.en,
      context: { purpose: "request_update", ...(input.requestId === undefined ? {} : { requestId: input.requestId }) },
      at,
    });

    if (dispatched.skipped !== undefined) {
      console.log(`coordinator-alert: no allocation call for farmer ${input.farmer_id} — ${dispatched.skipped}`);
    } else if (dispatched.placed !== null) {
      console.log(`coordinator-alert: allocation for ${input.farmer_id} → ${describePlacement(dispatched.placed)}`);
    }
    return { ...dispatched, messageTe: message.te, messageEn: message.en };
  });

  // The text is carried out of the attempt even when the attempt itself failed, so a caller (or a
  // test) can still see exactly what the farmer would have been told.
  return "messageTe" in result ? result : { ...result, messageTe: "", messageEn: "" };
}
