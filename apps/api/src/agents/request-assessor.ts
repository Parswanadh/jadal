/**
 * The Request assessor.
 *
 * `assessRequest` answers one urgent or buffer request. The *decision and the volume* come only from
 * `core/policy` — `canGrantUrgent` / `canGrantBuffer` — so the number a coordinator approves is the
 * number the ledger rules produced. A language model, if one is configured, may only reword the
 * rationale (`llm.rewrite`); with no key the policy's own reason is returned verbatim, which is why
 * the agent works unchanged offline.
 */

import type { WaterRequest } from "@jadal/contracts";
import { WaterRequest as WaterRequestSchema } from "@jadal/contracts";
import { ledger, policy } from "../core";
import { round } from "../core/units";
import { getLedgerEntries, listEntitlements, listRequests } from "../db/repo";
import { rewrite } from "./llm";
import { toAgentEnv, type ToolEnv } from "./tools";

export type RequestDecision = "approve" | "reject" | "partial";

export interface RequestAssessment {
  readonly decision: RequestDecision;
  readonly volume_m3: number;
  readonly rationale: string;
}

interface AssessmentRequestRow {
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
}

/**
 * Read one request row directly, rather than through `repo.getRequest`.
 *
 * DEVIATION, FORCED: `repo.toRequest` parses the NULL `agent_recommendation` /
 * `coordinator_decision` JSON columns with `WaterRequest.shape.<field>.parse(null)`, and zod's
 * `.optional()` rejects `null`. That makes `repo.getRequest` throw for a freshly raised request — the
 * normal case — so the assessor (and the routes that use it) cannot read one back. This local read
 * selects only the non-JSON columns and validates the result through the same `WaterRequest`
 * contract, so it is correct today and can be deleted in favour of `getRequest` once the repo mapper
 * is fixed. Reported as a contract-adjacent defect in the task report.
 */
async function loadRequest(env: ToolEnv, requestId: string): Promise<WaterRequest | null> {
  const row = await env.DB.prepare(
    `SELECT id, farmer_id, crop_plan_id, type, volume_m3, reason, channel, status, raised_at, triage_score
     FROM request WHERE id = ?`,
  )
    .bind(requestId)
    .first<AssessmentRequestRow>();
  if (row === null) return null;
  const parsed = WaterRequestSchema.safeParse({
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
  });
  return parsed.success ? parsed.data : null;
}

async function latestWeeklyEntitlement(env: ToolEnv, farmerId: string): Promise<number> {
  const entitlements = await listEntitlements(env, { farmerId });
  let latestWeek: string | undefined;
  for (const entitlement of entitlements) {
    if (latestWeek === undefined || entitlement.week_start > latestWeek) latestWeek = entitlement.week_start;
  }
  if (latestWeek === undefined) return 0;
  return entitlements
    .filter((entitlement) => entitlement.week_start === latestWeek)
    .reduce((sum, entitlement) => sum + entitlement.volume_m3, 0);
}

/**
 * ASSUMED: the contract has no per-week "already granted" projection, so buffer grants already
 * approved for this farmer are summed across the request log. The demo raises at most one, and the
 * weekly cap is still enforced by `policy.canGrantBuffer`; a production build should scope this to
 * the week before relying on it for multi-grant weeks.
 */
async function alreadyGrantedThisWeek(env: ToolEnv, farmerId: string): Promise<number> {
  const approved = await listRequests(env, { farmerId, type: "buffer", status: "approved" });
  return approved.reduce((sum, request) => sum + request.volume_m3, 0);
}

/** Best-effort prose only; every failure falls back to the policy's own reason. */
async function wordRationale(env: ToolEnv, decision: RequestDecision, volume_m3: number, reason: string): Promise<string> {
  const system =
    "You are the Jadal request assessor for an irrigation canal. Reword the coordinator's decision into " +
    "one or two plain sentences. Never change, add or remove a number: the volume is decided by policy.";
  const prompt = `Decision: ${decision}. Volume: ${round(volume_m3, 3)} m3. Policy reason: ${reason}`;
  const rewording = await rewrite(toAgentEnv(env), system, prompt, 200);
  return rewording ?? reason;
}

/**
 * Assess a request. The volume is always one the policy engine granted (or the partial maximum it
 * reported); the rationale is prose.
 *
 * @throws {RangeError} when the request id is unknown.
 */
export async function assessRequest(env: ToolEnv, requestId: string): Promise<RequestAssessment> {
  const request: WaterRequest | null = await loadRequest(env, requestId);
  if (request === null) throw new RangeError(`no request ${requestId}`);

  const balances = ledger.balances(await getLedgerEntries(env));

  let decision: RequestDecision;
  let volume_m3: number;
  let reason: string;

  if (request.type === "urgent") {
    const grant = policy.canGrantUrgent(balances, request.farmer_id, request.volume_m3);
    decision = grant.ok ? "approve" : "reject";
    volume_m3 = grant.ok ? request.volume_m3 : 0;
    reason = grant.reason;
  } else if (request.type === "buffer") {
    const weekly = await latestWeeklyEntitlement(env, request.farmer_id);
    const granted = await alreadyGrantedThisWeek(env, request.farmer_id);
    const grant = policy.canGrantBuffer(balances, request.farmer_id, request.volume_m3, weekly, granted);
    if (grant.ok) {
      decision = "approve";
      volume_m3 = Math.min(request.volume_m3, grant.max_m3);
    } else if (grant.max_m3 > 0 && request.volume_m3 > grant.max_m3) {
      decision = "partial";
      volume_m3 = grant.max_m3;
    } else {
      decision = "reject";
      volume_m3 = 0;
    }
    reason = grant.reason;
  } else {
    decision = "reject";
    volume_m3 = 0;
    reason = `A ${request.type} request is not an urgent or buffer grant; the coordinator handles it directly.`;
  }

  return {
    decision,
    volume_m3: round(volume_m3, 3),
    rationale: await wordRationale(env, decision, volume_m3, reason),
  };
}
