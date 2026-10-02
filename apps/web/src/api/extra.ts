// Shapes for the two endpoints the coordinator tools call that are not part of
// the frozen contract in packages/contracts:
//
//   PATCH /api/rosters/:id/turns/:turnId  body {start, end}
//   POST  /api/alerts                     body {farmer_id, channel, severity, message?, allocation?}
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

/**
 * The water and the window the farmer should use it in, as the API reports
 * them. Frozen shape (see the lane brief): the UI never derives either value —
 * it only passes on what the approved request or the farmer's turn returned.
 */
export const allocationSchema = z.object({
  volume_m3: z.number().nonnegative(),
  start: z.string(),
  end: z.string(),
});

export const alertBodySchema = z.object({
  farmer_id: z.string().min(1),
  channel: alertChannelSchema,
  severity: alertSeveritySchema,
  message: z.string().optional(),
  allocation: allocationSchema.optional(),
});

export const alertResponseSchema = z.object({
  ok: z.literal(true),
  contact_id: z.string(),
  simulated: z.boolean(),
  detail: z.string(),
  /**
   * The handset the API actually rang, or null/absent when no call was placed.
   *
   * Optional because `detail` always carries the same fact in prose and older
   * responses omit the field; the UI prefers `dialled` and falls back to the
   * neutral "no call was placed" line rather than guessing a destination.
   */
  dialled: z.string().nullable().optional(),
});

export type TurnTime = z.infer<typeof turnTimeSchema>;
export type UpdateTurnBody = { start: string; end: string };
export type UpdateTurnResponse = z.infer<typeof updateTurnResponseSchema>;
export type AlertChannel = z.infer<typeof alertChannelSchema>;
export type AlertSeverity = z.infer<typeof alertSeveritySchema>;
export type Allocation = z.infer<typeof allocationSchema>;
export type AlertBody = z.input<typeof alertBodySchema>;
export type AlertResponse = z.infer<typeof alertResponseSchema>;
