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
 * ## Refusal is visible, never silent
 *
 * A rate limit that silently drops a call is worse than the burst it prevents: the coordinator's
 * phone never rings, nothing in the log says why, and the request appears to have been handled. So a
 * refusal here is a {@link CallDecision} with `allowed: false`, the tripping `reason`, the count that
 * tripped it and the instant the window frees up. Callers are required to *report* it — the ladder
 * marks the contact `failed` and the coordinator path returns `skipped` — and both log a line naming
 * the limit. "We did not call, and here is why" is the contract.
 *
 * ## Fail-open, and why
 *
 * If the counter store cannot be read, the guard **allows the call** ({@link RATE_LIMIT_FAILURE_MODE}
 * `open`). This is a deliberate choice for a product where every call costs money and rings a real
 * person, and it is argued in full in `docs/ops/CALL-SAFETY.md`. In short: a KV outage is not
 * correlated with a call loop, so failing closed converts a rare infrastructure blip into silently
 * dropped *emergency* calls (a night-release warning nobody receives), while failing open degrades to
 * exactly the behaviour that ran before this file existed — which the ladder's own attempt bounds
 * still cap. Failing open loses a backstop; failing closed loses the emergency. `closed` is available
 * by env for a deployment that would rather drop calls than risk a burst.
 *
 * ## State, and why it is one key
 *
 * The counters live in `KV` under {@link rateLimitKey}, one key per destination, holding a JSON
 * {@link RateWindow}. Naming the destination is {@link destinationKey}, which normalises a number to
 * its digits for the same reason `telephony-deps.phoneKey` does: `+91 90000 00001`,
 * `+919000000001` and `tel:+919000000001` are one handset and must share one budget. Without that, a
 * caller could spend the budget three times over by formatting the number three ways.
 *
 * ## Honest limits (reported, not papered over)
 *
 *  * **KV is eventually consistent and has no atomic increment.** Two calls that read the same
 *    counter in the same instant can both write `1` and both be allowed. This guard is exact for the
 *    *sequential* bursts that actually happened (four calls over 40 seconds, seconds apart) and
 *    best-effort for two simultaneous callers. It is a backstop, not a mutex; the ladder's attempt
 *    bounds remain the primary control. Making it atomic needs a Durable Object, which is a binding
 *    change owned by another lane, not something to smuggle in here.
 *  * **A cold read under-counts.** A TTL-expired key is indistinguishable from a fresh destination,
 *    so the first call after a quiet spell always succeeds. That is the intended reading of "N per
 *    window", not a bug.
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

