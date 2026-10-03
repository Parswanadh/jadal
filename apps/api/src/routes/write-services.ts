/**
 * Business logic behind the write routes.
 *
 * `write.ts` is left as a thin HTTP shell: each handler validates its body, calls one function here,
 * and validates the response. Everything that mints ids, reads projections, appends events or books
 * ledger movements lives in this module, so the routes cannot drift into doing state work inline.
 *
 * The rule that shapes this module is unchanged from the routes it serves: **all state changes go
 * through the event log.** Each service mints an id, builds a `JadalEvent`, and appends it; the
 * projection tables and the ledger entries are written by `appendEvent` in one atomic `db.batch()`.
 * Nothing here writes a projection directly.
 *
 * System 1 (`classify`) only ever *scores* a request — it never decides water. A coordinator
 * approval becomes water in two steps: `policy.canGrantUrgent` / `policy.canGrantBuffer` (both core
 * functions) refuse an over-grant in `assertApprovable`, and the API-local `entriesForDecision`
 * adapter books the movement, which `appendDecision` adds to the same atomic batch as the
 * `request.decided` event.
 */

import type { z } from "zod";

import type { routes } from "@jadal/contracts";
import type {
  Contact,
  CropPlan,
  Entitlement,
  Farmer,
  JadalEvent,
  Outlet,
  Plot,
  WaterRequest,
} from "@jadal/contracts";

import { suggestEntitlements } from "../agents/need";
import type { EntitlementSuggestion } from "../agents/need";
import { proposeRoster } from "../agents/scheduler";
import type { RosterProposal } from "../agents/scheduler";
import { entriesForDecision, ledger, policy, round } from "../core-shim";
import { now } from "../db/clock";
import { newId } from "../db/id";
import {
  getFarmer,
  getLedgerEntries,
  getReleaseWindow,
  getRoster,
  getSeason,
  listEntitlements,
  listOutlets,
} from "../db/repo";
import type { RosterRecord } from "../db/repo";
import { appendEvent, planAppend } from "../db/store";
import { DEMO_CANAL_ID, DEMO_SEASON_SUPPLY_M3 } from "../demo";
import type { Env } from "../env";
import { HttpError, badRequest, notFound } from "../http";
import { templateForPurpose } from "../voice/telugu";
import { readRequestSnapshot } from "./read";

const COORDINATOR_ACTOR = { kind: "coordinator", id: "coordinator" } as const;
const AGENT_NEED_ACTOR = { kind: "agent", id: "agent_need" } as const;
const AGENT_SCHEDULER_ACTOR = { kind: "agent", id: "agent_scheduler" } as const;
const AGENT_CALLER_ACTOR = { kind: "agent", id: "agent_caller" } as const;

/* ------------------------------------------------------------------ registration */

/** The entities one registration submission creates, before any event is appended. */
export interface RegistrationEntities {
  readonly farmer: Farmer;
  readonly plots: Plot[];
  readonly crop_plans: CropPlan[];
}

/**
 * Mint the farmer, plots and crop plans a registration body describes.
 *
 * Pure: it mints ids and resolves each crop plan's `plot_index` against the plots it just built, so
 * the route and its tests can build the exact entities that will be appended without touching the
 * store. A `plot_index` that points at no plot is a `400`, not a silent drop.
 */
export function buildRegistrationEntities(body: z.infer<typeof routes.register.body>): RegistrationEntities {
  const farmer: Farmer = { id: newId("farmer"), ...body.farmer };
  const plots: Plot[] = body.plots.map((plot) => ({
    id: newId("plot"),
    farmer_id: farmer.id,
    outlet_id: plot.outlet_id,
    area_ha: plot.area_ha,
    soil: plot.soil,
    lat: plot.lat,
    lon: plot.lon,
  }));

  const crop_plans: CropPlan[] = body.crop_plans.map((plan) => {
    const plot = plots[plan.plot_index];
    if (plot === undefined) {
      throw badRequest("invalid_plot_index", `crop plan references plot_index ${plan.plot_index}, which does not exist`);
    }
    const { plot_index: _plotIndex, ...rest } = plan;
    return { id: newId("crop"), plot_id: plot.id, ...rest, status: "registered" };
  });

  return { farmer, plots, crop_plans };
}

