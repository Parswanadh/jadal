import { describe, expect, it } from "vitest";
import demoScenario from "@jadal/contracts/fixtures/demo-scenario.json";
import type { Canal, Outlet, ReleaseWindow, RosterInput } from "@jadal/contracts";
import { rosterEngine } from "./roster-engine";

function calculateGini(values: number[]): number {
  if (values.length === 0) return 0;
  const n = values.length;
  let sumDiff = 0;
  let sumVal = 0;

  for (let i = 0; i < n; i++) {
    sumVal += values[i]!;
    for (let j = 0; j < n; j++) {
      sumDiff += Math.abs(values[i]! - values[j]!);
    }
  }

  if (sumVal === 0) return 0;
  return sumDiff / (2 * n * sumVal);
}

describe("A4: Roster Engine", () => {
  const canal = demoScenario.canal as Canal;
  const outlets = demoScenario.outlets as Outlet[];
  // Window of 48 hours to allow all demands to fit
  const window: ReleaseWindow = {
    id: "rw-test",
    canal_id: canal.id,
    start: "2026-09-15T00:00:00Z",
    end: "2026-09-17T00:00:00Z", // 48 hours
    discharge_m3s: canal.head_discharge_m3s,
  };

  // 8 farmers, one at each outlet o1..o8, demanding 500 m3 each
  const demands = [
    { farmer_id: "f1", outlet_id: "o1", volume_m3: 500, priority: 1 },
    { farmer_id: "f2", outlet_id: "o2", volume_m3: 500, priority: 1 },
    { farmer_id: "f3", outlet_id: "o3", volume_m3: 500, priority: 1 },
    { farmer_id: "f4", outlet_id: "o4", volume_m3: 500, priority: 1 },
    { farmer_id: "f5", outlet_id: "o5", volume_m3: 500, priority: 1 },
    { farmer_id: "f6", outlet_id: "o6", volume_m3: 500, priority: 1 },
    { farmer_id: "f7", outlet_id: "o7", volume_m3: 500, priority: 1 },
    { farmer_id: "f8", outlet_id: "o8", volume_m3: 500, priority: 1 },
  ];

  it("builds a deterministic roster ordered head-to-tail", () => {
    const input: RosterInput = {
      canal,
      outlets,
      window,
      demands,
      mode: "equal_water",
    };

    const roster1 = rosterEngine.build(input, "r1");
    const roster2 = rosterEngine.build(input, "r1");

    expect(roster1).toEqual(roster2);
    expect(roster1.turns).toHaveLength(8);

    // Verify ordering along canal chainage
    const outletSequence = roster1.turns.map((t) => t.outlet_id);
    expect(outletSequence).toEqual(["o1", "o2", "o3", "o4", "o5", "o6", "o7", "o8"]);

    // Verify turn timing continuity and lag accounting
    for (let i = 0; i < roster1.turns.length; i++) {
      const turn = roster1.turns[i]!;
      expect(new Date(turn.start).getTime()).toBeLessThan(new Date(turn.end).getTime());
      if (i > 0) {
        const prev = roster1.turns[i - 1]!;
        expect(new Date(turn.start).getTime()).toBeGreaterThanOrEqual(new Date(prev.end).getTime());
      }
    }
  });

  it("demonstrates the core demo claim: tail gets much less water under equal_hours than equal_water", () => {
    const inputEqualWater: RosterInput = {
      canal,
      outlets,
      window,
      demands,
      mode: "equal_water",
    };

    const inputEqualHours: RosterInput = {
      canal,
      outlets,
      window,
      demands,
      mode: "equal_hours",
    };

    const rosterWater = rosterEngine.build(inputEqualWater, "r_water");
    const rosterHours = rosterEngine.build(inputEqualHours, "r_hours");

    const needMetWater = rosterEngine.needMet(inputEqualWater, rosterWater);
    const needMetHours = rosterEngine.needMet(inputEqualHours, rosterHours);

    // In equal_water, all farmers meet 100% of their need
    for (const res of needMetWater) {
      expect(res.pct).toBeCloseTo(100, 2);
    }

    // In equal_hours (warabandi), head farmer (f1 at o1) gets close to 96%
    // while tail farmer (f8 at o8) gets ~70% due to uncompensated seepage loss
    const headFarmerHours = needMetHours.find((x) => x.farmer_id === "f1")!;
    const tailFarmerHours = needMetHours.find((x) => x.farmer_id === "f8")!;

    expect(headFarmerHours.pct).toBeGreaterThan(90);
    expect(tailFarmerHours.pct).toBeLessThan(75);
    expect(tailFarmerHours.pct).toBeLessThan(headFarmerHours.pct);

    // Gini coefficient is substantially lower (more equal) for equal_water
    const giniWater = calculateGini(needMetWater.map((x) => x.pct));
    const giniHours = calculateGini(needMetHours.map((x) => x.pct));

    expect(giniWater).toBeCloseTo(0, 4);
    expect(giniHours).toBeGreaterThan(0.04);
    expect(giniWater).toBeLessThan(giniHours);
  });

  it("handles window capacity constraints and records shortfall", () => {
    // Tight 2-hour window: 7200 seconds
    const tightWindow: ReleaseWindow = {
      id: "rw-tight",
      canal_id: canal.id,
      start: "2026-09-15T00:00:00Z",
      end: "2026-09-15T02:00:00Z",
      discharge_m3s: canal.head_discharge_m3s,
    };

    const input: RosterInput = {
      canal,
      outlets,
      window: tightWindow,
      demands,
      mode: "equal_water",
    };

    const roster = rosterEngine.build(input, "r_tight");
    expect(Object.keys(roster.shortfall_m3).length).toBeGreaterThan(0);
    // Tail farmers should experience shortfall because window ended
    expect(roster.shortfall_m3["f8"]).toBeGreaterThan(0);
  });

  it("sorts by priority when multiple farmers share the same outlet", () => {
    const multiDemands = [
      { farmer_id: "f1_low", outlet_id: "o1", volume_m3: 200, priority: 2 },
      { farmer_id: "f1_high", outlet_id: "o1", volume_m3: 300, priority: 1 },
    ];

    const roster = rosterEngine.build(
      { canal, outlets, window, demands: multiDemands, mode: "equal_water" },
      "r_prio"
    );

    expect(roster.turns[0]?.farmer_id).toBe("f1_high");
    expect(roster.turns[1]?.farmer_id).toBe("f1_low");
  });

  it("records shortfall when an outlet is not mapped or has no flow", () => {
    const badDemand = [
      { farmer_id: "f_bad", outlet_id: "o_unknown", volume_m3: 500, priority: 1 },
    ];

    const roster = rosterEngine.build(
      { canal, outlets, window, demands: badDemand, mode: "equal_water" },
      "r_bad"
    );

    expect(roster.turns).toHaveLength(0);
    expect(roster.shortfall_m3["f_bad"]).toBe(500);
  });

  it("snapshots a representative roster for regression testing", () => {
    const input: RosterInput = {
      canal,
      outlets,
      window,
      demands: demands.slice(0, 3),
      mode: "equal_water",
    };

    const roster = rosterEngine.build(input, "r_snap");
    expect(roster).toMatchSnapshot();
  });
});


