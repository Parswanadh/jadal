/**
 * Auditor tests (B5).
 *
 * The report must parse as `routes.audit.response`; a conservation violation must be `critical`; both
 * summaries must be non-empty; and the Telugu summary must contain Telugu script. NO NETWORK: the
 * default harness `fetch` throws, and the auditor never calls it.
 */

import { describe, expect, it } from "vitest";

import { routes } from "@jadal/contracts";
import { createEnv, readMigrations, type TestEnv } from "../../test/harness";
import { demoScenario, demoWeather, seedScenario } from "../../test/fixtures";
import { getSeason } from "../db/repo";
import { audit } from "./auditor";

const TELUGU = /[\u0C00-\u0C7F]/;

async function seeded(): Promise<TestEnv> {
  const env = createEnv();
  for (const migration of readMigrations()) await env.DB.exec(migration);
  const scenario = demoScenario();
  await seedScenario(env, scenario, demoWeather());
  return env;
}

describe("audit", () => {
  it("returns a report that parses as routes.audit.response", async () => {
    const env = await seeded();
    const report = await audit(env);

    expect(routes.audit.response.parse(report)).toBeTruthy();
    expect(env.calls).toHaveLength(0);
  });

  it("produces non-empty English and Telugu summaries with Telugu script", async () => {
    const env = await seeded();
    const report = await audit(env);

    expect(report.summary_en.length).toBeGreaterThan(0);
    expect(report.summary_te.length).toBeGreaterThan(0);
    expect(TELUGU.test(report.summary_te)).toBe(true);
  });

  it("reports a conservation violation as critical", async () => {
    const env = await seeded();
    const before = await audit(env);
    expect(before.balances.conservation_ok).toBe(true);

    const season = await getSeason(env, "c1");
    expect(season).not.toBeNull();
    const declared = season?.season_supply_m3 ?? 0;
    // Tamper with the *declared* supply without touching the log: the ledger still balances, so this
    // is exactly the mismatch `checkConservation` exists to catch.
    await env.DB.prepare("UPDATE season SET season_supply_m3 = ? WHERE canal_id = ?").bind(declared + 5000, "c1").run();

    const report = await audit(env);
    expect(report.balances.conservation_ok).toBe(false);
    expect(report.findings.some((finding) => finding.severity === "critical")).toBe(true);
  });
});
