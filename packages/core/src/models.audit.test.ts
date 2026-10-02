/**
 * Model audit conformance tests (lane Q / `ws/B-models`).
 *
 * Every test in this file pins a behaviour that `docs/research/model-audit.md` recorded as a
 * finding, or a boundary case that `docs/architecture/models.md` documents. They are the executable
 * form of that audit: if one of them fails, the written model reference is no longer true.
 *
 * Conventions:
 *  * A test named `F-nn` corresponds to finding F-nn in `docs/research/model-audit.md`.
 *  * Values asserted here were derived by hand or from the cited FAO-56 source text, never by
 *    copying what the implementation happened to return. Where a number comes from the source
 *    document, the citation is in the test.
 */

import { describe, expect, it } from 'vitest';
import type { CropParams, CropPlan, Plot, WeatherDay } from '@jadal/contracts';

import { cropEngine, adjustKcForClimate, SOIL_AVAILABLE_WATER, RAIN_ABSTRACTION_MM } from './crop';
import { hydraulics, manningVelocity } from './hydraulics';
import { rosterEngine } from './roster';
import { ledger } from './ledger';
import { policy } from './policy';
import { mmHaToCubicMeters } from './index';

/* ------------------------------------------------------------------ shared fixtures */

const GROUNDNUT: CropParams = {
  crop: 'groundnut',
  kc_ini: 0.4,
  kc_mid: 1.05, // MEASURED: FAO-56 Rev.1 (2025) Table 6.2, line 11956 of FAO56-full.txt
  kc_end: 0.6,
  stage_days: { ini: 25, dev: 35, mid: 45, late: 25 },
  max_height_m: 0.5, // MEASURED: same row
  root_depth_m: { min: 0.5, max: 1.0 }, // MEASURED: same row, Zr 0.50-1.00
  depletion_p: 0.5, // MEASURED: Table 8.2, line 17797
  source: 'FAO-56 (2025) Table 6.2 / Table 8.2',
};

const PLOT_1HA = (soil: Plot['soil'] = 'sandy_loam'): Plot => ({
  id: 'p1',
  farmer_id: 'f1',
  outlet_id: 'o1',
  area_ha: 1.0,
  soil,
  lat: 16.5,
  lon: 80.5,
});

const PLAN = (over: Partial<CropPlan> = {}): CropPlan => ({
  id: 'cp1',
  plot_id: 'p1',
  crop: 'groundnut',
  sowing_date: '2025-01-01',
  area_fraction: 1.0,
  application_efficiency: 0.65,
  status: 'active',
  ...over,
});

/** Seven consecutive days starting `offset` days after 2025-01-01, with rain on day index 2. */
function week(offset: number, et0: number, rain: number): WeatherDay[] {
  const base = Date.UTC(2025, 0, 1);
  return Array.from({ length: 7 }, (_, i) => ({
    date: new Date(base + (offset + i) * 86_400_000).toISOString().slice(0, 10),
    et0_mm: et0,
    rain_mm: i === 2 ? rain : 0,
  }));
}

/* ================================================================== Task 2: worked examples */

