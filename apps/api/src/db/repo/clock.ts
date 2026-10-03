/**
 * Clock and weather queries.
 *
 * The clock is the simulated current time the demo panel and tests read; the weather is the cached
 * daily series the crop engine and the portal read.
 */

import { WeatherDay } from "@jadal/contracts/entities";
import { resultRows, type DbEnv } from "../store";
import { withOptional } from "./shared";

interface ClockRow {
  now: string;
}

interface WeatherRow {
  date: string;
  et0_mm: number;
  rain_mm: number;
  tmax_c: number | null;
  tmin_c: number | null;
}

function toWeatherDay(row: WeatherRow): WeatherDay {
  return WeatherDay.parse(
    withOptional(
      withOptional(
        { date: row.date, et0_mm: row.et0_mm, rain_mm: row.rain_mm },
        "tmax_c",
        row.tmax_c,
      ),
      "tmin_c",
      row.tmin_c,
    ),
  );
}

/**
 * The simulated current time, normalised to an ISO-8601 UTC instant, or `null` if no clock row exists.
 *
 * `db/clock.ts` owns moving the clock and throws when the row is missing, because a route that
 * stamps an event with no clock is a real failure. This is the read counterpart used by the demo
 * panel and by tests, where "no migrations applied yet" is a legitimate state to observe rather than
 * an error, so it answers `null`.
 */
export async function getClockNow(env: DbEnv): Promise<string | null> {
  const row = await env.DB.prepare("SELECT now FROM clock WHERE id = 1").first<ClockRow>();
  if (row === null) return null;
  const parsed = new Date(row.now);
  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError(`clock.now is not an ISO-8601 instant: ${JSON.stringify(row.now)}`);
  }
  return parsed.toISOString();
}

/**
 * Cached weather for a canal, from `fromDate` onwards, at most `days` rows.
 *
 * `days` is a cap rather than a window width on purpose: it is a LIMIT, so a canal with a gap in its
 * cached series returns the days it does have instead of silently shifting the window to fill the
 * hole. Callers that need a dense series (the crop engine's weekly balance) supply their own slice.
 *
 * A non-positive or non-finite `days` yields `[]` instead of a SQLite error, since "no days" is a
 * meaningful answer for a caller computing a window that falls outside the cached range.
 */
export async function getWeather(env: DbEnv, canalId: string, fromDate: string, days: number): Promise<WeatherDay[]> {
  if (!Number.isFinite(days) || days <= 0) return [];
  const take = Math.floor(days);
  const rows = resultRows(
    await env.DB.prepare(
      `SELECT * FROM weather_day
       WHERE canal_id = ? AND date >= ?
       ORDER BY date ASC
       LIMIT ?`,
    )
      .bind(canalId, fromDate, take)
      .all<WeatherRow>(),
  );
  return rows.map(toWeatherDay);
}
