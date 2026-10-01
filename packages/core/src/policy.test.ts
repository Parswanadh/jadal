import { describe, it, expect } from "vitest";
import { policy } from "./policy";
import type { Balances } from "./ledger";

describe("policy.canGrantUrgent", () => {
  const mockBalances: Balances = {
    canal_supply: 180000,
    buffer: 5000,
    conveyance_losses: 200,
    farmers: {
      f1: { quota: 1200, delivered: 800 },
      f2: { quota: 0, delivered: 2000 },
      f3: { quota: 450, delivered: 150 },
    },
  };

  it("approves when requested volume is strictly less than available future quota", () => {
    const result = policy.canGrantUrgent(mockBalances, "f1", 500);
    expect(result.ok).toBe(true);
    expect(result.reason.toLowerCase()).toContain("sufficient");
  });

  it("approves when requested volume exactly equals available future quota", () => {
    const result = policy.canGrantUrgent(mockBalances, "f1", 1200);
    expect(result.ok).toBe(true);
  });

  it("refuses when requested volume exceeds available future quota", () => {
    const result = policy.canGrantUrgent(mockBalances, "f1", 1201);
    expect(result.ok).toBe(false);
    expect(result.reason.toLowerCase()).toContain("insufficient");
  });

  it("refuses when farmer has zero quota remaining", () => {
    const result = policy.canGrantUrgent(mockBalances, "f2", 100);
    expect(result.ok).toBe(false);
    expect(result.reason.toLowerCase()).toContain("insufficient");
  });

  it("refuses when farmer does not exist in balances", () => {
    const result = policy.canGrantUrgent(mockBalances, "f999", 50);
    expect(result.ok).toBe(false);
    expect(result.reason.toLowerCase()).toContain("insufficient");
  });

  it("refuses when requested volume is zero or negative", () => {
    const resultZero = policy.canGrantUrgent(mockBalances, "f1", 0);
    expect(resultZero.ok).toBe(false);
    expect(resultZero.reason.toLowerCase()).toContain("positive");

    const resultNeg = policy.canGrantUrgent(mockBalances, "f1", -50);
    expect(resultNeg.ok).toBe(false);
    expect(resultNeg.reason.toLowerCase()).toContain("positive");
  });
});

describe("policy.canGrantBuffer", () => {
  const baseBalances: Balances = {
    canal_supply: 180000,
    buffer: 2000,
    conveyance_losses: 500,
    farmers: {
      f1: { quota: 0, delivered: 1500 },
      f2: { quota: 300, delivered: 1200 },
    },
  };

  it("approves when request is within 25% weekly entitlement and within buffer balance", () => {
    // weekly entitlement = 1000 m3 -> 25% cap = 250 m3. Buffer = 2000 m3. Request = 200 m3.
    const result = policy.canGrantBuffer(baseBalances, "f1", 200, 1000, 0);
    expect(result.ok).toBe(true);
    expect(result.max_m3).toBe(250);
    expect(result.reason.toLowerCase()).toContain("approved");
  });

  it("approves when request exactly equals the 25% cap", () => {
    // weekly entitlement = 800 m3 -> 25% cap = 200 m3.
    const result = policy.canGrantBuffer(baseBalances, "f1", 200, 800, 0);
    expect(result.ok).toBe(true);
    expect(result.max_m3).toBe(200);
  });

  it("refuses when request exceeds the 25% cap", () => {
    // weekly entitlement = 1000 m3 -> cap = 250 m3. Request = 300 m3.
    const result = policy.canGrantBuffer(baseBalances, "f1", 300, 1000, 0);
    expect(result.ok).toBe(false);
    expect(result.max_m3).toBe(250);
    expect(result.reason.toLowerCase()).toContain("cap");
  });

  it("deducts already granted volume from the weekly cap", () => {
    // weekly entitlement = 1000 m3 -> 25% cap = 250 m3.
    // already granted = 150 m3 -> remaining cap = 100 m3.
    const resultOk = policy.canGrantBuffer(baseBalances, "f1", 80, 1000, 150);
    expect(resultOk.ok).toBe(true);
    expect(resultOk.max_m3).toBe(100);

    const resultExcess = policy.canGrantBuffer(baseBalances, "f1", 120, 1000, 150);
    expect(resultExcess.ok).toBe(false);
    expect(resultExcess.max_m3).toBe(100);
  });

  it("refuses when already granted volume equals or exceeds the weekly cap", () => {
    // weekly entitlement = 1000 m3 -> 25% cap = 250 m3. Already granted = 250 m3.
    const result = policy.canGrantBuffer(baseBalances, "f1", 10, 1000, 250);
    expect(result.ok).toBe(false);
    expect(result.max_m3).toBe(0);

    // Already granted = 300 m3 (> 250 m3)
    const resultOver = policy.canGrantBuffer(baseBalances, "f1", 10, 1000, 300);
    expect(resultOver.ok).toBe(false);
    expect(resultOver.max_m3).toBe(0);
  });

  it("limits max_m3 by buffer balance when buffer is smaller than remaining cap", () => {
    const lowBufferBalances: Balances = {
      ...baseBalances,
      buffer: 120,
    };

    // weekly entitlement = 1000 m3 -> 25% cap = 250 m3. Buffer balance = 120 m3.
    // Max allowable is min(250, 120) = 120 m3.
    const result = policy.canGrantBuffer(lowBufferBalances, "f1", 150, 1000, 0);
    expect(result.ok).toBe(false);
    expect(result.max_m3).toBe(120);
    expect(result.reason.toLowerCase()).toContain("buffer");

    const resultOk = policy.canGrantBuffer(lowBufferBalances, "f1", 120, 1000, 0);
    expect(resultOk.ok).toBe(true);
    expect(resultOk.max_m3).toBe(120);
  });

  it("refuses when buffer reserve is completely empty", () => {
    const emptyBufferBalances: Balances = {
      ...baseBalances,
      buffer: 0,
    };

    const result = policy.canGrantBuffer(emptyBufferBalances, "f1", 50, 1000, 0);
    expect(result.ok).toBe(false);
    expect(result.max_m3).toBe(0);
    expect(result.reason.toLowerCase()).toContain("exhausted");
  });

  it("refuses when weekly entitlement is zero or negative", () => {
    const result = policy.canGrantBuffer(baseBalances, "f1", 50, 0, 0);
    expect(result.ok).toBe(false);
    expect(result.max_m3).toBe(0);
  });

  it("refuses when requested volume is zero or negative", () => {
    const resultZero = policy.canGrantBuffer(baseBalances, "f1", 0, 1000, 0);
    expect(resultZero.ok).toBe(false);
    expect(resultZero.max_m3).toBe(250);
    expect(resultZero.reason.toLowerCase()).toContain("positive");

    const resultNeg = policy.canGrantBuffer(baseBalances, "f1", -50, 1000, 0);
    expect(resultNeg.ok).toBe(false);
    expect(resultNeg.reason.toLowerCase()).toContain("positive");
  });

  it("handles decimal and fractional volumes accurately", () => {
    // 25% of 333.33 m3 = 83.3325 m3
    const result = policy.canGrantBuffer(baseBalances, "f1", 50.5, 333.33, 20.2);
    expect(result.ok).toBe(true);
    expect(result.max_m3).toBeCloseTo(83.3325 - 20.2, 3);
  });
});