describe('task 2 - the README/docs worked examples, recomputed', () => {
  /**
   * The claim under test is `packages/core/README.md` §6 as worked in
   * `docs/research/fao56-model.md` §5.2: groundnut, 1 ha, Ea 0.65, ET0 5 mm/day, 15 mm storm,
   * Kc_mid climate-adjusted 1.1325 -> 462.12 m3.
   *
   * This test deliberately supplies the ADJUSTED coefficients and the §5.2 root depth, because
   * that is the only parameter set under which the documented arithmetic reproduces. The shipped
   * `crop-params.json` produces 417.69 m3 instead; see the F-01 test below, which pins that gap.
   */
  const DOC_PARAMS: CropParams = {
    ...GROUNDNUT,
    kc_mid: 1.132516, // = 1.15 + [0.04*(2.2-2) - 0.004*(55-45)] * (0.40/3)^0.3
    max_height_m: 0.4,
    root_depth_m: { min: 0.5, max: 0.8 }, // Z_r = 0.80 m at mid-season, per §5.2
  };

  it('reproduces the documented groundnut case: 462.12 m3', () => {
    const weather = week(60, 5.0, 15.0);
    const need = cropEngine.weeklyNeed({
      plan: PLAN(),
      plot: PLOT_1HA('sandy_loam'),
      params: DOC_PARAMS,
      weather,
      weekStart: weather[0]!.date,
    });

    // ETc = 7 x 1.132516 x 5.0 = 39.638 mm; Peff = 0.8 x (15-3) = 9.60 mm
    expect(need.etc_mm).toBeCloseTo(39.638, 3);
    expect(need.effective_rain_mm).toBeCloseTo(9.6, 3);
    // Inet = 39.638 - 9.60 = 30.038 mm ; Igross = 30.038 / 0.65 = 46.2124 mm
    expect(need.net_irrigation_mm).toBeCloseTo(30.038, 3);
    expect(need.gross_irrigation_mm).toBeCloseTo(46.212, 3);
    // V = 10 x 46.2124 x 1.0 = 462.12 m3
    expect(need.volume_m3).toBeCloseTo(462.12, 2);
  });

  it('reproduces the documented rice case: 643.75 m3', () => {
    const RICE: CropParams = {
      crop: 'rice',
      variant: 'flooded',
      kc_ini: 1.05,
      kc_mid: 1.2,
      kc_end: 1.05,
      stage_days: { ini: 30, dev: 30, mid: 60, late: 30 },
      max_height_m: 1.0,
      root_depth_m: { min: 0.5, max: 1.0 },
      depletion_p: 0.2,
      percolation_mm_day: 3.5,
      source: 'ASSUMED project row',
    };
    const weather = week(60, 5.0, 15.0);
    const need = cropEngine.weeklyNeed({
      plan: PLAN({ crop: 'rice', application_efficiency: 0.8 }),
      plot: PLOT_1HA('clay'),
      params: RICE,
      weather,
      weekStart: weather[0]!.date,
    });

    // ETc = 7 x 1.20 x 5.0 = 42.00 mm ; PERC = 7 x 3.5 = 24.50 mm ; Peff = 15.00 mm
    expect(need.etc_mm).toBeCloseTo(42.0, 3);
    expect(need.effective_rain_mm).toBeCloseTo(15.0, 3);
    // Inet = (42.00 + 24.50) - 15.00 = 51.50 mm ; Igross = 51.50 / 0.80 = 64.375 mm
    expect(need.net_irrigation_mm).toBeCloseTo(51.5, 3);
    expect(need.gross_irrigation_mm).toBeCloseTo(64.375, 3);
    // V = 10 x 64.375 x 1.0 = 643.75 m3
    expect(need.volume_m3).toBeCloseTo(643.75, 2);

    // Rice has no root-zone bounds: the field is intentionally ponded (README §4.2)
    expect(need.bounds).toBeNull();
  });

  it('F-01: the SHIPPED groundnut params give 417.69 m3, not the documented 462.12 m3', () => {
    // This is the finding, pinned. The documented example is reproducible only with a hand-typed
    // Kc_mid (1.1325) and Zr_max (0.80); the verified FAO-56 table ships kc_mid = 1.05 and
    // Zr_max = 1.00. The engine has no Eq. 6.18/6.21 climate adjustment unless the caller supplies
    // wind and humidity, so an unadjusted run must give the Kc_mid = 1.05 answer.
    const weather = week(60, 5.0, 15.0);
    const need = cropEngine.weeklyNeed({
      plan: PLAN(),
      plot: PLOT_1HA('sandy_loam'),
      params: GROUNDNUT,
      weather,
      weekStart: weather[0]!.date,
    });
    // ETc = 7 x 1.05 x 5.0 = 36.75 mm ; Inet = 36.75 - 9.60 = 27.15 mm
    // Igross = 27.15 / 0.65 = 41.769 mm ; V = 417.69 m3
    expect(need.etc_mm).toBeCloseTo(36.75, 3);
    expect(need.volume_m3).toBeCloseTo(417.69, 2);
    // ...and explicitly NOT the documented figure.
    expect(Math.abs(need.volume_m3 - 462.12)).toBeGreaterThan(1);
  });
});

/* ================================================================== F-12 / Kc curve */

describe('F-12 - Kc curve boundaries', () => {
  it('returns Kc_end on the last day of the season', () => {
    const t4 = 25 + 35 + 45 + 25; // 130
    expect(cropEngine.kcOnDay(GROUNDNUT, t4)).toEqual({ kc: 0.6, stage: 'late' });
  });

  it('returns kc 0 / stage done AFTER the season ends, not Kc_end', () => {
    // README §3 documents "Kc_end if t > L_total". The implementation instead returns 0/done,
    // which is the defensible reading (there is no crop after harvest). README is the thing that
    // is wrong; docs/research/model-audit.md F-12 records the correction.
    expect(cropEngine.kcOnDay(GROUNDNUT, 131)).toEqual({ kc: 0, stage: 'done' });
    expect(cropEngine.kcOnDay(GROUNDNUT, 100_000)).toEqual({ kc: 0, stage: 'done' });
  });

  it('treats the sowing day and any earlier day as the initial stage', () => {
    expect(cropEngine.kcOnDay(GROUNDNUT, 0)).toEqual({ kc: 0.4, stage: 'ini' });
    expect(cropEngine.kcOnDay(GROUNDNUT, -30)).toEqual({ kc: 0.4, stage: 'ini' });
  });

  it('interpolates exactly at the dev/mid boundary and hits Kc_mid', () => {
    // t = L_ini + L_dev = 60 is the last interpolated day: frac = 35/35 = 1
    expect(cropEngine.kcOnDay(GROUNDNUT, 60).kc).toBeCloseTo(1.05, 10);
    expect(cropEngine.kcOnDay(GROUNDNUT, 61).kc).toBeCloseTo(1.05, 10);
    expect(cropEngine.kcOnDay(GROUNDNUT, 61).stage).toBe('mid');
  });

  it('does not divide by zero when a stage has zero length', () => {
    const zeroDev: CropParams = { ...GROUNDNUT, stage_days: { ini: 25, dev: 0, mid: 45, late: 25 } };
    const r = cropEngine.kcOnDay(zeroDev, 26);
    expect(Number.isFinite(r.kc)).toBe(true);
    expect(r.kc).toBeCloseTo(1.05, 10);

    const zeroLate: CropParams = { ...GROUNDNUT, stage_days: { ini: 25, dev: 35, mid: 45, late: 0 } };
    const r2 = cropEngine.kcOnDay(zeroLate, 105);
    expect(Number.isFinite(r2.kc)).toBe(true);
  });
});

/* ================================================================== F-04: Kc climate adjustment */

