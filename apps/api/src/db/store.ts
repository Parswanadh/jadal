/**
 * The append-only event store.
 *
 * This is the only way state changes. `appendEvent()` writes, in **one** `db.batch()`:
 *
 *   1. the `events` row,
 *   2. every projection upsert from `projections.ts`,
 *   3. every double-entry `ledger_entry` row from the core seam (`core-shim`, i.e. `@jadal/core`).
 *
 * `db.batch()` is D1's atomic transaction: it either commits all of it or rolls all of it back. That
 * is the whole point — there must be no way for water to move without an event, and no way for an
 * event to exist that the ledger does not know about.
 *
 * The `events` table is append-only. `assertAppendOnly` and `guardAppendOnly` exist so that a future
 * refactor cannot quietly add an UPDATE or DELETE against it.
 *
 * `Db`/`DbEnv` below are the smallest structural slice of the D1 binding the store actually uses, so
 * the same functions serve the Worker (whose `Env` satisfies them) and the in-memory test database
 * (`test/d1-shim.ts`, which does not implement the rest of the D1 surface such as `dump()`).
 */

import { JadalEvent, type JadalEventType } from "@jadal/contracts/events";
import { LedgerEntry } from "@jadal/contracts/entities";
import { entriesFor } from "../core-shim";
import { projectionsFor } from "./projections";

/** A bound statement. Mirrors the subset of `D1PreparedStatement` the store uses. */
export interface DbStatement {
  bind(...values: unknown[]): DbStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<DbResult<T>>;
  run<T = unknown>(): Promise<DbResult<T>>;
}

/** Result of a statement, mirroring the subset of `D1Response` the store reads. */
export interface DbResult<T = unknown> {
  success: boolean;
  meta: Record<string, unknown>;
  results?: T[];
}

/**
 * The rows from a D1 `all()` result.
 *
 * D1 answers `all()` with a `{ success, meta, results }` envelope and omits `results` entirely when
 * the query matched nothing, so `result.results ?? []` is the only correct read. B9 added this after
 * the first real `wrangler dev` boot 500'd every read route: the ambient type and the test shim had
 * both modelled `all()` as a bare array, so nothing caught it until the Worker actually ran.
 */
export function resultRows<T>(result: { results?: T[] }): T[] {
  return result.results ?? [];
}

/** A D1 database, minus the methods the store never touches. */
export interface Db {
  prepare(sql: string): DbStatement;
  batch<T = unknown>(statements: DbStatement[]): Promise<DbResult<T>[]>;
  exec(sql: string): Promise<unknown>;
}

/** Anything that can reach the database — the Worker's `Env`, or a test env. */
export interface DbEnv {
  readonly DB: Db;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type StoreErrorKind =
  /** The event did not satisfy `JadalEvent`. */
  | "invalid_event"
  /** `events.id` is UNIQUE and this id already exists: the event is already in the log. */
  | "duplicate_event"
  /** A ledger entry violates the double-entry rules the migration enforces. */
  | "invalid_ledger_entry"
  /** Something tried to UPDATE or DELETE an append-only table. */
  | "append_only_violation"
  /** The batch was rejected by SQLite; see `detail` for the driver message. */
  | "constraint";

/** Every failure mode of the store, distinguishable without string-matching messages. */
export class StoreError extends Error {
  readonly kind: StoreErrorKind;
  /** Per-issue validation messages, when the failure came from a zod schema. */
  readonly issues: readonly string[] | undefined;
  readonly detail: string | undefined;

