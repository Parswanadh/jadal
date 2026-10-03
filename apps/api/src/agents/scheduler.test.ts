/**
 * Scheduler-agent tests.
 *
 * `proposeRoster` is a *proposal* builder: it assembles the roster engine's input from the database,
 * builds the requested rotation plus both modes' fairness, and returns — it never writes. These
 * tests pin the response contract, the "proposes without committing" rule (the event log is
 * unchanged), the both-modes comparison, and the `RangeError` for an unknown window.
 *
 * NO NETWORK: only the in-memory shim is used.
 */

import { describe, expect, it } from "vitest";

import { routes } from "@jadal/contracts";

import { createEnv, type TestEnv } from "../../test/harness";
import { demoScenario, demoWeather, seedScenario } from "../../test/fixtures";
import { readEvents } from "../db/store";
import { proposeRoster } from "./scheduler";

async function seeded(): Promise<TestEnv> {
  const env = createEnv();
  await seedScenario(env, demoScenario(), demoWeather());
  return env;
}

describe("proposeRoster", () => {
  it("returns a proposal that parses as routes.proposeRoster.response", async () => {
    const env = await seeded();
    const proposal = await proposeRoster(env, "rw1", "equal_water");

    expect(() => routes.proposeRoster.response.parse(proposal)).not.toThrow();
    expect(proposal.roster.turns.length).toBeGreaterThan(0);
    expect(proposal.need_met.length).toBeGreaterThan(0);
    expect(env.calls).toHaveLength(0);
  });

  it("proposes without committing: the event log is unchanged", async () => {
    const env = await seeded();
    const before = (await readEvents(env)).length;

    await proposeRoster(env, "rw1", "equal_water");

    expect((await readEvents(env)).length).toBe(before);
  });

  it("reports both modes' Gini fairness regardless of the requested mode", async () => {
    const env = await seeded();
    const equalWater = await proposeRoster(env, "rw1", "equal_water");
    const equalHours = await proposeRoster(env, "rw1", "equal_hours");

    expect(equalWater.comparison).toEqual(equalHours.comparison);
    for (const gini of [equalWater.comparison.equal_hours_gini, equalWater.comparison.equal_water_gini]) {
      expect(gini).toBeGreaterThanOrEqual(0);
      expect(gini).toBeLessThanOrEqual(1);
    }
  });

  it("derives the roster id from the release window and mode, so the two modes differ", async () => {
    const env = await seeded();
    const equalWater = await proposeRoster(env, "rw1", "equal_water");
    const equalHours = await proposeRoster(env, "rw1", "equal_hours");

    expect(equalWater.roster.release_window_id).toBe("rw1");
    expect(equalWater.roster.id).not.toBe(equalHours.roster.id);
  });

  it("throws RangeError for an unknown release window", async () => {
    const env = await seeded();
    await expect(proposeRoster(env, "rw-missing", "equal_water")).rejects.toBeInstanceOf(RangeError);
  });
});
