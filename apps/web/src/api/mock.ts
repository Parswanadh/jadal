import type {
  Canal,
  CropPlan,
  Farmer,
  Outlet,
  Plot,
  ReleaseWindow,
  WaterRequest,
} from "@jadal/contracts";
import scenarioJson from "@jadal/contracts/fixtures/demo-scenario.json";

/**
 * Fixture-backed mock for the farmer portal.
 *
 * Directory facts (farmers, plots, crop plans, outlets, release windows)
 * come straight from packages/contracts/fixtures/demo-scenario.json.
 * Weekly entitlements, turn times, delivered volumes and the request list
 * below are illustrative stand-ins until apps/api serves them
 * (contracts v1 has no GET route for entitlements or the current roster).
 * Every stand-in is marked // ASSUMED and is replaced by API numbers
 * without touching any UI component.
 */

export type DemoScenario = {
  now: string;
  canal: Canal;
  outlets: Outlet[];
  farmers: Farmer[];
  plots: Plot[];
  crop_plans: CropPlan[];
  release_windows: ReleaseWindow[];
  season_supply_m3: number;
};

export const scenario = scenarioJson as unknown as DemoScenario;

export type WeeklyEntitlementMock = {
  farmer_id: string;
  week_start: string;
  volume_m3: number;
  net_irrigation_mm: number;
};

export type TurnMock = {
  id: string;
  farmer_id: string;
  outlet_id: string;
  start: string;
  end: string;
  planned_volume_m3: number;
  expected_flow_m3s: number;
  lag_h: number;
};

export type DeliveredMock = {
  farmer_id: string;
  quota_m3: number;
  delivered_m3: number;
  need_met_pct: number;
};

// ASSUMED illustrative weekly entitlements for the week of 2026-09-14.
// Tail-end farmers (f7, f8) show lower volumes only because the mock says
// so; the real numbers come from the crop-need engine via the coordinator.
export const weeklyEntitlements: WeeklyEntitlementMock[] = [
  { farmer_id: "f1", week_start: "2026-09-14", volume_m3: 1500, net_irrigation_mm: 60 },
  { farmer_id: "f2", week_start: "2026-09-14", volume_m3: 900, net_irrigation_mm: 60 },
  { farmer_id: "f3", week_start: "2026-09-14", volume_m3: 1200, net_irrigation_mm: 32 },
  { farmer_id: "f4", week_start: "2026-09-14", volume_m3: 700, net_irrigation_mm: 37 },
  { farmer_id: "f5", week_start: "2026-09-14", volume_m3: 260, net_irrigation_mm: 35 },
  { farmer_id: "f6", week_start: "2026-09-14", volume_m3: 1100, net_irrigation_mm: 35 },
  { farmer_id: "f7", week_start: "2026-09-14", volume_m3: 750, net_irrigation_mm: 60 },
  { farmer_id: "f8", week_start: "2026-09-14", volume_m3: 280, net_irrigation_mm: 28 },
];

// ASSUMED illustrative turn schedule for release window rw1
// (2026-09-15T00:30:00Z to 2026-09-16T00:30:00Z), head to tail.
export const turnsRw1: TurnMock[] = [
  { id: "t1", farmer_id: "f1", outlet_id: "o1", start: "2026-09-15T00:30:00Z", end: "2026-09-15T03:10:00Z", planned_volume_m3: 1500, expected_flow_m3s: 0.144, lag_h: 0.2 },
  { id: "t2", farmer_id: "f2", outlet_id: "o2", start: "2026-09-15T03:20:00Z", end: "2026-09-15T05:50:00Z", planned_volume_m3: 900, expected_flow_m3s: 0.139, lag_h: 0.4 },
  { id: "t3", farmer_id: "f3", outlet_id: "o3", start: "2026-09-15T06:00:00Z", end: "2026-09-15T08:40:00Z", planned_volume_m3: 1200, expected_flow_m3s: 0.133, lag_h: 0.7 },
  { id: "t4", farmer_id: "f4", outlet_id: "o4", start: "2026-09-15T08:50:00Z", end: "2026-09-15T11:10:00Z", planned_volume_m3: 700, expected_flow_m3s: 0.127, lag_h: 0.9 },
  { id: "t5", farmer_id: "f5", outlet_id: "o5", start: "2026-09-15T11:20:00Z", end: "2026-09-15T13:10:00Z", planned_volume_m3: 260, expected_flow_m3s: 0.121, lag_h: 1.2 },
  { id: "t6", farmer_id: "f6", outlet_id: "o6", start: "2026-09-15T13:20:00Z", end: "2026-09-15T16:10:00Z", planned_volume_m3: 1100, expected_flow_m3s: 0.115, lag_h: 1.5 },
  { id: "t7", farmer_id: "f7", outlet_id: "o7", start: "2026-09-15T16:20:00Z", end: "2026-09-15T18:30:00Z", planned_volume_m3: 750, expected_flow_m3s: 0.11, lag_h: 1.8 },
  { id: "t8", farmer_id: "f8", outlet_id: "o8", start: "2026-09-15T18:40:00Z", end: "2026-09-15T20:30:00Z", planned_volume_m3: 280, expected_flow_m3s: 0.106, lag_h: 2.1 },
];

