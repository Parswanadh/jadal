/**
 * Read-route tests.
 *
 * Every route is exercised through the real Hono app with the in-memory D1 shim, seeded with the
 * demo scenario. Each happy path asserts the status *and* re-parses the body through the contract
 * schema (`routes.<name>.response.parse`), so a mapper that drifts from the contract fails here.
 * The failure paths assert the shared `{ error: { code, message } }` shape with a 4xx.
 *
 * NO NETWORK: the harness `fetch` throws on any unmocked URL, and the read routes make no outbound
 * calls at all.
 */

import type { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { routes } from "@jadal/contracts";

import { createApp } from "../app";
import { DEMO_CANAL_ID } from "../demo";
import { call, createEnv, createTestDb, expectStatus, type FetchRoutes, type TestEnv } from "../../test/harness";
import { demoScenario, demoWeather, seedScenario, seedWeather } from "../../test/fixtures";

/** The app, viewed through the test env's bindings. The cast is test-only; the runtime binding object is `TestEnv`. */
function app(): Hono<{ Bindings: TestEnv }> {
  return createApp() as unknown as Hono<{ Bindings: TestEnv }>;
}

/** A fresh in-memory environment seeded with the demo scenario, weather and clock. */
async function demoEnv(fetchRoutes: FetchRoutes = {}): Promise<TestEnv> {
  const env = createEnv(fetchRoutes);
  const scenario = demoScenario();
  const weather = demoWeather();
  await seedScenario(env, scenario, weather);
  await seedWeather(env, weather, scenario.canal.id);
  return env;
}

describe("GET /api/health", () => {
  it("returns the contract shape with a version", async () => {
    const env = createEnv();
    const res = await call(app(), "GET", routes.health.path, { env });

    expectStatus(res, 200);
    const body = routes.health.response.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.version.length).toBeGreaterThan(0);
  });
});

describe("GET /api/canal", () => {
  it("returns the demo canal and its outlets, head to tail", async () => {
    const env = await demoEnv();
    const res = await call(app(), "GET", routes.canal.path, { env });

    expectStatus(res, 200);
    const body = routes.canal.response.parse(res.body);
    expect(body.canal.id).toBe(DEMO_CANAL_ID);
    expect(body.outlets.length).toBe(8);
    const chainages = body.outlets.map((outlet) => outlet.chainage_m);
    expect([...chainages].sort((a, b) => a - b)).toEqual(chainages);
  });

  it("404s with the ApiError shape when no canal is seeded", async () => {
    const env = Object.assign(createEnv(), { DB: await createTestDb() });
    const res = await call(app(), "GET", routes.canal.path, { env });

    expectStatus(res, 404);
    const error = routes.audit.response.safeParse(res.body);
    expect(error.success).toBe(false);
    expect(res.body).toHaveProperty("error.code");
    expect(res.body).toHaveProperty("error.message");
  });
});

describe("GET /api/farmers", () => {
  it("lists every seeded farmer with plots and crop plans", async () => {
    const env = await demoEnv();
    const res = await call(app(), "GET", routes.listFarmers.path, { env });

    expectStatus(res, 200);
    const body = routes.listFarmers.response.parse(res.body);
    expect(body.length).toBe(8);
    for (const record of body) {
      expect(record.plots.length).toBeGreaterThan(0);
      expect(typeof record.verified).toBe("boolean");
    }
  });
});

describe("GET /api/release-windows", () => {
  it("lists the two windows in start order", async () => {
    const env = await demoEnv();
    const res = await call(app(), "GET", routes.releaseWindows.path, { env });

    expectStatus(res, 200);
    const body = routes.releaseWindows.response.parse(res.body);
    expect(body.length).toBe(2);
    const starts = body.map((window) => window.start);
    expect([...starts].sort()).toEqual(starts);
  });
});

describe("GET /api/requests", () => {
  it("returns an empty list before anything is raised", async () => {
    const env = await demoEnv();
    const res = await call(app(), "GET", routes.listRequests.path, { env });

    expectStatus(res, 200);
    expect(routes.listRequests.response.parse(res.body)).toEqual([]);
  });
});

describe("GET /api/ledger", () => {
  it("returns ledger entries plus a conserved balances view computed by the core", async () => {
    const env = await demoEnv();
    const res = await call(app(), "GET", routes.ledger.path, { env });

    expectStatus(res, 200);
    const body = routes.ledger.response.parse(res.body);
    expect(body.entries.length).toBeGreaterThan(0);
    expect(body.balances.farmers.length).toBe(8);
    expect(body.balances.conservation_ok).toBe(true);
    expect(body.balances.buffer_m3).toBeGreaterThanOrEqual(0);
    expect(body.balances.gini).toBeGreaterThanOrEqual(0);
    for (const farmer of body.balances.farmers) {
      expect(farmer.need_met_pct).toBeGreaterThanOrEqual(0);
      expect(farmer.need_met_pct).toBeLessThanOrEqual(100);
    }
  });
});

describe("GET /api/events", () => {
  it("returns the append-only log, oldest first, every event contract-valid", async () => {
    const env = await demoEnv();
    const res = await call(app(), "GET", routes.events.path, { env });

    expectStatus(res, 200);
    const body = routes.events.response.parse(res.body);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]?.type).toBe("farmer.registered");
  });
});

describe("GET /api/contacts", () => {
  it("returns an empty list before any roster is approved", async () => {
    const env = await demoEnv();
    const res = await call(app(), "GET", routes.contacts.path, { env });

    expectStatus(res, 200);
    expect(routes.contacts.response.parse(res.body)).toEqual([]);
  });
});

describe("GET /api/audit", () => {
  it("returns the auditor's balances, findings and bilingual summary", async () => {
    const env = await demoEnv();
    const res = await call(app(), "GET", routes.audit.path, { env });

    expectStatus(res, 200);
    const body = routes.audit.response.parse(res.body);
    expect(Array.isArray(body.findings)).toBe(true);
    expect(body.summary_en.length).toBeGreaterThan(0);
    expect(body.summary_te.length).toBeGreaterThan(0);
  });
});

describe("unknown path", () => {
  it("404s with the ApiError shape", async () => {
    const env = createEnv();
    const res = await call(app(), "GET", "/api/nope", { env });

    expectStatus(res, 404);
    expect(res.body).toEqual({ error: { code: "not_found", message: expect.any(String) } });
  });
});
