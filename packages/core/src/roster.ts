import { hydraulics, type Canal, type Outlet } from "./hydraulics";

export interface ReleaseWindow {
  id: string;
  canal_id: string;
  start: string;
  end: string;
  discharge_m3s: number;
}

export interface Turn {
  id: string;
  roster_id: string;
  outlet_id: string;
  farmer_id: string;
  start: string;
  end: string;
  planned_volume_m3: number;
  expected_flow_m3s: number;
  lag_h: number;
}

export interface Roster {
  id: string;
  canal_id: string;
  release_window_id: string;
  status: "proposed" | "approved" | "superseded";
  turns: Turn[];
  /** Volume that could not be scheduled inside the window, by farmer. */
  shortfall_m3: Record<string, number>;
}

export interface RosterInput {
  canal: Canal;
  outlets: Outlet[];
  window: ReleaseWindow;
  /** Required volume at the field gate, per farmer per outlet, for this window. */
  demands: { farmer_id: string; outlet_id: string; volume_m3: number; priority: number }[];
  mode: "equal_water" | "equal_hours";
}

export interface RosterEngine {
  /** Deterministic: same input → same roster. Head-to-tail order; turn = V / Q_outlet (+ lag before the first tail turn). */
  build(input: RosterInput, rosterId: string): Roster;
  /** % of need met per farmer for a roster (used for the equal-hours vs equal-water comparison). */
  needMet(input: RosterInput, roster: Roster): { farmer_id: string; outlet_id: string; pct: number }[];
}

