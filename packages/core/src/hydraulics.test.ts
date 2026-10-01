import { describe, expect, it } from "vitest";
import demoScenario from "@jadal/contracts/fixtures/demo-scenario.json";
import type { Canal, Outlet } from "@jadal/contracts";
import { hydraulics } from "./hydraulics";


describe("A3: Canal Hydraulics", () => {
  const canal = demoScenario.canal as Canal;
  const outlets = demoScenario.outlets as Outlet[];
  const headDischarge = canal.head_discharge_m3s;

  it("calculates Manning velocity correctly for demo canal", () => {
    // v = (1 / n) * R^(2/3) * S^(1/2)
    // n = 0.025, R = 0.35, S = 0.0004
    const v = hydraulics.velocity_ms(canal);
    expect(v).toBeGreaterThan(0.39);
    expect(v).toBeLessThan(0.41);
  });

  it("calculates flows and lags at outlets with monotonically decreasing flow and increasing lag", () => {
    const results = hydraulics.atOutlets(canal, outlets, headDischarge);
    expect(results).toHaveLength(outlets.length);

    for (let i = 0; i < results.length; i++) {
      const curr = results[i]!;
      expect(curr.flow_m3s).toBeLessThanOrEqual(headDischarge);
      expect(curr.flow_m3s).toBeGreaterThan(0);
      expect(curr.loss_fraction).toBeGreaterThanOrEqual(0);
      expect(curr.loss_fraction).toBeLessThan(1);
      expect(curr.lag_h).toBeGreaterThanOrEqual(0);

      if (i > 0) {
        const prev = results[i - 1]!;
        // Flow decreases along chainage due to exponential seepage loss
        expect(curr.flow_m3s).toBeLessThan(prev.flow_m3s);
        // Lag increases with distance
        expect(curr.lag_h).toBeGreaterThan(prev.lag_h);
        // Loss fraction increases
        expect(curr.loss_fraction).toBeGreaterThan(prev.loss_fraction);
      }
    }
  });

  it("calculates overrun impact on downstream outlets", () => {
    const overrunOutletId = "o2"; // Chainage 650
    const overrunHours = 1.5;
    const impact = hydraulics.overrunImpact({
      canal,
      outlets,
      overrunOutletId,
      overrun_h: overrunHours,
      headDischarge_m3s: headDischarge,
    });

    // Outlets downstream of o2 are o3 through o8 (6 outlets)
    expect(impact).toHaveLength(6);
    expect(impact.map((x) => x.outlet_id)).toEqual(["o3", "o4", "o5", "o6", "o7", "o8"]);

    const hydMap = new Map(
      hydraulics.atOutlets(canal, outlets, headDischarge).map((h) => [h.outlet_id, h])
    );

    for (const item of impact) {
      const hyd = hydMap.get(item.outlet_id)!;
      const expectedLost = hyd.flow_m3s * overrunHours * 3600;
      expect(item.lost_m3).toBeCloseTo(expectedLost, 5);
      expect(item.lost_m3).toBeGreaterThan(0);
    }
  });

  it("returns empty impact if overrun_h <= 0", () => {
    const impact = hydraulics.overrunImpact({
      canal,
      outlets,
      overrunOutletId: "o1",
      overrun_h: 0,
      headDischarge_m3s: headDischarge,
    });
    expect(impact).toEqual([]);
  });

  it("throws if canal parameters are non-positive", () => {
    expect(() => hydraulics.velocity_ms({ ...canal, manning_n: 0 })).toThrow(RangeError);
    expect(() => hydraulics.velocity_ms({ ...canal, hydraulic_radius_m: -1 })).toThrow(RangeError);
    expect(() => hydraulics.velocity_ms({ ...canal, bed_slope: 0 })).toThrow(RangeError);
  });
});

