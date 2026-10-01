import type {
  CropParams,
  CropPlan,
  Plot,
  WeatherDay,
  WeeklyNeed,
  CropEngine,
  SoilType,
} from "@jadal/contracts";

/**
 * Volumetric available water capacity (θ_FC - θ_WP) in m³/m³ (or mm/m)
 * Sourced from FAO-56 Table 19 / Table 7.5 (docs/research/fao56-book-reference.md).
 */
export const SOIL_AWC: Record<SoilType, number> = {
  sand: 0.08,
  loamy_sand: 0.09,
  sandy_loam: 0.13, // Red sandy soils (Chalka) - exactly 130 mm/m as in fao56-model.md §5.2
  loam: 0.155,
  silt_loam: 0.16,
  clay_loam: 0.155,
  clay: 0.16, // Vertisols (Black cotton)
};

export class Fao56CropEngine implements CropEngine {
  /**
   * Kc for a given day after sowing using FAO-56 piecewise-linear curve across 4 growth stages.
   * Eq. 66 (docs/research/fao56-crop-tables.md §4.3).
   *
   * @param params Crop parameters with stage lengths and coefficients
   * @param daysAfterSowing 1-indexed days since planting/sowing
   * @returns Crop coefficient Kc and current stage name
   */
  kcOnDay(
    params: CropParams,
    daysAfterSowing: number
  ): { kc: number; stage: WeeklyNeed["stage"] } {
    const { ini: L_ini, dev: L_dev, mid: L_mid, late: L_late } = params.stage_days;
    const t1 = L_ini;
    const t2 = L_ini + L_dev;
    const t3 = L_ini + L_dev + L_mid;
    const t4 = t3 + L_late;

    if (daysAfterSowing <= 0) {
      return { kc: params.kc_ini, stage: "ini" };
    }

    if (daysAfterSowing <= t1) {
      return { kc: params.kc_ini, stage: "ini" };
    }

    if (daysAfterSowing <= t2) {
      const frac = (daysAfterSowing - t1) / L_dev;
      const kc = params.kc_ini + frac * (params.kc_mid - params.kc_ini);
      return { kc, stage: "dev" };
    }

    if (daysAfterSowing <= t3) {
      return { kc: params.kc_mid, stage: "mid" };
    }

    if (daysAfterSowing <= t4) {
      const frac = (daysAfterSowing - t3) / L_late;
      const kc = params.kc_mid + frac * (params.kc_end - params.kc_mid);
      return { kc, stage: "late" };
    }

    return { kc: params.kc_end, stage: "done" };
  }

