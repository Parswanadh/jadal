import type {
  CropEngine,
  WeeklyNeed,
  CropParams,
  CropPlan,
  Plot,
  WeatherDay,
  SoilType,
} from '@jadal/contracts';

/**
 * Available soil water capacity (theta_FC - theta_WP), the volumetric fraction of water a soil
 * holds between field capacity and permanent wilting point [m3/m3, dimensionless].
 *
 * SOURCE (MEASURED): FAO-56 Rev.1 (2025) **Table 7.5**, "Typical soil water characteristics for
 * different soil types", p. 232 — verified in the unabridged 2025 text at
 * `.ref/fao56-book/FAO56-full.txt` lines 16112-16131. Table 7.5 gives a RANGE per texture class;
 * the value below is the RANGE MIDPOINT, which is a derivation of ours, not a tabulated number.
 * The "mm/m" figures in the comments are the same ranges x 1000 (1 m3/m3 over 1 m depth = 1000 mm).
 *
 * MEASURED ranges from Table 7.5 (theta_FC - theta_WP, m3/m3):
 *   sand 0.05-0.11 | loamy sand 0.06-0.12 | sandy loam 0.11-0.15 | loam 0.13-0.18
 *   silt loam 0.13-0.19 | silt 0.16-0.20 | silt clay loam 0.13-0.18 | silty clay 0.13-0.19
 *   clay 0.12-0.20
 *
 * ASSUMED: `clay_loam` has NO row in Table 7.5 (the nearest classes are "silt clay loam" and
 * "clay"); its value is interpolated by us and is not a sourced number.
 * ASSUMED: `sandy_loam` is documented in the project as the "Chalka red soil in AP" and `clay` as
 * the AP "Black Vertisol" — that soil-order mapping is a project statement, not an FAO-56 one.
 */
export const SOIL_AVAILABLE_WATER: Record<SoilType, number> = {
  sand: 0.08, // MEASURED midpoint of 0.05-0.11
  loamy_sand: 0.09, // MEASURED midpoint of 0.06-0.12
  sandy_loam: 0.13, // MEASURED midpoint of 0.11-0.15 (Chalka red soil in AP — ASSUMED mapping)
  loam: 0.155, // MEASURED midpoint of 0.13-0.18
  silt_loam: 0.16, // MEASURED midpoint of 0.13-0.19
  clay_loam: 0.15, // ASSUMED — Table 7.5 has no "clay loam" row; interpolated between silt clay loam and clay
  clay: 0.16, // MEASURED midpoint of 0.12-0.20 (Black Vertisol in AP — ASSUMED mapping)
};

/**
 * ASSUMED: daily rainfall at or below this depth is treated as intercepted/evaporated and
 * contributes nothing to the root zone. This is a project rule, NOT an FAO-56 equation —
 * `docs/research/fao56-model.md` §2.4 step 1 (and its orchestrator note 3, which records that the
 * whole upland effective-rainfall rule is an ASSUMED project rule). See `UPLAND_RAIN_CAPTURE`.
 */
export const RAIN_ABSTRACTION_MM = 3.0;

/**
 * ASSUMED: fraction of the rainfall in excess of {@link RAIN_ABSTRACTION_MM} that infiltrates the
 * root zone. Project rule from `docs/research/fao56-model.md` §2.4 step 2; not an FAO-56 constant.
 */
export const UPLAND_RAIN_CAPTURE = 0.8;

/**
 * ASSUMED: default paddy percolation through the puddled plow-pan [mm/day] when a crop-params row
 * does not carry `percolation_mm_day`. Project default (ANGRAU experimental baseline per
 * `packages/core/README.md` §6). NOT FOUND in FAO-56: the 2025 text uses "percolation" only for
 * deep percolation below the root zone, and tabulates no paddy percolation rate.
 */
export const DEFAULT_PADDY_PERCOLATION_MM_DAY = 3.5;

/**
 * ASSUMED: fallback mean daily ETc [mm/day] used to adjust the depletion fraction p when the
 * weather window is empty. Chosen equal to the 5 mm/day reference at which FAO-56 Table 8.1-8.4
 * tabulate p, so the adjustment term is exactly zero and p is returned unmodified.
 */
export const REFERENCE_ETC_MM_DAY = 5.0;

/**
 * Parses an ISO date string (YYYY-MM-DD) into UTC timestamp.
 */
