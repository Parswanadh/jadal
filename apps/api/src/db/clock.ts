/**
 * The single source of "now" for the whole app.
 *
 * Nothing outside `src/core/`'s pure functions and this module may call `Date.now()` or
 * `new Date()`: every timestamp in the event log and in the projections comes from the `clock` table.
 * That is what makes the demo replayable and the tests deterministic — `POST /api/demo/advance` moves
 * the world forward and the next event is stamped with the new time.
 *
 * The migration seeds `clock` with `2026-09-14T00:30:00Z`. `offset_h` accumulates how far the demo has
 * been time-travelled in total, as an audit trail; nothing derives behaviour from it.
 *
 * `env` is a `DbEnv` (see `store.ts`) — the smallest structural slice of the Worker's `Env`, which
 * keeps this module usable from routes, agents and the in-memory test database alike.
 */

import type { DbEnv } from "./store";

/**
 * Asia/Kolkata is UTC+05:30 with **no daylight saving, ever** — India has not observed DST since 1945
 * and has no scheduled transition. So the offset is a fixed arithmetic constant, not a timezone
 * database lookup. This matters: the night-release rule (18:00–06:00 IST) is checked against IST wall
 * clock time, so an off-by-30-minutes bug here sends warnings out at the wrong hour.
 */
export const IST_OFFSET_MINUTES = 330;
const MS_PER_MINUTE = 60_000;

/** ISO-8601 in UTC, the format `IsoTime` in `@jadal/contracts` requires (`…Z`). */
function toUtcIso(date: Date): string {
  return date.toISOString();
}

function parseIso(iso: string): Date {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError(`clock: not an ISO-8601 instant: ${JSON.stringify(iso)}`);
  }
  return parsed;
}

/** Wall-clock time in Asia/Kolkata. */
export interface IstTime {
  /** The same instant, rendered with an explicit `+05:30` offset. */
  iso: string;
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
  /** Local hour, 0–23. */
  hour: number;
  /** Local minute, 0–59. */
  minute: number;
  /** Minutes since local midnight, 0–1439. Useful for boundary comparisons. */
  minutesOfDay: number;
}

/** Convert any ISO-8601 instant to IST wall-clock time. Pure; no database. */
export function toIST(iso: string): IstTime {
  const shifted = new Date(parseIso(iso).getTime() + IST_OFFSET_MINUTES * MS_PER_MINUTE);
  const date = shifted.toISOString().slice(0, 10);
  const hour = shifted.getUTCHours();
  const minute = shifted.getUTCMinutes();
  return {
    iso: `${date}T${pad2(hour)}:${pad2(minute)}:00+05:30`,
    date,
    hour,
    minute,
    minutesOfDay: hour * 60 + minute,
  };
}

/** Release windows starting between 18:00 and 06:00 IST trigger the night-release protocol. */
export const NIGHT_RELEASE_START_MINUTE = 18 * 60;
export const NIGHT_RELEASE_END_MINUTE = 6 * 60;

/**
 * Is `iso` inside the night-release band, i.e. 18:00–06:00 IST?
 *
 * The band wraps midnight, so it is two ranges: `[1080, 1440)` and `[0, 360)`.
 */
export function isNightRelease(iso: string): boolean {
  const minutes = toIST(iso).minutesOfDay;
  return minutes >= NIGHT_RELEASE_START_MINUTE || minutes < NIGHT_RELEASE_END_MINUTE;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

/** The simulated current time, as an ISO-8601 UTC instant. The only `now()` in the app. */
export async function now(env: DbEnv): Promise<string> {
  const row = await env.DB.prepare("SELECT now AS now FROM clock WHERE id = 1").first<{ now: string }>();
  if (row === null) {
    throw new Error("clock: no row with id = 1 — apply the migrations before reading the clock");
  }
  return toUtcIso(parseIso(row.now));
}

/** Move the clock forward (or back, for a negative `hours`) and return the new time. */
export async function advanceHours(env: DbEnv, hours: number): Promise<string> {
  if (!Number.isFinite(hours)) {
    throw new RangeError(`clock.advanceHours: hours must be finite, got ${String(hours)}`);
  }
  const current = parseIso(await now(env));
  const shifted = toUtcIso(new Date(current.getTime() + hours * 3_600_000));
  await env.DB.prepare("UPDATE clock SET now = ?, offset_h = offset_h + ? WHERE id = 1").bind(shifted, hours).run();
  return shifted;
}

/** Pin the clock to an exact instant. `demoReset` uses this to return to the seed scenario's `now`. */
export async function setNow(env: DbEnv, iso: string): Promise<string> {
  const normalised = toUtcIso(parseIso(iso));
  const result = await env.DB.prepare("UPDATE clock SET now = ? WHERE id = 1").bind(normalised).run();
  if (!result.success) {
    throw new Error("clock.setNow: no clock row to update — apply the migrations first");
  }
  return normalised;
}