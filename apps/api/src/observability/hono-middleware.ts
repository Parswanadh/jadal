/**
 * The one-line production hook for the Jadal Worker: trace every API request as a Failproof session.
 *
 * ## Not wired — deliberately
 *
 * `apps/api/src/app.ts` is owned by another lane, so this middleware is **not** registered there.
 * The whole change needed is two lines in `createApp()`:
 *
 *     import { failproofMiddleware } from "./observability/hono-middleware";   // 1
 *     app.use("*", failproofMiddleware());                                     // 2
 *
 * plus, in `apps/api/src/env.ts`, declaring the optional binding the middleware reads:
 *
 *     FAILPROOF_TRACE?: string;
 *
 * ## Why a sink has to be supplied
 *
 * `createFailproofTracer()` never performs I/O: the sink is injected. A Worker has no filesystem, so
 * the Node spool sink in `./spool.ts` cannot be used there. `failproofMiddleware()` therefore takes
 * a sink **factory** and defaults to `noopSink` — registered but inert, which is the honest state
 * for a deployment that has not yet been given an HTTP sink (or a running `failproofaid`).
 *
 * For a Worker, the sink to supply is an HTTP one that POSTs NDJSON to `<cloud>/v1/events` with the
 * `events:add` key — the endpoint `scripts/failproof/ship-spool.mjs` posts to by hand. That sink is
 * deliberately not written here: it needs `env.FAILPROOF_API_KEY` declared first, and a live demo
 * must not start making outbound calls because a key happened to be present in `.dev.vars`.
 *
 * ## Off by default
 *
 * With no sink and no `FAILPROOF_ENABLED=1` (or `FAILPROOF_TRACE=1`), the middleware builds an inert
 * tracer: it costs one object allocation per request and emits nothing.
 */

import type { MiddlewareHandler } from "hono";

import { createFailproofTracer, globalFlag, noopSink, type FailproofSink, type FailproofTracer } from "./failproof";

/** Reads only what it needs, so it stays structurally compatible with the Worker's `Env`. */
export interface FailproofMiddlewareEnv {
  FAILPROOF_TRACE?: string;
  ENVIRONMENT?: string;
}

export interface FailproofMiddlewareOptions {
  /** Build the sink for this request. Defaults to a sink that keeps nothing. */
  sink?: (env: FailproofMiddlewareEnv) => FailproofSink;
  /** Force tracing on or off. Default: `FAILPROOF_TRACE === "1"` or `FAILPROOF_ENABLED === "1"`. */
  enabled?: boolean;
  /** The agent id every event carries. Default `jadal.api`. */
  agentId?: string;
}

/**
 * Trace one request as one Failproof session.
 *
 * The session id is a fresh id per request; the HTTP method and path become the run's goal, and the
 * response status decides the run's `outcome` (`success`, or `error` for 5xx). An exception is
 * recorded as an `error` event and the run ends `failed`, exactly as the SDK's `agent()` scope does.
 */
export function failproofMiddleware(options: FailproofMiddlewareOptions = {}): MiddlewareHandler {
  const sinkFactory = options.sink ?? (() => noopSink);

  return async (c, next) => {
    const env = c.env as FailproofMiddlewareEnv;
    const enabled = options.enabled ?? (env.FAILPROOF_TRACE === "1" || globalFlag("FAILPROOF_ENABLED"));
    const tracer: FailproofTracer = createFailproofTracer({
      enabled,
      sink: sinkFactory(env),
      environment: env.ENVIRONMENT ?? "development",
      agentId: options.agentId ?? "jadal.api",
    });

    const goal = `${c.req.method} ${c.req.path}`;
    tracer.agentStart({ goal, extra: { fw_route: c.req.path, fw_method: c.req.method } });
    tracer.hookTriggered({ hookName: "jadal.http", hookId: "request", triggerEvent: "request.received", input: { method: c.req.method, path: c.req.path } });

    try {
      await next();
      const status = c.res.status;
      tracer.hookCompleted({ hookName: "jadal.http", hookId: "request", outcome: status < 400 ? "ok" : "refused", output: { status } });
      tracer.agentEnd({ outcome: status >= 500 ? "error" : "success", summary: `${c.req.method} ${c.req.path} → ${status}` });
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      tracer.error({ errorType: thrown instanceof Error ? thrown.name : "Error", message });
      tracer.hookCompleted({ hookName: "jadal.http", hookId: "request", outcome: "failed", error: message });
      tracer.agentEnd({ outcome: "failed", summary: message });
      throw thrown;
    } finally {
      // The Worker may be frozen as soon as the response is returned, so the flush is awaited here
      // rather than left to a timer.
      await tracer.flush();
    }
  };
}
