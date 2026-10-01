/**
 * Roster engine tests, on the demo fixture values from
 * `packages/contracts/fixtures/demo-scenario.json`: canal c1 (3000 m, 0.15 m³/s head discharge,
 * seepage 1.2e-4/m, Manning n 0.025, slope 4e-4, hydraulic radius 0.35 m), outlets o1…o8 at
 * chainage 300…2900 m, release window rw1 = 2026-09-15T00:30Z → 2026-09-16T00:30Z at 0.15 m³/s,
 * farmers f1…f8 one per outlet.
 *
 * The one thing the fixture does not carry is a `RosterInput.demands` array, so each farmer is given
 * an equal 1300 m³ weekly entitlement. 1300 m³ is chosen to make the canal *tight*: the equal-water
 * rotation then needs 23.5 h of the 24 h window, which is what makes the equal-hours rotation's
 * over-watering of the head visible instead of drowning in slack. The measured outcomes of that
 * fixture are documented in `roster.ts` and asserted here.
 */

import { describe, expect, it } from "vitest";

import type { Canal, Outlet, ReleaseWindow, RosterInput, Turn } from "@jadal/contracts";
import { Roster as RosterSchema, Turn as TurnSchema } from "@jadal/contracts";

import { rosterEngine } from "./roster";
import { hydraulics } from "./hydraulics";

const CANAL: Canal = {
  id: "c1",
  name: "Kondaveedu Minor (demo)",
  length_m: 3000,
  head_discharge_m3s: 0.15,
  seepage_k_per_m: 0.00012,
  manning_n: 0.025,
  bed_slope: 0.0004,
  hydraulic_radius_m: 0.35,
  lined: false,
};

const CHAINAGES = [300, 650, 1000, 1400, 1800, 2200, 2550, 2900] as const;
const OUTLETS: Outlet[] = CHAINAGES.map((chainage_m, index) => ({
  id: `o${index + 1}`,
  canal_id: "c1",
  name: `Outlet ${index + 1}`,
  chainage_m,
}));

const WINDOW: ReleaseWindow = {
  id: "rw1",
  canal_id: "c1",
  start: "2026-09-15T00:30:00.000Z",
  end: "2026-09-16T00:30:00.000Z",
  discharge_m3s: 0.15,
};

/** A four-hour window: too short for the full rotation, so the tail must be truncated. */
const SHORT_WINDOW: ReleaseWindow = { ...WINDOW, id: "rw-short", end: "2026-09-15T04:30:00.000Z" };

/** One equal 1300 m³ entitlement per farmer, each at their own outlet (see the module comment). */
const DEMANDS: RosterInput["demands"] = OUTLETS.map((outlet, index) => ({
  farmer_id: `f${index + 1}`,
  outlet_id: outlet.id,
  volume_m3: 1300,
  priority: 1,
}));

function inputFor(mode: RosterInput["mode"], overrides: Partial<RosterInput> = {}): RosterInput {
  return { canal: CANAL, outlets: OUTLETS, window: WINDOW, demands: DEMANDS, mode, ...overrides };
}

const hours = (iso: string): number => Date.parse(iso) / 3_600_000;
const windowStart = hours(WINDOW.start);
const windowEnd = hours(WINDOW.end);
const turnOf = (turns: Turn[], farmer_id: string): Turn => {
  const turn = turns.find((t) => t.farmer_id === farmer_id);
  if (!turn) throw new Error(`no turn for ${farmer_id}`);
  return turn;
};

