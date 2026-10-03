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
import { ApiClientError } from "./errors";
import { alertBodySchema, alertResponseSchema, updateTurnResponseSchema } from "./extra";
import type { AlertBody, AlertChannel, AlertResponse, AlertSeverity, Allocation, UpdateTurnBody, UpdateTurnResponse } from "./extra";
import { formatDateTime, formatRange } from "../lib/format";

// ASSUMED: illustrative mock values only, used until @jadal/core (Task A) and the intake agent (Task B) supply real numbers.
const MOCK_NET_IRRIGATION_MM = 50; // ASSUMED: mock net irrigation depth per cropped fraction
const MOCK_LAG_H_PER_KM = 0.4; // ASSUMED: mock travel lag per km of canal; core uses lag = x / v (Manning)
const MOCK_URGENT_VOLUME_M3 = 200; // ASSUMED: mock urgent request volume
const MOCK_BUFFER_VOLUME_M3 = 120; // ASSUMED: mock buffer request volume
const MOCK_URGENT_GRANT_M3 = 150; // ASSUMED: mock agent recommendation for the urgent request

/**
 * The mock's own request copy. These strings are the English values of the
 * matching `fixture.*` keys in src/i18n/en.json; the screens translate them
 * back by looking the text up in either language (src/i18n/fixtureText.ts), so
 * the two must stay identical. `i18n/fixtureText.test.ts` locks that equality.
 */
export const MOCK_FIXTURE_TEXT = {
  reasonMaizeTasseling: "My maize is tasseling and the leaves are rolling in the heat.",
  reasonTailShortTurn: "My field at the tail end got a short turn.",
  reasonWaterNeeded: "Water needed for my crop.",
  noteTailShort: "Tail end was short last turn.",
} as const;

/**
 * Mock-only copy for the audit trail. Like the other audit prose below, it is
 * the mock standing in for a server message; the console shows audit findings
 * in English only.
 */
export const MOCK_SCHEDULE_CHANGE_TEXT =
  "A turn time was changed by the coordinator. The new time is in the schedule.";

/** Mock-only detail line for a dispatched alert. */
export const MOCK_ALERT_DETAIL = "Queued on the practice line.";

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

type WaterRequestT = z.infer<typeof routes.raiseRequest.response>;
type FarmerListItem = z.infer<typeof routes.listFarmers.response>[number];

/**
 * What the mock remembers between calls, so the demo tells one story across
 * screens: a request decided in the demo is decided on the coordinator screen
 * too. `demoReset` clears it. Nothing here is saved to disk.
 */
interface MockState {
  registered: FarmerListItem[];
  verified: Set<string>;
  raised: WaterRequestT[];
  decided: Map<string, NonNullable<WaterRequestT["coordinator_decision"]> & { status: WaterRequestT["status"] }>;
  entitlementEdits: Map<string, number>;
  entitlementsApproved: boolean;
  approvedRosters: Set<string>;
  /** Turn times changed by the coordinator, keyed `${rosterId}:${turnId}`. */
  turnEdits: Map<string, { start: string; end: string }>;
  /** Manual alerts and request-triggered calls, newest last. */
  alerts: MockAlert[];
  /** Calls queued by a coordinator's decision on a request, newest last. */
  decisionContacts: MockDecisionContact[];
  clockHours: number;
  nextId: number;
}

/** The call a coordinator's decision queues to tell the farmer the outcome. */
export interface MockDecisionContact {
  contact_id: string;
  farmer_id: string;
  request_id: string;
  status: "approved" | "rejected";
  decision: "approve" | "reject";
  volume_m3: number;
  at: string;
}

/** One dispatched alert, as the mock remembers it for the phone and the audit. */
export interface MockAlert {
  contact_id: string;
  farmer_id: string;
  channel: AlertChannel;
  severity: AlertSeverity;
  message?: string;
  /** The water and window the alert carries, when it is about an allocation. */
  allocation?: Allocation;
  at: string;
}

function freshState(): MockState {
  return {
    registered: [pendingRegistration()],
    verified: new Set(),
    raised: [],
    decided: new Map(),
    entitlementEdits: new Map(),
    entitlementsApproved: false,
    approvedRosters: new Set(),
    turnEdits: new Map(),
    alerts: [],
    decisionContacts: [],
    clockHours: 0,
    nextId: 1,
  };
}