  /**
   * Weekly water need at the field gate for one crop plan over a 7-day period.
   */
  weeklyNeed(input: {
    plan: CropPlan;
    plot: Plot;
    params: CropParams;
    weather: WeatherDay[];
    weekStart: string;
  }): WeeklyNeed {
    const { plan, plot, params, weather, weekStart } = input;
    if (weather.length === 0) {
      throw new Error("Weather series cannot be empty");
    }

    const sowingTime = new Date(plan.sowing_date).getTime();
    let totalEtcMm = 0;
    let totalRainMm = 0;
    let totalPeffMm = 0;
    let stage: WeeklyNeed["stage"] = "mid";

    // Track daily crop coefficient and water balance
    for (let i = 0; i < weather.length; i++) {
      const day = weather[i]!;
      const dayTime = new Date(day.date).getTime();
      const das = Math.max(1, Math.round((dayTime - sowingTime) / (86400 * 1000)) + 1);

      const kcRes = this.kcOnDay(params, das);
      if (i === Math.floor(weather.length / 2)) {
        stage = kcRes.stage;
      }

      const dailyEtc = kcRes.kc * day.et0_mm;
      totalEtcMm += dailyEtc;
      totalRainMm += day.rain_mm;

      if (plan.crop === "rice") {
        // Lowland paddy: ASSUMED rain is retained in basin up to bund spillway crest (docs/research/fao56-model.md §2.4)
        totalPeffMm += day.rain_mm;
      } else {
        // Upland crops: ASSUMED project rule: 0.8 * (P - 3mm) for showers > 3mm (docs/research/fao56-model.md §2.4)
        if (day.rain_mm > 3) {
          totalPeffMm += 0.8 * (day.rain_mm - 3);
        }
      }
    }

    let netIrrigationMm = 0;
    let bounds: WeeklyNeed["bounds"] = null;
    const effectiveAreaHa = plot.area_ha * plan.area_fraction;

    if (plan.crop === "rice") {
      // Rice branch: ETc + percolation - Peff
      // ASSUMED: puddled percolation rate defaults to 3.5 mm/day (docs/research/fao56-model.md §5.3)
      const percolationRate = params.percolation_mm_day ?? 3.5;
      const weeklyPercolation = percolationRate * weather.length;
      netIrrigationMm = Math.max(0, totalEtcMm + weeklyPercolation - totalPeffMm);
      bounds = null; // Flooded rice is ponded; not bounded by unsaturated depletion
    } else {
      // Upland branch: max(0, ETc - Peff)
      netIrrigationMm = Math.max(0, totalEtcMm - totalPeffMm);

      // Root-zone bounds for one irrigation event:
      // TAW = 1000 * (θ_FC - θ_WP) * Zr
      const awc = SOIL_AWC[plot.soil] ?? 0.13;
      const Zr = params.root_depth_m.max; // Maximum mid/late root zone depth
      const taw_mm = 1000 * awc * Zr;

      // Adjust depletion fraction p for atmospheric demand ETc (FAO-56 p. 162, Eq. 8.5)
      const avgDailyEtc = totalEtcMm / weather.length;
      const p_adj = Math.min(0.8, Math.max(0.1, params.depletion_p + 0.04 * (5 - avgDailyEtc)));
      const raw_mm = p_adj * taw_mm;

      const event_refill_m3 = (10 * (raw_mm / plan.application_efficiency)) * effectiveAreaHa;
      const event_cap_m3 = (10 * (taw_mm / plan.application_efficiency)) * effectiveAreaHa;

      bounds = {
        raw_mm,
        taw_mm,
        event_refill_m3,
        event_cap_m3,
      };
    }

    const grossIrrigationMm = netIrrigationMm / plan.application_efficiency;
    // 1 mm depth applied over 1 ha = 10 m³ (FAO-56 Table 1, p. 15)
    const volume_m3 = 10 * grossIrrigationMm * effectiveAreaHa;
    const meanKc = totalEtcMm / weather.reduce((s, w) => s + w.et0_mm, 0);

    return {
      crop_plan_id: plan.id,
      week_start: weekStart,
      etc_mm: totalEtcMm,
      effective_rain_mm: totalPeffMm,
      net_irrigation_mm: netIrrigationMm,
      gross_irrigation_mm: grossIrrigationMm,
      volume_m3,
      bounds,
      stage,
      kc: meanKc,
    };
  }

  /**
   * Season total requirement, breaking weather into 7-day weekly windows.
   */
  seasonNeed(input: {
    plan: CropPlan;
    plot: Plot;
    params: CropParams;
    weather: WeatherDay[];
  }): { weeks: WeeklyNeed[]; total_m3: number } {
    const { plan, plot, params, weather } = input;
    const weeks: WeeklyNeed[] = [];
    let total_m3 = 0;

    for (let i = 0; i + 7 <= weather.length; i += 7) {
      const weekWeather = weather.slice(i, i + 7);
      const weekStart = weekWeather[0]!.date;
      const wNeed = this.weeklyNeed({
        plan,
        plot,
        params,
        weather: weekWeather,
        weekStart,
      });
      weeks.push(wNeed);
      total_m3 += wNeed.volume_m3;
    }

    return {
      weeks,
      total_m3,
    };
  }
}

export const cropEngine = new Fao56CropEngine();
