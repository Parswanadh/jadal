/**
 * FAO-56 Eq. 6.18 / Eq. 6.21 climatic Kc adjustment — validity-domain and no-op conformance.
 *
 * Handoff P7: the correction is implemented but opt-in because `WeatherDay` has no humidity/wind
 * field. These tests pin (a) the exact source validity domain from
 * `docs/research/fao56-crop-tables.md` §4.2.1 (u2 1-6 m/s, RHmin 20-80 %, h 0.1-10 m), (b) that we
 * do NOT extrapolate outside it, and (c) that the `adjustCropParamsForClimate` helper is a strict
 * no-op — same object reference, bit-for-bit output — whenever the optional climate inputs are
 * absent, so existing `weeklyNeed` outputs cannot drift.
 *
 * Values asserted here are derived from the cited source formula, never copied from a run.
 */

import { describe, expect, it } from 'vitest';
import type { CropParams, CropPlan, Plot, WeatherDay } from '@jadal/contracts';

import { adjustKcForClimate, adjustCropParamsForClimate } from './crop';
import { cropEngine } from './crop';

/* ------------------------------------------------------------------ fixtures */

const GROUNDNUT: CropParams = {
  crop: 'groundnut',
  kc_ini: 0.4,
  kc_mid: 1.05, // MEASURED: FAO-56 (2025) Table 6.2
  kc_end: 0.6, // > 0.45, so Eq. 6.21 applies
  stage_days: { ini: 25, dev: 35, mid: 45, late: 25 },
  max_height_m: 0.5,
  root_depth_m: { min: 0.5, max: 1.0 },
  depletion_p: 0.5,
  source: 'FAO-56 (2025) Table 6.2 / Table 8.2',
};

const PLOT: Plot = {
  id: 'p1',
  farmer_id: 'f1',
  outlet_id: 'o1',
  area_ha: 1.0,
  soil: 'sandy_loam',
  lat: 16.5,
  lon: 80.5,
};

const PLAN: CropPlan = {
  id: 'cp1',
  plot_id: 'p1',
  crop: 'groundnut',
  sowing_date: '2025-01-01',
  area_fraction: 1.0,
  application_efficiency: 0.65,
  status: 'active',
};

/** Seven consecutive days starting `offset` days after 2025-01-01, rain on day index 2. */
function week(offset: number, et0: number, rain: number): WeatherDay[] {
  const base = Date.UTC(2025, 0, 1);
  return Array.from({ length: 7 }, (_, i) => ({
    date: new Date(base + (offset + i) * 86_400_000).toISOString().slice(0, 10),
    et0_mm: et0,
    rain_mm: i === 2 ? rain : 0,
  }));
}

/** The equation's `(h/3)^0.3` factor, re-derived in the test from the source formula. */
const hFactor = (h: number) => Math.pow(h / 3, 0.3);

/* ================================================================== validity domain */

