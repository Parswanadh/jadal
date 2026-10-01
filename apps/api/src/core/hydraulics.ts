/**
 * Canal hydraulics: Manning velocity, exponential seepage along an unlined canal, travel lag, and
 * the cost of an overrun to everyone downstream. Implements `Hydraulics` from
 * `@jadal/contracts/core`.
 *
 * Physics, as specified in `docs/architecture/overview.md` §4.2:
 *
 *   1. **Velocity** — Manning-Strickler for uniform open-channel flow,
 *      `v = (1/n) · R^(2/3) · S^(1/2)`  with `n` the Manning roughness, `R` the hydraulic radius
 *      (both carried on `Canal`), `S` the bed slope.
 *   2. **Flow at an outlet** — seepage removes water continuously along the reach, so discharge
 *      decays exponentially with distance from the head:
 *      `Q(x) = (Q₀ − Σ upstream draw) · e^(−k·x)`, `k = seepage_k_per_m`.
 *      The fraction of head discharge lost before chainage `x` is `1 − e^(−k·x)`.
 *   3. **Travel lag** — the wetting front advances at `v`, so water reaches chainage `x` after
 *      `x / v` seconds, i.e. `lag_h = (x / v) / 3600` hours.
 *   4. **Overrun impact** — in warabandi the canal runs head-to-tail, so a head outlet that keeps its
 *      gate open past its turn does not waste water into the canal: it keeps the tail gates shut.
 *      Every outlet *downstream* of the overrunner is denied the `Q_i · Δt` it would otherwise have
 *      received during the overrun. Outlets upstream have already had their turn and lose nothing.
 *
 * All functions are pure and total: every documented input, including a zero or negative head
 * discharge, returns finite numbers.
 */

import type { Hydraulics, OutletHydraulics } from "@jadal/contracts";
import type { Outlet } from "@jadal/contracts";

import { secondsToHours } from "./units";

/** Outlets at equal chainage are ordered by id, so the result never depends on input array order. */
function byChainage(outlets: readonly Outlet[]): Outlet[] {
  return [...outlets].sort((a, b) => {
    const byX = a.chainage_m - b.chainage_m;
    if (byX !== 0) return byX;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Physical discharge reaching a reach: never negative, even if a caller over-draws upstream. */
function reachDischarge(head: number, upstreamDraw: number): number {
  return Math.max(0, head - upstreamDraw);
}

export const hydraulics: Hydraulics = {
  /**
   * Manning-Strickler uniform-flow velocity, m s⁻¹. `Canal` carries `manning_n`,
   * `hydraulic_radius_m` and `bed_slope`, all schema-validated positive, so no guard is needed
   * beyond the documented Manning validity band.
   *
   * ASSUMED: Manning's equation is stated for `R` and `S` in a range where it is well behaved
   * (`1/n` with `n` a real roughness). The contract validates `hydraulic_radius_m > 0` and
   * `bed_slope > 0` but nothing about their magnitude; a vanishing `R` or `S` yields `v → 0`, which
   * would make `lag_h` infinite. Callers in this codebase always read a validated `Canal` row, so
   * we return the formula as written and let `lag_h` be `Infinity` rather than silently invent a
   * minimum velocity.
   */
  velocity_ms(canal) {
    const v = (1 / canal.manning_n) * canal.hydraulic_radius_m ** (2 / 3) * canal.bed_slope ** 0.5;
    return Number.isFinite(v) ? v : 0;
  },

  /**
   * Flow, lag and seepage loss at every outlet, head to tail.
   *
   * The three-argument form is the contract's "nobody upstream drawing" base case. The optional
   * fourth argument threads the draws the roster engine has already committed above each outlet
   * (keyed by outlet id, m³ s⁻¹): the loop accumulates them in head-to-tail order, so outlet *i* is
   * evaluated against the sum of every draw at a chainage strictly upstream of it. Optional
   * parameters do not change assignability, so this still satisfies the `Hydraulics` interface.
   *
   * `loss_fraction` is the *cumulative* seepage fraction at that chainage, not a per-reach rate, so
   * it is monotonically increasing down the canal and is 0 at chainage 0 by construction
   * (`1 − e^0 = 0`).
   */
  atOutlets(canal, outlets, headDischarge_m3s, upstreamDraw_m3s?: Record<string, number>): OutletHydraulics[] {
    const head = Number.isFinite(headDischarge_m3s) ? Math.max(0, headDischarge_m3s) : 0;
    const velocity = hydraulics.velocity_ms(canal);
    const k = canal.seepage_k_per_m;
    const ordered = byChainage(outlets);
    let upstreamDraw = 0;
    const out: OutletHydraulics[] = [];
    for (const outlet of ordered) {
      const x = Number.isFinite(outlet.chainage_m) ? Math.max(0, outlet.chainage_m) : 0;
      const decay = Math.exp(-k * x);
      const flow = reachDischarge(head, upstreamDraw) * decay;
      const lagSeconds = velocity > 0 ? x / velocity : Number.POSITIVE_INFINITY;
      out.push({
        outlet_id: outlet.id,
        chainage_m: x,
        flow_m3s: flow,
        lag_h: Number.isFinite(lagSeconds) ? secondsToHours(lagSeconds) : Number.POSITIVE_INFINITY,
        loss_fraction: 1 - decay,
      });
      const draw = upstreamDraw_m3s?.[outlet.id] ?? 0;
      upstreamDraw += Number.isFinite(draw) ? Math.max(0, draw) : 0;
    }
    return out;
  },

  /**
   * Volume lost by every outlet downstream of an overrun.
   *
   * When outlet *o* overruns by `overrun_h`, the canal below *o* is shut off for that period, so each
   * downstream outlet loses exactly what it would have drawn: `Q_i · overrun_h · 3600` m³. The
   * overrunning outlet itself loses nothing — it has, by definition, taken more than its turn, not
   * less — and neither does anything upstream, which has already been served.
   *
   * `Q_i` is the flow with nobody upstream drawing (`atOutlets` base case): the roster does not know
   * how much of the overrun actually passed the head gates, and assuming the full contracted
   * discharge keeps the impact estimate an upper bound on the harm.
   *
   * An unknown `overrunOutletId` yields `[]`. The contract has no error channel, and an empty
   * impact list is the safe answer for a scheduler (it will not schedule protective time for a
   * phantom outlet).
   */
  overrunImpact(input): { outlet_id: string; lost_m3: number }[] {
    const { canal, outlets, overrunOutletId, overrun_h, headDischarge_m3s } = input;
    const ordered = byChainage(outlets);
    const index = ordered.findIndex((o) => o.id === overrunOutletId);
    if (index < 0) return [];
    const seconds = (Number.isFinite(overrun_h) ? Math.max(0, overrun_h) : 0) * 3600;
    if (seconds === 0) return [];
    const hydraulicsAt = hydraulics.atOutlets(canal, ordered, headDischarge_m3s);
    const impact: { outlet_id: string; lost_m3: number }[] = [];
    for (let i = index + 1; i < ordered.length; i += 1) {
      const outlet = ordered[i];
      const at = hydraulicsAt[i];
      if (!outlet || !at) continue;
      impact.push({ outlet_id: outlet.id, lost_m3: round4(at.flow_m3s * seconds) });
    }
    return impact;
  },
};

function round4(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10_000) / 10_000;
}