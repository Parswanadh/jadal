/**
 * The Need agent.
 *
 * `suggestEntitlements` prices one irrigation week for every verified crop plan by calling the
 * deterministic FAO-56 crop engine — never an LLM and never a hand-written volume. The explanation is
 * a deterministic template that cites the crop, the plot area, the net depth (mm) and the resulting
 * volume (m³), so a coordinator can check every number against the plan it came from. A language
 * model may word responses elsewhere, but the need itself is arithmetic (docs/architecture §2).
 *
 * The returned shape is exactly `routes.suggestEntitlements.response`.
 */

import type { Entitlement, WeatherDay } from "@jadal/contracts";
import { cropEngine } from "../core/crop-engine";
import { cropParamsFor } from "../core/crop-params";
import { round } from "../core/units";
import { now } from "../db/clock";
import { deterministicId } from "../db/id";
import { getWeather, listFarmers, listOutlets } from "../db/repo";
import { loadDemoWeather } from "../voice/openmeteo";
import type { ToolEnv } from "./tools";

export interface EntitlementSuggestion {
  readonly entitlements: Entitlement[];
  readonly season_total_m3: number;
  readonly explanation: string;
}

const MS_PER_DAY = 86_400_000;

/** The Monday on or before an ISO instant, as `YYYY-MM-DD`. Weeks are Monday-aligned everywhere. */
export function weekStartFor(isoTime: string): string {
  const parsed = new Date(isoTime);
  if (Number.isNaN(parsed.getTime())) throw new RangeError(`not an ISO-8601 instant: ${JSON.stringify(isoTime)}`);
  const sinceMonday = (parsed.getUTCDay() + 6) % 7;
  const monday = new Date(parsed.getTime() - sinceMonday * MS_PER_DAY);
  return monday.toISOString().slice(0, 10);
}

/** Add whole days to a `YYYY-MM-DD` date, staying in UTC. */
export function addDaysIso(iso: string, days: number): string {
  const anchor = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(anchor)) throw new RangeError(`not a YYYY-MM-DD date: ${JSON.stringify(iso)}`);
  return new Date(anchor + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Seven days of weather for a week from the cache, falling back to the bundled offline snapshot. */
async function weatherForWeek(env: ToolEnv, canalId: string, weekStart: string): Promise<WeatherDay[]> {
  const cached = await getWeather(env, canalId, weekStart, 7);
  if (cached.length >= 7) return cached.slice(0, 7);

  const byDate = new Map(loadDemoWeather().map((day) => [day.date, day]));
  const week: WeatherDay[] = [];
  for (let day = 0; day < 7; day += 1) {
    const weatherDay = byDate.get(addDaysIso(weekStart, day));
    if (weatherDay !== undefined) week.push(weatherDay);
  }
  return week;
}

/** One line of the deterministic explanation, citing crop, area, depth and volume. */
function explanationLine(crop: string, areaHa: number, netMm: number, volumeM3: number, stage: string, kc: number): string {
  return `${crop} on ${areaHa} ha at ${netMm} mm net (${stage} stage, Kc ${kc}) needs ${volumeM3} m³ at the field gate.`;
}

/**
 * Price one week for every verified/active crop plan.
 *
 * Pure with respect to the network (weather comes from the cache or the bundled snapshot), so it is
 * safe to call from a gated tool: it reads and computes but never writes.
 */
export async function computeEntitlements(env: ToolEnv, weekStart: string): Promise<EntitlementSuggestion> {
  const farmers = await listFarmers(env);
  const outlets = await listOutlets(env);
  const canalOfOutlet = new Map(outlets.map((outlet) => [outlet.id, outlet.canal_id]));
  const fallbackCanalId = outlets[0]?.canal_id;

  const entitlements: Entitlement[] = [];
  const lines: string[] = [];

  for (const record of farmers) {
    const plotById = new Map(record.plots.map((plot) => [plot.id, plot]));
    for (const plan of record.crop_plans) {
      if (plan.status !== "verified" && plan.status !== "active") continue;
      const plot = plotById.get(plan.plot_id);
      if (plot === undefined) continue;
      const canalId = canalOfOutlet.get(plot.outlet_id) ?? fallbackCanalId;
      if (canalId === undefined) continue;

      const weather = await weatherForWeek(env, canalId, weekStart);
      const params = cropParamsFor(plan);
      const need = cropEngine.weeklyNeed({ plan, plot, params, weather, weekStart });
      const volume_m3 = round(need.volume_m3, 3);
      const net_mm = round(need.net_irrigation_mm, 3);
      const areaHa = round(plot.area_ha * plan.area_fraction, 3);

      entitlements.push({
        id: deterministicId("ent", plan.id, weekStart),
        farmer_id: record.farmer.id,
        crop_plan_id: plan.id,
        week_start: weekStart,
        volume_m3,
        net_irrigation_mm: net_mm,
        status: "proposed",
        explanation: `${plan.crop} ${need.stage} stage, Kc ${need.kc}`,
      });
      lines.push(explanationLine(plan.crop, areaHa, net_mm, volume_m3, need.stage, need.kc));
    }
  }

  const season_total_m3 = round(
    entitlements.reduce((sum, entitlement) => sum + entitlement.volume_m3, 0),
    3,
  );
  const explanation =
    entitlements.length === 0
      ? "No verified crop plan needs water this week: nothing is in the ground, or rain covers the demand."
      : `Weekly field-gate need for ${entitlements.length} verified crop plan(s), from FAO-56 ` +
        `(ETc = Kc · ET₀, minus effective rain):\n${lines.join("\n")}`;

  return { entitlements, season_total_m3, explanation };
}

/**
 * Suggest the week's entitlements. With no `weekStart`, the week is the Monday of the simulated
 * clock's current day, so the demo and production agree without either knowing the other's date.
 */
export async function suggestEntitlements(env: ToolEnv, weekStart?: string): Promise<EntitlementSuggestion> {
  const week = weekStart ?? weekStartFor(await now(env));
  return computeEntitlements(env, week);
}