describe('F-04 - FAO-56 Eq. 6.18 / 6.21 Kc climate adjustment', () => {
  it('reproduces the documented groundnut mid-season adjustment (Kc_mid 1.15 -> 1.132516)', () => {
    // [0.04*(2.2-2) - 0.004*(55-45)] * (0.40/3)^0.3 = -0.032 * 0.5463634 = -0.0174836
    const kc = adjustKcForClimate(1.15, 0.4, 2.2, 55);
    expect(kc).toBeCloseTo(1.1325164, 6);
  });

  it('is a no-op in the reference climate (u2 = 2, RHmin = 45)', () => {
    expect(adjustKcForClimate(1.15, 0.4, 2, 45)).toBeCloseTo(1.15, 12);
  });

  it('is a no-op when either climate input is absent or non-finite', () => {
    expect(adjustKcForClimate(1.15, 0.4, null, 55)).toBe(1.15);
    expect(adjustKcForClimate(1.15, 0.4, 2.2, undefined)).toBe(1.15);
    expect(adjustKcForClimate(1.15, 0.4, Number.NaN, 55)).toBe(1.15);
    expect(adjustKcForClimate(1.15, 0.4, 2.2, Number.NaN)).toBe(1.15);
  });

  it('does NOT extrapolate outside the source validity domain (u2 1-6, RHmin 20-80)', () => {
    // docs/research/fao56-crop-tables.md §4.2.1 states these bounds; outside them the equation is
    // undefined, so the tabulated value is returned unchanged rather than extrapolated.
    expect(adjustKcForClimate(1.15, 0.4, 0.4, 55)).toBe(1.15); // u2 below 1
    expect(adjustKcForClimate(1.15, 0.4, 9.9, 55)).toBe(1.15); // u2 above 6
    expect(adjustKcForClimate(1.15, 0.4, 2.2, 5)).toBe(1.15); // RHmin below 20
    expect(adjustKcForClimate(1.15, 0.4, 2.2, 95)).toBe(1.15); // RHmin above 80
  });

  it('raises Kc_mid in a hot dry windy climate and lowers it in a humid calm one', () => {
    expect(adjustKcForClimate(1.15, 2.0, 4.0, 20)).toBeGreaterThan(1.15);
    expect(adjustKcForClimate(1.15, 2.0, 1.0, 80)).toBeLessThan(1.15);
  });

  it('is applied end-to-end by weeklyNeed when the caller supplies wind and humidity', () => {
    const weather = week(60, 5.0, 15.0);
    const withClimate = cropEngine.weeklyNeed({
      plan: PLAN(),
      plot: PLOT_1HA('sandy_loam'),
      params: GROUNDNUT,
      weather,
      weekStart: weather[0]!.date,
      wind_u2_ms: 2.2,
      rh_min_pct: 55,
    });
    // Kc_mid 1.05 adjusted: 1.05 + (-0.032)*(0.5/3)^0.3 = 1.05 - 0.0152 = 1.0348
    // ETc = 7 x 1.0348 x 5 = 36.216 mm -> V = 10*((36.216-9.6)/0.65) = 409.48 m3
    expect(withClimate.kc).toBeLessThan(1.05);
    expect(withClimate.volume_m3).toBeLessThan(417.69);
    // ...and the unadjusted run is untouched.
    const without = cropEngine.weeklyNeed({
      plan: PLAN(),
      plot: PLOT_1HA('sandy_loam'),
      params: GROUNDNUT,
      weather,
      weekStart: weather[0]!.date,
    });
    expect(without.kc).toBeCloseTo(1.05, 10);
  });

  it('only adjusts Kc_end when the tabulated value exceeds 0.45', () => {
    // docs/research/fao56-crop-tables.md §4.2.2: Eq. 65 applies only if Kc_end(Tab) > 0.45.
    const dryGrain: CropParams = { ...GROUNDNUT, kc_end: 0.35 }; // <= 0.45 -> no adjustment
    const weather = week(60, 5.0, 0);
    const need = cropEngine.weeklyNeed({
      plan: PLAN(),
      plot: PLOT_1HA(),
      params: dryGrain,
      weather,
      weekStart: weather[0]!.date,
    });
    expect(Number.isFinite(need.volume_m3)).toBe(true);

    // A green-harvest crop (Kc_end > 0.45) IS adjusted; the season-mean Kc must therefore move.
    const green: CropParams = { ...GROUNDNUT, kc_end: 0.9 };
    const adjusted = cropEngine.weeklyNeed({
      plan: PLAN(),
      plot: PLOT_1HA(),
      params: green,
      weather,
      weekStart: weather[0]!.date,
      wind_u2_ms: 1.0,
      rh_min_pct: 80,
    });
    const unadjusted = cropEngine.weeklyNeed({
      plan: PLAN(),
      plot: PLOT_1HA(),
      params: green,
      weather,
      weekStart: weather[0]!.date,
    });
    expect(adjusted.volume_m3).not.toBe(unadjusted.volume_m3);
  });
});

/* ================================================================== boundary: weeklyNeed */

