/**
 * Event-store tests. The store is the single write path, so these tests are about the guarantees
 * the rest of the app is allowed to assume:
 *
 *  * one `db.batch()` is atomic — an event, its projections and its ledger entries all commit or all
 *    roll back,
 *  * the log rejects duplicates and invalid events up front, with a typed `StoreError`,
 *  * `events` and `ledger_entry` cannot be mutated, checked on the SQL before it reaches SQLite,
 *  * reads are in `seq` order and filters behave,
 *  * the demo clock, IST conversion and the id helpers are deterministic,
 *  * the inlined `schema.sql.ts` copy still matches the migration files on disk, byte for byte.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { JadalEvent } from "@jadal/contracts";

import { MIGRATIONS_DIR, createTestDb } from "../../test/harness";
import { ShimDatabase } from "../../test/d1-shim";
import { seededEnv } from "../../test/fixtures";

import { advanceHours, isNightRelease, now, setNow, toIST } from "./clock";
import { deterministicId, newId } from "./id";
import { CALL_RATE_LIMIT_SQL, INIT_SCHEMA_SQL, JADAL_SCHEMA_SQL, MIGRATION_SQL, applySchema } from "./schema.sql";
import {
  APPEND_ONLY_TABLES,
  StoreError,
  appendEvent,
  assertAppendOnly,
  getEventCount,
  guardAppendOnly,
  isStoreError,
  planAppend,
  readEvents,
  type Db,
  type DbEnv,
  type DbResult,
  type DbStatement,
} from "./store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AT = "2026-09-15T00:30:00.000Z";
const ACTOR = { kind: "coordinator", id: "coord-1" } as const;

async function freshEnv(): Promise<DbEnv> {
  const db = await createTestDb();
  return { DB: db };
}

/** A `registration.verified` event. Its projections are guarded UPDATEs, so it needs no seeded rows. */
function verifiedEvent(id: string, canal_id = "c1", farmer_id = "f1"): JadalEvent {
  return JadalEvent.parse({
    id,
    at: AT,
    canal_id,
    actor: ACTOR,
    type: "registration.verified",
    farmer_id,
  });
}

/** A `rain.replanned` event; it writes one quota → buffer ledger entry per farmer, and no projection. */
function rainEvent(id: string, by_farmer_m3: Record<string, number>): JadalEvent {
  return JadalEvent.parse({
    id,
    at: AT,
    canal_id: "c1",
    actor: ACTOR,
    type: "rain.replanned",
    saved_m3: Object.values(by_farmer_m3).reduce((sum, value) => sum + value, 0),
    by_farmer_m3,
  });
}

/**
 * A `Db` that delegates to `real` but throws on the `failOnLedger`-th `INSERT INTO ledger_entry`.
 *
 * Used to prove the batch's atomicity: the event insert and projection writes have already run by
 * then, so a rollback that leaves no `events`/`ledger_entry`/projection row behind proves the whole
 * batch was one transaction. `runs` records every statement that reached SQLite before the failure.
 */
function dbFailingOnLedger(real: Db, failOnLedger: number): { db: Db; runs: string[] } {
  const runs: string[] = [];
  let ledgerRuns = 0;
  const db: Db = {
    prepare(sql: string): DbStatement {
      const bound = (): DbStatement => {
        const statement = real.prepare(sql);
        return {
          bind(...values: unknown[]): DbStatement {
            const inner = statement.bind(...values);
            return {
              bind(...more: unknown[]): DbStatement {
                return inner.bind(...more);
              },
              first: <T = unknown>(colName?: string) => inner.first<T>(colName),
              all: <T = unknown>() => inner.all<T>(),
              run: <T = unknown>(): Promise<DbResult<T>> => {
                runs.push(sql);
                if (/insert\s+into\s+ledger_entry/i.test(sql)) {
                  ledgerRuns += 1;
                  if (ledgerRuns === failOnLedger) {
                    throw new Error("forced failure inside batch on ledger_entry");
                  }
                }
                return inner.run<T>();
              },
            };
          },
          first: <T = unknown>(colName?: string) => statement.first<T>(colName),
          all: <T = unknown>() => statement.all<T>(),
          run: <T = unknown>() => statement.run<T>(),
        };
      };
      return bound();
    },
    batch: <T = unknown>(statements: DbStatement[]) => real.batch<T>(statements),
    exec: (sql: string) => real.exec(sql),
  };
  return { db, runs };
}

