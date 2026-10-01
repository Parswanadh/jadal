// View types for the coordinator console. Values come from the shared API client
// (src/api/client.ts), never from this file.

export interface MockPlot {
  id: string;
  outletId: string;
  areaHa: number;
  soil: string;
}

export interface MockCropPlan {
  id: string;
  plotId: string;
  crop: string;
  sowingDate: string;
}

export interface FarmerRegistration {
  farmer: { id: string; name: string; phone: string; hasSmartphone: boolean; channels: string[] };
  plots: MockPlot[];
  cropPlans: MockCropPlan[];
  verified: boolean;
}

export interface EntitlementRow {
  id: string;
  farmerId: string;
  farmerName: string;
  cropPlanId: string;
  crop: string;
  weekStart: string;
  volumeM3: number;
  netMm: number;
  status: "proposed" | "approved" | "edited";
}

export interface TurnRow {
  id: string;
  outletId: string;
  farmerId: string;
  farmerName: string;
  start: string;
  end: string;
  plannedVolumeM3: number;
  expectedFlowM3s: number;
  durationH: number;
  needMetPct: number;
}

export interface RosterProposal {
  id: string;
  mode: "equal_water" | "equal_hours";
  releaseWindowId: string;
  turns: TurnRow[];
  equalHoursGini: number;
  equalWaterGini: number;
}

export interface RequestRow {
  id: string;
  farmerId: string;
  farmerName: string;
  type: "urgent" | "buffer" | "release_to_buffer" | "harvest_exit";
  volumeM3: number;
  reason: string;
  reasonTe: string;
  channel: string;
  status: string;
  triageScore: number;
  recommendation: { decision: "approve" | "reject" | "partial"; volumeM3: number; rationale: string; rationaleTe: string };
  decision?: { decision: "approve" | "reject"; volumeM3: number; note?: string };
}

export interface LedgerFarmer {
  farmerId: string;
  name: string;
  quotaM3: number;
  deliveredM3: number;
  needMetPct: number;
}

export interface LedgerEntryRow {
  id: string;
  at: string;
  from: string;
  to: string;
  volumeM3: number;
  reason: string;
}

export interface LedgerView {
  canalSupplyM3: number;
  bufferM3: number;
  conveyanceLossesM3: number;
  farmers: LedgerFarmer[];
  conservationOk: boolean;
  gini: number;
  entries: LedgerEntryRow[];
}

export interface AuditView {
  findings: { severity: "info" | "warn" | "critical"; text: string }[];
  summaryEn: string;
  summaryTe: string;
}
