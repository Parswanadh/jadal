/**
 * Durable campaign-workflow tests.
 *
 * The workflow classes are thin: all branching lives in the pure ladder (`escalation.ts`), and the
 * class bodies are just the durable ordering of `runEscalation` calls. These tests therefore drive
 * `run` with a fake `WorkflowStep` that records the durable calls, and a mocked `runEscalation`, so
 * they pin exactly the orchestration that must survive an isolate restart: the step names and order,
 * the 15-minute sleep, when the retry happens, and how the result maps back.
 *
 * `cloudflare:workers` is aliased to `test/cloudflare-workers-stub.ts` by `vitest.config.ts`.
 */

import type { Contact } from "@jadal/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";

const { runEscalationMock } = vi.hoisted(() => ({ runEscalationMock: vi.fn() }));

vi.mock("./escalation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./escalation")>();
  return { ...actual, runEscalation: runEscalationMock };
});

import type { CampaignEnv } from "./escalation";
import { CallCampaignWorkflow, DEFAULT_MAX_ATTEMPTS, UrgentRequestWorkflow } from "./workflows";

const ENV = {} as unknown as CampaignEnv;

function event<T>(payload: T): WorkflowEvent<T> {
  return {
    payload,
    timestamp: new Date("2026-09-14T06:00:00.000Z"),
    instanceId: "instance-1",
    workflowId: "workflow-1",
  };
}

interface StepLog {
  readonly kind: "do" | "sleep" | "sleepUntil" | "waitForEvent";
  readonly name: string;
}

/** A durable step that records each call and runs `do` callbacks eagerly. */
function makeStep(options: { waitForEvent?: () => Promise<{ contact_id?: string }> } = {}): {
  step: WorkflowStep;
  log: StepLog[];
} {
  const log: StepLog[] = [];
  const step = {
    async do(name: string, callback: () => unknown): Promise<unknown> {
      log.push({ kind: "do", name });
      return await callback();
    },
    async sleep(name: string): Promise<void> {
      log.push({ kind: "sleep", name });
    },
    async sleepUntil(name: string): Promise<void> {
      log.push({ kind: "sleepUntil", name });
    },
    async waitForEvent(name: string): Promise<{ contact_id?: string }> {
      log.push({ kind: "waitForEvent", name });
      if (options.waitForEvent === undefined) throw new Error(`unexpected waitForEvent ${name}`);
      return options.waitForEvent();
    },
  };
  return { step: step as unknown as WorkflowStep, log };
}

function contact(id: string, overrides: Partial<Contact> = {}): Contact {
  return {
    id,
    farmer_id: "f1",
    channel: "voice",
    purpose: "roster_change",
    status: "queued",
    attempt: 2,
    message_te: "జడల్",
    message_en: "Jadal",
    at: "2026-09-14T06:15:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  runEscalationMock.mockReset();
});