describe('weeklyNeed boundary behaviour', () => {
  it('returns zero volume and zero depths for an empty weather window', () => {
    const need = cropEngine.weeklyNeed({
      plan: PLAN(),
      plot: PLOT_1HA(),
      params: GROUNDNUT,
      weather: [],
      weekStart: '2025-03-01',
    });
    expect(need.volume_m3).toBe(0);
    expect(need.etc_mm).toBe(0);
    expect(need.net_irrigation_mm).toBe(0);
    // Bounds still exist: root-zone capacity does not depend on the forecast.
    expect(need.bounds).not.toBeNull();
    // No ET0 to weight by, so the reported Kc falls back to Kc_ini.
    expect(need.kc).toBeCloseTo(0.4, 10);
  });

  it('never divides by zero when application_efficiency is non-positive', () => {
    const weather = week(60, 5.0, 0);
    for (const ea of [0, -0.5]) {
      const need = cropEngine.weeklyNeed({
        plan: PLAN({ application_efficiency: ea }),
        plot: PLOT_1HA(),
        params: GROUNDNUT,
        weather,
        weekStart: weather[0]!.date,
      });
      expect(Number.isFinite(need.volume_m3)).toBe(true);
      expect(Number.isFinite(need.gross_irrigation_mm)).toBe(true);
      // Falls back to Ea = 1.0 (no application loss).
      expect(need.gross_irrigation_mm).toBeCloseTo(need.net_irrigation_mm, 10);
    }
  });

  it('floors net irrigation at zero when rain exceeds crop need', () => {
    const weather = week(60, 5.0, 400); // enormous storm
    const need = cropEngine.weeklyNeed({
      plan: PLAN(),
      plot: PLOT_1HA(),
      params: GROUNDNUT,
      weather,
      weekStart: weather[0]!.date,
    });
    expect(need.net_irrigation_mm).toBe(0);
    expect(need.volume_m3).toBe(0);
    expect(need.effective_rain_mm).toBeGreaterThan(need.etc_mm);
  });

  it('scales volume linearly with plot area and area_fraction, and to zero', () => {
    const weather = week(60, 5.0, 15.0);
    const mk = (areaHa: number, frac: number) =>
      cropEngine.weeklyNeed({
        plan: PLAN({ area_fraction: frac }),
        plot: { ...PLOT_1HA(), area_ha: areaHa },
        params: GROUNDNUT,
        weather,
        weekStart: weather[0]!.date,
      }).volume_m3;

    const one = mk(1, 1);
    expect(mk(2, 1)).toBeCloseTo(one * 2, 1);
    expect(mk(1, 0.5)).toBeCloseTo(one / 2, 1);
    expect(mk(0, 1)).toBe(0);
    expect(mk(1, 1e-9)).toBe(0);
  });

  it('requires zero irrigation once the crop is past harvest (stage done)', () => {
    const weather = week(200, 5.0, 0); // 200 days after sowing, season is 130 days
    const need = cropEngine.weeklyNeed({
      plan: PLAN(),
      plot: PLOT_1HA(),
      params: GROUNDNUT,
      weather,
      weekStart: weather[0]!.date,
    });
    expect(need.stage).toBe('done');
    expect(need.etc_mm).toBe(0);
    expect(need.volume_m3).toBe(0);
  });

  it('ignores showers up to the RAIN_ABSTRACTION_MM threshold', () => {
    const mk = (rain: number) =>
      cropEngine.weeklyNeed({
        plan: PLAN(),
        plot: PLOT_1HA(),
        params: GROUNDNUT,
        weather: week(60, 5.0, rain),
        weekStart: '2025-03-02',
      }).effective_rain_mm;
    // ASSUMED rule: P <= 3 mm contributes nothing; P > 3 mm contributes 0.8*(P-3).
    expect(RAIN_ABSTRACTION_MM).toBe(3);
    expect(mk(3)).toBe(0);
    expect(mk(2)).toBe(0);
    expect(mk(4)).toBeCloseTo(0.8, 3);
    expect(mk(15)).toBeCloseTo(9.6, 3);
  });

  it('clamps the depletion-fraction adjustment p to [0.10, 0.80] (FAO-56 Eq. 8.5)', () => {
    // Very low ETc pushes p up; the clamp must hold it at 0.80.
    const lowEt0 = week(60, 0.1, 0);
    const need = cropEngine.weeklyNeed({
      plan: PLAN(),
      plot: PLOT_1HA(),
      params: { ...GROUNDNUT, depletion_p: 0.79, root_depth_m: { min: 0.5, max: 1.0 } },
      weather: lowEt0,
      weekStart: lowEt0[0]!.date,
    });
    expect(need.bounds!.raw_mm).toBeLessThanOrEqual(need.bounds!.taw_mm * 0.8 + 0.01);
  });
});

/* ================================================================== hydraulics */

describe('F-10 - Manning velocity guards', () => {
  const base = { manning_n: 0.025, hydraulic_radius_m: 0.35, bed_slope: 0.0004 };

  it('matches the published demo value v = 0.3973 m/s', () => {
    // docs/architecture/architecture.html:2588 states v = 0.398 m/s for these parameters.
    expect(manningVelocity(base.manning_n, base.hydraulic_radius_m, base.bed_slope)).toBeCloseTo(
      0.397315,
      5,
    );
  });

  it('returns 0 (not NaN) for a zero or negative bed slope', () => {
    expect(manningVelocity(0.025, 0.35, 0)).toBe(0);
    expect(manningVelocity(0.025, 0.35, -0.001)).toBe(0);
  });

  it('returns 0 (not Infinity) for a non-positive Manning n', () => {
    expect(manningVelocity(0, 0.35, 0.0004)).toBe(0);
    expect(manningVelocity(-0.025, 0.35, 0.0004)).toBe(0);
  });

  it('returns 0 for non-finite inputs and for a negative radius', () => {
    expect(manningVelocity(Number.NaN, 0.35, 0.0004)).toBe(0);
    expect(manningVelocity(0.025, Number.NaN, 0.0004)).toBe(0);
    expect(manningVelocity(0.025, 0.35, Number.NaN)).toBe(0);
    expect(manningVelocity(0.025, -1, 0.0004)).toBe(0);
    expect(manningVelocity(0.025, 0, 0.0004)).toBe(0);
  });

  it('produces zero lag rather than Infinity on a dead-flat canal', () => {
    const canal = {
      id: 'c',
      name: 'flat',
      length_m: 1000,
      head_discharge_m3s: 1,
      seepage_k_per_m: 0.0002,
      manning_n: 0.025,
      bed_slope: 0,
      hydraulic_radius_m: 1.0,
      lined: false,
    };
    const [o] = hydraulics.atOutlets(canal, [{ id: 'o', canal_id: 'c', name: 'x', chainage_m: 900 }], 1);
    expect(o!.lag_h).toBe(0);
    expect(Number.isFinite(o!.flow_m3s)).toBe(true);
  });
});

