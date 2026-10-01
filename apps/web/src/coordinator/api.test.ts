import { describe, expect, it } from "vitest";
import { api } from "./api";
import { strings } from "./i18n";

// Mock mode is the default (VITE_MOCK unset), so these run against the shared contract-validated mock.
describe("coordinator api adapter (mock mode)", () => {
  it("lists registrations with names and plots", async () => {
    const { rows, source } = await api.listFarmers();
    expect(source).toBe("mock");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.farmer.name).toBeTruthy();
    expect(rows[0]?.plots.length).toBeGreaterThan(0);
  });

  it("maps entitlements to farmer names and crops", async () => {
    const { rows } = await api.suggestEntitlements();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.farmerName).not.toBe(r.farmerId);
      expect(r.crop).not.toBe("");
    }
  });

  it("proposes a roster for the first release window in both modes", async () => {
    const water = await api.proposeRoster("equal_water");
    const hours = await api.proposeRoster("equal_hours");
    expect(water.proposal.turns.length).toBeGreaterThan(0);
    expect(hours.proposal.mode).toBe("equal_hours");
    expect(water.proposal.equalWaterGini).toBeGreaterThanOrEqual(0);
  });

  it("returns ledger balances and audit findings", async () => {
    const led = await api.ledger();
    expect(led.balances.farmers.length).toBeGreaterThan(0);
    const audit = await api.audit();
    expect(audit.summaryEn).toBeTruthy();
  });
});

describe("coordinator strings", () => {
  it("has the same keys in English and Telugu", () => {
    expect(Object.keys(strings.te).sort()).toEqual(Object.keys(strings.en).sort());
  });
});
