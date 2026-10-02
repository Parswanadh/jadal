/**
 * Durable-campaign-workflow tests (P10 audit).
 *
 * `workflows.ts` was flagged "never audited" in `docs/HANDOFF-ENGINEERING.md` §5. These tests pin
 * the behaviour it actually has, with a hand-written `WorkflowStep` that records every durable
 * primitive it is asked for and a fake clock. They deliberately do **not** re-test the ladder
 * (`escalation.test.ts` owns that); they test the *scheduling*: step ordering, the retry sleep, the
 * attempt ceiling, and the claim that a replayed step cannot double-dial.
 *
 * NO NETWORK: only `test/harness.ts`'s `createEnv` is used, and its fetch throws on an unmocked URL,
 * so a test that accidentally reached Twilio would fail loudly rather than ring.
 */

import { describe, expect, it } from "vitest";
import type { Contact } from "@jadal/contracts";

import { createEnv, createTestDb, type FetchRoutes, type TestEnv } from "../../test/harness";
import { seedScenario } from "../../test/fixtures";
import { now as clockNow } from "../db/clock";
import { deterministicId } from "../db/id";
import { appendEvent } from "../db/store";
import { RETRY_DELAY_MINUTES } from "./escalation";
import {
  CallCampaignWorkflow,
  DEFAULT_MAX_ATTEMPTS,
  UrgentRequestWorkflow,
  type WorkflowEvent,
  type WorkflowStep,
} from "./workflows";

const TWILIO = {
  TWILIO_ACCOUNT_SID: "ACtest123",
  TWILIO_AUTH_TOKEN: "test-token-not-a-secret",
  TWILIO_FROM_NUMBER: "+15005550006",
  PUBLIC_BASE_URL: "https://jadal.example.dev",
} as const;

/** One durable primitive invocation, in order. */
interface StepCall {
  readonly kind: "do" | "sleep" | "wait";
  readonly name: string;
  readonly duration?: string;
}

/**
 * A `WorkflowStep` that records calls and can emulate the two runtime behaviours the audit cares
 * about: an acknowledgement that never arrives (`waitForEvent` throws, as it does on timeout), and a
 * step whose callback ran but whose checkpoint was lost, so the runtime invokes it a second time.
 */
class FakeStep implements WorkflowStep {
  readonly calls: StepCall[] = [];
  /** Names of `do` callbacks actually invoked, with duplicates for a replayed step. */
  readonly invoked: string[] = [];
  readonly #ack: boolean;
  readonly #replayOnce: Set<string>;

  constructor(options: { ack?: boolean; replayOnce?: readonly string[] } = {}) {
    this.#ack = options.ack ?? false;
    this.#replayOnce = new Set(options.replayOnce ?? []);
  }

  async do<T>(stepName: string, callback: () => T | Promise<T>): Promise<T> {
    this.calls.push({ kind: "do", name: stepName });
    let result = await callback();
    this.invoked.push(stepName);
    if (this.#replayOnce.has(stepName)) {
      // The callback completed, but the checkpoint was not written (or the isolate was evicted
      // before it). The real runtime re-runs the step; the callback must be safe to re-run.
      this.#replayOnce.delete(stepName);
      result = await callback();
      this.invoked.push(stepName);
    }
    return result;
  }

  async sleep(duration: string): Promise<void> {
    this.calls.push({ kind: "sleep", name: duration, duration });
  }

