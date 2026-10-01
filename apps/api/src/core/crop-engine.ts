/**
 * The crop-need engine: FAO-56 Eq. 66 Kc curve, Eq. 58 ETc, USDA-SCS effective rain, and the
 * weekly field-gate volume. Implements the `CropEngine` interface from `@jadal/contracts/core`.
 *
 * Every function here is a pure function of its arguments. There is no `Date.now()`, no clock, no
 * I/O: the same input object always produces a byte-identical output object, which is what lets the
 * ledger re-derive need from the event log months later.
 *
 * Chain of equations per day (FAO-56 §4):
 *   1. `Kc,i`      Eq. 66 piecewise-linear from stage lengths (§4.3).
 *   2. `ETc,i`     Eq. 58, `Kc,i · ET₀,i` (§4.1).
 *   3. `Peff,i`    USDA-SCS daily effective rain (docs/research/voice-and-data.md §7.4) — an ASSUMED
 *                  project rule, NOT an FAO-56 equation; see `effectiveRain_mm`.
 *   4. `I_net`     `max(0, Σ(ETc + PERC) − Σ Peff)` over the week; PERC only for paddy (§2.6).
 *   5. `I_gross`   `I_net / Ea` (§2.6).
 *   6. `V`         `I_gross · A · area_fraction · 10` m³ (FAO-56 Table 1, p. 15 — 1 mm over 1 ha = 10 m³).
 */

import type { CropEngine, WeeklyNeed } from "@jadal/contracts";
import type { CropParams, WeatherDay } from "@jadal/contracts";

import type { GrowthStage } from "./crop-params";
import { rootingDepthAtDay, seasonLengthDays, stageEndDays } from "./crop-params";
import { dynamicDepletionFraction, readilyAvailableWater, soilAvailableWater_mm } from "./soil";
import { mmHaToM3, round } from "./units";

const MS_PER_DAY = 86_400_000;
/** A weekly need is a 7-day balance; longer weather arrays are truncated to their first week. */
export const DAYS_PER_WEEK = 7;
/** Index into a 7-day week used to name the week when the week spans two stages (see `weeklyNeed`). */
const MID_WEEK_INDEX = 3;

/* ------------------------------------------------------------------ date helpers */

/** Parse a strict `YYYY-MM-DD` date to epoch ms, or NaN. Date-only strings must not go through
 *  `new Date(...)`, whose behaviour on a bare date is UTC but whose behaviour on anything else is
 *  host-local — a determinism hazard. */
function isoToMs(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return Number.NaN;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return Number.NaN;
  return Date.UTC(year, month - 1, day);
}

/** Epoch ms → `YYYY-MM-DD`, always in UTC. */
function msToIso(ms: number): string {
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
  const mm = d.getUTCMonth() + 1;
  const dd = d.getUTCDate();
  return `${yyyy}-${mm.toString().padStart(2, "0")}-${dd.toString().padStart(2, "0")}`;
}

/** Whole days from `fromIso` to `toIso`; NaN if either is not a `YYYY-MM-DD` date. */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = isoToMs(fromIso);
  const b = isoToMs(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
  return Math.round((b - a) / MS_PER_DAY);
}

function addDays(iso: string, days: number): string {
  const base = isoToMs(iso);
  if (!Number.isFinite(base)) {
    throw new RangeError(`expected a YYYY-MM-DD date, got ${JSON.stringify(iso)}`);
  }
  return msToIso(base + days * MS_PER_DAY);
}

/* ------------------------------------------------------------------ effective rain */

/**
 * Daily effective rainfall, USDA Soil Conservation Service method, as specified in
 * `docs/research/voice-and-data.md` §7.4:
 *
 *   `Peff = 0`                              if `P ≤ 5 mm`   (intercepts and evaporates)
 *   `Peff = (P − 5) · 0.75`                 if `P ≤ 50 mm`
 *   `Peff = 0.70 · P`                       if `P > 50 mm`
 *
 * ASSUMED: this is **not** an FAO-56 equation. `docs/research/fao56-book-reference.md` records the
 * explicit finding that FAO-56 does not prescribe an empirical effective-rain equation, and under a
 * strict FAO-56 balance `P_eff` would instead be `(P − RO) − DP` computed from the daily root-zone
 * store. The SCS curve is adopted because it is the rule the project documents specify for the
 * Open-Meteo path and it is closed-form (no ponded-depth state to carry). Note it is a different
 * rule from the `0.8·(P − 3 mm)` heuristic in `docs/research/fao56-model.md` §2.4, which is
 * superseded here by §7.4 of the data doc.
 */
