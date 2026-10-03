/**
 * Shared plumbing for the read repository.
 *
 * Every function in `repo/*` maps projection rows to the **contract shapes** in
 * `@jadal/contracts/entities` — the same objects `routes.*.response` validates — rather than leaking
 * SQL column names (`has_smartphone`, `from_account`, `shortfall`) to callers. Routes hand these
 * straight to `c.json()`, so a shape drift shows up as a contract-test failure instead of a silent
 * `undefined`.
 *
 * What that costs, and why each is worth it:
 *
 *  * **SQLite stores no boolean or JSON type.** `verified`, `has_smartphone`, `lined` and `escalated`
 *    are `INTEGER CHECK (… IN (0,1))`; `preferred_channels`, `shortfall`, `agent_recommendation` and
 *    `coordinator_decision` are `TEXT CHECK (json_valid(…))`. Both round-trip to JS values here.
 *  * **Column names differ from field names.** `ledger_entry.from_account` is the contract's `from`.
 *    `WaterRequest.crop_plan_id` is optional but the column is nullable, so NULL becomes *absent*
 *    rather than present-and-undefined.
 *  * **Ordering is specified, not incidental.** SQLite returns rows in whatever order the planner
 *    likes; contract tests and the demo need the same array every run. Every list function pins an
 *    `ORDER BY` with a unique tiebreak on the primary key, so output is total and stable even when
 *    the sort keys collide.
 *  * **Missing is not an error.** A filter that matches nothing returns `[]`; a single-row getter
 *    returns `null`. Neither throws, because "no such farmer" is a normal answer for a route.
 *
 * Nothing here writes. All state changes go through `appendEvent` (`../store.ts`).
 */

import type { DbEnv } from "../store";

export type { DbEnv };

/**
 * SQLite's `INTEGER CHECK (… IN (0,1))` back to a JS boolean.
 *
 * The CHECK means only 0 and 1 can be stored, so `=== 1` is total: it cannot silently read a
 * corrupt row as `false`, because a corrupt row cannot exist. The migration is the authority here,
 * not defensiveness.
 */
export function toBool(value: number): boolean {
  return value === 1;
}

/**
 * `NULL` → *absent*.
 *
 * Optional contract fields (`crop_plan_id`, `triage_score`, `transcript`, `rice_practice`,
 * `explanation`) must be missing, not present with an `undefined` value: `JSON.stringify` drops
 * `undefined` properties so both look the same on the wire, but `Object.keys()` and zod's
 * `.optional()` handling differ, and a test that reads `Object.keys()` would see the difference.
 * Spreading only defined fields keeps the object honest.
 */
export function withOptional<T extends object, K extends string>(
  base: T,
  key: K,
  value: unknown,
): T | (T & { [P in K]: unknown }) {
  return value === null || value === undefined ? base : { ...base, [key]: value };
}

/**
 * Parse a `json_valid` TEXT column into a `Record<string, number>`.
 *
 * `json_valid` guarantees the text parses; it does not guarantee the shape. A roster's `shortfall`
 * written by a future refactor as `{"f1": "12"}` would still pass the CHECK and then poison every
 * consumer downstream, so the value shape is re-checked here rather than trusted.
 */
export function parseNumberRecord(raw: string, column: string, rowId: string): Record<string, number> {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(`${column} on row ${rowId} is not a JSON object: ${raw}`);
  }
  const source = parsed as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError(`${column} on row ${rowId} has a non-finite value at ${key}: ${raw}`);
    }
    out[key] = value;
  }
  return out;
}

/** A `json_valid` TEXT column holding a single JSON object, or `null` when the column is NULL. */
export function parseJsonObject(raw: string | null, column: string, rowId: string): unknown {
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(`${column} on row ${rowId} is not a JSON object: ${raw}`);
  }
  return parsed;
}

const ALLOWED_COLUMNS = new Set([
  "canal_id",
  "farmer_id",
  "crop_plan_id",
  "week_start",
  "status",
  "release_window_id",
  "roster_id",
  "plot_id",
  "event_id",
  "from_account",
  "to_account",
  "type",
  "purpose",
  "channel",
]);

function assertColumn(column: string): void {
  const unqualified = column.includes(".") ? column.split(".").pop()! : column;
  if (!ALLOWED_COLUMNS.has(unqualified)) {
    throw new Error(`unsafe column name: ${JSON.stringify(column)}`);
  }
}

/** Assemble a `WHERE` fragment and its bindings from an already-built list of clauses. */
export interface Where {
  readonly sql: string;
  readonly bindings: unknown[];
}

export function emptyWhere(): Where {
  return { sql: "", bindings: [] };
}

/** Append one `col = ?` clause. Does nothing when `value` is `undefined`, so filters are all optional. */
export function eq(where: Where, column: string, value: string | number | undefined): Where {
  if (value === undefined) return where;
  assertColumn(column);
  return {
    sql: where.sql === "" ? ` WHERE ${column} = ?` : `${where.sql} AND ${column} = ?`,
    bindings: [...where.bindings, value],
  };
}

/** Append one `col IN (?, …)` clause. An empty value list matches nothing, which is the honest answer. */
export function inList(where: Where, column: string, values: readonly string[]): Where {
  if (values.length === 0) {
    return { sql: where.sql === "" ? " WHERE 0" : `${where.sql} AND 0`, bindings: where.bindings };
  }
  assertColumn(column);
  const placeholders = values.map(() => "?").join(", ");
  return {
    sql: where.sql === "" ? ` WHERE ${column} IN (${placeholders})` : `${where.sql} AND ${column} IN (${placeholders})`,
    bindings: [...where.bindings, ...values],
  };
}

/** Trailing `LIMIT ?`, or nothing when `limit` is undefined. */
export function limitClause(limit: number | undefined): { sql: string; bindings: unknown[] } {
  return limit === undefined ? { sql: "", bindings: [] } : { sql: " LIMIT ?", bindings: [limit] };
}
