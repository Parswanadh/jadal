/**
 * Core-shim ledger facade tests.
 *
 * The shim wraps `@jadal/core`'s `entriesFor` so a `request.decided` event carries no entries — the
 * API books decision movements from the request row via `entriesForDecision` (`core-shim.ts` has the
 * full rationale). These tests pin both halves of that seam: `ledger.entriesFor` cannot bypass the
 * guard, and the facade still forwards `checkConservation`, whose implementation reads `this.balances`.
 */

import type { JadalEvent } from "@jadal/contracts";
import { describe, expect, it } from "vitest";

import { entriesFor, ledger } from "./core-shim";

const AT = "2026-09-14T06:00:00.000Z";

function decided(): Extract<JadalEvent, { type: "request.decided" }> {
  return {
    id: "evt_decided",
    at: AT,
    canal_id: "c1",
    actor: { kind: "coordinator", id: "coord" },
    type: "request.decided",
    request_id: "req_1",
    decision: "approve",
    volume_m3: 120,
  };
}

function season(): Extract<JadalEvent, { type: "season.approved" }> {
  return {
    id: "evt_season",
    at: AT,
    canal_id: "c1",
    actor: { kind: "coordinator", id: "coord" },
    type: "season.approved",
    season_supply_m3: 1000,
    entitlements: [
      {
        id: "ent_1",
        farmer_id: "f1",
        crop_plan_id: "cp1",
        week_start: "2026-09-14",
        volume_m3: 600,
        net_irrigation_mm: 60,
        status: "approved",
      },
    ],
  };
}

describe("core-shim ledger facade", () => {
  it("ledger.entriesFor cannot bypass the request.decided guard", () => {
    expect(ledger.entriesFor(decided())).toEqual([]);
    expect(entriesFor(decided())).toEqual([]);
  });

  it("still delegates every other event to the core unchanged", () => {
    const seasonEvent = season();
    expect(ledger.entriesFor(seasonEvent)).toEqual(entriesFor(seasonEvent));
    expect(ledger.entriesFor(seasonEvent)).toHaveLength(2);
  });

  it("checkConservation still resolves balances through the facade", () => {
    const entries = ledger.entriesFor(season());
    // 600 m³ quota + 400 m³ buffer = the declared 1000 m³ supply.
    expect(ledger.checkConservation(entries, 1000)).toEqual({ ok: true, diff_m3: 0 });
  });
});