describe('hydraulics boundaries', () => {
  const canal = {
    id: 'c1',
    name: 'demo',
    length_m: 3000,
    head_discharge_m3s: 0.15,
    seepage_k_per_m: 0.00012,
    manning_n: 0.025,
    bed_slope: 0.0004,
    hydraulic_radius_m: 0.35,
    lined: false,
  };
  const outlets = [
    { id: 'o1', canal_id: 'c1', name: 'head', chainage_m: 300 },
    { id: 'o2', canal_id: 'c1', name: 'tail', chainage_m: 2900 },
  ];

  it('gives no loss and no lag at chainage 0', () => {
    const [h] = hydraulics.atOutlets(canal, [{ id: 'h', canal_id: 'c1', name: 'h', chainage_m: 0 }], 0.15);
    expect(h!.flow_m3s).toBeCloseTo(0.15, 12);
    expect(h!.lag_h).toBe(0);
    expect(h!.loss_fraction).toBe(0);
  });

  it('is a no-op for a perfectly lined canal (k = 0)', () => {
    const lined = { ...canal, seepage_k_per_m: 0, lined: true };
    const [h] = hydraulics.atOutlets(lined, outlets, 0.15);
    expect(h!.flow_m3s).toBeCloseTo(0.15, 12);
    expect(h!.loss_fraction).toBeCloseTo(0, 12);
    // ...but travel time still elapses.
    expect(h!.lag_h).toBeGreaterThan(0);
  });

  it('returns [] for an empty outlet list', () => {
    expect(hydraulics.atOutlets(canal, [], 0.15)).toEqual([]);
  });

  it('reproduces the published tail-outlet values (Q8 = 0.106 m3/s, 29.4% loss)', () => {
    const [tail] = hydraulics.atOutlets(canal, [outlets[1]!], 0.15);
    expect(tail!.flow_m3s).toBeCloseTo(0.105915, 5);
    expect(tail!.loss_fraction * 100).toBeCloseTo(29.4, 1);
  });

  it('charges only outlets strictly downstream of the overrun', () => {
    const impact = hydraulics.overrunImpact({
      canal,
      outlets,
      overrunOutletId: 'o1',
      overrun_h: 1,
      headDischarge_m3s: 0.15,
    });
    expect(impact.map((i) => i.outlet_id)).toEqual(['o2']);
  });

  it('returns [] for an unknown overrunning outlet', () => {
    expect(
      hydraulics.overrunImpact({ canal, outlets, overrunOutletId: 'nope', overrun_h: 1, headDischarge_m3s: 0.15 }),
    ).toEqual([]);
  });

  it('treats a zero, negative or non-finite overrun as no impact', () => {
    for (const h of [0, -3, Number.NaN]) {
      const impact = hydraulics.overrunImpact({
        canal,
        outlets,
        overrunOutletId: 'o1',
        overrun_h: h,
        headDischarge_m3s: 0.15,
      });
      for (const item of impact) expect(item.lost_m3).toBe(0);
    }
  });

  it('does not charge an outlet at exactly the same chainage', () => {
    const same = [
      { id: 'a', canal_id: 'c1', name: 'a', chainage_m: 500 },
      { id: 'b', canal_id: 'c1', name: 'b', chainage_m: 500 },
    ];
    expect(
      hydraulics.overrunImpact({ canal, outlets: same, overrunOutletId: 'a', overrun_h: 1, headDischarge_m3s: 0.15 }),
    ).toEqual([]);
  });
});

/* ================================================================== ledger */

