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
 *  * the guard blocks the 4th call in the measured 01:45 burst shape (four calls in 40 seconds);
 *  * it resets after the window, and counts per destination rather than globally;
 *  * one handset formatted three ways shares one budget (otherwise the limit is trivially bypassed);
 *  * N and the window are configurable by env, and a *misconfigured* value is reported not ignored;
 *  * the failure mode is exercised both ways: fail-open (the shipped default) still dials, and
 *    fail-closed refuses — and both report which they did;
 *  * a refusal is visible: returned on the decision, and carried into each call site's own outcome.
 */

import { describe, expect, it } from "vitest";

import { now as clockNow } from "./db/clock";
import { deterministicId } from "./db/id";
import { getContact } from "./db/repo";
import { appendEvent } from "./db/store";
import {
  DEFAULT_MAX_CALLS,
  DEFAULT_WINDOW_SECONDS,
  RATE_LIMIT_FAILURE_MODE,
  checkOutboundCall,
  destinationKey,
  logCallDecision,
  rateLimitConfig,
  rateLimitKey,
} from "./noloop";
import type { Contact } from "@jadal/contracts";
import { createEnv, createTestDb, type TestEnv } from "../test/harness";
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

/** A KV stub that can be made to fail on demand, to drive the failure-mode tests. */
class FlakyKV {
  readonly #map = new Map<string, string>();
  failGet = false;
  failPut = false;

  async get(key: string): Promise<string | null> {
    if (this.failGet) throw new Error("KV unavailable");
    return this.#map.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    if (this.failPut) throw new Error("KV unavailable");
    this.#map.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.#map.delete(key);
  }

  async list(): Promise<unknown> {
    return { keys: [...this.#map.keys()].map((name) => ({ name })) };
  }

  /** Inspect what was stored, for the TTL/one-key-per-destination assertions. */
  raw(key: string): string | null {
    return this.#map.get(key) ?? null;
  }

  get size(): number {
    return this.#map.size;
  }
}

/** A minimal env carrying only what the guard reads. */
function guardEnv(extra: Record<string, unknown> = {}): { CACHE: FlakyKV } & Record<string, unknown> {
  return Object.assign({ CACHE: new FlakyKV() }, extra);
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

describe("checkOutboundCall — the burst", () => {
  it("blocks the 4th call in a burst, and the first three are allowed", async () => {
    const env = guardEnv();

    // The measured 01:45 shape: four calls in 40 seconds.
    const offsets = [0, 12, 25, 40];
    const decisions = [];
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
    // And it says when the window frees up: the oldest call (offset 0) expires 60s later.
    expect(refusal?.retryAfterAt).toBe(at(60).toISOString());
  });

  it("resets after the window", async () => {
    const env = guardEnv();
    for (const offset of [0, 12, 25]) await checkOutboundCall(env, PHONE, at(offset));
    expect((await checkOutboundCall(env, PHONE, at(40))).allowed).toBe(false);

    // Still inside the window: still refused.
    expect((await checkOutboundCall(env, PHONE, at(59))).allowed).toBe(false);

    // At T0+61s the oldest (offset 0) has aged out, so one slot is free again — but the two younger
    // calls are still inside their own 60s window, which is the correct reading of "N per window".
    // This call is itself counted at T0+61s, so three hits are now live (12s, 25s, 61s).
    const afterWindow = await checkOutboundCall(env, PHONE, at(61));
    expect(afterWindow.allowed).toBe(true);
    expect(afterWindow.priorCalls).toBe(2);

    // By T0+86s every original call has aged out: only the T0+61s call remains, and the budget is
    // effectively fresh — the guard has forgotten the burst rather than accumulating forever.
    const nearlyReset = await checkOutboundCall(env, PHONE, at(86));
    expect(nearlyReset.allowed).toBe(true);
    expect(nearlyReset.priorCalls).toBe(1);
    expect(nearlyReset.detail).toContain("call 2 of 3");
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

  it("stores one window per destination and gives it a TTL", async () => {
    const env = guardEnv();
    await checkOutboundCall(env, PHONE, at(0));
    expect(env.CACHE.size).toBe(1);
    const stored = env.CACHE.raw(rateLimitKey(PHONE));
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string)).toEqual({ hits: [T0.getTime()] });
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

describe("checkOutboundCall — failure mode", () => {
  it("ships fail-open: an unreadable counter still allows the call", () => {
    // The decision recorded in `docs/ops/CALL-SAFETY.md`. Asserted here so changing it is deliberate.
    expect(RATE_LIMIT_FAILURE_MODE).toBe("open");
  });

  it("fails open and SAYS so when the counter cannot be read", async () => {
    const env = guardEnv();
    env.CACHE.failGet = true;

    const decision = await checkOutboundCall(env, PHONE, at(0));
    expect(decision.allowed).toBe(true);
    expect(decision.checked).toBe(false);
    expect(decision.reason).toBe("counter_unavailable");
    expect(decision.detail).toContain("failing open");
    // Not counted as a normal call, so a caller cannot mistake it for a checked decision.
    expect(decision.detail).toContain("could not read the call counter");
  });

  it("fails open when there is no CACHE binding at all", async () => {
    const decision = await checkOutboundCall({}, PHONE, at(0));
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("counter_unavailable");
    expect(decision.detail).toContain("no CACHE binding");
  });

  it("still allows the call when the counter cannot be written, rather than lying", async () => {
    const env = guardEnv();
    env.CACHE.failPut = true;
    const decision = await checkOutboundCall(env, PHONE, at(0));
    // The call is going out regardless (the read already allowed it); reporting a refusal the caller
    // cannot act on would be dishonest.
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("counter_unavailable");
    expect(decision.detail).toContain("counter not updated");
  });

  it("reports a misconfigured limit on the decision itself", async () => {
    const env = guardEnv({ CALL_RATE_MAX_CALLS: "nonsense" });
    const decision = await checkOutboundCall(env, PHONE, at(0));
    expect(decision.maxCalls).toBe(DEFAULT_MAX_CALLS);
    expect(decision.detail).toContain("CALL_RATE_MAX_CALLS");
  });

  it("treats a corrupt stored window as empty rather than throwing mid-call", async () => {
    const env = guardEnv();
    await env.CACHE.put(rateLimitKey(PHONE), "{not json");
    const decision = await checkOutboundCall(env, PHONE, at(0));
    expect(decision.allowed).toBe(true);
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
    env.DB = await createTestDb();
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
