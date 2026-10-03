import { describe, it } from "vitest";
import scenarioJson from "@jadal/contracts/fixtures/demo-scenario.json";
import weatherJson from "@jadal/contracts/fixtures/demo-weather.json";
import { cropEngine, cropParams, hydraulics, ledger, rosterEngine } from "@jadal/core";
import type { CropParams, CropPlan, Plot, RosterInput, WeatherDay } from "@jadal/contracts";

const CROP_PARAM_ROWS = cropParams as readonly CropParams[];
const WEATHER = (weatherJson as unknown as { days: WeatherDay[] }).days;
const scenario = scenarioJson as unknown as {
  canal: any;
  outlets: { id: string; chainage_m: number }[];
  plots: Plot[];
  crop_plans: CropPlan[];
  release_windows: any[];
  season_supply_m3: number;
};

function cropParamsFor(plan: CropPlan): CropParams {
  if (plan.crop === "rice") {
    const variant = plan.rice_practice === "intermittent" ? "intermittent" : "flooded";
    return CROP_PARAM_ROWS.find((c) => c.crop === "rice" && c.variant === variant)!;
  }
  return CROP_PARAM_ROWS.find((c) => c.crop === plan.crop)!;
}

const MS_PER_DAY = 86_400_000;
function weekStartFor(isoTime: string): string {
  const parsed = new Date(isoTime);
  const sinceMonday = (parsed.getUTCDay() + 6) % 7;
  return new Date(parsed.getTime() - sinceMonday * MS_PER_DAY).toISOString().slice(0, 10);
}
function weekOf(weekStart: string): WeatherDay[] {
  const anchor = Date.parse(`${weekStart}T00:00:00Z`);
  const byDate = new Map(WEATHER.map((d) => [d.date, d]));
  const out: WeatherDay[] = [];
  for (let offset = 0; offset < 7; offset++) {
    const day = byDate.get(new Date(anchor + offset * MS_PER_DAY).toISOString().slice(0, 10));
    if (day !== undefined) out.push(day);
  }
  return out;
}

function weeklyNeed(plan: CropPlan, weekStart: string) {
  const plot = scenario.plots.find((p) => p.id === plan.plot_id)!;
  return cropEngine.weeklyNeed({ plan, plot, params: cropParamsFor(plan), weather: weekOf(weekStart), weekStart });
}
function seasonNeed(plan: CropPlan) {
  const plot = scenario.plots.find((p) => p.id === plan.plot_id)!;
  return cropEngine.seasonNeed({ plan, plot, params: cropParamsFor(plan), weather: WEATHER }).total_m3;
}

describe("experiment", () => {
  it("prints numbers", () => {
    const weekStart = "2026-09-14";
    let weeklyTotal = 0;
    let seasonTotal = 0;
    for (const cp of scenario.crop_plans) {
      const w = weeklyNeed(cp, weekStart);
      const s = seasonNeed(cp);
      weeklyTotal += w.volume_m3;
      seasonTotal += s;
      console.log(`${cp.id} ${cp.crop} net_mm=${w.net_irrigation_mm.toFixed(2)} weekly=${w.volume_m3.toFixed(1)} season=${s.toFixed(1)} stage=${w.stage}`);
    }
    console.log(`weeklyTotal=${weeklyTotal.toFixed(1)} seasonTotal=${seasonTotal.toFixed(1)}`);

    const v = hydraulics.velocity_ms(scenario.canal);
    console.log(`velocity=${v.toFixed(4)} m/s`);
    const atOutlets = hydraulics.atOutlets(scenario.canal, scenario.outlets, scenario.canal.head_discharge_m3s);
    for (const o of atOutlets) console.log(`${o.outlet_id} Q=${o.flow_m3s.toFixed(4)} lag_h=${o.lag_h.toFixed(3)} loss=${o.loss_fraction.toFixed(3)}`);

    // demand models
    const window = scenario.release_windows[0];
    const demandsFor = (scale: number, useSeason = false) => {
      const byFarmer = new Map<string, { outlet_id: string; volume_m3: number }>();
      for (const cp of scenario.crop_plans) {
        const plot = scenario.plots.find((p) => p.id === cp.plot_id)!;
        const vol = useSeason ? seasonNeed(cp) : weeklyNeed(cp, weekStart).volume_m3;
        const e = byFarmer.get(plot.farmer_id) ?? { outlet_id: plot.outlet_id, volume_m3: 0 };
        e.volume_m3 += vol;
        byFarmer.set(plot.farmer_id, e);
      }
      return [...byFarmer.entries()]
        .filter(([, v]) => v.volume_m3 > 0)
        .map(([farmer_id, v]) => ({ farmer_id, outlet_id: v.outlet_id, volume_m3: v.volume_m3 * scale, priority: 1 }));
    };

    for (const [label, scale, useSeason] of [["weekly", 1, false], ["season", 1, true], ["weekly*2.14", 2.14, false]] as const) {
      const demands = demandsFor(scale, useSeason);
      const vTot = demands.reduce((s, d) => s + d.volume_m3, 0);
      const input: RosterInput = { canal: scenario.canal, outlets: scenario.outlets, window, demands, mode: "equal_water" };
      const rw = rosterEngine.build({ ...input, mode: "equal_water" }, "r-rw1-equal_water");
      const rh = rosterEngine.build({ ...input, mode: "equal_hours" }, "r-rw1-equal_hours");
      const nrw = rosterEngine.plannedNeedMet({ ...input, mode: "equal_water" }, rw);
      const nrh = rosterEngine.plannedNeedMet({ ...input, mode: "equal_hours" }, rh);
      const giniW = ledger.gini(nrw.map((n) => n.pct));
      const giniH = ledger.gini(nrh.map((n) => n.pct));
      const tailW = nrw[nrw.length - 1]?.pct ?? 0;
      const tailH = nrh[nrh.length - 1]?.pct ?? 0;
      const allAbove90 = nrw.every((n) => n.pct > 90);
      console.log(`\n[${label}] V_tot=${vTot.toFixed(0)} turns=${rw.turns.length} giniW=${giniW.toFixed(4)} giniH=${giniH.toFixed(4)} tailW=${tailW.toFixed(1)} tailH=${tailH.toFixed(1)} allAbove90=${allAbove90} tailAfter>tailBefore=${tailW > tailH}`);
      console.log(`  need_met W: ${nrw.map((n) => n.pct.toFixed(0)).join(",")}`);
      console.log(`  need_met H: ${nrh.map((n) => n.pct.toFixed(0)).join(",")}`);
    }
  });
});