/** ASSUMED: one registration waiting for the coordinator, so the Farmers tab has something to check. */
function pendingRegistration(): FarmerListItem {
  return {
    farmer: {
      id: "f9",
      name: "Kavitha Mandava",
      phone: "+919000000009",
      language: "te",
      preferred_channels: ["voice", "whatsapp"],
      has_smartphone: true,
    },
    plots: [{ id: "p9", farmer_id: "f9", outlet_id: "o5", area_ha: 1.2, soil: "loam", lat: 16.3, lon: 80.44 }],
    crop_plans: [
      { id: "cp10", plot_id: "p9", crop: "maize", sowing_date: "2026-08-20", area_fraction: 1, application_efficiency: 0.65, status: "registered" },
    ],
    verified: false,
  };
}

let state: MockState = freshState();

/** Fixture `now` converted to UTC (fixture stores +05:30). */
export const MOCK_NOW = "2026-09-14T00:30:00Z";
export const MOCK_WEEK_START = "2026-09-14";
export const MOCK_VERSION = "0.1.0-mock";

/** The simulated "now": the fixture time plus whatever the demo has advanced. */
function mockNow(): string {
  return new Date(Date.parse(MOCK_NOW) + state.clockHours * 3600 * 1000).toISOString();
}

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
  const n = state.nextId++;
  const farmerId = `f-mock-${n}`;
  const farmer = { ...input.farmer, id: farmerId };
  const plots = input.plots.map((p, i) => ({ ...p, id: `p-mock-${n}-${i + 1}`, farmer_id: farmerId }));
  const cropPlans = input.crop_plans.map((cp, i) => {
    const plot = plots[cp.plot_index] ?? plots[0];
    if (!plot) throw new Error("mock register needs at least one plot");
    const { plot_index: _dropped, ...rest } = cp;
    return { ...rest, id: `cp-mock-${n}-${i + 1}`, plot_id: plot.id, status: "registered" as const };
  });
  state.registered.push({ farmer, plots, crop_plans: cropPlans, verified: false });
  return routes.register.response.parse({ farmer, plots, crop_plans: cropPlans });
}

export function mockListFarmers() {
  const seeded = scenario.farmers.map((farmer) => ({
    farmer,
    plots: plotsOfFarmer(farmer.id),
    crop_plans: cropPlansOfFarmer(farmer.id),
    verified: true,
  }));
  const registered = state.registered.map((r) => ({ ...r, verified: r.verified || state.verified.has(r.farmer.id) }));
  return routes.listFarmers.response.parse([...seeded, ...registered]);
}

export function mockVerifyFarmer(id: string) {
  state.verified.add(id);
  return routes.verifyFarmer.response.parse({ ok: true });
}

export function mockSuggestEntitlements(body: z.input<typeof routes.suggestEntitlements.body> = {}) {
  const input = routes.suggestEntitlements.body.parse(body);
  const weekStart = input.week_start ?? MOCK_WEEK_START;
  const entitlements = scenario.crop_plans.map((cp) => {
    const plot = scenario.plots.find((p) => p.id === cp.plot_id);
    if (!plot) throw new Error(`mock fixture: plot ${cp.plot_id} missing`);
    // ASSUMED mock share: 500 m3 per ha of cropped area (illustrative only).
    const suggested = Math.round(plot.area_ha * cp.area_fraction * 500);
    const id = `e-${cp.id}-${weekStart}`;
    const edited = state.entitlementEdits.get(id);
    const volume_m3 = edited ?? suggested;
    return {
      id,
      farmer_id: plot.farmer_id,
      crop_plan_id: cp.id,
      week_start: weekStart,
      volume_m3,
      // ASSUMED: mock net irrigation depth per cropped fraction; illustrative pending the FAO-56 crop engine in @jadal/core
      net_irrigation_mm: Math.round(MOCK_NET_IRRIGATION_MM * cp.area_fraction * 10) / 10,
      status: edited !== undefined ? ("edited" as const) : state.entitlementsApproved ? ("approved" as const) : ("proposed" as const),
      explanation: `Weekly share for ${cp.crop} on ${plot.area_ha} ha, from crop stage, weather and rain.`,
    };
  });
  const seasonTotal = entitlements.reduce((sum, e) => sum + e.volume_m3, 0);
  return routes.suggestEntitlements.response.parse({
    entitlements,
    season_total_m3: seasonTotal,
    explanation: "Shares are based on each crop's growth stage, this week's weather and the rain that has fallen.",
  });
}

