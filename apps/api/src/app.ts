/**
 * The Hono application factory.
 *
 * One place builds the app so the Worker entry (`src/index.ts`) and the tests share exactly the same
 * routing surface. The four feature modules are mounted here, in the order their routes are declared,
 * and the single error mapper from `http.ts` turns anything a route throws into the contract's
 * `ApiError` body.
 *
 * `createApp()` is the only export: the Worker entry needs nothing else, and tests import just this.
 */

import { Hono } from "hono";

import type { Env } from "./env";
import { errorPayload } from "./http";
import { registerReadRoutes } from "./routes/read";
import { registerWriteRoutes } from "./routes/write";
import { registerVoiceRoutes } from "./routes/voice";
import { registerDemoRoutes } from "./routes/demo";

export function createApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.onError((error, c) => {
    const { status, body } = errorPayload(error);
    return c.json(body, status);
  });

  // Unknown paths get the same `ApiError` shape as every other failure, so the frontend never has to
  // special-case Hono's default plain-text 404.
  app.notFound((c) =>
    c.json({ error: { code: "not_found", message: `no route for ${c.req.method} ${c.req.path}` } }, 404),
  );

  registerReadRoutes(app);
  registerWriteRoutes(app);
  registerVoiceRoutes(app);
  registerDemoRoutes(app);

  return app;
}
