/**
 * Release-window and roster queries.
 *
 * `RosterRecord` adds the one column the roster table carries that the contract does not model,
 * `created_at`, which orders "which roster we tried first".
 */

import { ReleaseWindow, Roster, Turn } from "@jadal/contracts/entities";
import { resultRows, type DbEnv } from "../store";
import { emptyWhere, eq, inList, parseNumberRecord } from "./shared";

export interface RosterFilter {
  readonly canalId?: string;
  readonly releaseWindowId?: string;
  readonly status?: Roster["status"];
}

/**
 * `Roster` plus the one column the roster table carries that the contract does not model.
 *
 * `created_at` orders "which roster we tried first". Additive, so a `Roster` consumer is unaffected.
 *
 * The fairness mode is deliberately absent: the contract's `Roster` has no `mode`, and
 * `roster.proposed` does not carry one, so it cannot be recovered from the event log.
 */
export interface RosterRecord extends Roster {
  readonly created_at: string;
}

interface ReleaseWindowRow {
  id: string;
  canal_id: string;
  start: string;
  end: string;
  discharge_m3s: number;
}

interface RosterRow {
  id: string;
  canal_id: string;
  release_window_id: string;
  status: string;
  shortfall: string;
  created_at: string;
}

interface TurnRow {
  id: string;
  roster_id: string;
  outlet_id: string;
  farmer_id: string;
  start: string;
  end: string;
  planned_volume_m3: number;
  expected_flow_m3s: number;
  lag_h: number;
}

function toReleaseWindow(row: ReleaseWindowRow): ReleaseWindow {
  return ReleaseWindow.parse({
    id: row.id,
    canal_id: row.canal_id,
    start: row.start,
    end: row.end,
    discharge_m3s: row.discharge_m3s,
  });
}

function toTurn(row: TurnRow): Turn {
  return Turn.parse({
    id: row.id,
    roster_id: row.roster_id,
    outlet_id: row.outlet_id,
    farmer_id: row.farmer_id,
    start: row.start,
    end: row.end,
    planned_volume_m3: row.planned_volume_m3,
    expected_flow_m3s: row.expected_flow_m3s,
    lag_h: row.lag_h,
  });
}

/** Roster row plus its already-parsed turns and JSON shortfall. */
function toRoster(row: RosterRow, turns: Turn[]): RosterRecord {
  const parsed = Roster.parse({
    id: row.id,
    canal_id: row.canal_id,
    release_window_id: row.release_window_id,
    status: row.status,
    turns,
    shortfall_m3: parseNumberRecord(row.shortfall, "roster.shortfall", row.id),
  });
  return { ...parsed, created_at: row.created_at };
}

/**
 * Release windows in start order, then id.
 *
 * Head-to-tail chronology: a coordinator comparing two upcoming windows reads them earliest-first,
 * which is also the order they will actually be run in.
 */
export async function listReleaseWindows(env: DbEnv, canalId?: string): Promise<ReleaseWindow[]> {
  const where = eq(emptyWhere(), "canal_id", canalId);
  const rows = resultRows(
    await env.DB.prepare(`SELECT * FROM release_window${where.sql} ORDER BY start ASC, id ASC`)
      .bind(...where.bindings)
      .all<ReleaseWindowRow>(),
  );
  return rows.map(toReleaseWindow);
}

/** One release window, or `null` when the id is unknown. */
export async function getReleaseWindow(env: DbEnv, windowId: string): Promise<ReleaseWindow | null> {
  const row = await env.DB.prepare("SELECT * FROM release_window WHERE id = ?")
    .bind(windowId)
    .first<ReleaseWindowRow>();
  return row === null ? null : toReleaseWindow(row);
}

/**
 * Turn rows for several rosters at once, grouped by roster id.
 *
 * Both `getRoster` and `listRosters` need turns, and a list that issued one query per roster would
 * be O(n) round trips over the demo's whole history. One `IN` query plus a fold keeps it at two.
 * Rosters with no turns get no map entry, and every caller substitutes `?? []`.
 */
async function turnsByRoster(env: DbEnv, rosterIds: readonly string[]): Promise<Map<string, Turn[]>> {
  const grouped = new Map<string, Turn[]>();
  if (rosterIds.length === 0) return grouped;

  const where = inList(emptyWhere(), "roster_id", rosterIds);
  const rows = resultRows(
    await env.DB.prepare(`SELECT * FROM turn${where.sql} ORDER BY start ASC, id ASC`)
      .bind(...where.bindings)
      .all<TurnRow>(),
  );

  for (const row of rows) {
    const bucket = grouped.get(row.roster_id) ?? [];
    bucket.push(toTurn(row));
    grouped.set(row.roster_id, bucket);
  }
  return grouped;
}

/** Roster rows plus their turn groups, in `created_at` order. Ordering helper, shared by both roster getters. */
async function rostersWithTurns(env: DbEnv, filter: RosterFilter): Promise<RosterRecord[]> {
  let where = eq(emptyWhere(), "canal_id", filter.canalId);
  where = eq(where, "release_window_id", filter.releaseWindowId);
  where = eq(where, "status", filter.status);

  const rows = resultRows(
    await env.DB.prepare(`SELECT * FROM roster${where.sql} ORDER BY created_at ASC, id ASC`)
      .bind(...where.bindings)
      .all<RosterRow>(),
  );
  if (rows.length === 0) return [];

  const turns = await turnsByRoster(
    env,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toRoster(row, turns.get(row.id) ?? []));
}

/**
 * Rosters, oldest first, each with its turns in `start` order.
 *
 * `created_at` first so "the roster we tried before the re-plan" reads forwards, matching the event
 * log's `seq` order. `id` breaks ties for two rosters proposed in the same batch.
 */
export async function listRosters(env: DbEnv, filter: RosterFilter = {}): Promise<RosterRecord[]> {
  return rostersWithTurns(env, filter);
}

/**
 * One roster with its turns, or `null` when the id is unknown.
 *
 * An empty `turns` array is a legitimate answer — a roster whose window could schedule nothing is
 * still a real roster, and the coordinator needs to see it to understand the shortfall.
 */
export async function getRoster(env: DbEnv, rosterId: string): Promise<RosterRecord | null> {
  const row = await env.DB.prepare("SELECT * FROM roster WHERE id = ?").bind(rosterId).first<RosterRow>();
  if (row === null) return null;
  const turns = await turnsByRoster(env, [rosterId]);
  return toRoster(row, turns.get(rosterId) ?? []);
}
