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
  /**
   * DELIVERED need met: % of each farmer's demand that the roster's turned volume covers, **capped
   * at 100**. This is the post-allocation, "can we claim the crop is watered" measure and its
   * documented cap is deliberate: a farmer cannot have more than 100% of their need met.
   */
  needMet(input: RosterInput, roster: Roster): { farmer_id: string; outlet_id: string; pct: number }[];
  /**
   * PLANNED need met: the same ratio **without the 100% cap**, so a head-end farmer that the roster
   * over-allocates reads >100 and the tail-end deficit stays visible at proposal time.
   *
   * The fairness comparison the product exists to make (equal-hours warabandi vs equal-water) is a
   * comparison of *planned* allocation, before any water is delivered, and the cap is what made the
   * live path report 100% for everyone (handoff P4). This is an additive method: the contract's
   * `RosterEngine.needMet` keeps its capped semantics.
   */
  plannedNeedMet(input: RosterInput, roster: Roster): { farmer_id: string; outlet_id: string; pct: number }[];
}

export const rosterEngine = {
  /**
   * Deterministic head-to-tail packing of irrigation turns into a release window.
   *
   * Turn duration (README §8, `docs/research/fao56-crop-tables.md` §4.8 item 3):
   *   equal_water:  T_i = V_i / Q(x_i)          [s]
   *   equal_hours:  T_i = (V_i / sum V) . window [s]  (warabandi share, see the branch comment)
   *
   *   Delivered volume V = Q(x_i) . T_i .        [m3]
   *
   * Units: V in m3; Q(x_i) in m3/s from the hydraulics model; T in s converted to ms for ISO
   * timestamps. `3600` in the lag term converts the hydraulics model's hours to seconds.
   *
   * Ordering (deterministic, README §8 "head-to-tail"):
   *   1. outlet chainage ascending  2. priority ascending  3. farmer_id alphabetical.
   * This is a total order, so equal inputs always produce an identical roster — the determinism
   * property the whole S0 layer rests on. Note that priority is only the SECOND key: a head-end
   * farmer outranks a tail-end farmer with a better priority.
   *
   * Lag accounting: the FIRST turn at each outlet starts no earlier than
   * `window start + lag(x_i)`, because the wetting front has to arrive. Later turns at the same
   * outlet reuse the running cursor: once the outlet is wet, no further lag applies.
   *
   * Boundaries:
   *  * Unknown `outlet_id` in a demand: Q = 0 and lag = 0, so the whole demand is shortfall and
   *    no turn is emitted.
   *  * `volume_m3 <= 0`: the demand is skipped entirely (no turn, no shortfall). A zero-volume
   *    demand is not a failed demand.
   *  * Zero-length or already-closed window (`end <= start`): every positive demand is shortfall.
   *  * `Q <= 0`: shortfall, no turn — a dry outlet cannot be scheduled.
   *  * `equal_water` books the remaining window as a partial turn and records the deficit rather
   *    than dropping the demand.
   *  * `shortfall_m3` is keyed by `farmer_id`, so a farmer with demands at two outlets has their
   *    shortfalls summed across both.
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
      // equal_hours = warabandi: the window is split among farmers by need, not by volume.
      //
      // SOURCE: `packages/core/README.md` §8 defines `equal_hours` as "Warabandi" allocating time
      // in proportion to demand; `docs/research/deterministic-and-system1.md` line 160+ describes
      // warabandi as rotational time-sharing. This is the LEGACY comparison mode: it exists so the
      // coordinator can see what the traditional rule would have delivered next to equal_water.
      //
      // ASSUMED: the split is by demand VOLUME (which is proportional to area for a single crop).
      // README §8 describes `equal_hours` as `T_i = V_i / Q_0` — a time proportional to volume at
      // the HEAD discharge. That is what the fraction below implements: each farmer's share of the
      // window is their share of total demand, and the volume delivered is that share of the window
      // times the flow ACTUALLY reaching their outlet.
      //
      // CONSEQUENCE, and the reason this mode is reported as inequitable rather than "equal": the
      // volume each farmer receives is (their fraction of the window) x Q(x_i), so a tail-end
      // farmer on a lower Q receives proportionally less water for the same hours. That tail-end
      // deficit is the real behaviour warabandi exhibits and the thing Jadal exists to fix, so it
      // is modelled deliberately.
      //
      // BOUNDARY: `shortfall_m3` compares what each farmer RECEIVED against what they DEMANDED.
      // `deliveredVol` is Q(x_i) x duration, so it is capped by the physical flow at the outlet.
      const positiveDemandVol = sortedDemands.reduce((sum, d) => sum + Math.max(0, d.volume_m3), 0);
      let currentCursorMs = windowStartMs;
      let turnIdx = 0;

      for (let i = 0; i < sortedDemands.length; i++) {
        const demand = sortedDemands[i]!;
        const hyd = hydMap.get(demand.outlet_id);
        const Q = hyd?.flow_m3s ?? 0;
        // Guard both the all-zero case and a net-negative demand set; fall back to an even split.
        const fraction =
          positiveDemandVol > 0
            ? Math.max(0, demand.volume_m3) / positiveDemandVol
            : 1 / sortedDemands.length;
        const durationMs = fraction * totalWindowMs;

        const turnStartMs = currentCursorMs;
        let turnEndMs = i === sortedDemands.length - 1 ? windowEndMs : turnStartMs + durationMs;
        if (turnEndMs > windowEndMs) {
          turnEndMs = windowEndMs;
        }

        // A turn whose window has already closed (windowEndMs <= turnStartMs) delivers nothing and
        // the whole demand is a shortfall, matching the equal_water branch's behaviour.
        const durationSec = Math.max(0, (turnEndMs - turnStartMs) / 1000);
        const deliveredVol = Math.max(0, Q) * durationSec;
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
   *
   * Units: both sides are m3, so pct is dimensionless [%].
   *
   * Boundaries:
   *  * A demand of 0 (or a demand with no positive total) reports 100%: nothing was asked for, so
   *    nothing was missed. ASSUMED — the alternative (0%) would make a farmer who requested
   *    nothing look like the worst-served in the equity comparison.
   *  * The result is keyed by `farmer_id` + `outlet_id` but is returned one row per INPUT demand,
   *    so a farmer with two demands at the same outlet gets two rows carrying the same pooled
   *    percentage. That is intentional (the caller zips rows back to demands) but means the
   *    returned array is NOT a set of distinct (farmer, outlet) pairs.
   *  * pct is capped at 100 but NOT floored at 0: a roster that somehow over-delivers reports 100.
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

  /**
   * Planned need met — the *un-capped* allocation ratio `planned_volume_m3 / demand . 100`.
   *
   * `needMet` caps at 100 so a farmer never reads as "more than satisfied". That cap is correct for
   * a delivered claim but destroys the equal-hours vs equal-water comparison: in the demo seed the
   * 24 h `rw1` window carries more than the week's FAO-56 need, so equal-hours over-allocates every
   * head-end outlet past 100%. Clamping then reports 100% for everyone and the Gini collapses to 0
   * (handoff P4). This method keeps the over-allocation visible so the head-vs-tail spread and the
   * Gini are meaningful at proposal time.
   *
   * Units: both sides are m3, so pct is dimensionless [%]. NOT capped at 100.
   *
   * Boundaries:
   *  * A demand of 0 (or a demand with no positive total) reports 100: nothing was asked for, so
   *    nothing was missed — matching `needMet`'s documented boundary.
   *  * A demand with no turn reports 0: the outlet was not scheduled at all.
   *  * Keyed by `farmer_id` + `outlet_id` and returned one row per INPUT demand, exactly like
   *    `needMet`, so the two arrays zip together row for row.
   */
  plannedNeedMet(input: RosterInput, roster: Roster): { farmer_id: string; outlet_id: string; pct: number }[] {
    const allocatedByFarmerOutlet = new Map<string, number>();
    for (const turn of roster.turns) {
      const key = `${turn.farmer_id}:${turn.outlet_id}`;
      allocatedByFarmerOutlet.set(key, (allocatedByFarmerOutlet.get(key) ?? 0) + turn.planned_volume_m3);
    }

    const totalDemandByFarmerOutlet = new Map<string, number>();
    for (const d of input.demands) {
      const key = `${d.farmer_id}:${d.outlet_id}`;
      totalDemandByFarmerOutlet.set(key, (totalDemandByFarmerOutlet.get(key) ?? 0) + d.volume_m3);
    }

    return input.demands.map(demand => {
      const key = `${demand.farmer_id}:${demand.outlet_id}`;
      const totalDem = totalDemandByFarmerOutlet.get(key) ?? 0;
      const allocated = allocatedByFarmerOutlet.get(key) ?? 0;
      const pct = totalDem > 0 ? (allocated / totalDem) * 100 : 100;
      return {
        farmer_id: demand.farmer_id,
        outlet_id: demand.outlet_id,
        pct,
      };
    });
  },
} satisfies RosterEngine;