  constructor(kind: StoreErrorKind, message: string, extra?: { issues?: readonly string[]; detail?: string }) {
    super(message);
    this.name = "StoreError";
    this.kind = kind;
    this.issues = extra?.issues;
    this.detail = extra?.detail;
  }
}

export function isStoreError(value: unknown): value is StoreError {
  return value instanceof StoreError;
}

/** `seq` is the log position; `ledger_entry_ids` are the movements this event caused. */
export interface AppendResult {
  readonly event_id: string;
  readonly seq: number;
  readonly ledger_entry_ids: readonly string[];
}

// ---------------------------------------------------------------------------
// Append-only enforcement
// ---------------------------------------------------------------------------

/** Tables that may only ever be INSERTed into. */
export const APPEND_ONLY_TABLES: readonly string[] = ["events", "ledger_entry"];

/**
 * SQL that mutates the log rather than appending to it.
 *
 * `INSERT ... ON CONFLICT DO UPDATE` counts: it updates an existing row, so it is rejected here even
 * though it starts with INSERT. The projections legitimately use that idiom, but never against these
 * two tables — the log is immutable and the ledger is history.
 */
const MUTATING_SQL = /\b(?:update|delete|replace)\b/i;
const ON_CONFLICT_UPDATE = /\bon\s+conflict\b[\s\S]*?\bdo\s+update\b/i;

function touchesAppendOnlyTable(sql: string): boolean {
  return APPEND_ONLY_TABLES.some((table) => new RegExp(`\\b${table}\\b`, "i").test(sql));
}

/**
 * Throws if `sql` would update or delete an append-only row.
 *
 * Call it before any raw SQL that is not obviously safe. `guardAppendOnly` wraps a whole database
 * instead, which is the stronger option and the one routes should use.
 */
export function assertAppendOnly(sql: string): void {
  if (!touchesAppendOnlyTable(sql)) return;
  if (!MUTATING_SQL.test(sql) && !ON_CONFLICT_UPDATE.test(sql)) return;
  throw new StoreError("append_only_violation", `append-only table written with mutating SQL: ${sql.trim().slice(0, 120)}`, {
    detail: sql,
  });
}

/**
 * A `Db` that refuses UPDATE/DELETE against `events` and `ledger_entry`.
 *
 * The cheapest possible guarantee: there is no code path in the app that can even express the
 * mistake, because the statement never reaches SQLite. The check is on the SQL, so binding values
 * cannot change the verdict. Reads and appends pass straight through.
 */
export function guardAppendOnly(db: Db): Db {
  return {
    prepare: (sql: string) => {
      assertAppendOnly(sql);
      return db.prepare(sql);
    },
    batch: (statements) => db.batch(statements),
    exec: (sql: string) => {
      assertAppendOnly(sql);
      return db.exec(sql);
    },
  };
}

// ---------------------------------------------------------------------------
// Append
// ---------------------------------------------------------------------------

/**
 * Validate one event, mint or accept its ledger entry ids, and hand the caller the exact statements
 * to run. Split out from `appendEvent` so a test can inspect the plan without touching a database.
 *
 * `JadalEvent.parse` is the authority on shape — including `turn.delivered.overrun_h`'s default — so
 * what is written to `events.payload` is always the parsed event, never the caller's raw object.
 */
export function planAppend(input: unknown): { event: JadalEvent; plan: AppendPlan } {
  const parsed = JadalEvent.safeParse(input);
  if (!parsed.success) {
    throw new StoreError("invalid_event", "event does not match the JadalEvent contract", {
      issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    });
  }
  const event = parsed.data;

  const ledgerStatements: Array<{ sql: string; bindings: unknown[] }> = [];
  const ledgerEntryIds: string[] = [];
  entriesFor(event).forEach((raw, index) => {
    // `event_id` is forced to the event's own id: the foreign key must agree with the row we are
    // about to insert, and `entriesFor` is a pure function of the event so it already carries it.
    const candidate = LedgerEntry.safeParse({ ...raw, event_id: event.id });
    if (!candidate.success) {
      throw new StoreError("invalid_ledger_entry", `entriesFor(${event.type}) produced an invalid ledger entry`, {
        issues: candidate.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
        detail: `entry index ${index}`,
      });
    }
    const entry = candidate.data;
    // Mirrors the migration's CHECK constraints so the failure names the cause instead of surfacing
    // as an opaque SQLite constraint error from the middle of the batch.
    if (entry.from === entry.to) {
      throw new StoreError(
        "invalid_ledger_entry",
        `ledger entry ${entry.id} moves water from ${entry.from} to ${entry.to}: accounts must differ`,
      );
    }
    if (!(entry.volume_m3 > 0) || !Number.isFinite(entry.volume_m3)) {
      throw new StoreError("invalid_ledger_entry", `ledger entry ${entry.id} has volume_m3 ${entry.volume_m3}; must be > 0`);
    }
    ledgerEntryIds.push(entry.id);
    ledgerStatements.push({
      sql: `INSERT INTO ledger_entry (id, at, from_account, to_account, volume_m3, reason, event_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      bindings: [entry.id, entry.at, entry.from, entry.to, entry.volume_m3, entry.reason, entry.event_id],
    });
  });

  const eventStatement = {
    sql: `INSERT INTO events (id, at, canal_id, type, actor_kind, actor_id, payload, logged_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    bindings: [
      event.id,
      event.at,
      event.canal_id,
      event.type,
      event.actor.kind,
      event.actor.id,
      JSON.stringify(event),
      new Date().toISOString(),
    ],
  };

  return {
    event,
    plan: {
      eventStatement,
      projectionStatements: projectionsFor(event),
      ledgerStatements,
      ledgerEntryIds,
    },
  };
}

/** The full statement plan for one append, in execution order. Exported for tests. */
export interface AppendPlan {
  readonly eventStatement: { sql: string; bindings: readonly unknown[] };
  readonly projectionStatements: readonly { sql: string; bindings: readonly unknown[] }[];
  readonly ledgerStatements: readonly { sql: string; bindings: readonly unknown[] }[];
  readonly ledgerEntryIds: readonly string[];
}

/**
 * Append one event. The only way to change state.
 *
 * @throws {StoreError} `invalid_event` if the event does not match `JadalEvent`; `duplicate_event` if
 *   `event.id` is already in the log; `invalid_ledger_entry` if `entriesFor` breaks the double-entry
 *   rules; `constraint` for any other rejection from the batch.
 */
export async function appendEvent(env: DbEnv, event: JadalEvent): Promise<AppendResult> {
  const { event: parsed, plan } = planAppend(event);

  // Cheap, clear pre-check. The UNIQUE index is what actually guarantees correctness under
  // concurrency; this only turns the common case (a retried request) into a legible error.
  const existing = await env.DB.prepare("SELECT seq FROM events WHERE id = ?").bind(parsed.id).first<{ seq: number }>();
  if (existing !== null) {
    throw new StoreError("duplicate_event", `event ${parsed.id} is already in the log at seq ${existing.seq}`);
  }

  const batch = [plan.eventStatement, ...plan.projectionStatements, ...plan.ledgerStatements];
  try {
    await env.DB.batch(batch.map((statement) => env.DB.prepare(statement.sql).bind(...statement.bindings)));
  } catch (error) {
    throw translateBatchError(error, parsed);
  }

  // Read the assigned position back rather than trusting `lastInsertRowid`: D1 exposes it as
  // `meta.last_row_id`, and the shim does not populate `meta` at all. One extra indexed read buys
  // portability across both, and the read happens after the batch committed, so it cannot race.
  const row = await env.DB.prepare("SELECT seq FROM events WHERE id = ?").bind(parsed.id).first<{ seq: number }>();
  if (row === null) {
    throw new StoreError("constraint", `event ${parsed.id} vanished immediately after being appended`);
  }

  return { event_id: parsed.id, seq: row.seq, ledger_entry_ids: plan.ledgerEntryIds };
}

function translateBatchError(error: unknown, event: JadalEvent): StoreError {
  const message = error instanceof Error ? error.message : String(error);
  if (/events\.id/i.test(message) && /unique|constraint/i.test(message)) {
    return new StoreError("duplicate_event", `event ${event.id} is already in the log`, { detail: message });
  }
  if (/ledger_entry/i.test(message) && /check constraint|constraint/i.test(message)) {
    return new StoreError("invalid_ledger_entry", `event ${event.id} produced a ledger entry the schema rejected`, {
      detail: message,
    });
  }
  return new StoreError("constraint", `appending ${event.type} (${event.id}) violated the schema`, { detail: message });
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export interface ReadEventsOptions {
  /** Restrict to these `JadalEvent.type` values. */
  types?: readonly JadalEventType[];
  /** Most rows to return. Applied after ordering, so it keeps the *oldest* N. */
  limit?: number;
  /** Return only events appended after this `seq` — the demo-replay cursor. */
  sinceSeq?: number;
  canalId?: string;
}

/**
 * Events in `seq` order, oldest first. The demo and the `/api/events` route both render this list
 * forwards, so "newest last" is the natural reading.
 */
export async function readEvents(env: DbEnv, options: ReadEventsOptions = {}): Promise<JadalEvent[]> {
  const where: string[] = [];
  const bindings: unknown[] = [];

  if (options.types !== undefined && options.types.length > 0) {
    where.push(`type IN (${options.types.map(() => "?").join(", ")})`);
    bindings.push(...options.types);
  }
  if (options.sinceSeq !== undefined) {
    where.push("seq > ?");
    bindings.push(options.sinceSeq);
  }
  if (options.canalId !== undefined) {
    where.push("canal_id = ?");
    bindings.push(options.canalId);
  }

  let sql = "SELECT payload FROM events";
  if (where.length > 0) sql += ` WHERE ${where.join(" AND ")}`;
  sql += " ORDER BY seq ASC";
  if (options.limit !== undefined) {
    sql += " LIMIT ?";
    bindings.push(options.limit);
  }

  const rows = resultRows(await env.DB.prepare(sql).bind(...bindings).all<{ payload: string }>());
  return rows.map((row) => JadalEvent.parse(JSON.parse(row.payload)));
}

/** How many events are in the log. Cheap (`COUNT(*)` on the primary key) and the demo's step counter. */
export async function getEventCount(env: DbEnv): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM events").first<{ n: number }>();
  return row === null ? 0 : row.n;
}