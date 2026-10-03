export interface Canal {
  id: string;
  name: string;
  length_m: number;
  head_discharge_m3s: number;
  seepage_k_per_m: number;
  manning_n: number;
  bed_slope: number;
  hydraulic_radius_m: number;
  lined: boolean;
}

export interface Outlet {
  id: string;
  canal_id: string;
  name: string;
  chainage_m: number;
}

export interface OutletHydraulics {
  outlet_id: string;
  chainage_m: number;
  flow_m3s: number;
  lag_h: number;
  loss_fraction: number;
}

export interface Hydraulics {
  velocity_ms(canal: Canal): number;
  atOutlets(canal: Canal, outlets: Outlet[], headDischarge_m3s: number): OutletHydraulics[];
  overrunImpact(input: {
    canal: Canal;
    outlets: Outlet[];
    overrunOutletId: string;
    overrun_h: number;
    headDischarge_m3s: number;
  }): { outlet_id: string; lost_m3: number }[];
}

/**
 * Manning's equation for mean velocity in an open channel.
 *
 *   v = (1/n) . R^(2/3) . S^(1/2)                                   [m/s]
 *
 * SOURCE (MEASURED): Manning's open-channel formula, as specified for Jadal in
 * `docs/research/cloudflare-cicd.md` §"Mathematical Feasibility in TypeScript" item 1 and
 * `docs/research/deterministic-and-system1.md` §"Travel Lag". Both give the same closed form.
 *
 * Units: n dimensionless (s/m^(1/3) in SI form), R in m, S dimensionless (m/m rise over run),
 * relation is dimensionally consistent with SI Manning: m = (s/m^(1/3)) . m^(2/3) . 1 -> m/s.
 *
 * Domain of validity and boundaries:
 *  * `bed_slope = 0` gives v = 0 exactly: a level canal does not flow. Downstream code must
 *    handle v = 0 (see `atOutlets`, which returns lag 0 rather than Infinity).
 *  * `bed_slope < 0` has no physical meaning for Manning (sqrt of a negative). Returns 0 rather
 *    than NaN — an adverse slope carries no water in this model. ASSUMED boundary choice.
 *  * `manning_n <= 0` would divide by zero. Returns 0 rather than Infinity/NaN. ASSUMED.
 *  * `hydraulic_radius_m < 0` is unphysical; returns 0. `R = 0` legitimately gives v = 0.
 *  * Non-finite inputs (NaN/Infinity) return 0.
 *
 * These guards exist because the DB CHECKs (`apps/api/src/db/schema.sql.ts:66-68`) constrain
 * `manning_n > 0` and `seepage_k_per_m >= 0` but do NOT constrain `bed_slope`, so a zero or
 * negative slope can reach this function from stored data. Returning NaN would then propagate
 * silently into lag times and roster start times.
 */
export function manningVelocity(
  manning_n: number,
  hydraulic_radius_m: number,
  bed_slope: number,
): number {
  if (!Number.isFinite(manning_n) || !Number.isFinite(hydraulic_radius_m) || !Number.isFinite(bed_slope)) {
    return 0;
  }
  if (manning_n <= 0 || hydraulic_radius_m < 0 || bed_slope <= 0) {
    return 0;
  }
  return (1 / manning_n) * hydraulic_radius_m ** (2 / 3) * Math.sqrt(bed_slope);
}

