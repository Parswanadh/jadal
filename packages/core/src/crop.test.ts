import { describe, it, expect } from 'vitest';
import type { CropParams, CropPlan, Plot, WeatherDay } from '../../contracts/dist/index.js';
import { cropEngine, SOIL_AVAILABLE_WATER } from './crop';

describe('cropEngine (Task A2)', () => {
  const sampleParams: CropParams = {
    crop: 'maize',
    kc_ini: 0.3,
    kc_mid: 1.2,
    kc_end: 0.35,
    stage_days: { ini: 20, dev: 35, mid: 40, late: 30 },
    max_height_m: 2.0,
    root_depth_m: { min: 0.6, max: 1.2 },
    depletion_p: 0.5,
    source: 'FAO-56 Table 11 & 12',
  };

  describe('kcOnDay', () => {
    it('returns kc_ini before sowing and during the initial stage', () => {
      expect(cropEngine.kcOnDay(sampleParams, 0)).toEqual({ kc: 0.3, stage: 'ini' });
      expect(cropEngine.kcOnDay(sampleParams, -5)).toEqual({ kc: 0.3, stage: 'ini' });
      expect(cropEngine.kcOnDay(sampleParams, 10)).toEqual({ kc: 0.3, stage: 'ini' });
      expect(cropEngine.kcOnDay(sampleParams, 20)).toEqual({ kc: 0.3, stage: 'ini' });
    });

    it('interpolates linearly during the development stage and matches boundary', () => {
      // dev stage is days 21 to 55 (length = 35)
      // At halfway (17.5 days into dev => day 37.5)
      const midDev = cropEngine.kcOnDay(sampleParams, 37.5);
      expect(midDev.stage).toBe('dev');
      expect(midDev.kc).toBeCloseTo(0.3 + 0.5 * (1.2 - 0.3), 4); // 0.75

      // At end of dev (day 55)
      const endDev = cropEngine.kcOnDay(sampleParams, 55);
      expect(endDev.stage).toBe('dev');
      expect(endDev.kc).toBeCloseTo(1.2, 4);
    });

    it('returns kc_mid during the mid-season stage', () => {
      // mid stage is days 56 to 95 (length = 40)
      expect(cropEngine.kcOnDay(sampleParams, 56)).toEqual({ kc: 1.2, stage: 'mid' });
      expect(cropEngine.kcOnDay(sampleParams, 75)).toEqual({ kc: 1.2, stage: 'mid' });
      expect(cropEngine.kcOnDay(sampleParams, 95)).toEqual({ kc: 1.2, stage: 'mid' });
    });

    it('interpolates linearly during the late-season stage and matches boundary', () => {
      // late stage is days 96 to 125 (length = 30)
      // At halfway (15 days into late => day 110)
      const midLate = cropEngine.kcOnDay(sampleParams, 110);
      expect(midLate.stage).toBe('late');
      expect(midLate.kc).toBeCloseTo(1.2 + 0.5 * (0.35 - 1.2), 4); // 0.775

      // At end of late / season end (day 125)
      const endSeason = cropEngine.kcOnDay(sampleParams, 125);
      expect(endSeason.stage).toBe('late');
      expect(endSeason.kc).toBeCloseTo(0.35, 4);
    });

    it('returns done stage when daysAfterSowing exceeds total season length', () => {
      const pastSeason = cropEngine.kcOnDay(sampleParams, 126);
      expect(pastSeason.stage).toBe('done');
      expect(pastSeason.kc).toBe(0);
    });
  });

  describe('weeklyNeed - FAO-56 section 5 worked examples', () => {
    it('reproduces Groundnut worked example (§5.2) within 0.5 m3', () => {
      // Exact inputs from fao56-model.md §5.1 and §5.2:
      // Area = 1.0 ha, Furrow Ea = 0.65, sandy_loam (theta_FC - theta_WP = 0.13)
      // Mid-season week: ET0 = 5.0 mm/day, Day 3 rain = 15.0 mm (others 0)
      // Groundnut: Zr = 0.80 m, p_base = 0.50, Kc_mid = 1.1325
      const plot: Plot = {
        id: 'plot-gn',
        farmer_id: 'farmer-1',
        outlet_id: 'outlet-1',
        area_ha: 1.0,
        soil: 'sandy_loam',
        lat: 16.5,
        lon: 80.5,
      };

      const plan: CropPlan = {
        id: 'plan-gn',
        plot_id: 'plot-gn',
        crop: 'groundnut',
        sowing_date: '2026-05-01',
        area_fraction: 1.0,
        application_efficiency: 0.65,
        status: 'verified',
      };

      const params: CropParams = {
        crop: 'groundnut',
        kc_ini: 0.4,
        kc_mid: 1.1325, // Adjusted Kc,mid from §5.2
        kc_end: 0.6,
        stage_days: { ini: 25, dev: 35, mid: 45, late: 25 },
        max_height_m: 0.4,
        root_depth_m: { min: 0.5, max: 0.8 },
        depletion_p: 0.5,
        source: 'FAO-56 (2025) Table 6.2; fao56-model.md §5.2',
      };

      // 7-day weather in mid-season (e.g. Day 70 to 76 after sowing: 2026-07-10 to 2026-07-16)
      const weather: WeatherDay[] = [
        { date: '2026-07-10', et0_mm: 5.0, rain_mm: 0 },
        { date: '2026-07-11', et0_mm: 5.0, rain_mm: 0 },
        { date: '2026-07-12', et0_mm: 5.0, rain_mm: 15.0 }, // Convective storm
        { date: '2026-07-13', et0_mm: 5.0, rain_mm: 0 },
        { date: '2026-07-14', et0_mm: 5.0, rain_mm: 0 },
        { date: '2026-07-15', et0_mm: 5.0, rain_mm: 0 },
        { date: '2026-07-16', et0_mm: 5.0, rain_mm: 0 },
      ];

      const need = cropEngine.weeklyNeed({
        plan,
        plot,
        params,
        weather,
        weekStart: '2026-07-10',
      });

      expect(need.crop_plan_id).toBe('plan-gn');
      expect(need.week_start).toBe('2026-07-10');
      expect(need.stage).toBe('mid');
      expect(need.kc).toBeCloseTo(1.1325, 4);

      // Weekly ETc: 7 * 5.0 * 1.1325 = 39.6375 mm
      expect(need.etc_mm).toBeCloseTo(39.638, 2);

      // Effective rain: 0.8 * (15 - 3) = 9.60 mm
      expect(need.effective_rain_mm).toBeCloseTo(9.6, 2);

      // Net irrigation: 39.6375 - 9.60 = 30.0375 mm
      expect(need.net_irrigation_mm).toBeCloseTo(30.038, 2);

      // Gross irrigation: 30.0375 / 0.65 = 46.2115 mm
      expect(need.gross_irrigation_mm).toBeCloseTo(46.212, 2);

      // Target volume: 462.12 m3 within 0.5 m3
      expect(Math.abs(need.volume_m3 - 462.12)).toBeLessThan(0.5);

      // Root-zone bounds for upland crop
      expect(need.bounds).not.toBeNull();
      if (need.bounds) {
        // TAW = 1000 * 0.13 * 0.80 = 104.00 mm
        expect(need.bounds.taw_mm).toBeCloseTo(104.0, 1);
        // p_adj = 0.50 + 0.04 * (5 - 5.6625) = 0.4735 => RAW = 0.4735 * 104 = 49.24 mm
        expect(need.bounds.raw_mm).toBeCloseTo(49.25, 1);
        // Event refill: 10 * (49.25 / 0.65) * 1.0 = 757.69 m3
        expect(Math.abs(need.bounds.event_refill_m3 - 757.69)).toBeLessThan(1.0);
        // Event cap: 10 * (104.0 / 0.65) * 1.0 = 1600.00 m3
        expect(Math.abs(need.bounds.event_cap_m3 - 1600.0)).toBeLessThan(1.0);
      }
    });

    it('reproduces Rice worked example (§5.3) within 0.5 m3', () => {
      // Exact inputs from fao56-model.md §5.1 and §5.3:
      // Area = 1.0 ha, Basin Ea = 0.80
      // Mid-season week: ET0 = 5.0 mm/day, Day 3 rain = 15.0 mm (others 0)
      // Rice: Kc_mid = 1.20, PERC = 3.50 mm/day, bund captures 100% of rain (15.0 mm)
      const plot: Plot = {
        id: 'plot-rice',
        farmer_id: 'farmer-2',
        outlet_id: 'outlet-2',
        area_ha: 1.0,
        soil: 'clay',
        lat: 16.5,
        lon: 80.5,
      };

      const plan: CropPlan = {
        id: 'plan-rice',
        plot_id: 'plot-rice',
        crop: 'rice',
        rice_practice: 'flooded',
        sowing_date: '2026-05-01',
        area_fraction: 1.0,
        application_efficiency: 0.8,
        status: 'verified',
      };

      const params: CropParams = {
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
        source: 'FAO-56 (2025) Table 6.2; fao56-model.md §5.3',
      };

      const weather: WeatherDay[] = [
        { date: '2026-07-10', et0_mm: 5.0, rain_mm: 0 },
        { date: '2026-07-11', et0_mm: 5.0, rain_mm: 0 },
        { date: '2026-07-12', et0_mm: 5.0, rain_mm: 15.0 }, // Rain captured in basin
        { date: '2026-07-13', et0_mm: 5.0, rain_mm: 0 },
        { date: '2026-07-14', et0_mm: 5.0, rain_mm: 0 },
        { date: '2026-07-15', et0_mm: 5.0, rain_mm: 0 },
        { date: '2026-07-16', et0_mm: 5.0, rain_mm: 0 },
      ];

      const need = cropEngine.weeklyNeed({
        plan,
        plot,
        params,
        weather,
        weekStart: '2026-07-10',
      });

      expect(need.crop_plan_id).toBe('plan-rice');
      expect(need.week_start).toBe('2026-07-10');
      expect(need.stage).toBe('mid');
      expect(need.kc).toBeCloseTo(1.2, 4);

      // Weekly ETc: 7 * 5.0 * 1.20 = 42.00 mm
      expect(need.etc_mm).toBeCloseTo(42.0, 2);

      // Effective rain (100% captured up to bund): 15.00 mm
      expect(need.effective_rain_mm).toBeCloseTo(15.0, 2);

      // Net irrigation: (ETc + PERC) - Peff = (42.0 + 24.5) - 15.0 = 51.50 mm
      expect(need.net_irrigation_mm).toBeCloseTo(51.5, 2);

      // Gross irrigation: 51.50 / 0.80 = 64.375 mm
      expect(need.gross_irrigation_mm).toBeCloseTo(64.375, 2);

      // Target volume: 643.75 m3 within 0.5 m3
      expect(Math.abs(need.volume_m3 - 643.75)).toBeLessThan(0.5);

      // Flooded rice uses ponded water balance, so upland root-zone bounds are null
      expect(need.bounds).toBeNull();
    });

    it('scales volume correctly by area and area_fraction', () => {
      const plot: Plot = {
        id: 'plot-split',
        farmer_id: 'farmer-3',
        outlet_id: 'outlet-1',
        area_ha: 2.5,
        soil: 'loam',
        lat: 16.5,
        lon: 80.5,
      };

      const plan: CropPlan = {
        id: 'plan-split',
        plot_id: 'plot-split',
        crop: 'maize',
        sowing_date: '2026-07-01',
        area_fraction: 0.4, // effective area = 1.0 ha
        application_efficiency: 0.65,
        status: 'active',
      };

      const weather: WeatherDay[] = Array.from({ length: 7 }, (_, i) => ({
        date: `2026-07-0${i + 1}`,
        et0_mm: 4.0,
        rain_mm: 0,
      }));

      const need = cropEngine.weeklyNeed({
        plan,
        plot,
        params: sampleParams,
        weather,
        weekStart: '2026-07-01',
      });

      // effective area = 2.5 ha * 0.4 = 1.0 ha
      // volume = gross_irrigation_mm * 10 * 1.0
      expect(need.volume_m3).toBeCloseTo(need.gross_irrigation_mm * 10, 2);
    });

    it('handles zero or negative net irrigation when rain exceeds ETc', () => {
      const plot: Plot = {
        id: 'plot-rain',
        farmer_id: 'farmer-4',
        outlet_id: 'outlet-1',
        area_ha: 1.0,
        soil: 'clay_loam',
        lat: 16.5,
        lon: 80.5,
      };

      const plan: CropPlan = {
        id: 'plan-rain',
        plot_id: 'plot-rain',
        crop: 'maize',
        sowing_date: '2026-07-01',
        area_fraction: 1.0,
        application_efficiency: 0.65,
        status: 'active',
      };

      // Heavy rain: 50 mm rain on day 1 (eff rain = 0.8 * (50-3) = 37.6 mm)
      const weather: WeatherDay[] = [
        { date: '2026-07-01', et0_mm: 2.0, rain_mm: 50.0 },
        ...Array.from({ length: 6 }, (_, i) => ({
          date: `2026-07-0${i + 2}`,
          et0_mm: 2.0,
          rain_mm: 0,
        })),
      ];

      const need = cropEngine.weeklyNeed({
        plan,
        plot,
        params: sampleParams,
        weather,
        weekStart: '2026-07-01',
      });

      expect(need.net_irrigation_mm).toBe(0);
      expect(need.gross_irrigation_mm).toBe(0);
      expect(need.volume_m3).toBe(0);
    });

    it('ignores showers <= 3 mm according to ASSUMED upland effective rain rule', () => {
      const plot: Plot = {
        id: 'plot-shower',
        farmer_id: 'farmer-5',
        outlet_id: 'outlet-1',
        area_ha: 1.0,
        soil: 'loam',
        lat: 16.5,
        lon: 80.5,
      };

      const plan: CropPlan = {
        id: 'plan-shower',
        plot_id: 'plot-shower',
        crop: 'maize',
        sowing_date: '2026-07-01',
        area_fraction: 1.0,
        application_efficiency: 0.65,
        status: 'active',
      };

      // 2 mm rain each day: all <= 3 mm, so effective rain is 0
      const weather: WeatherDay[] = Array.from({ length: 7 }, (_, i) => ({
        date: `2026-07-0${i + 1}`,
        et0_mm: 4.0,
        rain_mm: 2.0,
      }));

      const need = cropEngine.weeklyNeed({
        plan,
        plot,
        params: sampleParams,
        weather,
        weekStart: '2026-07-01',
      });

      expect(need.effective_rain_mm).toBe(0);
      expect(need.net_irrigation_mm).toBe(need.etc_mm);
    });

    it('interpolates root depth dynamically during vegetative growth', () => {
      const plot: Plot = {
        id: 'plot-root',
        farmer_id: 'farmer-6',
        outlet_id: 'outlet-1',
        area_ha: 1.0,
        soil: 'sandy_loam',
        lat: 16.5,
        lon: 80.5,
      };

      const plan: CropPlan = {
        id: 'plan-root',
        plot_id: 'plot-root',
        crop: 'maize',
        sowing_date: '2026-07-01',
        area_fraction: 1.0,
        application_efficiency: 0.65,
        status: 'active',
      };

      // Sown on 2026-07-01, week is day 1 to 7 (initial stage, midDay = day 4)
      // L_grow = ini (20) + dev (35) = 55 days
      // At day 4, Zr = zrMin + (zrMax - zrMin) * (4 / 55) = 0.6 + 0.6 * (4/55) = 0.6436 m
      const weather: WeatherDay[] = Array.from({ length: 7 }, (_, i) => ({
        date: `2026-07-0${i + 1}`,
        et0_mm: 4.0,
        rain_mm: 0,
      }));

      const need = cropEngine.weeklyNeed({
        plan,
        plot,
        params: sampleParams,
        weather,
        weekStart: '2026-07-01',
      });

      expect(need.stage).toBe('ini');
      expect(need.bounds).not.toBeNull();
      // TAW = 1000 * 0.13 * 0.6436 = ~83.67 mm
      expect(need.bounds!.taw_mm).toBeLessThan(1000 * 0.13 * 1.2); // Less than maximum TAW
      expect(need.bounds!.taw_mm).toBeGreaterThan(1000 * 0.13 * 0.6); // Greater than minimum TAW
    });

    it('clamps p adjustment within physical bounds [0.1, 0.8]', () => {
      const plot: Plot = {
        id: 'plot-clamp',
        farmer_id: 'farmer-7',
        outlet_id: 'outlet-1',
        area_ha: 1.0,
        soil: 'loam',
        lat: 16.5,
        lon: 80.5,
      };

      const plan: CropPlan = {
        id: 'plan-clamp',
        plot_id: 'plot-clamp',
        crop: 'maize',
        sowing_date: '2026-07-01',
        area_fraction: 1.0,
        application_efficiency: 0.65,
        status: 'active',
      };

      // Very extreme evaporative demand: ET0 = 55 mm/day => ETc = 0.3 * 55 = 16.5 mm/day
      // p = 0.50 + 0.04 * (5 - 16.5) = 0.50 - 0.46 = 0.04 < 0.1 => clamped to 0.1
      const weatherExtreme: WeatherDay[] = Array.from({ length: 7 }, (_, i) => ({
        date: `2026-07-0${i + 1}`,
        et0_mm: 55.0,
        rain_mm: 0,
      }));

      const needExtreme = cropEngine.weeklyNeed({
        plan,
        plot,
        params: sampleParams,
        weather: weatherExtreme,
        weekStart: '2026-07-01',
      });

      // raw_mm / taw_mm = p_adj, should be clamped at 0.1
      expect(needExtreme.bounds!.raw_mm / needExtreme.bounds!.taw_mm).toBeCloseTo(0.1, 2);

      // Low evaporative demand with high base p:
      // p_base = 0.70, ET0 = 1.0 mm/day => ETc = 0.3 mm/day
      // p = 0.70 + 0.04 * (5 - 0.3) = 0.70 + 0.188 = 0.888 > 0.8 => clamped to 0.8
      const weatherLow: WeatherDay[] = Array.from({ length: 7 }, (_, i) => ({
        date: `2026-07-0${i + 1}`,
        et0_mm: 1.0,
        rain_mm: 0,
      }));

      const needLow = cropEngine.weeklyNeed({
        plan,
        plot,
        params: { ...sampleParams, depletion_p: 0.7 },
        weather: weatherLow,
        weekStart: '2026-07-01',
      });

      expect(needLow.bounds!.raw_mm / needLow.bounds!.taw_mm).toBeCloseTo(0.8, 2);
    });

    it('executes weeklyNeed cleanly for every crop in crop-params.json', async () => {
      const cropParamsList = (await import('./data/crop-params.json')).default as CropParams[];
      for (const params of cropParamsList) {
        const plot: Plot = {
          id: `plot-${params.crop}`,
          farmer_id: 'farmer-test',
          outlet_id: 'outlet-1',
          area_ha: 1.0,
          soil: 'clay_loam',
          lat: 16.5,
          lon: 80.5,
        };

        const plan: CropPlan = {
          id: `plan-${params.crop}`,
          plot_id: `plot-${params.crop}`,
          crop: params.crop,
          rice_practice: params.variant as 'flooded' | 'intermittent' | undefined,
          sowing_date: '2026-07-01',
          area_fraction: 1.0,
          application_efficiency: 0.7,
          status: 'active',
        };

        const weather: WeatherDay[] = Array.from({ length: 7 }, (_, i) => ({
          date: `2026-07-0${i + 1}`,
          et0_mm: 5.0,
          rain_mm: i === 2 ? 10.0 : 0,
        }));

        const need = cropEngine.weeklyNeed({
          plan,
          plot,
          params,
          weather,
          weekStart: '2026-07-01',
        });

        expect(need.volume_m3).toBeGreaterThan(0);
        expect(need.etc_mm).toBeGreaterThan(0);
        expect(['ini', 'dev', 'mid', 'late', 'done']).toContain(need.stage);
      }
    });
  });

  describe('seasonNeed', () => {
    it('aggregates multiple weeks and computes total_m3 correctly', () => {
      const plot: Plot = {
        id: 'plot-season',
        farmer_id: 'farmer-1',
        outlet_id: 'outlet-1',
        area_ha: 1.0,
        soil: 'sandy_loam',
        lat: 16.5,
        lon: 80.5,
      };

      const plan: CropPlan = {
        id: 'plan-season',
        plot_id: 'plot-season',
        crop: 'maize',
        sowing_date: '2026-07-01',
        area_fraction: 1.0,
        application_efficiency: 0.65,
        status: 'active',
      };

      // 4 weeks of weather (28 days)
      const weather: WeatherDay[] = Array.from({ length: 28 }, (_, i) => {
        const d = i + 1;
        const dateStr = d < 10 ? `2026-07-0${d}` : `2026-07-${d}`;
        return {
          date: dateStr,
          et0_mm: 5.0,
          rain_mm: 0,
        };
      });

      const season = cropEngine.seasonNeed({
        plan,
        plot,
        params: sampleParams,
        weather,
      });

      expect(season.weeks.length).toBe(4);
      const expectedTotal = season.weeks.reduce((sum, w) => sum + w.volume_m3, 0);
      expect(season.total_m3).toBeCloseTo(expectedTotal, 2);
      expect(season.total_m3).toBeGreaterThan(0);
    });
  });

  describe('SOIL_AVAILABLE_WATER lookup', () => {
    it('provides correct FAO-56 available water capacities for all soil types', () => {
      expect(SOIL_AVAILABLE_WATER.sand).toBe(0.08);
      expect(SOIL_AVAILABLE_WATER.sandy_loam).toBe(0.13);
      expect(SOIL_AVAILABLE_WATER.clay).toBe(0.16);
    });
  });
});
