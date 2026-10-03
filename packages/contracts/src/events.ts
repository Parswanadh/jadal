import { z } from "zod";
import {
  Id,
  IsoTime,
  Farmer,
  Plot,
  CropPlan,
  Entitlement,
  Roster,
  WaterRequest,
  Contact,
  ReleaseWindow,
  RequestType,
} from "./entities";

// Append-only event log. The ledger, the audit trail and demo replay are all derived from these events.
// Every event carries who caused it: a person (coordinator/farmer), an agent, or the system clock.

const Actor = z.object({
  kind: z.enum(["coordinator", "farmer", "agent", "system"]),
  id: z.string(),
});

const base = { id: Id, at: IsoTime, canal_id: Id, actor: Actor };

export const JadalEvent = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("farmer.registered"), farmer: Farmer, plots: z.array(Plot), crop_plans: z.array(CropPlan) }),
  z.object({ ...base, type: z.literal("registration.verified"), farmer_id: Id }),
  z.object({ ...base, type: z.literal("season.approved"), season_supply_m3: z.number(), entitlements: z.array(Entitlement) }),
  z.object({ ...base, type: z.literal("entitlement.proposed"), entitlements: z.array(Entitlement) }),
  z.object({ ...base, type: z.literal("entitlement.approved"), entitlement_ids: z.array(Id) }),
  z.object({ ...base, type: z.literal("release_window.announced"), window: ReleaseWindow }),
  z.object({ ...base, type: z.literal("roster.proposed"), roster: Roster }),
  z.object({ ...base, type: z.literal("roster.approved"), roster_id: Id }),
  z.object({
    ...base,
    type: z.literal("turn.delivered"),
    turn_id: Id,
    farmer_id: Id,
    delivered_m3: z.number(),
    conveyance_loss_m3: z.number(),
    overrun_h: z.number().default(0),
  }),
  z.object({ ...base, type: z.literal("rain.replanned"), saved_m3: z.number(), by_farmer_m3: z.record(Id, z.number()) }),
  z.object({ ...base, type: z.literal("request.raised"), request: WaterRequest }),
  z.object({ ...base, type: z.literal("request.triaged"), request_id: Id, triage_score: z.number(), intent: z.string() }),
  z.object({
    ...base,
    type: z.literal("request.recommended"),
    request_id: Id,
    recommendation: WaterRequest.shape.agent_recommendation.unwrap(),
  }),
  z.object({
    ...base,
    type: z.literal("request.decided"),
    request_id: Id,
    /** The request row's owner, so a pure event→entries fold can debit the right quota. */
    farmer_id: Id.optional(),
    /** The request row's type, so the fold knows whether the movement is urgent or buffer. */
    request_type: RequestType.optional(),
    decision: z.enum(["approve", "reject"]),
    volume_m3: z.number(),
    note: z.string().optional(),
  }),
  z.object({ ...base, type: z.literal("week.released_to_buffer"), farmer_id: Id, week_start: z.string(), volume_m3: z.number() }),
  z.object({ ...base, type: z.literal("crop.harvested"), farmer_id: Id, crop_plan_id: Id, remaining_m3: z.number() }),
  z.object({ ...base, type: z.literal("contact.updated"), contact: Contact }),
]);
export type JadalEvent = z.infer<typeof JadalEvent>;
export type JadalEventType = JadalEvent["type"];
