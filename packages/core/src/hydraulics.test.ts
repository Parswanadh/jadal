import { describe, expect, it } from "vitest";
import { hydraulics } from "./hydraulics";
import demoScenario from "../../contracts/fixtures/demo-scenario.json";

describe("Hydraulics (A3)", () => {
  const seedCanal = demoScenario.canal;
  const seedOutlets = demoScenario.outlets;
  const headDischarge = demoScenario.release_windows[0]!.discharge_m3s; // 0.15 m3/s

  describe("velocity_ms (Manning formula)", () => {
    it("computes Manning velocity matching hand-computed values for the seed canal", () => {
      // Seed canal: n = 0.025, R = 0.35 m, S = 0.0004
      // v = (1 / n) * R^(2/3) * S^(1/2)
      // v = (1 / 0.025) * (0.35)^(2/3) * (0.0004)^(1/2)
      // v = 40 * 0.49664419284 * 0.02 = 0.397315354 m/s
      const v = hydraulics.velocity_ms(seedCanal);
      const expectedV = (1 / 0.025) * 0.35 ** (2 / 3) * Math.sqrt(0.0004);
      expect(v).toBeCloseTo(expectedV, 7);
      expect(v).toBeCloseTo(0.39731535, 6);
    });

    it("scales correctly with steeper bed slope", () => {
      const steepCanal = { ...seedCanal, bed_slope: 0.0016 }; // 4x slope -> 2x velocity
      const v = hydraulics.velocity_ms(steepCanal);
      const vBase = hydraulics.velocity_ms(seedCanal);
      expect(v).toBeCloseTo(vBase * 2, 6);
    });
  });

  describe("atOutlets", () => {
    it("computes outlet flow, lag, and loss fraction with hand-verified values", () => {
      const v = hydraulics.velocity_ms(seedCanal);
      const results = hydraulics.atOutlets(seedCanal, seedOutlets, headDischarge);

      expect(results).toHaveLength(seedOutlets.length);

      // Outlet 1 (chainage 300m)
      const o1 = results[0]!;
      expect(o1.outlet_id).toBe("o1");
      expect(o1.chainage_m).toBe(300);
      // Q(300) = 0.15 * exp(-0.00012 * 300) = 0.15 * exp(-0.036) ≈ 0.144696044 m3/s
      const expectedQ1 = 0.15 * Math.exp(-0.00012 * 300);
      expect(o1.flow_m3s).toBeCloseTo(expectedQ1, 7);
      // lag_h = 300 / (v * 3600) ≈ 0.20974103 h (~12.58 min)
      const expectedLag1 = 300 / (v * 3600);
      expect(o1.lag_h).toBeCloseTo(expectedLag1, 7);
      // loss_fraction = 1 - exp(-0.00012 * 300) ≈ 0.0353597
      expect(o1.loss_fraction).toBeCloseTo(1 - Math.exp(-0.00012 * 300), 7);

      // Outlet 8 (chainage 2900m)
      const o8 = results[7]!;
      expect(o8.outlet_id).toBe("o8");
      expect(o8.chainage_m).toBe(2900);
      // Q(2900) = 0.15 * exp(-0.00012 * 2900) = 0.15 * exp(-0.348) ≈ 0.105914831 m3/s
      const expectedQ8 = 0.15 * Math.exp(-0.00012 * 2900);
      expect(o8.flow_m3s).toBeCloseTo(expectedQ8, 7);
      // lag_h = 2900 / (v * 3600) ≈ 2.02749666 h (~121.65 min)
      const expectedLag8 = 2900 / (v * 3600);
      expect(o8.lag_h).toBeCloseTo(expectedLag8, 7);
      // loss_fraction = 1 - exp(-0.00012 * 2900) ≈ 0.29390112
      expect(o8.loss_fraction).toBeCloseTo(1 - Math.exp(-0.00012 * 2900), 7);
    });

    it("verifies that flow is strictly decreasing along the canal", () => {
      const results = hydraulics.atOutlets(seedCanal, seedOutlets, headDischarge);
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i]!.flow_m3s).toBeGreaterThan(results[i + 1]!.flow_m3s);
      }
    });

    it("verifies that lag is strictly increasing along the canal", () => {
      const results = hydraulics.atOutlets(seedCanal, seedOutlets, headDischarge);
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i]!.lag_h).toBeLessThan(results[i + 1]!.lag_h);
      }
    });

    it("verifies that loss fraction is strictly increasing along the canal", () => {
      const results = hydraulics.atOutlets(seedCanal, seedOutlets, headDischarge);
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i]!.loss_fraction).toBeLessThan(results[i + 1]!.loss_fraction);
      }
    });

    it("handles zero chainage outlet at canal head", () => {
      const headOutlet = { id: "o0", canal_id: "c1", name: "Head", chainage_m: 0 };
      const results = hydraulics.atOutlets(seedCanal, [headOutlet], headDischarge);
      expect(results[0]!.flow_m3s).toBe(headDischarge);
      expect(results[0]!.lag_h).toBe(0);
      expect(results[0]!.loss_fraction).toBe(0);
    });

    it("handles empty outlets list", () => {
      const results = hydraulics.atOutlets(seedCanal, [], headDischarge);
      expect(results).toEqual([]);
    });
  });

  describe("overrunImpact", () => {
    it("quantifies water lost by all downstream outlets when an upstream outlet overruns", () => {
      // Outlet 1 overruns by 1.5 hours
      const overrunHours = 1.5;
      const impacts = hydraulics.overrunImpact({
        canal: seedCanal,
        outlets: seedOutlets,
        overrunOutletId: "o1",
        overrun_h: overrunHours,
        headDischarge_m3s: headDischarge,
      });

      // Outlets o2 through o8 are downstream of o1
      expect(impacts).toHaveLength(7);
      expect(impacts.map(i => i.outlet_id)).toEqual(["o2", "o3", "o4", "o5", "o6", "o7", "o8"]);

      // Losses are deducted in sequence (head to tail): the overrun diverts Q(o1) for overrun_h
      // hours, and each downstream outlet's loss is capped by the remaining budget, so the total
      // never exceeds the water the canal carries past the overrunning outlet.
      const qOverrun =
        headDischarge * Math.exp(-seedCanal.seepage_k_per_m * seedOutlets[0]!.chainage_m);
      let remaining = qOverrun * overrunHours * 3600;
      for (const impact of impacts) {
        const outlet = seedOutlets.find(o => o.id === impact.outlet_id)!;
        const q_outlet = headDischarge * Math.exp(-seedCanal.seepage_k_per_m * outlet.chainage_m);
        const expectedLostM3 = Math.min(q_outlet * overrunHours * 3600, remaining);
        remaining -= expectedLostM3;
        expect(impact.lost_m3).toBeCloseTo(expectedLostM3, 6);
      }
      const total = impacts.reduce((sum, i) => sum + i.lost_m3, 0);
      expect(total).toBeCloseTo(qOverrun * overrunHours * 3600, 6);
    });

    it("returns empty array when tail outlet overruns (no downstream outlets)", () => {
      const impacts = hydraulics.overrunImpact({
        canal: seedCanal,
        outlets: seedOutlets,
        overrunOutletId: "o8", // Last outlet at 2900m
        overrun_h: 2.0,
        headDischarge_m3s: headDischarge,
      });
      expect(impacts).toEqual([]);
    });

    it("returns 0 lost volume if overrun_h is 0 or negative", () => {
      const impacts = hydraulics.overrunImpact({
        canal: seedCanal,
        outlets: seedOutlets,
        overrunOutletId: "o1",
        overrun_h: 0,
        headDischarge_m3s: headDischarge,
      });
      expect(impacts).toHaveLength(7);
      for (const impact of impacts) {
        expect(impact.lost_m3).toBe(0);
      }
    });

    it("returns empty array if overrunOutletId is not found", () => {
      const impacts = hydraulics.overrunImpact({
        canal: seedCanal,
        outlets: seedOutlets,
        overrunOutletId: "non-existent",
        overrun_h: 1.0,
        headDischarge_m3s: headDischarge,
      });
      expect(impacts).toEqual([]);
    });

    it("F-03: deducts overrun losses in sequence so the total cannot exceed what the canal carries", () => {
      // Three outlets: the overrunning one at 300 m and two downstream at 600 m and 900 m.
      // The overrun diverts Q(300) for overrun_h hours; that volume is ALL the water the canal
      // carries past the overrunning outlet during the overrun, so the sum of the per-outlet
      // losses must never exceed it. The old per-outlet-independent computation summed to more.
      const outlets = [
        { id: "x", canal_id: "c1", name: "X", chainage_m: 300 },
        { id: "y1", canal_id: "c1", name: "Y1", chainage_m: 600 },
        { id: "y2", canal_id: "c1", name: "Y2", chainage_m: 900 },
      ];
      const impact = hydraulics.overrunImpact({
        canal: seedCanal,
        outlets,
        overrunOutletId: "x",
        overrun_h: 1,
        headDischarge_m3s: headDischarge,
      });

      const qX = headDischarge * Math.exp(-seedCanal.seepage_k_per_m * 300);
      const total = impact.reduce((sum, i) => sum + i.lost_m3, 0);
      // The total is capped at the water the canal carries past the overrunning outlet.
      expect(total).toBeCloseTo(qX * 3600, 6);
      // Sequential deduction: the first downstream outlet absorbs its full loss (it fits under
      // the cap), the second gets only the remainder.
      const qY1 = headDischarge * Math.exp(-seedCanal.seepage_k_per_m * 600);
      expect(impact[0]!.lost_m3).toBeCloseTo(Math.min(qY1 * 3600, qX * 3600), 6);
      expect(impact[1]!.lost_m3).toBeCloseTo(Math.max(0, qX * 3600 - qY1 * 3600), 6);
    });
  });
});