export function mockApproveEntitlements(body: z.input<typeof routes.approveEntitlements.body> = {}) {
  const input = routes.approveEntitlements.body.parse(body);
  for (const edit of input.edits) state.entitlementEdits.set(edit.id, edit.volume_m3);
  state.entitlementsApproved = true;
  const approved = mockSuggestEntitlements().entitlements.length;
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
    const id = `t-${window.id}-${o.id}`;
    // A coordinator's time edit wins over the proposed slot. The planned volume
    // is left alone: this is schedule editing, not water arithmetic.
    const edit = state.turnEdits.get(`${rosterId}:${id}`);
    const start = edit?.start ?? new Date(startMs + i * slotMs).toISOString();
    const end = edit?.end ?? new Date(startMs + (i + 1) * slotMs).toISOString();
    // Attenuate head discharge with the canal's own seepage constant from the fixture.
    const expected_flow_m3s = Math.round(window.discharge_m3s * Math.exp(-scenario.canal.seepage_k_per_m * o.chainage_m) * 1000) / 1000;
    return {
      id,
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
    status: state.approvedRosters.has(rosterId) ? ("approved" as const) : ("proposed" as const),
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

export function mockApproveRoster(id: string) {
  state.approvedRosters.add(id);
  return routes.approveRoster.response.parse({ ok: true, contacts_queued: scenario.farmers.length });
}

/**
 * Mock of PATCH /api/rosters/:id/turns/:turnId.
 *
 * Rejects a backwards or unreadable pair the same way the server does, and
 * remembers the edit so the next proposal for that roster shows it.
 */
export async function mockUpdateTurn(rosterId: string, turnId: string, body: UpdateTurnBody): Promise<UpdateTurnResponse> {
  const start = Date.parse(body.start);
  const end = Date.parse(body.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new ApiClientError(400, "Enter a valid start and end time.", "bad_times");
  }
  if (end <= start) {
    throw new ApiClientError(400, "The end time must be after the start time.", "backwards_times");
  }

  const match = /^r-(.+)-(equal_water|equal_hours)$/.exec(rosterId);
  const windowId = match?.[1];
  const mode = match?.[2] as "equal_water" | "equal_hours" | undefined;
  if (!windowId || !mode || !scenario.release_windows.some((w) => w.id === windowId)) {
    throw new ApiClientError(404, "That schedule was not found.", "roster_not_found");
  }

  const proposed = mockProposeRoster({ release_window_id: windowId, mode }).roster;
  if (!proposed.turns.some((turn) => turn.id === turnId)) {
    throw new ApiClientError(404, "That turn was not found.", "turn_not_found");
  }

  state.turnEdits.set(`${rosterId}:${turnId}`, { start: body.start, end: body.end });
  const saved = mockProposeRoster({ release_window_id: windowId, mode }).roster.turns.find((turn) => turn.id === turnId);
  if (!saved) throw new ApiClientError(404, "That turn was not found.", "turn_not_found");
  return updateTurnResponseSchema.parse({ ok: true, turn: saved });
}

/**
 * Mock of POST /api/alerts. This build has no telephony, so every alert is
 * reported as simulated; the UI must say so rather than imply a real send.
 * The alert is remembered so the phone screen can play the agent's reply and
 * the audit can record the severity.
 */
export async function mockSendAlert(body: AlertBody): Promise<AlertResponse> {
  const input = alertBodySchema.parse(body);
  const known =
    scenario.farmers.some((farmer) => farmer.id === input.farmer_id) ||
    state.registered.some((entry) => entry.farmer.id === input.farmer_id);
  if (!known) throw new ApiClientError(404, "That farmer was not found.", "farmer_not_found");

  const contact_id = `ct-alert-${state.alerts.length + 1}`;
  state.alerts.push({
    contact_id,
    farmer_id: input.farmer_id,
    channel: input.channel,
    severity: input.severity,
    message: input.message,
    allocation: input.allocation,
    at: mockNow(),
  });
  return alertResponseSchema.parse({
    ok: true,
    contact_id,
    simulated: true,
    detail: MOCK_ALERT_DETAIL,
  });
}

export function mockRaiseRequest(body: z.input<typeof routes.raiseRequest.body>) {
  const input = routes.raiseRequest.body.parse(body);
  const request = {
    id: `req-new-${state.nextId++}`,
    ...input,
    status: "raised" as const,
    raised_at: mockNow(),
  };
  state.raised.push(request);
  return routes.raiseRequest.response.parse(request);
}

function seededRequests(): WaterRequestT[] {
  return [
    {
      id: "req-mock-1",
      farmer_id: "f6",
      crop_plan_id: "cp6",
      type: "urgent",
      volume_m3: MOCK_URGENT_VOLUME_M3,
      reason: MOCK_FIXTURE_TEXT.reasonMaizeTasseling,
      channel: "voice",
      status: "raised",
      raised_at: MOCK_NOW,
      triage_score: 0.9,
      agent_recommendation: {
        decision: "partial",
        volume_m3: MOCK_URGENT_GRANT_M3,
        rationale: "Maize at tasseling cannot wait. A partial grant keeps enough in the shared pool for other farms.",
      },
    },
    {
      id: "req-mock-2",
      farmer_id: "f8",
      type: "buffer",
      volume_m3: MOCK_BUFFER_VOLUME_M3,
      reason: MOCK_FIXTURE_TEXT.reasonTailShortTurn,
      channel: "portal",
      status: "approved",
      raised_at: MOCK_NOW,
      triage_score: 0.4,
      coordinator_decision: { decision: "approve", volume_m3: MOCK_BUFFER_VOLUME_M3, note: MOCK_FIXTURE_TEXT.noteTailShort, at: MOCK_NOW },
    },
  ];
}

export function mockListRequests() {
  const all = [...seededRequests(), ...state.raised];
  const merged = all.map((r) => {
    const decision = state.decided.get(r.id);
    if (!decision) return r;
    const { status, ...rest } = decision;
    return { ...r, status, coordinator_decision: rest };
  });
  return routes.listRequests.response.parse(merged);
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
      reason: MOCK_FIXTURE_TEXT.reasonWaterNeeded,
      channel: "voice",
      raised_at: MOCK_NOW,
    } as const);
  const status = input.decision === "approve" ? ("approved" as const) : ("rejected" as const);
  const decision = { decision: input.decision, volume_m3: input.volume_m3, note: input.note, at: mockNow() };
  state.decided.set(id, { ...decision, status });
  // Recording a decision queues the call that tells the farmer. Like every
  // other mock dispatch this build reports it as simulated.
  recordDecisionContact(base.farmer_id, id, status, input.decision, input.volume_m3);
  return routes.decideRequest.response.parse({ ...base, status, coordinator_decision: decision });
}

