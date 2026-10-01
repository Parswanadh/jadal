/**
 * Demo-control route tests.
 *
 * `demoReset` is destructive, so the first job is proving the guard: without an explicit
 * `DEMO_MODE=1`/`ENVIRONMENT=demo` the route reports `{ ok: false }` and touches nothing. With the
 * flag it re-seeds the scenario, which the second test verifies through the read surface.
 */

import type { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { routes } from "@jadal/contracts";

import { createApp } from "../app";
import { now as clockNow } from "../db/clock";
import { call, createEnv, createTestDb, expectStatus, type TestEnv } from "../../test/harness";
import { demoScenario, demoWeather, seedScenario, seedWeather } from "../../test/fixtures";

function app(): Hono<{ Bindings: TestEnv }> {
  return createApp() as unknown as Hono<{ Bindings: TestEnv }>;
}

async function demoEnv(): Promise<TestEnv> {
  const env = createEnv();
  const scenario = demoScenario();
  const weather = demoWeather();
  await seedScenario(env, scenario, weather);
  await seedWeather(env, weather, scenario.canal.id);
  return env;
}

describe("POST /api/demo/reset", () => {
  it("re-seeds the scenario when demo mode is explicitly enabled", async () => {
    const env = Object.assign(createEnv(), { DB: await createTestDb(), DEMO_MODE: "1" });
    const res = await call(app(), "POST", routes.demoReset.path, { env, body: {} });

    expectStatus(res, 200);
    expect(routes.demoReset.response.parse(res.body)).toEqual({ ok: true });

    const farmers = routes.listFarmers.response.parse((await call(app(), "GET", routes.listFarmers.path, { env })).body);
    expect(farmers.length).toBe(8);
  });

  it("refuses to wipe the database without demo mode", async () => {
    const env = await demoEnv();
    const res = await call(app(), "POST", routes.demoReset.path, { env, body: {} });

    expectStatus(res, 200);
    expect(routes.demoReset.response.parse(res.body)).toEqual({ ok: false });

    // Untouched: the seeded farmers are still there.
    const farmers = routes.listFarmers.response.parse((await call(app(), "GET", routes.listFarmers.path, { env })).body);
    expect(farmers.length).toBe(8);
  });
});

describe("POST /api/demo/advance", () => {
  it("moves the simulated clock forward by the requested hours", async () => {
    const env = await demoEnv();
    const before = await clockNow(env);

    const res = await call(app(), "POST", routes.demoAdvance.path, { env, body: { hours: 12 } });

    expectStatus(res, 200);
    const body = routes.demoAdvance.response.parse(res.body);
    expect(Date.parse(body.now)).toBe(Date.parse(before) + 12 * 3_600_000);
    expect(await clockNow(env)).toBe(body.now);
  });

  it("400s on a non-positive number of hours", async () => {
    const env = await demoEnv();
    const res = await call(app(), "POST", routes.demoAdvance.path, { env, body: { hours: 0 } });

    expectStatus(res, 400);
    expect(res.body).toHaveProperty("error.code");
  });
});
