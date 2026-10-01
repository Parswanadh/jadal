/**
 * C7 Demo mode — tiny API client for the guided walkthrough.
 *
 * Talks to the real backend (`/api/*`, see `packages/contracts/src/api.ts`)
 * when it is reachable; falls back to deterministic offline mock data so the
 * demo still runs start -> finish in < 4 min before Task B lands.
 */

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  /** True when the response is a local mock (backend unreachable). */
  mocked: boolean;
}

export interface DemoEvent {
  id: string;
  at: string;
  type: string;
  canal_id?: string;
  summaryEn: string;
  summaryTe: string;
}

export interface CompareResult {
  equalHoursGini: number;
  equalWaterGini: number;
  tailBeforePct: number;
  tailAfterPct: number;
}

export interface AuditResult {
  conservationOk: boolean;
  giniBefore: number;
  giniAfter: number;
  summaryEn: string;
  summaryTe: string;
}

async function postJson<T>(path: string, body: unknown, mock: () => T): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as T;
    return { ok: true, data, mocked: false };
  } catch (err) {
    return { ok: true, data: mock(), mocked: true, error: err instanceof Error ? err.message : String(err) };
  }
}

async function getJson<T>(path: string, mock: () => T): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as T;
    return { ok: true, data, mocked: false };
  } catch (err) {
    return { ok: true, data: mock(), mocked: true, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Demo controls (contracts: demoReset, demoAdvance, events)
// ---------------------------------------------------------------------------

export function demoReset(): Promise<ApiResult<{ ok: boolean }>> {
  return postJson("/api/demo/reset", {}, () => ({ ok: true }));
}

export function demoAdvance(hours: number): Promise<ApiResult<{ now: string }>> {
  return postJson("/api/demo/advance", { hours }, () => ({
    now: new Date(Date.now() + hours * 3600_000).toISOString(),
  }));
}

let mockEventSeq = 0;
function mockEvent(type: string, en: string, te: string): DemoEvent {
  mockEventSeq += 1;
  return {
    id: `mock-${mockEventSeq}`,
    at: new Date().toISOString(),
    type,
    canal_id: "c1",
    summaryEn: en,
    summaryTe: te,
  };
}

export function fetchEvents(fallback: DemoEvent[]): Promise<ApiResult<DemoEvent[]>> {
  return getJson<DemoEvent[]>("/api/events", () => fallback);
}

// ---------------------------------------------------------------------------
// Per-step actions. Each returns mock content shaped for the demo UI.
// ---------------------------------------------------------------------------

export function compareRosters(): Promise<ApiResult<CompareResult>> {
  return postJson(
    "/api/rosters/propose",
    { release_window_id: "rw1", mode: "equal_water" },
    () => ({
      // ASSUMED illustrative values matching the seed narrative: tail o7/o8
      // rise from ~45% to >90% need met under equal-water.
      equalHoursGini: 0.31,
      equalWaterGini: 0.12,
      tailBeforePct: 45,
      tailAfterPct: 93,
    }),
  );
}

export interface UrgentRequestResult {
  requestId: string;
  transcriptTe: string;
  recommendation: string;
  decision: string;
}

export function raiseUrgentRequest(): Promise<ApiResult<UrgentRequestResult>> {
  return postJson("/api/intake", { farmer_id: "f1", text: "నాకు అత్యవసరంగా నీరు కావాలి, వరి పూత దశలో ఉంది" }, () => ({
    requestId: "req-f1-urgent",
    transcriptTe: "నాకు అత్యవసరంగా నీరు కావాలి, వరి పూత దశలో ఉంది",
    recommendation: "partial approval (60% of asked volume) — flowering-stage rice, head reach",
    decision: "approved (partial), deducted from f1 future quota",
  }));
}

export interface NotifyResult {
  callsPlaced: number;
  voiceOnly: string[];
  whatsapp: string[];
}

export function replanAndNotify(): Promise<ApiResult<NotifyResult>> {
  return postJson("/api/rosters/rw1/approve", {}, () => ({
    callsPlaced: 8,
    voiceOnly: ["f5 (Anjamma Bandi)", "f8 (Narasimha Chinta)"],
    whatsapp: ["f1", "f2", "f3", "f4", "f6", "f7"],
  }));
}

export interface NightProtocolResult {
  windowId: string;
  startsAtIst: string;
  warningsSent: number;
}

export function fireNightProtocol(): Promise<ApiResult<NightProtocolResult>> {
  return postJson("/api/demo/advance", { hours: 1 }, () => ({
    windowId: "rw2",
    startsAtIst: "19:00 IST",
    warningsSent: 8,
  }));
}

export interface BufferResult {
  releasedM3: number;
  requester: string;
}

export function releaseToBuffer(): Promise<ApiResult<BufferResult>> {
  return postJson("/api/requests", { farmer_id: "f7", type: "buffer", volume_m3: 400, reason: "buffer request", channel: "portal" }, () => ({
    // ASSUMED illustrative volume for the demo narrative.
    releasedM3: 1250,
    requester: "f7 (Padmavathi Kolli)",
  }));
}

export function fetchAudit(): Promise<ApiResult<AuditResult>> {
  return getJson("/api/audit", () => ({
    conservationOk: true,
    giniBefore: 0.31,
    giniAfter: 0.12,
    summaryEn: "Conservation holds. Fairness improved: Gini 0.31 → 0.12.",
    summaryTe: "పరిరక్షణ నిలిచింది. న్యాయం మెరుగైంది: గినీ 0.31 → 0.12.",
  }));
}

export { mockEvent };
