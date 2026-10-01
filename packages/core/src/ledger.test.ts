import { describe, expect, it } from "vitest";
import type { JadalEvent, LedgerEntry } from "@jadal/contracts";
import { ledger } from "./ledger";

// Simple seeded Linear Congruential Generator (LCG) to strictly obey "no Math.random in tests"
function createPrng(initialSeed = 1337) {
  let s = initialSeed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe("A5: Ledger", () => {
  it("creates double entries for season.approved", () => {
    const seasonEvent: JadalEvent = {
      id: "ev1",
      at: "2026-09-01T00:00:00Z",
      canal_id: "c1",
      actor: { kind: "coordinator", id: "coord1" },
      type: "season.approved",
      season_supply_m3: 10000,
      entitlements: [
        {
          id: "e1",
          farmer_id: "f1",
          crop_plan_id: "cp1",
          week_start: "2026-09-01",
          volume_m3: 4000,
          net_irrigation_mm: 50,
          status: "approved",
        },
        {
          id: "e2",
          farmer_id: "f2",
          crop_plan_id: "cp2",
          week_start: "2026-09-01",
          volume_m3: 3500,
          net_irrigation_mm: 45,
          status: "approved",
        },
      ],
    };

    const entries = ledger.entriesFor(seasonEvent);
    expect(entries).toHaveLength(3); // 2 farmer quotas + 1 buffer remainder

    const bal = ledger.balances(entries);
    expect(bal.farmers["f1"]?.quota).toBe(4000);
    expect(bal.farmers["f2"]?.quota).toBe(3500);
    expect(bal.buffer).toBe(2500); // 10000 - 7500
    expect(bal.conveyance_losses).toBe(0);

    const conservation = ledger.checkConservation(entries, 10000);
    expect(conservation.ok).toBe(true);
    expect(conservation.diff_m3).toBeCloseTo(0, 4);
  });

  it("creates entries for turn.delivered, week.released_to_buffer, and crop.harvested", () => {
    const allEntries: LedgerEntry[] = [];
    const seasonSupply = 10000;

    // 1. Season approved
    const ev1: JadalEvent = {
      id: "ev1",
      at: "2026-09-01T00:00:00Z",
      canal_id: "c1",
      actor: { kind: "coordinator", id: "coord1" },
      type: "season.approved",
      season_supply_m3: seasonSupply,
      entitlements: [
        {
          id: "e1",
          farmer_id: "f1",
          crop_plan_id: "cp1",
          week_start: "2026-09-01",
          volume_m3: 5000,
          net_irrigation_mm: 50,
          status: "approved",
        },
      ],
    };
    allEntries.push(...ledger.entriesFor(ev1));

    // 2. Turn delivered: 800 m3 delivered + 150 m3 conveyance loss
    const ev2: JadalEvent = {
      id: "ev2",
      at: "2026-09-05T00:00:00Z",
      canal_id: "c1",
      actor: { kind: "system", id: "sys" },
      type: "turn.delivered",
      turn_id: "t1",
      farmer_id: "f1",
      delivered_m3: 800,
      conveyance_loss_m3: 150,
      overrun_h: 0,
    };
    allEntries.push(...ledger.entriesFor(ev2));

    // 3. Week unused released to buffer: 500 m3
    const ev3: JadalEvent = {
      id: "ev3",
      at: "2026-09-12T00:00:00Z",
      canal_id: "c1",
      actor: { kind: "farmer", id: "f1" },
      type: "week.released_to_buffer",
      farmer_id: "f1",
      week_start: "2026-09-12",
      volume_m3: 500,
    };
    allEntries.push(...ledger.entriesFor(ev3));

    // 4. Rain replanned: 300 m3 saved to buffer
    const ev4: JadalEvent = {
      id: "ev4",
      at: "2026-09-15T00:00:00Z",
      canal_id: "c1",
      actor: { kind: "agent", id: "need-agent" },
      type: "rain.replanned",
      saved_m3: 300,
      by_farmer_m3: { f1: 300 },
    };
    allEntries.push(...ledger.entriesFor(ev4));

    // 5. Crop harvested: remaining quota moved to buffer
    const ev5: JadalEvent = {
      id: "ev5",
      at: "2026-10-01T00:00:00Z",
      canal_id: "c1",
      actor: { kind: "farmer", id: "f1" },
      type: "crop.harvested",
      farmer_id: "f1",
      crop_plan_id: "cp1",
      remaining_m3: 200,
    };
    allEntries.push(...ledger.entriesFor(ev5));

    // Invariant check
    const check = ledger.checkConservation(allEntries, seasonSupply);
    expect(check.ok).toBe(true);
    expect(check.diff_m3).toBeCloseTo(0, 4);

    const bal = ledger.balances(allEntries);
    expect(bal.farmers["f1"]?.delivered).toBe(800);
    expect(bal.conveyance_losses).toBe(150);
    // Initial buffer was 5000 + 500 (released) + 300 (rain) + 200 (harvested) = 6000
    expect(bal.buffer).toBe(6000);
    // Remaining quota: 5000 - 800 - 150 - 500 - 300 - 200 = 3050
    expect(bal.farmers["f1"]?.quota).toBe(3050);
  });

  it("calculates Gini coefficient correctly", () => {
    // Perfectly equal: [100, 100, 100, 100] -> 0
    expect(ledger.gini([100, 100, 100, 100])).toBe(0);

    // Empty list -> 0
    expect(ledger.gini([])).toBe(0);

    // Moderately unequal
    const moderate = ledger.gini([10, 20, 30, 40]);
    expect(moderate).toBeGreaterThan(0.2);
    expect(moderate).toBeLessThan(0.4);

    // Highly unequal: [0, 0, 0, 100]
    const high = ledger.gini([0, 0, 0, 100]);
    expect(high).toBeGreaterThan(0.7);
  });

  it("Property test: a deterministic pseudo-random sequence of valid events always conserves volume", () => {
    const rng = createPrng(4242);
    const seasonSupply = 50000;
    const farmers = ["f1", "f2", "f3", "f4", "f5"];

    const allEntries: LedgerEntry[] = [];

    // Initial season approval with random allocation
    let remainingSupply = seasonSupply;
    const entitlements = farmers.map((f, idx) => {
      const vol = Math.floor(rng() * 6000) + 2000;
      remainingSupply -= vol;
      return {
        id: `e_${idx}`,
        farmer_id: f,
        crop_plan_id: `cp_${idx}`,
        week_start: "2026-09-01",
        volume_m3: vol,
        net_irrigation_mm: 50,
        status: "approved" as const,
      };
    });

    const initEvent: JadalEvent = {
      id: "ev_season",
      at: "2026-09-01T00:00:00Z",
      canal_id: "c1",
      actor: { kind: "coordinator", id: "coord" },
      type: "season.approved",
      season_supply_m3: seasonSupply,
      entitlements,
    };

    allEntries.push(...ledger.entriesFor(initEvent));

    // Simulate 50 sequential events
    for (let step = 0; step < 50; step++) {
      const currentBalances = ledger.balances(allEntries);
      const farmerId = farmers[Math.floor(rng() * farmers.length)]!;
      const farmerQuota = currentBalances.farmers[farmerId]?.quota ?? 0;
      const eventType = Math.floor(rng() * 4);

      if (eventType === 0 && farmerQuota > 100) {
        // Turn delivered
        const delivered = Math.floor(rng() * Math.min(farmerQuota, 500)) + 10;
        const loss = Math.floor(rng() * Math.min(farmerQuota - delivered, 100));
        allEntries.push(
          ...ledger.entriesFor({
            id: `ev_step_${step}`,
            at: new Date(Date.now() + step * 3600000).toISOString(),
            canal_id: "c1",
            actor: { kind: "system", id: "sys" },
            type: "turn.delivered",
            turn_id: `turn_${step}`,
            farmer_id: farmerId,
            delivered_m3: delivered,
            conveyance_loss_m3: loss,
            overrun_h: 0,
          })
        );
      } else if (eventType === 1 && farmerQuota > 50) {
        // Week released to buffer
        const released = Math.floor(rng() * Math.min(farmerQuota, 300)) + 5;
        allEntries.push(
          ...ledger.entriesFor({
            id: `ev_step_${step}`,
            at: new Date(Date.now() + step * 3600000).toISOString(),
            canal_id: "c1",
            actor: { kind: "farmer", id: farmerId },
            type: "week.released_to_buffer",
            farmer_id: farmerId,
            week_start: "2026-09-08",
            volume_m3: released,
          })
        );
      } else if (eventType === 2 && farmerQuota > 50) {
        // Rain replanned
        const saved = Math.floor(rng() * Math.min(farmerQuota, 200)) + 5;
        allEntries.push(
          ...ledger.entriesFor({
            id: `ev_step_${step}`,
            at: new Date(Date.now() + step * 3600000).toISOString(),
            canal_id: "c1",
            actor: { kind: "agent", id: "need-agent" },
            type: "rain.replanned",
            saved_m3: saved,
            by_farmer_m3: { [farmerId]: saved },
          })
        );
      } else if (currentBalances.buffer > 100) {
        // Buffer grant approved
        const grant = Math.floor(rng() * Math.min(currentBalances.buffer, 300)) + 10;
        allEntries.push(
          ...ledger.entriesFor({
            id: `ev_step_${step}`,
            at: new Date(Date.now() + step * 3600000).toISOString(),
            canal_id: "c1",
            actor: { kind: "farmer", id: farmerId },
            type: "request.decided",
            request_id: `req_${step}`,
            decision: "approve",
            volume_m3: grant,
            note: "Buffer request granted",
          })
        );
      }

      // Check conservation invariant after every single event
      const check = ledger.checkConservation(allEntries, seasonSupply);
      expect(check.ok).toBe(true);
      expect(check.diff_m3).toBeLessThan(0.001);
    }
  });

  it("returns empty entries for events that do not move volume", () => {
    const regEvent: JadalEvent = {
      id: "ev_reg",
      at: "2026-09-01T00:00:00Z",
      canal_id: "c1",
      actor: { kind: "coordinator", id: "coord" },
      type: "registration.verified",
      farmer_id: "f1",
    };
    const entries = ledger.entriesFor(regEvent);
    expect(entries).toEqual([]);
  });
});

