// Deterministic mock responses for the web API client (Task C2).
//
// Every builder below derives its payload from
// packages/contracts/fixtures/demo-scenario.json and validates the result
// with the matching contract zod schema from packages/contracts/src/api.ts.
// The client (client.ts) serves these builders when VITE_MOCK=1 (the default).
//
// Mock-only numeric assumptions are marked ASSUMED and are illustrative:
// they stand in for backend numbers until Task B lands.

import { routes } from "@jadal/contracts";
import type { z } from "zod";
import scenarioJson from "@jadal/contracts/fixtures/demo-scenario.json";

// ASSUMED: illustrative mock values only, used until @jadal/core (Task A) and the intake agent (Task B) supply real numbers.
const MOCK_NET_IRRIGATION_MM = 50; // ASSUMED: mock net irrigation depth per cropped fraction
const MOCK_LAG_H_PER_KM = 0.4; // ASSUMED: mock travel lag per km of canal; core uses lag = x / v (Manning)
const MOCK_URGENT_VOLUME_M3 = 200; // ASSUMED: mock urgent request volume
const MOCK_BUFFER_VOLUME_M3 = 120; // ASSUMED: mock buffer request volume


// Minimal structural view of the seed fixture (extra keys ignored).
interface DemoScenario {
  now: string;
  canal: { id: string; name: string; length_m: number; head_discharge_m3s: number; seepage_k_per_m: number; manning_n: number; bed_slope: number; hydraulic_radius_m: number; lined: boolean };
  outlets: { id: string; canal_id: string; name: string; chainage_m: number }[];
  farmers: { id: string; name: string; phone: string; language: string; preferred_channels: string[]; has_smartphone: boolean }[];
  plots: { id: string; farmer_id: string; outlet_id: string; area_ha: number; soil: string; lat: number; lon: number }[];
  crop_plans: { id: string; plot_id: string; crop: string; sowing_date: string; area_fraction: number; application_efficiency: number; status: string }[];
  release_windows: { id: string; canal_id: string; start: string; end: string; discharge_m3s: number }[];
  season_supply_m3: number;
}

const scenario = scenarioJson as unknown as DemoScenario;

/** Fixture `now` converted to UTC (fixture stores +05:30). */
export const MOCK_NOW = "2026-09-14T00:30:00Z";
export const MOCK_WEEK_START = "2026-09-14";
export const MOCK_VERSION = "0.1.0-mock";

/** ASSUMED mock quota rate: 12 000 m3 per ha per season (illustrative only). */
const MOCK_QUOTA_M3_PER_HA = 12000;
/** ASSUMED mock conveyance loss for the season view (illustrative only). */
const MOCK_CONVEYANCE_M3 = 12000;

function plotsOfFarmer(farmerId: string) {
  return scenario.plots.filter((p) => p.farmer_id === farmerId);
}

function cropPlansOfFarmer(farmerId: string) {
  const plotIds = new Set(plotsOfFarmer(farmerId).map((p) => p.id));
  return scenario.crop_plans.filter((cp) => plotIds.has(cp.plot_id));
}

function farmerAreaHa(farmerId: string): number {
  return plotsOfFarmer(farmerId).reduce((sum, p) => sum + p.area_ha, 0);
}

function outletFarmerId(outletId: string): string {
  const plot = scenario.plots.find((p) => p.outlet_id === outletId);
  if (plot) return plot.farmer_id;
  const first = scenario.farmers[0];
  if (!first) throw new Error("mock fixture has no farmers");
  return first.id;
}

function firstWindow() {
  const w = scenario.release_windows[0];
  if (!w) throw new Error("mock fixture has no release windows");
  return w;
}

function findWindow(id: string) {
  return scenario.release_windows.find((w) => w.id === id) ?? firstWindow();
}

export function mockHealth() {
  return routes.health.response.parse({ ok: true, version: MOCK_VERSION });
}

export function mockCanal() {
  return routes.canal.response.parse({ canal: scenario.canal, outlets: scenario.outlets });
}

