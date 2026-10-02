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
 * {@link DEFAULT_MAX_CALLS} times in {@link DEFAULT_WINDOW_SECONDS}, whoever asks.** The escalation
 * ladder and the coordinator alert both go through it, and a future call site that forgets to is a
 * missing line in one seam rather than a new loop.
 *
 * ## The budget is consumed by ONE atomic statement, in D1
 *
 * This is the whole point of the file, and it is the second version of it. The first stored the
 * counter in `KV`, which has **no atomic increment**: two callers that read the same counter in the
 * same instant both wrote `1` and both were allowed. N simultaneous requests to `POST /api/alerts`
 * therefore all dialled at once, and repeated rapid button presses produced a continuous stream of
 * calls. The user's complaint — *"if we give out multiple calls at same time we will get the
 * ratelimit errors"* — is precisely the concurrent case, and no amount of care in a JavaScript
 * read-then-write fixes it: the window between the read and the write is the bug.
 *
 * So the counter lives in **D1** (`env.DB`, already bound, already required for the app to work) and
 * is consumed by a single statement:
 *
 * ```sql
 * INSERT INTO call_rate_window (destination, window_key, n, not_live)
 *      VALUES (?1, ?2, 1, COALESCE((SELECT n FROM call_rate_window
 *                                    WHERE destination = ?1 AND window_key = ?2 - 1), 0))
 * ON CONFLICT (destination, window_key) DO UPDATE
 *         SET n = n + 1
 *       WHERE n < ?3
 *   RETURNING n
 * ```
 *
 * **Why this is atomic, and not merely shorter.** It is one SQL statement, so SQLite executes it
 * inside a single write transaction: another connection's `INSERT`/`UPDATE` of the same primary key
 * cannot interleave between the `WHERE n < ?3` test and the `n = n + 1` assignment. The condition and
 * the increment are *the same statement*, so there is no instant at which two callers can both
 * observe `n = 0`. The write lock a rejected conflict takes is what removes the interleaving: a
 * second concurrent writer waits, then re-evaluates `WHERE n < ?3` against the already-incremented
 * row, and the `ON CONFLICT` clause updates nothing, so no row is produced. In the test shim this is
 * exact because `node:sqlite` is synchronous; in D1 the same guarantee comes from SQLite's own
 * statement-level transaction, held by the single D1 instance that owns the database.
 *
 * **The statement is the arbiter, and it is read once.** The decision comes from *whether the
 * statement produced a row*: `RETURNING n` yields exactly one row when the INSERT or the conditional
 * UPDATE took effect, and none when the `WHERE n < ?3` test rejected the update. That one row is the
 * permission. Nothing re-reads the counter to decide, because a read-back is exactly the race this
 * replaced. No `SELECT` precedes the consume and no follow-up statement decides anything: there is one
 * write, and its having happened *is* the permission. The refusal path's single read is descriptive
 * only — it supplies `priorCalls` and `retryAfterAt` for the message, and cannot turn a refusal into
 * an allow. See {@link atomicStatements}.
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
 * ({@link RATE_LIMIT_FAILURE_MODE} `open`). This was argued for KV in the first version; D1 changes
 * one premise and the conclusion survives it, so the argument is restated rather than carried over.
 *
 * The premise that changed matters and is not waved away: **D1 is not a peripheral cache, it is the
 * store the app already needs to function.** KV could be down while an emergency call still went out
 * correctly, so a KV blip was an isolated event. That is no longer true — if D1 is unreachable then
 * `appendEvent` is failing too, the ladder cannot read the contact it is escalating, the coordinator
 * alert cannot read the farmer, and the guard is not the thing that has broken. The argument that a
 * store outage is uncorrelated with a call loop is therefore *weaker* under D1: the outage and the
 * burst can now share a cause, because the same failing database is what an app-level retry storm
 * would be retrying against.
 *
 * The conclusion is nevertheless unchanged, for a reason that does not depend on the correlation
 * argument: **failing open and failing closed are not symmetric costs, and the asymmetry survives D1.**
 * Failing closed converts a database blip into a silently dropped *emergency* call — a night-release
 * warning nobody receives, in a state where the audit trail records the contact as merely `failed`,
 * indistinguishable from a bad number. Failing open degrades to exactly the pre-guard behaviour for
 * the duration of the outage, which is still bounded by the ladder's attempt cap, its per-contact
 * idempotency and the queue's redelivery cap. Failing open loses a backstop; failing closed loses the
 * emergency. A burst is bounded and visible; a dropped emergency call is neither.
 *
 * Note also *what* fails here. With the migration applied, a guard failure means D1 itself is
 * unreachable — in which case the request that would place the call is failing on its own next step
 * anyway, so the guard is not the only line of defence and usually not the first to break. The
 * residual risk of failing open is therefore narrower under D1 than it was under KV, not wider:
 * the window in which the guard is open and the app is otherwise healthy is small.
 *
 * `closed` remains available by env for a deployment that would rather drop calls than risk a burst,
 * and `docs/ops/CALL-SAFETY.md` §4 records the decision and the trigger for revisiting it.
 *
 * ## State: the table, and why it does not grow without bound
 *
 * Counters live in `call_rate_window` (migration `0003_call_rate_limit.sql`), keyed by
 * `(destinationKey, windowKey)`. {@link destinationKey} normalises a number to its digits for the same
 * reason `telephony-deps.phoneKey` does: `+91 90000 00001`, `+919000000001` and `tel:+919000000001`
 * are one handset and must share one budget. Without that, a caller could spend the budget three times
 * over by formatting the number three ways.
 *
 * The `window_key` is the window *start* (`floor(now / windowMs)`), not a rolling list of instants as
 * in the KV version, and the window start is derived rather than stored, because the window length is
 * an env var an operator may change mid-incident. That also bounds the table without a scheduled
 * prune: a destination's budget rolls over by addressing a *new* key, so a row is created at most once
 * per destination per window in which that destination is called, and it is never updated again once
 * its window has passed. A quiet destination costs one row that is never touched again. Each row
 * carries the previous window's count in `not_live` so that a refusal can still report
 * `retryAfterAt` without a second query. {@link pruneCallRateWindows} exists to reclaim the boundary
 * rows of a long-lived database and is deliberately not on the guard's path: a lock inside the
 * request-critical statement is a far worse failure mode than a few stale rows.
 *
 * ## Honest limits (reported, not papered over)
 *
 *  * **The limit is per D1 instance, and D1 is single-instance per database.** Atomicity here is
 *    SQLite's, holding because every request reaches the same D1 database for a given deployment.
 *    A future move to per-region read replicas for the *counter* would reintroduce the race; the
 *    counter must be read and written on the primary.
 *  * **It bounds calls, not spend.** Two different destinations each get a full budget, so a loop
 *    that walks the whole roster one farmer at a time is not stopped. See `CALL-SAFETY.md` §6.
 *  * **Windows are fixed, not sliding.** A burst straddling a boundary can place up to
 *    `2 × maxCalls`. The KV version's rolling hit-list did not have this gap; the atomicity is worth
 *    it, the gap is bounded by construction, and a sliding window would need the same statement with
 *    a per-hit row — a later change, not a silent regression. Recorded as a limit, not hidden.
 *  * **A `releaseCall` is a decrement, not a rollback.** Giving a slot back can let a slot be taken
 *    twice under a race, which errs toward allowing a call; it is only used after a transport refusal.
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

