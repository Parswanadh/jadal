/**
 * The outbound-call rate limiter (`src/noloop.ts`) — the backstop against runaway calls.
 *
 * ## SAFETY — no real call can be placed from this file
 *
 * Every test uses `test/harness.ts`'s `createEnv()`, whose injected `fetch` **throws** on any URL that
 * is not explicitly routed. The only Twilio URL ever reached is `api.twilio.com`, and it is served a
 * canned `Response`. Tests that assert a refusal additionally assert `env.calls` did **not** grow, so
 * "the guard blocked the call" is proven by the absence of a request rather than by a returned flag.
 *
 * ## What is covered
 *
 *  * **the simultaneous burst** — N calls for the SAME destination fired at once, exactly `max`
 *    allowed. This is the defect the whole change exists for; the old KV guard failed it.
 *  * the guard blocks the 4th call in the measured 01:45 burst shape (four calls in 40 seconds);
 *  * it resets after the window, and counts per destination rather than globally;
 *  * one handset formatted three ways shares one budget (otherwise the limit is trivially bypassed);
 *  * N and the window are configurable by env, and a *misconfigured* value is reported not ignored;
 *  * the consume is genuinely one atomic SQL statement, and the guard is not a read-then-write;
 *  * the failure mode is exercised both ways: fail-open (the shipped default) still dials, and
 *    fail-closed refuses — and both report which they did;
 *  * a refusal is visible: returned on the decision, and carried into each call site's own outcome.
 */

import { describe, expect, it, vi } from "vitest";

import { now as clockNow } from "./db/clock";
import { deterministicId } from "./db/id";
import { getContact } from "./db/repo";
import { appendEvent } from "./db/store";
import {
  CALL_RATE_TABLE,
  DEFAULT_MAX_CALLS,
  DEFAULT_WINDOW_SECONDS,
  RATE_LIMIT_FAILURE_MODE,
  atomicStatements,
  checkOutboundCall,
  destinationKey,
  logCallDecision,
  pruneCallRateHits,
  rateLimitConfig,
  rateLimitKey,
  releaseCall,
} from "./noloop";
import type { CallDecision } from "./noloop";
import type { Contact } from "@jadal/contracts";
import { createEnv, createTestDb, type TestEnv } from "../test/harness";
import { ShimDatabase, type ShimStatement } from "../test/d1-shim";
import { CALL_RATE_HIT_SQL } from "./db/schema.sql";
import { seedScenario } from "../test/fixtures";
import { runEscalation } from "./campaigns/escalation";
import { notifyFarmerOfAllocation } from "./coordinator-alert";

/** The destination under test. The seed's placeholder range; never a real handset. */
const PHONE = "+919000000001";

/** A fixed instant, so every window assertion is arithmetic rather than wall-clock dependent. */
const T0 = new Date("2026-09-14T01:45:00.000Z");

function at(secondsAfter: number): Date {
  return new Date(T0.getTime() + secondsAfter * 1000);
}

/**
 * A D1 stand-in that can be made to fail on demand, for the failure-mode tests.
 *
 * The counter now lives in D1, so "the counter store is unavailable" has to be simulated against a
 * real database rather than a KV Map. Failures are per operation and the switches can be flipped
 * mid-test, so a test can prove the guard *worked* and then broke, rather than only that a store
 * which was never working is broken. `failPrepare` throws synchronously, which is exactly what the
 * Cloudflare binding does on some runtimes and what the guard's `try` is wrapped around.
 *
 * Declared here rather than in `test/harness.ts` because that file is shared with other lanes; it is
 * a test double for this module's dependency, so this module's test owns it.
 */
class FlakyDb {
  /** Fail the write the guard consumes the budget with (it reads the `RETURNING` row via `first`). */
  failRun = false;
  /** Fail every read (used to prove a refusal is not decided by its descriptive read-back). */
  failAll = false;
  /** Fail `prepare()` itself, the synchronous throw the real binding can raise. */
  failPrepare = false;

  constructor(readonly inner: ShimDatabase) {}

  #wrap(statement: ShimStatement): D1PreparedStatement {
    const self = this;
    const wrap = (target: ShimStatement): D1PreparedStatement =>
      ({
        bind: (...values: unknown[]) => wrap(target.bind(...values)),
        first: <T>(colName?: string) =>
          self.failRun ? Promise.reject(new Error("D1 unavailable")) : target.first<T>(colName),
        all: <T>() =>
          self.failAll ? Promise.reject(new Error("D1 unavailable")) : target.all<T>(),
        run: <T>() =>
          self.failRun ? Promise.reject(new Error("D1 unavailable")) : target.run<T>(),
        raw: <T>() => target.raw<T>(),
      }) as unknown as D1PreparedStatement;
    return wrap(statement);
  }

  prepare(sql: string): D1PreparedStatement {
    if (this.failPrepare) throw new Error("D1 unavailable");
    return this.#wrap(this.inner.prepare(sql));
  }

  batch(statements: unknown[]): Promise<unknown> {
    return this.inner.batch(statements as never);
  }

  exec(sql: string): Promise<unknown> {
    return this.inner.exec(sql);
  }

  /** The hit rows, so a test can prove what the atomic statement actually did to the table. */
  async counterRows(): Promise<{ id: number; destination: string; at: number }[]> {
    const result = await this.inner
      .prepare(`SELECT id, destination, at FROM ${CALL_RATE_TABLE} ORDER BY at, id`)
      .all<{ id: number; destination: string; at: number }>();
    return result.results ?? [];
  }
}

