/**
 * Roster engine: which farmer gets which outlet, for how long, inside one release window.
 * Implements `RosterEngine` from `@jadal/contracts/core`.
 *
 * The rotation is the traditional head-to-tail warabandi one, with one deliberate difference per mode:
 *
 *  * **`equal_water`** — every farmer is scheduled for exactly the volume they asked for. Because the
 *    flow reaching an outlet decays with chainage (`Q_i = Q₀·e^(−k·x_i)`, see `hydraulics.ts`), a
 *    tail-end farmer's gate is open *longer* for the same volume. That longer turn is what offsets
 *    seepage, and it is why the tail reaches the same % of need as the head.
 *  * **`equal_hours`** — every farmer gets the same *time on their outlet*, the traditional warabandi
 *    rule. Nobody converts time into volume, so the same three hours hand `Q_i · t` to outlet *i*:
 *    the head end is over-watered and the tail is short by whatever seepage took on the way down.
 *
 * Mechanics (all of it from `docs/architecture/overview.md` §4.3):
 *
 *  * Outlets are visited in chainage order, ties broken by id, so the result never depends on the
 *    order the caller happened to list them in.
 *  * A turn cannot start before the wetting front has passed its own chainage:
 *    `start = max(previous_end, window.start + lag_h · 3600)`, and never before the previous turn ends,
 *    because the canal carries one stream: two gates are never open at once.
 *  * Turn duration is `planned_volume_m3 / (expected_flow_m3s · 3600)` hours — in `equal_hours` the
 *    volume is derived from the time instead, which is the same equation solved the other way round.
 *  * A turn that would run past `window.end` is truncated to the window; the volume that could not be
 *    scheduled is accumulated per farmer in `shortfall_m3`.
 *
 * Pure and deterministic: no clock, no I/O, no randomness, no LLM. Same input ⇒ byte-identical roster.
 */

import type { Roster, RosterEngine, RosterInput, Turn } from "@jadal/contracts";

import { hydraulics } from "./hydraulics";
import { round } from "./units";

/** Seconds in an hour. The contract speaks in hours, hydraulics in seconds, turns in ISO-8601. */
const SECONDS_PER_HOUR = 3600;
const MS_PER_SECOND = 1000;

/** One farmer's ask at one outlet, with the hydraulics of that outlet attached. */
interface Job {
  farmer_id: string;
  outlet_id: string;
  volume_m3: number;
  priority: number;
  chainage_m: number;
  flow_m3s: number;
  lag_h: number;
}

/**
 * Turn order inside a window: outlets head to tail, and inside one outlet the highest `priority`
 * demand is served first, then lower ones, with `farmer_id` as the final tie-break. Priority is the
 * only ordering signal the contract gives for competing demands at the same gate, so it is honoured
 * rather than ignored.
 */
function byTurnOrder(a: Job, b: Job): number {
  const byX = a.chainage_m - b.chainage_m;
  if (byX !== 0) return byX;
  const byPriority = b.priority - a.priority;
  if (byPriority !== 0) return byPriority;
  const byFarmer = a.farmer_id < b.farmer_id ? -1 : a.farmer_id > b.farmer_id ? 1 : 0;
  if (byFarmer !== 0) return byFarmer;
  return a.outlet_id < b.outlet_id ? -1 : a.outlet_id > b.outlet_id ? 1 : 0;
}

/** A positive `volume_m3` is the only thing that can become a turn. Zero asks are not demands. */
function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function key(farmer_id: string, outlet_id: string): string {
  return `${farmer_id}@${outlet_id}`;
}

