import type { Canal, Outlet, OutletHydraulics, Hydraulics } from "@jadal/contracts";

export class CanalHydraulics implements Hydraulics {
  /**
   * Manning velocity: v = (1/n) · R^(2/3) · S^(1/2)
   *
   * @param canal Canal properties containing Manning n, hydraulic radius R, and bed slope S
   * @returns Mean velocity in m/s
   */
  velocity_ms(canal: Canal): number {
    if (canal.manning_n <= 0 || canal.hydraulic_radius_m <= 0 || canal.bed_slope <= 0) {
      throw new RangeError("Manning n, hydraulic radius, and bed slope must be positive");
    }
    const v = (1 / canal.manning_n) * Math.pow(canal.hydraulic_radius_m, 2 / 3) * Math.sqrt(canal.bed_slope);
    return v;
  }

  /**
   * Computes flow, lag, and loss fraction reaching each outlet assuming steady flow with no upstream withdrawal.
   * Q(x) = Q0 · e^(−k · x)
   * lag = x / (v · 3600) hours
   * loss_fraction = 1 - e^(−k · x)
   *
   * @param canal Canal properties
   * @param outlets List of outlets along the canal
   * @param headDischarge_m3s Discharge at canal head (Q0)
   * @returns Hydraulic parameters at each outlet
   */
  atOutlets(canal: Canal, outlets: Outlet[], headDischarge_m3s: number): OutletHydraulics[] {
    const v = this.velocity_ms(canal);
    const k = canal.seepage_k_per_m;

    return outlets.map((outlet) => {
      const x = outlet.chainage_m;
      const decay = Math.exp(-k * x);
      const flow = headDischarge_m3s * decay;
      const lagHours = x > 0 && v > 0 ? x / (v * 3600) : 0;
      const lossFraction = 1 - decay;

      return {
        outlet_id: outlet.id,
        chainage_m: x,
        flow_m3s: flow,
        lag_h: lagHours,
        loss_fraction: lossFraction,
      };
    });
  }

  /**
   * Calculates the water lost by each downstream outlet when an upstream outlet overruns its turn.
   * A downstream outlet loses flow_at_outlet · overrun_duration.
   *
   * @param input Canal, outlets, overrunOutletId, overrun_h, headDischarge_m3s
   * @returns Array of { outlet_id, lost_m3 } for each downstream outlet
   */
  overrunImpact(input: {
    canal: Canal;
    outlets: Outlet[];
    overrunOutletId: string;
    overrun_h: number;
    headDischarge_m3s: number;
  }): { outlet_id: string; lost_m3: number }[] {
    const { canal, outlets, overrunOutletId, overrun_h, headDischarge_m3s } = input;
    if (overrun_h <= 0) {
      return [];
    }

    const overrunOutlet = outlets.find((o) => o.id === overrunOutletId);
    if (!overrunOutlet) {
      throw new Error(`Overrun outlet ID ${overrunOutletId} not found in outlets`);
    }

    const outletHydraulics = this.atOutlets(canal, outlets, headDischarge_m3s);
    const outletHydraulicsMap = new Map(outletHydraulics.map((h) => [h.outlet_id, h]));

    // Downstream outlets have chainage strictly greater than the overrun outlet
    const downstreamOutlets = outlets.filter((o) => o.chainage_m > overrunOutlet.chainage_m);

    const overrunSeconds = overrun_h * 3600;

    return downstreamOutlets.map((outlet) => {
      const hyd = outletHydraulicsMap.get(outlet.id);
      const flow = hyd ? hyd.flow_m3s : 0;
      const lostVolumeM3 = flow * overrunSeconds;

      return {
        outlet_id: outlet.id,
        lost_m3: lostVolumeM3,
      };
    });
  }
}

export const hydraulics = new CanalHydraulics();
