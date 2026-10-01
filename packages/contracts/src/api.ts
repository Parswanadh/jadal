import { z } from "zod";
import {
  Id,
  Canal,
  Outlet,
  Farmer,
  Plot,
  CropPlan,
  Entitlement,
  Roster,
  WaterRequest,
  LedgerEntry,
  Contact,
  ReleaseWindow,
  Channel,
  RequestType,
} from "./entities";
import { JadalEvent } from "./events";

// HTTP API served by apps/api under /api. All bodies are JSON. Errors: { error: { code, message } } with 4xx/5xx.
// The frontend (Task C) builds against these schemas using fixtures until the backend (Task B) lands.

export const ApiError = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

const BalancesView = z.object({
  canal_supply_m3: z.number(),
  buffer_m3: z.number(),
  conveyance_losses_m3: z.number(),
  farmers: z.array(
    z.object({ farmer_id: Id, name: z.string(), quota_m3: z.number(), delivered_m3: z.number(), need_met_pct: z.number() }),
  ),
  conservation_ok: z.boolean(),
  gini: z.number(),
});

export const routes = {
  health: { method: "GET", path: "/api/health", response: z.object({ ok: z.boolean(), version: z.string() }) },

  canal: {
    method: "GET",
    path: "/api/canal",
    response: z.object({ canal: Canal, outlets: z.array(Outlet) }),
  },

  register: {
    method: "POST",
    path: "/api/farmers",
    body: z.object({ farmer: Farmer.omit({ id: true }), plots: z.array(Plot.omit({ id: true, farmer_id: true })), crop_plans: z.array(CropPlan.omit({ id: true, plot_id: true, status: true }).extend({ plot_index: z.number().int().nonnegative() })) }),
    response: z.object({ farmer: Farmer, plots: z.array(Plot), crop_plans: z.array(CropPlan) }),
  },
  listFarmers: {
    method: "GET",
    path: "/api/farmers",
    response: z.array(z.object({ farmer: Farmer, plots: z.array(Plot), crop_plans: z.array(CropPlan), verified: z.boolean() })),
  },
  verifyFarmer: { method: "POST", path: "/api/farmers/:id/verify", body: z.object({}), response: z.object({ ok: z.boolean() }) },

  suggestEntitlements: {
    method: "POST",
    path: "/api/entitlements/suggest",
    body: z.object({ week_start: z.string().date().optional() }),
    response: z.object({ entitlements: z.array(Entitlement), season_total_m3: z.number(), explanation: z.string() }),
  },
  approveEntitlements: {
    method: "POST",
    path: "/api/entitlements/approve",
    body: z.object({ edits: z.array(z.object({ id: Id, volume_m3: z.number().nonnegative() })).default([]) }),
    response: z.object({ approved: z.number().int() }),
  },

  releaseWindows: { method: "GET", path: "/api/release-windows", response: z.array(ReleaseWindow) },
  proposeRoster: {
    method: "POST",
    path: "/api/rosters/propose",
    body: z.object({ release_window_id: Id, mode: z.enum(["equal_water", "equal_hours"]).default("equal_water") }),
    response: z.object({
      roster: Roster,
      need_met: z.array(z.object({ farmer_id: Id, outlet_id: Id, pct: z.number() })),
      comparison: z.object({ equal_hours_gini: z.number(), equal_water_gini: z.number() }),
    }),
  },
  approveRoster: { method: "POST", path: "/api/rosters/:id/approve", body: z.object({}), response: z.object({ ok: z.boolean(), contacts_queued: z.number().int() }) },

  raiseRequest: {
    method: "POST",
    path: "/api/requests",
    body: z.object({ farmer_id: Id, type: RequestType, volume_m3: z.number().nonnegative(), reason: z.string(), channel: Channel, crop_plan_id: Id.optional() }),
    response: WaterRequest,
  },
  listRequests: { method: "GET", path: "/api/requests", response: z.array(WaterRequest) },
  decideRequest: {
    method: "POST",
    path: "/api/requests/:id/decide",
    body: z.object({ decision: z.enum(["approve", "reject"]), volume_m3: z.number().nonnegative(), note: z.string().optional() }),
    response: WaterRequest,
  },

  ledger: { method: "GET", path: "/api/ledger", response: z.object({ entries: z.array(LedgerEntry), balances: BalancesView }) },
  events: { method: "GET", path: "/api/events", response: z.array(JadalEvent) },
  contacts: { method: "GET", path: "/api/contacts", response: z.array(Contact) },

  /** Simulated phone: the browser phone posts the farmer's reply (audio as base64 or typed text). */
  phoneReply: {
    method: "POST",
    path: "/api/phone/:contactId/reply",
    body: z.object({ text: z.string().optional(), audio_base64: z.string().optional(), mime: z.string().optional() }),
    response: z.object({ contact: Contact, agent_reply_te: z.string(), agent_reply_en: z.string(), audio_base64: z.string().optional() }),
  },
  /** Voice/text intake from a farmer (Telugu), used for urgent requests by phone. */
  intake: {
    method: "POST",
    path: "/api/intake",
    body: z.object({ farmer_id: Id, text: z.string().optional(), audio_base64: z.string().optional(), mime: z.string().optional() }),
    response: z.object({ transcript_te: z.string(), intent: z.string(), urgency: z.number(), request: WaterRequest.optional() }),
  },

  audit: {
    method: "GET",
    path: "/api/audit",
    response: z.object({ balances: BalancesView, findings: z.array(z.object({ severity: z.enum(["info", "warn", "critical"]), text: z.string() })), summary_en: z.string(), summary_te: z.string() }),
  },

  /** Demo controls: reset to the seed scenario, advance simulated time, replay events. */
  demoReset: { method: "POST", path: "/api/demo/reset", body: z.object({}), response: z.object({ ok: z.boolean() }) },
  demoAdvance: { method: "POST", path: "/api/demo/advance", body: z.object({ hours: z.number().positive() }), response: z.object({ now: z.string() }) },
} as const;

export type Routes = typeof routes;
