/**
 * The Scheduler agent.
 *
 * `proposeRoster` builds a warabandi rotation for one release window and returns it *without
 * committing* — the route (and the gated `optimize_roster` tool) hand the proposal to the
 * coordinator. Two modes are built, always:
 *
 *   * the requested mode, returned as `roster` / `need_met`;
 *   * both modes' per-farmer need-met percentages, reduced to Gini coefficients in `comparison`.
 *
 * The rotation itself is the deterministic `rosterEngine`; this module only assembles its input from
 * the database and calls `ledger.gini`. It does no water arithmetic. The response shape is exactly
 * `routes.proposeRoster.response`.
 */

import type { Plot, Roster, RosterInput } from "@jadal/contracts";
import { ledger, rosterEngine } from "../core-shim";
import { deterministicId } from "../db/id";
import { getCanal, getEntitlementsForWeek, getReleaseWindow, listFarmers, listOutlets } from "../db/repo";
import { weekStartFor } from "./need";
import type { ToolEnv } from "./tools";

export type RosterMode = "equal_water" | "equal_hours";

export interface RosterProposal {
  readonly roster: Roster;
  readonly need_met: { farmer_id: string; outlet_id: string; pct: number }[];
  readonly comparison: { equal_hours_gini: number; equal_water_gini: number };
}

/** The canal, its outlets and the per-farmer demand for a window's week. */
async function windowInput(env: ToolEnv, releaseWindowId: string): Promise<RosterInput> {
  const window = await getReleaseWindow(env, releaseWindowId);
  if (window === null) throw new RangeError(`no release window ${releaseWindowId}`);
  const canal = await getCanal(env, window.canal_id);
  if (canal === null) throw new RangeError(`release window ${releaseWindowId} references unknown canal ${window.canal_id}`);

  const outlets = await listOutlets(env, window.canal_id);
  const weekStart = weekStartFor(window.start);
  const entitlements = await getEntitlementsForWeek(env, weekStart);

  const farmers = await listFarmers(env);
  const plotOfFarmer = new Map<string, Plot>();
  for (const record of farmers) {
    const plot = record.plots[0];
    if (plot !== undefined) plotOfFarmer.set(record.farmer.id, plot);
  }

  const volumeByFarmer = new Map<string, number>();
  for (const entitlement of entitlements) {
    volumeByFarmer.set(entitlement.farmer_id, (volumeByFarmer.get(entitlement.farmer_id) ?? 0) + entitlement.volume_m3);
  }

  const demands: RosterInput["demands"] = [];
  for (const farmer_id of [...volumeByFarmer.keys()].sort()) {
    const plot = plotOfFarmer.get(farmer_id);
    const volume_m3 = volumeByFarmer.get(farmer_id) ?? 0;
    if (plot === undefined || !(volume_m3 > 0)) continue;
    // Priority is the only ordering signal the contract gives for competing demands at one gate.
    // No request is treated as more urgent than another here; the deterministic farmer-id tiebreak
    // in `rosterEngine` keeps the result stable.
    demands.push({ farmer_id, outlet_id: plot.outlet_id, volume_m3, priority: 1 });
  }

  return { canal, outlets, window, demands, mode: "equal_water" };
}

function build(input: RosterInput, releaseWindowId: string, mode: RosterMode): { roster: Roster; need_met: { farmer_id: string; outlet_id: string; pct: number }[] } {
  const withMode: RosterInput = { ...input, mode };
  const roster = rosterEngine.build(withMode, deterministicId("rost", releaseWindowId, mode));
  return { roster, need_met: rosterEngine.needMet(withMode, roster) };
}

/** Gini over the per-farmer need-met percentages of a built rotation. */
function giniOf(needMet: readonly { pct: number }[]): number {
  return ledger.gini(needMet.map((entry) => entry.pct));
}

/**
 * Propose a roster for `releaseWindowId` in `mode`, with both modes' fairness in `comparison`.
 * Never writes: the caller decides whether the coordinator approves it.
 */
export async function proposeRoster(env: ToolEnv, releaseWindowId: string, mode: RosterMode): Promise<RosterProposal> {
  const input = await windowInput(env, releaseWindowId);
  const requested = build(input, releaseWindowId, mode);
  const equalHours = build(input, releaseWindowId, "equal_hours");
  const equalWater = build(input, releaseWindowId, "equal_water");
  return {
    roster: requested.roster,
    need_met: requested.need_met,
    comparison: {
      equal_hours_gini: giniOf(equalHours.need_met),
      equal_water_gini: giniOf(equalWater.need_met),
    },
  };
}

/** Kept for callers that already hold `Balances`; the agent itself never needs it. */