export function mockRegister(body: z.input<typeof routes.register.body>) {
  const input = routes.register.body.parse(body);
  const farmerId = "f-mock-1";
  const farmer = { ...input.farmer, id: farmerId };
  const plots = input.plots.map((p, i) => ({ ...p, id: `p-mock-${i + 1}`, farmer_id: farmerId }));
  const cropPlans = input.crop_plans.map((cp, i) => {
    const plot = plots[cp.plot_index] ?? plots[0];
    if (!plot) throw new Error("mock register needs at least one plot");
    const { plot_index: _dropped, ...rest } = cp;
    return { ...rest, id: `cp-mock-${i + 1}`, plot_id: plot.id, status: "registered" as const };
  });
  return routes.register.response.parse({ farmer, plots, crop_plans: cropPlans });
}

export function mockListFarmers() {
  const list = scenario.farmers.map((farmer) => ({
    farmer,
    plots: plotsOfFarmer(farmer.id),
    crop_plans: cropPlansOfFarmer(farmer.id),
    verified: true,
  }));
  return routes.listFarmers.response.parse(list);
}

export function mockVerifyFarmer(_id: string) {
  return routes.verifyFarmer.response.parse({ ok: true });
}

export function mockSuggestEntitlements(body: z.input<typeof routes.suggestEntitlements.body> = {}) {
  const input = routes.suggestEntitlements.body.parse(body);
  const weekStart = input.week_start ?? MOCK_WEEK_START;
  const entitlements = scenario.crop_plans.map((cp) => {
    const plot = scenario.plots.find((p) => p.id === cp.plot_id);
    if (!plot) throw new Error(`mock fixture: plot ${cp.plot_id} missing`);
    // ASSUMED mock share: 500 m3 per ha of cropped area (illustrative only).
    const volume_m3 = Math.round(plot.area_ha * cp.area_fraction * 500);
    return {
      id: `e-${cp.id}-${weekStart}`,
      farmer_id: plot.farmer_id,
      crop_plan_id: cp.id,
      week_start: weekStart,
      volume_m3,
      // ASSUMED: mock net irrigation depth per cropped fraction; illustrative pending the FAO-56 crop engine in @jadal/core
      net_irrigation_mm: Math.round(MOCK_NET_IRRIGATION_MM * cp.area_fraction * 10) / 10,
      status: "proposed" as const,
      explanation: `Mock weekly share for ${cp.crop} (${plot.area_ha} ha).`,
    };
  });
  const seasonTotal = entitlements.reduce((sum, e) => sum + e.volume_m3, 0);
  return routes.suggestEntitlements.response.parse({
    entitlements,
    season_total_m3: seasonTotal,
    explanation: "Mock entitlements derived from the demo seed scenario.",
  });
}

export function mockApproveEntitlements(body: z.input<typeof routes.approveEntitlements.body> = {}) {
  const input = routes.approveEntitlements.body.parse(body);
  const fallback = mockSuggestEntitlements().entitlements.length;
  const approved = input.edits.length === 0 ? fallback : input.edits.length;
  return routes.approveEntitlements.response.parse({ approved });
}

export function mockReleaseWindows() {
  return routes.releaseWindows.response.parse(scenario.release_windows);
}

export function mockProposeRoster(body: z.input<typeof routes.proposeRoster.body>) {
  const input = routes.proposeRoster.body.parse(body);
  const window = findWindow(input.release_window_id);
  const startMs = Date.parse(window.start);
  const endMs = Date.parse(window.end);
  const outlets = [...scenario.outlets].sort((a, b) => a.chainage_m - b.chainage_m);
  const slotMs = Math.floor((endMs - startMs) / outlets.length);
  const rosterId = `r-${window.id}-${input.mode}`;
  const turns = outlets.map((o, i) => {
    const start = new Date(startMs + i * slotMs).toISOString();
    const end = new Date(startMs + (i + 1) * slotMs).toISOString();
    // Attenuate head discharge with the canal's own seepage constant from the fixture.
    const expected_flow_m3s = Math.round(window.discharge_m3s * Math.exp(-scenario.canal.seepage_k_per_m * o.chainage_m) * 1000) / 1000;
    return {
      id: `t-${window.id}-${o.id}`,
      roster_id: rosterId,
      outlet_id: o.id,
      farmer_id: outletFarmerId(o.id),
      start,
      end,
      planned_volume_m3: Math.round((expected_flow_m3s * slotMs) / 1000),
      expected_flow_m3s,
      lag_h: Math.round(((o.chainage_m / 1000) * MOCK_LAG_H_PER_KM * 10) / 10),
    };
  });
  const roster = {
    id: rosterId,
    canal_id: scenario.canal.id,
    release_window_id: window.id,
    status: "proposed" as const,
    turns,
    shortfall_m3: {} as Record<string, number>,
  };
  // ASSUMED mock need-met pattern (illustrative): equal_water lifts every
  // outlet above 90%; equal_hours leaves the tail short.
  const need_met = outlets.map((o, i) => ({
    farmer_id: outletFarmerId(o.id),
    outlet_id: o.id,
    pct: input.mode === "equal_water" ? 92 + (i % 4) : i < 2 ? 98 : Math.max(40, 98 - i * 8),
  }));
  return routes.proposeRoster.response.parse({
    roster,
    need_met,
    comparison: { equal_hours_gini: 0.31, equal_water_gini: 0.05 },
  });
}

