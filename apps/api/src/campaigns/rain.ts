/**
 * Rain re-planning cron (B7).
 *
 * `docs/research/voice-and-data.md` §7.4: if Open-Meteo reports `precipitation_sum >= 15.0 mm` inside
 * the next 24-hour forecast window, the upcoming turns are deferred, the water they would have
 * delivered is moved to the common buffer pool, and affected farmers are told their quota is safe.
 *
 * Division of labour:
 *
 *  * `shouldReplan` is the pure trigger; the threshold is the named `rainTriggerMm` constant exported
 *    by `voice/openmeteo.ts`, not a number typed here.
 *  * `replan` reads the forecast through the same offline-safe `getForecast` client every other module
 *    uses, finds the turns being deferred, and books the saving.
 *
 * **Where the numbers come from.** No water arithmetic is invented here. Each farmer's saving is the
 * sum of `Turn.planned_volume_m3` for their deferred turns — those volumes were produced by
 * `@jadal/core`'s deterministic roster engine and are already the authoritative field-gate figures.
 * Summing them is bookkeeping; the ledger movement that actually returns the water to the buffer
 * (`farmer:*:quota → buffer`) is produced by `core-shim`'s `entriesFor`, in the same atomic batch as
 * the `rain.replanned` event.
 */

import type { Contact, WeatherDay } from "@jadal/contracts";

import { now as clockNow } from "../db/clock";
import { deterministicId } from "../db/id";
import { getContact, getFarmer, listFarmers, listOutlets, listRosters } from "../db/repo";
import type { FarmerRecord } from "../db/repo";
import { appendEvent, isStoreError } from "../db/store";
import { round } from "../core-shim";
import { GUNTUR, getForecast, rainTriggerMm } from "../voice/openmeteo";
import { rainPostponedEn, rainPostponedTe, type MessageFacts } from "../voice/telugu";
import { chooseMessageChannel, resolveProviderFetch, type CampaignEnv } from "./escalation";

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
/** Enough forecast to cover a 24-hour horizon without over-fetching. */
const FORECAST_DAYS = 2;

/** The result of a re-plan: the conserved saving, its per-farmer split, and the notifications. */
export interface RainReplan {
  readonly saved_m3: number;
  readonly by_farmer_m3: Record<string, number>;
  readonly contacts: Contact[];
}

/**
 * Does the forecast call for a re-plan?
 *
 * A forecast day is in the window when its IST calendar day overlaps `[now, now + 24h]`. Treating a
 * `WeatherDay.date` as IST midnight is the §7.2 contract (the Open-Meteo query is pinned to
 * `Asia/Kolkata`), so a rainy "today" or "tomorrow" both trigger, while a downpour three days out
 * does not. An unparseable `now` returns `false` rather than guessing.
 */
export function shouldReplan(forecast: readonly WeatherDay[], now: string): boolean {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) return false;
  const horizonMs = nowMs + MS_PER_DAY;

  for (const day of forecast) {
    if (day.rain_mm < rainTriggerMm) continue;
    const startMs = Date.parse(`${day.date}T00:00:00+05:30`);
    if (!Number.isFinite(startMs)) continue;
    const endMs = startMs + MS_PER_DAY;
    if (startMs < horizonMs && endMs > nowMs) return true;
  }
  return false;
}

/**
 * Run the rain re-plan for one canal.
 *
 * Fetches the forecast, and if the trigger fires, defers the turns starting inside the next 24 hours,
 * appends one `rain.replanned` event with the conserved saving, and notifies each affected farmer.
 * A forecast below the trigger is a no-op: nothing is appended and no messages are sent.
 */
export async function replan(env: CampaignEnv, canalId: string): Promise<RainReplan> {
  const at = await clockNow(env);
  const atMs = Date.parse(at);
  if (!Number.isFinite(atMs)) return empty();

  const outlets = await listOutlets(env, canalId);
  const outletIds = new Set(outlets.map((outlet) => outlet.id));
  const centre = await commandCentre(env, outletIds);
  const forecast = await getForecast({ fetch: resolveProviderFetch(env) }, centre.lat, centre.lon, FORECAST_DAYS);
  if (!shouldReplan(forecast, at)) return empty();

  const horizonMs = atMs + MS_PER_DAY;
  const rosters = await listRosters(env, { canalId, status: "approved" });
  const scheduledByFarmer = new Map<string, number>();
  const firstTurnByFarmer = new Map<string, number>();
  for (const roster of rosters) {
    for (const turn of roster.turns) {
      const startMs = Date.parse(turn.start);
      if (!Number.isFinite(startMs)) continue;
      if (startMs < atMs || startMs > horizonMs) continue;
      if (!(turn.planned_volume_m3 > 0)) continue;
      scheduledByFarmer.set(turn.farmer_id, (scheduledByFarmer.get(turn.farmer_id) ?? 0) + turn.planned_volume_m3);
      const first = firstTurnByFarmer.get(turn.farmer_id);
      if (first === undefined || startMs < first) firstTurnByFarmer.set(turn.farmer_id, startMs);
    }
  }

  const by_farmer_m3: Record<string, number> = {};
  for (const farmerId of [...scheduledByFarmer.keys()].sort()) {
    const volume = round(scheduledByFarmer.get(farmerId) ?? 0, 3);
    if (volume > 0) by_farmer_m3[farmerId] = volume;
  }
  const saved_m3 = round(
    Object.values(by_farmer_m3).reduce((total, volume) => total + volume, 0),
    3,
  );
  if (!(saved_m3 > 0)) return empty();

  await appendReplanEvent(env, canalId, at, saved_m3, by_farmer_m3);
  const contacts = await notify(env, canalId, at, atMs, by_farmer_m3, firstTurnByFarmer, forecast);
  return { saved_m3, by_farmer_m3, contacts };
}