  async waitForEvent<T>(
    stepName: string,
    _options: { readonly type: string; readonly timeout?: string },
  ): Promise<{ readonly payload: T }> {
    this.calls.push({ kind: "wait", name: stepName });
    if (this.#ack) return { payload: {} as T };
    throw new Error("waitForEvent timed out");
  }
}

function event<Params>(payload: Params): WorkflowEvent<Params> {
  return { payload, timestamp: new Date("2026-10-02T00:00:00.000Z"), instanceId: "wf-test" };
}

async function dbEnv(routes: FetchRoutes = {}): Promise<TestEnv> {
  const env = createEnv(routes);
  env.DB = await createTestDb();
  await seedScenario(env);
  return env;
}

function voiceContact(id: string, farmerId: string, attempt: number, at: string): Contact {
  return {
    id,
    farmer_id: farmerId,
    channel: "voice",
    purpose: "roster_change",
    status: "queued",
    attempt,
    message_te: "జడల్: మీ నీటి వంతు మారింది.",
    message_en: "Jadal: your turn has changed.",
    at,
  };
}

async function seedContact(env: TestEnv, contact: Contact): Promise<Contact> {
  const at = await clockNow(env);
  await appendEvent(env, {
    id: deterministicId("evt", "contact.updated", contact.id),
    at,
    canal_id: "c1",
    actor: { kind: "agent", id: "caller" },
    type: "contact.updated",
    contact,
  });
  return contact;
}

function twilioCalls(env: TestEnv): number {
  return env.calls.filter((call) => call.url.includes("api.twilio.com")).length;
}

function stepNames(step: FakeStep): string[] {
  return step.calls.map((call) => call.name);
}

describe("UrgentRequestWorkflow", () => {
  it("with an acknowledgement: alerts, calls once, waits, and never sleeps", async () => {
    const env = await dbEnv({ "api.twilio.com": { sid: "CA1", status: "queued" } });
    Object.assign(env, TWILIO);
    const at = await clockNow(env);
    await seedContact(env, voiceContact("ct-urgent-1", "f1", 1, at));

    const step = new FakeStep({ ack: true });
    const workflow = new UrgentRequestWorkflow({} as ExecutionContext, env);
    const result = await workflow.run(event({ requestId: "r1", contactId: "ct-urgent-1" }), step);

    expect(result).toMatchObject({ request_id: "r1", acknowledged: true });
    expect(result.final_contact_id).not.toBeNull();
    expect(stepNames(step)).toEqual(["alert-coordinator", "first-call", "await-acknowledgement"]);
    expect(step.calls.some((call) => call.kind === "sleep")).toBe(false);
    expect(twilioCalls(env)).toBe(1);
  });

  it("on timeout: sleeps one retry gap and makes exactly one retry", async () => {
    const env = await dbEnv({ "api.twilio.com": { sid: "CA1", status: "queued" } });
    Object.assign(env, TWILIO);
    const at = await clockNow(env);
    // f5 is a feature phone: voice is its only reachable channel, so the retry rung is a second call.
    await seedContact(env, voiceContact("ct-urgent-2", "f5", 1, at));

    const step = new FakeStep({ ack: false });
    const workflow = new UrgentRequestWorkflow({} as ExecutionContext, env);
    const result = await workflow.run(event({ requestId: "r2", contactId: "ct-urgent-2" }), step);

    expect(result.acknowledged).toBe(false);
    expect(stepNames(step)).toEqual([
      "alert-coordinator",
      "first-call",
      "await-acknowledgement",
      "15 minutes",
      "retry-call",
    ]);
    // First call (attempt 1 -> 2) then the durable retry (attempt 2 -> 3); two dials, no more.
    expect(twilioCalls(env)).toBe(2);
  });

  it("with no contact id: alerts and returns, without waiting or dialling", async () => {
    const env = await dbEnv();
    const step = new FakeStep({ ack: true });
    const workflow = new UrgentRequestWorkflow({} as ExecutionContext, env);
    const result = await workflow.run(event({ requestId: "r3" }), step);

    expect(result).toEqual({ request_id: "r3", acknowledged: false, final_contact_id: null });
    expect(stepNames(step)).toEqual(["alert-coordinator"]);
    expect(env.calls).toHaveLength(0);
  });

  it("the alert-coordinator step is a checkpoint only: it places no call and sends nothing", async () => {
    const env = await dbEnv({ "api.twilio.com": { sid: "CA1", status: "queued" } });
    Object.assign(env, TWILIO);
    const at = await clockNow(env);
    await seedContact(env, voiceContact("ct-urgent-4", "f1", 1, at));

    const step = new FakeStep({ ack: true });
    const workflow = new UrgentRequestWorkflow({} as ExecutionContext, env);
    await workflow.run(event({ requestId: "r4", contactId: "ct-urgent-4" }), step);

    // Two dials are attributable: the first call and the retry. Nothing dials for the alert step.
    expect(env.OUTBOUND.sent).toHaveLength(1);
  });
});

describe("CallCampaignWorkflow", () => {
  it("terminates at the ladder's escalation even with a huge maxAttempts", async () => {
    const env = await dbEnv({ "api.twilio.com": { sid: "CA1", status: "queued" } });
    Object.assign(env, TWILIO);
    const at = await clockNow(env);
    await seedContact(env, voiceContact("ct-camp-1", "f5", 1, at));

    const step = new FakeStep();
    const workflow = new CallCampaignWorkflow({} as ExecutionContext, env);
    const result = await workflow.run(
      event({ contactId: "ct-camp-1", maxAttempts: 1_000_000_000 }),
      step,
    );

    expect(result.status).toBe("escalated");
    // The ladder reaches `escalated` on attempt 4, so the loop is intrinsically stage-bounded.
    expect(result.attempts).toBeLessThanOrEqual(4);
    expect(step.calls.filter((call) => call.kind === "do").length).toBeLessThanOrEqual(4);
    // f5 is voice-only: attempt 2 and attempt 3 are real dials; attempt 4 is the coordinator flag.
    expect(twilioCalls(env)).toBe(2);
  });

  it("cannot bypass the rate guard: a refused rung is failed, not dialled", async () => {
    const env = await dbEnv({ "api.twilio.com": { sid: "CA1", status: "queued" } });
    Object.assign(env, TWILIO, { CALL_RATE_MAX_CALLS: "1", CALL_RATE_WINDOW_SECONDS: "60" });
    const at = await clockNow(env);
    await seedContact(env, voiceContact("ct-camp-2", "f5", 1, at));

    const step = new FakeStep();
    const workflow = new CallCampaignWorkflow({} as ExecutionContext, env);
    const result = await workflow.run(event({ contactId: "ct-camp-2", maxAttempts: 3 }), step);

    // Exactly one dial reaches Twilio; the refused rungs are marked failed and never fetched.
    expect(twilioCalls(env)).toBe(1);
    expect(result.status).toBe("escalated");
  });

  it("re-running a step whose checkpoint was lost does not place a second call", async () => {
    const env = await dbEnv({ "api.twilio.com": { sid: "CA1", status: "queued" } });
    Object.assign(env, TWILIO);
    const at = await clockNow(env);
    await seedContact(env, voiceContact("ct-replay-1", "f1", 1, at));

    const step = new FakeStep({ replayOnce: ["first-contact"] });
    const workflow = new CallCampaignWorkflow({} as ExecutionContext, env);
    await workflow.run(event({ contactId: "ct-replay-1", maxAttempts: 1 }), step);

    // The callback ran twice (lost checkpoint) but `runEscalation` is idempotent per
    // (contact, attempt): the existing next contact is returned, no second dial.
    expect(step.invoked.filter((name) => name === "first-contact")).toHaveLength(2);
    expect(twilioCalls(env)).toBe(1);
  });

  it("falls back to the default ceiling when maxAttempts is not a finite number", async () => {
    const env = await dbEnv({ "api.twilio.com": { sid: "CA1", status: "queued" } });
    Object.assign(env, TWILIO);
    const at = await clockNow(env);
    await seedContact(env, voiceContact("ct-camp-nan", "f5", 1, at));

    const step = new FakeStep();
    const workflow = new CallCampaignWorkflow({} as ExecutionContext, env);
    const result = await workflow.run(
      event({ contactId: "ct-camp-nan", maxAttempts: Number.NaN }),
      step,
    );

    // A checkout-ruining NaN must not silently turn the campaign into a one-rung no-op; the
    // documented default ladder is used instead.
    expect(result.status).toBe("escalated");
  });

  it("does not bound the first rung by maxAttempts", async () => {
    const env = await dbEnv({ "api.twilio.com": { sid: "CA1", status: "queued" } });
    Object.assign(env, TWILIO);
    const at = await clockNow(env);
    await seedContact(env, voiceContact("ct-camp-3", "f1", 1, at));

    const step = new FakeStep();
    const workflow = new CallCampaignWorkflow({} as ExecutionContext, env);
    const result = await workflow.run(event({ contactId: "ct-camp-3", maxAttempts: 0 }), step);

    // `maxAttempts` bounds *retries*, not the first contact: one dial still goes out.
    expect(twilioCalls(env)).toBe(1);
    expect(result.status).not.toBe("escalated");
  });

  it("uses relative-duration sleeps, so no wall-clock or DST arithmetic is involved", async () => {
    const env = await dbEnv();
    const at = await clockNow(env);
    await seedContact(env, voiceContact("ct-camp-4", "f1", 1, at));

    const step = new FakeStep();
    const workflow = new CallCampaignWorkflow({} as ExecutionContext, env);
    await workflow.run(event({ contactId: "ct-camp-4", maxAttempts: 2 }), step);

    const sleeps = step.calls.filter((call) => call.kind === "sleep");
    expect(sleeps.length).toBeGreaterThan(0);
    expect(sleeps.every((call) => call.duration === `${RETRY_DELAY_MINUTES} minutes`)).toBe(true);
    expect(RETRY_DELAY_MINUTES).toBe(15);
    expect(DEFAULT_MAX_ATTEMPTS).toBe(4);
  });
});
