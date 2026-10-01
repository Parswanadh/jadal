/**
 * Demo-control routes.
 *
 * These are thin, and deliberately so: the destructive "reset to the seed scenario" and the
 * time-travel "advance the simulated clock" both live in `src/demo.ts` (owned by the demo workstream)
 * and are only exposed here as validated HTTP endpoints. `resetDemo` refuses unless the environment
 * opts in, so a production deployment without `DEMO_MODE=1`/`ENVIRONMENT=demo` gets `{ ok: false }`
 * rather than a wiped database.
 */

import type { Hono } from "hono";

import { routes } from "@jadal/contracts";

import { advanceDemo, resetDemo } from "../demo";
import type { Env } from "../env";
import { parseBody, parseResponse } from "../http";

/** Register the demo routes on `app`. */
export function registerDemoRoutes(app: Hono<{ Bindings: Env }>): void {
  app.post(routes.demoReset.path, async (c) => {
    await parseBody(c, routes.demoReset.body);
    const result = await resetDemo(c.env);
    return c.json(parseResponse(routes.demoReset.response, result));
  });

  app.post(routes.demoAdvance.path, async (c) => {
    const body = await parseBody(c, routes.demoAdvance.body);
    const result = await advanceDemo(c.env, body.hours);
    return c.json(parseResponse(routes.demoAdvance.response, result));
  });
}