/** The counter table. Named here so the statement, the prune and the docs cannot drift apart. */
export const CALL_RATE_TABLE = "call_rate_window";

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
 * The counter key for one destination, as it appears in `call_rate_window.destination`.
 *
 * This replaced `rateLimitKey()`, whose `callcap:v1:<digits>` form was a **KV** key name. There is no
 * key-value store in the design any more, so an operator clearing counters during an incident deletes
 * rows instead: `DELETE FROM call_rate_window WHERE destination = '<digits>'`. Documented in
 * `docs/ops/CALL-SAFETY.md` §1 so the recovery procedure moves with the state.
 */
export function rateLimitKey(to: string): string {
  return destinationKey(to);
}

/**
 * The window a call falls into, as an integer.
 *
 * `floor(now / windowMs)`, so every instant inside one window maps to one key and the budget rolls
 * over by addressing the next key rather than by mutating (or deleting) a row. The window *length*
 * is deliberately not stored: it is `CALL_RATE_WINDOW_SECONDS`, an env var an operator may change
 * during an incident, and the row key must keep meaning "the Nth window" under the new length too.
 */
export function windowKeyAt(now: Date, windowSeconds: number): number {
  return Math.floor(now.getTime() / (windowSeconds * 1000));
}

/* ------------------------------------------------------------------ decisions */

/** Why a call was refused, or `unknown` when it was allowed. */
export type RateLimitReason = "rate_limited" | "counter_unavailable" | "unknown";

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
 * single `INSERT … ON CONFLICT … WHERE n < ?`, and that nothing in the guard's path is a
 * read-then-write. The strings are the single source: {@link checkOutboundCall} binds these exact
 * constants, so a test cannot pass against a copy that has drifted from the code.
 *
 * `?1`..`?4` are numbered because the destination is referenced twice (or three times) — once as the
 * inserted value, once in the conflict target's implicit key, and once inside the subquery that
 * carries the previous window's count forward.
 */
