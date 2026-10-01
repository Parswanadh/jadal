// API client for the coordinator console.
// Tries the live /api routes from packages/contracts; on any network or
// schema failure it falls back to the offline mock so the demo always works.
// Numbers displayed by the UI come ONLY from these functions (API or mock).

import { mock } from "./mock";
import type {
  EntitlementRow,
  FarmerRegistration,
  LedgerView,
  RequestRow,
  RosterProposal,
} from "./mock";

export type Source = "live" | "mock";

async function getJson<T>(path: string): Promise<{ data: T; source: Source }> {
  try {
    const res = await fetch(path, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
    const data = (await res.json()) as T;
    return { data, source: "live" };
  } catch {
    throw new Error("offline");
  }
}

function anyRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Map /api/farmers (contracts shape) to the local view; throws if shape is off. */
function mapFarmers(data: unknown): FarmerRegistration[] {
  if (!Array.isArray(data)) throw new Error("bad farmers");
  return data.map((r: unknown, i: number) => {
    if (!anyRecord(r)) throw new Error("bad row");
    const farmer = r["farmer"] as Record<string, unknown>;
    const plots = (r["plots"] as unknown[]) ?? [];
    const cps = (r["crop_plans"] as unknown[]) ?? [];
    const id = String(farmer["id"] ?? `f${String(i + 1)}`);
    return {
      farmer: {
        id,
        name: String(farmer["name"] ?? id),
        phone: String(farmer["phone"] ?? ""),
        hasSmartphone: Boolean(farmer["has_smartphone"] ?? true),
        channels: Array.isArray(farmer["preferred_channels"]) ? (farmer["preferred_channels"] as string[]) : ["voice"],
      },
      plots: plots.map((p: unknown) => {
        const pp = p as Record<string, unknown>;
        return {
          id: String(pp["id"] ?? ""),
          outletId: String(pp["outlet_id"] ?? ""),
          areaHa: Number(pp["area_ha"] ?? 0),
          soil: String(pp["soil"] ?? ""),
        };
      }),
      cropPlans: cps.map((c: unknown) => {
        const cc = c as Record<string, unknown>;
        return {
          id: String(cc["id"] ?? ""),
          plotId: String(cc["plot_id"] ?? ""),
          crop: String(cc["crop"] ?? ""),
          sowingDate: String(cc["sowing_date"] ?? ""),
        };
      }),
      verified: Boolean(r["verified"]),
    };
  });
}

export const api = {
  async listFarmers(): Promise<{ rows: FarmerRegistration[]; source: Source }> {
    try {
      const { data } = await getJson<unknown>("/api/farmers");
      return { rows: mapFarmers(data), source: "live" };
    } catch {
      return { rows: await mock.listFarmers(), source: "mock" };
    }
  },

  async verifyFarmer(id: string): Promise<{ ok: boolean; source: Source }> {
    try {
      const res = await fetch(`/api/farmers/${encodeURIComponent(id)}/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!res.ok) throw new Error("verify failed");
      return { ok: true, source: "live" };
    } catch {
      // Offline mock: pretend the verify succeeded locally.
      return { ok: true, source: "mock" };
    }
  },

  async suggestEntitlements(): Promise<{ rows: EntitlementRow[]; seasonTotalM3: number; explanationEn: string; explanationTe: string; source: Source }> {
    try {
      const { data } = await getJson<{ entitlements: unknown[]; season_total_m3: number; explanation: string }>("/api/entitlements/suggest");
      if (!Array.isArray(data.entitlements)) throw new Error("bad entitlements");
      const rows: EntitlementRow[] = data.entitlements.map((e: unknown, i: number) => {
        const ee = e as Record<string, unknown>;
        return {
          id: String(ee["id"] ?? `e${String(i + 1)}`),
          farmerId: String(ee["farmer_id"] ?? ""),
          farmerName: String(ee["farmer_id"] ?? ""),
          cropPlanId: String(ee["crop_plan_id"] ?? ""),
          crop: "",
          weekStart: String(ee["week_start"] ?? ""),
          volumeM3: Number(ee["volume_m3"] ?? 0),
          netMm: Number(ee["net_irrigation_mm"] ?? 0),
          status: "proposed",
        };
      });
      return { rows, seasonTotalM3: data.season_total_m3, explanationEn: data.explanation, explanationTe: "", source: "live" };
    } catch {
      const m = await mock.suggestEntitlements();
      return { ...m, source: "mock" };
    }
  },

  async approveEntitlements(edits: { id: string; volume_m3: number }[]): Promise<{ approved: number; source: Source }> {
    try {
      const res = await fetch("/api/entitlements/approve", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ edits }),
      });
      if (!res.ok) throw new Error("approve failed");
      const data = (await res.json()) as { approved: number };
      return { approved: data.approved, source: "live" };
    } catch {
      return { approved: edits.length, source: "mock" };
    }
  },

  async proposeRoster(mode: "equal_water" | "equal_hours"): Promise<{ proposal: RosterProposal; source: Source }> {
    try {
      const res = await fetch("/api/rosters/propose", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ release_window_id: "rw1", mode }),
      });
      if (!res.ok) throw new Error("propose failed");
      const data = (await res.json()) as {
        roster: { id: string; turns: { id: string; outlet_id: string; farmer_id: string; start: string; end: string; planned_volume_m3: number; expected_flow_m3s: number }[] };
        need_met: { farmer_id: string; outlet_id: string; pct: number }[];
        comparison: { equal_hours_gini: number; equal_water_gini: number };
      };
      const needByOutlet = new Map(data.need_met.map((n) => [n.outlet_id, n.pct]));
      const proposal: RosterProposal = {
        id: data.roster.id,
        mode,
        releaseWindowId: "rw1",
        turns: data.roster.turns.map((t) => {
          const durH = (Date.parse(t.end) - Date.parse(t.start)) / 3600000;
          return {
            id: t.id, outletId: t.outlet_id, farmerId: t.farmer_id, farmerName: t.farmer_id,
            start: t.start, end: t.end, plannedVolumeM3: t.planned_volume_m3,
            expectedFlowM3s: t.expected_flow_m3s, durationH: Math.round(durH * 100) / 100,
            needMetPct: needByOutlet.get(t.outlet_id) ?? 0,
          };
        }),
        equalHoursGini: data.comparison.equal_hours_gini,
        equalWaterGini: data.comparison.equal_water_gini,
      };
      return { proposal, source: "live" };
    } catch {
      return { proposal: await mock.proposeRoster(mode), source: "mock" };
    }
  },

  async approveRoster(id: string): Promise<{ contactsQueued: number; source: Source }> {
    try {
      const res = await fetch(`/api/rosters/${encodeURIComponent(id)}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!res.ok) throw new Error("approve failed");
      const data = (await res.json()) as { contacts_queued: number };
      return { contactsQueued: data.contacts_queued, source: "live" };
    } catch {
      return { contactsQueued: 8, source: "mock" };
    }
  },

  async listRequests(): Promise<{ rows: RequestRow[]; source: Source }> {
    try {
      const { data } = await getJson<unknown[]>("/api/requests");
      const rows: RequestRow[] = data.map((w: unknown) => {
        const ww = w as Record<string, unknown>;
        const rec = (ww["agent_recommendation"] as Record<string, unknown> | undefined) ?? undefined;
        const dec = (ww["coordinator_decision"] as Record<string, unknown> | undefined) ?? undefined;
        const rd = rec?.["decision"];
        const decision = rd === "approve" || rd === "reject" || rd === "partial" ? rd : "approve";
        return {
          id: String(ww["id"] ?? ""),
          farmerId: String(ww["farmer_id"] ?? ""),
          farmerName: String(ww["farmer_id"] ?? ""),
          type: (ww["type"] as RequestRow["type"]) ?? "urgent",
          volumeM3: Number(ww["volume_m3"] ?? 0),
          reason: String(ww["reason"] ?? ""),
          reasonTe: "",
          channel: String(ww["channel"] ?? "portal"),
          status: String(ww["status"] ?? "raised"),
          triageScore: Number(ww["triage_score"] ?? 0),
          recommendation: {
            decision,
            volumeM3: Number(rec?.["volume_m3"] ?? 0),
            rationale: String(rec?.["rationale"] ?? ""),
            rationaleTe: "",
          },
          decision: dec ? { decision: (dec["decision"] as "approve" | "reject") ?? "approve", volumeM3: Number(dec["volume_m3"] ?? 0) } : undefined,
        };
      });
      return { rows, source: "live" };
    } catch {
      return { rows: await mock.listRequests(), source: "mock" };
    }
  },

  async decideRequest(id: string, decision: "approve" | "reject", volumeM3: number): Promise<{ source: Source }> {
    try {
      const res = await fetch(`/api/requests/${encodeURIComponent(id)}/decide`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, volume_m3: volumeM3 }),
      });
      if (!res.ok) throw new Error("decide failed");
      return { source: "live" };
    } catch {
      return { source: "mock" };
    }
  },

  async ledger(): Promise<{ balances: LedgerView; source: Source }> {
    try {
      const { data } = await getJson<{ balances: { canal_supply_m3: number; buffer_m3: number; conveyance_losses_m3: number; farmers: { farmer_id: string; name: string; quota_m3: number; delivered_m3: number; need_met_pct: number }[]; conservation_ok: boolean; gini: number }; entries: { id: string; at: string; from: string; to: string; volume_m3: number; reason: string }[] }>("/api/ledger");
      return {
        balances: {
          canalSupplyM3: data.balances.canal_supply_m3,
          bufferM3: data.balances.buffer_m3,
          conveyanceLossesM3: data.balances.conveyance_losses_m3,
          farmers: data.balances.farmers.map((f) => ({ farmerId: f.farmer_id, name: f.name, quotaM3: f.quota_m3, deliveredM3: f.delivered_m3, needMetPct: f.need_met_pct })),
          conservationOk: data.balances.conservation_ok,
          gini: data.balances.gini,
          entries: data.entries.map((e) => ({ id: e.id, at: e.at, from: e.from, to: e.to, volumeM3: e.volume_m3, reason: e.reason })),
        },
        source: "live",
      };
    } catch {
      return { balances: await mock.ledger(), source: "mock" };
    }
  },

  async audit(): Promise<{ balances: LedgerView; findings: { severity: "info" | "warn" | "critical"; text: string }[]; summaryEn: string; summaryTe: string; source: Source }> {
    try {
      const { data } = await getJson<{ balances: unknown; findings: { severity: "info" | "warn" | "critical"; text: string }[]; summary_en: string; summary_te: string }>("/api/audit");
      const { balances } = await api.ledger();
      return { balances, findings: data.findings, summaryEn: data.summary_en, summaryTe: data.summary_te, source: "live" };
    } catch {
      const m = await mock.audit();
      return { ...m, source: "mock" };
    }
  },
};
