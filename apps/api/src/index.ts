/**
 * Cloudflare Worker entrypoint for the Jadal API.
 *
 * This is the integration point of the backend. It:
 *   * builds the Hono app (`src/app.ts`) and serves it,
 *   * runs the nightly `30 0 * * *` cron — 00:30 UTC / 06:00 IST — driving the rain re-plan and the
 *     night-release warnings concurrently,
 *   * drains the `jadal-outbound` queue through the escalation ladder, acking each rung and retrying
 *     only the ones that fail, and
 *   * re-exports the durable Workflow classes bound in `wrangler.jsonc`.
 *
 * All bindings and configuration live in `src/env.ts`. Every key is optional: with none set the
 * campaigns take their offline paths (B-SPEC §4) and the simulated phone is the demo vehicle
 * (ADR-003).
 */

import { createApp } from "./app";
import { runEscalation, type OutboundMessage } from "./campaigns/escalation";
import { scheduleNightRelease } from "./campaigns/night-release";
import { replan } from "./campaigns/rain";
import * as workflows from "./campaigns/workflows";
import { now as clockNow } from "./db/clock";
import { listOutlets, listReleaseWindows } from "./db/repo";
import type { Env } from "./env";

/**
 * Re-export **only** the Workflow classes as named exports so `wrangler.jsonc` `class_name` can bind
 * them.
 *
 * This used to be `export * from "./campaigns/workflows"`, which also published
 * `DEFAULT_MAX_ATTEMPTS` (a number) and the local `WorkflowEntrypoint` stand-in as named exports of
 * the Worker module. `workerd` reads every named export as a handler entry and refuses the whole
 * script: `Incorrect type for map entry 'DEFAULT_MAX_ATTEMPTS': the provided value is not of type
 * 'function or ExportedHandler'`. It starts fine under Vitest, so nothing caught it until the Worker
 * was actually booted (B9). Listing the two classes explicitly keeps the export surface to handlers.
 */
export { CallCampaignWorkflow, UrgentRequestWorkflow } from "./campaigns/workflows";
export * from "./env";

/**
 * The single nightly cron. 00:30 UTC is 06:00 IST, before the irrigation day starts.
 *
 * Deliberately **not** exported: `workerd` reads every named export of the entry module as a handler
 * entry, and a string is not one (`Incorrect type for map entry 'NIGHTLY_CRON'`). It is only read by
 * the `scheduled` handler below.
 */
const NIGHTLY_CRON = "30 0 * * *";

/**
 * Nightly rain re-plan: once per canal, defer upcoming turns when the forecast hits the trigger.
 */
async function replanAllCanals(env: Env): Promise<void> {
  const outlets = await listOutlets(env);
  const canalIds = [...new Set(outlets.map((outlet) => outlet.canal_id))].sort();
  for (const canalId of canalIds) {
    await replan(env, canalId);
  }
}

/** Nightly pre-release warnings: queue the 1-hour-ahead alerts for every upcoming night window. */
async function warnNightReleases(env: Env): Promise<void> {
  const at = await clockNow(env);
  const windows = await listReleaseWindows(env);
  for (const window of windows) {
    await scheduleNightRelease(env, window, at);
  }
}

const app = createApp();

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron !== NIGHTLY_CRON) return;
    // Independent halves: a failure in one must not cancel the other, and `waitUntil` hands each to
    // the runtime so the scheduled invocation can return without dropping the work.
    ctx.waitUntil(replanAllCanals(env));
    ctx.waitUntil(warnNightReleases(env));
  },

  async queue(batch: MessageBatch<OutboundMessage>, env: Env): Promise<void> {
    await Promise.all(
      batch.messages.map(async (message) => {
        try {
          await runEscalation(env, message.body.contact_id);
          message.ack();
        } catch {
          message.retry();
        }
      }),
    );
  },

  ...workflows,
};