describe("UrgentRequestWorkflow", () => {
  it("alerts the coordinator and returns unacknowledged when no contact was queued", async () => {
    const { step, log } = makeStep();

    const result = await new UrgentRequestWorkflow({} as ExecutionContext, ENV).run(event({ requestId: "r1" }), step);

    expect(result).toEqual({ request_id: "r1", acknowledged: false, final_contact_id: null });
    expect(log.map((entry) => entry.name)).toEqual(["alert-coordinator"]);
    expect(runEscalationMock).not.toHaveBeenCalled();
  });

  it("stops after the first call when it produces no next contact", async () => {
    runEscalationMock.mockResolvedValueOnce(null);
    const { step, log } = makeStep();

    const result = await new UrgentRequestWorkflow({} as ExecutionContext, ENV).run(
      event({ requestId: "r1", contactId: "c1" }),
      step,
    );

    expect(result).toEqual({ request_id: "r1", acknowledged: false, final_contact_id: null });
    expect(log.map((entry) => entry.name)).toEqual(["alert-coordinator", "first-call"]);
  });

  it("returns the acknowledged contact and does not retry when the wait resolves", async () => {
    runEscalationMock.mockResolvedValueOnce(contact("c2"));
    const { step, log } = makeStep({ waitForEvent: async () => ({ contact_id: "c2" }) });

    const result = await new UrgentRequestWorkflow({} as ExecutionContext, ENV).run(
      event({ requestId: "r1", contactId: "c1" }),
      step,
    );

    expect(result).toEqual({ request_id: "r1", acknowledged: true, final_contact_id: "c2" });
    expect(log.map((entry) => entry.name)).toEqual([
      "alert-coordinator",
      "first-call",
      "await-acknowledgement",
    ]);
    expect(runEscalationMock).toHaveBeenCalledTimes(1);
  });

  it("sleeps 15 minutes and retries once when the acknowledgement times out", async () => {
    runEscalationMock
      .mockResolvedValueOnce(contact("c2"))
      .mockResolvedValueOnce(contact("c3", { attempt: 3 }));
    const { step, log } = makeStep({
      waitForEvent: async () => {
        throw new Error("timeout");
      },
    });
    // The workflow logs the caught timeout before falling back to the retry; keep the test output clean.
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await new UrgentRequestWorkflow({} as ExecutionContext, ENV).run(
      event({ requestId: "r1", contactId: "c1" }),
      step,
    );
    logged.mockRestore();

    expect(result).toEqual({ request_id: "r1", acknowledged: false, final_contact_id: "c3" });
    expect(log.map((entry) => `${entry.kind}:${entry.name}`)).toEqual([
      "do:alert-coordinator",
      "do:first-call",
      "waitForEvent:await-acknowledgement",
      "sleep:15 minutes",
      "do:retry-call",
    ]);
    expect(runEscalationMock).toHaveBeenCalledTimes(2);
  });
});

describe("CallCampaignWorkflow", () => {
  it("uses a default ladder length of four", () => {
    expect(DEFAULT_MAX_ATTEMPTS).toBe(4);
  });

  it("stops immediately when the first contact has escalated", async () => {
    runEscalationMock.mockResolvedValueOnce(contact("c1", { status: "escalated", attempt: 3 }));
    const { step, log } = makeStep();

    const result = await new CallCampaignWorkflow({} as ExecutionContext, ENV).run(
      event({ contactId: "c0" }),
      step,
    );

    expect(result).toEqual({ final_contact_id: "c1", status: "escalated", attempts: 3 });
    expect(log.map((entry) => entry.name)).toEqual(["first-contact"]);
  });

  it("climbs the ladder, sleeping between rungs, until the contact escalates", async () => {
    runEscalationMock
      .mockResolvedValueOnce(contact("c1", { status: "queued", attempt: 1 }))
      .mockResolvedValueOnce(contact("c2", { status: "queued", attempt: 2 }))
      .mockResolvedValueOnce(contact("c3", { status: "queued", attempt: 3 }))
      .mockResolvedValueOnce(contact("c4", { status: "escalated", attempt: 4 }));
    const { step, log } = makeStep();

    const result = await new CallCampaignWorkflow({} as ExecutionContext, ENV).run(
      event({ contactId: "c0" }),
      step,
    );

    expect(result).toEqual({ final_contact_id: "c4", status: "escalated", attempts: 4 });
    expect(log.filter((entry) => entry.kind === "sleep")).toHaveLength(3);
    expect(log.map((entry) => entry.name)).toEqual([
      "first-contact",
      "15 minutes",
      "escalation-1",
      "15 minutes",
      "escalation-2",
      "15 minutes",
      "escalation-3",
    ]);
  });

  it("honours a caller-supplied maxAttempts ceiling", async () => {
    runEscalationMock.mockResolvedValue(contact("cX", { status: "queued", attempt: 1 }));
    const { step, log } = makeStep();

    const result = await new CallCampaignWorkflow({} as ExecutionContext, ENV).run(
      event({ contactId: "c0", maxAttempts: 2 }),
      step,
    );

    expect(result).toEqual({ final_contact_id: "cX", status: "queued", attempts: 1 });
    expect(runEscalationMock).toHaveBeenCalledTimes(3);
    expect(log.filter((entry) => entry.kind === "sleep")).toHaveLength(2);
  });

  it("reports `none` when the first contact cannot be found", async () => {
    runEscalationMock.mockResolvedValueOnce(null);
    const { step } = makeStep();

    const result = await new CallCampaignWorkflow({} as ExecutionContext, ENV).run(
      event({ contactId: "c0" }),
      step,
    );

    expect(result).toEqual({ final_contact_id: null, status: "none", attempts: 0 });
  });
});
