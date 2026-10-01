// C5 canal hero — view-model types.
//
// These mirror the contract shapes WITHOUT importing them, so apps/web stays
// decoupled until the backend (Task B) lands:
// - packages/contracts/src/entities.ts: Canal, Outlet
// - packages/contracts/src/core.ts: OutletHydraulics, RosterEngine.needMet,
//   Hydraulics.overrunImpact
// - packages/contracts/src/api.ts: routes.canal, routes.proposeRoster
//
// RULE: the UI never computes water numbers. Every displayed volume, flow and
// percentage arrives verbatim from the API (or from seed.json, which has the
// same shape). Visual pixel scaling of a supplied flow is display only.

export type RosterMode = "equal_hours" | "equal_water";

export interface CanalInfo {
  id: string;
  name: string;
  name_te: string;
  length_m: number;
  head_discharge_m3s: number;
}

export interface OutletInfo {
  id: string;
  canal_id: string;
  name: string;
  name_te: string;
  /** Distance from canal head, metres (contracts: Outlet.chainage_m). */
  chainage_m: number;
  farmer_id: string;
  farmer_name: string;
  farmer_name_te: string;
}

/** One row of hydraulics.atOutlets() output, served as data. */
export interface OutletFlow {
  outlet_id: string;
  chainage_m: number;
  flow_m3s: number;
  loss_fraction: number;
}

/** One row of proposeRoster.need_met. */
export interface NeedMetRow {
  farmer_id: string;
  outlet_id: string;
  farmer_name: string;
  farmer_name_te: string;
  pct: number;
}

export interface RosterComparison {
  equal_hours_gini: number;
  equal_water_gini: number;
}

/** One row of overrunImpact() output, served as data. */
export interface OverrunLoss {
  outlet_id: string;
  lost_m3: number;
}

/** A precomputed overrunImpact answer for one (outlet, hours) pair. */
export interface OverrunCase {
  total_lost_m3: number;
  /** [outlet_id, lost_m3] pairs, downstream of the overrunning outlet. */
  losses: [string, number][];
}

export interface CanalVisualData {
  canal: CanalInfo;
  outlets: OutletInfo[];
  flows: OutletFlow[];
  needMet: Record<RosterMode, NeedMetRow[]>;
  comparison: RosterComparison;
  /** Slider stops in hours. 0 = no overrun (no case data needed). */
  overrunSteps: number[];
  /** overrunImpact answers keyed by outlet id, then by hours as string. */
  overrun: Record<string, Record<string, OverrunCase>>;
}
