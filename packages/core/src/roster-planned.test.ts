/**
 * Roster planned-vs-delivered need met (handoff P4), measured on the SHIPPED seed.
 *
 * The demand is derived entirely from shipped data: the crop plans and plots in
 * `packages/contracts/fixtures/demo-scenario.json`, the crop coefficients in the core's
 * `data/crop-params.json`, and the weather in `packages/contracts/fixtures/demo-weather.json`.
 * Nothing here is a hand-typed demand: `cropEngine.weeklyNeed` prices each plan.
 *
 * Why this file exists: `rosterEngine.needMet` caps at 100%, and on this seed the 24 h `rw1` window
 * carries more than the week's FAO-56 need, so equal-hours over-allocates the head past 100% and
 * the cap makes every farmer read 100% (Gini 0) — the fairness comparison the product exists to
 * make went blank. `plannedNeedMet` keeps the over-allocation, so the head-to-tail gap is visible.
 *
 * Note on the handoff's "tail ~42% vs head ~100%": that pattern is the *illustrative mock* in
 * `apps/web/src/api/mock.ts` (line 319), not a property of the shipped fixture. Measured here, the
 * shipped seed's tail is 205.5% and its head 280.8% (tail = 73% of head), because the seed's window
 * is generous relative to weekly need and the head/tail ratio is the physical flow ratio
 * Q(o1)/Q(o8) = 0.1447/0.1059. The gap is real and monotonic; the specific 42% is not.
 */

import { describe, expect, it } from "vitest";

import demoScenario from "../../contracts/fixtures/demo-scenario.json";
import demoWeather from "../../contracts/fixtures/demo-weather.json";
import { cropEngine } from "./crop";
import cropParams from "./data/crop-params.json";
import { ledger } from "./ledger";
import { rosterEngine } from "./roster";
import type { RosterInput } from "./roster";

interface SeedCropPlan {
  id: string;
  plot_id: string;
  crop: string;
  rice_practice?: string;
  status?: string;
}
interface SeedPlot {
  id: string;
  farmer_id: string;
  outlet_id: string;
}
interface SeedWeatherDay {
  date: string;
  et0_mm: number;
  rain_mm: number;
}
interface CropParamRow {
  crop: string;
  variant?: string;
}

/** Monday-aligned week start on or after `utcIso`, matching `apps/api/src/agents/need.ts`. */
function weekStartFor(utcIso: string): string {
  const local = new Date(utcIso);
  const sinceMonday = (local.getUTCDay() + 6) % 7;
  const monday = new Date(local.getTime() - sinceMonday * 86_400_000);
  return monday.toISOString().slice(0, 10);
}

/** The seven shipped weather days beginning at `weekStart`. */
function weekOf(weather: readonly SeedWeatherDay[], weekStart: string): SeedWeatherDay[] {
  const anchor = Date.parse(`${weekStart}T00:00:00Z`);
  const byDate = new Map(weather.map(day => [day.date, day]));
  const out: SeedWeatherDay[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const iso = new Date(anchor + offset * 86_400_000).toISOString().slice(0, 10);
    const day = byDate.get(iso);
    if (day !== undefined) out.push(day);
  }
  return out;
}

/** Rice picks its `flooded`/`intermittent` row; every other crop has one row. Core's selection rule. */
function cropParamsFor(plan: SeedCropPlan): CropParamRow {
  const rows = cropParams as readonly CropParamRow[];
  if (plan.crop === "rice") {
    const variant = plan.rice_practice === "intermittent" ? "intermittent" : "flooded";
    const row = rows.find(candidate => candidate.crop === "rice" && candidate.variant === variant);
    if (row === undefined) throw new RangeError(`no rice (${variant}) parameters`);
    return row;
  }
  const row = rows.find(candidate => candidate.crop === plan.crop);
  if (row === undefined) throw new RangeError(`no parameters for crop ${plan.crop}`);
  return row;
}

