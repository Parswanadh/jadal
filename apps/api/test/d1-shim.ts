/**
 * Test-only D1 shim.
 *
 * `@cloudflare/vitest-pool-workers` cannot be installed in this environment (no registry access),
 * so tests run against a faithful D1 implementation backed by Node's built-in `node:sqlite`.
 * Both engines speak the same SQL dialect (SQLite), so the migration SQL and every query in the
 * app are exercised for real: constraints, foreign keys, indexes, JSON1 functions, transactions.
 *
 * The surface intentionally mirrors the `D1Database` binding declared in `src/env.d.ts`:
 *   prepare(sql).bind(...).first()/.all()/.run()/.raw(), plus db.batch() and db.exec().
 *
 * Only used from tests and local tooling. Never imported by application code.
 */

import { DatabaseSync, type StatementSync } from "node:sqlite";

/** Anything D1 accepts as a bind parameter. */
export type BindValue = string | number | boolean | null | Uint8Array;

/** What node:sqlite accepts once booleans have been normalised. */
type SqlValue = string | number | bigint | null | Uint8Array;

type Row = Record<string, unknown>;

/**
 * Node's sqlite driver only binds null | number | bigint | string | Uint8Array.
 * D1 additionally binds booleans, so normalise them.
 */
function normalise(value: unknown): SqlValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Uint8Array) return value;
  if (typeof value === "number" || typeof value === "string") return value;
  throw new TypeError(`D1 shim: unsupported bind value of type ${typeof value}`);
}

export class ShimStatement {
  readonly #sql: string;
  readonly #bound: SqlValue[] = [];
  #stmt: StatementSync | undefined;

  constructor(
    private readonly db: DatabaseSync,
    sql: string,
  ) {
    this.#sql = sql;
  }

  bind(...values: unknown[]): ShimStatement {
    this.#bound.push(...values.map(normalise));
    return this;
  }

  #prepare(): StatementSync {
    // node:sqlite refuses to bind more parameters than the statement declares, exactly like D1.
    this.#stmt ??= this.db.prepare(this.#sql);
    return this.#stmt;
  }

  #run(): unknown[] {
    const stmt = this.#prepare();
    return this.#bound.length > 0 ? stmt.all(...this.#bound) : stmt.all();
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const rows = this.#run();
    const row = rows[0] as Row | undefined;
    if (row === undefined) return null;
    if (colName !== undefined) return (row[colName] ?? null) as T;
    // Strip the null prototype that node:sqlite adds so deep-equal comparisons behave.
    return { ...row } as T;
  }

  async all<T = unknown>(): Promise<ShimResult<T>> {
    return {
      success: true,
      meta: { changes: 0 },
      results: this.#run().map((row) => ({ ...(row as Row) })) as T[],
    };
  }

  async raw<T = unknown>(): Promise<T[]> {
    const stmt = this.#prepare();
    const rows = this.#bound.length > 0 ? stmt.all(...this.#bound) : stmt.all();
    // `raw()` returns arrays of column values, not objects.
    return rows.map((row) => Object.values(row as Row)) as T[];
  }

  async run<T = unknown>(): Promise<ShimResult<T>> {
    const stmt = this.#prepare();
    // `all()` executes the statement; `run()` additionally reports change counts, which is what
    // D1 surfaces via meta.changes. SELECTs return zero rows, so changes stays 0.
    const rows = this.#run();
    const meta = this.db.prepare("SELECT total_changes() AS changes").get() as Row | undefined;
    const result: ShimResult<T> = {
      success: true,
      meta: { changes: Number(meta?.changes ?? 0) },
      results: rows.map((row) => ({ ...(row as Row) })) as T[],
    };
    void stmt;
    return result;
  }
}

export interface ShimResult<T = unknown> {
  success: boolean;
  meta: Record<string, unknown>;
  results?: T[];
}

export class ShimDatabase {
  #db: DatabaseSync;
  /** Nesting depth so `batch()` inside `batch()` still opens exactly one transaction. */
  #txDepth = 0;

  constructor(filename = ":memory:") {
    this.#db = new DatabaseSync(filename);
    this.#db.exec("PRAGMA foreign_keys = ON");
  }

  prepare(sql: string): ShimStatement {
    return new ShimStatement(this.#db, sql);
  }

  /** Mirrors D1: all statements run atomically, in order, inside one transaction. */
  async batch<T = unknown>(statements: ShimStatement[]): Promise<ShimResult<T>[]> {
    const outermost = this.#txDepth === 0;
    if (outermost) this.#db.exec("BEGIN");
    this.#txDepth += 1;
    try {
      const results: ShimResult<T>[] = [];
      for (const statement of statements) {
        results.push(await statement.run<T>());
      }
      if (outermost) this.#db.exec("COMMIT");
      return results;
    } catch (error) {
      if (outermost) this.#db.exec("ROLLBACK");
      throw error;
    } finally {
      this.#txDepth -= 1;
    }
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    this.#db.exec(sql);
    return { count: 0, duration: 0 };
  }

  /** Test helpers, not part of the D1 surface. */
  close(): void {
    this.#db.close();
  }

  checkpoint(): void {
    this.#db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }
}

/**
 * Boot a fresh in-memory database with the given migrations applied.
 * @param migrations SQL files in filename order.
 */
export async function createTestDb(migrations: string[]): Promise<ShimDatabase> {
  const db = new ShimDatabase();
  for (const migration of migrations) {
    await db.exec(migration);
  }
  return db;
}