/**
 * The outbound-call rate limiter — the backstop that bounds every dialled destination.
 *
 * ## Why this file exists
 *
 * Jadal placed 36 outbound calls in one session, four of them inside 40 seconds. The documented
 * escalation ladder is not capable of that: it steps voice → voice (after 15 minutes) → message →
 * coordinator flag, at most one call per rung. The burst therefore came from *outside* the ladder's
 * sequencing — several independent callers (a re-submitted request, a coordinator pressing "Alert",
 * two queue messages naming the same contact) each asking for a call on the same handset, none of
 * them able to see the others. Bounding the ladder more tightly does not fix that: the next path
 * added would have the same hole.
 *
 * So the bound lives here, beneath every path: **no destination is dialled more than
 * {@link DEFAULT_MAX_CALLS} times in any {@link DEFAULT_WINDOW_SECONDS}, whoever asks.** The escalation
 * ladder and the coordinator alert both go through it, and a future call site that forgets to is a
 * missing line in one seam rather than a new loop.
 *
 * ## The window SLIDES, and the budget is consumed by ONE atomic statement
 *
 * This is the third version of the guard. The first stored a counter in `KV`, which has **no atomic
 * increment**: two callers that read the same counter in the same instant both wrote `1` and both were
 * allowed. The second moved the counter into **D1** and consumed it with one conditional
 * `INSERT … ON CONFLICT … WHERE n < ?`, which fixed the race but counted in **fixed windows**
 * (`floor(now / window)`) — so a burst straddling a window boundary could place `maxCalls` in each of
 * two adjacent windows and reach `2 × maxCalls`, and `releaseCall` was a decrement of a shared counter
 * rather than a rollback of one call.
 *
 * Both gaps have the same root: a window was a *bucket*, not a *span*. This version stores **one row
 * per counted call** in `call_rate_hit` (migration `0004_call_rate_hit.sql`) and counts the rows in the
 * trailing window:
 *
 * ```sql
 * INSERT INTO call_rate_hit (destination, at)
 * SELECT ?1, ?2
 *  WHERE (SELECT COUNT(*) FROM call_rate_hit
 *          WHERE destination = ?1 AND at > ?2 - ?3) < ?4
 * RETURNING id, (SELECT COUNT(*) FROM call_rate_hit
 *                 WHERE destination = ?1 AND at > ?2 - ?3) AS n
 * ```
 *
 * **Why this is still atomic.** It is one SQL statement, so SQLite executes it inside a single write
 * transaction: another connection's `INSERT` of a row for the same destination cannot interleave
 * between the `COUNT(*) < ?4` test and the insert. The condition and the write are *the same
 * statement*, so there is no instant at which two callers can both observe room. D1 serialises writes
 * to a database through one instance, which is the premise the previous version already relied on.
 *
 * **The statement is the arbiter, and it is read once.** The decision comes from *whether the
 * statement produced a row*: `RETURNING` yields exactly one row when the insert took effect and none
 * when the `COUNT(*) < ?4` test rejected it. That one row is the permission. Nothing re-reads the
 * count to decide, because a read-back is exactly the race this replaced. The refusal path's single
 * `SELECT` is descriptive only — it supplies `priorCalls` and `retryAfterAt` for the message, and
 * cannot turn a refusal into an allow. See {@link atomicStatements}.
 *
 * ## Sliding, so a burst cannot straddle a boundary
 *
 * A call counted at `t` is in the window of every attempt at `t'` with `t > t' - windowMs`, and leaves
 * it exactly one window after `t`. A burst that would have straddled a fixed boundary therefore does
 * not get a fresh budget when the clock ticks: it must wait for the *oldest* call to age out, and
 * slots free **one at a time** rather than all at once. `retryAfterAt` is the moment the oldest
 * counted call expires.
 *
 * ## `releaseCall` is a true rollback, not a decrement
 *
 * The consume returns the id of the row it inserted — the {@link CallToken} on the decision.
 * {@link releaseCall} deletes **that row**, and only that row, so giving a slot back cannot take the
 * slot another caller is holding. Without a token it does nothing: there is no longer a shared
 * counter to decrement, and a decrement was never a rollback. It is used after a transport refusal,
 * where the guard spent a slot for a call that never reached a handset; it is best-effort and never
 * throws.
 *
 * ## Refusal is visible, never silent
 *
 * A rate limit that silently drops a call is worse than the burst it prevents: the coordinator's
 * phone never rings, nothing in the log says why, and the request appears to have been handled. So a
 * refusal here is a {@link CallDecision} with `allowed: false`, the tripping `reason`, the count that
 * tripped it and the instant the window frees up. Callers are required to *report* it — the ladder
 * marks the contact `failed` and the coordinator path returns `skipped` — and both log a line naming
 * the limit. "We did not call, and here is why" is the contract.
 *
 * ## Fail-open, and why it is STILL the answer now that the counter is in D1
 *
 * If the counter store cannot be read or written, the guard **allows the call**
 * ({@link RATE_LIMIT_FAILURE_MODE} `open`). The argument is unchanged from the fixed-window version and
 * is restated in short: failing closed converts a database blip into a silently dropped *emergency*
 * call — a night-release warning nobody receives, recorded as merely `failed` and indistinguishable
 * from a bad number. Failing open degrades to exactly the pre-guard behaviour for the duration of the
 * outage, which is still bounded by the ladder's attempt cap, its per-contact idempotency and the
 * queue's redelivery cap. Failing open loses a backstop; failing closed loses the emergency. A burst
 * is bounded and visible; a dropped emergency call is neither. The fuller argument, and the trigger
 * for revisiting it, are in `docs/ops/CALL-SAFETY.md` §4.
 *
 * ## State: the table, and why it does not grow without bound
 *
 * Rows live in `call_rate_hit`, keyed by an autoincrement `id` with `(destination, at)` indexed.
 * {@link destinationKey} normalises a number to its digits for the same reason `telephony-deps.phoneKey`
 * does: `+91 90000 00001`, `+919000000001` and `tel:+919000000001` are one handset and must share one
 * budget. Without that, a caller could spend the budget three times over by formatting one number
 * three ways.
 *
 * Unlike the fixed-window table, this one *does* grow with traffic — one row per counted call — so it
 * needs a prune. {@link pruneCallRateHits} deletes rows that can no longer count, and is deliberately
 * off the guard's path: a table-wide `DELETE` inside the request-critical statement would be a far
 * worse failure mode than a few stale rows.
 *
 * ## Honest limits (reported, not papered over)
 *
 *  * **The limit is per D1 instance, and D1 is single-instance per database.** Atomicity here is
 *    SQLite's, holding because every request reaches the same D1 database for a given deployment.
 *    A future move to per-region read replicas for the *counter* would reintroduce the race; the
 *    counter must be read and written on the primary.
 *  * **It bounds calls, not spend.** Two different destinations each get a full budget, so a loop
 *    that walks the whole roster one farmer at a time is not stopped. See `CALL-SAFETY.md` §6.
 *  * **The hit log grows with traffic.** One row per counted call, so a busy deployment needs
 *    {@link pruneCallRateHits} run periodically. Until it is, the table is larger but the limit is
 *    still correct: old rows simply stop counting.
 */

