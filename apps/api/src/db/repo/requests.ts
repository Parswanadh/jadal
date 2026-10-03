/**
 * Water-request queries.
 *
 * The `request` table is self-contained: every field of `WaterRequest` is a column, with the two
 * decisions held as JSON text, so the mapper does no joining — the request row is the whole request.
 */

import { WaterRequest } from "@jadal/contracts/entities";
import { resultRows, type DbEnv } from "../store";
import { emptyWhere, eq, limitClause, parseJsonObject, withOptional } from "./shared";

export interface RequestFilter {
  readonly farmerId?: string;
  readonly status?: WaterRequest["status"];
  readonly type?: WaterRequest["type"];
  /** Most rows to return, applied after ordering so it keeps the *oldest* N. */
  readonly limit?: number;
}

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
 * Append the coordinator decision to the base request shape.
 *
 * Split out because it is the only nested-JSON field whose absence and whose `undefined` have to be
 * distinguished from the other two, and getting that wrong silently drops a coordinator's decision
 * out of an audit view.
 */
function withDecision<T extends object>(base: T, decision: unknown): T | (T & { coordinator_decision: unknown }) {
  return decision === undefined ? base : { ...base, coordinator_decision: decision };
}

/**
 * `request` table row → contract `WaterRequest`.
 *
 * The table is self-contained: every field of `WaterRequest` is a column, with the two decisions
 * held as JSON text. That is why this mapper does no joining — the request row is the whole request.
 *
 * The two JSON columns are re-validated through the contract's own sub-schemas rather than trusted as
 * `unknown`, because `request.recommended` and `request.decided` write them as opaque `json(...)`
 * blobs and a `decision` value the contract rejects would otherwise surface as a 500 from a route
 * that only meant to read a list. A NULL column means the decision has not happened yet: it is
 * omitted rather than parsed, because the contract's `.optional()` accepts `undefined`, not `null`.
 */
function toRequest(row: RequestRow): WaterRequest {
  const rawRecommendation = parseJsonObject(row.agent_recommendation, "request.agent_recommendation", row.id);
  const rawDecision = parseJsonObject(row.coordinator_decision, "request.coordinator_decision", row.id);
  const recommendation =
    rawRecommendation === null ? undefined : WaterRequest.shape.agent_recommendation.parse(rawRecommendation);
  const decision = rawDecision === null ? undefined : WaterRequest.shape.coordinator_decision.parse(rawDecision);
  return WaterRequest.parse(
    withDecision(
      withOptional(
        withOptional(
          withOptional(
            {
              id: row.id,
              farmer_id: row.farmer_id,
              type: row.type,
              volume_m3: row.volume_m3,
              reason: row.reason,
              channel: row.channel,
              status: row.status,
              raised_at: row.raised_at,
            },
            "crop_plan_id",
            row.crop_plan_id,
          ),
          "triage_score",
          row.triage_score,
        ),
        "agent_recommendation",
        recommendation,
      ),
      decision,
    ),
  );
}

/**
 * Water requests in `raised_at` order, oldest first.
 *
 * Chronological, matching how a coordinator triages a queue: the request that has been waiting
 * longest is the one to answer first. `id` is the tiebreak for two requests raised in the same
 * batch — which the demo does, since one event append is one timestamp.
 */
export async function listRequests(env: DbEnv, filter: RequestFilter = {}): Promise<WaterRequest[]> {
  let where = eq(emptyWhere(), "farmer_id", filter.farmerId);
  where = eq(where, "status", filter.status);
  where = eq(where, "type", filter.type);

  const limit = limitClause(filter.limit);
  const rows = resultRows(
    await env.DB.prepare(`SELECT * FROM request${where.sql} ORDER BY raised_at ASC, id ASC${limit.sql}`)
      .bind(...where.bindings, ...limit.bindings)
      .all<RequestRow>(),
  );
  return rows.map(toRequest);
}

/** One request, or `null` when the id is unknown. */
export async function getRequest(env: DbEnv, requestId: string): Promise<WaterRequest | null> {
  const row = await env.DB.prepare("SELECT * FROM request WHERE id = ?").bind(requestId).first<RequestRow>();
  return row === null ? null : toRequest(row);
}