export const rosterEngine = {
  /**
   * Deterministic head-to-tail packing of irrigation turns into a release window.
   * - equal_water: turn duration = V / Q_outlet (seconds -> ISO times) packed sequentially,
   *   accounting for canal travel lag before the first turn at each outlet, reporting unschedulable volume in shortfall_m3.
   * - equal_hours: legacy warabandi splitting window hours in proportion to demand volume (proportional to plot area),
   *   ignoring seepage losses; delivered volume = Q_outlet * hours.
   */
  build(input: RosterInput, rosterId: string): Roster {
    const hydList = hydraulics.atOutlets(input.canal, input.outlets, input.window.discharge_m3s);
    const hydMap = new Map(hydList.map(h => [h.outlet_id, h]));
    const outletMap = new Map(input.outlets.map(o => [o.id, o]));

    // Deterministic head-to-tail ordering:
    // 1. Outlet chainage ascending
    // 2. Priority ascending
    // 3. Farmer ID alphabetical tie-break
    const sortedDemands = [...input.demands].sort((a, b) => {
      const chA = outletMap.get(a.outlet_id)?.chainage_m ?? 0;
      const chB = outletMap.get(b.outlet_id)?.chainage_m ?? 0;
      if (chA !== chB) return chA - chB;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.farmer_id.localeCompare(b.farmer_id);
    });

    const windowStartMs = new Date(input.window.start).getTime();
    const windowEndMs = new Date(input.window.end).getTime();
    const totalWindowMs = Math.max(0, windowEndMs - windowStartMs);

    const turns: Turn[] = [];
    const shortfall_m3: Record<string, number> = {};

    if (input.mode === "equal_water") {
      let currentCursorMs = windowStartMs;
      const visitedOutlets = new Set<string>();
      let turnIdx = 0;

      for (const demand of sortedDemands) {
        const hyd = hydMap.get(demand.outlet_id);
        const Q = hyd?.flow_m3s ?? 0;
        const lagMs = (hyd?.lag_h ?? 0) * 3600 * 1000;

        let turnStartMs: number;
        if (!visitedOutlets.has(demand.outlet_id)) {
          turnStartMs = Math.max(currentCursorMs, windowStartMs + lagMs);
          visitedOutlets.add(demand.outlet_id);
        } else {
          turnStartMs = currentCursorMs;
        }

        if (demand.volume_m3 <= 0) {
          continue;
        }

        if (Q <= 0 || turnStartMs >= windowEndMs) {
          shortfall_m3[demand.farmer_id] = (shortfall_m3[demand.farmer_id] ?? 0) + demand.volume_m3;
          continue;
        }

        const neededDurationSec = demand.volume_m3 / Q;
        const neededDurationMs = neededDurationSec * 1000;
        const desiredEndMs = turnStartMs + neededDurationMs;
        const turnEndMs = Math.min(desiredEndMs, windowEndMs);

        let plannedVol: number;
        if (desiredEndMs <= windowEndMs) {
          plannedVol = demand.volume_m3;
        } else {
          const actualDurationSec = (turnEndMs - turnStartMs) / 1000;
          plannedVol = actualDurationSec * Q;
        }

        const deficit = Math.max(0, demand.volume_m3 - plannedVol);
        if (deficit > 1e-6) {
          shortfall_m3[demand.farmer_id] = (shortfall_m3[demand.farmer_id] ?? 0) + deficit;
        }

        turnIdx++;
        turns.push({
          id: `${rosterId}-t${turnIdx}`,
          roster_id: rosterId,
          outlet_id: demand.outlet_id,
          farmer_id: demand.farmer_id,
          start: new Date(turnStartMs).toISOString(),
          end: new Date(turnEndMs).toISOString(),
          planned_volume_m3: plannedVol,
          expected_flow_m3s: Q,
          lag_h: hyd?.lag_h ?? 0,
        });

        currentCursorMs = turnEndMs;
      }
    } else {
      // equal_hours mode = warabandi: window hours split in proportion to plot area ignoring losses
      const totalDemandVol = sortedDemands.reduce((sum, d) => sum + d.volume_m3, 0);
      let currentCursorMs = windowStartMs;
      let turnIdx = 0;

      for (let i = 0; i < sortedDemands.length; i++) {
        const demand = sortedDemands[i]!;
        const hyd = hydMap.get(demand.outlet_id);
        const Q = hyd?.flow_m3s ?? 0;
        const fraction = totalDemandVol > 0 ? demand.volume_m3 / totalDemandVol : 1 / sortedDemands.length;
        const durationMs = fraction * totalWindowMs;

        const turnStartMs = currentCursorMs;
        let turnEndMs = i === sortedDemands.length - 1 ? windowEndMs : turnStartMs + durationMs;
        if (turnEndMs > windowEndMs) {
          turnEndMs = windowEndMs;
        }

        const durationSec = Math.max(0, (turnEndMs - turnStartMs) / 1000);
        const deliveredVol = Q * durationSec;
        const deficit = Math.max(0, demand.volume_m3 - deliveredVol);

        if (deficit > 1e-6) {
          shortfall_m3[demand.farmer_id] = (shortfall_m3[demand.farmer_id] ?? 0) + deficit;
        }

        turnIdx++;
        turns.push({
          id: `${rosterId}-t${turnIdx}`,
          roster_id: rosterId,
          outlet_id: demand.outlet_id,
          farmer_id: demand.farmer_id,
          start: new Date(turnStartMs).toISOString(),
          end: new Date(turnEndMs).toISOString(),
          planned_volume_m3: deliveredVol,
          expected_flow_m3s: Q,
          lag_h: hyd?.lag_h ?? 0,
        });

        currentCursorMs = turnEndMs;
      }
    }

    return {
      id: rosterId,
      canal_id: input.canal.id,
      release_window_id: input.window.id,
      status: "proposed",
      turns,
      shortfall_m3,
    };
  },

  /**
   * Calculates the percentage of need met per farmer for a roster.
   * pct = delivered / demand * 100, capped at 100.
   */
  needMet(input: RosterInput, roster: Roster): { farmer_id: string; outlet_id: string; pct: number }[] {
    const deliveredByFarmerOutlet = new Map<string, number>();
    for (const turn of roster.turns) {
      const key = `${turn.farmer_id}:${turn.outlet_id}`;
      deliveredByFarmerOutlet.set(key, (deliveredByFarmerOutlet.get(key) ?? 0) + turn.planned_volume_m3);
    }

    const totalDemandByFarmerOutlet = new Map<string, number>();
    for (const d of input.demands) {
      const key = `${d.farmer_id}:${d.outlet_id}`;
      totalDemandByFarmerOutlet.set(key, (totalDemandByFarmerOutlet.get(key) ?? 0) + d.volume_m3);
    }

    return input.demands.map(demand => {
      const key = `${demand.farmer_id}:${demand.outlet_id}`;
      const totalDem = totalDemandByFarmerOutlet.get(key) ?? 0;
      const delivered = deliveredByFarmerOutlet.get(key) ?? 0;
      const pct = totalDem > 0 ? Math.min(100, (delivered / totalDem) * 100) : 100;
      return {
        farmer_id: demand.farmer_id,
        outlet_id: demand.outlet_id,
        pct,
      };
    });
  },
} satisfies RosterEngine;