describe('adjustKcForClimate — validity domain', () => {
  it('adjusts at the exact lower/upper bounds of u2 and RHmin (bounds are inclusive)', () => {
    const h = 0.5;
    // u2 = 1 m/s (lower bound): bracket = 0.04*(1-2) - 0.004*(45-45) = -0.04
    expect(adjustKcForClimate(1.05, h, 1, 45)).toBeCloseTo(1.05 - 0.04 * hFactor(h), 12);
    // u2 = 6 m/s (upper bound), RHmin = 45: bracket = 0.04*(6-2) = +0.16
    expect(adjustKcForClimate(1.05, h, 6, 45)).toBeCloseTo(1.05 + 0.16 * hFactor(h), 12);
    // RHmin = 20 % (lower bound), u2 = 2: bracket = -0.004*(20-45) = +0.10
    expect(adjustKcForClimate(1.05, h, 2, 20)).toBeCloseTo(1.05 + 0.1 * hFactor(h), 12);
    // RHmin = 80 % (upper bound), u2 = 2: bracket = -0.004*(80-45) = -0.14
    expect(adjustKcForClimate(1.05, h, 2, 80)).toBeCloseTo(1.05 - 0.14 * hFactor(h), 12);
    // h = 0.1 m and h = 10 m (bounds inclusive)
    expect(adjustKcForClimate(1.05, 0.1, 4, 20)).toBeCloseTo(1.05 + 0.18 * hFactor(0.1), 12);
    expect(adjustKcForClimate(1.05, 10, 4, 20)).toBeCloseTo(1.05 + 0.18 * hFactor(10), 12);
  });

  it('is an exact no-op just outside the domain (does not extrapolate)', () => {
    const h = 0.5;
    // Just outside each bound: 0.999 / 6.001 m/s, 19.999 / 80.001 %.
    expect(adjustKcForClimate(1.05, h, 0.999, 45)).toBe(1.05);
    expect(adjustKcForClimate(1.05, h, 6.001, 45)).toBe(1.05);
    expect(adjustKcForClimate(1.05, h, 2, 19.999)).toBe(1.05);
    expect(adjustKcForClimate(1.05, h, 2, 80.001)).toBe(1.05);
    // Just outside the crop-height bracket.
    expect(adjustKcForClimate(1.05, 0.0999, 4, 20)).toBe(1.05);
    expect(adjustKcForClimate(1.05, 10.001, 4, 20)).toBe(1.05);
    // Unrealistic magnitudes remain no-ops, not clamped adjustments.
    expect(adjustKcForClimate(1.05, 0, 4, 20)).toBe(1.05);
    expect(adjustKcForClimate(1.05, 100, 4, 20)).toBe(1.05);
  });

  it('is a no-op when either climate input is absent or non-finite', () => {
    expect(adjustKcForClimate(1.05, 0.5, null, 55)).toBe(1.05);
    expect(adjustKcForClimate(1.05, 0.5, undefined, 55)).toBe(1.05);
    expect(adjustKcForClimate(1.05, 0.5, 2.2, null)).toBe(1.05);
    expect(adjustKcForClimate(1.05, 0.5, 2.2, undefined)).toBe(1.05);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(adjustKcForClimate(1.05, 0.5, bad, 45)).toBe(1.05);
      expect(adjustKcForClimate(1.05, 0.5, 2, bad)).toBe(1.05);
      expect(adjustKcForClimate(1.05, bad, 2, 45)).toBe(1.05);
    }
  });

  it('is exactly the tabulated Kc at the reference climate (u2 = 2, RHmin = 45)', () => {
    expect(adjustKcForClimate(1.15, 0.4, 2, 45)).toBe(1.15);
  });

  it('raises Kc in a hot dry windy climate and lowers it in a humid calm one', () => {
    expect(adjustKcForClimate(1.05, 2.0, 4.0, 20)).toBeGreaterThan(1.05);
    expect(adjustKcForClimate(1.05, 2.0, 1.0, 80)).toBeLessThan(1.05);
  });
});

/* ================================================================== helper contract */

