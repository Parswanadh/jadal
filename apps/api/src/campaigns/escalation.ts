/**
 * The escalation ladder for an outbound campaign (B7).
 *
 * A roster change, a release warning or a request update goes out to a farmer who must acknowledge
 * it. When they do not, the caller agent climbs the ladder described in
 * `docs/architecture/overview.md` §6:
 *
 *   voice call → retry after 15 minutes → WhatsApp/SMS → flag to the coordinator
 *
 * That order is a **pure** decision, `nextEscalation`, so it can be tested exhaustively without a
 * database, a clock or a network. `runEscalation` is the thin effectful wrapper: it reads the current
 * contact, asks the ladder what happens next, appends the resulting `contact.updated` event and
 * dispatches it on `env.OUTBOUND`. All the interesting branching is in the pure half.
 *
 * Two rules that are easy to get wrong and are therefore enforced here:
 *
 *  * **A farmer without a smartphone never gets WhatsApp.** The message channel is chosen from the
 *    farmer's `preferred_channels` and `has_smartphone`: WhatsApp only on a smartphone, otherwise SMS
 *    if preferred, otherwise a voice call. This is a reachability rule, not a preference.
 *  * **The ladder is idempotent per (contact, attempt).** The next contact's id is derived from the
 *    previous contact and the attempt number, so a Workflow retry (or two workers racing) cannot
 *    enqueue the same rung twice; a duplicate append is caught and treated as already done.
 *
 * Every water-facing string is rendered by `voice/telugu.ts`; this module owns sequencing, not prose.
 */

import type { Contact } from "@jadal/contracts";

import { now as clockNow } from "../db/clock";
import { deterministicId } from "../db/id";
import { getContact, getFarmer, listOutlets, listRequests } from "../db/repo";
import type { FarmerRecord } from "../db/repo";
import { appendEvent, isStoreError } from "../db/store";
import type { Db } from "../db/store";
import type { ProviderFetch } from "../system1";
import { placeCallFromCampaign } from "../telephony-deps";
import { templateForPurpose, type MessageFacts } from "../voice/telugu";

/* ------------------------------------------------------------------ environment */

/**
 * A dispatch handed to `env.OUTBOUND` by the caller agent.
 *
 * `kind` is the ladder verb, not the transport: `retry` is a second voice call and is queued as
 * `call`, while `escalate` is a coordinator flag that the caller agent routes to the portal rather
 * than to the farmer's phone.
 */
export interface OutboundMessage {
  readonly kind: "call" | "whatsapp" | "sms" | "escalate";
  readonly contact_id: string;
  readonly farmer_id: string;
  readonly channel: Contact["channel"];
  readonly purpose: Contact["purpose"];
  readonly message_te: string;
  readonly message_en: string;
  readonly at: string;
  readonly attempt: number;
}

/**
 * The structural bindings the campaign modules need.
 *
 * Declared structurally rather than importing the Worker's `Env` (owned by another agent and still in
 * flux) so the same functions run against the in-memory `TestEnv`. `fetch` is optional because the
 * Worker uses the runtime's global fetch; `resolveProviderFetch` supplies that fallback.
 */
export interface CampaignEnv {
  readonly DB: Db;
  readonly OUTBOUND?: Queue<OutboundMessage> | undefined;
  readonly fetch?: ProviderFetch | undefined;
  readonly CACHE?: KVNamespace | undefined;
  /**
   * Twilio/Sarvam bindings (B9). Declared here rather than importing the telephony module's
   * `TelephonyEnv` so the ladder keeps its structural, dependency-light shape; `placeCallFromCampaign`
   * accepts the object because it structurally satisfies `TelephonyBindings`.
   */
  readonly TWILIO_ACCOUNT_SID?: string | undefined;
  readonly TWILIO_AUTH_TOKEN?: string | undefined;
  readonly TWILIO_FROM_NUMBER?: string | undefined;
  readonly PUBLIC_BASE_URL?: string | undefined;
  readonly SARVAM_API_KEY?: string | undefined;
  readonly SARVAM_TTS_SPEAKER?: string | undefined;
  readonly DEEPGRAM_API_KEY?: string | undefined;
  readonly REAL_TELEPHONY?: string | undefined;
}

/**
 * The provider fetch to hand the Open-Meteo client.
 *
 * Tests inject `env.fetch`; in the Worker it is absent and the global `fetch` is used instead. The
 * cast narrows the DOM `RequestInit` to the smaller shape `ProviderFetch` promises; the fields the
 * client sends (`method`, `headers`, `signal`) all exist on both.
 */
export function resolveProviderFetch(env: CampaignEnv): ProviderFetch {
  return env.fetch ?? ((input, init) => globalThis.fetch(input, init as RequestInit));
}

/* ------------------------------------------------------------------ timing */

/** The retry gap from §6: voice call → **retry after 15 minutes** → WhatsApp/SMS. */
export const RETRY_DELAY_MINUTES = 15;

const MS_PER_MINUTE = 60_000;

