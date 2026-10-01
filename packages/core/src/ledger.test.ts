import { describe, it, expect } from "vitest";
import { ledger, type JadalEvent } from "./ledger";
import demoScenario from "../../contracts/fixtures/demo-scenario.json";

describe("ledger.entriesFor", () => {
  it("creates entries for season.approved (canal_supply -> farmer quotas, remainder -> buffer)", () => {
    const event: JadalEvent = {
      id: "evt-season-1",
      at: "2026-09-01T00:00:00Z",
      canal_id: "c1",
      actor: { kind: "coordinator", id: "coord-1" },
      type: "season.approved",
      season_supply_m3: 10000,
      entitlements: [
        { farmer_id: "f1", volume_m3: 4000, explanation: "f1 crop plan" },
        { farmer_id: "f2", volume_m3: 3500, explanation: "f2 crop plan" },
      ],
    };

    const entries = ledger.entriesFor(event);
    expect(entries).toHaveLength(3);

    // Entitlement 1
    expect(entries[0]).toEqual({
      id: "evt-season-1:0",
      at: "2026-09-01T00:00:00Z",
      from: "canal_supply",
      to: "farmer:f1:quota",
      volume_m3: 4000,
      reason: "f1 crop plan",
      event_id: "evt-season-1",
    });

    // Entitlement 2
    expect(entries[1]).toEqual({
      id: "evt-season-1:1",
      at: "2026-09-01T00:00:00Z",
      from: "canal_supply",
      to: "farmer:f2:quota",
      volume_m3: 3500,
      reason: "f2 crop plan",
      event_id: "evt-season-1",
    });

    // Remainder to buffer: 10000 - 7500 = 2500
    expect(entries[2]).toEqual({
      id: "evt-season-1:2",
      at: "2026-09-01T00:00:00Z",
      from: "canal_supply",
      to: "buffer",
      volume_m3: 2500,
      reason: "season approved: unallocated supply to buffer",
      event_id: "evt-season-1",
    });
  });

  it("handles season.approved with zero remainder (exact allocation)", () => {
    const event: JadalEvent = {
      id: "evt-season-exact",
      at: "2026-09-01T00:00:00Z",
      canal_id: "c1",
      actor: { kind: "coordinator", id: "coord-1" },
      type: "season.approved",
      season_supply_m3: 5000,
      entitlements: [
        { farmer_id: "f1", volume_m3: 3000 },
        { farmer_id: "f2", volume_m3: 2000 },
      ],
    };

    const entries = ledger.entriesFor(event);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.to)).toEqual(["farmer:f1:quota", "farmer:f2:quota"]);
  });

  it("creates entries for turn.delivered (farmer quota -> delivered + conveyance loss)", () => {
    const event: JadalEvent = {
      id: "evt-turn-1",
      at: "2026-09-15T10:00:00Z",
      canal_id: "c1",
      actor: { kind: "system", id: "timer" },
      type: "turn.delivered",
      turn_id: "t1",
      farmer_id: "f1",
      delivered_m3: 450,
      conveyance_loss_m3: 50,
      overrun_h: 0,
    };

    const entries = ledger.entriesFor(event);
    expect(entries).toHaveLength(2);

    expect(entries[0]).toEqual({
      id: "evt-turn-1:0",
      at: "2026-09-15T10:00:00Z",
      from: "farmer:f1:quota",
      to: "farmer:f1:delivered",
      volume_m3: 450,
      reason: "turn delivered to field gate",
      event_id: "evt-turn-1",
    });

    expect(entries[1]).toEqual({
      id: "evt-turn-1:1",
      at: "2026-09-15T10:00:00Z",
      from: "farmer:f1:quota",
      to: "losses:conveyance",
      volume_m3: 50,
      reason: "conveyance loss during turn delivery",
      event_id: "evt-turn-1",
    });
  });

  it("creates entry for week.released_to_buffer (farmer quota -> buffer)", () => {
    const event: JadalEvent = {
      id: "evt-rel-1",
      at: "2026-09-20T00:00:00Z",
      canal_id: "c1",
      actor: { kind: "farmer", id: "f2" },
      type: "week.released_to_buffer",
      farmer_id: "f2",
      week_start: "2026-09-22",
      volume_m3: 300,
    };

    const entries = ledger.entriesFor(event);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      id: "evt-rel-1:0",
      at: "2026-09-20T00:00:00Z",
      from: "farmer:f2:quota",
      to: "buffer",
      volume_m3: 300,
      reason: "week unused / released to buffer",
      event_id: "evt-rel-1",
    });
  });

  it("creates entry for crop.harvested (farmer quota -> buffer)", () => {
    const event: JadalEvent = {
      id: "evt-harv-1",
      at: "2026-10-01T00:00:00Z",
      canal_id: "c1",
      actor: { kind: "farmer", id: "f3" },
      type: "crop.harvested",
      farmer_id: "f3",
      crop_plan_id: "cp3",
      remaining_m3: 850,
    };

    const entries = ledger.entriesFor(event);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      id: "evt-harv-1:0",
      at: "2026-10-01T00:00:00Z",
      from: "farmer:f3:quota",
      to: "buffer",
      volume_m3: 850,
      reason: "crop harvested early: remaining quota to buffer",
      event_id: "evt-harv-1",
    });
  });

  it("creates entries for rain.replanned (each farmer quota -> buffer in sorted order)", () => {
    const event: JadalEvent = {
      id: "evt-rain-1",
      at: "2026-09-18T06:00:00Z",
      canal_id: "c1",
      actor: { kind: "agent", id: "need-agent" },
      type: "rain.replanned",
      saved_m3: 600,
      by_farmer_m3: {
        f3: 250,
        f1: 150,
        f2: 200,
      },
    };

    const entries = ledger.entriesFor(event);
    expect(entries).toHaveLength(3);
    // Keys sorted deterministically: f1, f2, f3
    expect(entries[0]).toMatchObject({
      id: "evt-rain-1:0",
      from: "farmer:f1:quota",
      to: "buffer",
      volume_m3: 150,
    });
    expect(entries[1]).toMatchObject({
      id: "evt-rain-1:1",
      from: "farmer:f2:quota",
      to: "buffer",
      volume_m3: 200,
    });
    expect(entries[2]).toMatchObject({
      id: "evt-rain-1:2",
      from: "farmer:f3:quota",
      to: "buffer",
      volume_m3: 250,
    });
  });

  it("creates entry for request.decided approve buffer (buffer -> farmer quota)", () => {
    const event: JadalEvent = {
      id: "evt-dec-buf-1",
      at: "2026-09-25T12:00:00Z",
      canal_id: "c1",
      actor: { kind: "coordinator", id: "coord-1" },
      type: "request.decided",
      request_id: "req-buf-1",
      decision: "approve",
      volume_m3: 200,
      farmer_id: "f7",
      request_type: "buffer",
      note: "emergency buffer grant",
    };

    const entries = ledger.entriesFor(event);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      id: "evt-dec-buf-1:0",
      at: "2026-09-25T12:00:00Z",
      from: "buffer",
      to: "farmer:f7:quota",
      volume_m3: 200,
      reason: "emergency buffer grant",
      event_id: "evt-dec-buf-1",
    });
  });

  it("creates entry for request.decided approve urgent (no net volume change between accounts other than recorded reason)", () => {
    const event: JadalEvent = {
      id: "evt-dec-urg-1",
      at: "2026-09-26T14:00:00Z",
      canal_id: "c1",
      actor: { kind: "coordinator", id: "coord-1" },
      type: "request.decided",
      request_id: "req-urg-1",
      decision: "approve",
      volume_m3: 180,
      farmer_id: "f1",
      request_type: "urgent",
      note: "urgent quota borrow",
    };

    const entries = ledger.entriesFor(event);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      id: "evt-dec-urg-1:0",
      at: "2026-09-26T14:00:00Z",
      from: "farmer:f1:quota",
      to: "farmer:f1:quota",
      volume_m3: 180,
      reason: "urgent quota borrow",
      event_id: "evt-dec-urg-1",
    });
  });

  it("returns empty array for rejected request.decided or non-water-moving events", () => {
    const rejectedEvent: JadalEvent = {
      id: "evt-dec-rej",
      at: "2026-09-26T15:00:00Z",
      canal_id: "c1",
      actor: { kind: "coordinator", id: "coord-1" },
      type: "request.decided",
      request_id: "req-rej-1",
      decision: "reject",
      volume_m3: 180,
      farmer_id: "f1",
      request_type: "urgent",
    };
    expect(ledger.entriesFor(rejectedEvent)).toEqual([]);

    const nonWaterEvent: JadalEvent = {
      id: "evt-reg-1",
      at: "2026-09-01T00:00:00Z",
      canal_id: "c1",
      actor: { kind: "system", id: "sys" },
      type: "registration.verified",
      farmer_id: "f1",
    };
    expect(ledger.entriesFor(nonWaterEvent)).toEqual([]);
  });
});