/** One demand per farmer, summed across their shipped crop plans, priced by the crop engine. */
function seedDemands(): RosterInput["demands"] {
  const plotById = new Map<string, SeedPlot>(demoScenario.plots.map(plot => [plot.id, plot]));
  const weekStart = weekStartFor(demoScenario.now);
  const week = weekOf(demoWeather.days as SeedWeatherDay[], weekStart);

  const byFarmer = new Map<string, { farmer_id: string; outlet_id: string; volume_m3: number; priority: number }>();
  for (const plan of demoScenario.crop_plans as SeedCropPlan[]) {
    if (plan.status === "harvested") continue;
    const plot = plotById.get(plan.plot_id);
    if (plot === undefined) throw new Error(`crop plan ${plan.id} references unknown plot ${plan.plot_id}`);
    const need = cropEngine.weeklyNeed({
      plan: plan as never,
      plot: plot as never,
      params: cropParamsFor(plan) as never,
      weather: week as never,
      weekStart,
    });
    const key = `${plot.farmer_id}:${plot.outlet_id}`;
    const existing = byFarmer.get(key);
    if (existing !== undefined) {
      existing.volume_m3 += need.volume_m3;
    } else {
      byFarmer.set(key, { farmer_id: plot.farmer_id, outlet_id: plot.outlet_id, volume_m3: need.volume_m3, priority: 1 });
    }
  }
  return [...byFarmer.values()];
}

describe("rosterEngine planned need met on the shipped seed (handoff P4)", () => {
  const canal = demoScenario.canal as never;
  const outlets = demoScenario.outlets as never;
  const window = demoScenario.release_windows[0]! as never;
  const demands = seedDemands();

  const inputFor = (mode: "equal_hours" | "equal_water"): RosterInput => ({ canal, outlets, window, demands, mode });

  it("caps the delivered view at 100% for everyone, which is why the old live path read Gini 0", () => {
    const input = inputFor("equal_hours");
    const roster = rosterEngine.build(input, "seed-hours");
    const capped = rosterEngine.needMet(input, roster);

    // The regression: the cap erases the head-vs-tail gap the roster actually contains.
    for (const row of capped) expect(row.pct).toBe(100);
    expect(ledger.gini(capped.map(row => row.pct))).toBe(0);
  });

  it("keeps the over-allocation in plannedNeedMet: head > tail, monotonic by chainage", () => {
    const input = inputFor("equal_hours");
    const roster = rosterEngine.build(input, "seed-hours");
    const planned = rosterEngine.plannedNeedMet(input, roster);

    // One row per outlet, head (o1) to tail (o8): the seed lays out one plot per outlet.
    const pctByOutlet = new Map(planned.map(row => [row.outlet_id, row.pct]));
    const ordered = ["o1", "o2", "o3", "o4", "o5", "o6", "o7", "o8"].map(id => pctByOutlet.get(id)!);
    for (let i = 1; i < ordered.length; i += 1) {
      expect(ordered[i]!).toBeLessThan(ordered[i - 1]!);
    }

    // Handoff's narrative says the tail is well under the head. On the shipped seed the physical
    // flow ratio makes the tail 73% of the head, not 42%; both are asserted from the data, not typed.
    expect(ordered[0]!).toBeCloseTo(280.794, 2);
    expect(ordered.at(-1)!).toBeCloseTo(205.536, 2);
    expect(ordered.at(-1)!).toBeLessThan(ordered[0]!);
  });

  it("gives equal_water a Gini of 0 and equal_hours a higher one, both un-capped", () => {
    const hoursInput = inputFor("equal_hours");
    const waterInput = inputFor("equal_water");

    const hours = rosterEngine.plannedNeedMet(hoursInput, rosterEngine.build(hoursInput, "seed-hours"));
    const water = rosterEngine.plannedNeedMet(waterInput, rosterEngine.build(waterInput, "seed-water"));

    // Every equal-water demand fits the window, so every farmer is exactly at need.
    for (const row of water) expect(row.pct).toBeCloseTo(100, 6);
    const waterGini = ledger.gini(water.map(row => row.pct));
    const hoursGini = ledger.gini(hours.map(row => row.pct));

    expect(waterGini).toBe(0);
    expect(hoursGini).toBeCloseTo(0.0593, 3);
    expect(waterGini).toBeLessThan(hoursGini);
  });

  it("does not change the documented capped needMet or the roster itself", () => {
    const input = inputFor("equal_water");
    const roster = rosterEngine.build(input, "seed-water");
    // equal_water schedules every demand in full, so the capped view is 100 too — no behaviour change.
    for (const row of rosterEngine.needMet(input, roster)) expect(row.pct).toBe(100);
    // The additive method returns a row per input demand, in input order.
    expect(rosterEngine.plannedNeedMet(input, roster)).toHaveLength(demands.length);
    expect(rosterEngine.plannedNeedMet(input, roster).map(row => row.outlet_id)).toEqual(
      demands.map(demand => demand.outlet_id),
    );
  });
});
