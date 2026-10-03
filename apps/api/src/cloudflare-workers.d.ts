/**
 * Minimal ambient declaration for the `cloudflare:workers` runtime module.
 *
 * `@cloudflare/workers-types` is not installable in this repo (no network; see
 * `campaigns/workflows.ts`), so the real `WorkflowEntrypoint` / `WorkflowEvent` / `WorkflowStep`
 * types do not resolve at typecheck time. This file supplies exactly the surface the campaign
 * workflows use, with no `any`, so `tsc` can check `campaigns/workflows.ts` against a real shape
 * while `workerd` still supplies the genuine implementation at deploy time.
 *
 * This is a `.d.ts` with no top-level imports/exports, so `declare module "cloudflare:workers"` is
 * an *ambient module declaration* (not a module augmentation), which is what makes it legal here.
 *
 * Vitest cannot resolve the `cloudflare:` specifier, so `vitest.config.ts` aliases it to
 * `test/cloudflare-workers-stub.ts`, which mirrors this shape at runtime.
 */
declare module "cloudflare:workers" {
  /** One durable workflow invocation: its payload plus identity metadata. */
  export interface WorkflowEvent<T = unknown> {
    readonly payload: T;
    readonly timestamp: Date;
    readonly instanceId: string;
    readonly workflowId: string;
  }

  /**
   * The durable step API. Each method checkpoints its result, so a retried invocation resumes from
   * the last completed step rather than re-running it.
   */
  export interface WorkflowStep {
    do<T>(name: string, callback: () => T | Promise<T>, config?: unknown): Promise<T>;
    sleep(name: string, duration?: string | number): Promise<void>;
    sleepUntil(name: string, timestamp: number | Date): Promise<void>;
    waitForEvent<T = unknown>(
      name: string,
      options?: { type?: string; timeout?: string | number },
    ): Promise<T>;
  }

  /** Base class every durable workflow extends; `this.env` holds the Worker bindings. */
  export abstract class WorkflowEntrypoint<Env = unknown, Params = unknown> {
    readonly env: Env;
    readonly ctx: ExecutionContext;
    constructor(ctx: ExecutionContext, env: Env);
    abstract run(event: WorkflowEvent<Params>, step: WorkflowStep): Promise<unknown>;
  }
}
