// Shapes for the two endpoints the coordinator tools call that are not part of
// the frozen contract in packages/contracts:
//
//   PATCH /api/rosters/:id/turns/:turnId  body {start, end}
//   POST  /api/alerts                     body {farmer_id, channel, message?}
//
// Both the live client (client.ts) and the in-browser mock (mock.ts) validate
// against these schemas, so mock mode and live mode answer the same shape.

import { z } from "zod";

/** A roster turn as the API returns it. */
export const turnTimeSchema = z.object({
  id: z.string(),
  roster_id: z.string(),
  outlet_id: z.string(),
  farmer_id: z.string(),
  start: z.string(),
  end: z.string(),
  planned_volume_m3: z.number(),
  expected_flow_m3s: z.number(),
  lag_h: z.number(),
});

export const updateTurnResponseSchema = z.object({
  ok: z.literal(true),
  turn: turnTimeSchema,
});

export const alertChannelSchema = z.enum(["call", "sms", "whatsapp"]);

/** How loud the alert is, from a routine notice to an emergency. */
export const alertSeveritySchema = z.enum(["info", "warning", "urgent", "emergency"]);

export const alertBodySchema = z.object({
  farmer_id: z.string().min(1),
  channel: alertChannelSchema,
  severity: alertSeveritySchema,
  message: z.string().optional(),
});

export const alertResponseSchema = z.object({
  ok: z.literal(true),
  contact_id: z.string(),
  simulated: z.boolean(),
  detail: z.string(),
});

export type TurnTime = z.infer<typeof turnTimeSchema>;
export type UpdateTurnBody = { start: string; end: string };
export type UpdateTurnResponse = z.infer<typeof updateTurnResponseSchema>;
export type AlertChannel = z.infer<typeof alertChannelSchema>;
export type AlertSeverity = z.infer<typeof alertSeveritySchema>;
export type AlertBody = z.input<typeof alertBodySchema>;
export type AlertResponse = z.infer<typeof alertResponseSchema>;