/** The bindings slice the guard needs. `Env` satisfies it structurally; campaigns pass their own env. */
export interface RateLimitBindings {
  readonly CACHE?: KVNamespace | undefined;
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

/** The KV key holding one destination's window. Exported so a recovery procedure can read/clear it. */
export function rateLimitKey(to: string): string {
  return `callcap:v1:${destinationKey(to)}`;
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

/** The stored window shape. One row per destination in KV. */
interface RateWindow {
  /** ISO-8601 instants of the calls counted in this window, oldest first. */
  readonly hits: readonly string[];
}

/**
 * One refused-but-not-limited decision: the store could not be read and the configured failure mode
 * allowed the call anyway.
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
 * have to handle a third outcome. The HTTP plumbing in {@link KVNamespace} also throws synchronously
 * on some runtimes rather than rejecting, which is why the `try` wraps the `await` and not the call.
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

  // No `CACHE` binding at all: a deployment or a unit test with no counter store. That is a
  // *configuration* fact, not an outage, so it takes the same documented failure mode.
  const kv = env.CACHE;
  if (kv === undefined) {
    const detail = `no CACHE binding to count calls against${misconfigured}; failing ${RATE_LIMIT_FAILURE_MODE}`;
    if (RATE_LIMIT_FAILURE_MODE === "closed") {
      return {
        allowed: false,
        to,
        checked: false,
        priorCalls: 0,
        ...ceiling,
        reason: "counter_unavailable",
        retryAfterAt: null,
        detail,
      };
    }
    return failOpenDecision(to, config, detail);
  }

  const key = rateLimitKey(to);
  const windowMs = config.windowSeconds * 1000;

  let prior = 0;
  try {
    const raw = await kv.get(key);
    const parsed: unknown = raw === null || raw === "" ? null : JSON.parse(raw);
    const hits = readHits(parsed);
    prior = hits.filter((at) => now.getTime() - at < windowMs).length;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const detail = `could not read the call counter for ${to}: ${message}; failing ${RATE_LIMIT_FAILURE_MODE}`;
    if (RATE_LIMIT_FAILURE_MODE === "closed") {
      return {
        allowed: false,
        to,
        checked: false,
        priorCalls: 0,
        ...ceiling,
        reason: "counter_unavailable",
        retryAfterAt: null,
        detail,
      };
    }
    return failOpenDecision(to, config, detail);
  }

  if (prior >= config.maxCalls) {
    // Report the earliest counted call, which is the one whose expiry frees a slot.
    const oldest = await oldestHit(env, key, now, windowMs);
    const retryAfterAt =
      oldest === null ? null : new Date(oldest + windowMs).toISOString();
    return {
      allowed: false,
      to,
      checked: true,
      priorCalls: prior,
      ...ceiling,
      reason: "rate_limited",
      retryAfterAt,
      detail:
        `rate limited: ${to} already has ${prior} call(s) in the last ${config.windowSeconds}s ` +
        `(limit ${config.maxCalls})${misconfigured}`,
    };
  }

  // Allowed: record the call before returning, so a caller cannot dial without spending a slot.
  try {
    const raw = await kv.get(key);
    const hits = readHits(raw === null || raw === "" ? null : JSON.parse(raw));
    const live = hits.filter((at) => now.getTime() - at < windowMs);
    const next = { hits: [...live, now.getTime()] };
    // The TTL is the window plus a margin: the key must outlive the window it describes (so a
    // just-expired call is still readable when computing `retryAfterAt`) without accumulating forever.
    await kv.put(key, JSON.stringify(next), { expirationTtl: config.windowSeconds + 60 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A write that fails *after* the read allowed the call: the call is going out regardless, and
    // reporting it as refused would be a lie the caller cannot act on. It is allowed and logged.
    return failOpenDecision(to, config, `could not record the call to ${to}: ${message}; call allowed, counter not updated`);
  }

  return {
    allowed: true,
    to,
    checked: true,
    priorCalls: prior,
    ...ceiling,
    reason: "unknown",
    retryAfterAt: null,
    detail: `allowed: call ${prior + 1} of ${config.maxCalls} to ${to} in ${config.windowSeconds}s${misconfigured}`,
  };
}

/**
 * Give back a slot consumed by a call that was never dialled.
 *
 * Used when the caller has already passed the guard and then discovers a reason not to dial — the
 * counted case is the escalation ladder's `placeCall` returning a transport refusal, which is a
 * *failed* call that the ladder still counts as an attempt. Best-effort and never throws: releasing a
 * slot is an accuracy improvement, not a correctness requirement.
 */
export async function releaseCall(env: RateLimitBindings, to: string, at: number): Promise<void> {
  const kv = env.CACHE;
  if (kv === undefined) return;
  const key = rateLimitKey(to);
  try {
    const raw = await kv.get(key);
    const hits = readHits(raw === null || raw === "" ? null : JSON.parse(raw));
    const remaining = hits.filter((hit) => hit !== at);
    if (remaining.length === 0) {
      await kv.delete(key);
      return;
    }
    await kv.put(key, JSON.stringify({ hits: remaining }), {
      expirationTtl: rateLimitConfig(env).windowSeconds + 60,
    });
  } catch {
    /* best effort: a lost release only makes the guard slightly stricter */
  }
}

/** The oldest still-live hit, used to say when a slot frees up. `null` when the state is unreadable. */
async function oldestHit(
  env: RateLimitBindings,
  key: string,
  now: Date,
  windowMs: number,
): Promise<number | null> {
  try {
    const raw = await env.CACHE?.get(key);
    const hits = readHits(raw === null || raw === "" || raw === undefined ? null : JSON.parse(raw));
    const live = hits.filter((at) => now.getTime() - at < windowMs);
    return live.length === 0 ? null : Math.min(...live);
  } catch {
    return null;
  }
}

/**
 * Read a stored window defensively.
 *
 * KV is not a schema and this key is written by a previous release too, so anything unparseable is
 * treated as an empty window rather than thrown on. A corrupt counter must not become a 500 in the
 * middle of ringing a farmer.
 */
function readHits(parsed: unknown): number[] {
  if (parsed === null || typeof parsed !== "object") return [];
  const hits = (parsed as { hits?: unknown }).hits;
  if (!Array.isArray(hits)) return [];
  return hits.filter((at): at is number => typeof at === "number" && Number.isFinite(at));
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