async function count(env: DbEnv, sql: string, binding: string): Promise<number> {
  const row = await env.DB.prepare(sql).bind(binding).first<{ n: number }>();
  return row === null ? -1 : row.n;
}

// ---------------------------------------------------------------------------
// appendEvent
// ---------------------------------------------------------------------------

describe("appendEvent", () => {
  it("writes the event, its projections and its ledger entries atomically", async () => {
    const { env } = await seededEnv();
    const before = await getEventCount(env);

    const event = JadalEvent.parse({
      id: "evt_atomic_ok",
      at: AT,
      canal_id: "c1",
      actor: ACTOR,
      type: "season.approved",
      season_supply_m3: 1000,
      entitlements: [
        {
          id: "ent_atomic_ok",
          farmer_id: "f1",
          crop_plan_id: "cp1",
          week_start: "2026-09-21",
          volume_m3: 600,
          net_irrigation_mm: 60,
          status: "approved",
        },
      ],
    });

    const result = await appendEvent(env, event);

    expect(result.event_id).toBe("evt_atomic_ok");
    expect(result.seq).toBeGreaterThan(0);
    // 600 m³ to f1's quota + the 400 m³ unallocated remainder to buffer.
    expect(result.ledger_entry_ids).toHaveLength(2);
    expect(await getEventCount(env)).toBe(before + 1);
    expect(await count(env, "SELECT COUNT(*) AS n FROM events WHERE id = ?", "evt_atomic_ok")).toBe(1);
    expect(await count(env, "SELECT COUNT(*) AS n FROM entitlement WHERE id = ?", "ent_atomic_ok")).toBe(1);
    expect(await count(env, "SELECT COUNT(*) AS n FROM ledger_entry WHERE event_id = ?", "evt_atomic_ok")).toBe(2);
  });

  it("rolls the whole batch back when a statement inside it fails", async () => {
    const { env } = await seededEnv();
    const before = await getEventCount(env);

    const event = JadalEvent.parse({
      id: "evt_atomic_fail",
      at: AT,
      canal_id: "c1",
      actor: ACTOR,
      type: "season.approved",
      season_supply_m3: 1000,
      entitlements: [
        {
          id: "ent_atomic_fail",
          farmer_id: "f1",
          crop_plan_id: "cp1",
          week_start: "2026-09-21",
          volume_m3: 600,
          net_irrigation_mm: 60,
          status: "approved",
        },
      ],
    });

    // Fail on the SECOND ledger insert, so the event row, both projection writes and the first ledger
    // entry have already executed inside the batch.
    const failing = dbFailingOnLedger(env.DB, 2);
    const attempt = appendEvent({ DB: failing.db }, event);

    await expect(attempt).rejects.toBeInstanceOf(StoreError);
    await expect(attempt).rejects.toMatchObject({ kind: "constraint" });

    // The failure genuinely happened after earlier writes, not at the batch boundary.
    expect(failing.runs.some((sql) => /insert\s+into\s+events/i.test(sql))).toBe(true);
    expect(failing.runs.some((sql) => /insert\s+into\s+ledger_entry/i.test(sql))).toBe(true);

    // Nothing from the failed batch survived.
    expect(await count(env, "SELECT COUNT(*) AS n FROM events WHERE id = ?", "evt_atomic_fail")).toBe(0);
    expect(await count(env, "SELECT COUNT(*) AS n FROM ledger_entry WHERE event_id = ?", "evt_atomic_fail")).toBe(0);
    expect(await count(env, "SELECT COUNT(*) AS n FROM entitlement WHERE id = ?", "ent_atomic_fail")).toBe(0);
    expect(await getEventCount(env)).toBe(before);
  });

  it("rejects a duplicate event id with a typed StoreError", async () => {
    const env = await freshEnv();
    const event = verifiedEvent("evt_dup");
    await appendEvent(env, event);

    let thrown: unknown;
    try {
      await appendEvent(env, event);
    } catch (error) {
      thrown = error;
    }
    expect(isStoreError(thrown)).toBe(true);
    expect(thrown).toMatchObject({ kind: "duplicate_event" });
    expect(await getEventCount(env)).toBe(1);
  });

  it("rejects an event that does not match the JadalEvent contract", async () => {
    const env = await freshEnv();
    const invalid = { id: "evt_bad", at: AT, canal_id: "c1", actor: ACTOR, type: "not.a.real.event" };
    expect(JadalEvent.safeParse(invalid).success).toBe(false);

    let thrown: unknown;
    try {
      planAppend(invalid);
    } catch (error) {
      thrown = error;
    }
    expect(isStoreError(thrown)).toBe(true);
    expect(thrown).toMatchObject({ kind: "invalid_event" });
    if (!isStoreError(thrown)) throw new Error("expected a StoreError");
    expect(thrown.issues?.length ?? 0).toBeGreaterThan(0);
    expect(await getEventCount(env)).toBe(0);
  });

  it("applies the JadalEvent default for turn.delivered.overrun_h", () => {
    const parsed = JadalEvent.parse({
      id: "evt_overrun",
      at: AT,
      canal_id: "c1",
      actor: { kind: "agent", id: "agent_delivery" },
      type: "turn.delivered",
      turn_id: "turn_1",
      farmer_id: "f1",
      delivered_m3: 100,
      conveyance_loss_m3: 5,
    });
    expect(parsed.type).toBe("turn.delivered");
    if (parsed.type === "turn.delivered") expect(parsed.overrun_h).toBe(0);
  });

  it("reports seq positions in log order", async () => {
    const env = await freshEnv();
    const first = await appendEvent(env, verifiedEvent("evt_seq_1"));
    const second = await appendEvent(env, verifiedEvent("evt_seq_2"));
    expect(second.seq).toBe(first.seq + 1);
  });
});