/* ------------------------------------------------------------------ configuration */

/**
 * How many calls one destination may receive inside one window, when nothing is configured.
 *
 * Three is chosen against the observed burst, not picked for roundness. The worst burst measured was
 * four calls to a handset in 40 seconds; the ladder's own *designed* worst case for one contact is
 * three (initial call, 15-minute retry, last-resort voice call before the coordinator flag) — and
 * those are 15 minutes apart, so they never collide in a 60-second window. A limit of 3 therefore
 * admits every legitimate sequence the product defines and still cuts the measured burst at its
 * fourth call, which is the exact call the brief asks to be blocked.
 */
export const DEFAULT_MAX_CALLS = 3;

/** The window those calls are counted over, in seconds. Matches the 40–60 s burst clustering measured. */
export const DEFAULT_WINDOW_SECONDS = 60;

/** The name that selects fail-open (`open`) or fail-closed (`closed`) when the store cannot be read. */
export const RATE_LIMIT_FAILURE_MODE: "open" | "closed" = "open";

/**
 * The narrow slice of D1 the guard uses.
 *
 * Structural rather than the ambient `D1Database`, for the same reason `db/store.ts` declares `Db`:
 * the real binding satisfies this, the in-memory test shim satisfies this, and a test double that
 * fails on demand can satisfy it without implementing `dump()`. The guard reads nothing from D1 that
 * is not here, so a caller cannot hand it something that compiles but cannot count.
 */
