/**
 * Policy tests. Balances are the ones the demo scenario produces after a season is approved
 * (`packages/contracts/fixtures/demo-scenario.json`: 180 000 m³ of supply, 20 000 m³ of weekly
 * entitlement per farmer, 20 000 m³ left in the buffer), and every reason string is asserted on
 * content, not merely on presence: these are read aloud to a coordinator over a phone, so a vague
 * message is a bug.
 */

import { describe, expect, it } from "vitest";

import type { Balances } from "@jadal/contracts";

import { BUFFER_WEEKLY_CAP_FRACTION, policy } from "./policy";

/** 20 000 m³ of weekly entitlement per farmer, 20 000 m³ sitting in the buffer. */
function balancesOf(overrides: Partial<Balances> = {}, farmers: Balances["farmers"] = {}): Balances {
  return {
    canal_supply: -180_000,
    buffer: 20_000,
    conveyance_losses: 0,
    farmers: {
      f1: { quota: 20_000, delivered: 0 },
      f2: { quota: 20_000, delivered: 0 },
      ...farmers,
    },
    ...overrides,
  };
}

describe("policy.canGrantUrgent", () => {
  it("approves a grant the farmer's own undelivered quota covers", () => {
    const result = policy.canGrantUrgent(balancesOf(), "f1", 1500);
    expect(result.ok).toBe(true);
    expect(result.reason).toContain("f1");
    expect(result.reason).toContain("1500");
    expect(result.reason).toContain("20000");
  });

  it("approves a grant that uses the very last of the undelivered quota", () => {
    const balances = balancesOf({}, { f1: { quota: 20_000, delivered: 18_500 } });
    expect(policy.canGrantUrgent(balances, "f1", 1500).ok).toBe(true);
    expect(policy.canGrantUrgent(balances, "f1", 1500.5).ok).toBe(false);
  });

  it("rejects a grant larger than the undelivered quota, and says why", () => {
    const balances = balancesOf({}, { f1: { quota: 20_000, delivered: 18_000 } });
    const result = policy.canGrantUrgent(balances, "f1", 2500);
    expect(result.ok).toBe(false);
    // The reason must name the number available, not just say "no".
    expect(result.reason).toContain("2500");
    expect(result.reason).toContain("2000");
    expect(result.reason).toContain("buffer");
  });

  it("rejects when nothing is left to bring forward", () => {
    const balances = balancesOf({}, { f1: { quota: 20_000, delivered: 20_000 } });
    const result = policy.canGrantUrgent(balances, "f1", 100);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("no undelivered quota left");
    expect(result.reason).toContain("20000");
  });

  it("treats a farmer who is in the ledger only as delivered as having nothing to grant", () => {
    // Over-delivered (a grant booked twice, say) or a farmer with no entitlement at all.
    const balances = balancesOf({}, { f9: { quota: 0, delivered: 400 } });
    expect(policy.canGrantUrgent(balances, "f9", 1).ok).toBe(false);
    expect(policy.canGrantUrgent(balances, "f404", 1).ok).toBe(false);
  });

  it("rejects an empty or negative request", () => {
    expect(policy.canGrantUrgent(balancesOf(), "f1", 0).ok).toBe(false);
    expect(policy.canGrantUrgent(balancesOf(), "f1", -5).ok).toBe(false);
    expect(policy.canGrantUrgent(balancesOf(), "f1", 0).reason).toContain("positive volume");
  });
});