function empty(): RainReplan {
  return { saved_m3: 0, by_farmer_m3: {}, contacts: [] };
}

/** Append the re-plan event, tolerating a duplicate from a re-run of the same cron tick. */
async function appendReplanEvent(
  env: CampaignEnv,
  canalId: string,
  at: string,
  saved_m3: number,
  by_farmer_m3: Record<string, number>,
): Promise<void> {
  try {
    await appendEvent(env, {
      id: deterministicId("evt", "rain.replanned", canalId, at),
      at,
      canal_id: canalId,
      actor: { kind: "system", id: "rain-cron" },
      type: "rain.replanned",
      saved_m3,
      by_farmer_m3,
    });
  } catch (error) {
    if (isStoreError(error) && error.kind === "duplicate_event") return;
    throw error;
  }
}

/** The forecast centroid for the canal's plots, falling back to the Guntur command-area coordinate. */
async function commandCentre(env: CampaignEnv, outletIds: ReadonlySet<string>): Promise<{ lat: number; lon: number }> {
  const farmers = await listFarmers(env);
  let latSum = 0;
  let lonSum = 0;
  let count = 0;
  for (const record of farmers) {
    for (const plot of record.plots) {
      if (!outletIds.has(plot.outlet_id)) continue;
      latSum += plot.lat;
      lonSum += plot.lon;
      count += 1;
    }
  }
  if (count === 0) return { lat: GUNTUR.lat, lon: GUNTUR.lon };
  return { lat: latSum / count, lon: lonSum / count };
}

/** The deepest forecast rainfall inside the horizon, for the message body. */
function rainDepth(forecast: readonly WeatherDay[]): number {
  let depth = 0;
  for (const day of forecast) if (day.rain_mm > depth) depth = day.rain_mm;
  return round(depth, 1);
}

/** Notify every affected farmer with the rain-postponement message. Idempotent per `(canal, farmer, at)`. */
async function notify(
  env: CampaignEnv,
  canalId: string,
  at: string,
  atMs: number,
  byFarmer: Record<string, number>,
  firstTurnByFarmer: ReadonlyMap<string, number>,
  forecast: readonly WeatherDay[],
): Promise<Contact[]> {
  const outlets = await listOutlets(env, canalId);
  const rainMm = rainDepth(forecast);
  const contacts: Contact[] = [];

  for (const farmerId of Object.keys(byFarmer).sort()) {
    const record = await getFarmer(env, farmerId);
    if (record === null) continue;

    const allocatedM3 = byFarmer[farmerId] ?? 0;
    const channel = chooseMessageChannel(record.farmer.preferred_channels, record.farmer.has_smartphone);
    const leadHours = leadHoursFor(firstTurnByFarmer.get(farmerId), atMs);
    const facts = messageFacts(record, outlets, allocatedM3, rainMm, leadHours);
    const message = { te: rainPostponedTe(facts), en: rainPostponedEn(facts) };

    const id = deterministicId("contact", "rain", canalId, farmerId, at);
    const existing = await getContact(env, id);
    if (existing !== null) {
      contacts.push(existing);
      continue;
    }

    const contact: Contact = {
      id,
      farmer_id: farmerId,
      channel,
      purpose: "roster_change",
      status: "queued",
      attempt: 1,
      message_te: message.te,
      message_en: message.en,
      at,
    };
    try {
      await appendEvent(env, {
        id: deterministicId("evt", "contact.updated", id),
        at,
        canal_id: canalId,
        actor: { kind: "agent", id: "caller" },
        type: "contact.updated",
        contact,
      });
    } catch (error) {
      if (isStoreError(error) && error.kind === "duplicate_event") continue;
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
    contacts.push(contact);
  }
  return contacts;
}

/** Hours until a farmer's first deferred turn, or `undefined` when it is not known. */
function leadHoursFor(startMs: number | undefined, nowMs: number): number | undefined {
  if (startMs === undefined) return undefined;
  return Math.max(0, Math.round((startMs - nowMs) / MS_PER_HOUR));
}

/** The message facts for a postponed farmer. */
function messageFacts(
  record: FarmerRecord,
  outlets: readonly { id: string; name: string; chainage_m: number }[],
  allocatedM3: number,
  rainMm: number,
  leadHours: number | undefined,
): MessageFacts {
  const plot = record.plots[0];
  const outlet = plot === undefined ? undefined : outlets.find((candidate) => candidate.id === plot.outlet_id);
  const facts: MessageFacts = { farmerName: record.farmer.name, allocatedM3, rainMm };
  const withOutlet =
    outlet === undefined ? facts : { ...facts, outletName: outlet.name, chainageM: outlet.chainage_m };
  return leadHours === undefined ? withOutlet : { ...withOutlet, leadHours };
}
