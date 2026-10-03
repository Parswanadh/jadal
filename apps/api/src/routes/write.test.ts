/**
 * Write-route tests.
 *
 * Each `POST` is driven through the real app, and every response is re-parsed through its contract
 * schema. State is always created through `appendEvent` (via the routes or the seed), never by
 * writing a projection directly, so these tests exercise the same path production does.
 *
 * The final describe walks the demo script end to end in order: propose a roster, approve an urgent
 * request, re-plan and approve a roster (queuing calls), advance the simulated clock, approve a
 * buffer request, then audit. NO NETWORK: every provider path falls back to deterministic code with
 * no keys, and the harness `fetch` throws on any unmocked URL.
 */

import type { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { routes } from "@jadal/contracts";

import { createApp } from "../app";
import { call, createEnv, expectStatus, type FetchRoutes, type TestEnv } from "../../test/harness";
import { demoScenario, demoWeather, seedScenario, seedWeather, type SeedResult } from "../../test/fixtures";

function app(): Hono<{ Bindings: TestEnv }> {
  return createApp() as unknown as Hono<{ Bindings: TestEnv }>;
}

async function demoEnv(fetchRoutes: FetchRoutes = {}): Promise<TestEnv> {
  const env = createEnv(fetchRoutes);
  const scenario = demoScenario();
  const weather = demoWeather();
  await seedScenario(env, scenario, weather);
  await seedWeather(env, weather, scenario.canal.id);
  return env;
}

/** The detail body of an `ApiError`, for the failure assertions. */
function apiError(body: unknown): { code: string; message: string } {
  const parsed = routes.health.response.safeParse(body);
  expect(parsed.success).toBe(false);
  const error = (body as { error?: { code?: unknown; message?: unknown } }).error;
  expect(typeof error?.code).toBe("string");
  expect(typeof error?.message).toBe("string");
  return {
    code: typeof error?.code === "string" ? error.code : "",
    message: typeof error?.message === "string" ? error.message : "",
  };
}

describe("POST /api/farmers", () => {
  it("registers a farmer with plots and crop plans", async () => {
    const env = await demoEnv();
    const res = await call(app(), "POST", routes.register.path, {
      env,
      body: {
        farmer: { name: "Test Farmer", phone: "+919000000099", language: "te", preferred_channels: ["voice"], has_smartphone: false },
        plots: [{ outlet_id: "o1", area_ha: 1, soil: "loam", lat: 16.3, lon: 80.4 }],
        crop_plans: [
          { crop: "maize", sowing_date: "2026-08-01", area_fraction: 1, application_efficiency: 0.65, plot_index: 0 },
        ],
      },
    });

    expectStatus(res, 200);
    const body = routes.register.response.parse(res.body);
    expect(body.farmer.name).toBe("Test Farmer");
    expect(body.plots[0]?.farmer_id).toBe(body.farmer.id);
    expect(body.crop_plans[0]?.plot_id).toBe(body.plots[0]?.id);
    expect(body.crop_plans[0]?.status).toBe("registered");

    const listed = routes.listFarmers.response.parse((await call(app(), "GET", routes.listFarmers.path, { env })).body);
    expect(listed.length).toBe(9);
  });

  it("400s on an invalid body with the ApiError shape", async () => {
    const env = await demoEnv();
    const res = await call(app(), "POST", routes.register.path, { env, body: {} });

    expectStatus(res, 400);
    apiError(res.body);
  });
});

describe("POST /api/farmers/:id/verify", () => {
  it("verifies a registered farmer", async () => {
    const env = await demoEnv();
    const res = await call(app(), "POST", "/api/farmers/f1/verify", { env, body: {} });

    expectStatus(res, 200);
    expect(routes.verifyFarmer.response.parse(res.body)).toEqual({ ok: true });
  });

  it("404s for an unknown farmer", async () => {
    const env = await demoEnv();
    const res = await call(app(), "POST", "/api/farmers/nope/verify", { env, body: {} });

    expectStatus(res, 404);
    apiError(res.body);
  });
});

describe("POST /api/entitlements/suggest", () => {
  it("proposes the week's entitlements from the deterministic need engine", async () => {
    const env = await demoEnv();
    const res = await call(app(), "POST", routes.suggestEntitlements.path, { env, body: {} });

    expectStatus(res, 200);
    const body = routes.suggestEntitlements.response.parse(res.body);
    expect(body.entitlements.length).toBe(9);
    expect(body.season_total_m3).toBeGreaterThan(0);
    expect(body.explanation.length).toBeGreaterThan(0);
  });

  it("400s on a malformed week_start", async () => {
    const env = await demoEnv();
    const res = await call(app(), "POST", routes.suggestEntitlements.path, { env, body: { week_start: "14-09-2026" } });

    expectStatus(res, 400);
    apiError(res.body);
  });
});

describe("POST /api/entitlements/approve", () => {
  it("applies coordinator edits and approves the proposed entitlements", async () => {
    const env = await demoEnv();
    const app0 = app();
    const suggested = routes.suggestEntitlements.response.parse(
      (await call(app0, "POST", routes.suggestEntitlements.path, { env, body: {} })).body,
    );
    const first = suggested.entitlements[0];
    expect(first).toBeDefined();

    const res = await call(app0, "POST", routes.approveEntitlements.path, {
      env,
      body: { edits: first === undefined ? [] : [{ id: first.id, volume_m3: 7 }] },
    });

    expectStatus(res, 200);
    const body = routes.approveEntitlements.response.parse(res.body);
    expect(body.approved).toBe(9);
  });
});

describe("POST /api/rosters/propose", () => {
  it("proposes a roster and reports both modes' fairness", async () => {
    const env = await demoEnv();
    const res = await call(app(), "POST", routes.proposeRoster.path, {
      env,
      body: { release_window_id: "rw1", mode: "equal_water" },
    });

    expectStatus(res, 200);
    const body = routes.proposeRoster.response.parse(res.body);
    expect(body.roster.turns.length).toBeGreaterThan(0);
    expect(typeof body.comparison.equal_hours_gini).toBe("number");
    expect(typeof body.comparison.equal_water_gini).toBe("number");
    expect(body.need_met.length).toBeGreaterThan(0);
  });

  it("404s for an unknown release window", async () => {
    const env = await demoEnv();
    const res = await call(app(), "POST", routes.proposeRoster.path, { env, body: { release_window_id: "nope" } });

    expectStatus(res, 404);
    apiError(res.body);
  });

  it("400s on an invalid mode", async () => {
    const env = await demoEnv();
    const res = await call(app(), "POST", routes.proposeRoster.path, {
      env,
      body: { release_window_id: "rw1", mode: "sideways" },
    });

    expectStatus(res, 400);
    apiError(res.body);
  });
});

describe("POST /api/rosters/:id/approve", () => {
  it("approves a roster and queues a contact per affected farmer", async () => {
    const env = await demoEnv();
    const app0 = app();
    const proposal = routes.proposeRoster.response.parse(
      (await call(app0, "POST", routes.proposeRoster.path, { env, body: { release_window_id: "rw1" } })).body,
    );

    const res = await call(app0, "POST", `/api/rosters/${proposal.roster.id}/approve`, { env, body: {} });

    expectStatus(res, 200);
    const body = routes.approveRoster.response.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.contacts_queued).toBeGreaterThan(0);

    const contacts = routes.contacts.response.parse((await call(app0, "GET", routes.contacts.path, { env })).body);
    expect(contacts.length).toBe(body.contacts_queued);
    for (const contact of contacts) {
      expect(contact.purpose).toBe("roster_change");
      expect(contact.status).toBe("queued");
    }
  });

  it("404s for an unknown roster", async () => {
    const env = await demoEnv();
    const res = await call(app(), "POST", "/api/rosters/nope/approve", { env, body: {} });

    expectStatus(res, 404);
    apiError(res.body);
  });
});

