/**
 * Open-Meteo weather client — daily FAO-56 reference evapotranspiration and rainfall for the canal
 * command area (`docs/research/voice-and-data.md` §7, `ADR-003`).
 *
 * WHY THIS MODULE NEVER FAILS: the crop engine, the roster and the rain re-plan all read weather.
 * During a live demo, on a judge's laptop, or in CI there may be no egress at all, so a forecast
 * outage must not take the allocation engine down with it. **Every** failure path — invalid
 * coordinates, transport throw, deadline expiry, non-2xx, non-JSON, a missing or short `daily` block,
 * or a day that fails `WeatherDay.parse` — falls back to the bundled snapshot in
 * `packages/contracts/fixtures/demo-weather.json`. `getForecast` therefore always resolves a
 * `WeatherDay[]`, and it never throws.
 *
 * Callers that must distinguish live data from the snapshot compare the returned `date` values
 * against the wall clock, or watch for `env.calls` in tests; there is deliberately no flag on the
 * return type, because adding one would put a "is this real?" boolean into every downstream
 * signature for information only the caller log needs.
 *
 * The request is byte-for-byte §7.2/§7.3: the ordered `daily` list and `timezone=Asia/Kolkata` are
 * both load-bearing — the list decides which series arrive, and the timezone decides where the day
 * boundary falls, so a UTC-aligned forecast would shift ET₀ onto the wrong irrigation day.
 */

import { WeatherDay } from "@jadal/contracts";

import demoWeather from "../../../../packages/contracts/fixtures/demo-weather.json";
import { effectiveRain_mm } from "../core-shim";
import { fetchWithDeadline, type ProviderRequest } from "./sarvam";
import type { ProviderEnv } from "../system1";

export { effectiveRain_mm };

/* ------------------------------------------------------------------ parameters */

/** §7.1 — the Krishna Western Delta / Guntur command area. */
export const GUNTUR = { lat: 16.3067, lon: 80.4365 } as const;
/** §7.1 — the Tungabhadra HLC / Anantapur command area. */
export const ANANTAPUR = { lat: 14.6819, lon: 77.6006 } as const;

export const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";

/**
 * The `daily` series, in exactly the order §7.2 specifies.
 *
 * Two of these are fetched but not mapped onto `WeatherDay`, and that is deliberate rather than
 * forgotten:
 *   * `rain_sum` excludes snowfall while `precipitation_sum` is all precipitation. §8.2 maps
 *     `rain_mm` from `precipitation_sum`, and §7.4's re-plan trigger also reads
 *     `precipitation_sum`, so `precipitation_sum` is the number the crop engine must see.
 *   * `precipitation_probability_max` is a forecast confidence, not a depth.
 * Both stay in the query string because §7.3's verified request asks for them, and dropping a
 * parameter from this list would make the URL diverge from the one in the research doc for no gain.
 * Carrying them in the response needs a `WeatherDay` change in `packages/contracts`, which is not
 * this task's to make.
 */
export const DAILY_SERIES: readonly string[] = [
  "et0_fao_evapotranspiration",
  "precipitation_sum",
  "rain_sum",
  "precipitation_probability_max",
  "temperature_2m_max",
  "temperature_2m_min",
];

/** §7.2 — a fixed offset, so day boundaries land on IST midnight (GMT+05:30, no DST, ever). */
export const TIMEZONE = "Asia/Kolkata";

/** ASSUMED: §7.2 leaves `forecast_days` optional and the tool contract
 *  (`toolSpecs.weather_forecast`) caps the input at 16. One week is the default because the
 *  irrigation week is the unit everything is balanced in. */
export const DEFAULT_FORECAST_DAYS = 7;
export const MIN_FORECAST_DAYS = 1;
/** Ceiling from `toolSpecs.weather_forecast`: `days: z.number().int().max(16)`. */
export const MAX_FORECAST_DAYS = 16;

/** §7.1 gives no timeout; 6 s is well inside a synchronous request budget and well outside the
 *  usual Open-Meteo round trip. */
export const FORECAST_TIMEOUT_MS = 6000;

/**
 * Rain re-planning trigger (`docs/research/voice-and-data.md` §7.4 item 4).
 *
 * "If Open-Meteo reports `precipitation_sum >= 15.0 mm` within the 24-hour forecast window, Jadal
 * triggers an Agentic Rain Re-planning Event": upcoming turns are deferred, the saved volume moves
 * to the common buffer pool, and affected farmers are told their quota is safe.
 *
 * The threshold is a single named constant on purpose — it is a *policy* threshold quoted from the
 * research, not water arithmetic, and the comparison itself belongs to whichever agent owns the
 * re-plan (the need or auditor agent), not to this client.
 */
export const rainTriggerMm = 15;

/* ------------------------------------------------------------------ request */

/**
 * Build the §7.2 request URL.
 *
 * The query string is concatenated by hand rather than through `URLSearchParams`, which would
 * percent-encode the commas in `daily` into `%2C`. Both forms are legal and Open-Meteo accepts
 * either, but the literal-comma form is byte-identical to the verified curl in §7.3, so a failing
 * call can be reproduced by pasting the string from `env.calls` straight into a terminal.
 */
export function buildForecastUrl(lat: number, lon: number, days: number): string {
  const query = [
    `latitude=${lat}`,
    `longitude=${lon}`,
    `daily=${DAILY_SERIES.join(",")}`,
    `timezone=${TIMEZONE}`,
    `forecast_days=${days}`,
  ].join("&");
  return `${OPEN_METEO_URL}?${query}`;
}