export const hydraulics = {
  /**
   * Manning velocity: v = (1/n) . R^(2/3) . S^(1/2). See {@link manningVelocity} for the
   * units, domain of validity and boundary behaviour.
   */
  velocity_ms(canal: Canal): number {
    return manningVelocity(canal.manning_n, canal.hydraulic_radius_m, canal.bed_slope);
  },

  /**
   * Expected flow, travel time lag, and seepage loss fraction at each outlet.
   *
   *   Q(x)           = Q0 . e^(-k.x)          [m3/s]   exponential seepage decay
   *   lag_h          = x / (v . 3600)         [h]      travel time of the wetting front
   *   loss_fraction  = 1 - e^(-k.x)           [-]      fraction of head discharge lost by x
   *
   * SOURCE: `docs/architecture/overview.md` line 87 states the model as
   * `Q_i = (Q0 - sum upstream draw) . e^(-k.x_i)` with travel lag `x_i / v` from Manning's v.
   * The exponential decay is an ASSUMED empirical form: the two research documents that specify
   * Jadal's seepage (`cloudflare-cicd.md` line 184, `deterministic-and-system1.md` line 253) both
   * name the **Moritz** formula `S = C.sqrt(Q).L` (a linear loss, not exponential). The
   * exponential is what the architecture document adopts and what the worked values in
   * `docs/architecture/architecture.html:2588` were computed from, so it is kept — but the
   * divergence from the cited Moritz form is an open finding (see `docs/research/model-audit.md`
   * F-02). `k` [1/m] is ASSUMED: the demo scenario uses 0.00012 /m
   * (`packages/contracts/fixtures/demo-scenario.json`), which is a project calibration, not a
   * measured canal property.
   *
   * Units: k [1/m] . x [m] is dimensionless, so the exponent is dimensionless; Q0 and Q in m3/s;
   * v in m/s; x in m; the 3600 converts s to h.
   *
   * Boundaries:
   *  * `x = 0` (head outlet): Q = Q0, lag = 0, loss = 0. Correct by construction.
   *  * `x < 0`: `e^(+k|x|) > 1`, i.e. flow would GROW. This is unphysical. Chainage is not
   *    constrained non-negative by the contract, so callers must not pass negative chainage;
   *    behaviour is reported here rather than silently clamped, so that a bad dataset is visible.
   *  * `v = 0` (zero slope, zero radius, or non-positive n): `lag_h` is 0, not Infinity — see the
   *    comment in the body.
   *  * `k = 0` (a perfectly lined canal): Q is constant and `loss_fraction` is 0.
   *  * Empty `outlets`: returns [].
   */
  atOutlets(canal: Canal, outlets: Outlet[], headDischarge_m3s: number): OutletHydraulics[] {
    const v = this.velocity_ms(canal);
    return outlets.map(outlet => {
      const x = outlet.chainage_m;
      const flow_m3s = headDischarge_m3s * Math.exp(-canal.seepage_k_per_m * x);
      // v = 0 means no travel; report 0 lag rather than dividing by zero. A negative x is also
      // reported as 0 lag because travel time is undefined upstream of the head.
      const lag_h = v > 0 && x > 0 ? x / (v * 3600) : 0;
      const loss_fraction = 1 - Math.exp(-canal.seepage_k_per_m * x);

      return {
        outlet_id: outlet.id,
        chainage_m: x,
        flow_m3s,
        lag_h,
        loss_fraction,
      };
    });
  },

  /**
   * Water lost by each downstream outlet when an upstream outlet overruns its turn by overrun_h.
   *
   *   lost_m3 = Q(x_outlet) . overrun_h . 3600                [m3]
   *
   * SOURCE: `docs/architecture/overview.md` line 87 supplies `Q_i`; the loss accounting itself is
   * a project rule (README §7, "Downstream Overrun Impact"). It is the volume physically diverted
   * away from each downstream outlet for the duration of the overrun.
   *
   * Units: Q in m3/s . h . 3600 s/h -> m3. The 3600 is a unit conversion, not a fitted constant.
   *
   * Boundaries:
   *  * Unknown `overrunOutletId`: returns []. ASSUMED — an unknown id yields no impact rather
   *    than throwing, so a stale turn reference cannot crash a roster run.
   *  * `overrun_h <= 0`: clamped to 0, so every downstream loss is 0. A negative overrun is not
   *    a credit to downstream farmers in this model. ASSUMED.
   *  * An outlet at exactly the overrunning outlet's chainage is NOT "downstream" (strict `>`),
   *    so it is not charged. Two outlets at the same chainage therefore do not affect each other.
   *  * The overrunning outlet itself never appears in the result.
   *
   * NOTE: the losses are deducted IN SEQUENCE (head to tail). The overrun diverts
   * `Q(x_overrun) . overrun_h . 3600` — that volume is all the water the canal carries past the
   * overrunning outlet during the overrun, so it is the total that can be lost downstream. Each
   * downstream outlet's loss is capped by the remaining budget, so the sum can never exceed what
   * the canal actually carries. See `docs/research/model-audit.md` F-03.
   */
  overrunImpact(input: {
    canal: Canal;
    outlets: Outlet[];
    overrunOutletId: string;
    overrun_h: number;
    headDischarge_m3s: number;
  }): { outlet_id: string; lost_m3: number }[] {
    const overrunOutlet = input.outlets.find(o => o.id === input.overrunOutletId);
    if (!overrunOutlet) {
      return [];
    }

    const downstreamOutlets = input.outlets
      .filter(o => o.chainage_m > overrunOutlet.chainage_m)
      .sort((a, b) => a.chainage_m - b.chainage_m);

    const safeOverrunHours = Number.isFinite(input.overrun_h) ? Math.max(0, input.overrun_h) : 0;

    // The overrun diverts Q(x_overrun) for overrun_h hours; that volume is the total water the
    // canal carries past the overrunning outlet during the overrun, and therefore the maximum
    // that can be lost downstream. Deduct it in sequence (head to tail) so the per-outlet losses
    // sum to at most this figure rather than each being computed independently from head discharge.
    const overrunFlow = input.headDischarge_m3s * Math.exp(-input.canal.seepage_k_per_m * overrunOutlet.chainage_m);
    let remaining = overrunFlow * safeOverrunHours * 3600;

    return downstreamOutlets.map(outlet => {
      const flow_m3s = input.headDischarge_m3s * Math.exp(-input.canal.seepage_k_per_m * outlet.chainage_m);
      const lost_m3 = Math.min(flow_m3s * safeOverrunHours * 3600, remaining);
      remaining -= lost_m3;
      return {
        outlet_id: outlet.id,
        lost_m3,
      };
    });
  },
} satisfies Hydraulics;
