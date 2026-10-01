import type {
  RosterInput,
  RosterEngine,
  Roster,
  Turn,
  OutletHydraulics,
} from "@jadal/contracts";
import { hydraulics } from "./hydraulics";

export class CanalRosterEngine implements RosterEngine {
  /**
   * Deterministic roster builder.
   * Head-to-tail order along canal outlets.
   * In equal_water mode: allocates time = V / Q_outlet to deliver exact volume.
   * In equal_hours mode (warabandi): allocates time proportional to demand assuming uniform head discharge Q0,
   * ignoring seepage loss, so tail farmers receive less water.
   */
  build(input: RosterInput, rosterId: string): Roster {
    const { canal, outlets, window, demands, mode } = input;

    // 1. Calculate hydraulics at each outlet
    const outletHydraulics = hydraulics.atOutlets(canal, outlets, window.discharge_m3s);
    const hydMap = new Map<string, OutletHydraulics>(
      outletHydraulics.map((h) => [h.outlet_id, h])
    );

    // 2. Sort outlets head-to-tail by chainage
    const sortedOutlets = [...outlets].sort((a, b) => a.chainage_m - b.chainage_m);
    const outletOrderMap = new Map<string, number>(
      sortedOutlets.map((o, idx) => [o.id, idx])
    );

    // 3. Sort demands head-to-tail by outlet chainage, then by priority ascending
    const sortedDemands = [...demands].sort((a, b) => {
      const orderA = outletOrderMap.get(a.outlet_id) ?? 0;
      const orderB = outletOrderMap.get(b.outlet_id) ?? 0;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return a.priority - b.priority;
    });

    const windowStartMs = new Date(window.start).getTime();
    const windowEndMs = new Date(window.end).getTime();

    let currentScheduledMs = windowStartMs;
    const turns: Turn[] = [];
    const shortfall_m3: Record<string, number> = {};

    let currentOutletId: string | null = null;
    let turnIndex = 1;

    for (const demand of sortedDemands) {
      const hyd = hydMap.get(demand.outlet_id);
      if (!hyd || hyd.flow_m3s <= 0) {
        shortfall_m3[demand.farmer_id] =
          (shortfall_m3[demand.farmer_id] ?? 0) + demand.volume_m3;
        continue;
      }

      // Check if transitioning to a new outlet (account for travel lag from canal head)
      if (demand.outlet_id !== currentOutletId) {
        currentOutletId = demand.outlet_id;
        const arrivalAtOutletMs = windowStartMs + hyd.lag_h * 3600 * 1000;
        currentScheduledMs = Math.max(currentScheduledMs, arrivalAtOutletMs);
      }

      // Calculate required turn duration in seconds
      let durationSeconds = 0;
      if (mode === "equal_water") {
        // Allocate time to meet demanded volume at this outlet's actual flow
        durationSeconds = demand.volume_m3 / hyd.flow_m3s;
      } else {
        // equal_hours (warabandi): allocate hours based on head discharge Q0, ignoring canal losses
        const qAssumed = window.discharge_m3s;
        durationSeconds = demand.volume_m3 / qAssumed;
      }

      // Check remaining time in release window
      const turnStartMs = currentScheduledMs;
      if (turnStartMs >= windowEndMs) {
        // Window ended; demand cannot be scheduled
        shortfall_m3[demand.farmer_id] =
          (shortfall_m3[demand.farmer_id] ?? 0) + demand.volume_m3;
        continue;
      }

      const availableSeconds = (windowEndMs - turnStartMs) / 1000;
      const scheduledDurationSec = Math.min(durationSeconds, availableSeconds);
      const turnEndMs = turnStartMs + scheduledDurationSec * 1000;

      // Actual delivered volume during this turn: flow_m3s * duration
      const deliveredVolumeM3 = scheduledDurationSec * hyd.flow_m3s;
      const unservedM3 = Math.max(0, demand.volume_m3 - deliveredVolumeM3);

      if (unservedM3 > 0.001) {
        shortfall_m3[demand.farmer_id] =
          (shortfall_m3[demand.farmer_id] ?? 0) + unservedM3;
      }

      turns.push({
        id: `turn_${rosterId}_${turnIndex++}`,
        roster_id: rosterId,
        outlet_id: demand.outlet_id,
        farmer_id: demand.farmer_id,
        start: new Date(turnStartMs).toISOString(),
        end: new Date(turnEndMs).toISOString(),
        planned_volume_m3: deliveredVolumeM3,
        expected_flow_m3s: hyd.flow_m3s,
        lag_h: hyd.lag_h,
      });

      currentScheduledMs = turnEndMs;
    }

    return {
      id: rosterId,
      canal_id: canal.id,
      release_window_id: window.id,
      status: "proposed",
      turns,
      shortfall_m3,
    };
  }

  /**
   * Computes the percentage of water demand met for each farmer in the roster.
   */
  needMet(
    input: RosterInput,
    roster: Roster
  ): { farmer_id: string; outlet_id: string; pct: number }[] {
    // Map delivered volumes by farmer_id and outlet_id
    const deliveredMap = new Map<string, number>();

    for (const turn of roster.turns) {
      const key = `${turn.farmer_id}:${turn.outlet_id}`;
      deliveredMap.set(key, (deliveredMap.get(key) ?? 0) + turn.planned_volume_m3);
    }

    return input.demands.map((demand) => {
      const key = `${demand.farmer_id}:${demand.outlet_id}`;
      const delivered = deliveredMap.get(key) ?? 0;
      const pct =
        demand.volume_m3 > 0 ? (delivered / demand.volume_m3) * 100 : 100;

      return {
        farmer_id: demand.farmer_id,
        outlet_id: demand.outlet_id,
        pct,
      };
    });
  }
}

export const rosterEngine = new CanalRosterEngine();
