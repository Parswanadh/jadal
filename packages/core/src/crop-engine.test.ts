import { describe, expect, it } from "vitest";
import type { CropPlan, Plot, WeatherDay } from "@jadal/contracts";
import { cropEngine } from "./crop-engine";
import { getCropParams } from "./crop-params";

describe("A2: Crop Engine", () => {
  describe("FAO-56 Kc curve interpolation at stage boundaries", () => {
    const maizeParams = getCropParams("maize");
    // Maize stage_days: ini: 20, dev: 35, mid: 40, late: 30
    // L_ini = 20, t2 = 55, t3 = 95, t4 = 125
    // kc_ini = 0.30, kc_mid = 1.20, kc_end = 0.35

    it("evaluates initial stage and negative/zero days", () => {
      const dayZero = cropEngine.kcOnDay(maizeParams, 0);
      expect(dayZero.kc).toBe(maizeParams.kc_ini);
      expect(dayZero.stage).toBe("ini");

      const dayNeg = cropEngine.kcOnDay(maizeParams, -5);
      expect(dayNeg.kc).toBe(maizeParams.kc_ini);
      expect(dayNeg.stage).toBe("ini");

      const day1 = cropEngine.kcOnDay(maizeParams, 1);
      expect(day1.kc).toBe(maizeParams.kc_ini);
      expect(day1.stage).toBe("ini");

      const day20 = cropEngine.kcOnDay(maizeParams, 20);
      expect(day20.kc).toBe(maizeParams.kc_ini);
      expect(day20.stage).toBe("ini");
    });


    it("interpolates linearly across development stage", () => {
      // Day 20 + 17.5 = Day 37.5 -> midpoint
      const midDev = cropEngine.kcOnDay(maizeParams, 37.5);
      const expectedMid = (maizeParams.kc_ini + maizeParams.kc_mid) / 2;
      expect(midDev.kc).toBeCloseTo(expectedMid, 4);
      expect(midDev.stage).toBe("dev");

      const endDev = cropEngine.kcOnDay(maizeParams, 55);
      expect(endDev.kc).toBeCloseTo(maizeParams.kc_mid, 4);
      expect(endDev.stage).toBe("dev");
    });

    it("evaluates mid-season stage", () => {
      const mid1 = cropEngine.kcOnDay(maizeParams, 56);
      expect(mid1.kc).toBe(maizeParams.kc_mid);
      expect(mid1.stage).toBe("mid");

      const midEnd = cropEngine.kcOnDay(maizeParams, 95);
      expect(midEnd.kc).toBe(maizeParams.kc_mid);
      expect(midEnd.stage).toBe("mid");
    });

    it("interpolates linearly across late-season stage", () => {
      const midLate = cropEngine.kcOnDay(maizeParams, 110);
      const expectedLate = (maizeParams.kc_mid + maizeParams.kc_end) / 2;
      expect(midLate.kc).toBeCloseTo(expectedLate, 4);
      expect(midLate.stage).toBe("late");

      const endLate = cropEngine.kcOnDay(maizeParams, 125);
      expect(endLate.kc).toBeCloseTo(maizeParams.kc_end, 4);
      expect(endLate.stage).toBe("late");
    });

    it("evaluates harvested / done stage", () => {
      const done = cropEngine.kcOnDay(maizeParams, 130);
      expect(done.kc).toBe(maizeParams.kc_end);
      expect(done.stage).toBe("done");
    });
  });

  describe("Reproducing worked numeric examples from docs/research/fao56-model.md §5", () => {
    // 7-day mid-season week in late July
    // ET0 = 5.0 mm/day, Day 3 rain = 15.0 mm, other days rain = 0
    const weekWeather: WeatherDay[] = [
      { date: "2026-07-21", et0_mm: 5.0, rain_mm: 0 },
      { date: "2026-07-22", et0_mm: 5.0, rain_mm: 0 },
      { date: "2026-07-23", et0_mm: 5.0, rain_mm: 15.0 }, // Convective storm on Day 3
      { date: "2026-07-24", et0_mm: 5.0, rain_mm: 0 },
      { date: "2026-07-25", et0_mm: 5.0, rain_mm: 0 },
      { date: "2026-07-26", et0_mm: 5.0, rain_mm: 0 },
      { date: "2026-07-27", et0_mm: 5.0, rain_mm: 0 },
    ];

    it("reproduces §5.2 Plot 1: Groundnut (462.12 m3 within 0.5 m3)", () => {
      const groundnutPlot: Plot = {
        id: "p_gn",
        farmer_id: "f_gn",
        outlet_id: "o1",
        area_ha: 1.0,
        soil: "sandy_loam", // Red chalka soil, AWC = 0.13 m3/m3
        lat: 16.5,
        lon: 80.4,
      };

      const groundnutPlan: CropPlan = {
        id: "cp_gn",
        plot_id: "p_gn",
        crop: "groundnut",
        sowing_date: "2026-05-15", // Sown ~67 days prior -> mid-season stage
        area_fraction: 1.0,
        application_efficiency: 0.65, // Furrow irrigation
        status: "active",
      };

      // Groundnut params with climatically adjusted kc_mid (1.1325) and mid-season root depth 0.80m as in §5.2
      const baseParams = getCropParams("groundnut");
      const gnParams = {
        ...baseParams,
        kc_mid: 1.1325,
        root_depth_m: { min: 0.5, max: 0.8 },
      };

      const result = cropEngine.weeklyNeed({
        plan: groundnutPlan,
        plot: groundnutPlot,
        params: gnParams,
        weather: weekWeather,
        weekStart: "2026-07-21",
      });

      // Target volume: 462.12 m3 (within 0.5 m3)
      expect(result.volume_m3).toBeCloseTo(462.12, 1);
      expect(Math.abs(result.volume_m3 - 462.12)).toBeLessThan(0.5);

      // Verify intermediate values:
      // ETc = 39.638 mm
      expect(result.etc_mm).toBeCloseTo(39.638, 2);
      // Peff = 9.60 mm
      expect(result.effective_rain_mm).toBeCloseTo(9.6, 2);
      // Net = 30.038 mm
      expect(result.net_irrigation_mm).toBeCloseTo(30.038, 2);
      // Gross = 46.212 mm
      expect(result.gross_irrigation_mm).toBeCloseTo(46.212, 2);

      // Bounds check:
      expect(result.bounds).not.toBeNull();
      // TAW = 104 mm
      expect(result.bounds!.taw_mm).toBeCloseTo(104.0, 1);
      // RAW ~ 49.25 mm
      expect(result.bounds!.raw_mm).toBeCloseTo(49.25, 1);
      // Event refill m3 ~ 757.6 m3
      expect(result.bounds!.event_refill_m3).toBeCloseTo(757.6, 0);
      // Event cap m3 ~ 1600.0 m3
      expect(result.bounds!.event_cap_m3).toBeCloseTo(1600.0, 0);
    });

    it("reproduces §5.3 Plot 2: Lowland Paddy Rice (643.75 m3 within 0.5 m3)", () => {
      const ricePlot: Plot = {
        id: "p_rice",
        farmer_id: "f_rice",
        outlet_id: "o1",
        area_ha: 1.0,
        soil: "clay", // Heavy vertisol
        lat: 16.5,
        lon: 80.4,
      };

      const ricePlan: CropPlan = {
        id: "cp_rice",
        plot_id: "p_rice",
        crop: "rice",
        sowing_date: "2026-05-15", // Sown ~67 days prior -> mid-season stage
        area_fraction: 1.0,
        application_efficiency: 0.8, // Level basin
        rice_practice: "flooded",
        status: "active",
      };

      const riceParams = getCropParams("rice");

      const result = cropEngine.weeklyNeed({
        plan: ricePlan,
        plot: ricePlot,
        params: riceParams,
        weather: weekWeather,
        weekStart: "2026-07-21",
      });

      // Target volume: 643.75 m3 (within 0.5 m3)
      expect(result.volume_m3).toBeCloseTo(643.75, 1);
      expect(Math.abs(result.volume_m3 - 643.75)).toBeLessThan(0.5);

      // ETc = 42.0 mm
      expect(result.etc_mm).toBeCloseTo(42.0, 2);
      // Peff = 15.0 mm (100% captured in flooded basin)
      expect(result.effective_rain_mm).toBeCloseTo(15.0, 2);
      // Net = 51.5 mm (42 + 24.5 - 15)
      expect(result.net_irrigation_mm).toBeCloseTo(51.5, 2);
      // Gross = 64.375 mm
      expect(result.gross_irrigation_mm).toBeCloseTo(64.375, 2);
      // Bounds: null for flooded rice
      expect(result.bounds).toBeNull();
    });

    it("computes seasonNeed across multi-week weather series", () => {
      const ricePlot: Plot = {
        id: "p_rice",
        farmer_id: "f_rice",
        outlet_id: "o1",
        area_ha: 1.0,
        soil: "clay",
        lat: 16.5,
        lon: 80.4,
      };

      const ricePlan: CropPlan = {
        id: "cp_rice",
        plot_id: "p_rice",
        crop: "rice",
        sowing_date: "2026-07-21",
        area_fraction: 1.0,
        application_efficiency: 0.8,
        status: "active",
      };

      // 14 days of weather (2 weeks)
      const twoWeeksWeather = [
        ...weekWeather,
        ...weekWeather.map((w, idx) => ({
          ...w,
          date: `2026-07-${28 + idx}`,
        })),
      ];

      const seasonResult = cropEngine.seasonNeed({
        plan: ricePlan,
        plot: ricePlot,
        params: getCropParams("rice"),
        weather: twoWeeksWeather,
      });

      expect(seasonResult.weeks).toHaveLength(2);
      expect(seasonResult.total_m3).toBeGreaterThan(0);
      expect(seasonResult.total_m3).toBeCloseTo(
        seasonResult.weeks[0]!.volume_m3 + seasonResult.weeks[1]!.volume_m3,
        4
      );
    });

    it("throws if weather array is empty", () => {
      expect(() =>
        cropEngine.weeklyNeed({
          plan: {
            id: "cp1",
            plot_id: "p1",
            crop: "rice",
            sowing_date: "2026-07-01",
            area_fraction: 1,
            application_efficiency: 0.8,
            status: "active",
          },
          plot: {
            id: "p1",
            farmer_id: "f1",
            outlet_id: "o1",
            area_ha: 1,
            soil: "clay",
            lat: 16.5,
            lon: 80.4,
          },
          params: getCropParams("rice"),
          weather: [],
          weekStart: "2026-07-01",
        })
      ).toThrow("Weather series cannot be empty");
    });
  });
});

