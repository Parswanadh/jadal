import { describe, expect, it } from "vitest";
import type { Balances } from "@jadal/contracts";
import { policy } from "./policy";

describe("A6: Policy Rules", () => {
  const sampleBalances: Balances = {
    canal_supply: 0,
    buffer: 1200,
    conveyance_losses: 400,
    farmers: {
      f1: { quota: 2500, delivered: 800 },
      f2: { quota: 300, delivered: 1500 },
      f3: { quota: 0, delivered: 2000 },
    },
  };

  describe("canGrantUrgent", () => {
    it("approves urgent request when farmer has sufficient quota", () => {
      const res = policy.canGrantUrgent(sampleBalances, "f1", 1000);
      expect(res.ok).toBe(true);
      expect(res.reason).toContain("Approved");
    });

    it("approves urgent request matching exact remaining quota", () => {
      const res = policy.canGrantUrgent(sampleBalances, "f1", 2500);
      expect(res.ok).toBe(true);
    });

    it("rejects urgent request when quota is insufficient", () => {
      const res = policy.canGrantUrgent(sampleBalances, "f2", 500);
      expect(res.ok).toBe(false);
      expect(res.reason).toContain("Insufficient future quota");
    });

    it("rejects urgent request for farmer with 0 quota", () => {
      const res = policy.canGrantUrgent(sampleBalances, "f3", 100);
      expect(res.ok).toBe(false);
      expect(res.reason).toContain("Insufficient future quota");
    });

    it("rejects unknown farmer with 0 quota", () => {
      const res = policy.canGrantUrgent(sampleBalances, "f_unknown", 100);
      expect(res.ok).toBe(false);
    });

    it("rejects non-positive volume requests", () => {
      expect(policy.canGrantUrgent(sampleBalances, "f1", 0).ok).toBe(false);
      expect(policy.canGrantUrgent(sampleBalances, "f1", -50).ok).toBe(false);
    });
  });

  describe("canGrantBuffer", () => {
    // 25% weekly cap rule:
    // weeklyEntitlement = 1000 m3 -> 25% cap = 250 m3
    it("approves buffer request within weekly cap and buffer availability", () => {
      const res = policy.canGrantBuffer(sampleBalances, "f1", 200, 1000, 0);
      expect(res.ok).toBe(true);
      expect(res.max_m3).toBe(250);
      expect(res.reason).toContain("Approved");
    });

    it("rejects request exceeding farmer weekly cap", () => {
      // Cap is 250 m3, already granted 100 m3 -> remaining cap is 150 m3. Requesting 200 m3.
      const res = policy.canGrantBuffer(sampleBalances, "f1", 200, 1000, 100);
      expect(res.ok).toBe(false);
      expect(res.max_m3).toBe(150);
      expect(res.reason).toContain("exceeds maximum grantable volume");
    });

    it("rejects when farmer has already exhausted weekly cap", () => {
      const res = policy.canGrantBuffer(sampleBalances, "f1", 50, 1000, 250);
      expect(res.ok).toBe(false);
      expect(res.max_m3).toBe(0);
      expect(res.reason).toContain("Weekly buffer cap reached");
    });

    it("rejects when buffer pool is depleted", () => {
      const depletedBalances: Balances = {
        ...sampleBalances,
        buffer: 0,
      };
      const res = policy.canGrantBuffer(depletedBalances, "f1", 100, 1000, 0);
      expect(res.ok).toBe(false);
      expect(res.max_m3).toBe(0);
      expect(res.reason).toContain("Common buffer pool is depleted");
    });

    it("caps max_m3 by remaining buffer when buffer is less than remaining farmer cap", () => {
      const lowBufferBalances: Balances = {
        ...sampleBalances,
        buffer: 80,
      };
      // Cap allows 250 m3, but buffer only has 80 m3
      const res = policy.canGrantBuffer(lowBufferBalances, "f1", 100, 1000, 0);
      expect(res.ok).toBe(false);
      expect(res.max_m3).toBe(80);
      expect(res.reason).toContain("exceeds maximum grantable volume (80 m³)");
    });

    it("rejects non-positive volume requests", () => {
      expect(policy.canGrantBuffer(sampleBalances, "f1", 0, 1000, 0).ok).toBe(false);
      expect(policy.canGrantBuffer(sampleBalances, "f1", -20, 1000, 0).ok).toBe(false);
    });
  });
});