export interface CounterDb {
  prepare(query: string): D1PreparedStatement;
}

/** The bindings slice the guard needs. `Env` satisfies it structurally; campaigns pass their own env. */
export interface RateLimitBindings {
  /**
   * The counter store. Required by the guard: D1 is where the atomic consume happens, and it is
   * already a mandatory binding for the rest of the app. Optional in the *type* only so a caller with
   * a narrower env object still compiles; an absent `DB` is treated as an outage, not a crash.
   */
  readonly DB?: CounterDb | undefined;
  /**
   * Counters, in seconds. `CALL_RATE_WINDOW_SECONDS`.
   *
   * Read at call time rather than captured at module load, so a test (or an operator rolling the
   * window down during an incident) changes it without re-importing the module.
   */
  readonly CALL_RATE_WINDOW_SECONDS?: string | undefined;
  /** Calls allowed per window per destination. `CALL_RATE_MAX_CALLS`. */
  readonly CALL_RATE_MAX_CALLS?: string | undefined;
}

/** The resolved, usable limits. */
export interface RateLimitConfig {
  readonly maxCalls: number;
  readonly windowSeconds: number;
}

export interface RateLimitResolution extends RateLimitConfig {
  /** Env names whose value was unusable, so a caller can report the misconfiguration rather than hide it. */
  readonly problems: readonly string[];
}

/** The hit log. Named here so the statement, the prune and the docs cannot drift apart. */
export const CALL_RATE_TABLE = "call_rate_hit";

/**
 * Parse a positive-integer env var.
 *
 * An unset, blank, non-numeric, zero or negative value falls back to the default and is *reported*
 * rather than silently accepted: a typo in `CALL_RATE_MAX_CALLS` that quietly disabled the backstop
 * is precisely the failure this file exists to prevent. A decimal is floored (`2.9` → `2`), which
 * errs toward the tighter limit.
 */
function positiveInt(raw: string | undefined, fallback: number): { value: number; bad: boolean } {
  if (raw === undefined || raw.trim() === "") return { value: fallback, bad: false };
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return { value: fallback, bad: true };
  return { value: Math.floor(parsed), bad: false };
}

/** Read the guard's configuration from the environment, defaulting and reporting as described above. */
export function rateLimitConfig(env: RateLimitBindings): RateLimitResolution {
  const max = positiveInt(env.CALL_RATE_MAX_CALLS, DEFAULT_MAX_CALLS);
  const window = positiveInt(env.CALL_RATE_WINDOW_SECONDS, DEFAULT_WINDOW_SECONDS);
  const problems: string[] = [];
  if (max.bad) problems.push("CALL_RATE_MAX_CALLS");
  if (window.bad) problems.push("CALL_RATE_WINDOW_SECONDS");
  return { maxCalls: max.value, windowSeconds: window.value, problems };
}

/* ------------------------------------------------------------------ destination identity */

/**
 * The counter key for one destination.
 *
 * Digits only, so every spelling of one handset shares one budget; an unparseable destination (no
 * digits at all, e.g. a blank string) is keyed by its trimmed literal, which keeps two different
 * malformed inputs from sharing a budget. A destination with no digits never reaches Twilio — the
 * callers validate the number first — but the guard must still be total.
 */