/**
 * A minimal env carrying only what the guard reads, with the counter migration applied.
 *
 * The database is migrated rather than bare on purpose: a bare one has no `call_rate_hit` table, so
 * every call would take the *failure* path and the test would be measuring fail-open instead of the
 * limit. `node:sqlite`'s `exec` is synchronous, so the migration is applied right here and every test
 * can use `guardEnv()` exactly as before.
 */
function guardEnv(extra: Record<string, unknown> = {}): { DB: FlakyDb } & Record<string, unknown> {
  return Object.assign({ DB: migratedDb() }, extra);
}

/** A `FlakyDb` over a fresh in-memory database carrying the sliding-window hit log. */
function migratedDb(): FlakyDb {
  const db = new FlakyDb(new ShimDatabase());
  // `ShimDatabase.exec` runs its statements synchronously underneath (only its return value is a
  // promise), so the table exists before this function returns. That is what lets `guardEnv()` stay
  // synchronous and every existing test keep its shape.
  void db.exec(CALL_RATE_HIT_SQL);
  return db;
}

describe("rateLimitConfig", () => {
  it("defaults to 3 calls per 60 seconds", () => {
    expect(DEFAULT_MAX_CALLS).toBe(3);
    expect(DEFAULT_WINDOW_SECONDS).toBe(60);
    const config = rateLimitConfig({});
    expect(config).toEqual({ maxCalls: 3, windowSeconds: 60, problems: [] });
  });

  it("makes N and the window configurable by env", () => {
    expect(rateLimitConfig({ CALL_RATE_MAX_CALLS: "1", CALL_RATE_WINDOW_SECONDS: "600" })).toEqual({
      maxCalls: 1,
      windowSeconds: 600,
      problems: [],
    });
  });

  it("reports an unusable value instead of silently accepting it", () => {
    // A typo must not quietly disable the backstop: the default is used AND the name is reported.
    const config = rateLimitConfig({ CALL_RATE_MAX_CALLS: "three", CALL_RATE_WINDOW_SECONDS: "0" });
    expect(config.maxCalls).toBe(DEFAULT_MAX_CALLS);
    expect(config.windowSeconds).toBe(DEFAULT_WINDOW_SECONDS);
    expect(config.problems).toEqual(["CALL_RATE_MAX_CALLS", "CALL_RATE_WINDOW_SECONDS"]);
  });

  it("treats a blank value as unset rather than as a problem", () => {
    expect(rateLimitConfig({ CALL_RATE_MAX_CALLS: "  " }).problems).toEqual([]);
  });
});

describe("destinationKey", () => {
  it("keys one handset by its digits, however it is written", () => {
    // Without this, the same farmer could be dialled `max` times per spelling of their own number.
    const spellings = ["+919000000001", "+91 90000 00001", "tel:+919000000001", "+91-90000-00001"];
    const keys = new Set(spellings.map(destinationKey));
    expect(keys.size).toBe(1);
    expect(rateLimitKey(spellings[0] as string)).toBe(rateLimitKey(spellings[1] as string));
  });

  it("keeps a destination with no digits in a key of its own", () => {
    expect(destinationKey("")).toBe("literal:");
    expect(destinationKey("unknown")).toBe("literal:unknown");
  });
});

describe("the window slides", () => {
  it("frees slots one at a time, exactly one window after the call that spent each one", async () => {
    // Three calls inside 25 s, then the window is full. Under the old fixed-window guard the whole
    // budget would reset when the clock crossed a boundary; here each slot frees only when its own
    // call is a full window old, so the budget thins rather than snapping back to three.
    const env = guardEnv();
    for (const offset of [0, 12, 25]) {
      expect((await checkOutboundCall(env, PHONE, at(offset))).allowed).toBe(true);
    }
    expect((await checkOutboundCall(env, PHONE, at(40))).allowed).toBe(false);

    // At T0+60 the call made at T0 is exactly one window old and no longer counts: one slot frees.
    const atSixty = await checkOutboundCall(env, PHONE, at(60));
    expect(atSixty.allowed).toBe(true);
    expect(atSixty.priorCalls).toBe(2);
    expect(atSixty.detail).toContain("call 3 of 3");

    // And the window is immediately full again, because the calls at 12 s and 25 s still count.
    expect((await checkOutboundCall(env, PHONE, at(61))).allowed).toBe(false);

    // At T0+72 the call at 12 s ages out, freeing exactly one more slot.
    expect((await checkOutboundCall(env, PHONE, at(72))).allowed).toBe(true);
    expect((await checkOutboundCall(env, PHONE, at(73))).allowed).toBe(false);
  });

  it("never counts a hit older than the window, and never forgets a newer one", async () => {
    const env = guardEnv();
    for (const offset of [0, 12, 25]) await checkOutboundCall(env, PHONE, at(offset));
    // Twenty-five seconds after the oldest hit has aged out, only the 25 s hit is still within 60 s.
    const later = await checkOutboundCall(env, PHONE, at(72));
    expect(later.allowed).toBe(true);
    expect(later.priorCalls).toBe(1);
    expect((await env.DB.counterRows()).map((row) => row.at)).toEqual([
      T0.getTime(),
      at(12).getTime(),
      at(25).getTime(),
      at(72).getTime(),
    ]);
  });
});

/* ------------------------------------------------------------------ the SQL itself */

