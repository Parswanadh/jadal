/**
 * Tests for demo seeding, simulated-time advance and the demo-mode guard.
 *
 * The point of these tests is that the demo is *reproducible*: the same fixture always produces the
 * same event types and the same conserved ledger, and the destructive reset cannot fire on an
 * environment that has not opted in.
 */

import { JadalEvent } from "@jadal/contracts";
import { describe, expect, it } from "vitest";

import { createTestDb } from "../test/harness";
import { ledger } from "./core-shim";
import { isNightRelease, now } from "./db/clock";
import { getClockNow, getLedgerEntries, getWeather, listFarmers } from "./db/repo";
import {
  advanceDemo,
  DEMO_CANAL_ID,
  DEMO_SEASON_SUPPLY_M3,
  demoEnabled,
  demoEvents,
  resetDemo,
  seedWeather,
  type DemoEnv,
} from "./demo";

/** Fresh in-memory database with migrations applied, opted into demo mode by default. */
async function makeEnv(demoMode = true): Promise<DemoEnv> {
  const db = await createTestDb();
  return demoMode ? { DB: db, DEMO_MODE: "1" } : { DB: db };
}

async function eventTypes(env: DemoEnv): Promise<string[]> {
  // Read the log directly rather than through `store.readEvents`, which currently hands the raw
  // JSON text to `JadalEvent.parse` without a `JSON.parse` (a bug in a file this task does not own).
  const rows = await env.DB.prepare("SELECT type FROM events ORDER BY seq ASC").all<{ type: string }>();
  return rows.map((row) => row.type);
}

async function balancesOf(env: DemoEnv): Promise<ReturnType<typeof ledger.balances>> {
  return ledger.balances(await getLedgerEntries(env));
}

describe("resetDemo", () => {
  it("seeds all eight farmers, verified, each with plots and crop plans", async () => {
    const env = await makeEnv();
    const result = await resetDemo(env);

    expect(result).toEqual({ ok: true });

    const farmers = await listFarmers(env);
    expect(farmers).toHaveLength(8);
    expect(farmers.every((record) => record.verified)).toBe(true);
    expect(farmers.every((record) => record.plots.length >= 1)).toBe(true);
    expect(farmers.every((record) => record.crop_plans.length >= 1)).toBe(true);
    // Nine crop plans in the fixture, one farmer has two.
    expect(farmers.reduce((total, record) => total + record.crop_plans.length, 0)).toBe(9);
  });

  it("seeds a conserved ledger with the declared canal supply", async () => {
    const env = await makeEnv();
    await resetDemo(env);

    const entries = await getLedgerEntries(env);
    const conservation = ledger.checkConservation(entries, DEMO_SEASON_SUPPLY_M3);
    expect(conservation.ok).toBe(true);

    const balances = ledger.balances(entries);
    // @jadal/core credits `canal_supply` with the supply it debits to quotas/buffer, so the source
    // account reports the declared supply as a positive figure.
    expect(balances.canal_supply).toBe(DEMO_SEASON_SUPPLY_M3);
    expect(balances.buffer).toBe(0);
    expect(balances.conveyance_losses).toBe(0);
  });

  it("is idempotent: two resets give identical event types and balances", async () => {
    const env = await makeEnv();

    await resetDemo(env);
    const firstTypes = await eventTypes(env);
    const firstBalances = await balancesOf(env);

    await resetDemo(env);
    const secondTypes = await eventTypes(env);
    const secondBalances = await balancesOf(env);

    expect(secondTypes).toEqual(firstTypes);
    expect(secondBalances).toEqual(firstBalances);
  });

  it("refuses when demo mode is off and leaves existing data intact", async () => {
    const env = await makeEnv();
    await resetDemo(env);
    const before = await listFarmers(env);

    const disabled: DemoEnv = { DB: env.DB };
    const refused = await resetDemo(disabled);
    expect(refused).toEqual({ ok: false });

    const after = await listFarmers(env);
    expect(after).toEqual(before);
  });
});

describe("advanceDemo", () => {
  it("honours the scenario's now", async () => {
    const env = await makeEnv();
    await resetDemo(env);

    const expected = new Date("2026-09-14T06:00:00+05:30").toISOString();
    expect(await now(env)).toBe(expected);
    expect(await getClockNow(env)).toBe(expected);
  });

  it("moves the clock and returns an ISO instant, flipping isNightRelease across 18:00 IST", async () => {
    const env = await makeEnv();
    await resetDemo(env);

    const start = await now(env);
    expect(isNightRelease(start)).toBe(false);

    const advanced = await advanceDemo(env, 12);
    expect(new Date(advanced.now).toISOString()).toBe(advanced.now);
    expect(await now(env)).toBe(advanced.now);
    expect(isNightRelease(advanced.now)).toBe(true);
  });
});

describe("seedWeather", () => {
  it("upserts the offline series without duplicating rows", async () => {
    const env = await makeEnv();
    await resetDemo(env);

    const seeded = await getWeather(env, DEMO_CANAL_ID, "2026-09-01", 100);
    expect(seeded.length).toBe(21);

    await seedWeather(env, DEMO_CANAL_ID);
    const again = await getWeather(env, DEMO_CANAL_ID, "2026-09-01", 100);
    expect(again.length).toBe(21);
    expect(again).toEqual(seeded);
  });
});

describe("demoEvents", () => {
  it("is deterministic and every event validates against JadalEvent", () => {
    const first = demoEvents();
    const second = demoEvents();
    expect(second).toEqual(first);
    expect(JadalEvent.array().parse(first)).toEqual(first);

    const types = first.map((event) => event.type);
    expect(types).toHaveLength(19);
    expect(types.slice(0, 8).every((type) => type === "farmer.registered")).toBe(true);
    expect(types.slice(8, 16).every((type) => type === "registration.verified")).toBe(true);
    expect(types[16]).toBe("season.approved");
    expect(types.slice(17).every((type) => type === "release_window.announced")).toBe(true);
  });
});

describe("demoEnabled", () => {
  it("respects DEMO_MODE and refuses production", async () => {
    const db = await createTestDb();

    expect(demoEnabled({ DB: db })).toBe(false);
    expect(demoEnabled({ DB: db, DEMO_MODE: "0" })).toBe(false);
    expect(demoEnabled({ DB: db, DEMO_MODE: "1" })).toBe(true);
    expect(demoEnabled({ DB: db, ENVIRONMENT: "demo" })).toBe(true);
    expect(demoEnabled({ DB: db, DEMO_MODE: "1", ENVIRONMENT: "production" })).toBe(false);
  });
});