export function destinationKey(to: string): string {
  const digits = to.replace(/^tel:/i, "").replace(/\D+/g, "");
  return digits.length > 0 ? digits : `literal:${to.trim()}`;
}

/**
 * The counter key for one destination, as it appears in `call_rate_hit.destination`.
 *
 * Kept as an alias of {@link destinationKey} because callers and docs used the old KV-era name. There
 * is no key-value store in the design; an operator clearing counters during an incident deletes rows
 * instead (`docs/ops/CALL-SAFETY.md` §1).
 */
export function rateLimitKey(to: string): string {
  return destinationKey(to);
}

/* ------------------------------------------------------------------ decisions */

/** Why a call was refused, or `unknown` when it was allowed. */
export type RateLimitReason = "rate_limited" | "counter_unavailable" | "unknown";

/**
 * The rollback token for one counted call: the `id` of the `call_rate_hit` row the guard inserted.
 *
 * Opaque to callers — it is only ever passed back to {@link releaseCall}. It is a number because D1
 * returns an INTEGER primary key as a number.
 */
export type CallToken = number;

/** The guard's answer for one attempted destination. */
export interface CallDecision {
  /** True when the caller may dial. The only field a caller *must* branch on. */
  readonly allowed: boolean;
  /** The destination as given by the caller. */
  readonly to: string;
  /** True when the decision was made from real state; false when it is the failure-mode fallback. */
  readonly checked: boolean;
  /** Calls already counted in the current window, before this one. */
  readonly priorCalls: number;
  /** The configured ceiling this decision was measured against. */
  readonly maxCalls: number;
  /** The configured window, in seconds. */
  readonly windowSeconds: number;
  readonly reason: RateLimitReason;
  /**
   * When the window frees up, ISO-8601, when the call was refused *because of the limit*. `null` for
   * an allowed call and for a failure-mode refusal, where no window exists to wait for.
   */
  readonly retryAfterAt: string | null;
  /**
   * The row this call consumed, to be passed to {@link releaseCall} if it is never dialled. Non-null
   * only on an allowed, counted call; `null` for a refusal and for a failure-mode allow.
   */
  readonly token: CallToken | null;
  /** Human-readable, safe to log, and the text a caller reports as its refusal reason. */
  readonly detail: string;
}

/**
 * One refused-but-not-limited decision: the counter store could not be used and the configured
 * failure mode allowed the call anyway.
 */
function failOpenDecision(to: string, config: RateLimitResolution, detail: string): CallDecision {
  return {
    allowed: true,
    to,
    checked: false,
    priorCalls: 0,
    maxCalls: config.maxCalls,
    windowSeconds: config.windowSeconds,
    reason: "counter_unavailable",
    retryAfterAt: null,
    token: null,
    detail,
  };
}

/** A refusal caused by the limit itself, carrying the count that tripped it and when it frees up. */
function rateLimitedDecision(
  to: string,
  config: RateLimitResolution,
  priorCalls: number,
  retryAfterAt: string | null,
  misconfigured: string,
): CallDecision {
  return {
    allowed: false,
    to,
    checked: true,
    priorCalls,
    maxCalls: config.maxCalls,
    windowSeconds: config.windowSeconds,
    reason: "rate_limited",
    retryAfterAt,
    token: null,
    detail:
      `rate limited: ${to} already has ${priorCalls} call(s) in the last ${config.windowSeconds}s ` +
      `(limit ${config.maxCalls})${misconfigured}`,
  };
}

/* ------------------------------------------------------------------ the atomic statements */

/**
 * The two statements the guard runs, and the reason each is safe to run.
 *
 * Exported (as SQL text) so a test can assert on the *shape* of what ships — that the consume is a
 * single `INSERT … SELECT … WHERE (SELECT COUNT(*) …) < ?`, and that nothing in the guard's path is a
 * read-then-write. The strings are the single source: {@link checkOutboundCall} binds these exact
 * constants, so a test cannot pass against a copy that has drifted from the code.
 *
 * `?1`..`?4` are, in order: the destination key, the attempt instant in epoch milliseconds, the window
 * length in milliseconds, and the ceiling. The count subquery appears twice — once as the condition,
 * once in `RETURNING` to number the call for the log — but both are inside one statement.
 */