/** An ISO-8601 instant shifted by `minutes`. Used for the scheduled instant of the next rung. */
function addMinutesIso(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * MS_PER_MINUTE).toISOString();
}

/**
 * How long until the retry is due.
 *
 * The retry step is `RETRY_DELAY_MINUTES` after the failed call, measured from the contact's own
 * `at`. Passing the current instant in lets a Workflow that resumes part-way through the wait return
 * the remaining time instead of sleeping the full 15 minutes again; elapsed time beyond the gap
 * clamps to an immediate retry.
 */
function retryDelayMinutes(at: string | undefined, now: string): number {
  if (at === undefined) return RETRY_DELAY_MINUTES;
  const elapsed = Date.parse(now) - Date.parse(at);
  if (!Number.isFinite(elapsed)) return RETRY_DELAY_MINUTES;
  const remaining = RETRY_DELAY_MINUTES - Math.round(elapsed / MS_PER_MINUTE);
  if (remaining < 0) return 0;
  if (remaining > RETRY_DELAY_MINUTES) return RETRY_DELAY_MINUTES;
  return remaining;
}

/* ------------------------------------------------------------------ the pure ladder */

/** The verb of one rung of the ladder. */
export type EscalationAction = "call" | "retry" | "whatsapp" | "sms" | "escalate";

/** What happens next, and when. */
export interface EscalationDecision {
  readonly action: EscalationAction;
  readonly delayMinutes: number;
  readonly channel: Contact["channel"];
}

/**
 * The facts the ladder branches on: the last attempt (if any) and the farmer's reachability.
 *
 * `now` is passed separately, so this object stays a description of the contact rather than of the
 * decision being made.
 */
export interface EscalationContact {
  /** Channel of the most recent attempt, if there was one. */
  readonly channel?: Contact["channel"];
  /** When the most recent attempt was made, if known. Drives the remaining retry delay. */
  readonly at?: string;
  readonly preferred_channels: readonly Contact["channel"][];
  readonly has_smartphone: boolean;
}

/**
 * Pick a channel that can reach this farmer, honouring preference order where two are possible.
 *
 * WhatsApp requires a smartphone, full stop. Given one, the farmer's own preference picks between
 * WhatsApp and SMS; without one, only SMS and voice are on the table. `voice` is the total fallback,
 * because every farmer has a phone number.
 */
export function chooseMessageChannel(preferred: readonly Contact["channel"][], hasSmartphone: boolean): "whatsapp" | "sms" | "voice" {
  if (hasSmartphone && preferred.includes("whatsapp")) return "whatsapp";
  if (preferred.includes("sms")) return "sms";
  return "voice";
}

/**
 * The next rung for a contact that has already been attempted `priorAttempts` times.
 *
 *   0 attempts → `call`   (voice, now)
 *   1 attempt  → `retry`  (voice, after the 15-minute gap)
 *   2 attempts → WhatsApp or SMS, by capability
 *   3+         → `escalate` to the coordinator
 *
 * Pure and total: no I/O, no reads, no clock. `now` only adjusts how much of the retry gap is left.
 */
export function nextEscalation(contact: EscalationContact, priorAttempts: number, now: string): EscalationDecision {
  if (priorAttempts <= 0) {
    return { action: "call", delayMinutes: 0, channel: "voice" };
  }
  if (priorAttempts === 1) {
    return { action: "retry", delayMinutes: retryDelayMinutes(contact.at, now), channel: "voice" };
  }
  if (priorAttempts === 2) {
    const channel = chooseMessageChannel(contact.preferred_channels, contact.has_smartphone);
    if (channel === "whatsapp") return { action: "whatsapp", delayMinutes: 0, channel };
    if (channel === "sms") return { action: "sms", delayMinutes: 0, channel };
    // No messaging channel is reachable: try one more voice call before flagging the coordinator.
    return { action: "call", delayMinutes: 0, channel: "voice" };
  }
  return { action: "escalate", delayMinutes: 0, channel: "portal" };
}

/* ------------------------------------------------------------------ effects */

/** The message facts a `Contact` can carry: the farmer's name and their outlet, when known. */
async function factsFor(env: CampaignEnv, record: FarmerRecord): Promise<MessageFacts> {
  const outlets = await listOutlets(env);
  const plot = record.plots[0];
  const outlet = plot === undefined ? undefined : outlets.find((candidate) => candidate.id === plot.outlet_id);
  const facts: MessageFacts = { farmerName: record.farmer.name };
  if (outlet === undefined) return facts;
  return { ...facts, outletName: outlet.name, chainageM: outlet.chainage_m };
}

/** The canal a farmer draws from, via their first outlet. Needed because `Contact` carries no canal. */
async function canalIdFor(env: CampaignEnv, record: FarmerRecord): Promise<string> {
  const outlets = await listOutlets(env);
  for (const plot of record.plots) {
    const outlet = outlets.find((candidate) => candidate.id === plot.outlet_id);
    if (outlet !== undefined) return outlet.canal_id;
  }
  const fallback = outlets[0];
  if (fallback === undefined) {
    throw new Error(`campaigns: no outlet exists, cannot resolve a canal for farmer ${record.farmer.id}`);
  }
  return fallback.canal_id;
}