/** The contact a decision queues for the farmer, remembered for the phone screen. */
function recordDecisionContact(
  farmerId: string,
  requestId: string,
  status: "approved" | "rejected",
  decision: "approve" | "reject",
  volumeM3: number,
): void {
  state.decisionContacts.push({
    contact_id: `ct-decision-${state.decisionContacts.length + 1}`,
    farmer_id: farmerId,
    request_id: requestId,
    status,
    decision,
    volume_m3: volumeM3,
    at: mockNow(),
  });
}

function mockBalances() {
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
        reason: "Season reserve for the shared pool.",
        event_id: "ev-mock-season",
      },
      ...balances.farmers
        .filter((f) => f.quota_m3 > 0)
        .map((f, i) => ({
          id: `le-mock-q${i + 1}`,
          at: MOCK_NOW,
          from: "canal_supply" as const,
          to: `farmer:${f.farmer_id}:quota` as const,
          volume_m3: f.quota_m3,
          reason: "Season quota set.",
          event_id: "ev-mock-season",
        })),
    ],
    balances,
  });
}

export function mockEvents() {
  const head = scenario.farmers[0];
  if (!head) throw new Error("mock fixture has no farmers");
  const actor = { kind: "coordinator" as const, id: "coord-1" };
  const common = { at: MOCK_NOW, canal_id: scenario.canal.id };
  const events = [
    {
      ...common,
      id: "ev-mock-1",
      actor,
      type: "farmer.registered" as const,
      farmer: head,
      plots: plotsOfFarmer(head.id),
      crop_plans: cropPlansOfFarmer(head.id),
    },
    { ...common, id: "ev-mock-2", actor, type: "release_window.announced" as const, window: firstWindow() },
    {
      ...common,
      id: "ev-mock-3",
      actor: { kind: "agent" as const, id: "scheduler" },
      type: "roster.proposed" as const,
      roster: mockProposeRoster({ release_window_id: firstWindow().id, mode: "equal_water" }).roster,
    },
    ...state.registered.map((r, i) => ({
      ...common,
      id: `ev-mock-reg-${i + 1}`,
      actor: { kind: "farmer" as const, id: r.farmer.id },
      type: "farmer.registered" as const,
      farmer: r.farmer,
      plots: r.plots,
      crop_plans: r.crop_plans,
    })),
    ...state.raised.map((request) => ({
      ...common,
      at: request.raised_at,
      id: `ev-${request.id}-raised`,
      actor: { kind: "farmer" as const, id: request.farmer_id },
      type: "request.raised" as const,
      request,
    })),
    ...[...state.decided.entries()].map(([id, d]) => ({
      ...common,
      at: d.at,
      id: `ev-${id}-decided`,
      actor,
      type: "request.decided" as const,
      request_id: id,
      decision: d.decision,
      volume_m3: d.volume_m3,
      note: d.note,
    })),
    ...[...state.approvedRosters].map((rosterId) => ({
      ...common,
      at: mockNow(),
      id: `ev-${rosterId}-approved`,
      actor,
      type: "roster.approved" as const,
      roster_id: rosterId,
    })),
  ];
  return routes.events.response.parse(events);
}