describe("rosterEngine.build", () => {
  it("is deterministic: the same input produces a deep-equal roster", () => {
    const input = inputFor("equal_water");
    const first = rosterEngine.build(input, "roster-1");
    const second = rosterEngine.build(input, "roster-1");
    expect(second).toEqual(first);

    // And independent of the order the caller listed outlets and demands in.
    const shuffled = inputFor("equal_water", {
      outlets: [...OUTLETS].reverse(),
      demands: [...DEMANDS].reverse(),
    });
    expect(rosterEngine.build(shuffled, "roster-1")).toEqual(first);
  });

  it("stamps the roster with the canal, the window and a proposed status", () => {
    const roster = rosterEngine.build(inputFor("equal_water"), "roster-9");
    expect(roster.id).toBe("roster-9");
    expect(roster.canal_id).toBe("c1");
    expect(roster.release_window_id).toBe("rw1");
    expect(roster.status).toBe("proposed");
    expect(RosterSchema.safeParse(roster).success).toBe(true);
  });

  it("visits outlets head to tail and never overlaps two turns", () => {
    for (const mode of ["equal_water", "equal_hours"] as const) {
      const { turns } = rosterEngine.build(inputFor(mode), "roster-2");
      expect(turns.map((t) => t.outlet_id)).toEqual(["o1", "o2", "o3", "o4", "o5", "o6", "o7", "o8"]);
      for (let i = 1; i < turns.length; i += 1) {
        const previous = turns[i - 1];
        const current = turns[i];
        if (!previous || !current) throw new Error("unreachable");
        // One stream: the canal carries a single front, so a turn may not start before the last ends.
        expect(hours(current.start)).toBeGreaterThanOrEqual(hours(previous.end));
        expect(CHAINAGES[i] ?? 0).toBeGreaterThan(CHAINAGES[i - 1] ?? 0);
      }
    }
  });

  it("holds every turn back until the wetting front has passed its chainage", () => {
    const lagByOutlet = new Map(
      hydraulics
        .atOutlets(CANAL, OUTLETS, WINDOW.discharge_m3s)
        .map((at) => [at.outlet_id, at.lag_h]),
    );
    for (const mode of ["equal_water", "equal_hours"] as const) {
      for (const turn of rosterEngine.build(inputFor(mode), "roster-3").turns) {
        const lag = lagByOutlet.get(turn.outlet_id);
        if (lag === undefined) throw new Error(`no hydraulics for ${turn.outlet_id}`);
        expect(turn.lag_h).toBeCloseTo(lag, 4);
        expect(hours(turn.start)).toBeGreaterThanOrEqual(windowStart + lag);
        // The head turn is the one the front actually delays: 300 m / 0.39732 m/s = 0.21 h.
        if (turn.outlet_id === "o1") {
          expect(hours(turn.start) - windowStart).toBeCloseTo(0.2097, 3);
        }
      }
    }
  });

  it("keeps every turn inside the window, non-empty, and schema-valid", () => {
    for (const mode of ["equal_water", "equal_hours"] as const) {
      for (const turn of rosterEngine.build(inputFor(mode), "roster-4").turns) {
        expect(hours(turn.start)).toBeGreaterThanOrEqual(windowStart);
        expect(hours(turn.end)).toBeLessThanOrEqual(windowEnd);
        // No zero-length turns: a turn that could not be scheduled is recorded as shortfall instead.
        expect(hours(turn.end)).toBeGreaterThan(hours(turn.start));
        expect(turn.planned_volume_m3).toBeGreaterThan(0);
        expect(turn.expected_flow_m3s).toBeGreaterThan(0);
        expect(TurnSchema.safeParse(turn).success).toBe(true);
      }
    }
  });

  it("serves equal water as the volume that was asked for, and takes the seepage out of the tail's time", () => {
    const { turns, shortfall_m3 } = rosterEngine.build(inputFor("equal_water"), "roster-5");
    expect(shortfall_m3).toEqual({});
    for (const turn of turns) {
      expect(turn.planned_volume_m3).toBe(1300);
      // duration_h = V / (Q · 3600), so the tail gate is open longer for the same 1300 m³.
      const durationH = 1300 / (turn.expected_flow_m3s * 3600);
      expect(hours(turn.end) - hours(turn.start)).toBeCloseTo(durationH, 3);
    }
    const head = turnOf(turns, "f1");
    const tail = turnOf(turns, "f8");
    expect(hours(tail.end) - hours(tail.start)).toBeGreaterThan(hours(head.end) - hours(head.start));
    // 23.5 h of gate time: the fixture canal is tight, which is the point of the comparison.
    expect(hours(turns[turns.length - 1]?.end ?? "")).toBeLessThan(windowEnd);
    expect(windowEnd - hours(turns[0]?.start ?? "")).toBeLessThan(24);
  });

  it("serves equal time as the same hours for everybody, so the head takes the most water", () => {
    const { turns } = rosterEngine.build(inputFor("equal_hours"), "roster-6");
    const durations = turns.map((turn) => hours(turn.end) - hours(turn.start));
    for (const duration of durations) {
      for (const other of durations) expect(duration).toBeCloseTo(other, 6);
    }
    expect(durations[0]).toBeCloseTo((hours(WINDOW.end) - hours(WINDOW.start) - 0.2097) / 8, 3);
    // The measured volumes published in roster.ts, so the table there is a test, not a claim.
    expect(turnOf(turns, "f1").planned_volume_m3).toBe(1549.06);
    expect(turnOf(turns, "f7").planned_volume_m3).toBe(1182.521);
    expect(turnOf(turns, "f8").planned_volume_m3).toBe(1133.884);
    // Same time, less water down the canal: strictly decreasing scheduled volume.
    const volumes = turns.map((turn) => turn.planned_volume_m3);
    for (let i = 1; i < volumes.length; i += 1) {
      expect(volumes[i]).toBeLessThan(volumes[i - 1] ?? 0);
    }
  });

  it("truncates a turn that would run past the window and books the rest as shortfall", () => {
    const { turns, shortfall_m3 } = rosterEngine.build(
      inputFor("equal_water", { window: SHORT_WINDOW }),
      "roster-7",
    );
    // Head first, and it fits: 2.5 h of a 4 h window.
    expect(turns[0]?.planned_volume_m3).toBe(1300);
    // The next turn is cut at 04:30Z and only gets what the gate passes in the time left.
    const second = turns[1];
    if (!second) throw new Error("expected a second turn");
    expect(second.end).toBe(SHORT_WINDOW.end);
    expect(second.planned_volume_m3).toBeLessThan(1300);
    expect(second.planned_volume_m3).toBeCloseTo(646.631, 2);
    expect(shortfall_m3.f2).toBeCloseTo(1300 - 646.631, 2);
    // Everything the window could not reach is recorded, and nothing is dropped silently.
    const unserved = Object.values(shortfall_m3).reduce((sum, value) => sum + value, 0);
    const served = turns.reduce((sum, turn) => sum + turn.planned_volume_m3, 0);
    expect(unserved + served).toBeCloseTo(8 * 1300, 2);
    for (const farmer of ["f3", "f4", "f5", "f6", "f7", "f8"]) {
      expect(shortfall_m3[farmer]).toBe(1300);
    }
  });

  it("still fills a short window under equal hours, because the time share shrinks with it", () => {
    const { turns, shortfall_m3 } = rosterEngine.build(
      inputFor("equal_hours", { window: SHORT_WINDOW }),
      "roster-8",
    );
    expect(turns).toHaveLength(8);
    expect(turns[turns.length - 1]?.end).toBe(SHORT_WINDOW.end);
    // Everyone is served, but nobody gets much: the window is the constraint now, not the water.
    for (const farmer of ["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"]) {
      expect(shortfall_m3[farmer]).toBeGreaterThan(1000);
    }
  });

  it("skips zero-volume demands and demands for outlets off this canal", () => {
    const demands = [
      ...DEMANDS,
      { farmer_id: "f9", outlet_id: "o1", volume_m3: 0, priority: 9 },
      { farmer_id: "f10", outlet_id: "o99", volume_m3: 500, priority: 1 },
    ];
    const roster = rosterEngine.build(inputFor("equal_water", { demands }), "roster-10");
    expect(roster.turns).toHaveLength(8);
    expect(roster.turns.some((turn) => turn.farmer_id === "f9")).toBe(false);
    expect(roster.shortfall_m3.f9).toBeUndefined();
    expect(roster.shortfall_m3.f10).toBeUndefined();
  });

  it("serves the higher-priority demand first at a shared outlet", () => {
    const demands = [
      { farmer_id: "f1", outlet_id: "o1", volume_m3: 100, priority: 1 },
      { farmer_id: "f2", outlet_id: "o1", volume_m3: 100, priority: 5 },
    ];
    const { turns } = rosterEngine.build(inputFor("equal_water", { demands }), "roster-11");
    expect(turns.map((turn) => turn.farmer_id)).toEqual(["f2", "f1"]);
    // Priority is a tie-break, not an entitlement: a priority-1 turn is still scheduled.
    expect(turns[1]?.planned_volume_m3).toBe(100);
  });

  it("records nothing but shortfall when the window is already over when the front arrives", () => {
    const window = { ...WINDOW, id: "rw-gone", end: "2026-09-15T00:35:00.000Z" };
    const roster = rosterEngine.build(inputFor("equal_hours", { window }), "roster-12");
    expect(roster.turns).toHaveLength(0);
    expect(roster.shortfall_m3).toEqual({
      f1: 1300,
      f2: 1300,
      f3: 1300,
      f4: 1300,
      f5: 1300,
      f6: 1300,
      f7: 1300,
      f8: 1300,
    });
  });

  it("schedules nothing off an unusable window rather than guessing at one", () => {
    // The schema rejects this window, but the core must stay total: no turn off an unknown window,
    // and the whole demand reported as unserved so the coordinator sees it.
    const broken = { ...WINDOW, id: "rw-broken", end: "not-a-time" } as ReleaseWindow;
    for (const mode of ["equal_water", "equal_hours"] as const) {
      const roster = rosterEngine.build(inputFor(mode, { window: broken }), "roster-13");
      expect(roster.turns).toEqual([]);
      expect(Object.keys(roster.shortfall_m3)).toHaveLength(8);
    }
  });
});