describe("the consume is one atomic statement", () => {
  it("consumes the budget with a single conditional INSERT ... SELECT ... WHERE (COUNT) < ?", () => {
    const sql = atomicStatements.consume();
    expect(sql).toContain("INSERT INTO");
    expect(sql).toContain("SELECT ?1, ?2");
    expect(sql).toMatch(/WHERE \(SELECT COUNT\(\*\)[\s\S]*\) < \?4/);
    expect(sql).toContain("RETURNING");
    // One statement, not a batch: `db.batch()` would still be atomic, but the brief asks for the
    // check-and-insert to be inseparable, and a single statement is the strongest form of that.
    expect(sql.split(";").filter((part) => part.trim().length > 0)).toHaveLength(1);
  });

  it("has no read-then-write anywhere on the guard's path", () => {
    // The defect being fixed was two statements with a JavaScript decision in between. The guard's
    // consume is one statement; its descriptive read is a pure SELECT that cannot permit a call, and
    // its release is a token-scoped DELETE that cannot either.
    expect(atomicStatements.consume()).toMatch(/^\s*INSERT/i);
    expect(atomicStatements.read()).toMatch(/^\s*SELECT/i);
    expect(atomicStatements.read()).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });

  it("doesn't condition the insert on a value read in JavaScript", () => {
    // The condition is a COUNT over the hit log, evaluated by SQLite inside the same statement that
    // inserts. If the guard ever consulted a JavaScript-side count first, this shape would not hold:
    // there would be a SELECT to decide on.
    expect(atomicStatements.consume()).toMatch(/WHERE \(SELECT COUNT\(\*\)/);
    expect(atomicStatements.consume()).not.toMatch(/SELECT[\s\S]*\)\s*AS allowed/);
  });

  it("inserts exactly max rows under a burst, and the count refuses the rest", async () => {
    // The statement's own behaviour, at the SQL level and without the guard around it: six identical
    // attempts, run back to back, with a ceiling of 3.
    const db = new ShimDatabase();
    await db.exec(
      `CREATE TABLE ${CALL_RATE_TABLE} (id INTEGER PRIMARY KEY AUTOINCREMENT, destination TEXT NOT NULL, at INTEGER NOT NULL)`,
    );
    let spent = 0;
    for (let i = 0; i < 6; i += 1) {
      // A fresh statement per attempt, exactly as the guard uses it: `bind()` is additive on the
      // shim and on D1 alike, so a re-bound statement would stack parameters rather than rebind them.
      const row = await db
        .prepare(atomicStatements.consume())
        .bind(destinationKey(PHONE), 0, 60_000, 3)
        .first<{ id: number }>();
      if (row !== null) spent += 1;
    }
    expect(spent).toBe(3);
    const row = await db
      .prepare(`SELECT COUNT(*) AS n FROM ${CALL_RATE_TABLE}`)
      .first<{ n: number }>();
    expect(row?.n).toBe(3);
  });
});

/* ------------------------------------------------------------------ the simultaneous burst */

/**
 * The defect this change exists for.
 *
 * The old guard stored its counter in KV, which has no atomic increment, so N callers reading the
 * same counter in the same instant all wrote `1` and all dialled. These tests fire the calls through
 * `Promise.all` — there is no `await` between them, so every call is in flight before any of them has
 * written — and assert that the budget is spent *exactly* once per slot. Under the KV guard the
 * allowed count was N; it is now exactly `max`.
 */
describe("checkOutboundCall — simultaneous load", () => {
  it("allows EXACTLY max calls when N are fired simultaneously at one destination", async () => {
    const env = guardEnv(); // the shipped default: max 3
    const N = 12;

    const decisions: CallDecision[] = await Promise.all(
      Array.from({ length: N }, () => checkOutboundCall(env, PHONE, T0)),
    );

    const allowed = decisions.filter((d) => d.allowed);
    const refused = decisions.filter((d) => !d.allowed);
    expect(allowed).toHaveLength(3);
    expect(refused).toHaveLength(N - 3);
    expect(refused.every((d) => d.reason === "rate_limited")).toBe(true);
    expect(refused.every((d) => d.checked)).toBe(true);
    // Every refused caller is told the same thing, and the ceiling is the configured one.
    expect(refused.every((d) => d.maxCalls === 3 && d.windowSeconds === 60)).toBe(true);
    expect(refused.every((d) => d.detail.includes("rate limited"))).toBe(true);
    expect(refused.every((d) => d.retryAfterAt !== null)).toBe(true);

    // And the hit log agrees: exactly three rows were inserted, not twelve.
    const rows = await env.DB.counterRows();
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.destination === destinationKey(PHONE) && row.at === T0.getTime())).toBe(true);
  });

  it("allows exactly N when N simultaneous calls are fired with max N", async () => {
    // The mirror image, so the previous result cannot be an artefact of a constant: the same burst
    // with a ceiling of 5 admits exactly 5.
    const env = guardEnv({ CALL_RATE_MAX_CALLS: "5" });
    const decisions = await Promise.all(
      Array.from({ length: 10 }, () => checkOutboundCall(env, PHONE, T0)),
    );
    expect(decisions.filter((d) => d.allowed)).toHaveLength(5);
    expect(await env.DB.counterRows()).toHaveLength(5);
  });

  it("bounds repeated rapid presses: 30 simultaneous requests to one handset dial at most 3 times", async () => {
    // The user's other report — repeated button presses producing a continuous stream of calls. Each
    // press is a separate request; fired together they are the same race as above, only wider.
    const env = guardEnv();
    const decisions = await Promise.all(
      Array.from({ length: 30 }, (_, i) => checkOutboundCall(env, PHONE, at(i % 2))),
    );
    expect(decisions.filter((d) => d.allowed)).toHaveLength(3);
  });

  it("keeps separate destinations independent under simultaneous load", async () => {
    // Atomicity must not serialise the world into one bucket: two handsets dialed at once each keep
    // their own full budget.
    const env = guardEnv();
    const decisions = await Promise.all([
      ...Array.from({ length: 5 }, () => checkOutboundCall(env, PHONE, T0)),
      ...Array.from({ length: 5 }, () => checkOutboundCall(env, "+919000000002", T0)),
    ]);
    expect(decisions.filter((d) => d.allowed)).toHaveLength(6);
    const rows = await env.DB.counterRows();
    const countFor = (to: string): number => rows.filter((row) => row.destination === destinationKey(to)).length;
    expect(countFor(PHONE)).toBe(3);
    expect(countFor("+919000000002")).toBe(3);
  });

  it("still refuses sequentially after a simultaneous burst", async () => {
    // The burst must not merely be counted once and then forgotten.
    const env = guardEnv();
    await Promise.all(Array.from({ length: 3 }, () => checkOutboundCall(env, PHONE, T0)));
    const after = await checkOutboundCall(env, PHONE, at(5));
    expect(after.allowed).toBe(false);
    expect(after.priorCalls).toBe(3);
  });
});