function outletNumber(outletName: string): string {
  return /(\d+)/.exec(outletName)?.[1] ?? outletName;
}

/** Turn time and outlet for one farmer in the first release window, as short sentences in both languages. */
function turnSentences(farmerId: string): { en: string; te: string } {
  const { roster } = mockProposeRoster({ release_window_id: firstWindow().id, mode: "equal_water" });
  const turn = roster.turns.find((t) => t.farmer_id === farmerId);
  const outlet = scenario.outlets.find((o) => o.id === turn?.outlet_id);
  if (!turn || !outlet) {
    return { en: "Your water turn has changed. Please check your new time.", te: "మీ నీటి వంతు మారింది. కొత్త సమయం చూడండి." };
  }
  return {
    en: `Your next water turn is ${formatRange(turn.start, turn.end, "en")} at ${outlet.name}.`,
    te: `మీ తదుపరి నీటి వంతు ${formatRange(turn.start, turn.end, "te")}, ఔట్‌లెట్ ${outletNumber(outlet.name)}.`,
  };
}

function nightSentences(): { en: string; te: string } {
  const win = scenario.release_windows[1] ?? firstWindow();
  return {
    en: `Night release: water starts ${formatDateTime(win.start, "en")}. Please be at your field.`,
    te: `రాత్రి నీటి విడుదల: ${formatDateTime(win.start, "te")} కు నీరు మొదలవుతుంది. పొలం దగ్గర ఉండండి.`,
  };
}

function farmerNameOf(farmerId: string): string {
  return (
    scenario.farmers.find((f) => f.id === farmerId)?.name ??
    state.registered.find((entry) => entry.farmer.id === farmerId)?.farmer.name ??
    "Farmer"
  );
}

/**
 * The allocation half of what the agent says on a call, in both languages, when
 * the alert carries one. The volume and the window are read from the alert as
 * the coordinator sent them; nothing is derived here.
 */
function allocationSentences(allocation: Allocation): { en: string; te: string } {
  const m3 = Math.round(allocation.volume_m3);
  return {
    en: `You have been given ${m3} cubic metres. Use it between ${formatRange(allocation.start, allocation.end, "en")}.`,
    te: `మీకు ${m3} ఘన మీటర్లు మంజూరు అయ్యాయి. ${formatRange(allocation.start, allocation.end, "te")} మధ్య వాడుకోండి.`,
  };
}