describe("POST /api/requests", () => {
  it("raises and triages a request", async () => {
    const env = await demoEnv();
    const res = await call(app(), "POST", routes.raiseRequest.path, {
      env,
      body: { farmer_id: "f1", type: "urgent", volume_m3: 50, reason: "paddy is wilting, urgent need water", channel: "portal" },
    });

    expectStatus(res, 200);
    const body = routes.raiseRequest.response.parse(res.body);
    expect(body.status).toBe("triaged");
    expect(typeof body.triage_score).toBe("number");
  });

  it("404s for an unknown farmer", async () => {
    const env = await demoEnv();
    const res = await call(app(), "POST", routes.raiseRequest.path, {
      env,
      body: { farmer_id: "nope", type: "urgent", volume_m3: 1, reason: "x", channel: "portal" },
    });

    expectStatus(res, 404);
    apiError(res.body);
  });

  it("400s on a negative volume", async () => {
    const env = await demoEnv();
    const res = await call(app(), "POST", routes.raiseRequest.path, {
      env,
      body: { farmer_id: "f1", type: "urgent", volume_m3: -1, reason: "x", channel: "portal" },
    });

    expectStatus(res, 400);
    apiError(res.body);
  });
});

describe("POST /api/requests/:id/decide", () => {
  it("approves an urgent request the policy allows and returns the decided request", async () => {
    const env = await demoEnv();
    const app0 = app();
    const raised = routes.raiseRequest.response.parse(
      (
        await call(app0, "POST", routes.raiseRequest.path, {
          env,
          body: { farmer_id: "f1", type: "urgent", volume_m3: 50, reason: "urgent need water", channel: "portal" },
        })
      ).body,
    );

    const res = await call(app0, "POST", `/api/requests/${raised.id}/decide`, {
      env,
      body: { decision: "approve", volume_m3: 50 },
    });

    expectStatus(res, 200);
    const body = routes.decideRequest.response.parse(res.body);
    expect(body.status).toBe("approved");
    expect(body.coordinator_decision?.decision).toBe("approve");
  });

  it("400s when policy refuses an over-quota urgent grant", async () => {
    const env = await demoEnv();
    const app0 = app();
    const raised = routes.raiseRequest.response.parse(
      (
        await call(app0, "POST", routes.raiseRequest.path, {
          env,
          body: { farmer_id: "f1", type: "urgent", volume_m3: 9_999_999, reason: "urgent", channel: "portal" },
        })
      ).body,
    );

    const res = await call(app0, "POST", `/api/requests/${raised.id}/decide`, {
      env,
      body: { decision: "approve", volume_m3: 9_999_999 },
    });

    expectStatus(res, 400);
    expect(apiError(res.body).code).toBe("policy_refused");
  });

  it("rejects a request without moving water", async () => {
    const env = await demoEnv();
    const app0 = app();
    const raised = routes.raiseRequest.response.parse(
      (
        await call(app0, "POST", routes.raiseRequest.path, {
          env,
          body: { farmer_id: "f2", type: "buffer", volume_m3: 5, reason: "a little extra", channel: "portal" },
        })
      ).body,
    );

    const res = await call(app0, "POST", `/api/requests/${raised.id}/decide`, {
      env,
      body: { decision: "reject", volume_m3: 0, note: "not needed this week" },
    });

    expectStatus(res, 200);
    const body = routes.decideRequest.response.parse(res.body);
    expect(body.status).toBe("rejected");
  });

  it("404s for an unknown request", async () => {
    const env = await demoEnv();
    const res = await call(app(), "POST", "/api/requests/nope/decide", { env, body: { decision: "reject", volume_m3: 0 } });

    expectStatus(res, 404);
    apiError(res.body);
  });
});