export function effectiveRain_mm(dailyRain_mm: number): number {
  const p = Number.isFinite(dailyRain_mm) ? Math.max(0, dailyRain_mm) : 0;
  if (p <= 5) return 0;
  if (p <= 50) return (p - 5) * 0.75;
  return 0.7 * p;
}

/* ------------------------------------------------------------------ engine */

/** Validated, cached shape of a week's weather slice. */
interface DaySample {
  readonly daysAfterSowing: number;
  readonly et0_mm: number;
  readonly rain_mm: number;
}

/** Resolve each weather day to a days-after-sowing index, falling back to position if a date is unusable. */
function sampleDays(input: {
  sowing_date: string;
  weekStart: string;
  weather: readonly WeatherDay[];
  limit: number;
}): DaySample[] {
  const sowing = isoToMs(input.sowing_date);
  const anchor = isoToMs(input.weekStart);
  const out: DaySample[] = [];
  for (let i = 0; i < input.weather.length && i < input.limit; i += 1) {
    const day = input.weather[i];
    if (!day) continue;
    const own = isoToMs(day.date);
    const dayMs = Number.isFinite(own) ? own : anchor + i * MS_PER_DAY;
    const das = Number.isFinite(dayMs) && Number.isFinite(sowing)
      ? Math.round((dayMs - sowing) / MS_PER_DAY)
      : i;
    out.push({
      daysAfterSowing: das,
      et0_mm: Number.isFinite(day.et0_mm) ? Math.max(0, day.et0_mm) : 0,
      rain_mm: Number.isFinite(day.rain_mm) ? Math.max(0, day.rain_mm) : 0,
    });
  }
  return out;
}

