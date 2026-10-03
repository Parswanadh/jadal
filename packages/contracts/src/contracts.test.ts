/**
 * Contract schema tests.
 *
 * The schemas in `entities.ts` are the integration agreement: every API response, event payload and
 * projection row is parsed through them. These tests pin the two things that matter to callers —
 * a well-formed entity parses unchanged, and a malformed one is rejected — for the entities that
 * cross a module boundary. They also cover the primitive aliases (`Id`, `IsoTime`, `IsoDate`) and the
 * `LedgerAccount` union, since a loosened primitive would silently widen every entity.
 */

import { describe, expect, it } from "vitest";

import {
  Canal,
  Contact,
  CropPlan,
  Entitlement,
  Farmer,
  Id,
  IsoDate,
  IsoTime,
  LedgerAccount,
  LedgerEntry,
  Outlet,
  Plot,
  ReleaseWindow,
  Roster,
  Turn,
  WaterRequest,
  WeatherDay,
} from "./entities";

/* ------------------------------------------------------------------ valid entities */

describe("entity schemas accept well-formed values", () => {
  it("parses a canal and an outlet", () => {
    const canal = {
      id: "c1",
      name: "Main canal",
      length_m: 4200,
      head_discharge_m3s: 0.15,
      seepage_k_per_m: 0.00012,
      manning_n: 0.03,
      bed_slope: 0.0002,
      hydraulic_radius_m: 0.8,
      lined: false,
    };
    expect(Canal.parse(canal)).toEqual(canal);
    expect(Outlet.parse({ id: "o1", canal_id: "c1", name: "Outlet 1", chainage_m: 120 })).toBeTruthy();
  });

  it("parses a farmer, plot and crop plan", () => {
    const farmer = {
      id: "f1",
      name: "Ravi",
      phone: "+919999999999",
      language: "te",
      preferred_channels: ["voice"],
      has_smartphone: true,
    };
    expect(Farmer.parse(farmer)).toEqual(farmer);

    const plot = { id: "p1", farmer_id: "f1", outlet_id: "o1", area_ha: 1.5, soil: "clay_loam", lat: 16.3, lon: 80.4 };
    expect(Plot.parse(plot)).toEqual(plot);

    const plan = {
      id: "cp1",
      plot_id: "p1",
      crop: "rice",
      sowing_date: "2026-07-01",
      area_fraction: 0.6,
      application_efficiency: 0.65,
      status: "active",
    };
    expect(CropPlan.parse(plan)).toEqual(plan);
    expect(CropPlan.parse({ ...plan, rice_practice: "intermittent" }).rice_practice).toBe("intermittent");
  });

  it("parses an entitlement, release window, turn and roster", () => {
    const entitlement = {
      id: "e1",
      farmer_id: "f1",
      crop_plan_id: "cp1",
      week_start: "2026-09-14",
      volume_m3: 120,
      net_irrigation_mm: 8,
      status: "approved",
    };
    expect(Entitlement.parse(entitlement)).toEqual(entitlement);

    const window = {
      id: "rw1",
      canal_id: "c1",
      start: "2026-09-14T06:00:00Z",
      end: "2026-09-14T18:00:00Z",
      discharge_m3s: 0.15,
    };
    expect(ReleaseWindow.parse(window)).toEqual(window);

    const turn = {
      id: "t1",
      roster_id: "r1",
      outlet_id: "o1",
      farmer_id: "f1",
      start: "2026-09-14T06:00:00Z",
      end: "2026-09-14T07:00:00Z",
      planned_volume_m3: 100,
      expected_flow_m3s: 0.05,
      lag_h: 0.5,
    };
    expect(Turn.parse(turn)).toEqual(turn);
    expect(Roster.parse({ id: "r1", canal_id: "c1", release_window_id: "rw1", status: "proposed", turns: [turn], shortfall_m3: {} })).toBeTruthy();
  });

  it("parses a water request, ledger entry, contact and weather day", () => {
    const request = {
      id: "req1",
      farmer_id: "f1",
      type: "urgent",
      volume_m3: 100,
      reason: "paddy yellowing",
      channel: "voice",
      status: "raised",
      raised_at: "2026-09-14T06:00:00Z",
    };
    expect(WaterRequest.parse(request)).toEqual(request);
    expect(
      WaterRequest.parse({
        ...request,
        triage_score: 0.8,
        agent_recommendation: { decision: "partial", volume_m3: 50, rationale: "policy cap" },
        coordinator_decision: { decision: "approve", volume_m3: 50, at: "2026-09-14T07:00:00Z" },
      }).triage_score,
    ).toBe(0.8);

    const entry = {
      id: "evt1:e1",
      at: "2026-09-14T06:00:00Z",
      from: "canal_supply",
      to: "farmer:f1:quota",
      volume_m3: 100,
      reason: "entitlement approved",
      event_id: "evt1",
    };
    expect(LedgerEntry.parse(entry)).toEqual(entry);

    const contact = {
      id: "ctc1",
      farmer_id: "f1",
      channel: "voice",
      purpose: "request_update",
      status: "queued",
      attempt: 1,
      message_te: "జడల్",
      message_en: "Jadal",
      at: "2026-09-14T06:00:00Z",
    };
    expect(Contact.parse(contact)).toEqual(contact);

    expect(WeatherDay.parse({ date: "2026-09-14", et0_mm: 4.2, rain_mm: 0 })).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ malformed values */

describe("entity schemas reject malformed values", () => {
  it("rejects a farmer with no preferred channel", () => {
    expect(() =>
      Farmer.parse({ id: "f1", name: "Ravi", phone: "+91", language: "te", preferred_channels: [], has_smartphone: false }),
    ).toThrow();
  });

  it("rejects an unknown crop or soil type", () => {
    expect(() =>
      CropPlan.parse({
        id: "cp1",
        plot_id: "p1",
        crop: "banana",
        sowing_date: "2026-07-01",
        area_fraction: 0.5,
        application_efficiency: 0.65,
        status: "active",
      }),
    ).toThrow();
    expect(() =>
      Plot.parse({ id: "p1", farmer_id: "f1", outlet_id: "o1", area_ha: 1, soil: "moon_dust", lat: 0, lon: 0 }),
    ).toThrow();
  });

  it("rejects out-of-range fractions and negative volumes", () => {
    expect(() =>
      CropPlan.parse({
        id: "cp1",
        plot_id: "p1",
        crop: "rice",
        sowing_date: "2026-07-01",
        area_fraction: 0,
        application_efficiency: 0.65,
        status: "active",
      }),
    ).toThrow();
    expect(() =>
      Entitlement.parse({
        id: "e1",
        farmer_id: "f1",
        crop_plan_id: "cp1",
        week_start: "2026-09-14",
        volume_m3: -1,
        net_irrigation_mm: 0,
        status: "approved",
      }),
    ).toThrow();
  });

  it("rejects an unknown request status and a non-positive ledger volume", () => {
    expect(() =>
      WaterRequest.parse({
        id: "req1",
        farmer_id: "f1",
        type: "urgent",
        volume_m3: 1,
        reason: "x",
        channel: "voice",
        status: "not_a_status",
        raised_at: "2026-09-14T06:00:00Z",
      }),
    ).toThrow();
    expect(() =>
      LedgerEntry.parse({
        id: "evt1:e1",
        at: "2026-09-14T06:00:00Z",
        from: "canal_supply",
        to: "buffer",
        volume_m3: 0,
        reason: "zero",
        event_id: "evt1",
      }),
    ).toThrow();
  });

  it("rejects a contact with a non-integer or non-positive attempt", () => {
    const base = {
      id: "ctc1",
      farmer_id: "f1",
      channel: "voice",
      purpose: "reminder",
      status: "queued",
      message_te: "జడల్",
      message_en: "Jadal",
      at: "2026-09-14T06:00:00Z",
    };
    expect(() => Contact.parse({ ...base, attempt: 0 })).toThrow();
    expect(() => Contact.parse({ ...base, attempt: 1.5 })).toThrow();
  });
});

/* ------------------------------------------------------------------ primitives */

describe("primitive aliases", () => {
  it("Id rejects the empty string and IsoTime/IsoDate reject loose formats", () => {
    expect(() => Id.parse("")).toThrow();
    expect(Id.parse("f1")).toBe("f1");
    expect(() => IsoTime.parse("2026-09-14")).toThrow();
    expect(IsoTime.parse("2026-09-14T06:00:00Z")).toBeTruthy();
    expect(() => IsoDate.parse("14-09-2026")).toThrow();
    expect(IsoDate.parse("2026-09-14")).toBe("2026-09-14");
  });

  it("LedgerAccount accepts the reserved accounts and farmer accounts only", () => {
    for (const account of ["canal_supply", "buffer", "losses:conveyance", "farmer:f1:quota", "farmer:f1:delivered"]) {
      expect(LedgerAccount.parse(account)).toBe(account);
    }
    for (const account of ["farmer:f1", "bank", "farmer::quota", "canal"]) {
      expect(() => LedgerAccount.parse(account)).toThrow();
    }
  });
});