describe('F-08 - ledger conservation and self-transfers', () => {
  it('holds the conservation invariant across a full season of events', () => {
    const events = [
      {
        id: 'e1',
        at: '2026-06-01T00:00:00Z',
        canal_id: 'c1',
        actor: { kind: 'coordinator' as const, id: 'c' },
        type: 'season.approved' as const,
        season_supply_m3: 1000,
        entitlements: [
          { farmer_id: 'f1', volume_m3: 400 },
          { farmer_id: 'f2', volume_m3: 300 },
        ],
      },
    ];
    const entries = events.flatMap((e) => ledger.entriesFor(e as never));
    // 700 allocated, 300 to buffer.
    const bal = ledger.balances(entries);
    expect(bal.buffer).toBeCloseTo(300, 6);
    expect(bal.farmers['f1']!.quota).toBeCloseTo(400, 6);
    expect(ledger.checkConservation(entries, 1000).ok).toBe(true);
  });

  it('detects a conservation break caused by an unmatched account name', () => {
    // `farmer:typo:quota` DOES match the account grammar and is tracked like any other farmer.
    // A genuinely unmatched name (a misspelt singleton account) is silently dropped, which is the
    // mechanism by which volume can vanish without an error.
    const entries = [
      {
        id: 'x:0',
        at: '2026-06-01T00:00:00Z',
        from: 'canal_supply',
        to: 'losses:seepage' as never, // not one of the recognised singleton accounts
        volume_m3: 100,
        reason: 'r',
        event_id: 'x',
      },
    ];
    const bal = ledger.balances(entries);
    // The credit matched nothing, but the canal_supply debit still applied -> 100 m3 unaccounted.
    expect(bal.canal_supply).toBe(100);
    expect(bal.conveyance_losses).toBe(0);
    expect(ledger.checkConservation(entries, 100).ok).toBe(false);
    expect(ledger.checkConservation(entries, 100).diff_m3).toBe(100);
  });

  it('tracks a farmer id literally (the grammar accepts any non-colon chars)', () => {
    const entries = [
      {
        id: 'x:0',
        at: '2026-06-01T00:00:00Z',
        from: 'canal_supply',
        to: 'farmer:typo:quota' as never,
        volume_m3: 100,
        reason: 'r',
        event_id: 'x',
      },
    ];
    expect(ledger.balances(entries).farmers['typo']!.quota).toBe(100);
    expect(ledger.checkConservation(entries, 100).ok).toBe(true);
  });

  it('accepts a diff exactly at the default tolerance and rejects just beyond it', () => {
    const entries = [
      {
        id: 'e:0',
        at: '2026-06-01T00:00:00Z',
        from: 'canal_supply',
        to: 'farmer:f1:quota',
        volume_m3: 100,
        reason: 'r',
        event_id: 'e',
      },
    ];
    expect(ledger.checkConservation(entries, 100.001).ok).toBe(true); // == tolerance
    expect(ledger.checkConservation(entries, 100.0011).ok).toBe(false);
    expect(ledger.checkConservation(entries, 100).diff_m3).toBe(0);
  });

  it('F-08: rain.replanned does not reconcile saved_m3 against by_farmer_m3', () => {
    // The event says 500 m3 was saved but only 200 m3 is attributed to farmers. Nothing rejects
    // this, and the ledger books only the attributed part.
    const event = {
      id: 'r1',
      at: '2026-06-01T00:00:00Z',
      canal_id: 'c1',
      actor: { kind: 'system' as const, id: 's' },
      type: 'rain.replanned' as const,
      saved_m3: 500,
      by_farmer_m3: { f1: 100, f2: 100 },
    };
    const entries = ledger.entriesFor(event);
    expect(entries).toHaveLength(2);
    expect(entries.reduce((s, e) => s + e.volume_m3, 0)).toBe(200);
  });

  it('emits entries in sorted farmer order so ids are stable across runs', () => {
    const event = {
      id: 'r1',
      at: '2026-06-01T00:00:00Z',
      canal_id: 'c1',
      actor: { kind: 'system' as const, id: 's' },
      type: 'rain.replanned' as const,
      saved_m3: 300,
      by_farmer_m3: { f9: 100, f1: 100, f5: 100 },
    };
    expect(ledger.entriesFor(event).map((e) => e.from)).toEqual([
      'farmer:f1:quota',
      'farmer:f5:quota',
      'farmer:f9:quota',
    ]);
  });

  it('gini is 0 for the degenerate inputs and correct for a known split', () => {
    expect(ledger.gini([])).toBe(0);
    expect(ledger.gini([50])).toBe(0);
    expect(ledger.gini([0, 0, 0])).toBe(0);
    expect(ledger.gini([100, 100, 100])).toBeCloseTo(0, 12);
    // [100, 0, 0]: sum|xi-xj| = 4*100 = 400 ; 2*3*100 = 600 ; G = 2/3
    expect(ledger.gini([100, 0, 0])).toBeCloseTo(2 / 3, 12);
  });

  it('gini is order-independent', () => {
    const a = [40, 10, 90, 5];
    expect(ledger.gini(a)).toBeCloseTo(ledger.gini([...a].reverse()), 12);
  });
});

/* ================================================================== roster */

