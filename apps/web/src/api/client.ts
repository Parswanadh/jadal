// Typed API client for the Jadal frontend (Task C2).
//
// One exported function per entry in `routes` (packages/contracts/src/api.ts).
// Request bodies and responses are typed from the contract zod schemas, and
// every response — mock or live — is validated with its contract schema.
//
// Mode switching (one-line env change, no code edits):
//   VITE_MOCK=1 (default)  -> responses are built locally from
//                             packages/contracts/fixtures/*.json (see mock.ts).
//   VITE_MOCK=0 + VITE_API_BASE=http://localhost:8787
//                          -> calls the real backend over HTTP.

import { ApiError, routes } from "@jadal/contracts";
import { z } from "zod";
import type { ZodTypeAny } from "zod";
import {
  alertResponseSchema,
  updateTurnResponseSchema,
} from "./extra";
import type { AlertBody, AlertResponse, UpdateTurnBody, UpdateTurnResponse } from "./extra";
import { ApiClientError } from "./errors";
import {
  mockApproveEntitlements,
  mockApproveRoster,
  mockAudit,
  mockCanal,
  mockContacts,
  mockDecideRequest,
  mockDemoAdvance,
  mockDemoReset,
  mockEvents,
  mockHealth,
  mockIntake,
  mockLedger,
  mockListFarmers,
  mockListRequests,
  mockPhoneReply,
  mockProposeRoster,
  mockRaiseRequest,
  mockRegister,
  mockReleaseWindows,
  mockSendAlert,
  mockSuggestEntitlements,
  mockUpdateTurn,
  mockVerifyFarmer,
} from "./mock";

export { ApiClientError } from "./errors";


export type RouteKey = keyof typeof routes;

// Response types, one per route.
export type HealthResponse = z.infer<typeof routes.health.response>;
export type CanalResponse = z.infer<typeof routes.canal.response>;
export type RegisterResponse = z.infer<typeof routes.register.response>;
export type ListFarmersResponse = z.infer<typeof routes.listFarmers.response>;
export type VerifyFarmerResponse = z.infer<typeof routes.verifyFarmer.response>;
export type SuggestEntitlementsResponse = z.infer<typeof routes.suggestEntitlements.response>;
export type ApproveEntitlementsResponse = z.infer<typeof routes.approveEntitlements.response>;
export type ReleaseWindowsResponse = z.infer<typeof routes.releaseWindows.response>;
export type ProposeRosterResponse = z.infer<typeof routes.proposeRoster.response>;
export type ApproveRosterResponse = z.infer<typeof routes.approveRoster.response>;
export type RaiseRequestResponse = z.infer<typeof routes.raiseRequest.response>;
export type ListRequestsResponse = z.infer<typeof routes.listRequests.response>;
export type DecideRequestResponse = z.infer<typeof routes.decideRequest.response>;
export type LedgerResponse = z.infer<typeof routes.ledger.response>;
export type EventsResponse = z.infer<typeof routes.events.response>;
export type ContactsResponse = z.infer<typeof routes.contacts.response>;
export type PhoneReplyResponse = z.infer<typeof routes.phoneReply.response>;
export type IntakeResponse = z.infer<typeof routes.intake.response>;
export type AuditResponse = z.infer<typeof routes.audit.response>;
export type DemoResetResponse = z.infer<typeof routes.demoReset.response>;
export type DemoAdvanceResponse = z.infer<typeof routes.demoAdvance.response>;

// Request body types, one per route that takes a body.
export type RegisterBody = z.input<typeof routes.register.body>;
export type SuggestEntitlementsBody = z.input<typeof routes.suggestEntitlements.body>;
export type ApproveEntitlementsBody = z.input<typeof routes.approveEntitlements.body>;
export type ProposeRosterBody = z.input<typeof routes.proposeRoster.body>;
export type RaiseRequestBody = z.input<typeof routes.raiseRequest.body>;
export type DecideRequestBody = z.input<typeof routes.decideRequest.body>;
export type PhoneReplyBody = z.input<typeof routes.phoneReply.body>;
export type IntakeBody = z.input<typeof routes.intake.body>;
export type DemoAdvanceBody = z.input<typeof routes.demoAdvance.body>;

