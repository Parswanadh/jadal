/**
 * Demo mode: guided walkthrough actions on top of the shared typed API client.
 *
 * Each step calls the real routes through `src/api` (live backend, or the
 * contract-validated mock when VITE_MOCK is not "0"). Every figure shown comes
 * from those responses. This module only picks rows and reshapes them.
 */

import { api, isMockMode } from "../api";

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  /** True when the response comes from the local mock (demo mode). */
  mocked: boolean;
}

/** One line in the event log. The screen turns it into a sentence in the active language. */
export interface DemoEvent {
  id: string;
  at: string;
  type: string;
  name?: string;
  m3?: number;
  approved?: boolean;
  startIso?: string;
  step?: number;
  hours?: number;
}

export interface AuditResult {
  conservationOk: boolean;
  giniBefore: number;
  giniAfter: number;
  summaryEn: string;
  summaryTe: string;
}

async function run<T>(fn: () => Promise<T>): Promise<ApiResult<T>> {
  try {
    return { ok: true, data: await fn(), mocked: isMockMode() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), mocked: isMockMode() };
  }
}

async function firstWindowId(index = 0): Promise<string> {
  const windows = await api.releaseWindows();
  const win = windows[index] ?? windows[0];
  if (!win) throw new Error("no release window");
  return win.id;
}

async function farmerNameMap(): Promise<Map<string, string>> {
  const list = await api.listFarmers();
  return new Map(list.map((r) => [r.farmer.id, r.farmer.name]));
}

// ---------------------------------------------------------------------------
// Demo controls (contracts: demoReset, demoAdvance, events)
// ---------------------------------------------------------------------------

export function demoReset(): Promise<ApiResult<{ ok: boolean }>> {
  return run(() => api.demoReset());
}

export function demoAdvance(hours: number): Promise<ApiResult<{ now: string }>> {
  return run(() => api.demoAdvance({ hours }));
}

let eventSeq = 0;
/** A marker the walkthrough adds to the log itself (not a server event). */
export function localEvent(type: string, at: string, extra: Partial<DemoEvent> = {}): DemoEvent {
  eventSeq += 1;
  return { id: `demo-${eventSeq}`, at, type, ...extra };
}

