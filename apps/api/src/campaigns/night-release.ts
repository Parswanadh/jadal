/**
 * Night-release protocol (B7).
 *
 * `docs/architecture/overview.md` §6: a release that starts between 18:00 and 06:00 IST sends a
 * WhatsApp message **and** a voice warning call one hour before the water arrives. The band and the
 * boundary comparison come from `db/clock.ts` (`isNightRelease`), which owns the IST arithmetic; this
 * module owns who gets told and when.
 *
 * For every farmer with a turn in the affected window the protocol queues:
 *
 *   * a **voice** contact — the warning call, which reaches every farmer, and
 *   * a **messaging** contact on the farmer's reachable channel — WhatsApp only with a smartphone,
 *     otherwise SMS if they prefer it. A feature-phone farmer gets the call and nothing else.
 *
 * Both contacts fire at `window.start − 1h`. The helper is idempotent: contact ids are derived from
 * the window, farmer and channel, so scheduling the same window twice cannot double-queue it.
 */

import type { Contact, ReleaseWindow } from "@jadal/contracts";

import { isNightRelease } from "../db/clock";
import { deterministicId } from "../db/id";
import { getContact, getFarmer, listOutlets, listRosters } from "../db/repo";
import type { FarmerRecord } from "../db/repo";
import { appendEvent, isStoreError } from "../db/store";
import { nightReleaseWarningEn, nightReleaseWarningTe, type MessageFacts } from "../voice/telugu";
import { chooseMessageChannel, type CampaignEnv } from "./escalation";

const MS_PER_MINUTE = 60_000;

/** The warning instant: one hour before the release. */
export const WARNING_LEAD_MINUTES = 60;

function shiftMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * MS_PER_MINUTE).toISOString();
}

/** The message facts for one farmer's outlet in this window. */
function factsFor(record: FarmerRecord, outletName: string | undefined, chainageM: number | undefined, window: ReleaseWindow): MessageFacts {
  const facts: MessageFacts = { farmerName: record.farmer.name, windowStart: window.start, windowEnd: window.end };
  if (outletName === undefined) return facts;
  return { ...facts, outletName, ...(chainageM === undefined ? {} : { chainageM }) };
}

/**
 * Queue the night-release warnings for one release window.
 *
 * Returns the contacts created (or the existing ones on a repeat call), or `[]` when the window is
 * not a night release, when the warning instant has already passed, or when nobody is rostered.
 */
export async function scheduleNightRelease(env: CampaignEnv, window: ReleaseWindow, now: string): Promise<Contact[]> {
  if (!isNightRelease(window.start)) return [];

  const warningAt = shiftMinutes(window.start, -WARNING_LEAD_MINUTES);
  const warningMs = Date.parse(warningAt);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(warningMs) || !Number.isFinite(nowMs)) return [];
  // The warning is in the past: queueing it now would be a call about water that already flowed.
  if (warningMs <= nowMs) return [];

  const rosters = await listRosters(env, { releaseWindowId: window.id, status: "approved" });
  const farmerIds = [...new Set(rosters.flatMap((roster) => roster.turns.map((turn) => turn.farmer_id)))].sort();
  if (farmerIds.length === 0) return [];

  const outlets = await listOutlets(env, window.canal_id);
  const contacts: Contact[] = [];
  for (const farmerId of farmerIds) {
    const record = await getFarmer(env, farmerId);
    if (record === null) continue;

    const plot = record.plots[0];
    const outlet = plot === undefined ? undefined : outlets.find((candidate) => candidate.id === plot.outlet_id);
    const facts = factsFor(record, outlet?.name, outlet?.chainage_m, window);
    const message = { te: nightReleaseWarningTe(facts), en: nightReleaseWarningEn(facts) };

    // The call always goes out; the message only when a messaging channel can reach them.
    const channels: Array<"voice" | "whatsapp" | "sms"> = ["voice"];
    const messageChannel = chooseMessageChannel(record.farmer.preferred_channels, record.farmer.has_smartphone);
    if (messageChannel !== "voice") channels.push(messageChannel);

    for (const channel of channels) {
      const contact = await queue(env, window, record, channel, warningAt, message);
      if (contact !== null) contacts.push(contact);
    }
  }
  return contacts;
}

/** Append and dispatch one queued contact. Idempotent on `(window, farmer, channel)`. */
async function queue(
  env: CampaignEnv,
  window: ReleaseWindow,
  record: FarmerRecord,
  channel: "voice" | "whatsapp" | "sms",
  at: string,
  message: { te: string; en: string },
): Promise<Contact | null> {
  const id = deterministicId("contact", "night", window.id, record.farmer.id, channel);
  const existing = await getContact(env, id);
  if (existing !== null) return existing;

  const contact: Contact = {
    id,
    farmer_id: record.farmer.id,
    channel,
    purpose: "release_warning",
    status: "queued",
    attempt: 1,
    message_te: message.te,
    message_en: message.en,
    at,
  };

  try {
    await appendEvent(env, {
      id: deterministicId("evt", "contact.updated", contact.id),
      at,
      canal_id: window.canal_id,
      actor: { kind: "agent", id: "caller" },
      type: "contact.updated",
      contact,
    });
  } catch (error) {
    if (isStoreError(error) && error.kind === "duplicate_event") {
      return getContact(env, id);
    }
    throw error;
  }

  await env.OUTBOUND?.send({
    kind: channel === "voice" ? "call" : channel,
    contact_id: contact.id,
    farmer_id: contact.farmer_id,
    channel: contact.channel,
    purpose: contact.purpose,
    message_te: contact.message_te,
    message_en: contact.message_en,
    at: contact.at,
    attempt: contact.attempt,
  });

  return contact;
}
