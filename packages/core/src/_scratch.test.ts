import { describe, it } from "vitest";
import { cropEngine } from "./crop";
import cropParams from "./data/crop-params.json";
import { rosterEngine } from "./roster";
import type { RosterInput } from "./roster";
import demoScenario from "../../contracts/fixtures/demo-scenario.json";
import demoWeather from "../../contracts/fixtures/demo-weather.json";

function weekStartFor(utcIso: string): string {
  const local = new Date(utcIso);
  const sinceMonday = (local.getUTCDay() + 6) % 7;
  const monday = new Date(local.getTime() - sinceMonday * 86_400_000);
  return monday.toISOString().slice(0, 10);
}
function weekOf(weather: readonly any[], weekStart: string): any[] {
  const anchor = Date.parse(`${weekStart}T00:00:00Z`);
  const byDate = new Map(weather.map((d: any) => [d.date, d]));
  const out: any[] = [];
  for (let o = 0; o < 7; o += 1) {
    const iso = new Date(anchor + o * 86_400_000).toISOString().slice(0, 10);
    const d = byDate.get(iso);
    if (d !== undefined) out.push(d);
  }
  return out;
}
function cropParamsFor(plan: any): any {
  const rows = cropParams as readonly any[];
  if (plan.crop === "rice") {
    const variant = plan.rice_practice === "intermittent" ? "intermittent" : "flooded";
    return rows.find((c) => c.crop === "rice" && c.variant === variant);
  }
  return rows.find((c) => c.crop === plan.crop);
}
function round(v: number, d = 3): number {
  const f = 10 ** d;
  const r = Math.round(v * f) / f;
  return r === 0 ? 0 : r;
}
function allocateSupply(needed: readonly any[], supply: number): number[] {
  if (needed.length === 0) return [];
  const totalNeed = needed.reduce((s, i) => s + i.need_m3, 0);
  const raw = needed.map((i) => (totalNeed > 0 ? round((i.need_m3 / totalNeed) * supply, 3) : round(supply / needed.length, 3)));
  const allocated = raw.reduce((s, v) => s + v, 0);
  const residual = round(supply - allocated, 3);
  if (residual !== 0) {
    let target = 0;
    for (let i = 1; i < raw.length; i += 1) if ((raw[i] ?? 0) > (raw[target] ?? 0)) target = i;
    raw[target] = round(Math.max(0, (raw[target] ?? 0) + residual), 3);
  }
  return raw;
}

describe("scratch", () => {
  it("prints seed numbers", () => {
    const weekStart = weekStartFor(demoScenario.now);
    const week = weekOf(demoWeather.days, weekStart);
    const plotById = new Map(demoScenario.plots.map((p) => [p.id, p]));
    const farmerOfPlot = new Map(demoScenario.plots.map((p) => [p.id, p.farmer_id]));
    const needed: any[] = [];
    for (const plan of demoScenario.crop_plans) {
      if ((plan as any).status === "harvested") continue;
      const plot = plotById.get(plan.plot_id)!;
      const need = cropEngine.weeklyNeed({ plan: plan as any, plot: plot as any, params: cropParamsFor(plan), weather: week as any, weekStart });
      needed.push({ plan, farmer_id: farmerOfPlot.get(plan.plot_id)!, need_m3: need.volume_m3 });
    }
    const volumes = allocateSupply(needed, demoScenario.season_supply_m3);
    // cluster entitlements by farmer
    const byFarmer: any[] = [];
    for (let i = 0; i < needed.length; i++) {
      const plot = plotById.get(needed[i].plan.plot_id)!;
      byFarmer.push({ farmer_id: needed[i].farmer_id, outlet_id: plot.outlet_id, volume_m3: volumes[i], priority: 1, need_m3: needed[i].need_m3 });
    }
    console.log("weekStart", weekStart);
    console.log("needed", needed.map((n) => [n.plan.id, n.farmer_id, round(n.need_m3, 1)]));
    console.log("scaled", byFarmer.map((b) => [b.farmer_id, b.outlet_id, b.volume_m3, round(b.need_m3, 1)]));

    const canal = demoScenario.canal as any;
    const outlets = demoScenario.outlets as any;
    const window = demoScenario.release_windows[0]! as any;

    for (const mode of ["equal_hours", "equal_water"] as const) {
      const input: RosterInput = { canal, outlets, window, demands: byFarmer.map(({ farmer_id, outlet_id, volume_m3, priority }) => ({ farmer_id, outlet_id, volume_m3, priority })), mode };
      const roster = rosterEngine.build(input, "scratch-" + mode);
      const need = rosterEngine.needMet(input, roster);
      console.log(mode, "turns", roster.turns.map((t) => [t.outlet_id, round(t.planned_volume_m3, 1)]));
      console.log(mode, "pct", need.map((n) => [n.outlet_id, round(n.pct, 2)]));
      console.log(mode, "shortfall", roster.shortfall_m3);
    }
    // also: crop need as demand (unscaled), summed per farmer (as the scheduler does)
    const perFarmer = new Map<string, { farmer_id: string; outlet_id: string; volume_m3: number; priority: number }>();
    for (const b of byFarmer) {
      const key = `${b.farmer_id}:${b.outlet_id}`;
      const cur = perFarmer.get(key);
      if (cur) cur.volume_m3 += b.need_m3;
      else perFarmer.set(key, { farmer_id: b.farmer_id, outlet_id: b.outlet_id, volume_m3: b.need_m3, priority: 1 });
    }
    const cropDemands = [...perFarmer.values()];
    for (const mode of ["equal_hours", "equal_water"] as const) {
      const input: RosterInput = { canal, outlets, window, demands: cropDemands, mode };
      const roster = rosterEngine.build(input, "scratch2-" + mode);
      const planned = rosterEngine.plannedNeedMet(input, roster);
      const vals = planned.map((n) => n.pct);
      console.log("CROPNEED", mode, "planned pct", planned.map((n) => [n.outlet_id, round(n.pct, 3)]));
      console.log("CROPNEED", mode, "gini", (() => { const n=vals.length; let sd=0,sv=0; for(let i=0;i<n;i++){sv+=vals[i]!; for(let j=0;j<n;j++) sd+=Math.abs(vals[i]!-vals[j]!);} return sv===0?0:sd/(2*n*sv); })());
    }
  });
});