function parseDateUtc(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

/**
 * Calculates calendar day difference between two dates (to - from).
 */
function daysBetween(fromIso: string, toIso: string): number {
  const MS_PER_DAY = 86_400_000;
  return Math.round((parseDateUtc(toIso) - parseDateUtc(fromIso)) / MS_PER_DAY);
}

/**
 * FAO-56 Rev.1 (2025) Eq. 6.18 / Eq. 6.21 climatic adjustment to Kc mid and Kc end.
 *
 *   Kc = Kc(Tab) + [ 0.04 (u2 - 2) - 0.004 (RHmin - 45) ] (h/3)^0.3
 *
 * SOURCE: `docs/research/fao56-crop-tables.md` §4.2.1 (Eq. 62 of the 1998 edition = Eq. 6.18 of
 * the 2025 edition) and §4.2.2 (Eq. 65 of 1998 = Eq. 6.21 of 2025). The tabulated Kc values in
 * Table 6.2 hold only for the standardized sub-humid climate (RHmin ~ 45%, u2 ~ 2 m/s); outside it
 * they must be adjusted. Verified against the 2025 text in `.ref/fao56-book/FAO56-full.txt`
 * (Table 6.2 caption, line 11926: "in the standardized subhumid climate (RHmin ~ 45%, u2 ~ 2 m s-1)").
 *
 * Validity domain, from `docs/research/fao56-crop-tables.md` §4.2.1:
 *   1 m/s <= u2 <= 6 m/s;  20% <= RHmin <= 80%;  0.1 m <= h <= 10 m.
 * Outside that box the adjustment is not defined by the source. We do NOT extrapolate: when any
 * input is missing or out of range this returns the tabulated Kc unchanged, which is the
 * documented conservative choice. Pass `null` for either climate input to skip the adjustment.
 *
 * @param kcTab        Tabulated Kc (mid or end) from Table 6.2 [dimensionless]
 * @param maxHeight_m  Maximum crop height h from Table 6.2 [m]
 * @param u2_ms        Mean wind speed at 2 m [m/s], or null when unknown
 * @param rhMin_pct    Mean minimum relative humidity [%], or null when unknown
 * @returns Adjusted Kc [dimensionless]
 */
export function adjustKcForClimate(
  kcTab: number,
  maxHeight_m: number,
  u2_ms: number | null | undefined,
  rhMin_pct: number | null | undefined,
): number {
  if (u2_ms === null || u2_ms === undefined || rhMin_pct === null || rhMin_pct === undefined) {
    return kcTab;
  }
  if (!Number.isFinite(u2_ms) || !Number.isFinite(rhMin_pct) || !Number.isFinite(maxHeight_m)) {
    return kcTab;
  }
  if (u2_ms < 1 || u2_ms > 6 || rhMin_pct < 20 || rhMin_pct > 80) {
    return kcTab;
  }
  // `(h/3)^0.3` is only meaningful for a positive height; the source bounds h to 0.1-10 m.
  const h = Math.min(10, Math.max(0.1, maxHeight_m));
  const adjustment = (0.04 * (u2_ms - 2) - 0.004 * (rhMin_pct - 45)) * Math.pow(h / 3, 0.3);
  return kcTab + adjustment;
}

/**
 * FAO-56 Eq. 6.21 (1998 Eq. 65) is applied to Kc end **only** when the tabulated Kc end exceeds
 * 0.45 — crops harvested green or with residual canopy cover. For grain crops allowed to dry in
 * the field (Kc end <= 0.45) the source prescribes NO adjustment.
 *
 * SOURCE: `docs/research/fao56-crop-tables.md` §4.2.2, "Governing Rule".
 */
export const KC_END_ADJUSTMENT_THRESHOLD = 0.45;

export const cropEngine = {
  /**
   * Kc for a given day after sowing (FAO-56 piecewise-linear curve, Eq. 6.20 / Eq. 66).
   *
   * Stage boundaries (t = days after sowing, t = 0 is the sowing day):
   *   t1 = L_ini                     t2 = t1 + L_dev
   *   t3 = t2 + L_mid                t4 = t3 + L_late = L_total
   *
   * Boundary behaviour:
   *  * `t <= 0` (sowing day and before) returns `kc_ini`, stage `ini`. The source curve is defined
   *    for day 1..L_total after sowing; we extend it backwards as a flat Kc_ini so that a plan
   *    evaluated before sowing yields the initial-stage coefficient rather than a discontinuity.
   *  * `t <= t1` returns `kc_ini` / `ini`; `t1 < t <= t2` interpolates linearly to `kc_mid` / `dev`;
   *    `t2 < t <= t3` returns `kc_mid` / `mid`; `t3 < t <= t4` interpolates linearly to `kc_end` / `late`.
   *  * `t > t4` (past harvest) returns `{ kc: 0, stage: "done" }`. There is no crop after harvest,
   *    so a zero coefficient is intended and the caller must treat `done` as "no water required".
   *    (Note: `packages/core/README.md` §3 states Kc_end applies for `t > L_total`; that is a
   *    documentation simplification and is wrong — see `docs/research/model-audit.md`, F-12.)
   *  * A zero-length stage (`L_dev = 0` or `L_late = 0`) is guarded: the interpolation term would
   *    be 0/0, so the branch is skipped entirely and the boundary value is returned.
   *  * A negative stage length is treated the same way — the branch cannot be entered.
   */
  kcOnDay(params: CropParams, daysAfterSowing: number): { kc: number; stage: WeeklyNeed['stage'] } {
    const { ini, dev, mid, late } = params.stage_days;
    const t1 = ini;
    const t2 = ini + dev;
    const t3 = ini + dev + mid;
    const t4 = ini + dev + mid + late;

    if (daysAfterSowing <= t1) {
      return { kc: params.kc_ini, stage: 'ini' };
    }
    if (daysAfterSowing <= t2) {
      if (dev <= 0) return { kc: params.kc_mid, stage: 'mid' };
      const frac = (daysAfterSowing - t1) / dev;
      const kc = params.kc_ini + frac * (params.kc_mid - params.kc_ini);
      return { kc, stage: 'dev' };
    }
    if (daysAfterSowing <= t3) {
      return { kc: params.kc_mid, stage: 'mid' };
    }
    if (daysAfterSowing <= t4) {
      if (late <= 0) return { kc: params.kc_end, stage: 'late' };
      const frac = (daysAfterSowing - t3) / late;
      const kc = params.kc_mid + frac * (params.kc_end - params.kc_mid);
      return { kc, stage: 'late' };
    }
    return { kc: 0, stage: 'done' };
  },

  /**
   * Weekly need at the field gate for one crop plan.
   *
   * Chain (FAO-56 Rev.1 2025):
   *   ETc(t) = Kc(t) . ET0(t)                                  Eq. 6.1  (README §2)
   *   Peff   = effective rainfall                              README §4
   *   Inet   = max(0, ETc - Peff)                              upland  (README §6)
   *   Inet   = max(0, ETc + PERC - Peff)                       paddy   (README §6)
   *   Igross = Inet / Ea
   *   V      = 10 . Igross . A . area_fraction                 FAO-56 Table 1, p. 15
   *
   * Units: ET0, ETc, Peff, Inet, PERC in mm/week; Ea dimensionless (0,1]; A in ha;
   * `10` is m3/(mm.ha) from FAO-56 Table 1 -> V in m3.
   *
   * Boundary behaviour:
   *  * Empty `weather`: no ETc and no rain -> all depths and the volume are 0. The `bounds` object
   *    is still populated, because the root-zone capacity does not depend on the forecast. The
   *    weekly Kc falls back to `kc_ini` (no ET0 to weight by) — `weekKc` is only meaningful when
   *    `totalEt0 > 0`.
   *  * Zero or near-zero `area_ha`: the volume scales linearly to 0. No division by area occurs.
   *  * `application_efficiency <= 0`: the schema forbids it (`CropPlan.application_efficiency` is
   *    `gt(0).lte(1)`), but the core does not trust its caller — a non-positive Ea falls back to
   *    1.0 (no application loss) rather than producing Infinity. ASSUMED fallback.
   *  * Rain exceeding need: `net_irrigation_mm` is floored at 0, so `volume_m3` is 0 and the
   *    farmer's turn can be skipped (README §8). The surplus is NOT banked here — banking is the
   *    `rain.replanned` ledger event's job.
   *  * `t > L_total`: Kc is 0 (`stage: "done"`), so ETc is 0 and the week's need is 0.
   *
   * `wind_u2_ms` and `rh_min_pct` are OPTIONAL additions used only by the Eq. 6.18 / Eq. 6.21 Kc
   * adjustment. They are optional so that the published `CropEngine` interface — which does not
   * carry them, because `WeatherDay` has no humidity or wind field — stays satisfied unchanged.
   * When omitted, the tabulated Kc is used verbatim and no adjustment is claimed.
   */
  weeklyNeed(input: {
    plan: CropPlan;
    plot: Plot;
    params: CropParams;
    weather: WeatherDay[];
    weekStart: string;
    /** Mean wind speed at 2 m [m/s] for the Eq. 6.18/6.21 Kc adjustment. Omit when unknown. */
    wind_u2_ms?: number | null;
    /** Mean minimum relative humidity [%] for the Eq. 6.18/6.21 Kc adjustment. Omit when unknown. */
    rh_min_pct?: number | null;
  }): WeeklyNeed {
    const { plan, plot, params, weather, weekStart } = input;
    const isPaddy = plan.crop === 'rice';

    // Kc mid / Kc end are climate-adjusted per FAO-56 Eq. 6.18 / Eq. 6.21. The WeatherDay
    // contract carries no RHmin or u2, so unless the caller supplies them (see WeeklyNeedInput)
    // both are null and the tabulated value is returned unchanged — never silently adjusted.
    const kcMid = adjustKcForClimate(
      params.kc_mid,
      params.max_height_m,
      input.wind_u2_ms,
      input.rh_min_pct,
    );
    const kcEnd =
      params.kc_end > KC_END_ADJUSTMENT_THRESHOLD
        ? adjustKcForClimate(params.kc_end, params.max_height_m, input.wind_u2_ms, input.rh_min_pct)
        : params.kc_end;
    const adjusted: CropParams = { ...params, kc_mid: kcMid, kc_end: kcEnd };

    let totalEtc = 0;
    let totalEffRain = 0;
    let totalEt0 = 0;
    let daysWithNeed = 0;

    for (const day of weather) {
      const t = daysBetween(plan.sowing_date, day.date);
      const { kc } = cropEngine.kcOnDay(adjusted, t);
      const dailyEtc = kc * day.et0_mm;

      totalEtc += dailyEtc;
      totalEt0 += day.et0_mm;
      if (dailyEtc > 0) daysWithNeed++;

      if (isPaddy) {
        // ASSUMED project rule: paddy rain is captured in the basin below the bund/weir crest.
        // `docs/research/fao56-model.md` §2.4 gives Peff = min(P, max(0, H_weir - h_water)); the
        // ponded depth h_water is not on the WeatherDay contract, so the crest cap cannot be
        // applied here and the full storm is credited. This is the assumption that makes the
        // rice worked example reproduce; a caller with ponded-depth state must cap it itself.
        // See docs/research/model-audit.md F-05.
        totalEffRain += day.rain_mm;
      } else {
        // ASSUMED: upland effective-rainfall rule from `docs/research/fao56-model.md` §2.4
        // (showers <= RAIN_ABSTRACTION_MM evaporate; UPLAND_RAIN_CAPTURE of the excess infiltrates).
        // The source's second step — capping Peff by the current root-zone deficit
        // (Dr + ETc) — is NOT applied, because the core carries no day-to-day Dr state. This
        // over-credits rain on already-wet soil. See docs/research/model-audit.md F-06.
        const dailyEffRain =
          day.rain_mm > RAIN_ABSTRACTION_MM
            ? UPLAND_RAIN_CAPTURE * (day.rain_mm - RAIN_ABSTRACTION_MM)
            : 0;
        totalEffRain += dailyEffRain;
      }
    }

    // Midpoint day of the weather window represents the week's representative stage
    const midIdx = Math.floor(weather.length / 2);
    const midDay = weather[midIdx] ?? weather[0];
    const midT = midDay ? daysBetween(plan.sowing_date, midDay.date) : 0;
    const { stage: weekStage } = cropEngine.kcOnDay(adjusted, midT);

    const weekKc = totalEt0 > 0 ? totalEtc / totalEt0 : adjusted.kc_ini;

    let net_irrigation_mm = 0;
    let bounds: WeeklyNeed['bounds'] = null;

    if (isPaddy) {
      // Paddy branch: ETc + percolation - rain stored below bund.
      // ASSUMED: DEFAULT_PADDY_PERCOLATION_MM_DAY when the crop row carries no percolation rate.
      const percRate = params.percolation_mm_day ?? DEFAULT_PADDY_PERCOLATION_MM_DAY;
      const weeklyPerc = percRate * weather.length;
      net_irrigation_mm = Math.max(0, totalEtc + weeklyPerc - totalEffRain);
      bounds = null;
    } else {
      // Upland root-zone water balance: ETc - effective rain
      net_irrigation_mm = Math.max(0, totalEtc - totalEffRain);

      // Root depth dynamic expansion (fao56-model.md §2.5)
      const lGrow = params.stage_days.ini + params.stage_days.dev;
      const zrMin = params.root_depth_m.min;
      const zrMax = params.root_depth_m.max;
      let zr = zrMax;
      if (midT <= 0) {
        zr = zrMin;
      } else if (midT < lGrow) {
        // `lGrow` is the sum of two schema-required positive stage lengths, so it is > 0 here.
        zr = zrMin + (zrMax - zrMin) * (midT / lGrow);
      }

      // Total Available Water (TAW, FAO-56 Eq. 8.3 / Eq. 82)
      const soilAvail = SOIL_AVAILABLE_WATER[plot.soil] ?? 0.13;
      const taw_mm = 1000 * soilAvail * zr;

      // Depletion p adjustment for evaporative demand (FAO-56 Eq. 8.5, bounded 0.1-0.8).
      // MEASURED: the 0.04 coefficient and the 0.1/0.8 clamp are from Eq. 8.5 (2025 text,
      // `.ref/fao56-book/FAO56-full.txt` line 17605 and the "0.1 <= p <= 0.8" constraint following it).
      const meanEtc = daysWithNeed > 0 ? totalEtc / daysWithNeed : REFERENCE_ETC_MM_DAY;
      let pAdj = params.depletion_p + 0.04 * (REFERENCE_ETC_MM_DAY - meanEtc);
      pAdj = Math.max(0.1, Math.min(0.8, pAdj));
      if (!Number.isFinite(pAdj)) pAdj = params.depletion_p;

      // Readily Available Water (RAW, FAO-56 Eq. 8.4 / Eq. 83)
      const raw_mm = pAdj * taw_mm;

      // Event bounds: trigger at Dr >= RAW, refill RAW, cap at TAW
      const ea = plan.application_efficiency > 0 ? plan.application_efficiency : 1.0;
      const effectiveAreaHa = plot.area_ha * plan.area_fraction;
      const event_refill_m3 = (raw_mm / ea) * 10 * effectiveAreaHa;
      const event_cap_m3 = (taw_mm / ea) * 10 * effectiveAreaHa;

      bounds = {
        raw_mm: Math.round(raw_mm * 100) / 100,
        taw_mm: Math.round(taw_mm * 100) / 100,
        event_refill_m3: Math.round(event_refill_m3 * 100) / 100,
        event_cap_m3: Math.round(event_cap_m3 * 100) / 100,
      };
    }

    const ea = plan.application_efficiency > 0 ? plan.application_efficiency : 1.0;
    const gross_irrigation_mm = net_irrigation_mm / ea;
    const volume_m3 = gross_irrigation_mm * 10 * plot.area_ha * plan.area_fraction;

    return {
      crop_plan_id: plan.id,
      week_start: weekStart,
      etc_mm: Math.round(totalEtc * 1000) / 1000,
      effective_rain_mm: Math.round(totalEffRain * 1000) / 1000,
      net_irrigation_mm: Math.round(net_irrigation_mm * 1000) / 1000,
      gross_irrigation_mm: Math.round(gross_irrigation_mm * 1000) / 1000,
      volume_m3: Math.round(volume_m3 * 100) / 100,
      bounds,
      stage: weekStage,
      kc: Math.round(weekKc * 10000) / 10000,
    };
  },

  /**
   * Season total, used for the season-start suggestion.
   */
  seasonNeed(input: {
    plan: CropPlan;
    plot: Plot;
    params: CropParams;
    weather: WeatherDay[];
  }): { weeks: WeeklyNeed[]; total_m3: number } {
    const weeks: WeeklyNeed[] = [];
    const { weather, plan, plot, params } = input;

    for (let i = 0; i < weather.length; i += 7) {
      const chunk = weather.slice(i, i + 7);
      if (chunk.length === 0) break;
      const weekStart = chunk[0]!.date;
      const weekNeed = cropEngine.weeklyNeed({
        plan,
        plot,
        params,
        weather: chunk,
        weekStart,
      });
      weeks.push(weekNeed);
    }

    const total_m3 = Math.round(weeks.reduce((sum, w) => sum + w.volume_m3, 0) * 100) / 100;
    return { weeks, total_m3 };
  },
} satisfies CropEngine;
