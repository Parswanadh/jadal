// Signatures of the deterministic core (packages/core). Types only — implementations live in packages/core.
// The backend and the agents call ONLY these functions for any water number. No LLM inside the core.

import type {
  Canal,
  Outlet,
  CropParams,
  CropPlan,
  Plot,
  WeatherDay,
  Entitlement,
  ReleaseWindow,
  Roster,
  LedgerEntry,
} from "./entities";
import type { JadalEvent } from "./events";

export interface WeeklyNeed {
  crop_plan_id: string;
  week_start: string;
  etc_mm: number;
  effective_rain_mm: number;
  net_irrigation_mm: number;
  gross_irrigation_mm: number;
  volume_m3: number;
  /** Root-zone bounds for one irrigation event (upland crops): trigger at Dr ≥ RAW, refill RAW, never exceed TAW. */
  bounds: { raw_mm: number; taw_mm: number; event_refill_m3: number; event_cap_m3: number } | null;
  stage: "ini" | "dev" | "mid" | "late" | "done";
  kc: number;
}

export interface CropEngine {
  /** Kc for a given day after sowing (FAO-56 piecewise-linear curve). */
  kcOnDay(params: CropParams, daysAfterSowing: number): { kc: number; stage: WeeklyNeed["stage"] };
  /** Weekly need at the field gate for one crop plan. */
  weeklyNeed(input: {
    plan: CropPlan;
    plot: Plot;
    params: CropParams;
    weather: WeatherDay[]; // 7 days
    weekStart: string;
  }): WeeklyNeed;
  /** Season total, used for the season-start suggestion. */
  seasonNeed(input: { plan: CropPlan; plot: Plot; params: CropParams; weather: WeatherDay[] }): {
    weeks: WeeklyNeed[];
    total_m3: number;
  };
}

export interface OutletHydraulics {
  outlet_id: string;
  chainage_m: number;
  /** Flow reaching the outlet with nobody upstream drawing. */
  flow_m3s: number;
  /** Travel time from head to this outlet. */
  lag_h: number;
  /** Fraction of head discharge lost to seepage before this outlet. */
  loss_fraction: number;
}

export interface Hydraulics {
  velocity_ms(canal: Canal): number; // Manning: v = (1/n)·R^(2/3)·S^(1/2)
  atOutlets(canal: Canal, outlets: Outlet[], headDischarge_m3s: number): OutletHydraulics[];
  /** Water lost by everyone downstream when an outlet overruns its turn by overrun_h. */
  overrunImpact(input: {
    canal: Canal;
    outlets: Outlet[];
    overrunOutletId: string;
    overrun_h: number;
    headDischarge_m3s: number;
  }): { outlet_id: string; lost_m3: number }[];
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

export interface Balances {
  canal_supply: number;
  buffer: number;
  conveyance_losses: number;
  farmers: Record<string, { quota: number; delivered: number }>;
}

export interface Ledger {
  /** Pure: turns events into double entries. */
  entriesFor(event: JadalEvent): LedgerEntry[];
  balances(entries: LedgerEntry[]): Balances;
  /** season supply = Σ quota + buffer + Σ delivered + conveyance losses (within tolerance_m3). */
  checkConservation(entries: LedgerEntry[], seasonSupply_m3: number, tolerance_m3?: number): { ok: boolean; diff_m3: number };
  /** Gini coefficient of % need met across farmers (0 = perfectly equal). */
  gini(values: number[]): number;
}

export interface Policy {
  /** Urgent request: approved volume is moved from the farmer's future quota. Rejects if quota is insufficient. */
  canGrantUrgent(balances: Balances, farmerId: string, volume_m3: number): { ok: boolean; reason: string };
  /** Buffer request: capped per farmer per week (default 25% of their weekly entitlement, ASSUMED project rule). */
  canGrantBuffer(
    balances: Balances,
    farmerId: string,
    volume_m3: number,
    weeklyEntitlement_m3: number,
    alreadyGrantedThisWeek_m3: number,
  ): { ok: boolean; max_m3: number; reason: string };
}

export type { Entitlement };
