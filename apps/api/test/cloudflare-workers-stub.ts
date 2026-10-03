/**
 * Runtime stand-in for `cloudflare:workers`, wired in by `vitest.config.ts`.
 *
 * Vitest cannot resolve the `cloudflare:` URL scheme, so the alias points here. The class mirrors the
 * ambient declaration in `src/cloudflare-workers.d.ts`: the constructor stores `env`, exactly as the
 * real `WorkflowEntrypoint` does, and `run` is left to the concrete workflow. The durable `step`
 * methods are supplied by the test, not this stub.
 */

export interface WorkflowEvent<T = unknown> {
  readonly payload: T;
  readonly timestamp: Date;
  readonly instanceId: string;
  readonly workflowId: string;
}

export interface WorkflowStep {
  do<T>(name: string, callback: () => T | Promise<T>, config?: unknown): Promise<T>;
  sleep(name: string, duration?: string | number): Promise<void>;
  sleepUntil(name: string, timestamp: number | Date): Promise<void>;
  waitForEvent<T = unknown>(
    name: string,
    options?: { type?: string; timeout?: string | number },
  ): Promise<T>;
}

export abstract class WorkflowEntrypoint<Env = unknown, Params = unknown> {
  readonly env: Env;
  readonly ctx: ExecutionContext;

  constructor(ctx: ExecutionContext, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  abstract run(event: WorkflowEvent<Params>, step: WorkflowStep): Promise<unknown>;
}