export const rosterEngine: RosterEngine = {
  build(input: RosterInput, rosterId: string): Roster {
    const windowStartMs = Date.parse(input.window.start);
    const windowEndMs = Date.parse(input.window.end);
    const windowMs = windowEndMs - windowStartMs;
    // A window that will not parse leaves every comparison below false, so the rotation comes out
    // empty with the whole demand in `shortfall_m3`. That is the safe direction: no turn is ever
    // scheduled off an unknown window, and the coordinator sees that nobody got water.

    // Flow, cumulative seepage and travel lag at every outlet, head to tail. `discharge_m3s` is the
    // window's own release rate: a window is a contract with the irrigation department, and the
    // canal's `head_discharge_m3s` is only the design figure.
    const hydraulicsAt = hydraulics.atOutlets(input.canal, input.outlets, input.window.discharge_m3s);
    const byOutlet = new Map(hydraulicsAt.map((h) => [h.outlet_id, h]));

    const jobs: Job[] = [];
    for (const demand of input.demands) {
      if (!isPositive(demand.volume_m3)) continue;
      const at = byOutlet.get(demand.outlet_id);
      if (!at) continue; // an outlet that is not on this canal cannot be scheduled; the demand is dropped
      jobs.push({
        farmer_id: demand.farmer_id,
        outlet_id: demand.outlet_id,
        volume_m3: demand.volume_m3,
        priority: demand.priority,
        chainage_m: at.chainage_m,
        flow_m3s: at.flow_m3s,
        lag_h: at.lag_h,
      });
    }
    jobs.sort(byTurnOrder);

    // Travel lag arrives at a sub-millisecond instant (x/v in seconds), but turn times are ISO-8601
    // with millisecond resolution, so the wait is rounded *up*: a turn must never begin a fraction
    // of a millisecond before the water does.
    const lagMsOf = (lag_h: number): number =>
      Math.ceil(lag_h * SECONDS_PER_HOUR * MS_PER_SECOND);

    // `equal_hours` share: the window is spent on the rotation only once the front has reached the
    // first turn, and the n turns together must fill exactly that span. Divided by the number of
    // turns (not the number of outlets) so two farmers sharing a gate each get equal time.
    const firstJob = jobs[0];
    const firstLagMs = firstJob ? lagMsOf(firstJob.lag_h) : 0;
    const shareH =
      input.mode === "equal_hours" && firstJob && windowMs > firstLagMs
        ? (windowMs - firstLagMs) / MS_PER_SECOND / jobs.length / SECONDS_PER_HOUR
        : 0;

    const turns: Turn[] = [];
    const unservedM3: Record<string, number> = {};
    const unserved = (farmer_id: string, volume_m3: number): void => {
      unservedM3[farmer_id] = (unservedM3[farmer_id] ?? 0) + volume_m3;
    };

    // The canal carries one stream, so the cursor is the end of the previous turn. It also absorbs the
    // lag: a tail turn can only start when the front arrives, whichever is later.
    let cursorMs = windowStartMs;
    for (const job of jobs) {
      const flow = job.flow_m3s;
      if (!isPositive(flow)) {
        // Nothing reaches this outlet (over-drawn upstream, or a dry reach): nobody can water here.
        unserved(job.farmer_id, job.volume_m3);
        continue;
      }
      const lagMs = lagMsOf(job.lag_h);
      const startMs = Math.max(cursorMs, windowStartMs + lagMs);
      const durationH = input.mode === "equal_water" ? job.volume_m3 / (flow * SECONDS_PER_HOUR) : shareH;
      const endMs = Math.min(startMs + durationH * SECONDS_PER_HOUR * MS_PER_SECOND, windowEndMs);
      if (!(endMs > startMs)) {
        // The window is over (or the equal-time share is degenerate): nothing can be scheduled here.
        unserved(job.farmer_id, job.volume_m3);
        continue;
      }
      // What the gate can actually pass while it is open (m³/s × s), and what the farmer is
      // scheduled to take. In `equal_hours` the time is the entitlement, so the full flow is
      // scheduled; in `equal_water` the volume is the entitlement, so a truncated turn delivers less
      // and the rest is shortfall.
      const capacityM3 = (flow * (endMs - startMs)) / MS_PER_SECOND;
      const plannedM3 = input.mode === "equal_water" ? Math.min(job.volume_m3, capacityM3) : capacityM3;
      if (!isPositive(plannedM3)) {
        unserved(job.farmer_id, job.volume_m3);
        continue;
      }
      if (job.volume_m3 > plannedM3) unserved(job.farmer_id, job.volume_m3 - plannedM3);

      turns.push({
        id: `${rosterId}:t${turns.length + 1}`,
        roster_id: rosterId,
        outlet_id: job.outlet_id,
        farmer_id: job.farmer_id,
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
        planned_volume_m3: round(plannedM3, 3),
        expected_flow_m3s: round(flow, 6),
        lag_h: round(job.lag_h, 4),
      });
      cursorMs = endMs;
    }

    // Only farmers with water they did not get appear in `shortfall_m3`; a zero entry would read as
    // "this farmer is short of nothing" in the UI and as a real shortfall to the auditor.
    const shortfall_m3: Record<string, number> = {};
    for (const farmer_id of Object.keys(unservedM3).sort()) {
      const remaining = round(unservedM3[farmer_id] ?? 0, 3);
      if (remaining > 0) shortfall_m3[farmer_id] = remaining;
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

  needMet(input: RosterInput, roster: Roster) {
    const scheduled = new Map<string, number>();
    for (const turn of roster.turns) {
      const k = key(turn.farmer_id, turn.outlet_id);
      scheduled.set(k, (scheduled.get(k) ?? 0) + turn.planned_volume_m3);
    }

    return input.demands
      .filter((demand) => isPositive(demand.volume_m3))
      .map((demand) => {
        const delivered = scheduled.get(key(demand.farmer_id, demand.outlet_id)) ?? 0;
        const pct = (100 * delivered) / demand.volume_m3;
        // Clamped: over-watering the head end is a real effect of `equal_hours`, and reporting 130%
        // as need met would make the two modes incomparable.
        const clamped = pct > 100 ? 100 : pct < 0 ? 0 : pct;
        return { farmer_id: demand.farmer_id, outlet_id: demand.outlet_id, pct: round(clamped, 2) };
      });
  },
};

/**
 * MEASURED on the demo fixture (`packages/contracts/fixtures/demo-scenario.json`: canal c1, outlets
 * o1–o8 at chainage 300…2900 m, window rw1 = 2026-09-15T00:30Z → 2026-09-16T00:30Z at 0.15 m³/s, one
 * 1300 m³ weekly entitlement per farmer f1…f8). 1300 m³/farmer is a deliberately tight canal: the
 * equal-water rotation needs 23.5 h of the 24 h window, so equal water meets every farmer's need in
 * full and the only way to lose water is to waste gate time.
 *
 *   velocity v  = (1/0.025)·0.35^(2/3)·√0.0004 = 0.39732 m/s
 *   Q_i         = 0.15·e^(−0.00012·x_i) → o1 0.144696, o4 0.126803, o7 0.110458, o8 0.105915 m³/s
 *   front lag   = x_i/v             → o1 0.210 h, o7 1.783 h, o8 2.027 h
 *   seepage to the tail            → 29.39% of the head discharge
 *
 *   mode          o1 (head)         o7              o8 (tail)
 *   equal_water   1300.000 m³ 100%  1300.000 m³ 100%  1300.000 m³ 100%   (rotation ends 00:10Z)
 *   equal_hours   1549.060 m³ 100%* 1182.521 m³ 91%  1133.884 m³ 87%        (*raw 119.2%, clamped)
 *
 * The inequality the demo needs is real — the tail loses under equal hours and is made whole under
 * equal water — but its size is bounded by arithmetic, not by a modelling choice. A farmer on equal
 * time takes `Q_i·t` for the same `t` as everyone, so with equal demands the tail's scheduled volume
 * can never fall below `Q_8/Q_1 = e^(−k·Δx) = 0.7323` of the head's, i.e. never below the seepage
 * loss itself. Two further bounds make a tail near 45% unreachable on this fixture at *any* window
 * length:
 *
 *   1. `RosterInput` carries no area, so "equal time" can only mean equal time per *turn* — the
 *      classic area-proportional warabandi allotment, which is what does starve a small tail plot to
 *      ~40% of need, is not expressible in this contract. Its time shares would need plot area per
 *      outlet (or a per-outlet time allotment on the `RosterEngine` input).
 *   2. Shortening the window does truncate tail turns, but it truncates equal water by the same
 *      amount, so the comparison stops being equal hours versus equal water.
 *
 * What would move the tail to ~45% is canal physics, not scheduling: the seepage of a longer or
 * drier reach (`k ≈ 3e-4` over 2.9 km gives `Q_8/Q_1 ≈ 0.46`). So the numbers above are the ones the
 * fixture actually produces, asserted as measured in `roster.test.ts`, rather than a constant tuned
 * to a slide.
 */
