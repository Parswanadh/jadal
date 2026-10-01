import type {
  CropEngine,
  WeeklyNeed,
  CropParams,
  CropPlan,
  Plot,
  WeatherDay,
  SoilType,
} from '@jadal/contracts';

// FAO-56 Table 7.5 (p. 232) / Table 19: Available soil water capacity (theta_FC - theta_WP) in m3/m3
export const SOIL_AVAILABLE_WATER: Record<SoilType, number> = {
  sand: 0.08, // 50-110 mm/m, mean 80 mm/m
  loamy_sand: 0.09, // 60-120 mm/m, mean 90 mm/m
  sandy_loam: 0.13, // 110-150 mm/m, mean 130 mm/m (Chalka red soil in AP)
  loam: 0.155, // 130-180 mm/m, mean 155 mm/m
  silt_loam: 0.16, // 130-190 mm/m, mean 160 mm/m
  clay_loam: 0.15, // 130-180 mm/m, mean 150 mm/m
  clay: 0.16, // 120-200 mm/m, mean 160 mm/m (Black Vertisol in AP)
};

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

export const cropEngine = {
  /**
   * Kc for a given day after sowing (FAO-56 piecewise-linear curve, Eq. 6.20 / Eq. 66).
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
      const frac = (daysAfterSowing - t1) / dev;
      const kc = params.kc_ini + frac * (params.kc_mid - params.kc_ini);
      return { kc, stage: 'dev' };
    }
    if (daysAfterSowing <= t3) {
      return { kc: params.kc_mid, stage: 'mid' };
    }
    if (daysAfterSowing <= t4) {
      const frac = (daysAfterSowing - t3) / late;
      const kc = params.kc_mid + frac * (params.kc_end - params.kc_mid);
      return { kc, stage: 'late' };
    }
    return { kc: 0, stage: 'done' };
  },

  /**
   * Weekly need at the field gate for one crop plan.
   */
  weeklyNeed(input: {
    plan: CropPlan;
    plot: Plot;
    params: CropParams;
    weather: WeatherDay[];
    weekStart: string;
  }): WeeklyNeed {
    const { plan, plot, params, weather, weekStart } = input;
    const isPaddy = plan.crop === 'rice';

    let totalEtc = 0;
    let totalEffRain = 0;
    let totalEt0 = 0;

    for (const day of weather) {
      const t = daysBetween(plan.sowing_date, day.date);
      const { kc } = cropEngine.kcOnDay(params, t);
      const dailyEtc = kc * day.et0_mm;

      totalEtc += dailyEtc;
      totalEt0 += day.et0_mm;

      if (isPaddy) {
        // Paddy bund hydrology: rainfall is captured in the basin below the bund/weir crest
        totalEffRain += day.rain_mm;
      } else {
        // ASSUMED: daily effective rainfall rule from fao56-model.md §2.4 (showers <= 3mm evaporate, 80% of excess infiltrates)
        const dailyEffRain = day.rain_mm > 3 ? 0.8 * (day.rain_mm - 3) : 0;
        totalEffRain += dailyEffRain;
      }
    }

    // Midpoint day of the weather window represents the week's representative stage
    const midIdx = Math.floor(weather.length / 2);
    const midDay = weather[midIdx] ?? weather[0];
    const midT = midDay ? daysBetween(plan.sowing_date, midDay.date) : 0;
    const { stage: weekStage } = cropEngine.kcOnDay(params, midT);

    const weekKc = totalEt0 > 0 ? totalEtc / totalEt0 : params.kc_ini;

    let net_irrigation_mm = 0;
    let bounds: WeeklyNeed['bounds'] = null;

    if (isPaddy) {
      // Paddy branch: ETc + percolation - rain stored below bund
      const percRate = params.percolation_mm_day ?? 3.5;
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
        zr = zrMin + (zrMax - zrMin) * (midT / lGrow);
      }

      // Total Available Water (TAW, FAO-56 Eq. 8.3 / Eq. 82)
      const soilAvail = SOIL_AVAILABLE_WATER[plot.soil] ?? 0.13;
      const taw_mm = 1000 * soilAvail * zr;

      // Depletion p adjustment for evaporative demand (FAO-56 Eq. 8.5, bounded 0.1-0.8)
      const meanEtc = weather.length > 0 ? totalEtc / weather.length : 5.0;
      let pAdj = params.depletion_p + 0.04 * (5.0 - meanEtc);
      pAdj = Math.max(0.1, Math.min(0.8, pAdj));

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