/** Register a farmer, their plots and their crop plans as one `farmer.registered` event. */
export async function registerFarmer(
  env: Env,
  body: z.infer<typeof routes.register.body>,
): Promise<RegistrationEntities> {
  const entities = buildRegistrationEntities(body);
  await appendEvent(env, {
    id: newId("evt"),
    at: await now(env),
    canal_id: DEMO_CANAL_ID,
    actor: COORDINATOR_ACTOR,
    type: "farmer.registered",
    ...entities,
  });
  return entities;
}

/** Mark a registered farmer verified, or `404` when the id is unknown. */
export async function verifyFarmer(env: Env, farmerId: string): Promise<{ ok: true }> {
  const farmer = await getFarmer(env, farmerId);
  if (farmer === null) {
    throw notFound("farmer_not_found", `no farmer ${farmerId}`);
  }

  await appendEvent(env, {
    id: newId("evt"),
    at: await now(env),
    canal_id: DEMO_CANAL_ID,
    actor: COORDINATOR_ACTOR,
    type: "registration.verified",
    farmer_id: farmerId,
  });
  return { ok: true };
}

/* ------------------------------------------------------------------ entitlements */

/** Price the week and append the resulting `entitlement.proposed` event. */
export async function suggestWeeklyEntitlements(env: Env, weekStart?: string): Promise<EntitlementSuggestion> {
  const result = await suggestEntitlements(env, weekStart);

  await appendEvent(env, {
    id: newId("evt"),
    at: await now(env),
    canal_id: DEMO_CANAL_ID,
    actor: AGENT_NEED_ACTOR,
    type: "entitlement.proposed",
    entitlements: result.entitlements,
  });
  return result;
}

/**
 * Apply the coordinator's edits and approve the proposed entitlements.
 *
 * The season is declared once, on the first approval: `season.approved` carries the demo fixture's
 * supply so the ledger's conservation check has the authoritative figure to audit against.
 */
export async function approveWeeklyEntitlements(
  env: Env,
  body: z.infer<typeof routes.approveEntitlements.body>,
): Promise<{ approved: number }> {
  const proposed = await listEntitlements(env, { status: "proposed" });
  const at = await now(env);

  const edits = new Map(body.edits.map((edit) => [edit.id, edit.volume_m3]));
  const approved: Entitlement[] = proposed.map((entitlement) => {
    const edited = edits.get(entitlement.id);
    return edited === undefined ? entitlement : { ...entitlement, volume_m3: edited };
  });

  // Keep an edit ledger-visible: re-emitting `entitlement.proposed` upserts the corrected volumes
  // (the approve event itself only flips status), so the log holds the number the coordinator set.
  if (body.edits.length > 0) {
    await appendEvent(env, {
      id: newId("evt"),
      at,
      canal_id: DEMO_CANAL_ID,
      actor: COORDINATOR_ACTOR,
      type: "entitlement.proposed",
      entitlements: approved,
    });
  }

  const season = await getSeason(env, DEMO_CANAL_ID);
  if (season === null && approved.length > 0) {
    await appendEvent(env, {
      id: newId("evt"),
      at,
      canal_id: DEMO_CANAL_ID,
      actor: COORDINATOR_ACTOR,
      type: "season.approved",
      season_supply_m3: DEMO_SEASON_SUPPLY_M3,
      entitlements: approved.map((entitlement) => ({ ...entitlement, status: "approved" })),
    });
  }

  if (approved.length > 0) {
    await appendEvent(env, {
      id: newId("evt"),
      at,
      canal_id: DEMO_CANAL_ID,
      actor: COORDINATOR_ACTOR,
      type: "entitlement.approved",
      entitlement_ids: approved.map((entitlement) => entitlement.id),
    });
  }

  return { approved: approved.length };
}

/* ------------------------------------------------------------------ rosters */

/** Propose a roster for a release window and append the `roster.proposed` event. */
export async function proposeRosterForWindow(
  env: Env,
  body: z.infer<typeof routes.proposeRoster.body>,
): Promise<RosterProposal> {
  const window = await getReleaseWindow(env, body.release_window_id);
  if (window === null) {
    throw notFound("release_window_not_found", `no release window ${body.release_window_id}`);
  }

  const result = await proposeRoster(env, body.release_window_id, body.mode);

  await appendEvent(env, {
    id: newId("evt"),
    at: await now(env),
    canal_id: DEMO_CANAL_ID,
    actor: AGENT_SCHEDULER_ACTOR,
    type: "roster.proposed",
    roster: result.roster,
  });
  return result;
}