/** Clamp `days` into the tool contract's range. Non-numeric input falls back to the default. */
export function clampForecastDays(days: number): number {
  if (!Number.isFinite(days)) return DEFAULT_FORECAST_DAYS;
  return Math.min(MAX_FORECAST_DAYS, Math.max(MIN_FORECAST_DAYS, Math.round(days)));
}

/* ------------------------------------------------------------------ response mapping */

/** Finite number, or `undefined`. Open-Meteo sends `null` for an aggregate it could not compute. */
function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Finite, non-negative number, or `0`.
 *
 *  ASSUMED: Open-Meteo returns `null` for `et0_fao_evapotranspiration` or `precipitation_sum` only
 *  when the underlying model data for that day is missing. `WeatherDay` requires a number for both,
 *  so a gap is read as 0 mm: a missing ET₀ becomes a zero-demand day (the auditor agent sees a run
 *  of zero weeks and can flag it) and a missing rainfall becomes no effective rain, which is the
 *  conservative direction for scheduling but never a fabricated depth. */
function millimetres(value: unknown): number {
  const parsed = finiteOrUndefined(value);
  return parsed === undefined || parsed < 0 ? 0 : parsed;
}

/** Read one parallel series out of the `daily` block; `[]` when it is absent. */
function series(daily: Record<string, unknown>, key: string): unknown[] {
  const value = daily[key];
  return Array.isArray(value) ? value : [];
}

/**
 * Map an Open-Meteo envelope onto `WeatherDay[]`, or `null` if the envelope is not usable.
 *
 * `null` means "fall back to the snapshot", which is why a truncated `daily` block is not padded or
 * interpolated: a forecast that stops halfway through the week would otherwise balance half a week
 * of ET₀ against half a week of nothing.
 */
function mapDaily(payload: unknown): WeatherDay[] | null {
  if (typeof payload !== "object" || payload === null) return null;
  const daily = (payload as { daily?: unknown }).daily;
  if (typeof daily !== "object" || daily === null) return null;

  const block = daily as Record<string, unknown>;
  const dates = series(block, "time");
  if (dates.length === 0) return null;

  const et0 = series(block, "et0_fao_evapotranspiration");
  const rain = series(block, "precipitation_sum");
  const tmax = series(block, "temperature_2m_max");
  const tmin = series(block, "temperature_2m_min");

  const candidates: unknown[] = [];
  for (let i = 0; i < dates.length; i += 1) {
    const day: Record<string, unknown> = {
      date: dates[i],
      et0_mm: millimetres(et0[i]),
      rain_mm: millimetres(rain[i]),
    };
    const high = finiteOrUndefined(tmax[i]);
    const low = finiteOrUndefined(tmin[i]);
    if (high !== undefined) day["tmax_c"] = high;
    if (low !== undefined) day["tmin_c"] = low;
    candidates.push(day);
  }

  // The contract is the authority: one day outside `WeatherDay` rejects the whole feed.
  const parsed = WeatherDay.array().safeParse(candidates);
  return parsed.success ? parsed.data : null;
}

/* ------------------------------------------------------------------ offline snapshot */

/**
 * The bundled snapshot, `packages/contracts/fixtures/demo-weather.json`, parsed and sorted by date.
 *
 * Imported rather than inlined so the fixture stays the single source of truth (Wrangler bundles the
 * JSON; vitest resolves it through the workspace symlink). Unparseable days are dropped rather than
 * throwing: this is the last line of defence for every caller, and a corrupt build asset must not
 * turn a forecast outage into a 500. `voice.test.ts` asserts this returns all 21 fixture days, so a
 * corrupt asset fails the test suite loudly instead of degrading silently in production.
 *
 * This function is the documented offline fallback — see the module header for when it is used.
 */
export function loadDemoWeather(): WeatherDay[] {
  const days = demoWeather.days;
  const parsed: WeatherDay[] = [];
  for (const day of days) {
    const candidate = WeatherDay.safeParse(day);
    if (candidate.success) parsed.push(candidate.data);
  }
  return parsed.sort((a, b) => a.date.localeCompare(b.date));
}

/* ------------------------------------------------------------------ public API */

/**
 * Daily forecast for one command-area coordinate.
 *
 * No AI Gateway prefix here, unlike `./sarvam`: ADR-001 puts AI Gateway in front of *model* calls,
 * and Open-Meteo is a keyless public weather API that Cloudflare's gateway does not proxy. Call
 * before this one goes out through an egress-restricted deployment.
 *
 * @param lat Latitude. Anything outside ±90° is treated as a failure and yields the snapshot.
 * @param lon Longitude. Anything outside ±180° likewise.
 * @param days Lookahead, clamped to 1–16 (`toolSpecs.weather_forecast`).
 * @returns A validated `WeatherDay[]` — from Open-Meteo, or from {@link loadDemoWeather} on any
 *   failure. Never throws and never returns a partially-mapped array.
 */
export async function getForecast(
  env: Pick<ProviderEnv, "fetch">,
  lat: number,
  lon: number,
  days: number = DEFAULT_FORECAST_DAYS,
): Promise<WeatherDay[]> {
  const snapshot = (): WeatherDay[] => loadDemoWeather();
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return snapshot();
  }

  const horizon = clampForecastDays(days);
  const request: ProviderRequest = {
    // Open-Meteo's free tier needs no key, so there is no gateway-prefix concern here beyond ADR-001.
    url: buildForecastUrl(lat, lon, horizon),
    method: "GET",
    headers: { accept: "application/json" },
    timeoutMs: FORECAST_TIMEOUT_MS,
  };

  let response: Response | null;
  try {
    response = await fetchWithDeadline(env, request);
  } catch {
    return snapshot();
  }
  if (response === null || !response.ok) return snapshot();

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return snapshot();
  }

  return mapDaily(payload) ?? snapshot();
}