describe("policy.canGrantBuffer", () => {
  it("caps a grant at 25% of the weekly entitlement", () => {
    expect(BUFFER_WEEKLY_CAP_FRACTION).toBe(0.25);
    // 20 000 m³ entitlement → 5 000 m³ of buffer water, and the buffer holds 20 000 m³, so the
    // entitlement cap is the binding one.
    const result = policy.canGrantBuffer(balancesOf(), "f1", 5000, 20_000, 0);
    expect(result).toEqual({ ok: true, max_m3: 5000, reason: result.reason });
    expect(result.reason).toContain("5000");
    expect(result.reason).toContain("25%");
  });

  it("reports the exact maximum when the ask is over the cap", () => {
    const result = policy.canGrantBuffer(balancesOf(), "f1", 6000, 20_000, 0);
    expect(result.ok).toBe(false);
    expect(result.max_m3).toBe(5000);
    expect(result.reason).toContain("6000");
    expect(result.reason).toContain("5000");
    expect(result.reason).toContain("cap");
  });

  it("subtracts what the farmer has already been granted this week", () => {
    const first = policy.canGrantBuffer(balancesOf(), "f1", 3000, 20_000, 0);
    expect(first.max_m3).toBe(5000);
    // 3 000 already granted leaves 2 000 of the 5 000 m³ cap.
    const second = policy.canGrantBuffer(balancesOf(), "f1", 2500, 20_000, 3000);
    expect(second.ok).toBe(false);
    expect(second.max_m3).toBe(2000);
    expect(policy.canGrantBuffer(balancesOf(), "f1", 2000, 20_000, 3000).ok).toBe(true);
  });

  it("rejects a second grant once the weekly cap is used up", () => {
    const result = policy.canGrantBuffer(balancesOf(), "f1", 1, 20_000, 5000);
    expect(result.ok).toBe(false);
    expect(result.max_m3).toBe(0);
    expect(result.reason).toContain("already granted");
  });

  it("caps by what is actually in the buffer when the buffer is the smaller number", () => {
    const balances = balancesOf({ buffer: 700 });
    const result = policy.canGrantBuffer(balances, "f1", 1000, 20_000, 0);
    expect(result.ok).toBe(false);
    expect(result.max_m3).toBe(700);
    expect(result.reason).toContain("700");
    expect(policy.canGrantBuffer(balances, "f1", 700, 20_000, 0).ok).toBe(true);
  });

  it("rejects everything when the buffer is empty", () => {
    for (const buffer of [0, -50]) {
      const result = policy.canGrantBuffer(balancesOf({ buffer }), "f1", 100, 20_000, 0);
      expect(result.ok).toBe(false);
      expect(result.max_m3).toBe(0);
      expect(result.reason).toContain("buffer is empty");
    }
  });

  it("rejects when there is no weekly entitlement to derive a cap from", () => {
    for (const weeklyEntitlement_m3 of [0, -1000]) {
      const result = policy.canGrantBuffer(balancesOf(), "f1", 10, weeklyEntitlement_m3, 0);
      expect(result.ok).toBe(false);
      expect(result.max_m3).toBe(0);
      expect(result.reason).toContain("no weekly entitlement");
    }
  });

  it("rejects an empty or negative request but still reports the maximum", () => {
    const result = policy.canGrantBuffer(balancesOf(), "f1", 0, 20_000, 0);
    expect(result.ok).toBe(false);
    expect(result.max_m3).toBe(5000);
    expect(result.reason).toContain("positive volume");
  });

  it("survives a non-finite balance without inventing a grant", () => {
    const balances = balancesOf({ buffer: Number.NaN });
    const result = policy.canGrantBuffer(balances, "f1", 100, 20_000, 0);
    expect(result.ok).toBe(false);
    expect(result.max_m3).toBe(0);
  });

  it("keeps the two rules independent: the buffer is not an alternative to a farmer's own quota", () => {
    // f1 has used all of their quota, so an urgent grant is impossible …
    const spent = balancesOf({}, { f1: { quota: 20_000, delivered: 20_000 } });
    expect(policy.canGrantUrgent(spent, "f1", 500).ok).toBe(false);
    // … but the buffer can still cover the same farmer, within the weekly cap.
    const buffer = policy.canGrantBuffer(balancesOf(), "f1", 500, 20_000, 0);
    expect(buffer.ok).toBe(true);
    expect(buffer.max_m3).toBe(5000);
  });
});