/** Approve a roster and notify every farmer with a turn in it. */
export async function approveRosterForWindow(
  env: Env,
  rosterId: string,
): Promise<{ ok: true; contacts_queued: number }> {
  const roster = await getRoster(env, rosterId);
  if (roster === null) {
    throw notFound("roster_not_found", `no roster ${rosterId}`);
  }

  const at = await now(env);
  await appendEvent(env, {
    id: newId("evt"),
    at,
    canal_id: DEMO_CANAL_ID,
    actor: COORDINATOR_ACTOR,
    type: "roster.approved",
    roster_id: rosterId,
  });

  // Every farmer with a turn in the approved roster must be told the turn exists; `contacts_queued`
  // is the count the coordinator sees before acknowledgements tick in.
  const contactsQueued = await queueRosterContacts(env, roster, at);
  return { ok: true, contacts_queued: contactsQueued };
}

/** The release window and outlet lookup a roster's notification messages are rendered against. */
interface RosterContactContext {
  readonly window: Awaited<ReturnType<typeof getReleaseWindow>>;
  readonly outlets: ReadonlyMap<string, Outlet>;
}

/**
 * Tell one farmer that they have a turn in the approved roster.
 *
 * The contact is recorded as `queued` and the message id is handed to the outbound queue, which the
 * campaign runner drains. Returns `false` when the farmer has since been removed, so the caller's
 * `contacts_queued` count only reflects messages actually queued.
 */
async function queueRosterContact(
  env: Env,
  roster: RosterRecord,
  farmerId: string,
  context: RosterContactContext,
  at: string,
): Promise<boolean> {
  const farmer = await getFarmer(env, farmerId);
  if (farmer === null) return false;

  const turn = roster.turns.find((candidate) => candidate.farmer_id === farmerId);
  const outlet = turn === undefined ? undefined : context.outlets.get(turn.outlet_id);
  const message = templateForPurpose("roster_change", {
    farmerName: farmer.farmer.name,
    windowStart: context.window?.start,
    windowEnd: context.window?.end,
    outletName: outlet?.name,
    chainageM: outlet?.chainage_m,
    allocatedM3: turn?.planned_volume_m3,
  });

  const contact: Contact = {
    id: newId("contact"),
    farmer_id: farmerId,
    channel: farmer.farmer.preferred_channels[0] ?? "voice",
    purpose: "roster_change",
    status: "queued",
    attempt: 1,
    message_te: message.te,
    message_en: message.en,
    at,
  };

  await appendEvent(env, {
    id: newId("evt"),
    at,
    canal_id: DEMO_CANAL_ID,
    actor: AGENT_CALLER_ACTOR,
    type: "contact.updated",
    contact,
  });
  await env.OUTBOUND.send({ contact_id: contact.id, attempt: 1 });
  return true;
}

/**
 * Notify every farmer with a turn in the approved roster, once each, and return the count queued.
 *
 * The window and outlet lookup is built once here rather than per farmer, so approving a roster with
 * N distinct farmers costs one release-window read and one outlet read, not 2N.
 */
async function queueRosterContacts(env: Env, roster: RosterRecord, at: string): Promise<number> {
  const window = await getReleaseWindow(env, roster.release_window_id);
  const outlets = new Map((await listOutlets(env, DEMO_CANAL_ID)).map((outlet) => [outlet.id, outlet]));
  const context: RosterContactContext = { window, outlets };

  let contactsQueued = 0;
  for (const farmerId of new Set(roster.turns.map((turn) => turn.farmer_id))) {
    if (await queueRosterContact(env, roster, farmerId, context, at)) contactsQueued += 1;
  }
  return contactsQueued;
}

/* ------------------------------------------------------------------ requests */

/** Monday-aligned week start (`YYYY-MM-DD`) for an ISO instant, using the same rule the core uses. */
function weekStartOf(iso: string): string {
  const date = new Date(iso);
  const sinceMonday = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - sinceMonday * 86_400_000).toISOString().slice(0, 10);
}