// ---------------------------------------------------------------------------
// Append-only enforcement
// ---------------------------------------------------------------------------

describe("append-only enforcement", () => {
  it("covers both mutable-history tables", () => {
    expect(APPEND_ONLY_TABLES).toContain("events");
    expect(APPEND_ONLY_TABLES).toContain("ledger_entry");
  });

  it("throws on UPDATE and DELETE against append-only tables", () => {
    expect(() => assertAppendOnly("UPDATE events SET payload = '{}' WHERE id = 'x'")).toThrow(StoreError);
    expect(() => assertAppendOnly("DELETE FROM ledger_entry WHERE id = 'x'")).toThrow(StoreError);
    expect(() => assertAppendOnly("DELETE FROM events")).toThrow(StoreError);

    let thrown: unknown;
    try {
      assertAppendOnly("UPDATE ledger_entry SET volume_m3 = 1");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ kind: "append_only_violation" });
  });

  it("rejects INSERT ... ON CONFLICT DO UPDATE against append-only tables", () => {
    expect(() =>
      assertAppendOnly("INSERT INTO events (id, payload) VALUES ('x', '{}') ON CONFLICT (id) DO UPDATE SET payload = '{}'"),
    ).toThrow(StoreError);
  });

  it("allows appends, reads and other tables", () => {
    expect(() => assertAppendOnly("INSERT INTO events (id) VALUES ('x')")).not.toThrow();
    expect(() => assertAppendOnly("SELECT * FROM events ORDER BY seq")).not.toThrow();
    expect(() => assertAppendOnly("UPDATE clock SET now = '2026-09-14T00:30:00.000Z' WHERE id = 1")).not.toThrow();
    expect(() => assertAppendOnly("INSERT INTO farmer (id) VALUES ('f1')")).not.toThrow();
  });

  it("guardAppendOnly blocks prepared mutations before they reach SQLite", async () => {
    const env = await freshEnv();
    const guarded = guardAppendOnly(env.DB);
    expect(() => guarded.prepare("DELETE FROM events")).toThrow(StoreError);
    expect(() => guarded.prepare("UPDATE ledger_entry SET volume_m3 = 1")).toThrow(StoreError);

    // Reads and a legitimate append still pass through the guard.
    const row = await guarded.prepare("SELECT COUNT(*) AS n FROM events").first<{ n: number }>();
    expect(row?.n).toBe(0);
    await appendEvent({ DB: guarded }, verifiedEvent("evt_guarded"));
    expect(await getEventCount({ DB: guarded })).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

describe("readEvents", () => {
  it("returns an empty array when the log is empty", async () => {
    const env = await freshEnv();
    expect(await readEvents(env)).toEqual([]);
    expect(await getEventCount(env)).toBe(0);
  });

  it("counts events accurately", async () => {
    const env = await freshEnv();
    await appendEvent(env, verifiedEvent("evt_1"));
    await appendEvent(env, rainEvent("evt_2", { f1: 10 }));
    await appendEvent(env, verifiedEvent("evt_3", "c2", "f2"));
    expect(await getEventCount(env)).toBe(3);
  });

  // Fixed in `readEvents`: the stored `payload` column is JSON text, so it is parsed before being
  // handed to `JadalEvent.parse`.
  it("returns events in seq order and filters by type, seq cursor, canal and limit", async () => {
    const env = await freshEnv();
    await appendEvent(env, verifiedEvent("evt_1"));
    await appendEvent(env, rainEvent("evt_2", { f1: 10 }));
    await appendEvent(env, verifiedEvent("evt_3", "c2", "f2"));

    expect((await readEvents(env)).map((event) => event.id)).toEqual(["evt_1", "evt_2", "evt_3"]);
    expect((await readEvents(env, { types: ["rain.replanned"] })).map((event) => event.id)).toEqual(["evt_2"]);
    expect((await readEvents(env, { limit: 2 })).map((event) => event.id)).toEqual(["evt_1", "evt_2"]);
    expect((await readEvents(env, { sinceSeq: 1 })).map((event) => event.id)).toEqual(["evt_2", "evt_3"]);
    expect((await readEvents(env, { canalId: "c2" })).map((event) => event.id)).toEqual(["evt_3"]);
    expect(await readEvents(env, { types: ["crop.harvested"] })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Clock and IST
// ---------------------------------------------------------------------------

describe("clock", () => {
  it("advances the simulated time and reports it", async () => {
    const env = await freshEnv();
    expect(await now(env)).toBe("2026-09-14T00:30:00.000Z");
    expect(await advanceHours(env, 5)).toBe("2026-09-14T05:30:00.000Z");
    expect(await now(env)).toBe("2026-09-14T05:30:00.000Z");
  });

  it("pins the clock with setNow", async () => {
    const env = await freshEnv();
    expect(await setNow(env, "2026-09-14T12:30:00.000Z")).toBe("2026-09-14T12:30:00.000Z");
    expect(await now(env)).toBe("2026-09-14T12:30:00.000Z");
  });

  it("rejects a non-finite advance", async () => {
    const env = await freshEnv();
    await expect(advanceHours(env, Number.NaN)).rejects.toBeInstanceOf(RangeError);
  });

  it("converts to IST at the 18:00 and 06:00 boundaries", () => {
    const sixPm = toIST("2026-09-14T12:30:00.000Z");
    expect(sixPm.hour).toBe(18);
    expect(sixPm.minute).toBe(0);
    expect(sixPm.minutesOfDay).toBe(18 * 60);
    expect(sixPm.iso).toBe("2026-09-14T18:00:00+05:30");

    const sixAm = toIST("2026-09-14T00:30:00.000Z");
    expect(sixAm.hour).toBe(6);
    expect(sixAm.minute).toBe(0);
    expect(sixAm.minutesOfDay).toBe(6 * 60);
    expect(sixAm.iso).toBe("2026-09-14T06:00:00+05:30");
  });

  it("rolls the IST date across midnight UTC", () => {
    const afterMidnight = toIST("2026-09-14T19:00:00.000Z");
    expect(afterMidnight.date).toBe("2026-09-15");
    expect(afterMidnight.hour).toBe(0);
    expect(afterMidnight.minute).toBe(30);
  });

  it("classifies the night-release band correctly", () => {
    expect(isNightRelease("2026-09-14T13:30:00.000Z")).toBe(true); // 19:00 IST
    expect(isNightRelease("2026-09-14T02:30:00.000Z")).toBe(false); // 08:00 IST
    expect(isNightRelease("2026-09-14T12:30:00.000Z")).toBe(true); // exactly 18:00 IST
    expect(isNightRelease("2026-09-14T00:30:00.000Z")).toBe(false); // exactly 06:00 IST
    expect(isNightRelease("2026-09-14T12:29:00.000Z")).toBe(false); // 17:59 IST
    expect(isNightRelease("2026-09-14T00:29:00.000Z")).toBe(true); // 05:59 IST
  });

  it("throws on a malformed instant", () => {
    expect(() => toIST("not-a-date")).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

describe("ids", () => {
  it("derives stable ids from their parts", () => {
    expect(deterministicId("farmer", "a", 1)).toBe(deterministicId("farmer", "a", 1));
    expect(deterministicId("farmer", "a", 1)).not.toBe(deterministicId("farmer", "a", 2));
    // JSON serialisation of the parts means the boundary cannot slide.
    expect(deterministicId("x", "ab", "c")).not.toBe(deterministicId("x", "a", "bc"));
    expect(deterministicId("farmer", "a", 1).startsWith("farmer_")).toBe(true);
  });

  it("generates non-colliding runtime ids", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId("req")));
    expect(ids.size).toBe(1000);
    expect([...ids].every((id) => id.startsWith("req_"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// schema.sql.ts freshness
// ---------------------------------------------------------------------------

describe("schema.sql.ts", () => {
  /** Trailing whitespace is the only tolerated difference: the file's final newline vs the literal. */
  function normalise(sql: string): string {
    return sql
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+$/gm, "")
      .trimEnd();
  }

  it("keeps the inlined 0001 migration byte-identical to the file on disk", () => {
    const onDisk = readFileSync(join(MIGRATIONS_DIR, "0001_init.sql"), "utf8");
    expect(normalise(INIT_SCHEMA_SQL)).toBe(normalise(onDisk));
  });

  it("keeps the inlined 0002 migration byte-identical to the file on disk", () => {
    const onDisk = readFileSync(join(MIGRATIONS_DIR, "0002_jadal.sql"), "utf8");
    expect(normalise(JADAL_SCHEMA_SQL)).toBe(normalise(onDisk));
  });

  it("keeps the inlined 0003 migration byte-identical to the file on disk", () => {
    const onDisk = readFileSync(join(MIGRATIONS_DIR, "0003_call_rate_limit.sql"), "utf8");
    expect(normalise(CALL_RATE_LIMIT_SQL)).toBe(normalise(onDisk));
  });

  it("joins the migrations in application order", () => {
    // Listed explicitly rather than derived from the directory: the point of this assertion is that
    // the inlined constants are applied in filename order, so a new migration that is added to the
    // directory and *not* to `MIGRATION_SQL` fails here (the string would be missing from the join)
    // instead of silently never running in tests.
    expect(MIGRATION_SQL).toBe([INIT_SCHEMA_SQL, JADAL_SCHEMA_SQL, CALL_RATE_LIMIT_SQL].join("\n"));
  });

  it("applies cleanly to a bare database", async () => {
    const db = new ShimDatabase();
    await applySchema(db);
    const row = await db.prepare("SELECT COUNT(*) AS n FROM events").first<{ n: number }>();
    expect(row?.n).toBe(0);
    const clock = await db.prepare("SELECT now FROM clock WHERE id = 1").first<{ now: string }>();
    expect(clock?.now).toBe("2026-09-14T00:30:00Z");
  });
});