/** Server events mapped to log rows. */
export function fetchEvents(): Promise<ApiResult<DemoEvent[]>> {
  return run(async () => {
    const [list, names] = await Promise.all([api.events(), farmerNameMap()]);
    return list.map((e): DemoEvent => {
      const base = { id: e.id, at: e.at, type: e.type.replace(".", "_") };
      switch (e.type) {
        case "farmer.registered":
          return { ...base, name: e.farmer.name };
        case "registration.verified":
          return { ...base, name: names.get(e.farmer_id) };
        case "request.raised":
          return { ...base, name: names.get(e.request.farmer_id), m3: e.request.volume_m3 };
        case "request.decided":
          return { ...base, m3: e.volume_m3, approved: e.decision === "approve" };
        case "release_window.announced":
          return { ...base, startIso: e.window.start };
        case "week.released_to_buffer":
        case "crop.harvested":
          return { ...base, name: names.get(e.farmer_id) };
        default:
          return base;
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Per-step actions. Each returns the facts the screen shows as the outcome.
// ---------------------------------------------------------------------------

export interface CompareResult {
  equalHoursGini: number;
  equalWaterGini: number;
  tailBeforePct: number;
  tailAfterPct: number;
}

export function compareRosters(): Promise<ApiResult<CompareResult>> {
  return run(async () => {
    const windowId = await firstWindowId();
    const [hours, water] = await Promise.all([
      api.proposeRoster({ release_window_id: windowId, mode: "equal_hours" }),
      api.proposeRoster({ release_window_id: windowId, mode: "equal_water" }),
    ]);
    // need_met rows are ordered head to tail; the last row is the tail outlet.
    const tailBefore = hours.need_met[hours.need_met.length - 1];
    const tailAfter = water.need_met[water.need_met.length - 1];
    if (!tailBefore || !tailAfter) throw new Error("no need-met rows");
    return {
      equalHoursGini: hours.comparison.equal_hours_gini,
      equalWaterGini: water.comparison.equal_water_gini,
      tailBeforePct: tailBefore.pct,
      tailAfterPct: tailAfter.pct,
    };
  });
}

export interface UrgentRequestResult {
  farmerName: string;
  askedM3: number;
  grantedM3: number;
  approved: boolean;
}

export function raiseUrgentRequest(): Promise<ApiResult<UrgentRequestResult>> {
  return run(async () => {
    const farmerId = "f1";
    const [names, intake] = await Promise.all([
      farmerNameMap(),
      api.intake({ farmer_id: farmerId, text: "నాకు అత్యవసరంగా నీరు కావాలి, వరి పూత దశలో ఉంది" }),
    ]);
    const raised =
      intake.request ??
      (await api.raiseRequest({ farmer_id: farmerId, type: "urgent", volume_m3: 0, reason: intake.transcript_te, channel: "voice" }));
    const rec = raised.agent_recommendation;
    const decided = await api.decideRequest(raised.id, { decision: "approve", volume_m3: rec?.volume_m3 ?? raised.volume_m3 });
    return {
      farmerName: names.get(raised.farmer_id) ?? "",
      askedM3: raised.volume_m3,
      grantedM3: decided.coordinator_decision?.volume_m3 ?? 0,
      approved: decided.status === "approved",
    };
  });
}

export interface NotifyResult {
  callsPlaced: number;
  /** Farmers who only get a phone call. */
  voiceOnly: string[];
  /** Farmers who also get WhatsApp. */
  whatsapp: string[];
}

export function replanAndNotify(): Promise<ApiResult<NotifyResult>> {
  return run(async () => {
    const windowId = await firstWindowId();
    const { roster } = await api.proposeRoster({ release_window_id: windowId, mode: "equal_water" });
    const approved = await api.approveRoster(roster.id);
    const [contacts, names] = await Promise.all([api.contacts(), farmerNameMap()]);
    const withWhatsapp = new Set(contacts.filter((c) => c.channel === "whatsapp").map((c) => c.farmer_id));
    const callIds = [...new Set(contacts.filter((c) => c.channel === "voice").map((c) => c.farmer_id))];
    const label = (id: string) => names.get(id) ?? "";
    return {
      callsPlaced: approved.contacts_queued,
      voiceOnly: callIds.filter((id) => !withWhatsapp.has(id)).map(label),
      whatsapp: callIds.filter((id) => withWhatsapp.has(id)).map(label),
    };
  });
}

export interface NightProtocolResult {
  startsAt: string;
  farmersWarned: number;
}

export function fireNightProtocol(): Promise<ApiResult<NightProtocolResult>> {
  return run(async () => {
    await api.demoAdvance({ hours: 1 });
    const [windows, contacts] = await Promise.all([api.releaseWindows(), api.contacts()]);
    const win = windows[1] ?? windows[0];
    if (!win) throw new Error("no release window");
    const warned = new Set(contacts.filter((c) => c.purpose === "release_warning").map((c) => c.farmer_id));
    return { startsAt: win.start, farmersWarned: warned.size };
  });
}

export interface BufferResult {
  /** Pool volume reported by the ledger. */
  bufferM3: number;
  requester: string;
  /** Volume of the pool request raised for the requester. */
  requestedM3: number | null;
}

export function releaseToBuffer(reason: string): Promise<ApiResult<BufferResult>> {
  return run(async () => {
    const [ledger, requests, names] = await Promise.all([api.ledger(), api.listRequests(), farmerNameMap()]);
    // Farmer 7 asks the pool for the same amount as the pool request already on record.
    const existing = requests.find((r) => r.type === "buffer");
    let requestedM3: number | null = null;
    const requesterId = "f7";
    if (existing) {
      const raised = await api.raiseRequest({
        farmer_id: requesterId,
        type: "buffer",
        volume_m3: existing.volume_m3,
        reason,
        channel: "portal",
      });
      requestedM3 = raised.volume_m3;
    }
    return { bufferM3: ledger.balances.buffer_m3, requester: names.get(requesterId) ?? "", requestedM3 };
  });
}

export function fetchAudit(): Promise<ApiResult<AuditResult>> {
  return run(async () => {
    const [audit, windowId] = await Promise.all([api.audit(), firstWindowId()]);
    const water = await api.proposeRoster({ release_window_id: windowId, mode: "equal_water" });
    return {
      conservationOk: audit.balances.conservation_ok,
      giniBefore: water.comparison.equal_hours_gini,
      giniAfter: water.comparison.equal_water_gini,
      summaryEn: audit.summary_en,
      summaryTe: audit.summary_te,
    };
  });
}
