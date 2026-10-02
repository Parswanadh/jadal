// Coordinator console view of the shared typed API client (src/api/client.ts).
// The shared client serves contract-validated mock data when VITE_MOCK is not "0"
// and calls the live routes otherwise. This module only reshapes the responses
// into the console's view types. It computes no water numbers, so every figure
// displayed comes from the API (or its mock).

import { api as client, sendAlert as clientSendAlert, updateTurn as clientUpdateTurn } from "../api";
import type { AlertChannel, AlertSeverity } from "../api/extra";
import type { AuditView, EntitlementRow, FarmerRegistration, LedgerView, RequestRow, RosterProposal } from "./types";

async function farmerNames(): Promise<Map<string, string>> {
  const list = await client.listFarmers();
  return new Map(list.map((r) => [r.farmer.id, r.farmer.name]));
}

export const api = {
  async listFarmers(): Promise<FarmerRegistration[]> {
    const [list, canal] = await Promise.all([client.listFarmers(), client.canal()]);
    const outletName = new Map(canal.outlets.map((o) => [o.id, o.name]));
    return list.map((r) => ({
      farmer: { id: r.farmer.id, name: r.farmer.name, phone: r.farmer.phone, hasSmartphone: r.farmer.has_smartphone },
      plots: r.plots.map((p) => ({ id: p.id, outletName: outletName.get(p.outlet_id) ?? "", areaHa: p.area_ha, soil: p.soil })),
      cropPlans: r.crop_plans.map((c) => ({ id: c.id, plotId: c.plot_id, crop: c.crop, sowingDate: c.sowing_date })),
      verified: r.verified,
    }));
  },

  async verifyFarmer(id: string): Promise<boolean> {
    const res = await client.verifyFarmer(id);
    return res.ok;
  },

  async suggestEntitlements(): Promise<{ rows: EntitlementRow[]; seasonTotalM3: number; explanation: string }> {
    const [data, list] = await Promise.all([client.suggestEntitlements(), client.listFarmers()]);
    const names = new Map(list.map((r) => [r.farmer.id, r.farmer.name]));
    const crops = new Map(list.flatMap((r) => r.crop_plans.map((c) => [c.id, c.crop] as const)));
    const rows: EntitlementRow[] = data.entitlements.map((e) => ({
      id: e.id,
      farmerId: e.farmer_id,
      farmerName: names.get(e.farmer_id) ?? "",
      crop: crops.get(e.crop_plan_id) ?? "",
      weekStart: e.week_start,
      volumeM3: e.volume_m3,
      netMm: e.net_irrigation_mm,
      status: e.status,
    }));
    return { rows, seasonTotalM3: data.season_total_m3, explanation: data.explanation };
  },

  async approveEntitlements(edits: { id: string; volume_m3: number }[]): Promise<number> {
    const res = await client.approveEntitlements({ edits });
    return res.approved;
  },

  async proposeRoster(mode: "equal_water" | "equal_hours"): Promise<RosterProposal> {
    const [windows, names, canal] = await Promise.all([client.releaseWindows(), farmerNames(), client.canal()]);
    const win = windows[0];
    if (!win) throw new Error("no release window");
    const data = await client.proposeRoster({ release_window_id: win.id, mode });
    const needByOutlet = new Map(data.need_met.map((n) => [n.outlet_id, n.pct]));
    const outletName = new Map(canal.outlets.map((o) => [o.id, o.name]));
    return {
      id: data.roster.id,
      mode,
      approved: data.roster.status === "approved",
      windowStart: win.start,
      windowEnd: win.end,
      turns: data.roster.turns.map((t) => ({
        id: t.id,
        outletName: outletName.get(t.outlet_id) ?? "",
        farmerName: names.get(t.farmer_id) ?? "",
        start: t.start,
        end: t.end,
        plannedVolumeM3: t.planned_volume_m3,
        needMetPct: needByOutlet.get(t.outlet_id) ?? 0,
      })),
      equalHoursGini: data.comparison.equal_hours_gini,
      equalWaterGini: data.comparison.equal_water_gini,
    };
  },

  async approveRoster(id: string): Promise<number> {
    const res = await client.approveRoster(id);
    return res.contacts_queued;
  },

  /** Set one turn's start and end. Returns what the API stored. */
  async updateTurn(rosterId: string, turnId: string, start: string, end: string): Promise<{ start: string; end: string }> {
    const res = await clientUpdateTurn(rosterId, turnId, { start, end });
    return { start: res.turn.start, end: res.turn.end };
  },

  /** Alert one farmer by call, SMS or WhatsApp. `simulated` says whether anything really left. */
  async sendAlert(
    farmerId: string,
    channel: AlertChannel,
    severity: AlertSeverity,
    message?: string,
  ): Promise<{ simulated: boolean; detail: string }> {
    const trimmed = message?.trim();
    const res = await clientSendAlert({
      farmer_id: farmerId,
      channel,
      severity,
      message: trimmed ? trimmed : undefined,
    });
    return { simulated: res.simulated, detail: res.detail };
  },

  async listRequests(): Promise<RequestRow[]> {
    const [list, names] = await Promise.all([client.listRequests(), farmerNames()]);
    return list.map((w) => ({
      id: w.id,
      farmerId: w.farmer_id,
      farmerName: names.get(w.farmer_id) ?? "",
      type: w.type,
      volumeM3: w.volume_m3,
      reason: w.reason,
      channel: w.channel,
      raisedAt: w.raised_at,
      status: w.status,
      triageScore: w.triage_score ?? 0,
      recommendation: w.agent_recommendation
        ? { decision: w.agent_recommendation.decision, volumeM3: w.agent_recommendation.volume_m3, rationale: w.agent_recommendation.rationale }
        : undefined,
      decision: w.coordinator_decision
        ? { decision: w.coordinator_decision.decision, volumeM3: w.coordinator_decision.volume_m3, note: w.coordinator_decision.note }
        : undefined,
    }));
  },

  async decideRequest(id: string, decision: "approve" | "reject", volumeM3: number): Promise<void> {
    await client.decideRequest(id, { decision, volume_m3: volumeM3 });
  },

  async ledger(): Promise<LedgerView> {
    return toLedgerView(await client.ledger());
  },

  async audit(): Promise<AuditView> {
    const data = await client.audit();
    return { findings: data.findings, summaryEn: data.summary_en, summaryTe: data.summary_te };
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