describe('adjustCropParamsForClimate — strict no-op unless climate inputs fire', () => {
  it('returns the SAME params reference when climate is omitted or empty', () => {
    expect(adjustCropParamsForClimate(GROUNDNUT)).toBe(GROUNDNUT);
    expect(adjustCropParamsForClimate(GROUNDNUT, {})).toBe(GROUNDNUT);
  });

  it('returns the SAME params reference when either input is null/absent', () => {
    expect(adjustCropParamsForClimate(GROUNDNUT, { wind_u2_ms: 2.2 })).toBe(GROUNDNUT);
    expect(adjustCropParamsForClimate(GROUNDNUT, { rh_min_pct: 55 })).toBe(GROUNDNUT);
    expect(adjustCropParamsForClimate(GROUNDNUT, { wind_u2_ms: null, rh_min_pct: 55 })).toBe(
      GROUNDNUT,
    );
    expect(adjustCropParamsForClimate(GROUNDNUT, { wind_u2_ms: 2.2, rh_min_pct: null })).toBe(
      GROUNDNUT,
    );
  });

  it('returns the SAME params reference for out-of-domain inputs', () => {
    expect(adjustCropParamsForClimate(GROUNDNUT, { wind_u2_ms: 0.5, rh_min_pct: 55 })).toBe(
      GROUNDNUT,
    );
    expect(adjustCropParamsForClimate(GROUNDNUT, { wind_u2_ms: 99, rh_min_pct: 55 })).toBe(
      GROUNDNUT,
    );
    expect(adjustCropParamsForClimate(GROUNDNUT, { wind_u2_ms: 2.2, rh_min_pct: 5 })).toBe(
      GROUNDNUT,
    );
    expect(adjustCropParamsForClimate(GROUNDNUT, { wind_u2_ms: 2.2, rh_min_pct: 95 })).toBe(
      GROUNDNUT,
    );
  });

  it('returns the SAME params reference at the zero-adjustment reference climate', () => {
    // u2 = 2, RHmin = 45 makes the bracket exactly 0, so no copy is made.
    expect(adjustCropParamsForClimate(GROUNDNUT, { wind_u2_ms: 2, rh_min_pct: 45 })).toBe(
      GROUNDNUT,
    );
  });

  it('returns an adjusted copy when both in-domain inputs are supplied, without mutating input', () => {
    const adjusted = adjustCropParamsForClimate(GROUNDNUT, { wind_u2_ms: 2.2, rh_min_pct: 55 });
    expect(adjusted).not.toBe(GROUNDNUT);
    // Documented groundnut case: 1.15 -> 1.1325164 at h = 0.4; here kc_mid 1.05 and h = 0.5.
    const bracket = 0.04 * (2.2 - 2) - 0.004 * (55 - 45); // -0.032
    expect(adjusted.kc_mid).toBeCloseTo(1.05 + bracket * hFactor(0.5), 12);
    // kc_end 0.6 > 0.45, so Eq. 6.21 applies to it too.
    expect(adjusted.kc_end).toBeCloseTo(0.6 + bracket * hFactor(0.5), 12);
    // The caller's object is untouched.
    expect(GROUNDNUT.kc_mid).toBe(1.05);
    expect(GROUNDNUT.kc_end).toBe(0.6);
  });

  it('never adjusts kc_end at or below the 0.45 threshold, but still adjusts kc_mid', () => {
    const dryGrain: CropParams = { ...GROUNDNUT, kc_end: 0.45 };
    const adjusted = adjustCropParamsForClimate(dryGrain, { wind_u2_ms: 2.2, rh_min_pct: 55 });
    expect(adjusted.kc_end).toBe(0.45); // Eq. 6.21 governing rule: no adjustment
    expect(adjusted.kc_mid).toBeLessThan(1.05); // Eq. 6.18 still applies
  });
});

/* ================================================================== weeklyNeed integration */

describe('weeklyNeed — existing outputs are unchanged without climate inputs', () => {
  const weather = week(60, 5.0, 15.0);

  function need(climate: { wind_u2_ms?: number | null; rh_min_pct?: number | null }) {
    return cropEngine.weeklyNeed({
      plan: PLAN,
      plot: PLOT,
      params: GROUNDNUT,
      weather,
      weekStart: weather[0]!.date,
      ...climate,
    });
  }

  it('omitted vs explicit-null vs out-of-domain inputs produce identical output', () => {
    const baseline = need({});
    const explicitNulls = need({ wind_u2_ms: null, rh_min_pct: null });
    const outOfDomain = need({ wind_u2_ms: 0.4, rh_min_pct: 95 });
    expect(explicitNulls).toEqual(baseline);
    expect(outOfDomain).toEqual(baseline);
    // Regression pin for the shipped groundnut fixture (see models.audit.test.ts F-01).
    expect(baseline.volume_m3).toBeCloseTo(417.69, 2);
  });

  it('a supplied in-domain climate DOES fire and changes the volume', () => {
    const baseline = need({});
    const withClimate = need({ wind_u2_ms: 2.2, rh_min_pct: 55 });
    expect(withClimate.kc).toBeLessThan(baseline.kc);
    expect(withClimate.volume_m3).toBeLessThan(baseline.volume_m3);
  });
});
