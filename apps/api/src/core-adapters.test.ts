/**
 * Tests for the api-local core adapters.
 *
 * The duplicate core (`src/core/`) and its tests were deleted in the Task 2 swap; these two adapters
 * carry behaviour the controller pinned as binding, so they get direct coverage here:
 *
 *  * `entriesForDecision` — urgent approve books `quota → delivered`; buffer approve books
 *    `buffer → delivered`; reject / `release_to_buffer` / `harvest_exit` move no water.
 *  * `cropParamsFor` — rice resolves to the core's `flooded` row by default and the `intermittent`
 *    row when the plan declares that practice; other crops select their core row.
 *
 * The numbers asserted are the core's (`packages/core/src/data/crop-params.json`), never a second
 * table typed here: the expectations are the authority values, which is what makes a drift visible.
 */

import type { CropPlan, JadalEvent } from "@jadal/contracts";
import { describe, expect, it } from "vitest";

import { cropParamsFor, entriesForDecision } from "./core-adapters";

type DecidedEvent = Extract<JadalEvent, { type: "request.decided" }>;

function decided(overrides: Partial<DecidedEvent> = {}): DecidedEvent {
  return {
    id: "evt_decide",
    at: "2026-09-14T06:00:00.000Z",
    canal_id: "c1",
    actor: { kind: "coordinator", id: "coord" },
    type: "request.decided",
    request_id: "req_1",
    decision: "approve",
    volume_m3: 120,
    ...overrides,
  };
}

function plan(crop: CropPlan["crop"], rice_practice?: CropPlan["rice_practice"]): CropPlan {
  return {
    id: `cp_${crop}`,
    plot_id: "p1",
    crop,
    sowing_date: "2026-08-01",
    area_fraction: 1,
    application_efficiency: 0.8,
    ...(rice_practice === undefined ? {} : { rice_practice }),
    status: "active",
  };
}

describe("entriesForDecision", () => {
  it("books an urgent approval as farmer quota → farmer delivered", () => {
    expect(entriesForDecision({ event: decided(), farmer_id: "f1", request_type: "urgent" })).toEqual([
      {
        id: "evt_decide:e1",
        at: "2026-09-14T06:00:00.000Z",
        from: "farmer:f1:quota",
        to: "farmer:f1:delivered",
        volume_m3: 120,
        reason: "urgent request req_1 approved from future quota",
        event_id: "evt_decide",
      },
    ]);
  });

  it("books a buffer approval from the common buffer", () => {
    expect(
      entriesForDecision({
        event: decided({ volume_m3: 8.5 }),
        farmer_id: "f2",
        request_type: "buffer",
      }),
    ).toEqual([
      {
        id: "evt_decide:e1",
        at: "2026-09-14T06:00:00.000Z",
        from: "buffer",
        to: "farmer:f2:delivered",
        volume_m3: 8.5,
        reason: "buffer request req_1 approved from buffer",
        event_id: "evt_decide",
      },
    ]);
  });

  it.each(["release_to_buffer", "harvest_exit"] as const)(
    "a %s approval moves no water (its own event already booked it)",
    (request_type) => {
      expect(entriesForDecision({ event: decided(), farmer_id: "f1", request_type })).toEqual([]);
    },
  );

  it("moves nothing for a rejection or a non-positive volume", () => {
    expect(
      entriesForDecision({ event: decided({ decision: "reject" }), farmer_id: "f1", request_type: "urgent" }),
    ).toEqual([]);
    expect(
      entriesForDecision({ event: decided({ volume_m3: 0 }), farmer_id: "f1", request_type: "urgent" }),
    ).toEqual([]);
  });
});

describe("cropParamsFor", () => {
  it("selects the core's flooded row for rice by default and the intermittent row when declared", () => {
    const flooded = cropParamsFor(plan("rice"));
    expect(flooded.variant).toBe("flooded");
    expect(flooded.kc_ini).toBe(1.05);
    expect(flooded.kc_end).toBe(1.05);
    expect(flooded.percolation_mm_day).toBe(3.5);

    const intermittent = cropParamsFor(plan("rice", "intermittent"));
    expect(intermittent.variant).toBe("intermittent");
    expect(intermittent.kc_ini).toBe(0.95);
    expect(intermittent.kc_end).toBe(1.0);
    expect(intermittent.percolation_mm_day).toBe(2.0);
  });

  it("selects the core's row by crop name and returns stable parameters", () => {
    const maize = cropParamsFor(plan("maize"));
    expect(maize.crop).toBe("maize");
    expect(maize.kc_end).toBe(0.3);
    expect(maize.stage_days).toEqual({ ini: 20, dev: 35, mid: 40, late: 30 });
    expect(cropParamsFor(plan("maize"))).toBe(maize);
  });
});