/** What the agent says on an alert call, in both languages, by severity. */
function alertSentences(alert: MockAlert): { en: string; te: string } {
  const name = farmerNameOf(alert.farmer_id);
  const base = severitySentence(name, alert.severity);
  if (!alert.allocation) return base;
  const alloc = allocationSentences(alert.allocation);
  return { en: `${base.en} ${alloc.en}`, te: `${base.te} ${alloc.te}` };
}

function severitySentence(name: string, severity: AlertSeverity): { en: string; te: string } {
  switch (severity) {
    case "emergency":
      return {
        en: `${name}, this is Jadal. This is an emergency. Follow the canal office instructions right away.`,
        te: `${name} గారు, జాదల్ నుండి మాట్లాడుతున్నాను. ఇది అత్యవసర పరిస్థితి. కాలువ కార్యాలయం సూచనలు వెంటనే పాటించండి.`,
      };
    case "urgent":
      return {
        en: `${name}, this is Jadal. Your urgent request has reached the committee. We will call again with your turn time.`,
        te: `${name} గారు, జాదల్ నుండి మాట్లాడుతున్నాను. మీ అత్యవసర అభ్యర్థన కమిటీకి చేరింది. మీ వంతు సమయం త్వరలో మళ్లీ తెలియజేస్తాము.`,
      };
    case "warning":
      return {
        en: `${name}, this is Jadal. Please check your field: the release may change.`,
        te: `${name} గారు, జాదల్ నుండి మాట్లాడుతున్నాను. మీ పొలం చూసుకోండి: నీటి విడుదల మారవచ్చు.`,
      };
    default:
      return {
        en: `${name}, this is Jadal with a routine notice. No action is needed.`,
        te: `${name} గారు, జాదల్ నుండి ఒక సాధారణ సూచన. ఏమీ చేయాల్సిన అవసరం లేదు.`,
      };
  }
}

/** How an alert severity reads in the audit findings. */
const ALERT_FINDING_SEVERITY: Record<AlertSeverity, "info" | "warn" | "critical"> = {
  info: "info",
  warning: "warn",
  urgent: "critical",
  emergency: "critical",
};

export function mockContacts() {
  const night = nightSentences();
  const list = scenario.farmers.flatMap((f) => {
    const turn = turnSentences(f.id);
    const base = { farmer_id: f.id, status: "queued" as const, attempt: 1, at: MOCK_NOW };
    return [
      { ...base, id: `ct-${f.id}`, channel: "voice" as const, purpose: "roster_change" as const, message_te: turn.te, message_en: turn.en },
      ...(f.has_smartphone
        ? [
            { ...base, id: `ct-${f.id}-wa`, channel: "whatsapp" as const, purpose: "roster_change" as const, message_te: turn.te, message_en: turn.en },
            { ...base, id: `ct-${f.id}-night`, channel: "whatsapp" as const, purpose: "release_warning" as const, message_te: night.te, message_en: night.en },
          ]
        : []),
      { ...base, id: `ct-${f.id}-warn`, channel: "voice" as const, purpose: "release_warning" as const, message_te: night.te, message_en: night.en },
    ];
  });
  // Alerts sent this session show up as contacts too, so the phone screen can
  // play the agent's reply for them.
  const alertContacts = state.alerts.map((alert) => {
    const said = alertSentences(alert);
    return {
      id: alert.contact_id,
      farmer_id: alert.farmer_id,
      channel: alert.channel === "call" ? ("voice" as const) : alert.channel,
      purpose: "request_update" as const,
      status: "queued" as const,
      attempt: 1,
      message_te: said.te,
      message_en: said.en,
      at: alert.at,
    };
  });
  // A decision on a request queues its own call to the farmer.
  const decisionCalls = state.decisionContacts.map((entry) => {
    const said = decisionSentences(entry);
    return {
      id: entry.contact_id,
      farmer_id: entry.farmer_id,
      channel: "voice" as const,
      purpose: "request_update" as const,
      status: "queued" as const,
      attempt: 1,
      message_te: said.te,
      message_en: said.en,
      at: entry.at,
    };
  });
  return routes.contacts.response.parse([...alertContacts, ...decisionCalls, ...list]);
}

