/**
 * Need-agent tests.
 *
 * `suggestEntitlements` prices one week for every verified/active crop plan with the deterministic
 * FAO-56 crop engine — never an LLM and never a hand-written volume. These tests pin the week
 * arithmetic (`weekStartFor`, `addDaysIso`), the response contract, the deterministic ids, and the
 * explanation that cites the crop, area, net depth and volume. Weather comes from the cache or the
 * bundled snapshot, so the run is offline.
 *
 * NO NETWORK: only the in-memory shim is used, and the harness fetch throws on any unmocked URL.
 */

import { describe, expect, it } from "vitest";

import { routes } from "@jadal/contracts";

import { createEnv, createTestDb, type TestEnv } from "../../test/harness";
import { demoScenario, demoWeather, seedScenario } from "../../test/fixtures";
import { addDaysIso, computeEntitlements, suggestEntitlements, weekStartFor } from "./need";

async function seeded(): Promise<TestEnv> {
  const env = createEnv();
  await seedScenario(env, demoScenario(), demoWeather());
  return env;
}

describe("weekStartFor", () => {
  it("snaps an instant to the Monday on or before it, as YYYY-MM-DD", () => {
    // 2026-09-14 is a Monday; Wednesday the 16th snaps back to it.
    expect(weekStartFor("2026-09-14T06:00:00.000Z")).toBe("2026-09-14");
    expect(weekStartFor("2026-09-16T23:59:00.000Z")).toBe("2026-09-14");
    expect(weekStartFor("2026-09-20T23:59:00.000Z")).toBe("2026-09-14");
    // The next Monday starts a new week.
    expect(weekStartFor("2026-09-21T00:00:00.000Z")).toBe("2026-09-21");
  });

  it("throws RangeError for a non-instant", () => {
    expect(() => weekStartFor("not-a-date")).toThrow(RangeError);
  });
});

describe("addDaysIso", () => {
  it("adds whole days in UTC and crosses month boundaries", () => {
    expect(addDaysIso("2026-09-14", 7)).toBe("2026-09-21");
    expect(addDaysIso("2026-09-28", 7)).toBe("2026-10-05");
    expect(addDaysIso("2026-09-14", 0)).toBe("2026-09-14");
    expect(addDaysIso("2026-09-14", -7)).toBe("2026-09-07");
  });

  it("throws RangeError for a non-date", () => {
    expect(() => addDaysIso("14-09-2026", 1)).toThrow(RangeError);
  });
});

describe("suggestEntitlements", () => {
  it("prices every verified crop plan and parses as the contract response", async () => {
    const env = await seeded();
    const suggestion = await suggestEntitlements(env);

    expect(() => routes.suggestEntitlements.response.parse(suggestion)).not.toThrow();
    expect(suggestion.entitlements).toHaveLength(9);
    expect(suggestion.season_total_m3).toBeGreaterThan(0);
    expect(env.calls).toHaveLength(0);
  });

  it("writes a deterministic id and a crop-citing explanation per entitlement", async () => {
    const env = await seeded();
    const first = await suggestEntitlements(env);
    const second = await suggestEntitlements(env);

    expect(first.entitlements.map((entry) => entry.id)).toEqual(second.entitlements.map((entry) => entry.id));
    for (const entitlement of first.entitlements) {
      expect(entitlement.status).toBe("proposed");
      expect(entitlement.explanation ?? "").not.toHaveLength(0);
      expect(entitlement.volume_m3).toBeGreaterThanOrEqual(0);
    }
    expect(first.explanation).toContain("FAO-56");
    expect(first.explanation).toContain("m³");
  });

  it("computes the same week when a week_start is supplied explicitly", async () => {
    const env = await seeded();
    const implicit = await suggestEntitlements(env);
    const explicit = await computeEntitlements(env, implicit.entitlements[0]?.week_start as string);

    expect(explicit.entitlements).toEqual(implicit.entitlements);
  });

  it("says so plainly when no crop plan is registered at all", async () => {
    const env = createEnv();
    env.DB = await createTestDb();
    const suggestion = await computeEntitlements(env, "2026-09-14");

    expect(suggestion.entitlements).toHaveLength(0);
    expect(suggestion.season_total_m3).toBe(0);
    expect(suggestion.explanation).toContain("No verified crop plan needs water");
  });
});