/** Mock mode unless explicitly disabled. Unset VITE_MOCK also means mock, so the demo works with no backend. */
export function isMockMode(): boolean {
  return import.meta.env.VITE_MOCK !== "0";
}

/** Base URL of the real API (e.g. http://localhost:8787). Empty string = same origin (vite dev proxy). */
export function apiBaseUrl(): string {
  return (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");
}

function fillPath(path: string, params: Record<string, string>): string {
  let out = path;
  for (const [key, value] of Object.entries(params)) {
    out = out.replace(`:${key}`, encodeURIComponent(value));
  }
  return out;
}

async function request<T>(path: string, method: string, schema: ZodTypeAny, body?: unknown): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ApiError.safeParse(json);
    throw new ApiClientError(
      res.status,
      parsed.success ? parsed.data.error.message : `HTTP ${res.status}`,
      parsed.success ? parsed.data.error.code : undefined,
    );
  }
  return schema.parse(json) as T;
}

async function http<T>(key: RouteKey, path: string, method: string, body?: unknown): Promise<T> {
  return request<T>(path, method, routes[key].response as unknown as ZodTypeAny, body);
}

export function health(): Promise<HealthResponse> {
  if (isMockMode()) return Promise.resolve(mockHealth());
  return http<HealthResponse>("health", routes.health.path, "GET");
}

export function canal(): Promise<CanalResponse> {
  if (isMockMode()) return Promise.resolve(mockCanal());
  return http<CanalResponse>("canal", routes.canal.path, "GET");
}

export function register(body: RegisterBody): Promise<RegisterResponse> {
  if (isMockMode()) return Promise.resolve(mockRegister(body));
  return http<RegisterResponse>("register", routes.register.path, "POST", body);
}

export function listFarmers(): Promise<ListFarmersResponse> {
  if (isMockMode()) return Promise.resolve(mockListFarmers());
  return http<ListFarmersResponse>("listFarmers", routes.listFarmers.path, "GET");
}

export function verifyFarmer(id: string): Promise<VerifyFarmerResponse> {
  if (isMockMode()) return Promise.resolve(mockVerifyFarmer(id));
  return http<VerifyFarmerResponse>("verifyFarmer", fillPath(routes.verifyFarmer.path, { id }), "POST", {});
}

export function suggestEntitlements(body: SuggestEntitlementsBody = {}): Promise<SuggestEntitlementsResponse> {
  if (isMockMode()) return Promise.resolve(mockSuggestEntitlements(body));
  return http<SuggestEntitlementsResponse>("suggestEntitlements", routes.suggestEntitlements.path, "POST", body);
}

export function approveEntitlements(body: ApproveEntitlementsBody = {}): Promise<ApproveEntitlementsResponse> {
  if (isMockMode()) return Promise.resolve(mockApproveEntitlements(body));
  return http<ApproveEntitlementsResponse>("approveEntitlements", routes.approveEntitlements.path, "POST", body);
}

export function releaseWindows(): Promise<ReleaseWindowsResponse> {
  if (isMockMode()) return Promise.resolve(mockReleaseWindows());
  return http<ReleaseWindowsResponse>("releaseWindows", routes.releaseWindows.path, "GET");
}

export function proposeRoster(body: ProposeRosterBody): Promise<ProposeRosterResponse> {
  if (isMockMode()) return Promise.resolve(mockProposeRoster(body));
  return http<ProposeRosterResponse>("proposeRoster", routes.proposeRoster.path, "POST", body);
}

export function approveRoster(id: string): Promise<ApproveRosterResponse> {
  if (isMockMode()) return Promise.resolve(mockApproveRoster(id));
  return http<ApproveRosterResponse>("approveRoster", fillPath(routes.approveRoster.path, { id }), "POST", {});
}

export function raiseRequest(body: RaiseRequestBody): Promise<RaiseRequestResponse> {
  if (isMockMode()) return Promise.resolve(mockRaiseRequest(body));
  return http<RaiseRequestResponse>("raiseRequest", routes.raiseRequest.path, "POST", body);
}

export function listRequests(): Promise<ListRequestsResponse> {
  if (isMockMode()) return Promise.resolve(mockListRequests());
  return http<ListRequestsResponse>("listRequests", routes.listRequests.path, "GET");
}