describe("POST /api/canal/harvest", () => {
  it("appends crop.harvested, marks the plan harvested and moves the remaining quota to the buffer", async () => {
    const env = await demoEnv();
    const app0 = app();

    const before = routes.ledger.response.parse((await call(app0, "GET", routes.ledger.path, { env })).body);
    const f3Before = before.balances.farmers.find((farmer) => farmer.farmer_id === "f3");
    if (f3Before === undefined) throw new Error("seed has no f3 balance");
    const bufferBefore = before.balances.buffer_m3;

    const res = await call(app0, "POST", "/api/canal/harvest", { env, body: { farmer_id: "f3" } });

    expectStatus(res, 200);
    const body = res.body as {
      ok: boolean;
      farmer_id: string;
      crop_plan_id: string;
      remaining_m3: number;
      buffer_m3: number;
    };
    expect(body.ok).toBe(true);
    expect(body.farmer_id).toBe("f3");
    expect(body.crop_plan_id).toBe("cp3");
    expect(body.remaining_m3).toBeCloseTo(f3Before.quota_m3, 6);
    expect(body.buffer_m3).toBeCloseTo(bufferBefore + f3Before.quota_m3, 6);

    // The plan is now `harvested` and the event is in the log.
    const listed = routes.listFarmers.response.parse((await call(app0, "GET", routes.listFarmers.path, { env })).body);
    const plan = listed.find((entry) => entry.farmer.id === "f3")?.crop_plans.find((cp) => cp.id === "cp3");
    expect(plan?.status).toBe("harvested");

    const events = routes.events.response.parse((await call(app0, "GET", routes.events.path, { env })).body);
    const harvested = events.find((event) => event.type === "crop.harvested");
    expect(harvested).toBeDefined();
    if (harvested?.type === "crop.harvested") {
      expect(harvested.farmer_id).toBe("f3");
      expect(harvested.crop_plan_id).toBe("cp3");
      expect(harvested.remaining_m3).toBeCloseTo(f3Before.quota_m3, 6);
    }
  });

  it("404s for an unknown farmer", async () => {
    const env = await demoEnv();
    const res = await call(app(), "POST", "/api/canal/harvest", { env, body: { farmer_id: "nope" } });

    expectStatus(res, 404);
    apiError(res.body);
  });
});

