/**
 * Durable campaign workflows (B7).
 *
 * Cloudflare Workflows give an outbound campaign durability across evictions: each step's result is
 * checkpointed, so a call that was placed before an isolate was recycled is not placed again after it
 * restarts. The 15-minute retry from §6 is the canonical example — it must survive far longer than a
 * request, so it is a `step.sleep`, not a `setTimeout`.
 *
 * ## Typing without `@cloudflare/workers-types`
 *
 * `apps/api/.ref/B-SPEC.md` records the hard constraint: there is no network, the
 * `@cloudflare/workers-types` package cannot be installed, and `wrangler`/miniflare are not present.
 * The real `WorkflowEntrypoint` therefore does not resolve at typecheck time.
 *
 * The task offered two ways to handle that. The first — a `declare module "cloudflare:workers"` block
 * inside this file — is not possible: because this file has top-level `import`/`export` it is a
 * *module*, so a `declare module "cloudflare:workers"` is read as a module **augmentation**, and
 * TypeScript rejects it with `TS2664: module 'cloudflare:workers' cannot be found` (ambient external
 * module declarations are only legal in a script or `.d.ts` with no top-level imports/exports, and
 * this task owns no such file). The second option — modelling the types locally — is what this file
 * does: `WorkflowStep`, `WorkflowEvent` and `WorkflowEntrypoint` below declare exactly the surface
 * these workflows use, with no `any`.
 *
 * Swapping in the real runtime is a one-line change: delete the local declarations and add
 * `import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";`.
 * The class bodies need no other edit.
 *
 * The bodies stay deliberately thin: all branching lives in the pure functions in `escalation.ts`,
 * so a workflow is just the durable ordering of their calls.
 */

import { runEscalation, type CampaignEnv } from "./escalation";

/* ------------------------------------------------------------------ runtime surface (local stand-ins) */

/** The durable primitives one workflow run may use. Mirrors `cloudflare:workers`. */
export interface WorkflowStep {
  /** Run `callback` once and checkpoint its result under `stepName`. */
  do<T>(stepName: string, callback: () => T | Promise<T>): Promise<T>;
  /** Suspend for `duration` (for example `"15 minutes"`), durably. */
  sleep(duration: string): Promise<void>;
  /** Suspend until an event of the given type arrives, or `timeout` expires. */
  waitForEvent<T>(
    stepName: string,
    options: { readonly type: string; readonly timeout?: string },
  ): Promise<{ readonly payload: T }>;
}

/** The trigger payload handed to `run`. Mirrors `cloudflare:workers`. */
export interface WorkflowEvent<Params> {
  readonly payload: Params;
  readonly timestamp: Date;
  readonly instanceId: string;
}

/**
 * Stand-in for `cloudflare:workers`' `WorkflowEntrypoint`. The Worker runtime constructs subclasses
 * with the execution context and bindings; the class only has to hold them for `run`.
 */
export abstract class WorkflowEntrypoint<Env = unknown, Params = unknown> {
  protected readonly ctx: ExecutionContext;
  protected readonly env: Env;

  constructor(ctx: ExecutionContext, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  abstract run(event: WorkflowEvent<Params>, step: WorkflowStep): Promise<unknown>;
}

/* ------------------------------------------------------------------ urgent request */

export interface UrgentRequestParams {
  readonly requestId: string;
  /** The caller's first contact with the requesting farmer, if one has been queued. */
  readonly contactId?: string;
}

export interface UrgentRequestResult {
  readonly request_id: string;
  readonly acknowledged: boolean;
  readonly final_contact_id: string | null;
}

/**
 * Escort an urgent request: alert the coordinator, make the first call, wait for the farmer's
 * acknowledgement, and — only if the wait times out — fall back to one durable 15-minute retry.
 */
export class UrgentRequestWorkflow extends WorkflowEntrypoint<CampaignEnv, UrgentRequestParams> {
  async run(event: WorkflowEvent<UrgentRequestParams>, step: WorkflowStep): Promise<UrgentRequestResult> {
    const requestId = event.payload.requestId;

    await step.do("alert-coordinator", async () => ({
      request_id: requestId,
      alerted_at: event.timestamp.toISOString(),
    }));

    const initialId = event.payload.contactId ?? null;
    if (initialId === null) {
      return { request_id: requestId, acknowledged: false, final_contact_id: null };
    }

    const first = await step.do("first-call", () => runEscalation(this.env, initialId));
    if (first === null) {
      return { request_id: requestId, acknowledged: false, final_contact_id: null };
    }
    const firstId = first.id;

    const ack = await step
      .waitForEvent<{ contact_id?: string }>("await-acknowledgement", {
        type: "contact.acknowledged",
        timeout: "1 hour",
      })
      .catch(() => null);

    let finalId = firstId;
    if (ack === null) {
      await step.sleep("15 minutes");
      const retry = await step.do("retry-call", () => runEscalation(this.env, firstId));
      if (retry !== null) finalId = retry.id;
    }

    return { request_id: requestId, acknowledged: ack !== null, final_contact_id: finalId };
  }
}

/* ------------------------------------------------------------------ call campaign */

export interface CallCampaignParams {
  /** The first contact to escalate from. */
  readonly contactId: string;
  /** Safety ceiling on the number of durable retries. */
  readonly maxAttempts?: number;
}

export interface CallCampaignResult {
  readonly final_contact_id: string | null;
  readonly status: string;
  readonly attempts: number;
}

/** The default ladder length: call → retry → message → escalate. */
export const DEFAULT_MAX_ATTEMPTS = 4;

/**
 * Climb the escalation ladder durably, sleeping 15 minutes between rungs, and stop when the contact
 * escalates to the coordinator (or the attempt ceiling is reached).
 */
export class CallCampaignWorkflow extends WorkflowEntrypoint<CampaignEnv, CallCampaignParams> {
  async run(event: WorkflowEvent<CallCampaignParams>, step: WorkflowStep): Promise<CallCampaignResult> {
    let current = await step.do("first-contact", () => runEscalation(this.env, event.payload.contactId));
    let attempts = current === null ? 0 : current.attempt;

    const limit = event.payload.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    for (let index = 1; index <= limit; index += 1) {
      if (current === null || current.status === "escalated") break;
      const from = current.id;
      await step.sleep("15 minutes");
      current = await step.do(`escalation-${index}`, () => runEscalation(this.env, from));
      attempts = current?.attempt ?? attempts;
    }

    return {
      final_contact_id: current?.id ?? null,
      status: current?.status ?? "none",
      attempts,
    };
  }
}