/**
 * Perform one rung of the ladder for a contact.
 *
 * Reads the current contact, decides the next rung, mints the next contact (attempt + 1) whose id is
 * derived from the previous one, appends its `contact.updated` event and dispatches it. Returns the
 * new contact, or `null` when there is nothing to do: an unknown contact, a missing farmer, or a
 * contact that is already acknowledged or escalated.
 *
 * Idempotent: re-running the same step returns the existing next contact instead of appending a
 * second event.
 */
export async function runEscalation(env: CampaignEnv, contactId: string): Promise<Contact | null> {
  const current = await getContact(env, contactId);
  if (current === null) return null;
  if (current.status === "acknowledged" || current.status === "escalated") return null;

  const record = await getFarmer(env, current.farmer_id);
  if (record === null) return null;

  const at = await clockNow(env);
  const decision = nextEscalation(
    {
      channel: current.channel,
      at: current.at,
      preferred_channels: record.farmer.preferred_channels,
      has_smartphone: record.farmer.has_smartphone,
    },
    current.attempt,
    at,
  );

  const nextAttempt = current.attempt + 1;
  const nextId = deterministicId("contact", current.id, String(nextAttempt));

  const existing = await getContact(env, nextId);
  if (existing !== null) return existing;

  const message = templateForPurpose(current.purpose, await factsFor(env, record));
  const scheduledAt = addMinutesIso(at, decision.delayMinutes);
  const next: Contact = {
    id: nextId,
    farmer_id: record.farmer.id,
    channel: decision.channel,
    purpose: current.purpose,
    status: decision.action === "escalate" ? "escalated" : "queued",
    attempt: nextAttempt,
    message_te: message.te,
    message_en: message.en,
    at: scheduledAt,
  };

  const canalId = await canalIdFor(env, record);
  try {
    await appendEvent(env, {
      id: deterministicId("evt", "contact.updated", next.id),
      at: scheduledAt,
      canal_id: canalId,
      actor: { kind: "agent", id: "caller" },
      type: "contact.updated",
      contact: next,
    });
  } catch (error) {
    if (isStoreError(error) && error.kind === "duplicate_event") {
      const raced = await getContact(env, nextId);
      if (raced !== null) return raced;
    }
    throw error;
  }

  /**
   * B9: a voice rung actually places the call when real telephony is configured.
   *
   * The three outcomes are deliberately distinct:
   *
   *  * `{simulated:true}` — no Twilio env (or `REAL_TELEPHONY` off): the browser simulated phone stays
   *    the demo vehicle, so the contact keeps the `queued` status it was created with (ADR-003).
   *  * `{ok:true}` — Twilio accepted the call: the contact is marked `sent`, which is what the
   *    coordinator's contact list and the `CALL_STATUS_MAP` in `telephony/routes.ts` both expect.
   *  * `{ok:false}` — a transport error or a Twilio rejection: the contact is marked `failed`. That is
   *    the counted failed attempt, and the dispatch below still hands the rung on, so the next
   *    `runEscalation` reads `attempt` and `nextEscalation` retries (15-minute voice retry) or, once
   *    the attempts are exhausted, escalates to the coordinator.
   *
   * `placeCall` never throws and never makes a request without a full credential set, so the offline
   * demo path is unchanged.
   */
  let landed = next;
  if (decision.channel === "voice") {
    if (next.purpose === "request_update") {
      const approvedRequests = await listRequests(env, { farmerId: record.farmer.id, status: "approved" });
      if (approvedRequests.length === 0) {
        console.warn(
          `campaigns: skipping voice call for farmer ${record.farmer.id} — no coordinator-approved water request exists`,
        );
        return landed;
      }
    }
    const placed = await placeCallFromCampaign(env, {
      contactId: next.id,
      to: record.farmer.phone,
      messageTe: next.message_te,
    });
    if (!placed.simulated) {
      landed = { ...next, status: placed.ok ? "sent" : "failed" };
      try {
        await appendEvent(env, {
          id: deterministicId("evt", "contact.updated", landed.id, landed.status),
          at: scheduledAt,
          canal_id: canalId,
          actor: { kind: "agent", id: "caller" },
          type: "contact.updated",
          contact: landed,
        });
      } catch (error) {
        if (!(isStoreError(error) && error.kind === "duplicate_event")) throw error;
      }
    }
  }

  // Escalation is a coordinator flag, not a dispatch on the farmer's channel.
  if (decision.action !== "escalate") {
    await env.OUTBOUND?.send({
      kind: decision.action === "retry" ? "call" : decision.action,
      contact_id: next.id,
      farmer_id: next.farmer_id,
      channel: next.channel,
      purpose: next.purpose,
      message_te: next.message_te,
      message_en: next.message_en,
      at: next.at,
      attempt: next.attempt,
    });
  }

  return landed;
}