export function mockApproveRoster(_id: string) {
  return routes.approveRoster.response.parse({ ok: true, contacts_queued: scenario.outlets.length });
}

export function mockRaiseRequest(body: z.input<typeof routes.raiseRequest.body>) {
  const input = routes.raiseRequest.body.parse(body);
  return routes.raiseRequest.response.parse({
    id: "req-mock-1",
    ...input,
    status: "raised" as const,
    raised_at: MOCK_NOW,
  });
}

export function mockListRequests() {
  return routes.listRequests.response.parse([
    {
      id: "req-mock-1",
      farmer_id: "f1",
      crop_plan_id: "cp1",
      type: "urgent",
      volume_m3: MOCK_URGENT_VOLUME_M3,
      reason: "Rice flowering, needs extra water (mock).",
      channel: "voice",
      status: "raised",
      raised_at: MOCK_NOW,
      triage_score: 0.9,
    },
    {
      id: "req-mock-2",
      farmer_id: "f7",
      type: "buffer",
      volume_m3: MOCK_BUFFER_VOLUME_M3,
      reason: "Buffer request for next week (mock).",
      channel: "portal",
      status: "approved",
      raised_at: MOCK_NOW,
      triage_score: 0.4,
      coordinator_decision: { decision: "approve", volume_m3: 120, note: "Mock approval.", at: MOCK_NOW },
    },
  ]);
}

export function mockDecideRequest(id: string, body: z.input<typeof routes.decideRequest.body>) {
  const input = routes.decideRequest.body.parse(body);
  const existing = mockListRequests().find((r) => r.id === id);
  const base =
    existing ??
    ({
      id,
      farmer_id: "f1",
      type: "urgent",
      volume_m3: input.volume_m3,
      reason: "Mock request.",
      channel: "voice",
      raised_at: MOCK_NOW,
    } as const);
  return routes.decideRequest.response.parse({
    ...base,
    status: input.decision === "approve" ? ("approved" as const) : ("rejected" as const),
    coordinator_decision: { decision: input.decision, volume_m3: input.volume_m3, note: input.note, at: MOCK_NOW },
  });
}

export function mockBalances() {
  const farmers = scenario.farmers.map((f) => ({
    farmer_id: f.id,
    name: f.name,
    quota_m3: Math.round(farmerAreaHa(f.id) * MOCK_QUOTA_M3_PER_HA),
    delivered_m3: 0,
    need_met_pct: 0,
  }));
  const quotaSum = farmers.reduce((sum, f) => sum + f.quota_m3, 0);
  return {
    canal_supply_m3: scenario.season_supply_m3,
    buffer_m3: scenario.season_supply_m3 - quotaSum - MOCK_CONVEYANCE_M3,
    conveyance_losses_m3: MOCK_CONVEYANCE_M3,
    farmers,
    conservation_ok: true,
    gini: 0.05,
  };
}

export function mockLedger() {
  const balances = mockBalances();
  return routes.ledger.response.parse({
    entries: [
      {
        id: "le-mock-1",
        at: MOCK_NOW,
        from: "canal_supply",
        to: "buffer",
        volume_m3: balances.buffer_m3,
        reason: "Season buffer reserve (mock).",
        event_id: "ev-mock-season",
      },
    ],
    balances,
  });
}