describe("ledger.balances & checkConservation", () => {
  it("correctly tracks balances across a multi-step sequence and verifies conservation", () => {
    const seasonSupply = 180000;
    const initialEntitlements = demoScenario.farmers.map((f, i) => ({
      farmer_id: f.id,
      volume_m3: 15000 + i * 1000,
    }));
    const totalEntitlement = initialEntitlements.reduce((sum, e) => sum + e.volume_m3, 0);

    const seasonEvent: JadalEvent = {
      id: "e-season",
      at: "2026-09-01T00:00:00Z",
      canal_id: "c1",
      actor: { kind: "coordinator", id: "coord" },
      type: "season.approved",
      season_supply_m3: seasonSupply,
      entitlements: initialEntitlements,
    };

    let allEntries = ledger.entriesFor(seasonEvent);
    let bal = ledger.balances(allEntries);

    expect(bal.canal_supply).toBe(seasonSupply);
    expect(bal.buffer).toBe(seasonSupply - totalEntitlement);
    expect(bal.conveyance_losses).toBe(0);
    expect(bal.farmers["f1"]?.quota).toBe(15000);
    expect(bal.farmers["f1"]?.delivered).toBe(0);

    let audit = ledger.checkConservation(allEntries, seasonSupply);
    expect(audit.ok).toBe(true);
    expect(audit.diff_m3).toBeLessThan(0.0001);

    // Deliver turn to f1: 500 m3 delivered, 60 m3 conveyance loss
    const turnEvent: JadalEvent = {
      id: "e-turn",
      at: "2026-09-15T00:00:00Z",
      canal_id: "c1",
      actor: { kind: "system", id: "sys" },
      type: "turn.delivered",
      turn_id: "t1",
      farmer_id: "f1",
      delivered_m3: 500,
      conveyance_loss_m3: 60,
    };
    allEntries = allEntries.concat(ledger.entriesFor(turnEvent));
    bal = ledger.balances(allEntries);

    expect(bal.farmers["f1"]?.quota).toBe(15000 - 560);
    expect(bal.farmers["f1"]?.delivered).toBe(500);
    expect(bal.conveyance_losses).toBe(60);

    audit = ledger.checkConservation(allEntries, seasonSupply);
    expect(audit.ok).toBe(true);
    expect(audit.diff_m3).toBeLessThan(0.0001);

    // Rain replan: 200 m3 saved by f2
    const rainEvent: JadalEvent = {
      id: "e-rain",
      at: "2026-09-18T00:00:00Z",
      canal_id: "c1",
      actor: { kind: "agent", id: "need" },
      type: "rain.replanned",
      saved_m3: 200,
      by_farmer_m3: { f2: 200 },
    };
    allEntries = allEntries.concat(ledger.entriesFor(rainEvent));
    bal = ledger.balances(allEntries);
    expect(bal.buffer).toBe(seasonSupply - totalEntitlement + 200);

    audit = ledger.checkConservation(allEntries, seasonSupply);
    expect(audit.ok).toBe(true);
  });

  it("detects conservation violations", () => {
    const invalidEntries = [
      {
        id: "leak:0",
        at: "2026-09-01T00:00:00Z",
        from: "canal_supply" as const,
        to: "farmer:f1:quota" as const,
        volume_m3: 100,
        reason: "alloc",
        event_id: "e1",
      },
    ];

    // Supplying 150 but only 100 accounted for -> diff = 50
    const audit = ledger.checkConservation(invalidEntries, 150);
    expect(audit.ok).toBe(false);
    expect(audit.diff_m3).toBe(50);
  });
});