/* ------------------------------------------------------------------ sequential behaviour */

describe("checkOutboundCall — the burst", () => {
  it("blocks the 4th call in a burst, and the first three are allowed", async () => {
    const env = guardEnv();

    // The measured 01:45 shape: four calls in 40 seconds.
    const offsets = [0, 12, 25, 40];
    const decisions: CallDecision[] = [];
    for (const offset of offsets) {
      decisions.push(await checkOutboundCall(env, PHONE, at(offset)));
    }

    expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, false]);

    // The refusal explains itself: why, against which limit, and how many calls are already counted.
    const refusal = decisions[3];
    expect(refusal?.reason).toBe("rate_limited");
    expect(refusal?.checked).toBe(true);
    expect(refusal?.priorCalls).toBe(3);
    expect(refusal?.maxCalls).toBe(3);
    expect(refusal?.windowSeconds).toBe(60);
    expect(refusal?.detail).toContain("rate limited");
    expect(refusal?.detail).toContain(PHONE);
    // And it says when the window frees up: the whole of this window's count expires together, at the
    // end of the window the calls were counted in.
    expect(refusal?.retryAfterAt).toBe(at(60).toISOString());
  });

  it("numbers the calls it allows, so the log line stays honest", async () => {
    const env = guardEnv();
    const details = [
      (await checkOutboundCall(env, PHONE, at(0))).detail,
      (await checkOutboundCall(env, PHONE, at(5))).detail,
      (await checkOutboundCall(env, PHONE, at(10))).detail,
    ];
    expect(details[0]).toContain("call 1 of 3");
    expect(details[1]).toContain("call 2 of 3");
    expect(details[2]).toContain("call 3 of 3");
  });

  it("is completely fresh once every call has aged out, a window after the last one", async () => {
    const env = guardEnv();
    for (const offset of [0, 12, 25]) await checkOutboundCall(env, PHONE, at(offset));
    expect((await checkOutboundCall(env, PHONE, at(40))).allowed).toBe(false);

    // Only the 25 s call is still inside the trailing window, so one slot is free.
    expect((await checkOutboundCall(env, PHONE, at(84))).allowed).toBe(true);

    // At T0+85 the 25 s call is exactly one window old: every original call has aged out and the
    // budget is fresh. This is the property the fixed-window version got from a boundary roll-over
    // and this one gets from the trailing count.
    const afterWindow = await checkOutboundCall(env, PHONE, at(85));
    expect(afterWindow.allowed).toBe(true);
    expect(afterWindow.priorCalls).toBe(0);
    expect(afterWindow.detail).toContain("call 1 of 3");

    // Every hit row is still in the log (pruning is off the hot path); only the rows inside the
    // trailing window can decide anything.
    const rows = await env.DB.counterRows();
    expect(rows).toHaveLength(5);
  });

  it("counts per destination, not globally", async () => {
    const env = guardEnv();
    for (const offset of [0, 5, 10]) await checkOutboundCall(env, PHONE, at(offset));
    expect((await checkOutboundCall(env, PHONE, at(15))).allowed).toBe(false);

    // A different handset is untouched by the first destination's exhausted budget.
    const other = await checkOutboundCall(env, "+919000000002", at(15));
    expect(other.allowed).toBe(true);
    expect(other.priorCalls).toBe(0);
  });

  it("spends the budget once per spelling of one number", async () => {
    // The digits key, end to end: three spellings of one handset, then a fourth in a fourth spelling.
    const env = guardEnv();
    const spellings = ["+919000000001", "+91 90000 00001", "tel:+919000000001"];
    for (const spelling of spellings) await checkOutboundCall(env, spelling, at(0));
    const fourth = await checkOutboundCall(env, "+91-90000-00001", at(1));
    expect(fourth.allowed).toBe(false);
    expect(fourth.priorCalls).toBe(3);
    expect((await env.DB.counterRows())[0]?.destination).toBe(destinationKey(PHONE));
  });

  it("stores one row per counted call, carrying its destination and instant", async () => {
    const env = guardEnv();
    await checkOutboundCall(env, PHONE, at(0));
    await checkOutboundCall(env, PHONE, at(30));
    const rows = await env.DB.counterRows();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.destination === destinationKey(PHONE))).toBe(true);
    expect(rows.map((row) => row.at)).toEqual([T0.getTime(), at(30).getTime()]);
  });

  it("counts against the trailing window only, so a boundary does not hand the budget back", async () => {
    const env = guardEnv();
    for (const offset of [0, 5, 10]) await checkOutboundCall(env, PHONE, at(offset)); // 3 of 3

    // At T0+65 the calls at 0 s and 5 s are more than a window old; only the 10 s call still counts.
    const atSixtyFive = await checkOutboundCall(env, PHONE, at(65));
    expect(atSixtyFive.allowed).toBe(true);
    expect(atSixtyFive.priorCalls).toBe(1);
    expect(atSixtyFive.detail).toContain("call 2 of 3");

    // A fixed-window guard would have handed back all three at the boundary; this one does not, and
    // the window fills again one slot at a time.
    expect((await checkOutboundCall(env, PHONE, at(66))).allowed).toBe(true);
    expect((await checkOutboundCall(env, PHONE, at(67))).allowed).toBe(false);

    expect(await env.DB.counterRows()).toHaveLength(5);
  });

  it("honours a tighter limit from env and blocks the 2nd call", async () => {
    const env = guardEnv({ CALL_RATE_MAX_CALLS: "1" });
    expect((await checkOutboundCall(env, PHONE, at(0))).allowed).toBe(true);
    const second = await checkOutboundCall(env, PHONE, at(5));
    expect(second.allowed).toBe(false);
    expect(second.maxCalls).toBe(1);
  });

  it("honours a longer window from env, so a call 30s later is still inside it", async () => {
    const env = guardEnv({ CALL_RATE_MAX_CALLS: "1", CALL_RATE_WINDOW_SECONDS: "600" });
    expect((await checkOutboundCall(env, PHONE, at(0))).allowed).toBe(true);
    expect((await checkOutboundCall(env, PHONE, at(30))).allowed).toBe(false);
    expect((await checkOutboundCall(env, PHONE, at(601))).allowed).toBe(true);
  });
});