export function decideRequest(id: string, body: DecideRequestBody): Promise<DecideRequestResponse> {
  if (isMockMode()) return Promise.resolve(mockDecideRequest(id, body));
  return http<DecideRequestResponse>("decideRequest", fillPath(routes.decideRequest.path, { id }), "POST", body);
}

export function ledger(): Promise<LedgerResponse> {
  if (isMockMode()) return Promise.resolve(mockLedger());
  return http<LedgerResponse>("ledger", routes.ledger.path, "GET");
}

export function events(): Promise<EventsResponse> {
  if (isMockMode()) return Promise.resolve(mockEvents());
  return http<EventsResponse>("events", routes.events.path, "GET");
}

export function contacts(): Promise<ContactsResponse> {
  if (isMockMode()) return Promise.resolve(mockContacts());
  return http<ContactsResponse>("contacts", routes.contacts.path, "GET");
}

export function phoneReply(contactId: string, body: PhoneReplyBody): Promise<PhoneReplyResponse> {
  if (isMockMode()) return Promise.resolve(mockPhoneReply(contactId, body));
  return http<PhoneReplyResponse>("phoneReply", fillPath(routes.phoneReply.path, { contactId }), "POST", body);
}

export function intake(body: IntakeBody): Promise<IntakeResponse> {
  if (isMockMode()) return Promise.resolve(mockIntake(body));
  return http<IntakeResponse>("intake", routes.intake.path, "POST", body);
}

export function audit(): Promise<AuditResponse> {
  if (isMockMode()) return Promise.resolve(mockAudit());
  return http<AuditResponse>("audit", routes.audit.path, "GET");
}

export function demoReset(): Promise<DemoResetResponse> {
  if (isMockMode()) return Promise.resolve(mockDemoReset());
  return http<DemoResetResponse>("demoReset", routes.demoReset.path, "POST", {});
}

export function demoAdvance(body: DemoAdvanceBody): Promise<DemoAdvanceResponse> {
  if (isMockMode()) return Promise.resolve(mockDemoAdvance(body));
  return http<DemoAdvanceResponse>("demoAdvance", routes.demoAdvance.path, "POST", body);
}

// --- Coordinator tools: endpoints outside the frozen contract -----------------
// Deliberately not part of `api` above: that object is pinned to the contract's
// route keys by api/client.test.ts.

/**
 * Set one turn's start and end time.
 * PATCH /api/rosters/:id/turns/:turnId -> { ok: true, turn }
 */
export function updateTurn(rosterId: string, turnId: string, body: UpdateTurnBody): Promise<UpdateTurnResponse> {
  if (isMockMode()) return mockUpdateTurn(rosterId, turnId, body);
  const path = `/api/rosters/${encodeURIComponent(rosterId)}/turns/${encodeURIComponent(turnId)}`;
  return request<UpdateTurnResponse>(path, "PATCH", updateTurnResponseSchema, body);
}

/**
 * The same route under the contract's own name (`routes.setTurnTime`).
 *
 * `updateTurn` reads better at the call site, but the contract — and the tests
 * that pin one function per route key — call it `setTurnTime`. Both names are
 * the same PATCH, so neither can drift from the other.
 */
export const setTurnTime = updateTurn;

/**
 * Alert one farmer by call, SMS or WhatsApp.
 * POST /api/alerts -> { ok, contact_id, simulated, detail }
 */
export function sendAlert(body: AlertBody): Promise<AlertResponse> {
  if (isMockMode()) return mockSendAlert(body);
  return request<AlertResponse>("/api/alerts", "POST", alertResponseSchema, body);
}

/** All client functions in one object, keyed exactly by route name. */
export const api = {
  health,
  canal,
  register,
  listFarmers,
  verifyFarmer,
  suggestEntitlements,
  approveEntitlements,
  releaseWindows,
  proposeRoster,
  approveRoster,
  raiseRequest,
  listRequests,
  decideRequest,
  setTurnTime,
  ledger,
  events,
  contacts,
  phoneReply,
  intake,
  audit,
  demoReset,
  demoAdvance,
};
