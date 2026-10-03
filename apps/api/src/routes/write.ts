/**
 * Write routes: every `POST` in `@jadal/contracts`'s `routes` object, except the voice, demo and
 * audit surfaces which live in their own modules.
 *
 * This file is deliberately only the HTTP shell: each handler validates its body, calls one service
 * function from `./write-services`, and validates the response. The state work — minting ids,
 * building `JadalEvent`s, appending them and booking ledger movements — lives in that module, where
 * it can be tested without a Hono `Context`.
 */

import type { Hono } from "hono";
import { z } from "zod";

import { Id, routes } from "@jadal/contracts";

import type { Env } from "../env";
import { parseBody, parseResponse } from "../http";
import { raiseRequest } from "../requests";
import {
  approveRosterForWindow,
  approveWeeklyEntitlements,
  decideWaterRequest,
  harvestCrop,
  proposeRosterForWindow,
  registerFarmer,
  releaseWeekForFarmer,
  suggestWeeklyEntitlements,
  verifyFarmer,
} from "./write-services";

/**
 * `POST /api/canal/harvest` — outside the frozen contract.
 *
 * `packages/contracts` is the integration agreement and only the orchestrator changes it, so this
 * route's path/body/response are declared here rather than in `routes`. Appending `crop.harvested` is
 * the one way water leaves a farmer's quota for the shared buffer before the season ends.
 */
const HARVEST_PATH = "/api/canal/harvest";
const harvestBody = z.object({ farmer_id: Id });
const harvestResponse = z.object({
  ok: z.literal(true),
  farmer_id: Id,
  crop_plan_id: Id,
  remaining_m3: z.number(),
  buffer_m3: z.number(),
});

/**
 * `POST /api/canal/release-week` — outside the frozen contract.
 *
 * `packages/contracts` is the integration agreement and only the orchestrator changes it, so this
 * route's path/body/response are declared here rather than in `routes`. Appending
 * `week.released_to_buffer` is how a coordinator returns one farmer's unused week quota to the shared
 * buffer, where an approved buffer request can grant it to another farmer.
 */
const RELEASE_WEEK_PATH = "/api/canal/release-week";
const releaseWeekBody = z.object({ farmer_id: Id, week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
const releaseWeekResponse = z.object({
  ok: z.literal(true),
  farmer_id: Id,
  week_start: z.string(),
  volume_m3: z.number(),
  buffer_m3: z.number(),
});

/** Register every `POST` route on `app`. */
export function registerWriteRoutes(app: Hono<{ Bindings: Env }>): void {
  app.post(routes.register.path, async (c) => {
    const body = await parseBody(c, routes.register.body);
    const entities = await registerFarmer(c.env, body);
    return c.json(parseResponse(routes.register.response, entities));
  });

  app.post(routes.verifyFarmer.path, async (c) => {
    await parseBody(c, routes.verifyFarmer.body);
    const result = await verifyFarmer(c.env, c.req.param("id"));
    return c.json(parseResponse(routes.verifyFarmer.response, result));
  });

  app.post(routes.suggestEntitlements.path, async (c) => {
    const body = await parseBody(c, routes.suggestEntitlements.body);
    const result = await suggestWeeklyEntitlements(c.env, body.week_start);
    return c.json(parseResponse(routes.suggestEntitlements.response, result));
  });

  app.post(routes.approveEntitlements.path, async (c) => {
    const body = await parseBody(c, routes.approveEntitlements.body);
    const result = await approveWeeklyEntitlements(c.env, body);
    return c.json(parseResponse(routes.approveEntitlements.response, result));
  });

  app.post(routes.proposeRoster.path, async (c) => {
    const body = await parseBody(c, routes.proposeRoster.body);
    const result = await proposeRosterForWindow(c.env, body);
    return c.json(parseResponse(routes.proposeRoster.response, result));
  });

  app.post(routes.approveRoster.path, async (c) => {
    await parseBody(c, routes.approveRoster.body);
    const result = await approveRosterForWindow(c.env, c.req.param("id"));
    return c.json(parseResponse(routes.approveRoster.response, result));
  });

  app.post(routes.raiseRequest.path, async (c) => {
    const body = await parseBody(c, routes.raiseRequest.body);
    // The one raise-a-request path, shared with the telephony webhook's `raiseRequest` dep (B9).
    const stored = await raiseRequest(c.env, {
      farmer_id: body.farmer_id,
      type: body.type,
      volume_m3: body.volume_m3,
      reason: body.reason,
      channel: body.channel,
      ...(body.crop_plan_id === undefined ? {} : { crop_plan_id: body.crop_plan_id }),
    });
    return c.json(parseResponse(routes.raiseRequest.response, stored));
  });

  app.post(routes.decideRequest.path, async (c) => {
    const body = await parseBody(c, routes.decideRequest.body);
    const stored = await decideWaterRequest(c.env, c.req.param("id"), body);
    return c.json(parseResponse(routes.decideRequest.response, stored));
  });

  app.post(HARVEST_PATH, async (c) => {
    const body = await parseBody(c, harvestBody);
    const result = await harvestCrop(c.env, body.farmer_id);
    return c.json(parseResponse(harvestResponse, result));
  });

  app.post(RELEASE_WEEK_PATH, async (c) => {
    const body = await parseBody(c, releaseWeekBody);
    const result = await releaseWeekForFarmer(c.env, body.farmer_id, body.week_start);
    return c.json(parseResponse(releaseWeekResponse, result));
  });
}
