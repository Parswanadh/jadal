/**
 * Ledger-entry queries.
 *
 * The ledger is the audit trail's spine: entries are read in `at` order, and every filter is a view
 * over the same double-entry movements the event log wrote.
 */

import { LedgerEntry } from "@jadal/contracts/entities";
import { resultRows, type DbEnv } from "../store";
import { emptyWhere, eq, limitClause } from "./shared";

export interface LedgerFilter {
  readonly eventId?: string;
  /** Matches either side of the movement — "everything touching this account". */
  readonly account?: string;
  readonly from?: string;
  readonly to?: string;
  /** Inclusive lower bound on `at` (ISO-8601). */
  readonly since?: string;
  readonly limit?: number;
}

interface LedgerEntryRow {
  id: string;
  at: string;
  from_account: string;
  to_account: string;
  volume_m3: number;
  reason: string;
  event_id: string;
}

function toLedgerEntry(row: LedgerEntryRow): LedgerEntry {
  return LedgerEntry.parse({
    id: row.id,
    at: row.at,
    from: row.from_account,
    to: row.to_account,
    volume_m3: row.volume_m3,
    reason: row.reason,
    event_id: row.event_id,
  });
}

/**
 * Ledger entries in `at` order, then id.
 *
 * The order is the audit trail's spine: an auditor reading entries top to bottom sees water move in
 * the sequence the log records. `id` (which is `${event_id}:e${n}`) breaks ties within one event, and
 * the `n` suffix already orders them by movement, so two entries from one append are listed in the
 * order `entriesFor` emitted them.
 */
export async function getLedgerEntries(env: DbEnv, filter: LedgerFilter = {}): Promise<LedgerEntry[]> {
  let where = eq(emptyWhere(), "event_id", filter.eventId);
  where = eq(where, "from_account", filter.from);
  where = eq(where, "to_account", filter.to);
  if (filter.account !== undefined) {
    where = {
      sql: where.sql === "" ? " WHERE (from_account = ? OR to_account = ?)" : `${where.sql} AND (from_account = ? OR to_account = ?)`,
      bindings: [...where.bindings, filter.account, filter.account],
    };
  }
  if (filter.since !== undefined) {
    where = { sql: `${where.sql === "" ? " WHERE" : where.sql} at >= ?`, bindings: [...where.bindings, filter.since] };
  }

  const limit = limitClause(filter.limit);
  const rows = resultRows(
    await env.DB.prepare(`SELECT * FROM ledger_entry${where.sql} ORDER BY at ASC, id ASC${limit.sql}`)
      .bind(...where.bindings, ...limit.bindings)
      .all<LedgerEntryRow>(),
  );
  return rows.map(toLedgerEntry);
}