export const atomicStatements = {
  /**
   * **Consume one unit of the budget, or change nothing.** The atomic point.
   *
   * Returns one row iff the budget was actually spent. That row's *presence* is what the guard
   * branches on (`first()` → `null` means refused); its `n` value is what the caller reports as
   * `priorCalls`. This is a single statement, so its condition and its increment are not separable.
   */
  consume: (table = CALL_RATE_TABLE): string =>
    `INSERT INTO ${table} (destination, window_key, n, not_live) ` +
    `VALUES (?1, ?2, 1, COALESCE((SELECT n FROM ${table} WHERE destination = ?1 AND window_key = ?2 - 1), 0)) ` +
    `ON CONFLICT (destination, window_key) DO UPDATE SET n = n + 1 WHERE n < ?3 ` +
    `RETURNING n`,

  /**
   * **Read the row's counters without writing anything, and without ever changing the statement.**
   *
   * One statement, run in every case. When the row exists this reports it; when it does not (a fresh
   * destination, or a window old enough to have been pruned) it reports `not_live` from the previous
   * window, so a refusal can still name the instant the window frees up. This is deliberately *not*
   * `UPDATE … RETURNING`, which would do nothing when exhausted but would write `sqlite_stat1`
   * statistics when it did something, on the path every allowed call takes.
   */
  read: (table = CALL_RATE_TABLE): string =>
    `SELECT (SELECT n FROM ${table} WHERE destination = ?1 AND window_key = ?2) AS n, ` +
    `(SELECT COALESCE((SELECT n FROM ${table} WHERE destination = ?1 AND window_key = ?2 - 1), 0)) AS not_live`,
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

/** One row of `call_rate_window`, as the two statements return it. */
interface CounterRow {
  readonly n?: number | null;
  readonly not_live?: number | null;
}

/** A finite, non-negative integer read out of a row, or `0` for anything else (null, junk, a string). */
function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Both counters from one {@link atomicStatements.read} result. */
function readCounters(result: { results?: CounterRow[] } | undefined): { live: number; notLive: number } {
  const row = rows<CounterRow>(result)[0];
  return { live: count(row?.n), notLive: count(row?.not_live) };
}

/**
 * When the current window's counted calls age out.
 *
 * The answer is exact when the row is live: all of this window's calls were counted before the window
 * ends, so they have all expired one full window after it does. When the row is missing the answer is
 * the previous window's end, i.e. "now" — the honest reading of a row that has already rolled over.
 */
function windowFreesAt(window: number, live: number, windowSeconds: number): string | null {
  if (live <= 0) return null;
  return new Date((window + 1) * windowSeconds * 1000).toISOString();
}

/* ------------------------------------------------------------------ the guard */

/**
 * Decide whether `to` may be dialled right now, and count the call if it may.
 *
 * The counter is *consumed here* rather than left to the caller: a caller that forgot to record would
 * otherwise be unlimited, and the whole point is that no path can opt out of the budget. Callers that
 * are refused for a reason other than the limit itself (a malformed number, for instance) must say so
 * with {@link releaseCall}, or they spend a slot they never used.
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
  const window = windowKeyAt(now, config.windowSeconds);

  // ---- Consume the budget, or don't. One statement decides; nothing here branches on a prior read.
  //
  // The statement reports one `RETURNING n` row iff it actually spent a slot, so that row is the
  // permission. It is read through `first()`, whose contract is `T | null` — a *row*, not a row count,
  // so the answer does not depend on how a driver reports `meta.changes`. (The in-memory D1 shim can
  // only offer `total_changes()`, a cumulative figure, which is not the statement's own change count;
  // `first()` is the one shape both it and the real binding agree on.)
  let spent = false;
  let thisCall = 0;
  try {
    const row = await db.prepare(atomicStatements.consume()).bind(destination, window, config.maxCalls).first<CounterRow>();
    if (row !== null) {
      spent = true;
      // `RETURNING n` is the count *after* this call. It is used only to number the call in the log
      // and to report `priorCalls`; whether it is 1 or 3 decides nothing. A row whose `n` is missing
      // or unreadable still means the slot was spent, so the call number falls back to the ceiling
      // rather than inventing a smaller one.
      thisCall = count(row.n) || config.maxCalls;
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
      detail: `allowed: call ${thisCall} of ${config.maxCalls} to ${to} in ${config.windowSeconds}s${misconfigured}`,
    };
  }

  // ---- Refused: the statement produced no row, which means the budget was already spent.
  // Read the two counters back only to *describe* the refusal (`priorCalls`, `retryAfterAt`). The
  // refusal itself was already decided by the statement above, so nothing in this read can allow a
  // call: a failing or empty read can only make the message less specific, never the decision.
  let live = config.maxCalls;
  let notLive = 0;
  try {
    const result = await db
      .prepare(atomicStatements.read())
      .bind(destination, window)
      .all<CounterRow>();
    const counters = readCounters(result);
    if (counters.live > 0) live = counters.live;
    notLive = counters.notLive;
  } catch {
    /* described with the ceiling instead of the exact count; the refusal stands either way */
  }

  return rateLimitedDecision(
    to,
    config,
    live,
    windowFreesAt(window, live > 0 ? live : notLive, config.windowSeconds),
    misconfigured,
  );
}