describe("POST /api/canal/release-week", () => {
  /** A seeded env plus the seed result, so a test can target the seeded week and a farmer with quota. */
  async function seeded(): Promise<{ env: TestEnv; seed: SeedResult }> {
    const env = createEnv();
    const scenario = demoScenario();
    const weather = demoWeather();
    const seed = await seedScenario(env, scenario, weather);
    await seedWeather(env, weather, scenario.canal.id);
    return { env, seed };
  }

  /** The first farmer with a positive quota — guaranteed an approved entitlement for the seeded week. */
  async function farmerWithQuota(app0: Hono<{ Bindings: TestEnv }>, env: TestEnv): Promise<string> {
    const before = routes.ledger.response.parse((await call(app0, "GET", routes.ledger.path, { env })).body);
    const farmerId = before.balances.farmers.find((entry) => entry.quota_m3 > 0)?.farmer_id;
    if (farmerId === undefined) throw new Error("seed produced no farmer with quota");
    return farmerId;
  }

  it("releases the week's entitlement to the buffer and logs week.released_to_buffer", async () => {
    const { env, seed } = await seeded();
    const app0 = app();
    const farmerId = await farmerWithQuota(app0, env);

    const before = routes.ledger.response.parse((await call(app0, "GET", routes.ledger.path, { env })).body);
    const quotaBefore = before.balances.farmers.find((entry) => entry.farmer_id === farmerId)?.quota_m3 ?? 0;
    const bufferBefore = before.balances.buffer_m3;

    const res = await call(app0, "POST", "/api/canal/release-week", {
      env,
      body: { farmer_id: farmerId, week_start: seed.week_start },
    });

    expectStatus(res, 200);
    const body = res.body as {
      ok: boolean;
      farmer_id: string;
      week_start: string;
      volume_m3: number;
      buffer_m3: number;
    };
    expect(body.ok).toBe(true);
    expect(body.farmer_id).toBe(farmerId);
    expect(body.week_start).toBe(seed.week_start);
    // With no deliveries yet, the week's entitlement is the farmer's whole quota.
    expect(body.volume_m3).toBeCloseTo(quotaBefore, 6);
    expect(body.buffer_m3).toBeCloseTo(bufferBefore + body.volume_m3, 6);

    // The farmer's quota falls by exactly the released volume; conservation still holds.
    const after = routes.ledger.response.parse((await call(app0, "GET", routes.ledger.path, { env })).body);
    const quotaAfter = after.balances.farmers.find((entry) => entry.farmer_id === farmerId)?.quota_m3 ?? 0;
    expect(quotaAfter).toBeCloseTo(quotaBefore - body.volume_m3, 6);
    expect(after.balances.conservation_ok).toBe(true);

    // The event is in the log with the released volume.
    const events = routes.events.response.parse((await call(app0, "GET", routes.events.path, { env })).body);
    const released = events.find((event) => event.type === "week.released_to_buffer");
    expect(released).toBeDefined();
    if (released?.type === "week.released_to_buffer") {
      expect(released.farmer_id).toBe(farmerId);
      expect(released.week_start).toBe(seed.week_start);
      expect(released.volume_m3).toBeCloseTo(body.volume_m3, 6);
    }
  });

  it("defaults to the current week when week_start is omitted", async () => {
    const { env, seed } = await seeded();
    const app0 = app();
    const farmerId = await farmerWithQuota(app0, env);

    const res = await call(app0, "POST", "/api/canal/release-week", { env, body: { farmer_id: farmerId } });

    expectStatus(res, 200);
    const body = res.body as { week_start: string; volume_m3: number };
    expect(body.week_start).toBe(seed.week_start);
    expect(body.volume_m3).toBeGreaterThan(0);
  });

  it("404s for an unknown farmer", async () => {
    const { env } = await seeded();
    const res = await call(app(), "POST", "/api/canal/release-week", {
      env,
      body: { farmer_id: "nope", week_start: "2026-09-14" },
    });

    expectStatus(res, 404);
    apiError(res.body);
  });

  it("400s on a malformed week_start", async () => {
    const { env } = await seeded();
    const res = await call(app(), "POST", "/api/canal/release-week", {
      env,
      body: { farmer_id: "f1", week_start: "14-09-2026" },
    });

    expectStatus(res, 400);
    apiError(res.body);
  });

  it("400s when the farmer has no approved entitlement for that week", async () => {
    const { env } = await seeded();
    const res = await call(app(), "POST", "/api/canal/release-week", {
      env,
      body: { farmer_id: "f1", week_start: "2026-09-21" },
    });

    expectStatus(res, 400);
    expect(apiError(res.body).code).toBe("nothing_to_release");
  });
});