export function mockEvents() {
  const head = scenario.farmers[0];
  if (!head) throw new Error("mock fixture has no farmers");
  return routes.events.response.parse([
    {
      id: "ev-mock-1",
      at: MOCK_NOW,
      canal_id: scenario.canal.id,
      actor: { kind: "coordinator", id: "coord-1" },
      type: "farmer.registered",
      farmer: head,
      plots: plotsOfFarmer(head.id),
      crop_plans: cropPlansOfFarmer(head.id),
    },
    {
      id: "ev-mock-2",
      at: MOCK_NOW,
      canal_id: scenario.canal.id,
      actor: { kind: "coordinator", id: "coord-1" },
      type: "release_window.announced",
      window: firstWindow(),
    },
    {
      id: "ev-mock-3",
      at: MOCK_NOW,
      canal_id: scenario.canal.id,
      actor: { kind: "agent", id: "scheduler" },
      type: "roster.proposed",
      roster: mockProposeRoster({ release_window_id: firstWindow().id, mode: "equal_water" }).roster,
    },
  ]);
}

export function mockContacts() {
  const list = scenario.farmers.map((f) => ({
    id: `ct-${f.id}`,
    farmer_id: f.id,
    channel: f.has_smartphone ? ("whatsapp" as const) : ("voice" as const),
    purpose: "roster_change" as const,
    status: "queued" as const,
    attempt: 1,
    message_te: "మీ నీటి వంతు సమయం మారింది.",
    message_en: "Your water turn time has changed (mock).",
    at: MOCK_NOW,
  }));
  return routes.contacts.response.parse(list);
}

function mockContactById(contactId: string) {
  const found = mockContacts().find((c) => c.id === contactId);
  if (found) return found;
  return {
    id: contactId,
    farmer_id: "f1",
    channel: "voice" as const,
    purpose: "request_update" as const,
    status: "queued" as const,
    attempt: 1,
    message_te: "మీ అభ్యర్థనపై స్పందన.",
    message_en: "Update on your request (mock).",
    at: MOCK_NOW,
  };
}

export function mockPhoneReply(contactId: string, body: z.input<typeof routes.phoneReply.body>) {
  const input = routes.phoneReply.body.parse(body);
  const contact = { ...mockContactById(contactId), status: "acknowledged" as const, transcript: input.text ?? "voice reply (mock)" };
  return routes.phoneReply.response.parse({
    contact,
    agent_reply_te: "సరే, మీ వంతు ఖరారు చేయబడింది.",
    agent_reply_en: "Okay, your turn has been confirmed (mock).",
  });
}

export function mockIntake(body: z.input<typeof routes.intake.body>) {
  const input = routes.intake.body.parse(body);
  const text = input.text ?? "నీరు కావాలి";
  const urgent = /నీరు|water|urgent|extra/i.test(text);
  return routes.intake.response.parse({
    transcript_te: text,
    intent: urgent ? "urgent_request" : "schedule_question",
    urgency: urgent ? 0.85 : 0.3,
    request: urgent
      ? {
          id: "req-mock-intake",
          farmer_id: input.farmer_id,
          type: "urgent",
          volume_m3: MOCK_URGENT_VOLUME_M3,
          reason: text,
          channel: "voice",
          status: "raised",
          raised_at: MOCK_NOW,
        }
      : undefined,
  });
}

export function mockAudit() {
  return routes.audit.response.parse({
    balances: mockBalances(),
    findings: [
      { severity: "info", text: "Conservation holds: quotas + buffer + losses equal canal supply (mock)." },
      { severity: "warn", text: "Tail outlets o7/o8 are short under equal-hours; prefer equal-water (mock)." },
    ],
    summary_en: "Mock audit: books balance and equal-water sharing is fairer for tail farmers.",
    summary_te: "మాక్ ఆడిట్: లెక్కలు సరిపోయాయి; చివరి రైతులకు సమాన నీటి పంపిణీ మేలు.",
  });
}

export function mockDemoReset() {
  return routes.demoReset.response.parse({ ok: true });
}

export function mockDemoAdvance(body: z.input<typeof routes.demoAdvance.body>) {
  const input = routes.demoAdvance.body.parse(body);
  const now = new Date(new Date(MOCK_NOW).getTime() + input.hours * 3600 * 1000).toISOString();
  return routes.demoAdvance.response.parse({ now });
}