/** The farmer's approved weekly entitlement for `weekStart`, m³. */
async function weeklyEntitlementM3(env: Env, farmerId: string, weekStart: string): Promise<number> {
  const entitlements = await listEntitlements(env, { farmerId, weekStart, status: "approved" });
  return entitlements.reduce((sum, entitlement) => sum + entitlement.volume_m3, 0);
}

/** Buffer water already approved for the farmer in the week containing `at`, m³. */
async function bufferGrantedThisWeekM3(env: Env, farmerId: string, at: string): Promise<number> {
  const weekStart = weekStartOf(at);
  const startMs = Date.parse(`${weekStart}T00:00:00Z`);
  const endMs = startMs + 7 * 86_400_000;
  const approved = (await readRequestSnapshot(env)).filter(
    (request) => request.farmer_id === farmerId && request.type === "buffer" && request.status === "approved",
  );
  return approved.reduce((sum, request) => {
    const raisedMs = Date.parse(request.raised_at);
    return raisedMs >= startMs && raisedMs < endMs ? sum + request.volume_m3 : sum;
  }, 0);
}

/**
 * Refuse an approval the policy does not allow.
 *
 * An urgent grant may only bring forward quota the farmer still has; a buffer grant is capped by the
 * week's buffer share and by what is in the buffer. Either refusal becomes a `400` with the policy's
 * own human-readable reason, which is what a coordinator sees.
 */
async function assertApprovable(env: Env, request: WaterRequest, volume_m3: number): Promise<void> {
  const balances = ledger.balances(await getLedgerEntries(env));

  if (request.type === "urgent") {
    const verdict = policy.canGrantUrgent(balances, request.farmer_id, volume_m3);
    if (!verdict.ok) throw badRequest("policy_refused", verdict.reason);
    return;
  }

  if (request.type === "buffer") {
    const [weekly, granted] = await Promise.all([
      weeklyEntitlementM3(env, request.farmer_id, weekStartOf(request.raised_at)),
      bufferGrantedThisWeekM3(env, request.farmer_id, request.raised_at),
    ]);
    const verdict = policy.canGrantBuffer(balances, request.farmer_id, volume_m3, weekly, granted);
    if (!verdict.ok) throw badRequest("policy_refused", verdict.reason);
  }
}

/**
 * Append a `request.decided` event **and the ledger movement it implies** in one atomic batch.
 *
 * `store.planAppend` models `request.decided` as moving no water, because a pure event→entries
 * function cannot be sure of the request row's `farmer_id` and `type`. The request row supplies
 * those two facts, so `entriesForDecision` is called here and its entries are added to the same
 * `db.batch()` as the event and its projections. Water still cannot move without an event, and the
 * batch is still all-or-nothing.
 */