describe("ledger.gini", () => {
  it("returns 0 for empty array or all zeros", () => {
    expect(ledger.gini([])).toBe(0);
    expect(ledger.gini([0, 0, 0])).toBe(0);
  });

  it("returns 0 for perfect equality", () => {
    expect(ledger.gini([100, 100, 100, 100])).toBe(0);
  });

  it("calculates correct Gini for standard distributions", () => {
    // [0, 100]: Gini = |0-100| * 2 / (2 * 2 * 100) = 200 / 400 = 0.5
    expect(ledger.gini([0, 100])).toBeCloseTo(0.5, 4);

    // [10, 20, 30]: Gini = 2/9 ≈ 0.2222
    expect(ledger.gini([10, 20, 30])).toBeCloseTo(2 / 9, 4);
  });
});

describe("ledger property-based tests (seeded PRNG)", () => {
  // Deterministic Mulberry32 PRNG (zero Math.random calls)
  function createPrng(seed: number) {
    let s = seed >>> 0;
    return function next(): number {
      s |= 0;
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("always conserves volume across random valid event sequences", () => {
    const NUM_RUNS = 25;
    const EVENTS_PER_RUN = 60;

    for (let run = 0; run < NUM_RUNS; run++) {
      const prng = createPrng(12345 + run * 777);

      const farmerCount = 6;
      const farmerIds = Array.from({ length: farmerCount }, (_, i) => `f${i + 1}`);

      // Base seasonal supply between 100,000 and 200,000 m3
      const seasonSupply = 100000 + Math.floor(prng() * 100000);

      // Entitlements summing to less than seasonSupply
      let remainingSupply = seasonSupply;
      const entitlements = farmerIds.map((fId) => {
        const quota = Math.floor(prng() * 10000) + 2000;
        remainingSupply -= quota;
        return { farmer_id: fId, volume_m3: quota };
      });

      const seasonEvent: JadalEvent = {
        id: `run-${run}-season`,
        at: "2026-09-01T00:00:00Z",
        canal_id: "c1",
        actor: { kind: "coordinator", id: "coord-1" },
        type: "season.approved",
        season_supply_m3: seasonSupply,
        entitlements,
      };

      let allEntries = ledger.entriesFor(seasonEvent);

      // Initial conservation check
      const initialCheck = ledger.checkConservation(allEntries, seasonSupply);
      expect(initialCheck.ok).toBe(true);
      expect(initialCheck.diff_m3).toBeLessThan(0.001);

      // Apply random valid domain events
      for (let step = 0; step < EVENTS_PER_RUN; step++) {
        const bal = ledger.balances(allEntries);
        const farmersWithQuota = farmerIds.filter((fId) => (bal.farmers[fId]?.quota ?? 0) > 10);

        const choice = Math.floor(prng() * 6);
        let event: JadalEvent | null = null;

        if (choice === 0 && farmersWithQuota.length > 0) {
          // turn.delivered
          const fId = farmersWithQuota[Math.floor(prng() * farmersWithQuota.length)]!;
          const currentQuota = bal.farmers[fId]!.quota;
          const delivered = Math.floor(prng() * currentQuota * 0.6) + 1;
          const remainingForLoss = currentQuota - delivered;
          const loss = Math.floor(prng() * remainingForLoss * 0.4);

          event = {
            id: `run-${run}-step-${step}-turn`,
            at: `2026-09-${String(step % 28 + 1).padStart(2, "0")}T08:00:00Z`,
            canal_id: "c1",
            actor: { kind: "system", id: "roster" },
            type: "turn.delivered",
            turn_id: `t-${run}-${step}`,
            farmer_id: fId,
            delivered_m3: delivered,
            conveyance_loss_m3: loss,
          };
        } else if (choice === 1 && farmersWithQuota.length > 0) {
          // week.released_to_buffer
          const fId = farmersWithQuota[Math.floor(prng() * farmersWithQuota.length)]!;
          const currentQuota = bal.farmers[fId]!.quota;
          const releaseVol = Math.floor(prng() * currentQuota * 0.3) + 1;

          event = {
            id: `run-${run}-step-${step}-rel`,
            at: `2026-09-${String(step % 28 + 1).padStart(2, "0")}T08:00:00Z`,
            canal_id: "c1",
            actor: { kind: "farmer", id: fId },
            type: "week.released_to_buffer",
            farmer_id: fId,
            week_start: "2026-09-15",
            volume_m3: releaseVol,
          };
        } else if (choice === 2 && farmersWithQuota.length > 0) {
          // crop.harvested
          const fId = farmersWithQuota[Math.floor(prng() * farmersWithQuota.length)]!;
          const currentQuota = bal.farmers[fId]!.quota;
          const harvestVol = Math.floor(prng() * currentQuota) + 1;

          event = {
            id: `run-${run}-step-${step}-harv`,
            at: `2026-09-${String(step % 28 + 1).padStart(2, "0")}T08:00:00Z`,
            canal_id: "c1",
            actor: { kind: "farmer", id: fId },
            type: "crop.harvested",
            farmer_id: fId,
            crop_plan_id: `cp-${fId}`,
            remaining_m3: harvestVol,
          };
        } else if (choice === 3 && farmersWithQuota.length > 0) {
          // rain.replanned
          const byFarmer: Record<string, number> = {};
          let totalSaved = 0;
          for (const fId of farmersWithQuota) {
            if (prng() > 0.5) {
              const currentQuota = bal.farmers[fId]!.quota;
              const saved = Math.floor(prng() * currentQuota * 0.25) + 1;
              byFarmer[fId] = saved;
              totalSaved += saved;
            }
          }
          if (totalSaved > 0) {
            event = {
              id: `run-${run}-step-${step}-rain`,
              at: `2026-09-${String(step % 28 + 1).padStart(2, "0")}T08:00:00Z`,
              canal_id: "c1",
              actor: { kind: "agent", id: "need" },
              type: "rain.replanned",
              saved_m3: totalSaved,
              by_farmer_m3: byFarmer,
            };
          }
        } else if (choice === 4 && bal.buffer > 20) {
          // request.decided (buffer)
          const fId = farmerIds[Math.floor(prng() * farmerIds.length)]!;
          const bufVol = Math.floor(prng() * Math.min(bal.buffer, 500)) + 1;

          event = {
            id: `run-${run}-step-${step}-bufgrant`,
            at: `2026-09-${String(step % 28 + 1).padStart(2, "0")}T08:00:00Z`,
            canal_id: "c1",
            actor: { kind: "coordinator", id: "coord" },
            type: "request.decided",
            request_id: `req-buf-${step}`,
            decision: "approve",
            volume_m3: bufVol,
            farmer_id: fId,
            request_type: "buffer",
            note: "buffer grant",
          };
        } else if (choice === 5 && farmersWithQuota.length > 0) {
          // request.decided (urgent)
          const fId = farmersWithQuota[Math.floor(prng() * farmersWithQuota.length)]!;
          const currentQuota = bal.farmers[fId]!.quota;
          const urgVol = Math.floor(prng() * currentQuota * 0.4) + 1;

          event = {
            id: `run-${run}-step-${step}-urg`,
            at: `2026-09-${String(step % 28 + 1).padStart(2, "0")}T08:00:00Z`,
            canal_id: "c1",
            actor: { kind: "coordinator", id: "coord" },
            type: "request.decided",
            request_id: `req-urg-${step}`,
            decision: "approve",
            volume_m3: urgVol,
            farmer_id: fId,
            request_type: "urgent",
            note: "urgent quota advance",
          };
        }

        if (event) {
          const newEntries = ledger.entriesFor(event);
          allEntries = allEntries.concat(newEntries);

          // Conservation invariant must hold at EVERY intermediate event step
          const stepCheck = ledger.checkConservation(allEntries, seasonSupply);
          expect(stepCheck.ok).toBe(true);
          expect(stepCheck.diff_m3).toBeLessThan(0.001);
        }
      }

      // Final conservation check for the run
      const finalCheck = ledger.checkConservation(allEntries, seasonSupply);
      expect(finalCheck.ok).toBe(true);
      expect(finalCheck.diff_m3).toBeLessThan(0.001);
    }
  });
});

