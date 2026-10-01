/**
 * Read routes: every `GET` in `@jadal/contracts`'s `routes` object.
 *
 * These are projections only — they never append an event. Farmers, requests, contacts, release
 * windows and the raw event log come straight from `db/repo.ts` and `db/store.ts`; the ledger view
 * is assembled from the deterministic core (`ledger.balances`, `ledger.gini`, `ledger.checkConservation`)
 * so the fairness number and the conservation flag are computed by tested code rather than in a route.
 *
 * Every response is passed through `routes.<name>.response.parse` via `parseResponse`, so a shape
 * drift in a repository mapper fails the request as a 500 instead of leaking a malformed body.
 */

import type { Hono } from "hono";
import { z } from "zod";

import { JadalEvent, WaterRequest, routes } from "@jadal/contracts";

import { ledger } from "../core";
import { audit } from "../agents/auditor";
import { DEMO_CANAL_ID } from "../demo";
import {
  getCanal,
  getLedgerEntries,
  getSeason,
  listContacts,
  listFarmers,
  listOutlets,
  listReleaseWindows,
} from "../db/repo";
import type { DbEnv } from "../db/store";
import type { Env } from "../env";
import { APP_VERSION, notFound, parseResponse } from "../http";

type LedgerResponse = z.infer<typeof routes.ledger.response>;
type BalancesView = LedgerResponse["balances"];

/** Round a percentage to one decimal place; the contract only needs a number. */
function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Build the contract's `BalancesView` from the ledger log.
 *
 * `canal_supply_m3`, `buffer_m3`, `conveyance_losses_m3` and each farmer's `quota_m3`/`delivered_m3`
 * come from `ledger.balances`, which is a pure fold over the double entries. `need_met_pct` is the
 * delivered share of quota (clamped to 0–100), the same quantity the scheduler's fairness comparison
 * reasons about, and `gini` is `ledger.gini` over those percentages — so "fairness" is one function,
 * not a route-local formula. `conservation_ok` is `ledger.checkConservation` against the declared
 * season supply (falling back to the supply the entries themselves carry when no season was
 * declared yet), and the season's own tolerance is honoured.
 *
 * Farmers registered but with no ledger entry are included with a zero balance, so the portal board
 * always shows the whole command area rather than only the people water has touched.
 */
async function buildBalancesView(env: Env): Promise<BalancesView> {
  const entries = await getLedgerEntries(env);
  const core = ledger.balances(entries);

  const registered = await listFarmers(env);
  const nameById = new Map<string, string>();
  for (const record of registered) nameById.set(record.farmer.id, record.farmer.name);
  for (const farmerId of Object.keys(core.farmers)) {
    if (!nameById.has(farmerId)) nameById.set(farmerId, farmerId);
  }

  const farmerIds = [...nameById.keys()].sort((a, b) => {
    const byName = (nameById.get(a) ?? a).localeCompare(nameById.get(b) ?? b);
    return byName !== 0 ? byName : a.localeCompare(b);
  });

  const farmers = farmerIds.map((farmerId) => {
    const balance = core.farmers[farmerId] ?? { quota: 0, delivered: 0 };
    const needMet = balance.quota > 0 ? Math.min(100, Math.max(0, (balance.delivered / balance.quota) * 100)) : 0;
    return {
      farmer_id: farmerId,
      name: nameById.get(farmerId) ?? farmerId,
      quota_m3: balance.quota,
      delivered_m3: balance.delivered,
      need_met_pct: roundPercent(needMet),
    };
  });

  const season = await getSeason(env, DEMO_CANAL_ID);
  const supply = season?.season_supply_m3 ?? core.canal_supply;
  const conservation = ledger.checkConservation(entries, supply, season?.tolerance_m3);

  return {
    canal_supply_m3: core.canal_supply,
    buffer_m3: core.buffer,
    conveyance_losses_m3: core.conveyance_losses,
    farmers,
    conservation_ok: conservation.ok,
    gini: ledger.gini(farmers.map((farmer) => farmer.need_met_pct)),
  };
}

/* ------------------------------------------------------------------ log-backed reads */

/**
 * Read the append-only event log, oldest first.
 *
 * `db/store.readEvents` currently hands the stored JSON *text* straight to `JadalEvent.parse`, which
 * rejects a string (documented as a bug in `store.test.ts`). This module cannot edit the store, so it
 * does the one missing `JSON.parse` itself and validates through the same contract. The SQL is the
 * same ordered projection read the store performs.
 */