// ASSUMED illustrative season balances. f7/f8 show low need-met to mirror
// the demo script (tail-end shortfall); the ledger API replaces these.
export const delivered: DeliveredMock[] = [
  { farmer_id: "f1", quota_m3: 12000, delivered_m3: 8200, need_met_pct: 92 },
  { farmer_id: "f2", quota_m3: 7200, delivered_m3: 4300, need_met_pct: 88 },
  { farmer_id: "f3", quota_m3: 9000, delivered_m3: 3900, need_met_pct: 71 },
  { farmer_id: "f4", quota_m3: 5600, delivered_m3: 3100, need_met_pct: 80 },
  { farmer_id: "f5", quota_m3: 2100, delivered_m3: 1500, need_met_pct: 95 },
  { farmer_id: "f6", quota_m3: 8800, delivered_m3: 4200, need_met_pct: 68 },
  { farmer_id: "f7", quota_m3: 6000, delivered_m3: 2600, need_met_pct: 55 },
  { farmer_id: "f8", quota_m3: 2300, delivered_m3: 900, need_met_pct: 48 },
];

// ASSUMED illustrative request history (urgent + buffer) with decisions,
// so the buffer board and request flow are demonstrable offline.
export const initialRequests: WaterRequest[] = [
  {
    id: "r1",
    farmer_id: "f7",
    crop_plan_id: "cp7",
    type: "buffer",
    volume_m3: 400,
    reason: "Rice flowering, last turn arrived short",
    channel: "portal",
    status: "approved",
    raised_at: "2026-09-13T05:10:00Z",
    triage_score: 0.82,
    agent_recommendation: { decision: "approve", volume_m3: 400, rationale: "Flowering stage, quota headroom in buffer" },
    coordinator_decision: { decision: "approve", volume_m3: 400, note: "From common buffer", at: "2026-09-13T09:00:00Z" },
  },
  {
    id: "r2",
    farmer_id: "f8",
    crop_plan_id: "cp8",
    type: "buffer",
    volume_m3: 300,
    reason: "Greengram pod filling, hot spell",
    channel: "voice",
    status: "raised",
    raised_at: "2026-09-14T04:20:00Z",
    triage_score: 0.74,
  },
  {
    id: "r3",
    farmer_id: "f3",
    crop_plan_id: "cp3",
    type: "buffer",
    volume_m3: 500,
    reason: "Cotton square formation",
    channel: "portal",
    status: "rejected",
    raised_at: "2026-09-12T06:40:00Z",
    triage_score: 0.41,
    agent_recommendation: { decision: "reject", volume_m3: 0, rationale: "Soil moisture adequate after rain on 2026-09-09" },
    coordinator_decision: { decision: "reject", volume_m3: 0, note: "Rain covered this need", at: "2026-09-12T10:15:00Z" },
  },
  {
    id: "r4",
    farmer_id: "f1",
    crop_plan_id: "cp1",
    type: "urgent",
    volume_m3: 600,
    reason: "Rice flowering, needs water today",
    channel: "voice",
    status: "approved",
    raised_at: "2026-09-13T03:05:00Z",
    triage_score: 0.9,
    agent_recommendation: { decision: "approve", volume_m3: 500, rationale: "Critical stage; partial grant protects quota" },
    coordinator_decision: { decision: "approve", volume_m3: 500, note: "Deducted from future quota", at: "2026-09-13T07:30:00Z" },
  },
  {
    id: "r5",
    farmer_id: "f6",
    crop_plan_id: "cp6",
    type: "urgent",
    volume_m3: 500,
    reason: "Maize tasseling",
    channel: "whatsapp",
    status: "raised",
    raised_at: "2026-09-14T05:45:00Z",
    triage_score: 0.68,
  },
];