export const atomicStatements = {
  /**
   * **Consume one unit of the budget, or change nothing.** The atomic point.
   *
   * The `WHERE (SELECT COUNT(*) …) < ?4` condition and the insert are inseparable: a single statement,
   * evaluated inside one SQLite write transaction. `RETURNING` yields exactly one row iff the insert
   * took effect, so the row's *presence* is the permission and its `id` is the rollback token.
   */
  consume: (table = CALL_RATE_TABLE): string =>
    `INSERT INTO ${table} (destination, at) ` +
    `SELECT ?1, ?2 ` +
    `WHERE (SELECT COUNT(*) FROM ${table} WHERE destination = ?1 AND at > ?2 - ?3) < ?4 ` +
    `RETURNING id, (SELECT COUNT(*) FROM ${table} WHERE destination = ?1 AND at > ?2 - ?3) AS n`,

  /**
   * **Read the window's count and its oldest hit without writing anything.**
   *
   * One statement, run only to *describe* a refusal. The `oldest` instant is the one that frees the
   * next slot, so `retryAfterAt` is `oldest + windowMs`. A stale or empty read can make the message
   * less specific; it can never change the decision, which the consume already settled.
   */
  read: (table = CALL_RATE_TABLE): string =>
    `SELECT COUNT(*) AS n, MIN(at) AS oldest FROM ${table} ` +
    `WHERE destination = ?1 AND at > ?2 - ?3`,
} as const;

/**
 * The rows from a D1 `all()` result.
 *
 * D1 answers `all()` with a `{ success, meta, results }` envelope and omits `results` entirely when
 * the query matched nothing. This is the same read `db/store.ts`'s `resultRows` makes; duplicated
 * rather than imported so the guard stays a leaf module that `campaigns/` can pull in without the
 * store, exactly as it is today.
 */
function rows<T>(result: { results?: T[] } | undefined): T[] {
  return result?.results ?? [];
}

/** One row of `call_rate_hit`, as the two statements return it. */
interface CounterRow {
  readonly id?: number | null;
  readonly n?: number | null;
  readonly oldest?: number | null;
}

/** A finite, non-negative integer read out of a row, or `0` for anything else (null, junk, a string). */
function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * When the oldest counted call ages out of the window.
 *
 * A call counted at `oldest` stops counting for an attempt at `now` once `oldest <= now - windowMs`,
 * so the next slot frees at `oldest + windowMs`. `null` when no instant could be read, which is the
 * honest "unknown" for a refusal message.
 */
function windowFreesAt(oldest: number | null, windowMs: number): string | null {
  if (oldest === null || !Number.isFinite(oldest)) return null;
  return new Date(oldest + windowMs).toISOString();
}

/* ------------------------------------------------------------------ the guard */

/**
 * Decide whether `to` may be dialled right now, and count the call if it may.
 *
 * The counter is *consumed here* rather than left to the caller: a caller that forgot to record would
 * otherwise be unlimited, and the whole point is that no path can opt out of the budget. Callers that
 * are refused for a reason other than the limit itself (a malformed number, for instance) must say so
 * with {@link releaseCall}, passing the decision's `token`, or they spend a slot they never used.
 *
 * Never throws. A store failure becomes a decision — allowed under the fail-open default, refused
 * under `closed` — and never an exception, because a caller mid-way through ringing a farmer must not
 * have to handle a third outcome. The `try` wraps the `await` and not the call because the D1 binding
 * also throws synchronously on some runtimes rather than rejecting.
 *
 * `now` is injectable so a test can place a burst anywhere on the timeline; production always uses the
 * wall clock, because the guard's job is to bound *real* elapsed time, not the demo's simulated
 * instant.
 */