/**
 * Give back a slot consumed by a call that was never dialled.
 *
 * Used when the caller has already passed the guard and then discovers a reason not to dial — the
 * counted case is the escalation ladder's `placeCall` returning a transport refusal, which is a
 * *failed* call that the ladder still counts as an attempt. Best-effort and never throws: releasing a
 * slot is an accuracy improvement, not a correctness requirement.
 *
 * The decrement is guarded by `n > 0` so a stale release from a previous window (addressed by
 * {@link releaseKey}) cannot drive the counter negative, which the table's CHECK would reject.
 * `releaseKey` is the helper for a caller that still holds the key the slot was spent against; the
 * `at` argument of the old signature was an epoch millisecond instant, which is what it accepts.
 */
export async function releaseCall(
  env: RateLimitBindings,
  to: string,
  at?: number | string,
): Promise<void> {
  const db = env.DB;
  if (db === undefined) return;
  const config = rateLimitConfig(env);
  const window = releaseKey(at, config.windowSeconds, new Date());
  try {
    await db
      .prepare(
        `UPDATE ${CALL_RATE_TABLE} SET n = n - 1 WHERE destination = ?1 AND window_key = ?2 AND n > 0`,
      )
      .bind(destinationKey(to), window)
      .run();
  } catch {
    /* best effort: a lost release only makes the guard slightly stricter */
  }
}

/**
 * The window a release refers to.
 *
 * A release names the slot's own window (the increment it is undoing happened in that window), so an
 * `at` instant is mapped back to its window key. Without a usable instant the current window is used,
 * which is right for the common case of a call that failed within seconds of being counted.
 */
export function releaseKey(at: number | string | undefined, windowSeconds: number, now: Date): number {
  if (typeof at === "number" && Number.isFinite(at)) return windowKeyAt(new Date(at), windowSeconds);
  if (typeof at === "string") {
    const parsed = Date.parse(at);
    if (Number.isFinite(parsed)) return windowKeyAt(new Date(parsed), windowSeconds);
  }
  return windowKeyAt(now, windowSeconds);
}

/**
 * Delete counter rows from windows that can no longer refuse anything.
 *
 * A row is useless once this window has moved past it: the guard addresses `window` and `window - 1`
 * and nothing older, so a row whose key is `<= window - 2` can never be read again. Deleting them
 * keeps a long-lived database from accumulating one small row per (destination, window) forever.
 *
 * **Called off the guard's path, deliberately.** Pruning can be run from an operator command or a
 * scheduled job; it must not run inside `checkOutboundCall`, because that would put a table-wide
 * `DELETE` (and the write lock it takes) inside the request-critical statement, turning a tidy-up
 * into a contention source on exactly the path whose atomicity is the point. The table is bounded
 * without it — see the file docstring — so this is hygiene, not a requirement.
 */
export async function pruneCallRateWindows(
  env: RateLimitBindings,
  now: Date = new Date(),
  keepWindows = 2,
): Promise<number> {
  const db = env.DB;
  if (db === undefined) return 0;
  const config = rateLimitConfig(env);
  const oldest = windowKeyAt(now, config.windowSeconds) - Math.max(keepWindows, 1);
  try {
    // The number of rows removed is measured as the difference between the row count before and
    // after, rather than read from `meta.changes`: D1 reports the statement's own change count there,
    // but the in-memory shim can only offer `total_changes()`, which is cumulative across the
    // connection. Counting rows is the one reading both agree on, and it is what the caller wants to
    // know ("how much did the prune reclaim?") rather than an engine bookkeeping figure.
    const before = await rowCount(db);
    await db.prepare(`DELETE FROM ${CALL_RATE_TABLE} WHERE window_key <= ?1`).bind(oldest).run();
    return Math.max(before - (await rowCount(db)), 0);
  } catch {
    return 0;
  }
}

/** How many rows the counter table holds. `null` when it cannot be counted. */
async function rowCount(db: CounterDb): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM ${CALL_RATE_TABLE}`)
    .first<{ n?: number }>();
  return count(row?.n);
}

/**
 * A human-readable one-line log for a decision, so every call site reports the same way.
 *
 * `console.warn` for a refusal and `console.log` for an allowed call that was not simply counted, so
 * a refusal is greppable in the Worker's log stream (`rate limited:`) without drowning in the happy
 * path.
 */
export function logCallDecision(label: string, decision: CallDecision): void {
  const line = `noloop: ${label} — ${decision.detail}`;
  if (!decision.allowed) console.warn(line);
  else if (decision.reason === "counter_unavailable") console.warn(line);
  else console.log(line);
}