export async function readEventLog(env: DbEnv): Promise<JadalEvent[]> {
  const rows = await env.DB.prepare("SELECT payload FROM events ORDER BY seq ASC").all<{ payload: string }>();
  return rows.map((row) => JadalEvent.parse(JSON.parse(row.payload)));
}

/** The columns the `request` projection stores, as read back from SQLite. */
interface RequestRow {
  id: string;
  farmer_id: string;
  crop_plan_id: string | null;
  type: string;
  volume_m3: number;
  reason: string;
  channel: string;
  status: string;
  raised_at: string;
  triage_score: number | null;
  agent_recommendation: string | null;
  coordinator_decision: string | null;
}

/**
 * `request` row → contract `WaterRequest`.
 *
 * `db/repo.toRequest` parses the two nullable JSON columns with `.optional().parse(null)`, which
 * rejects `null` (documented in this file's report; `repo.test.ts` only covers rows where both
 * columns are set). This mapper treats a NULL column as *absent*, which is what `WaterRequest`'s
 * optional fields mean, and still validates the whole object through the contract schema.
 */
function toWaterRequest(row: RequestRow): WaterRequest {
  const recommendation = row.agent_recommendation === null ? undefined : JSON.parse(row.agent_recommendation);
  const decision = row.coordinator_decision === null ? undefined : JSON.parse(row.coordinator_decision);
  return WaterRequest.parse({
    id: row.id,
    farmer_id: row.farmer_id,
    type: row.type,
    volume_m3: row.volume_m3,
    reason: row.reason,
    channel: row.channel,
    status: row.status,
    raised_at: row.raised_at,
    ...(row.crop_plan_id === null ? {} : { crop_plan_id: row.crop_plan_id }),
    ...(row.triage_score === null ? {} : { triage_score: row.triage_score }),
    ...(recommendation === undefined ? {} : { agent_recommendation: recommendation }),
    ...(decision === undefined ? {} : { coordinator_decision: decision }),
  });
}

/** All water requests, oldest first — the read `routes.listRequests` and `decideRequest` share. */
export async function readRequestSnapshot(env: DbEnv): Promise<WaterRequest[]> {
  const rows = await env.DB.prepare("SELECT * FROM request ORDER BY raised_at ASC, id ASC").all<RequestRow>();
  return rows.map(toWaterRequest);
}

/** Register every `GET` route on `app`. */
export function registerReadRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get(routes.health.path, (c) => {
    return c.json(parseResponse(routes.health.response, { ok: true, version: APP_VERSION }));
  });

  app.get(routes.canal.path, async (c) => {
    const canal = await getCanal(c.env, DEMO_CANAL_ID);
    if (canal === null) {
      throw notFound("canal_not_found", `no canal ${DEMO_CANAL_ID}`);
    }
    const outlets = await listOutlets(c.env, DEMO_CANAL_ID);
    return c.json(parseResponse(routes.canal.response, { canal, outlets }));
  });

  app.get(routes.listFarmers.path, async (c) => {
    const farmers = await listFarmers(c.env);
    return c.json(parseResponse(routes.listFarmers.response, farmers));
  });

  app.get(routes.releaseWindows.path, async (c) => {
    const windows = await listReleaseWindows(c.env, DEMO_CANAL_ID);
    return c.json(parseResponse(routes.releaseWindows.response, windows));
  });

  app.get(routes.listRequests.path, async (c) => {
    const requests = await readRequestSnapshot(c.env);
    return c.json(parseResponse(routes.listRequests.response, requests));
  });

  app.get(routes.ledger.path, async (c) => {
    const [entries, balances] = await Promise.all([getLedgerEntries(c.env), buildBalancesView(c.env)]);
    return c.json(parseResponse(routes.ledger.response, { entries, balances }));
  });

  app.get(routes.events.path, async (c) => {
    const events = await readEventLog(c.env);
    return c.json(parseResponse(routes.events.response, events));
  });

  app.get(routes.contacts.path, async (c) => {
    const contacts = await listContacts(c.env);
    return c.json(parseResponse(routes.contacts.response, contacts));
  });

  app.get(routes.audit.path, async (c) => {
    const result = await audit(c.env);
    return c.json(parseResponse(routes.audit.response, result));
  });
}