describe('F-11 - roster engine boundaries and the warabandi mode', () => {
  const canal = {
    id: 'c1',
    name: 'demo',
    length_m: 3000,
    head_discharge_m3s: 0.15,
    seepage_k_per_m: 0.00012,
    manning_n: 0.025,
    bed_slope: 0.0004,
    hydraulic_radius_m: 0.35,
    lined: false,
  };
  const outlets = [
    { id: 'o1', canal_id: 'c1', name: 'H', chainage_m: 300 },
    { id: 'o2', canal_id: 'c1', name: 'M', chainage_m: 650 },
    { id: 'o3', canal_id: 'c1', name: 'T', chainage_m: 1000 },
  ];
  const window = {
    id: 'w',
    canal_id: 'c1',
    start: '2026-06-01T06:00:00.000Z',
    end: '2026-06-01T18:00:00.000Z',
    discharge_m3s: 0.15,
  };
  const demand = (farmer: string, outlet: string, v: number, priority = 1) => ({
    farmer_id: farmer,
    outlet_id: outlet,
    volume_m3: v,
    priority,
  });

  it('is deterministic: identical input yields an identical roster', () => {
    const input = {
      canal,
      outlets,
      window,
      demands: [demand('f3', 'o3', 300), demand('f1', 'o1', 200), demand('f2', 'o2', 250)],
      mode: 'equal_water' as const,
    };
    expect(JSON.stringify(rosterEngine.build(input, 'R'))).toBe(
      JSON.stringify(rosterEngine.build(input, 'R')),
    );
  });

  it('orders strictly head-to-tail by chainage', () => {
    const r = rosterEngine.build(
      {
        canal,
        outlets,
        window,
        demands: [demand('f3', 'o3', 100), demand('f1', 'o1', 100), demand('f2', 'o2', 100)],
        mode: 'equal_water',
      },
      'R',
    );
    expect(r.turns.map((t) => t.outlet_id)).toEqual(['o1', 'o2', 'o3']);
  });

  it('waits for the wetting front before the first turn at a downstream outlet', () => {
    const r = rosterEngine.build(
      { canal, outlets, window, demands: [demand('f2', 'o2', 100)], mode: 'equal_water' },
      'R',
    );
    const t = r.turns[0]!;
    const startMs = new Date(t.start).getTime();
    const windowStartMs = new Date(window.start).getTime();
    expect(startMs - windowStartMs).toBeCloseTo(t.lag_h * 3600 * 1000, 0);
    expect(t.lag_h).toBeGreaterThan(0);
  });

  it('F-11: shortfall is keyed by farmer and never double-counted', () => {
    // An outlet that does not exist has Q = 0, so the full demand becomes shortfall.
    const r = rosterEngine.build(
      { canal, outlets, window, demands: [demand('fx', 'NOPE', 100)], mode: 'equal_water' },
      'R',
    );
    expect(r.turns).toHaveLength(0);
    expect(r.shortfall_m3).toEqual({ fx: 100 });
  });

  it('treats a zero or negative demand as no demand, not as a failure', () => {
    for (const v of [0, -50]) {
      const r = rosterEngine.build(
        { canal, outlets, window, demands: [demand('fn', 'o1', v)], mode: 'equal_water' },
        'R',
      );
      expect(r.turns).toHaveLength(0);
      expect(r.shortfall_m3).toEqual({});
    }
  });

  it('reports the whole demand as shortfall when the window is already closed', () => {
    const closed = { ...window, end: window.start };
    const r = rosterEngine.build(
      {
        canal,
        outlets,
        window: closed,
        demands: [demand('f1', 'o1', 100), demand('f2', 'o2', 100)],
        mode: 'equal_water',
      },
      'R',
    );
    expect(r.turns).toHaveLength(0);
    expect(r.shortfall_m3).toEqual({ f1: 100, f2: 100 });
  });

  it('F-11: equal_hours allocates the window by demand fraction and delivers at outlet flow', () => {
    const r = rosterEngine.build(
      {
        canal,
        outlets,
        window,
        demands: [demand('f1', 'o1', 800), demand('f2', 'o2', 800), demand('f3', 'o3', 800)],
        mode: 'equal_hours',
      },
      'R',
    );
    // Equal demands over a 12 h window -> 4 h each, laid end to end.
    const hours = r.turns.map(
      (t) => (new Date(t.end).getTime() - new Date(t.start).getTime()) / 3_600_000,
    );
    expect(hours).toEqual([4, 4, 4]);
    // Delivered volume = Q(x_i) * duration, so it DECAYS with chainage: this is the tail-end
    // deficit warabandi exhibits, and the reason Jadal exists.
    const vols = r.turns.map((t) => t.planned_volume_m3);
    expect(vols[0]).toBeGreaterThan(vols[1]!);
    expect(vols[1]).toBeGreaterThan(vols[2]!);
    // Every turn is capped by its own outlet flow.
    for (const t of r.turns) {
      expect(t.planned_volume_m3).toBeCloseTo(t.expected_flow_m3s * 4 * 3600, 3);
    }
  });

  it('F-11: equal_hours delivers far more than each farmer asked for, but never over-reports need met', () => {
    const r = rosterEngine.build(
      {
        canal,
        outlets,
        window,
        demands: [demand('f1', 'o1', 800), demand('f2', 'o2', 800), demand('f3', 'o3', 800)],
        mode: 'equal_hours',
      },
      'R',
    );
    const delivered = r.turns.reduce((s, t) => s + t.planned_volume_m3, 0);
    // The mode hands out the whole window, not the demand: 5997 m3 delivered against 2400 asked.
    expect(delivered).toBeGreaterThan(2400);
    // needMet is capped at 100%, so it cannot expose the over-delivery.
    for (const row of rosterEngine.needMet(
      {
        canal,
        outlets,
        window,
        demands: [demand('f1', 'o1', 800), demand('f2', 'o2', 800), demand('f3', 'o3', 800)],
        mode: 'equal_hours',
      },
      r,
    )) {
      expect(row.pct).toBeLessThanOrEqual(100);
    }
  });

  it('equal_hours falls back to an even split when total demand is zero', () => {
    const r = rosterEngine.build(
      {
        canal,
        outlets,
        window,
        demands: [demand('f1', 'o1', 0), demand('f2', 'o2', 0)],
        mode: 'equal_hours',
      },
      'R',
    );
    expect(r.turns).toHaveLength(2);
    for (const t of r.turns) {
      const h = (new Date(t.end).getTime() - new Date(t.start).getTime()) / 3_600_000;
      expect(h).toBeCloseTo(6, 6);
    }
  });

  it('needMet reports 100% when nothing was demanded', () => {
    const input = { canal, outlets, window, demands: [demand('f0', 'o1', 0)], mode: 'equal_water' as const };
    expect(rosterEngine.needMet(input, rosterEngine.build(input, 'R'))).toEqual([
      { farmer_id: 'f0', outlet_id: 'o1', pct: 100 },
    ]);
  });

  it('pooled needMet aggregates repeated demands for the same farmer and outlet', () => {
    const input = {
      canal,
      outlets,
      window,
      demands: [demand('f1', 'o1', 200), demand('f1', 'o1', 200)],
      mode: 'equal_water' as const,
    };
    const r = rosterEngine.build(input, 'R');
    const rows = rosterEngine.needMet(input, r);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.pct).toBe(rows[1]!.pct); // same pooled figure on both rows
  });
});