describe("demo script, end to end", () => {
  it("runs the scripted order through the HTTP surface", async () => {
    const env = await demoEnv();
    const app0 = app();

    // Step 1 — the coordinator compares equal-hours and equal-water for rw1.
    const compared = routes.proposeRoster.response.parse(
      (await call(app0, "POST", routes.proposeRoster.path, { env, body: { release_window_id: "rw1", mode: "equal_hours" } })).body,
    );
    expect(compared.comparison.equal_hours_gini).toBeGreaterThanOrEqual(0);

    // Step 2 — f1 raises an urgent voice request; the coordinator approves it.
    const urgent = routes.raiseRequest.response.parse(
      (
        await call(app0, "POST", routes.raiseRequest.path, {
          env,
          body: { farmer_id: "f1", type: "urgent", volume_m3: 40, reason: "paddy flowering, urgent need water", channel: "voice" },
        })
      ).body,
    );
    const approvedRequest = routes.decideRequest.response.parse(
      (await call(app0, "POST", `/api/requests/${urgent.id}/decide`, { env, body: { decision: "approve", volume_m3: 40 } })).body,
    );
    expect(approvedRequest.status).toBe("approved");

    // Step 3 — a roster is re-planned in equal-water mode and approved, queuing calls.
    const replanned = routes.proposeRoster.response.parse(
      (await call(app0, "POST", routes.proposeRoster.path, { env, body: { release_window_id: "rw1", mode: "equal_water" } })).body,
    );
    const approvedRoster = routes.approveRoster.response.parse(
      (await call(app0, "POST", `/api/rosters/${replanned.roster.id}/approve`, { env, body: {} })).body,
    );
    expect(approvedRoster.contacts_queued).toBeGreaterThan(0);

    // Step 4 — advance the simulated clock towards the rw2 night release.
    const advanced = routes.demoAdvance.response.parse(
      (await call(app0, "POST", routes.demoAdvance.path, { env, body: { hours: 12 } })).body,
    );
    expect(Number.isNaN(Date.parse(advanced.now))).toBe(false);

    // Step 5 — f7 asks for buffer water and the coordinator grants it.
    const buffer = routes.raiseRequest.response.parse(
      (
        await call(app0, "POST", routes.raiseRequest.path, {
          env,
          body: { farmer_id: "f7", type: "buffer", volume_m3: 5, reason: "a little extra water please", channel: "portal" },
        })
      ).body,
    );
    const granted = routes.decideRequest.response.parse(
      (await call(app0, "POST", `/api/requests/${buffer.id}/decide`, { env, body: { decision: "approve", volume_m3: 5 } })).body,
    );
    expect(granted.status).toBe("approved");

    // Step 6 — the auditor reports the invariant and fairness.
    const audit = routes.audit.response.parse((await call(app0, "GET", routes.audit.path, { env })).body);
    expect(typeof audit.summary_en).toBe("string");
    expect(audit.findings.length).toBeGreaterThan(0);

    // The whole run is still conserved.
    const ledgerView = routes.ledger.response.parse((await call(app0, "GET", routes.ledger.path, { env })).body);
    expect(ledgerView.balances.conservation_ok).toBe(true);
  });
});