async function appendDecision(
  env: Env,
  event: Extract<JadalEvent, { type: "request.decided" }>,
  request: Pick<WaterRequest, "farmer_id" | "type">,
): Promise<void> {
  const { plan } = planAppend(event);
  const movements = entriesForDecision({ event, farmer_id: request.farmer_id, request_type: request.type });

  const statements: { sql: string; bindings: readonly unknown[] }[] = [
    plan.eventStatement,
    ...plan.projectionStatements,
    ...plan.ledgerStatements,
  ];
  for (const entry of movements) {
    statements.push({
      sql: `INSERT INTO ledger_entry (id, at, from_account, to_account, volume_m3, reason, event_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      bindings: [entry.id, entry.at, entry.from, entry.to, entry.volume_m3, entry.reason, entry.event_id],
    });
  }

  await env.DB.batch(statements.map((statement) => env.DB.prepare(statement.sql).bind(...statement.bindings)));
}

/** Decide a water request, refusing an approval the policy does not allow. */
export async function decideWaterRequest(
  env: Env,
  requestId: string,
  body: z.infer<typeof routes.decideRequest.body>,
): Promise<WaterRequest> {
  const request = (await readRequestSnapshot(env)).find((candidate) => candidate.id === requestId);
  if (request === undefined) {
    throw notFound("request_not_found", `no request ${requestId}`);
  }

  if (body.decision === "approve") {
    await assertApprovable(env, request, body.volume_m3);
  }

  const event: Extract<JadalEvent, { type: "request.decided" }> = {
    id: newId("evt"),
    at: await now(env),
    canal_id: DEMO_CANAL_ID,
    actor: COORDINATOR_ACTOR,
    type: "request.decided",
    request_id: requestId,
    decision: body.decision,
    volume_m3: body.volume_m3,
    ...(body.note === undefined ? {} : { note: body.note }),
  };
  await appendDecision(env, event, request);

  const stored = (await readRequestSnapshot(env)).find((candidate) => candidate.id === requestId);
  if (stored === undefined) {
    throw new HttpError("internal_error", `request ${requestId} vanished after being decided`, 500);
  }
  return stored;
}

/* ------------------------------------------------------------------ harvest */

/** What a harvest frees for the shared buffer, plus the buffer balance afterwards. */
export interface HarvestResult {
  readonly ok: true;
  readonly farmer_id: string;
  readonly crop_plan_id: string;
  readonly remaining_m3: number;
  readonly buffer_m3: number;
}

/**
 * Harvest a farmer's active crop plan, moving its remaining quota to the shared buffer.
 *
 * The remaining quota is what the farmer has been credited but not yet delivered — the water a
 * harvest frees for the buffer. `ledger.balances` is the pure fold over the double entries.
 */
export async function harvestCrop(env: Env, farmerId: string): Promise<HarvestResult> {
  const farmer = await getFarmer(env, farmerId);
  if (farmer === null) {
    throw notFound("farmer_not_found", `no farmer ${farmerId}`);
  }
  const plan = farmer.crop_plans.find((candidate) => candidate.status !== "harvested");
  if (plan === undefined) {
    throw badRequest("no_crop_to_harvest", `farmer ${farmerId} has no crop plan to harvest`);
  }

  const before = ledger.balances(await getLedgerEntries(env));
  const remaining = before.farmers[farmerId]?.quota ?? 0;

  await appendEvent(env, {
    id: newId("evt"),
    at: await now(env),
    canal_id: DEMO_CANAL_ID,
    actor: COORDINATOR_ACTOR,
    type: "crop.harvested",
    farmer_id: farmerId,
    crop_plan_id: plan.id,
    remaining_m3: remaining,
  });

  const after = ledger.balances(await getLedgerEntries(env));
  return {
    ok: true,
    farmer_id: farmerId,
    crop_plan_id: plan.id,
    remaining_m3: remaining,
    buffer_m3: after.buffer,
  };
}

/* ------------------------------------------------------------------ release week */

/** What releasing a week frees for the shared buffer, plus the buffer balance afterwards. */
export interface ReleaseWeekResult {
  readonly ok: true;
  readonly farmer_id: string;
  readonly week_start: string;
  readonly volume_m3: number;
  readonly buffer_m3: number;
}

/**
 * Release one farmer's unused week quota to the shared buffer.
 *
 * The released volume is the farmer's approved entitlement for `week_start` — the water the season
 * allocated for that farmer and week. Appending `week.released_to_buffer` moves it from
 * `farmer:{id}:quota` to `buffer` in one ledger entry, where an approved buffer request can grant it
 * to another farmer. A week with no approved entitlement is a `400`: there is nothing to release.
 */
export async function releaseWeekForFarmer(
  env: Env,
  farmerId: string,
  weekStart?: string,
): Promise<ReleaseWeekResult> {
  const farmer = await getFarmer(env, farmerId);
  if (farmer === null) {
    throw notFound("farmer_not_found", `no farmer ${farmerId}`);
  }

  const at = await now(env);
  const week = weekStart ?? weekStartOf(at);
  if (Number.isNaN(Date.parse(`${week}T00:00:00Z`))) {
    throw badRequest("invalid_week_start", `week_start ${week} is not a valid calendar date`);
  }

  const volume = round(await weeklyEntitlementM3(env, farmerId, week), 3);
  if (!(volume > 0)) {
    throw badRequest("nothing_to_release", `farmer ${farmerId} has no approved entitlement for week ${week}`);
  }

  await appendEvent(env, {
    id: newId("evt"),
    at,
    canal_id: DEMO_CANAL_ID,
    actor: COORDINATOR_ACTOR,
    type: "week.released_to_buffer",
    farmer_id: farmerId,
    week_start: week,
    volume_m3: volume,
  });

  const after = ledger.balances(await getLedgerEntries(env));
  return {
    ok: true,
    farmer_id: farmerId,
    week_start: week,
    volume_m3: volume,
    buffer_m3: after.buffer,
  };
}
