/**
 * The Worker entry module's export surface (B9 regression guard).
 *
 * `workerd` reads **every named export** of the entry module as a handler entry and refuses the whole
 * script if one is not a function or an `ExportedHandler`:
 *
 *   Incorrect type for map entry 'NIGHTLY_CRON': the provided value is not of type
 *   'function or ExportedHandler'
 *
 * The entry module used to `export * from "./campaigns/workflows"` (publishing the number
 * `DEFAULT_MAX_ATTEMPTS` and the local `WorkflowEntrypoint` stand-in) and to export the string
 * `NIGHTLY_CRON`. Both are fine under Vitest — which imports the module as a normal ES module — and
 * both made the Worker fail to boot. B9 only found them by actually starting `wrangler dev`.
 *
 * This file is the cheap guard that replaces that boot: it asserts the shape `workerd` requires,
 * without a runtime.
 */

import { describe, expect, it } from "vitest";

import * as worker from "./index";

describe("Worker entry module exports", () => {
  it("exports only handler-shaped values", () => {
    for (const [name, value] of Object.entries(worker)) {
      if (name === "default") continue;
      const shape = typeof value === "function" ? "function" : value === null ? "null" : typeof value;
      expect(
        typeof value === "function" || (typeof value === "object" && value !== null),
        `named export ${name} is ${shape}; workerd rejects anything that is not a function or ExportedHandler`,
      ).toBe(true);
    }
  });

  it("publishes exactly the Workflow classes wrangler.jsonc binds by class_name", () => {
    expect(typeof worker.UrgentRequestWorkflow).toBe("function");
    expect(typeof worker.CallCampaignWorkflow).toBe("function");
  });

  it("does not leak constants or stand-ins from the campaign module", () => {
    expect(worker).not.toHaveProperty("DEFAULT_MAX_ATTEMPTS");
    expect(worker).not.toHaveProperty("NIGHTLY_CRON");
  });

  it("keeps the default export a Worker handler", () => {
    expect(typeof worker.default.fetch).toBe("function");
    expect(typeof worker.default.scheduled).toBe("function");
    expect(typeof worker.default.queue).toBe("function");
  });
});

describe("outbound queue retry cap", () => {
  /**
   * A blanket `message.retry()` on every failure is what makes one failing call into a call loop.
   * The cap is what stops it, so it needs a test: without one, a future edit can restore the
   * unbounded retry and nobody notices until a real handset rings repeatedly.
   */
  function batchOf(attempts: number) {
    const retried: string[] = [];
    const acked: string[] = [];
    return {
      retried,
      acked,
      batch: {
        messages: [
          {
            body: { contact_id: "ct-loop" },
            attempts,
            retry: () => void retried.push("ct-loop"),
            ack: () => void acked.push("ct-loop"),
          },
        ],
      },
    };
  }

  it("retries a first failure", async () => {
    const { retried, acked, batch } = batchOf(1);
    await (worker.default as { queue: (b: unknown, e: unknown) => Promise<void> }).queue(batch, {});
    expect(retried).toHaveLength(1);
    expect(acked).toHaveLength(0);
  });

  it("drops the message once the attempts are exhausted instead of dialling again", async () => {
    const { retried, acked, batch } = batchOf(3);
    await (worker.default as { queue: (b: unknown, e: unknown) => Promise<void> }).queue(batch, {});
    expect(retried).toHaveLength(0);
    expect(acked).toHaveLength(1);
  });
});
