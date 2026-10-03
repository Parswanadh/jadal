/**
 * Entitlement and season queries.
 *
 * An entitlement is a weekly volume at the field gate for one crop plan. The season is the
 * coordinator's *declared* supply, read from the projection rather than recomputed so an audit can
 * see a declaration that disagrees with the sum of entitlements.
 */

import { Entitlement } from "@jadal/contracts/entities";
import { resultRows, type DbEnv } from "../store";
import { emptyWhere, eq, withOptional } from "./shared";

export interface EntitlementFilter {
  readonly farmerId?: string;
  readonly cropPlanId?: string;
  /** Exact `week_start` (`YYYY-MM-DD`). */
  readonly weekStart?: string;
  readonly status?: Entitlement["status"];
}

/** One declared season's authoritative supply, as stored by the `season.approved` projection. */
export interface SeasonRecord {
  readonly canal_id: string;
  readonly season_supply_m3: number;
  readonly declared_at: string;
  readonly tolerance_m3: number;
}

interface EntitlementRow {
  id: string;
  farmer_id: string;
  crop_plan_id: string;
  week_start: string;
  volume_m3: number;
  net_irrigation_mm: number;
  status: string;
  explanation: string | null;
}

interface SeasonRow {
  canal_id: string;
  season_supply_m3: number;
  declared_at: string;
  tolerance_m3: number;
}

function toEntitlement(row: EntitlementRow): Entitlement {
  return Entitlement.parse(
    withOptional(
      {
        id: row.id,
        farmer_id: row.farmer_id,
        crop_plan_id: row.crop_plan_id,
        week_start: row.week_start,
        volume_m3: row.volume_m3,
        net_irrigation_mm: row.net_irrigation_mm,
        status: row.status,
      },
      "explanation",
      row.explanation,
    ),
  );
}

function toSeason(row: SeasonRow): SeasonRecord {
  return {
    canal_id: row.canal_id,
    season_supply_m3: row.season_supply_m3,
    declared_at: row.declared_at,
    tolerance_m3: row.tolerance_m3,
  };
}

/**
 * Entitlements, ordered by `week_start` then farmer name.
 *
 * The week is the outer key because every consumer of this list — the portal's weekly board, the
 * coordinator's approval screen — reasons in weeks. Within a week, farmers in name order matches
 * `listFarmers`, so a farmer's position does not jump between two lists.
 *
 * The `ORDER BY` joins `farmer` for the name; `entitlement.id` is the final tiebreak so two
 * entitlements in the same week for the same farmer (two crop plans) are still totally ordered.
 */
export async function listEntitlements(env: DbEnv, filter: EntitlementFilter = {}): Promise<Entitlement[]> {
  let where = eq(emptyWhere(), "e.farmer_id", filter.farmerId);
  where = eq(where, "e.crop_plan_id", filter.cropPlanId);
  where = eq(where, "e.week_start", filter.weekStart);
  where = eq(where, "e.status", filter.status);

  const rows = resultRows(
    await env.DB.prepare(
      `SELECT e.* FROM entitlement e
       JOIN farmer f ON f.id = e.farmer_id
       ${where.sql}
       ORDER BY e.week_start ASC, f.name ASC, e.id ASC`,
    )
      .bind(...where.bindings)
      .all<EntitlementRow>(),
  );
  return rows.map(toEntitlement);
}

/**
 * One week's entitlements, same ordering as `listEntitlements`.
 *
 * A convenience over `listEntitlements({ weekStart })` so callers that only care about a week do not
 * have to construct the filter, and so the "empty week" answer is `[]` in one obvious place.
 */
export async function getEntitlementsForWeek(
  env: DbEnv,
  weekStart: string,
  filter: Omit<EntitlementFilter, "weekStart"> = {},
): Promise<Entitlement[]> {
  return listEntitlements(env, { ...filter, weekStart });
}

/**
 * The declared season for a canal, or `null` before `season.approved` has been appended.
 *
 * `season_supply_m3` is the figure `ledger.checkConservation` audits against, so it is read from the
 * projection rather than recomputed: the point of the table is to hold the coordinator's *declared*
 * number even when it disagrees with the sum of the entitlements, which is exactly the case an audit
 * needs to see.
 */
export async function getSeason(env: DbEnv, canalId: string): Promise<SeasonRecord | null> {
  const row = await env.DB.prepare("SELECT * FROM season WHERE canal_id = ?").bind(canalId).first<SeasonRow>();
  return row === null ? null : toSeason(row);
}
