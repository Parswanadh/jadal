import { describe, expect, it } from "vitest";
import { rosterEngine } from "./roster";
import type { RosterInput } from "./roster";
import demoScenario from "../../contracts/fixtures/demo-scenario.json";

function calculateGini(values: number[]): number {
  if (values.length === 0) return 0;
  const n = values.length;
  let sumDiff = 0;
  let sumVal = 0;
  for (let i = 0; i < n; i++) {
    const vi = values[i]!;
    sumVal += vi;
    for (let j = 0; j < n; j++) {
      const vj = values[j]!;
      sumDiff += Math.abs(vi - vj);
    }
  }
  if (sumVal === 0) return 0;
  return sumDiff / (2 * n * sumVal);
}

describe("RosterEngine (A4)", () => {
  const seedCanal = demoScenario.canal;
  const seedOutlets = demoScenario.outlets;
  const seedWindow = demoScenario.release_windows[0]!;

  // Equal demands per hectare on the seed scenario plots:
  // 850 m3/ha fits inside the 24h window under equal_water
  const demandPerHa = 850;
  const seedDemands = demoScenario.plots.map(p => ({
    farmer_id: p.farmer_id,
    outlet_id: p.outlet_id,
    volume_m3: p.area_ha * demandPerHa,
    priority: 1,
  }));

  const inputWater: RosterInput = {
    canal: seedCanal,
    outlets: seedOutlets,
    window: seedWindow,
    demands: seedDemands,
    mode: "equal_water",
  };

  const inputHours: RosterInput = {
    canal: seedCanal,
    outlets: seedOutlets,
    window: seedWindow,
    demands: seedDemands,
    mode: "equal_hours",
  };

  describe("determinism and core claim", () => {
    it("returns identical output for the same input", () => {
      const r1 = rosterEngine.build(inputWater, "roster-1");
      const r2 = rosterEngine.build(inputWater, "roster-1");
      expect(r1).toEqual(r2);

      const h1 = rosterEngine.build(inputHours, "roster-h1");
      const h2 = rosterEngine.build(inputHours, "roster-h1");
      expect(h1).toEqual(h2);
    });

    it("ensures tail outlets' pct under equal_hours is much lower than under equal_water", () => {
      const rosterWater = rosterEngine.build(inputWater, "rost-water");
      const needWater = rosterEngine.needMet(inputWater, rosterWater);

      const rosterHours = rosterEngine.build(inputHours, "rost-hours");
      const needHours = rosterEngine.needMet(inputHours, rosterHours);

      const tailWaterO7 = needWater.find(n => n.outlet_id === "o7")!;
      const tailWaterO8 = needWater.find(n => n.outlet_id === "o8")!;

      const tailHoursO7 = needHours.find(n => n.outlet_id === "o7")!;
      const tailHoursO8 = needHours.find(n => n.outlet_id === "o8")!;

      // Under equal_water, tail outlets meet 100% of their need
      expect(tailWaterO7.pct).toBe(100);
      expect(tailWaterO8.pct).toBe(100);

      // Under equal_hours, tail outlets suffer seepage deficit and get much less
      expect(tailHoursO7.pct).toBeLessThan(90);
      expect(tailHoursO8.pct).toBeLessThan(86);
      expect(tailHoursO8.pct).toBeLessThan(tailWaterO8.pct - 14);
    });

    it("ensures Gini coefficient across farmers is lower for equal_water than equal_hours", () => {
      const rosterWater = rosterEngine.build(inputWater, "rost-water");
      const needWater = rosterEngine.needMet(inputWater, rosterWater);

      const rosterHours = rosterEngine.build(inputHours, "rost-hours");
      const needHours = rosterEngine.needMet(inputHours, rosterHours);

      const giniWater = calculateGini(needWater.map(n => n.pct));
      const giniHours = calculateGini(needHours.map(n => n.pct));

      expect(giniWater).toBeCloseTo(0, 5); // Perfectly equal in equal_water
      expect(giniHours).toBeGreaterThan(0.02); // Inequality due to conveyance losses
      expect(giniWater).toBeLessThan(giniHours);
    });

    it("plannedNeedMet exposes over-allocation that the capped needMet hides", () => {
      // Tiny demands under equal_hours: each farmer gets a fixed share of the 24 h window, so the
      // volume actually turned far exceeds the 1 m3 asked for. `needMet` clamps that to 100% for
      // everyone (Gini 0); `plannedNeedMet` keeps the over-allocation so the fairness gap survives.
      const tinyDemands = seedDemands.map(p => ({
        farmer_id: p.farmer_id,
        outlet_id: p.outlet_id,
        volume_m3: 1,
        priority: 1,
      }));
      const tinyInput: RosterInput = {
        canal: seedCanal,
        outlets: seedOutlets,
        window: seedWindow,
        demands: tinyDemands,
        mode: "equal_hours",
      };

      const roster = rosterEngine.build(tinyInput, "rost-planned");
      const capped = rosterEngine.needMet(tinyInput, roster);
      const planned = rosterEngine.plannedNeedMet(tinyInput, roster);

      for (const row of capped) expect(row.pct).toBe(100);
      expect(calculateGini(capped.map(n => n.pct))).toBe(0);

      for (const row of planned) expect(row.pct).toBeGreaterThan(100);
      expect(calculateGini(planned.map(n => n.pct))).toBeGreaterThan(0);
    });
  });

  describe("sequencing, lag, and packing constraints", () => {
    it("orders turns head-to-tail along the canal chainage", () => {
      const roster = rosterEngine.build(inputWater, "rost-order");
      const outletMap = new Map(seedOutlets.map(o => [o.id, o]));

      for (let i = 0; i < roster.turns.length - 1; i++) {
        const chCurrent = outletMap.get(roster.turns[i]!.outlet_id)!.chainage_m;
        const chNext = outletMap.get(roster.turns[i + 1]!.outlet_id)!.chainage_m;
        expect(chCurrent).toBeLessThanOrEqual(chNext);
      }
    });

    it("ensures first turn at each outlet does not start before its arrival lag", () => {
      const roster = rosterEngine.build(inputWater, "rost-lag");
      const windowStartMs = new Date(seedWindow.start).getTime();

      const seenOutlets = new Set<string>();
      for (const turn of roster.turns) {
        if (!seenOutlets.has(turn.outlet_id)) {
          seenOutlets.add(turn.outlet_id);
          const turnStartMs = new Date(turn.start).getTime();
          const expectedArrivalMs = windowStartMs + turn.lag_h * 3600 * 1000;
          expect(turnStartMs).toBeGreaterThanOrEqual(expectedArrivalMs - 1); // 1ms tolerance
        }
      }
    });

    it("packs turns sequentially without overlapping within the release window", () => {
      const roster = rosterEngine.build(inputWater, "rost-pack");
      const windowStartMs = new Date(seedWindow.start).getTime();
      const windowEndMs = new Date(seedWindow.end).getTime();

      for (let i = 0; i < roster.turns.length; i++) {
        const turn = roster.turns[i]!;
        const startMs = new Date(turn.start).getTime();
        const endMs = new Date(turn.end).getTime();

        expect(startMs).toBeGreaterThanOrEqual(windowStartMs);
        expect(endMs).toBeLessThanOrEqual(windowEndMs);
        expect(endMs).toBeGreaterThan(startMs);

        if (i > 0) {
          const prevEndMs = new Date(roster.turns[i - 1]!.end).getTime();
          expect(startMs).toBeGreaterThanOrEqual(prevEndMs);
        }
      }
    });

    it("computes equal_water turn duration as V / Q_outlet", () => {
      const roster = rosterEngine.build(inputWater, "rost-dur");
      for (const turn of roster.turns) {
        const durationSec = (new Date(turn.end).getTime() - new Date(turn.start).getTime()) / 1000;
        const expectedDurationSec = turn.planned_volume_m3 / turn.expected_flow_m3s;
        expect(durationSec).toBeCloseTo(expectedDurationSec, 2);
      }
    });
  });

  describe("shortfall reporting", () => {
    it("reports unschedulable volume in shortfall_m3 when window capacity is exceeded", () => {
      // Very high demand that cannot fit in a 24h release window
      const excessiveDemands = demoScenario.plots.map(p => ({
        farmer_id: p.farmer_id,
        outlet_id: p.outlet_id,
        volume_m3: p.area_ha * 1500, // 1500 m3/ha
        priority: 1,
      }));

      const inputExcessive: RosterInput = {
        canal: seedCanal,
        outlets: seedOutlets,
        window: seedWindow,
        demands: excessiveDemands,
        mode: "equal_water",
      };

      const roster = rosterEngine.build(inputExcessive, "rost-shortfall");
      const totalShortfall = Object.values(roster.shortfall_m3).reduce((sum, v) => sum + v, 0);

      expect(totalShortfall).toBeGreaterThan(0);
      // Tail farmers should have shortfalls because head farmers took the window time
      expect(roster.shortfall_m3["f8"]).toBeGreaterThan(0);

      const need = rosterEngine.needMet(inputExcessive, roster);
      const tailNeed = need.find(n => n.farmer_id === "f8")!;
      expect(tailNeed.pct).toBeLessThan(50);
    });

    it("reports zero shortfall when all demands are satisfied", () => {
      const roster = rosterEngine.build(inputWater, "rost-no-shortfall");
      expect(Object.keys(roster.shortfall_m3)).toHaveLength(0);
    });
  });

  describe("snapshot test", () => {
    it("matches snapshot structure for seed equal_water roster", () => {
      const roster = rosterEngine.build(inputWater, "seed-water-snapshot");
      expect(roster.status).toBe("proposed");
      expect(roster.turns).toHaveLength(8);
      expect(roster.canal_id).toBe("c1");
      expect(roster.release_window_id).toBe("rw1");
    });
  });

  describe("edge cases", () => {
    it("handles multiple farmers at the same outlet with priority ordering", () => {
      const multiDemands = [
        { farmer_id: "f1_b", outlet_id: "o1", volume_m3: 300, priority: 2 },
        { farmer_id: "f1_a", outlet_id: "o1", volume_m3: 500, priority: 1 },
      ];
      const multiInput: RosterInput = {
        canal: seedCanal,
        outlets: seedOutlets,
        window: seedWindow,
        demands: multiDemands,
        mode: "equal_water",
      };

      const roster = rosterEngine.build(multiInput, "rost-multi");
      expect(roster.turns).toHaveLength(2);

      // Higher priority (priority 1) goes first
      expect(roster.turns[0]!.farmer_id).toBe("f1_a");
      expect(roster.turns[1]!.farmer_id).toBe("f1_b");

      // Second turn at same outlet starts immediately when first turn ends
      expect(roster.turns[1]!.start).toBe(roster.turns[0]!.end);
    });

    it("partially delivers volume when a turn is truncated by the release window end", () => {
      // Window is 1 hour
      const shortWindow = {
        id: "short-rw",
        canal_id: "c1",
        start: "2026-09-15T00:00:00Z",
        end: "2026-09-15T01:00:00Z", // 3600s
        discharge_m3s: 0.15,
      };

      // Outlet 1 flow ≈ 0.1447 m3/s.
      // Lag for o1 ≈ 755s.
      // Remaining window time = 3600 - 755 = 2845s.
      // Demand requiring 5000s (> 2845s):
      const truncDemands = [
        { farmer_id: "f1", outlet_id: "o1", volume_m3: 0.144696 * 5000, priority: 1 },
      ];

      const truncInput: RosterInput = {
        canal: seedCanal,
        outlets: seedOutlets,
        window: shortWindow,
        demands: truncDemands,
        mode: "equal_water",
      };

      const roster = rosterEngine.build(truncInput, "rost-trunc");
      expect(roster.turns).toHaveLength(1);

      const turn = roster.turns[0]!;
      expect(new Date(turn.end).getTime()).toBe(new Date(shortWindow.end).getTime());
      expect(turn.planned_volume_m3).toBeLessThan(truncDemands[0]!.volume_m3);
      expect(roster.shortfall_m3["f1"]).toBeGreaterThan(0);

      const need = rosterEngine.needMet(truncInput, roster);
      expect(need[0]!.pct).toBeLessThan(100);
      expect(need[0]!.pct).toBeGreaterThan(0);
    });

    it("handles zero volume demand gracefully", () => {
      const zeroDemand = [
        { farmer_id: "f1", outlet_id: "o1", volume_m3: 0, priority: 1 },
      ];
      const zeroInput: RosterInput = {
        canal: seedCanal,
        outlets: seedOutlets,
        window: seedWindow,
        demands: zeroDemand,
        mode: "equal_water",
      };

      const roster = rosterEngine.build(zeroInput, "rost-zero");
      expect(roster.turns).toHaveLength(0);

      const need = rosterEngine.needMet(zeroInput, roster);
      expect(need[0]!.pct).toBe(100);
    });

    it("handles equal_hours with zero total demand", () => {
      const zeroDemand = [
        { farmer_id: "f1", outlet_id: "o1", volume_m3: 0, priority: 1 },
        { farmer_id: "f2", outlet_id: "o2", volume_m3: 0, priority: 1 },
      ];
      const zeroInput: RosterInput = {
        canal: seedCanal,
        outlets: seedOutlets,
        window: seedWindow,
        demands: zeroDemand,
        mode: "equal_hours",
      };

      const roster = rosterEngine.build(zeroInput, "rost-hours-zero");
      expect(roster.turns).toHaveLength(2);
    });
  });
});