export async function checkOutboundCall(
  env: RateLimitBindings,
  to: string,
  now: Date = new Date(),
): Promise<CallDecision> {
  const config = rateLimitConfig(env);
  const ceiling = { maxCalls: config.maxCalls, windowSeconds: config.windowSeconds };
  const misconfigured =
    config.problems.length === 0
      ? ""
      : ` (ignoring unusable ${config.problems.join(", ")}; using defaults)`;

  /** The documented failure mode, in one place: report, then allow or refuse as configured. */
  const unavailable = (detail: string): CallDecision => {
    const line = `${detail}; failing ${RATE_LIMIT_FAILURE_MODE}`;
    if (RATE_LIMIT_FAILURE_MODE === "closed") {
      return {
        allowed: false,
        to,
        checked: false,
        priorCalls: 0,
        ...ceiling,
        reason: "counter_unavailable",
        retryAfterAt: null,
        token: null,
        detail: line,
      };
    }
    return failOpenDecision(to, config, line);
  };

  // No `DB` binding at all: a deployment or a unit test with no counter store. That is a
  // *configuration* fact, not an outage, so it takes the same documented failure mode.
  const db = env.DB;
  if (db === undefined) {
    return unavailable(`no DB binding to count calls against${misconfigured}`);
  }

  const destination = destinationKey(to);
  const nowMs = now.getTime();
  const windowMs = config.windowSeconds * 1000;

  // ---- Consume the budget, or don't. One statement decides; nothing here branches on a prior read.
  //
  // The statement reports one `RETURNING` row iff it actually spent a slot, so that row is the
  // permission. It is read through `first()`, whose contract is `T | null` — a *row*, not a row count,
  // so the answer does not depend on how a driver reports `meta.changes`.
  let spent = false;
  let thisCall = 0;
  let token: CallToken | null = null;
  try {
    const row = await db
      .prepare(atomicStatements.consume())
      .bind(destination, nowMs, windowMs, config.maxCalls)
      .first<CounterRow>();
    if (row !== null) {
      spent = true;
      // `RETURNING n` is the count *after* this call. It is used only to number the call in the log
      // and to report `priorCalls`; whether it is 1 or 3 decides nothing. A row whose `n` is missing
      // or unreadable still means the slot was spent, so the call number falls back to the ceiling
      // rather than inventing a smaller one.
      thisCall = count(row.n) || config.maxCalls;
      token = typeof row.id === "number" && Number.isFinite(row.id) ? row.id : null;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return unavailable(`could not consume the call counter for ${to}: ${message}`);
  }

  if (spent) {
    // The statement spent a slot, so the call is permitted. The permission was the row's presence,
    // settled above; everything in this return value is reporting.
    return {
      allowed: true,
      to,
      checked: true,
      priorCalls: Math.max(thisCall - 1, 0),
      ...ceiling,
      reason: "unknown",
      retryAfterAt: null,
      token,
      detail: `allowed: call ${thisCall} of ${config.maxCalls} to ${to} in ${config.windowSeconds}s${misconfigured}`,
    };
  }

  // ---- Refused: the statement produced no row, which means the trailing window is full.
  // Read the count and the oldest hit only to *describe* the refusal (`priorCalls`, `retryAfterAt`).
  // The refusal itself was already decided by the statement above, so nothing in this read can allow a
  // call: a failing or empty read can only make the message less specific, never the decision.
  let live = config.maxCalls;
  let oldest: number | null = null;
  try {
    const result = await db
      .prepare(atomicStatements.read())
      .bind(destination, nowMs, windowMs)
      .all<CounterRow>();
    const row = rows<CounterRow>(result)[0];
    const observed = count(row?.n);
    if (observed > 0) live = observed;
    oldest = typeof row?.oldest === "number" && Number.isFinite(row.oldest) ? row.oldest : null;
  } catch {
    /* described with the ceiling instead of the exact count; the refusal stands either way */
  }

  return rateLimitedDecision(to, config, live, windowFreesAt(oldest, windowMs), misconfigured);
}

/**
 * Roll back a slot consumed by a call that was never dialled: delete exactly the hit row the call
 * inserted, identified by its {@link CallToken}.
 *
 * This replaced a decrement of the fixed-window counter. A decrement was not a rollback: it could hand
 * back a slot another concurrent caller had just taken, and it could not name *which* call it was
 * undoing. Deleting the token's row does both — the slot is returned to the destination's window, and
 * no other caller's slot can be touched.
 *
 * Without a usable token it is a no-op, deliberately. There is no call to roll back if we cannot
 * identify it, and guessing (e.g. deleting the newest row) would be a decrement by another name. The
 * destination is included in the delete so a token from another destination can never be applied,
 * and `AUTOINCREMENT` keeps an id from being reused after a prune, so a stale token cannot alias a
 * newer call.
 *
 * Best-effort and never throws: releasing a slot is an accuracy improvement, not a correctness
 * requirement. A lost release only makes the guard slightly stricter for one window.
 */
export async function releaseCall(
  env: RateLimitBindings,
  to: string,
  token?: CallToken | null,
): Promise<void> {
  const db = env.DB;
  if (db === undefined) return;
  if (typeof token !== "number" || !Number.isFinite(token)) return;
  try {
    await db
      .prepare(`DELETE FROM ${CALL_RATE_TABLE} WHERE id = ?1 AND destination = ?2`)
      .bind(token, destinationKey(to))
      .run();
  } catch {
    /* best effort: a lost release only makes the guard slightly stricter */
  }
}

/**
 * Delete hit rows that can no longer count.
 *
 * A hit counted at `at` stops counting for an attempt at `now` once `at <= now - windowMs`, so rows
 * older than `keepWindows × windowMs` can never affect a decision and are safe to delete. Unlike the
 * fixed-window table this one grows with traffic (one row per counted call), so unlike before the
 * prune is not pure hygiene: a long-lived, busy deployment should run it periodically.
 *
 * **Called off the guard's path, deliberately**, for the same reason as before: a table-wide `DELETE`
 * (and the write lock it takes) inside the request-critical statement would be a far worse failure
 * mode than a few stale rows. The limit stays correct without it; the table is just larger.
 */
export async function pruneCallRateHits(
  env: RateLimitBindings,
  now: Date = new Date(),
  keepWindows = 2,
): Promise<number> {
  const db = env.DB;
  if (db === undefined) return 0;
  const config = rateLimitConfig(env);
  const cutoff = now.getTime() - Math.max(keepWindows, 1) * config.windowSeconds * 1000;
  try {
    // The number of rows removed is measured as the difference between the row count before and
    // after, rather than read from `meta.changes`: D1 reports the statement's own change count there,
    // but the in-memory shim can only offer `total_changes()`, which is cumulative across the
    // connection. Counting rows is the one reading both agree on.
    const before = await rowCount(db);
    await db.prepare(`DELETE FROM ${CALL_RATE_TABLE} WHERE at <= ?1`).bind(cutoff).run();
    return Math.max(before - (await rowCount(db)), 0);
  } catch {
    return 0;
  }
}

/** How many rows the hit log holds. `null` when it cannot be counted read as `0` by {@link count}. */
async function rowCount(db: CounterDb): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM ${CALL_RATE_TABLE}`)
    .first<{ n?: number }>();
  return count(row?.n);
}

/**
 * A human-readable one-line log for a decision, so every call site reports the same way.
 *
 * `console.warn` for a refusal and for a failure-mode allow, `console.log` otherwise, so a refusal is
 * greppable in the Worker's log stream (`rate limited:`) without drowning in the happy path.
 */
export function logCallDecision(label: string, decision: CallDecision): void {
  const line = `noloop: ${label} — ${decision.detail}`;
  if (!decision.allowed) console.warn(line);
  else if (decision.reason === "counter_unavailable") console.warn(line);
  else console.log(line);
}
