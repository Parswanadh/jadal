import { beforeEach, describe, expect, it } from "vitest";
import { demoReset } from "../api";
import { api } from "./api";

// Mock mode is the default (VITE_MOCK unset), so these run against the shared contract-validated mock.
beforeEach(async () => {
  await demoReset();
});

describe("coordinator api adapter (mock mode)", () => {
  it("lists registrations with names, outlets and plots, and one waiting for a check", async () => {
    const rows = await api.listFarmers();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.farmer.name).toBeTruthy();
    expect(rows[0]?.plots[0]?.outletName).toMatch(/^Outlet \d+$/);
    expect(rows.some((r) => !r.verified)).toBe(true);
  });

  it("marks a farmer as checked", async () => {
    const waiting = (await api.listFarmers()).find((r) => !r.verified);
    expect(waiting).toBeDefined();
    await api.verifyFarmer(waiting?.farmer.id ?? "");
    expect((await api.listFarmers()).every((r) => r.verified)).toBe(true);
  });

  it("maps entitlements to farmer names and crops", async () => {
    const { rows } = await api.suggestEntitlements();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.farmerName).not.toBe("");
      expect(r.crop).not.toBe("");
    }
  });

  it("remembers approved entitlements", async () => {
    const before = await api.suggestEntitlements();
    expect(before.rows.every((r) => r.status === "proposed")).toBe(true);
    const first = before.rows[0];
    await api.approveEntitlements([{ id: first?.id ?? "", volume_m3: 123 }]);
    const after = await api.suggestEntitlements();
    expect(after.rows.find((r) => r.id === first?.id)).toMatchObject({ volumeM3: 123, status: "edited" });
    expect(after.rows.filter((r) => r.status === "approved").length).toBe(after.rows.length - 1);
  });

  it("proposes a roster for the first release window in both modes, with outlet names and the window times", async () => {
    const water = await api.proposeRoster("equal_water");
    const hours = await api.proposeRoster("equal_hours");
    expect(water.turns.length).toBeGreaterThan(0);
    expect(water.turns[0]?.outletName).toBe("Outlet 1");
    expect(water.turns[0]?.farmerName).toBeTruthy();
    expect(hours.mode).toBe("equal_hours");
    expect(Date.parse(water.windowEnd)).toBeGreaterThan(Date.parse(water.windowStart));
    expect(water.equalWaterGini).toBeLessThan(water.equalHoursGini);
  });

  it("approving a roster is remembered", async () => {
    const water = await api.proposeRoster("equal_water");
    expect(water.approved).toBe(false);
    expect(await api.approveRoster(water.id)).toBeGreaterThan(0);
    expect((await api.proposeRoster("equal_water")).approved).toBe(true);
  });

  it("lists a pending request with the agent suggestion, and remembers a decision", async () => {
    const rows = await api.listRequests();
    const pending = rows.find((r) => !r.decision);
    expect(pending?.farmerName).toBeTruthy();
    expect(pending?.recommendation?.volumeM3).toBeGreaterThan(0);
    await api.decideRequest(pending?.id ?? "", "approve", 100);
    const after = (await api.listRequests()).find((r) => r.id === pending?.id);
    expect(after?.decision).toMatchObject({ decision: "approve", volumeM3: 100 });
  });

  it("returns ledger balances and audit findings", async () => {
    const led = await api.ledger();
    expect(led.farmers.length).toBeGreaterThan(0);
    expect(led.entries.length).toBeGreaterThan(0);
    const audit = await api.audit();
    expect(audit.summaryEn).toBeTruthy();
    expect(audit.summaryTe).toBeTruthy();
  });
});
