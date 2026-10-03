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
import { createTelephonyRoutes } from "./telephony";
import { buildTelephonyDeps } from "./telephony-deps";

/** Where the B8 telephony module is mounted. Its own routes are relative to this prefix. */
const TELEPHONY_PREFIX = "/api/telephony";

export function createApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.onError((error, c) => {
    const { status, body } = errorPayload(error);
    // A 4xx is an expected refusal the route already describes to the caller; a 5xx is an unhandled
    // bug. Log the latter only. Until B9 the live Worker turned every such failure into the same
    // generic body with nothing in the log, which is how the D1 `all()` envelope mismatch stayed
    // invisible until the first real boot.
    if (status >= 500) console.error("[api] unhandled error:", error);
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

  /**
   * Mount the telephony module (B9).
   *
   * `createTelephonyRoutes(deps)` binds its deps once, but the Worker's bindings — `DB`, `CACHE` and
   * the Twilio/Sarvam secrets — only exist per request, so the sub-app is built per request and handed
   * the original `Request`. That costs one small Hono instance on the webhook path (Twilio only) and
   * buys a module that never learns about `Env`.
   *
   * A plain-text 404 means no telephony route matched; it is re-rendered as the app's `ApiError` shape.
   * The module's own 404 (`twiml` for an unknown contact) is TwiML and passes through untouched.
   */
  app.all(`${TELEPHONY_PREFIX}/*`, async (c) => {
    const mounted = new Hono<{ Bindings: Env }>().route(TELEPHONY_PREFIX, createTelephonyRoutes(buildTelephonyDeps(c.env)));
    const response = await mounted.fetch(c.req.raw, c.env);
    if (response.status === 404 && !(response.headers.get("content-type") ?? "").includes("xml")) {
      return c.json({ error: { code: "not_found", message: `no route for ${c.req.method} ${c.req.path}` } }, 404);
    }
    return response;
  });

  return app;
}