/** What the agent says when a decision is called through to the farmer. */
function decisionSentences(entry: MockDecisionContact): { en: string; te: string } {
  const name = farmerNameOf(entry.farmer_id);
  const m3 = Math.round(entry.volume_m3);
  if (entry.decision === "approve") {
    return {
      en: `${name}, this is Jadal. The committee approved ${m3} cubic metres for you.`,
      te: `${name} గారు, జాదల్ నుండి మాట్లాడుతున్నాను. కమిటీ మీకు ${m3} ఘన మీటర్లు ఆమోదించింది.`,
    };
  }
  return {
    en: `${name}, this is Jadal. The committee could not approve extra water this time.`,
    te: `${name} గారు, జాదల్ నుండి మాట్లాడుతున్నాను. ఈసారి అదనపు నీరు ఆమోదించలేకపోయింది.`,
  };
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
    message_te: "మీ అభ్యర్థనపై కమిటీ స్పందన వచ్చింది.",
    message_en: "The committee has answered your request.",
    at: MOCK_NOW,
  };
}

export function mockPhoneReply(contactId: string, body: z.input<typeof routes.phoneReply.body>) {
  const input = routes.phoneReply.body.parse(body);
  const contact = { ...mockContactById(contactId), status: "acknowledged" as const, transcript: input.text ?? "Voice reply" };
  const alert = state.alerts.find((entry) => entry.contact_id === contactId);
  const said = alert
    ? alertSentences(alert)
    : { te: "ధన్యవాదాలు. మీ వంతు ఖరారైంది.", en: "Thank you. Your turn is confirmed." };
  return routes.phoneReply.response.parse({
    contact,
    agent_reply_te: said.te,
    agent_reply_en: said.en,
  });
}

export function mockIntake(body: z.input<typeof routes.intake.body>) {
  const input = routes.intake.body.parse(body);
  const text = input.text ?? "నీరు కావాలి";
  const urgent = /నీరు|water|urgent|extra/i.test(text);
  let request: WaterRequestT | undefined;
  if (urgent) {
    request = {
      id: `req-new-${state.nextId++}`,
      farmer_id: input.farmer_id,
      type: "urgent",
      volume_m3: MOCK_URGENT_VOLUME_M3,
      reason: text,
      channel: "voice",
      status: "raised",
      raised_at: mockNow(),
      triage_score: 0.85,
      agent_recommendation: {
        decision: "partial",
        volume_m3: MOCK_URGENT_GRANT_M3,
        rationale: "This crop is at a sensitive stage. A partial grant helps now and keeps the shared pool healthy.",
      },
    };
    state.raised.push(request);
  }
  return routes.intake.response.parse({
    transcript_te: text,
    intent: urgent ? "urgent_request" : "schedule_question",
    urgency: urgent ? 0.85 : 0.3,
    request,
  });
}

export function mockAudit() {
  return routes.audit.response.parse({
    balances: mockBalances(),
    findings: [
      ...(state.turnEdits.size > 0 ? [{ severity: "info" as const, text: MOCK_SCHEDULE_CHANGE_TEXT }] : []),
      ...state.alerts.map((alert) => ({
        severity: ALERT_FINDING_SEVERITY[alert.severity],
        text: `Alert queued for ${farmerNameOf(alert.farmer_id)} by ${alert.channel}; ${alert.severity} level.`,
      })),
      { severity: "info", text: "The books balance: every cubic metre of canal water is accounted for." },
      { severity: "warn", text: "Farms at the tail end get far less water than farms at the head when turns are the same length. Equal water fixes this." },
    ],
    summary_en: "The books balance. Sharing by water volume instead of hours gives tail-end farms a fair share.",
    summary_te: "లెక్కలు సరిపోయాయి. గంటల బదులు నీటి పరిమాణం ప్రకారం పంచితే చివరి పొలాలకు న్యాయమైన వాటా దక్కుతుంది.",
  });
}

export function mockDemoReset() {
  state = freshState();
  return routes.demoReset.response.parse({ ok: true });
}

export function mockDemoAdvance(body: z.input<typeof routes.demoAdvance.body>) {
  const input = routes.demoAdvance.body.parse(body);
  state.clockHours += input.hours;
  return routes.demoAdvance.response.parse({ now: mockNow() });
}