/* ================================================================== policy */

describe('F-09 - policy rejects non-finite volumes', () => {
  const balances = {
    canal_supply: 1000,
    buffer: 500,
    conveyance_losses: 0,
    farmers: { f1: { quota: 200, delivered: 0 } },
  };

  it('canGrantUrgent rejects NaN, Infinity, zero and negative volumes', () => {
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      expect(policy.canGrantUrgent(balances, 'f1', v).ok).toBe(false);
    }
  });

  it('F-09: canGrantBuffer previously APPROVED a NaN volume; it must now reject it', () => {
    const r = policy.canGrantBuffer(balances, 'f1', Number.NaN, 100, 0);
    expect(r.ok).toBe(false);
    // max_m3 still reports the usable cap so a caller can offer a partial grant.
    expect(r.max_m3).toBe(25);
  });

  it('canGrantBuffer rejects non-positive volumes but still reports the cap', () => {
    expect(policy.canGrantBuffer(balances, 'f1', 0, 100, 0).ok).toBe(false);
    expect(policy.canGrantBuffer(balances, 'f1', -5, 100, 0).ok).toBe(false);
    expect(policy.canGrantBuffer(balances, 'f1', 10, 100, 0).max_m3).toBe(25);
  });

  it('caps the buffer at 25% of the weekly entitlement', () => {
    expect(policy.canGrantBuffer(balances, 'f1', 25, 100, 0).ok).toBe(true);
    expect(policy.canGrantBuffer(balances, 'f1', 25.01, 100, 0).ok).toBe(false);
  });

  it('saturates remainingCap at zero when the cap is already exhausted', () => {
    const r = policy.canGrantBuffer(balances, 'f1', 1, 100, 999);
    expect(r.ok).toBe(false);
    expect(r.max_m3).toBe(0);
  });

  it('reports an exhausted reserve ahead of the weekly cap', () => {
    const dry = { ...balances, buffer: 0 };
    expect(policy.canGrantBuffer(dry, 'f1', 10, 100, 0).reason).toContain('exhausted');
  });

  it('clamps negative entitlement and negative granted to zero, never raising the cap', () => {
    expect(policy.canGrantBuffer(balances, 'f1', 1, -100, 0).max_m3).toBe(0);
    expect(policy.canGrantBuffer(balances, 'f1', 1, 100, -50).max_m3).toBe(25);
  });

  it('treats an unknown farmer as having no quota', () => {
    expect(policy.canGrantUrgent(balances, 'ghost', 10).ok).toBe(false);
  });
});

/* ================================================================== unit conversion */

describe('mmHaToCubicMeters', () => {
  it('implements the FAO-56 Table 1 identity 1 mm x 1 ha = 10 m3', () => {
    expect(mmHaToCubicMeters(1, 1)).toBe(10);
    expect(mmHaToCubicMeters(50, 2.5)).toBe(1250);
  });

  it('is exact at zero and throws on negative input', () => {
    expect(mmHaToCubicMeters(0, 5)).toBe(0);
    expect(mmHaToCubicMeters(10, 0)).toBe(0);
    expect(() => mmHaToCubicMeters(-1, 1)).toThrow(RangeError);
    expect(() => mmHaToCubicMeters(1, -1)).toThrow(RangeError);
  });
});

/* ================================================================== soil table */

describe('SOIL_AVAILABLE_WATER provenance', () => {
  it('every value lies inside its FAO-56 Table 7.5 range', () => {
    // Ranges read from FAO-56 Rev.1 (2025) Table 7.5, `.ref/fao56-book/FAO56-full.txt` 16112-16131.
    const ranges: Record<string, [number, number]> = {
      sand: [0.05, 0.11],
      loamy_sand: [0.06, 0.12],
      sandy_loam: [0.11, 0.15],
      loam: [0.13, 0.18],
      silt_loam: [0.13, 0.19],
      clay: [0.12, 0.2],
    };
    for (const [soil, [lo, hi]] of Object.entries(ranges)) {
      const v = SOIL_AVAILABLE_WATER[soil as keyof typeof SOIL_AVAILABLE_WATER];
      expect(v, `${soil} = ${v} outside [${lo}, ${hi}]`).toBeGreaterThanOrEqual(lo);
      expect(v, `${soil} = ${v} outside [${lo}, ${hi}]`).toBeLessThanOrEqual(hi);
    }
  });

  it('clay_loam is the documented ASSUMED interpolation, not a tabulated row', () => {
    // Table 7.5 has no "clay loam" class; the value sits between silt clay loam and clay.
    expect(SOIL_AVAILABLE_WATER.clay_loam).toBeCloseTo(0.15, 10);
  });
});