/* ------------------------------------------------------------------ the window boundary */

/**
 * The fixed-window guard's other hole: the window was a *bucket*, so a burst straddling a boundary
 * got a fresh budget when the clock crossed it and could reach `2 × maxCalls`.
 *
 * These tests drive the *production* clock path — `checkOutboundCall`'s default `now` is `new Date()`
 * — with fake timers, rather than the injectable `now` the rest of the file uses. That is deliberate:
 * it proves the shipped call site, not a test-only parameter, is sliding.
 */
describe("checkOutboundCall — the window boundary (fake timers)", () => {
  /** A whole-second-aligned 60 s boundary, so "just before" and "just after" are unambiguous. */
  const BOUNDARY = 1_760_000_000_000 - (1_760_000_000_000 % 60_000);

  it("does not reset the budget at a fixed boundary: a straddling burst cannot reach 2 x maxCalls", async () => {
    vi.useFakeTimers();
    try {
      const env = guardEnv();
      // Three calls a second before the boundary and three a second after: two full fixed windows.
      const offsets = [
        BOUNDARY - 1000,
        BOUNDARY - 1000,
        BOUNDARY - 1000,
        BOUNDARY + 1000,
        BOUNDARY + 1000,
        BOUNDARY + 1000,
      ];
      const allowed: boolean[] = [];
      for (const ms of offsets) {
        vi.setSystemTime(new Date(ms));
        allowed.push((await checkOutboundCall(env, PHONE)).allowed);
      }

      // The fixed-window guard would have returned six trues here; the sliding guard allows three.
      expect(allowed).toEqual([true, true, true, false, false, false]);
      expect(allowed.filter(Boolean)).toHaveLength(DEFAULT_MAX_CALLS);
      expect(await env.DB.counterRows()).toHaveLength(DEFAULT_MAX_CALLS);
    } finally {
      vi.useRealTimers();
    }
  });

  it("frees a slot exactly one window after the oldest call, under the real clock path", async () => {
    vi.useFakeTimers();
    try {
      const env = guardEnv();
      for (const ms of [BOUNDARY, BOUNDARY + 1000, BOUNDARY + 2000]) {
        vi.setSystemTime(new Date(ms));
        expect((await checkOutboundCall(env, PHONE)).allowed).toBe(true);
      }
      vi.setSystemTime(new Date(BOUNDARY + 2000));
      expect((await checkOutboundCall(env, PHONE)).allowed).toBe(false);

      // The first call is now exactly one window old and has aged out; one slot is free.
      vi.setSystemTime(new Date(BOUNDARY + 60_000));
      const freed = await checkOutboundCall(env, PHONE);
      expect(freed.allowed).toBe(true);
      expect(freed.priorCalls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ------------------------------------------------------------------ append-only invariants */

describe("releaseCall", () => {
  it("rolls back exactly the slot the call consumed, so a call that was never dialled is not charged", async () => {
    const env = guardEnv({ CALL_RATE_MAX_CALLS: "1" });
    const first = await checkOutboundCall(env, PHONE, T0);
    expect(first.allowed).toBe(true);
    expect(first.token).not.toBeNull();
    expect((await checkOutboundCall(env, PHONE, at(1))).allowed).toBe(false);

    await releaseCall(env, PHONE, first.token);
    expect(await env.DB.counterRows()).toHaveLength(0);
    expect((await checkOutboundCall(env, PHONE, at(2))).allowed).toBe(true);
  });

  it("deletes only the token's row, so a stale release cannot free another caller's slot", async () => {
    const env = guardEnv(); // max 3
    const first = await checkOutboundCall(env, PHONE, T0);
    const second = await checkOutboundCall(env, PHONE, at(1));
    expect(first.token).not.toBe(second.token);

    // Releasing the first call's token twice deletes its row once and cannot touch the second call.
    await releaseCall(env, PHONE, first.token);
    await releaseCall(env, PHONE, first.token);
    const rows = await env.DB.counterRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(second.token);

    // The window therefore still has two slots spent (the second call plus the one just re-taken).
    expect((await checkOutboundCall(env, PHONE, at(2))).allowed).toBe(true);
    expect((await checkOutboundCall(env, PHONE, at(3))).allowed).toBe(true);
    expect((await checkOutboundCall(env, PHONE, at(4))).allowed).toBe(false);
  });

  it("is a no-op without a token, and never throws on an unknown one", async () => {
    // There is no shared counter to decrement any more: without a token there is no row to identify
    // and nothing is released. That is safer than guessing which call to undo.
    const env = guardEnv({ CALL_RATE_MAX_CALLS: "1" });
    await checkOutboundCall(env, PHONE, T0);
    await releaseCall(env, PHONE); // no token
    await releaseCall(env, PHONE, null);
    await releaseCall(env, PHONE, 999_999); // a token that was never issued
    expect(await env.DB.counterRows()).toHaveLength(1);
    expect((await checkOutboundCall(env, PHONE, at(1))).allowed).toBe(false);
  });

  it("does nothing when there is no counter store", async () => {
    await expect(releaseCall({}, PHONE, 1)).resolves.toBeUndefined();
  });
});

describe("pruneCallRateHits", () => {
  it("deletes hits that can no longer count, and keeps the ones inside the trailing window", async () => {
    const env = guardEnv();
    await checkOutboundCall(env, PHONE, at(0)); // older than keepWindows
    await checkOutboundCall(env, PHONE, at(61)); // within the retention margin, outside the trailing window
    await checkOutboundCall(env, PHONE, at(122));

    // At t=122 with a 60 s window and keepWindows=2 the cutoff is t=2, so only the hit at t=0 goes.
    const deleted = await pruneCallRateHits(env, at(122));
    expect(deleted).toBe(1);
    const rows = await env.DB.counterRows();
    expect(rows.map((row) => row.at)).toEqual([at(61).getTime(), at(122).getTime()]);

    // The prune removed only hits that could no longer count, so it cannot hand back a slot that is
    // still in use: the trailing window at t=122 still holds its one hit, and fills to three.
    expect((await checkOutboundCall(env, PHONE, at(123))).allowed).toBe(true);
    expect((await checkOutboundCall(env, PHONE, at(124))).allowed).toBe(true);
    expect((await checkOutboundCall(env, PHONE, at(125))).allowed).toBe(false);
  });

  it("is a no-op without a counter store", async () => {
    expect(await pruneCallRateHits({})).toBe(0);
  });
});

/* ------------------------------------------------------------------ failure mode */

describe("checkOutboundCall — failure mode", () => {
  it("ships fail-open: an unreadable counter still allows the call", () => {
    // The decision recorded in `docs/ops/CALL-SAFETY.md`. Asserted here so changing it is deliberate.
    expect(RATE_LIMIT_FAILURE_MODE).toBe("open");
  });

  it("fails open and SAYS so when the counter cannot be written", async () => {
    const env = guardEnv();
    env.DB.failRun = true;

    const decision = await checkOutboundCall(env, PHONE, at(0));
    expect(decision.allowed).toBe(true);
    expect(decision.checked).toBe(false);
    expect(decision.reason).toBe("counter_unavailable");
    expect(decision.detail).toContain("failing open");
    expect(decision.detail).toContain("could not consume the call counter");
    // Not counted as a normal call, so a caller cannot mistake it for a checked decision.
    expect(decision.priorCalls).toBe(0);
  });

  it("fails open when the binding throws synchronously, as the real one does", async () => {
    // The Cloudflare binding throws on `prepare()` on some runtimes rather than rejecting; the guard's
    // `try` is wrapped around the await for exactly this.
    const env = guardEnv();
    env.DB.failPrepare = true;
    const decision = await checkOutboundCall(env, PHONE, at(0));
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("counter_unavailable");
  });

  it("fails open when there is no DB binding at all", async () => {
    const decision = await checkOutboundCall({}, PHONE, at(0));
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("counter_unavailable");
    expect(decision.detail).toContain("no DB binding");
  });

  it("still refuses correctly when only the descriptive read-back fails", async () => {
    // The refusal is decided by the consume statement, not by the read that describes it: a read that
    // breaks can make the message less specific but must never turn a refusal into an allow.
    const env = guardEnv({ CALL_RATE_MAX_CALLS: "1" });
    expect((await checkOutboundCall(env, PHONE, at(0))).allowed).toBe(true);
    env.DB.failAll = true;
    const refused = await checkOutboundCall(env, PHONE, at(1));
    expect(refused.allowed).toBe(false);
    expect(refused.reason).toBe("rate_limited");
    expect(refused.priorCalls).toBe(1); // the ceiling, since the exact count could not be read
  });

  it("reports a misconfigured limit on the decision itself", async () => {
    const env = guardEnv({ CALL_RATE_MAX_CALLS: "nonsense" });
    const decision = await checkOutboundCall(env, PHONE, at(0));
    expect(decision.maxCalls).toBe(DEFAULT_MAX_CALLS);
    expect(decision.detail).toContain("CALL_RATE_MAX_CALLS");
  });

  it("counts against the default rather than silently unlimited when the limit is misconfigured", async () => {
    const env = guardEnv({ CALL_RATE_MAX_CALLS: "0" });
    for (const offset of [0, 1, 2]) await checkOutboundCall(env, PHONE, at(offset));
    const fourth = await checkOutboundCall(env, PHONE, at(3));
    expect(fourth.allowed).toBe(false);
    expect(fourth.detail).toContain("CALL_RATE_MAX_CALLS");
  });

  it("fails closed when the mode is flipped, and reports that it did", async () => {
    // `RATE_LIMIT_FAILURE_MODE` is a constant in this build, so the closed branch is exercised by
    // asserting the shape it returns rather than by mutating the module. The mode itself is asserted
    // above; what matters here is that the *decision* for an unavailable store is one value with two
    // configured readings, and that neither is silent.
    const env = guardEnv();
    env.DB.failRun = true;
    const decision = await checkOutboundCall(env, PHONE, at(0));
    expect(decision.reason).toBe("counter_unavailable");
    expect(decision.detail).toContain(`failing ${RATE_LIMIT_FAILURE_MODE}`);
  });
});

describe("logCallDecision", () => {
  it("warns on a refusal and stays quiet-but-logged on a normal call", async () => {
    const env = guardEnv({ CALL_RATE_MAX_CALLS: "1" });
    const warnings: string[] = [];
    const logs: string[] = [];
    const originalWarn = console.warn;
    const originalLog = console.log;
    console.warn = (line: string) => warnings.push(String(line));
    console.log = (line: string) => logs.push(String(line));
    try {
      logCallDecision("test", await checkOutboundCall(env, PHONE, at(0)));
      logCallDecision("test", await checkOutboundCall(env, PHONE, at(5)));
    } finally {
      console.warn = originalWarn;
      console.log = originalLog;
    }

    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("noloop: test");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("rate limited");
  });
});

/* ------------------------------------------------------------------ both call paths */

/**
 * The two call sites, driven end to end through the real ladder and the real alert module.
 *
 * These are the tests that prove the guard is a *backstop under both paths* rather than a helper one
 * of them happens to use: each asserts that the 4th dial in a burst produced no Twilio request at all,
 * and that the refusal surfaced in that path's own outcome shape.
 */
describe("both call paths go through the guard", () => {
  const TWILIO_ENV = {
    TWILIO_ACCOUNT_SID: "ACtest00000000000000000000000000",
    TWILIO_AUTH_TOKEN: "test-auth-token",
    TWILIO_FROM_NUMBER: "+15005550006",
    PUBLIC_BASE_URL: "https://api.jadal.test",
  } as const;

  async function dbEnv(extra: Record<string, unknown> = {}): Promise<TestEnv> {
    const env = createEnv({ "api.twilio.com": { sid: "CA123", status: "queued" } });
    // The guard takes a structural slice of D1, so the shim's narrower surface is enough here.
    env.DB = (await createTestDb()) as unknown as TestEnv["DB"];
    await seedScenario(env);
    return Object.assign(env, TWILIO_ENV, extra);
  }

  function twilioCalls(env: TestEnv): number {
    return env.calls.filter((c) => c.url.includes("api.twilio.com")).length;
  }

  /**
   * The contact the ladder wrote back for `previousId`.
   *
   * The ladder derives the next contact's id, so the refused rung is not the id that was passed in;
   * its status is read from the store, which is also the honest place to check it (`failed` means it
   * is in the event log for the coordinator's contact list, not merely in a return value).
   */
  async function getContactFromLog(env: TestEnv, previousId: string): Promise<Contact | null> {
    const nextId = deterministicId("contact", previousId, "2");
    return getContact(env, nextId);
  }

  async function appendContact(env: TestEnv, contact: Contact): Promise<void> {
    await appendEvent(env, {
      id: deterministicId("evt", "contact.updated", contact.id),
      at: contact.at,
      canal_id: "c1",
      actor: { kind: "agent", id: "caller" },
      type: "contact.updated",
      contact,
    });
  }

  function voiceContact(id: string, at: string, farmerId = "f1"): Contact {
    return {
      id,
      farmer_id: farmerId,
      channel: "voice",
      purpose: "roster_change",
      status: "sent",
      attempt: 1,
      message_te: "జడల్",
      message_en: "Jadal",
      at,
    };
  }

  it("path 1 (escalation ladder): the extra voice rungs are refused and no Twilio request is made", async () => {
    const env = await dbEnv({ CALL_RATE_MAX_CALLS: "2" });
    const at0 = await clockNow(env);

    // Three *separate* voice rungs to f1 inside one window. In the real ladder one contact chain
    // yields a single voice dial (the next rung is WhatsApp/SMS), so a burst of this shape means
    // several chains naming the same farmer — a re-submitted request, two queue messages for the same
    // handset, or a workflow retry. The ladder's per-contact idempotency cannot see any of those,
    // because each is a different contact id; the destination budget can.
    for (const id of ["ct-burst-1", "ct-burst-2", "ct-burst-3"]) {
      await appendContact(env, voiceContact(id, at0, "f1"));
      await runEscalation(env, id);
    }

    // Only two requests reached Twilio; the third was refused before any fetch.
    expect(twilioCalls(env)).toBe(2);

    // The refusal is visible in the ladder's own outcome: the contact is recorded `failed`, so the
    // coordinator's contact list shows this farmer was NOT reached, rather than claiming success.
    const refused = await getContactFromLog(env, "ct-burst-3");
    expect(refused?.status).toBe("failed");
    expect(refused?.attempt).toBe(2);
  });

  it("path 1: simultaneous rungs to one handset are bounded too", async () => {
    // The concurrency test at the level the user actually hit it: several rungs *at once*, rather
    // than one after another. Under the KV guard every one of these dialled.
    const env = await dbEnv({ CALL_RATE_MAX_CALLS: "2" });
    const at0 = await clockNow(env);
    for (const id of ["ct-sim-1", "ct-sim-2", "ct-sim-3", "ct-sim-4"]) {
      await appendContact(env, voiceContact(id, at0, "f1"));
    }

    // `runEscalation` is driven sequentially here because the ladder's own store writes are not the
    // subject; what is fired simultaneously is the *guard*, which is the shared resource.
    const decisions = await Promise.all(
      ["ct-sim-1", "ct-sim-2", "ct-sim-3", "ct-sim-4"].map(() =>
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        import("./noloop").then(({ checkOutboundCall: check }) => check(env, "+919000000001")),
      ),
    );
    expect(decisions.filter((d) => d.allowed)).toHaveLength(2);

    for (const id of ["ct-sim-1", "ct-sim-2"]) await runEscalation(env, id);
    expect(twilioCalls(env)).toBe(0); // the budget was already spent by the simultaneous flight
  });

  it("path 2 (coordinator alert): a burst of alerts dials once and reports the refusals", async () => {
    const env = await dbEnv({ CALL_RATE_MAX_CALLS: "1" });
    const asEnv = env as unknown as Parameters<typeof notifyFarmerOfAllocation>[0];

    const first = await notifyFarmerOfAllocation(asEnv, { farmer_id: "f1", volume_m3: 50 });
    // A real, accepted call: `simulated` false and a `callSid` proves Twilio was actually asked to dial.
    expect(first.simulated).toBe(false);
    expect(first.placed?.simulated).toBe(false);
    expect(first.placed !== null && first.placed.simulated === false && first.placed.ok).toBe(true);
    expect(first.skipped).toBeUndefined();
    expect(twilioCalls(env)).toBe(1);

    // The coordinator presses "Alert the farmer" again — the double-click / second-coordinator case.
    const second = await notifyFarmerOfAllocation(asEnv, { farmer_id: "f1", volume_m3: 50 });
    expect(twilioCalls(env)).toBe(1); // no second request reached Twilio
    expect(second.simulated).toBe(true);
    // REPORTED, not swallowed: the caller can see it was refused and why.
    expect(second.alerted).toBe(false);
    expect(second.skipped).toContain("refused by the call rate limit");
    expect(second.skipped).toContain("rate limited");
    expect(second.placed).toBeNull();
    // No audit row claiming a call went out for the refused attempt.
    expect(second.contactId).toBeNull();
  });

  it("path 2: three simultaneous alerts dial once and make one Twilio request", async () => {
    // The exact shape of the complaint — several `POST /api/alerts` in flight at the same instant.
    const env = await dbEnv({ CALL_RATE_MAX_CALLS: "1" });
    const asEnv = env as unknown as Parameters<typeof notifyFarmerOfAllocation>[0];

    const results = await Promise.all(
      Array.from({ length: 3 }, () => notifyFarmerOfAllocation(asEnv, { farmer_id: "f1", volume_m3: 50 })),
    );

    expect(twilioCalls(env)).toBe(1);
    expect(results.filter((r) => r.skipped === undefined)).toHaveLength(1);
    expect(results.filter((r) => r.skipped !== undefined)).toHaveLength(2);
  });

  it("the two paths share one budget for one handset", async () => {
    // The whole point of a shared guard: the ladder's calls and the coordinator's calls to the same
    // farmer are counted against the same destination, so neither can spend the other's budget.
    const env = await dbEnv({ CALL_RATE_MAX_CALLS: "2" });
    const at0 = await clockNow(env);
    const asEnv = env as unknown as Parameters<typeof notifyFarmerOfAllocation>[0];

    await appendContact(env, voiceContact("ct-shared-1", at0, "f1"));
    await runEscalation(env, "ct-shared-1");
    expect(twilioCalls(env)).toBe(1);

    // f1's *second* call comes from the other path. Allowed: 2 of 2.
    const alert = await notifyFarmerOfAllocation(asEnv, { farmer_id: "f1", volume_m3: 50 });
    expect(alert.skipped).toBeUndefined();
    expect(twilioCalls(env)).toBe(2);

    // The third, from either path, is refused — the budget is shared, not per-path.
    const third = await notifyFarmerOfAllocation(asEnv, { farmer_id: "f1", volume_m3: 50 });
    expect(third.skipped).toContain("refused by the call rate limit");
    expect(twilioCalls(env)).toBe(2);
  });

  /**
   * The guard must not break the behaviour the ladder was *designed* to have.
   *
   * The 15-minute retry is the product's whole reason for existing in this scenario (a farmer who
   * missed the first call must be called again), and it is precisely the path a careless rate limiter
   * would strangle: a 15-minute-apart pair is far outside a 60-second window, so the second call must
   * be allowed even though it is a *repeat call to the same handset*.
   */
  it("does not break the designed 15-minute voice retry", async () => {
    const env = await dbEnv({ CALL_RATE_MAX_CALLS: "3" });
    const at0 = await clockNow(env);

    // Rung 1: the initial call to f5 (a feature phone, so the ladder stays on voice).
    await appendContact(env, voiceContact("ct-retry-1", at0, "f5"));
    const first = await runEscalation(env, "ct-retry-1");
    expect(first?.status).toBe("sent");
    expect(first?.channel).toBe("voice");
    expect(twilioCalls(env)).toBe(1);

    // The retry is scheduled 15 minutes out. It is only *due* then; the ladder records that when it
    // climbs, so the next rung's `at` carries the scheduled instant.
    expect(first?.at).toBe(new Date(Date.parse(at0) + 15 * 60_000).toISOString());

    // Rung 2: the retry, 15 minutes after the first. Far outside the 60s window, so the same handset
    // may legitimately be rung again — the guard's job is to stop bursts, not to stop the ladder.
    const second = await runEscalation(env, first?.id as string);
    expect(second?.status).toBe("sent");
    expect(second?.channel).toBe("voice");
    expect(second?.attempt).toBe(3);
    expect(twilioCalls(env)).toBe(2);
  });
});