function assertPositive(value: number, what: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${what} must be a positive finite number, got ${String(value)}`);
  }
}

export const cropEngine: CropEngine = {
  /**
   * Daily crop coefficient and growth stage, FAO-56 Eq. 66 (§4.3).
   *
   * The piecewise curve is indexed on `i`, the day number of the growing season, `1 ≤ i ≤ L_total`.
   * `daysAfterSowing` is that day number, so `daysAfterSowing = 1` is the first day after sowing.
   * Two edges are pinned deliberately:
   *  * `daysAfterSowing ≤ 0` — the sowing date itself and anything earlier: the canopy has not
   *    emerged, so `Kc_ini` and stage `ini` (FAO-56 does not define Kc for i < 1; the initial-stage
   *    coefficient is the correct physical floor because it is dominated by soil evaporation).
   *  * `daysAfterSowing > L_total` — past harvest: stage `done`, `Kc_end`.
   * Zero-length stages cannot divide, so a zero `L_dev` or `L_late` jumps straight to the next
   * stage's coefficient instead of producing NaN.
   */
  kcOnDay(params, daysAfterSowing) {
    const total = seasonLengthDays(params);
    if (!Number.isFinite(daysAfterSowing) || daysAfterSowing <= 0) {
      return { kc: params.kc_ini, stage: "ini" };
    }
    if (daysAfterSowing > total) {
      return { kc: params.kc_end, stage: "done" };
    }
    const ends = stageEndDays(params);
    const { stage_days: s } = params;
    if (daysAfterSowing <= ends.ini) {
      return { kc: params.kc_ini, stage: "ini" };
    }
    if (daysAfterSowing <= ends.dev) {
      if (s.dev <= 0) return { kc: params.kc_mid, stage: "mid" };
      const frac = (daysAfterSowing - ends.ini) / s.dev;
      return { kc: params.kc_ini + frac * (params.kc_mid - params.kc_ini), stage: "dev" };
    }
    if (daysAfterSowing <= ends.mid) {
      return { kc: params.kc_mid, stage: "mid" };
    }
    if (daysAfterSowing <= ends.late) {
      if (s.late <= 0) return { kc: params.kc_end, stage: "done" };
      const frac = (daysAfterSowing - ends.mid) / s.late;
      return { kc: params.kc_mid + frac * (params.kc_end - params.kc_mid), stage: "late" };
    }
    return { kc: params.kc_end, stage: "done" };
  },

  /**
   * One week's field-gate need for one crop plan.
   *
   * Only the first seven weather days are used — this is a *weekly* balance, so handing it a longer
   * forecast truncates rather than silently turning into a fortnight. Days outside the season
   * (`daysAfterSowing < 0`, i.e. the crop is not yet in the ground, or `> L_total`, i.e. it has been
   * harvested) contribute zero: nothing is transpiring and nothing is standing to percolate.
   *
   * `stage` and `kc` name the week by its **mid-week** day (index 3 of 0–6). FAO-56's Kc curve is
   * continuous and a week normally straddles two stages; naming the middle day reports the stage
   * that occupies most of the week, and reporting it this way keeps the field `stage`/`kc` pair
   * mutually consistent (they come from one call), which matters because the need agent shows them
   * side by side in the explanation.
   *
   * `bounds` are the per-irrigation-event root-zone limits (contract `WeeklyNeed.bounds`):
   *  * `raw_mm`    — FAO-56 §4.5.2, `p · TAW`. The depletion fraction is the *dynamic* one
   *                  (`soil.ts`), i.e. Table 22's p corrected for this week's mean ETc and the
   *                  plot's texture, because Table 22's p is only valid at ETc ≈ 5 mm d⁻¹.
   *  * `taw_mm`    — Eq. 82, Table 19 available water × rooting depth on the mid-week day (§4.5.1).
   *  * `event_refill_m3` — RAW as a volume over the plot area, i.e. the smallest sensible single
   *                  event: applying less wets only the topsoil and evaporates before it reaches
   *                  the roots (docs/research/fao56-model.md §4.1). Note this is a **net depth**
   *                  converted at the field gate; application losses are carried separately by
   *                  `gross_irrigation_mm`, which divides by `Ea`. The scheduler must therefore
   *                  not divide `event_refill_m3` by `Ea` a second time.
   *  * `event_cap_m3` — the most that can still be stored productively. `min(TAW, remaining need)`,
   *                  where the remaining need from the RAW trigger to the end of the week is
   *                  `RAW + I_net` (refill the stress threshold, then cover this week). Anything
   *                  beyond TAW drains below the root zone as deep percolation (Eq. 88) and is a
   *                  wasted turn; anything beyond the week's need is water the crop will not use
   *                  this season. ASSUMED: the contract gives `weeklyNeed` no season context, so
   *                  "remaining season need" is approximated by this week's outstanding need — the
   *                  scheduler cannot see further ahead from a single week.
   *
   * `bounds` is `null` for rice. A ponded paddy is not bounded by root-zone storage: its ceiling is
   * the bund spillway crest and its floor is "keep the surface wet", both of which need the ponded
   * water depth — a state the contract has nowhere to carry. Emitting soil bounds for a paddy would
   * be misleading, so upland-only is the honest answer and matches
   * `docs/research/fao56-model.md` §4.2 ("rice is not bounded by TAW because the field is
   * intentionally ponded").
   */
  weeklyNeed(input): WeeklyNeed {
    const { plan, plot, params, weather, weekStart } = input;
    assertPositive(plot.area_ha, "plot.area_ha");
    assertPositive(plan.application_efficiency, "plan.application_efficiency");
    if (!Number.isFinite(plan.area_fraction) || plan.area_fraction <= 0 || plan.area_fraction > 1) {
      throw new RangeError(
        `plan.area_fraction must lie in (0, 1], got ${String(plan.area_fraction)}`,
      );
    }

    const isPaddy = plan.crop === "rice";
    const percPerDay = isPaddy ? (params.percolation_mm_day ?? 0) : 0;
    const total = seasonLengthDays(params);
    const samples = sampleDays({
      sowing_date: plan.sowing_date,
      weekStart,
      weather,
      limit: DAYS_PER_WEEK,
    });

    let etc_mm = 0;
    let percolation_mm = 0;
    let midDay = 0;
    samples.forEach((s, index) => {
      const inSeason = s.daysAfterSowing >= 0 && s.daysAfterSowing <= total;
      if (index === MID_WEEK_INDEX) midDay = s.daysAfterSowing;
      if (!inSeason) return;
      const { kc } = cropEngine.kcOnDay(params, s.daysAfterSowing);
      etc_mm += kc * s.et0_mm;
      if (isPaddy) percolation_mm += percPerDay;
    });

    const effectiveRain = samples.reduce((sum, s) => sum + effectiveRain_mm(s.rain_mm), 0);
    const losses = etc_mm + percolation_mm;
    // `docs/research/fao56-model.md` §7 invariant: a wet week needs nothing, not a negative amount.
    const net = Math.max(0, losses - effectiveRain);
    const gross = net / plan.application_efficiency;
    const areaHa = plot.area_ha * plan.area_fraction;
    const volume = mmHaToM3(gross, areaHa);

    let bounds: WeeklyNeed["bounds"] = null;
    if (!isPaddy) {
      // The depletion fraction is tabulated at ETc ≈ 5 mm/d; correct it for this week's actual demand.
      const daysForMean = Math.max(1, samples.length);
      const meanEtc = etc_mm / daysForMean;
      const rootDepth = rootingDepthAtDay(params, midDay);
      const taw = soilAvailableWater_mm(plot.soil, rootDepth);
      const p = dynamicDepletionFraction({ p_table: params.depletion_p, etc_mm_day: meanEtc, soil: plot.soil });
      const raw = readilyAvailableWater(p, taw);
      const capMm = Math.min(taw, raw + net);
      bounds = {
        raw_mm: round(raw),
        taw_mm: round(taw),
        event_refill_m3: round(mmHaToM3(raw, areaHa)),
        event_cap_m3: round(mmHaToM3(capMm, areaHa)),
      };
    }

    const { kc, stage } = cropEngine.kcOnDay(params, midDay);
    return {
      crop_plan_id: plan.id,
      week_start: weekStart,
      etc_mm: round(etc_mm),
      effective_rain_mm: round(effectiveRain),
      net_irrigation_mm: round(net),
      gross_irrigation_mm: round(gross),
      volume_m3: round(volume),
      bounds,
      stage,
      kc: round(kc),
    };
  },

  /**
   * Season total by walking whole weeks from the sowing date to harvest.
   *
   * `weather` is indexed by date, not by position, so a forecast that starts mid-season still lines
   * up with the right week. Weeks are laid on a 7-day grid anchored at `sowing_date` and the final
   * week is shortened implicitly: `weeklyNeed` balances whatever days it is given.
   *
   * Guard for a forecast shorter than the season: a week with no matching weather is still emitted,
   * with zero demand, so `total_m3` always describes the whole season and the shortfall in the
   * forecast is visible as a run of zero-demand weeks instead of a silently truncated total. A
   * `weather` array shorter than the season is therefore not an error.
   */
  seasonNeed(input): { weeks: WeeklyNeed[]; total_m3: number } {
    const { plan, plot, params, weather } = input;
    const byDate = new Map<string, WeatherDay>();
    for (const day of weather) {
      if (day && Number.isFinite(isoToMs(day.date))) byDate.set(day.date, day);
    }
    const total = seasonLengthDays(params);
    const weekCount = Math.ceil(total / DAYS_PER_WEEK);
    const weeks: WeeklyNeed[] = [];
    let totalM3 = 0;
    for (let w = 0; w < weekCount; w += 1) {
      const weekStart = addDays(plan.sowing_date, w * DAYS_PER_WEEK);
      const slice: WeatherDay[] = [];
      for (let d = 0; d < DAYS_PER_WEEK; d += 1) {
        const iso = addDays(weekStart, d);
        const day = byDate.get(iso);
        if (day) slice.push(day);
      }
      const need = cropEngine.weeklyNeed({ plan, plot, params, weather: slice, weekStart });
      totalM3 += need.volume_m3;
      weeks.push(need);
    }
    return { weeks, total_m3: round(totalM3) };
  },
};

/** Growth-stage label for a day — exported so callers can group weeks by stage without duplicating. */
export function stageOnDay(params: CropParams, daysAfterSowing: number): GrowthStage {
  return cropEngine.kcOnDay(params, daysAfterSowing).stage;
}