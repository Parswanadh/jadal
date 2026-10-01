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

export const hydraulics = {
  /**
   * Manning velocity: v = (1/n) · R^(2/3) · S^(1/2)
   */
  velocity_ms(canal: Canal): number {
    return (1 / canal.manning_n) * Math.pow(canal.hydraulic_radius_m, 2 / 3) * Math.sqrt(canal.bed_slope);
  },

  /**
   * Expected flow, travel time lag, and seepage loss fraction at each outlet.
   * Q(x) = Q0 · e^(-k · x)
   * lag_h = x / v / 3600
   * loss_fraction = 1 - e^(-k · x)
   */
  atOutlets(canal: Canal, outlets: Outlet[], headDischarge_m3s: number): OutletHydraulics[] {
    const v = this.velocity_ms(canal);
    return outlets.map(outlet => {
      const x = outlet.chainage_m;
      const flow_m3s = headDischarge_m3s * Math.exp(-canal.seepage_k_per_m * x);
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
   * Each downstream outlet loses Q_outlet · overrun_h · 3600 m³.
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

    const safeOverrunHours = Math.max(0, input.overrun_h);

    return downstreamOutlets.map(outlet => {
      const flow_m3s = input.headDischarge_m3s * Math.exp(-input.canal.seepage_k_per_m * outlet.chainage_m);
      const lost_m3 = flow_m3s * safeOverrunHours * 3600;
      return {
        outlet_id: outlet.id,
        lost_m3,
      };
    });
  },
} satisfies Hydraulics;
