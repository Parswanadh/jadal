// Coordinator console view of the shared typed API client (src/api/client.ts).
// The shared client serves contract-validated mock data when VITE_MOCK is not "0"
// and calls the live /api routes otherwise. This module only reshapes the
// responses into the console's view types; it computes no water numbers, so
// every figure displayed comes from the API (or its mock).

import { api as client, isMockMode } from "../api";
import type {
  EntitlementRow,
  FarmerRegistration,
  LedgerView,
  RequestRow,
  RosterProposal,
} from "./types";

export type Source = "live" | "mock";

function source(): Source {
  return isMockMode() ? "mock" : "live";
}

async function farmerNames(): Promise<Map<string, string>> {
  const list = await client.listFarmers();
  return new Map(list.map((r) => [r.farmer.id, r.farmer.name]));
}

async function cropByPlan(): Promise<Map<string, string>> {
  const list = await client.listFarmers();
  return new Map(list.flatMap((r) => r.crop_plans.map((c) => [c.id, c.crop] as const)));
}

export const api = {
  async listFarmers(): Promise<{ rows: FarmerRegistration[]; source: Source }> {
    const list = await client.listFarmers();
    const rows: FarmerRegistration[] = list.map((r) => ({
      farmer: {
        id: r.farmer.id,
        name: r.farmer.name,
        phone: r.farmer.phone,
        hasSmartphone: r.farmer.has_smartphone,
        channels: r.farmer.preferred_channels,
      },
      plots: r.plots.map((p) => ({ id: p.id, outletId: p.outlet_id, areaHa: p.area_ha, soil: p.soil })),
      cropPlans: r.crop_plans.map((c) => ({ id: c.id, plotId: c.plot_id, crop: c.crop, sowingDate: c.sowing_date })),
      verified: r.verified,
    }));
    return { rows, source: source() };
  },

  async verifyFarmer(id: string): Promise<{ ok: boolean; source: Source }> {
    const res = await client.verifyFarmer(id);
    return { ok: res.ok, source: source() };
  },

  async suggestEntitlements(): Promise<{ rows: EntitlementRow[]; seasonTotalM3: number; explanationEn: string; explanationTe: string; source: Source }> {
    const [data, names, crops] = await Promise.all([client.suggestEntitlements(), farmerNames(), cropByPlan()]);
    const rows: EntitlementRow[] = data.entitlements.map((e) => ({
      id: e.id,
      farmerId: e.farmer_id,
      farmerName: names.get(e.farmer_id) ?? e.farmer_id,
      cropPlanId: e.crop_plan_id,
      crop: crops.get(e.crop_plan_id) ?? "",
      weekStart: e.week_start,
      volumeM3: e.volume_m3,
      netMm: e.net_irrigation_mm,
      status: e.status === "approved" ? "approved" : e.status === "edited" ? "edited" : "proposed",
    }));
    return { rows, seasonTotalM3: data.season_total_m3, explanationEn: data.explanation, explanationTe: "", source: source() };
  },

  async approveEntitlements(edits: { id: string; volume_m3: number }[]): Promise<{ approved: number; source: Source }> {
    const res = await client.approveEntitlements({ edits });
    return { approved: res.approved, source: source() };
  },

  async proposeRoster(mode: "equal_water" | "equal_hours"): Promise<{ proposal: RosterProposal; source: Source }> {
    const [windows, names] = await Promise.all([client.releaseWindows(), farmerNames()]);
    const win = windows[0];
    if (!win) throw new Error("no release window");
    const data = await client.proposeRoster({ release_window_id: win.id, mode });
    const needByOutlet = new Map(data.need_met.map((n) => [n.outlet_id, n.pct]));
    const proposal: RosterProposal = {
      id: data.roster.id,
      mode,
      releaseWindowId: win.id,
      turns: data.roster.turns.map((t) => {
        const durH = (Date.parse(t.end) - Date.parse(t.start)) / 3600000;
        return {
          id: t.id,
          outletId: t.outlet_id,
          farmerId: t.farmer_id,
          farmerName: names.get(t.farmer_id) ?? t.farmer_id,
          start: t.start,
          end: t.end,
          plannedVolumeM3: t.planned_volume_m3,
          expectedFlowM3s: t.expected_flow_m3s,
          durationH: Math.round(durH * 100) / 100,
          needMetPct: needByOutlet.get(t.outlet_id) ?? 0,
        };
      }),
      equalHoursGini: data.comparison.equal_hours_gini,
      equalWaterGini: data.comparison.equal_water_gini,
    };
    return { proposal, source: source() };
  },

  async approveRoster(id: string): Promise<{ contactsQueued: number; source: Source }> {
    const res = await client.approveRoster(id);
    return { contactsQueued: res.contacts_queued, source: source() };
  },

  async listRequests(): Promise<{ rows: RequestRow[]; source: Source }> {
    const [list, names] = await Promise.all([client.listRequests(), farmerNames()]);
    const rows: RequestRow[] = list.map((w) => ({
      id: w.id,
      farmerId: w.farmer_id,
      farmerName: names.get(w.farmer_id) ?? w.farmer_id,
      type: w.type,
      volumeM3: w.volume_m3,
      reason: w.reason,
      reasonTe: "",
      channel: w.channel,
      status: w.status,
      triageScore: w.triage_score ?? 0,
      recommendation: {
        decision: w.agent_recommendation?.decision ?? "approve",
        volumeM3: w.agent_recommendation?.volume_m3 ?? 0,
        rationale: w.agent_recommendation?.rationale ?? "",
        rationaleTe: "",
      },
      decision: w.coordinator_decision
        ? { decision: w.coordinator_decision.decision, volumeM3: w.coordinator_decision.volume_m3, note: w.coordinator_decision.note }
        : undefined,
    }));
    return { rows, source: source() };
  },

  async decideRequest(id: string, decision: "approve" | "reject", volumeM3: number): Promise<{ source: Source }> {
    await client.decideRequest(id, { decision, volume_m3: volumeM3 });
    return { source: source() };
  },

  async ledger(): Promise<{ balances: LedgerView; source: Source }> {
    const data = await client.ledger();
    return { balances: toLedgerView(data), source: source() };
  },

  async audit(): Promise<{ balances: LedgerView; findings: { severity: "info" | "warn" | "critical"; text: string }[]; summaryEn: string; summaryTe: string; source: Source }> {
    const [data, led] = await Promise.all([client.audit(), client.ledger()]);
    return { balances: toLedgerView(led), findings: data.findings, summaryEn: data.summary_en, summaryTe: data.summary_te, source: source() };
  },
};

function toLedgerView(data: Awaited<ReturnType<typeof client.ledger>>): LedgerView {
  const b = data.balances;
  return {
    canalSupplyM3: b.canal_supply_m3,
    bufferM3: b.buffer_m3,
    conveyanceLossesM3: b.conveyance_losses_m3,
    farmers: b.farmers.map((f) => ({ farmerId: f.farmer_id, name: f.name, quotaM3: f.quota_m3, deliveredM3: f.delivered_m3, needMetPct: f.need_met_pct })),
    conservationOk: b.conservation_ok,
    gini: b.gini,
    entries: data.entries.map((e) => ({ id: e.id, at: e.at, from: e.from, to: e.to, volumeM3: e.volume_m3, reason: e.reason })),
  };
}