describe("rosterEngine.needMet", () => {
  it("gives the tail its whole need under equal water and loses it under equal hours", () => {
    const water = rosterEngine.build(inputFor("equal_water"), "roster-20");
    const hoursRoster = rosterEngine.build(inputFor("equal_hours"), "roster-21");

    const waterNeed = new Map(rosterEngine.needMet(inputFor("equal_water"), water).map((r) => [`${r.farmer_id}@${r.outlet_id}`, r.pct]));
    const hoursNeed = new Map(rosterEngine.needMet(inputFor("equal_hours"), hoursRoster).map((r) => [`${r.farmer_id}@${r.outlet_id}`, r.pct]));

    // Measured (see the table in roster.ts): 100% everywhere under equal water …
    for (const outlet of OUTLETS) {
      const farmer = `f${OUTLETS.indexOf(outlet) + 1}`;
      expect(waterNeed.get(`${farmer}@${outlet.id}`)).toBe(100);
    }
    // … and a tail that is 9.04 points short of it under equal hours, against a head that is
    // over-watered (119.2% raw, clamped to 100).
    expect(hoursNeed.get("f1@o1")).toBe(100);
    expect(hoursNeed.get("f7@o7")).toBe(90.96);
    expect(hoursNeed.get("f8@o8")).toBe(87.22);
    for (const outletId of ["o7", "o8"]) {
      const farmer = outletId === "o7" ? "f7" : "f8";
      const gap = (waterNeed.get(`${farmer}@${outletId}`) ?? 0) - (hoursNeed.get(`${farmer}@${outletId}`) ?? 0);
      expect(gap).toBeGreaterThan(5);
    }
  });

  it("keeps the loss to the tail bounded by the seepage between head and tail", () => {
    // Q_8 / Q_1 = e^(−k·Δx) is the floor: equal time cannot take more than the canal lost on the way
    // down. This is the arithmetic behind the measured 1549.060 → 1133.884 m³.
    const head = turnOf(rosterEngine.build(inputFor("equal_hours"), "roster-22").turns, "f1");
    const tail = turnOf(rosterEngine.build(inputFor("equal_hours"), "roster-22").turns, "f8");
    expect(tail.planned_volume_m3 / head.planned_volume_m3).toBeCloseTo(
      Math.exp(-CANAL.seepage_k_per_m * (2900 - 300)),
      3,
    );
  });

  it("clamps over-watering to 100% and reports an unserved farmer as 0", () => {
    // f1 asks for almost nothing at the head and gets a full equal-hours turn, so it is capped …
    const small = [{ farmer_id: "f1", outlet_id: "o1", volume_m3: 10, priority: 1 }];
    expect(rosterEngine.needMet(inputFor("equal_hours", { demands: small }), rosterEngine.build(inputFor("equal_hours", { demands: small }), "roster-23"))).toEqual([
      { farmer_id: "f1", outlet_id: "o1", pct: 100 },
    ]);

    // … and a farmer with no turn at all in this roster gets 0, not a gap in the answer.
    const crossMode = rosterEngine.needMet(inputFor("equal_water"), rosterEngine.build(inputFor("equal_water", { demands: [] }), "roster-24"));
    expect(crossMode).toHaveLength(8);
    for (const row of crossMode) {
      expect(row.pct).toBe(0);
    }
  });

  it("rounds to two decimals and reports nothing for a zero-volume demand", () => {
    const demands = [{ farmer_id: "f1", outlet_id: "o1", volume_m3: 3, priority: 1 }, { farmer_id: "f2", outlet_id: "o1", volume_m3: 0, priority: 1 }];
    const input = inputFor("equal_hours", { demands });
    const rows = rosterEngine.needMet(input, rosterEngine.build(input, "roster-25"));
    expect(rows).toHaveLength(1);
    // 0.471 h of 0.144696 m³/s ≈ 245 m³ against a 3 m³ ask: clamped, and still 2 dp.
    expect(rows[0]?.pct).toBe(100);
  });
});
