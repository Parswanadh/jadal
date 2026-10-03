import { z } from "zod";
import { ContactPurpose } from "./entities";

// Agent tool contracts. Every tool is a thin wrapper over packages/core or the database.
// LLM agents may only change state through tools; tools marked `gated` create a proposal that
// waits for coordinator approval instead of committing.

export const AgentName = z.enum(["orchestrator", "intake", "need", "scheduler", "request_assessor", "caller", "auditor"]);
export type AgentName = z.infer<typeof AgentName>;

export const toolSpecs = {
  crop_need: { agent: ["need"], gated: false, input: z.object({ crop_plan_id: z.string(), week_start: z.string() }) },
  weather_forecast: { agent: ["need"], gated: false, input: z.object({ lat: z.number(), lon: z.number(), days: z.number().int().max(16) }) },
  propose_entitlements: { agent: ["need"], gated: true, input: z.object({ week_start: z.string() }) },
  hydraulics: { agent: ["scheduler", "auditor"], gated: false, input: z.object({ head_discharge_m3s: z.number() }) },
  optimize_roster: { agent: ["scheduler"], gated: true, input: z.object({ release_window_id: z.string(), mode: z.enum(["equal_water", "equal_hours"]) }) },
  overrun_impact: { agent: ["scheduler", "auditor"], gated: false, input: z.object({ outlet_id: z.string(), overrun_h: z.number() }) },
  crop_stage_risk: { agent: ["request_assessor"], gated: false, input: z.object({ crop_plan_id: z.string() }) },
  quota_status: { agent: ["request_assessor"], gated: false, input: z.object({ farmer_id: z.string() }) },
  buffer_status: { agent: ["request_assessor"], gated: false, input: z.object({}) },
  recommend_decision: {
    agent: ["request_assessor"],
    gated: true,
    input: z.object({ request_id: z.string(), decision: z.enum(["approve", "reject", "partial"]), volume_m3: z.number(), rationale: z.string() }),
  },
  place_call: { agent: ["caller"], gated: true, input: z.object({ farmer_id: z.string(), purpose: ContactPurpose, message_te: z.string(), message_en: z.string() }) },
  send_whatsapp: { agent: ["caller"], gated: false, input: z.object({ farmer_id: z.string(), message_te: z.string(), message_en: z.string() }) },
  record_ack: { agent: ["caller"], gated: false, input: z.object({ contact_id: z.string(), acknowledged: z.boolean(), transcript: z.string() }) },
  ledger_invariants: { agent: ["auditor"], gated: false, input: z.object({}) },
  delivered_vs_planned: { agent: ["auditor"], gated: false, input: z.object({ roster_id: z.string().optional() }) },
} as const;

/** System-1 decisions (Jev via OpenRouter, Laya fallback, keyword rules last). Typed outputs only. */
export const System1Intent = z.enum(["urgent_request", "buffer_request", "not_needed_this_week", "harvested", "schedule_question", "acknowledge", "other"]);
export const System1Result = z.object({
  intent: System1Intent,
  intent_confidence: z.number().min(0).max(1),
  urgency: z.number().min(0).max(1),
  mentions_crop_stress: z.boolean(),
  source: z.enum(["jev", "laya", "rules"]),
});
export type System1Result = z.infer<typeof System1Result>;
