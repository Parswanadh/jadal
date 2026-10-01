/**
 * Ledger tests. The event fixtures are the demo scenario's own numbers
 * (`packages/contracts/fixtures/demo-scenario.json`: farmers f1…f8, season supply 180 000 m³, one
 * 20 000 m³ entitlement each) and every one of them is parsed by the `JadalEvent` schema before use,
 * so a fixture that drifts from the contract fails here rather than quietly testing a fiction.
 *
 * Coverage is table-driven over *every* member of the `JadalEvent` union, water-moving or not.
 */

import { describe, expect, it } from "vitest";

import type { JadalEvent, LedgerEntry } from "@jadal/contracts";
import { Contact, Entitlement, JadalEvent as JadalEventSchema, LedgerEntry as LedgerEntrySchema, WaterRequest } from "@jadal/contracts";

import { entriesFor, entriesForDecision, ledger, type DecisionAttribution } from "./ledger";

const AT = "2026-09-15T00:30:00.000Z";
const ACTOR = { kind: "coordinator", id: "coord-1" } as const;

/** One 20 000 m³ weekly entitlement, as `season.approved` would carry it. */
const entitlement = (farmer_id: string, week_start = "2026-09-14", volume_m3 = 20_000) =>
  Entitlement.parse({
    id: `ent_${farmer_id}_w36`,
    farmer_id,
    crop_plan_id: `cp_${farmer_id}`,
    week_start,
    volume_m3,
    net_irrigation_mm: volume_m3 / 10,
    status: "approved",
  });

const request = WaterRequest.parse({
  id: "req_f1_1",
  farmer_id: "f1",
  crop_plan_id: "cp_f1",
  type: "urgent",
  volume_m3: 200,
  reason: "paddy at flowering",
  channel: "voice",
  status: "recommended",
  raised_at: "2026-09-14T06:00:00.000Z",
  triage_score: 0.82,
});

const contact = Contact.parse({
  id: "cnt_1",
  farmer_id: "f1",
  channel: "voice",
  purpose: "roster_change",
  status: "delivered",
  attempt: 1,
  message_te: "మీరు ఆ రోజు ఉదయం 6 గంటలకు వెళ్లారు.",
  message_en: "You are scheduled at 6am.",
  at: AT,
});

/** Eight farmers, 20 000 m³ each, inside the fixture's 180 000 m³ season supply. */
const season = (): JadalEvent =>
  JadalEventSchema.parse({
    id: "evt_season",
    at: AT,
    canal_id: "c1",
    actor: ACTOR,
    type: "season.approved",
    season_supply_m3: 180_000,
    entitlements: ["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"].map((id) => entitlement(id)),
  });

/** The eight demo farmers, one 20 000 m³ weekly entitlement each. */
const FARMERS = ["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"] as const;

/** A coordinator's answer to `req_f1_1`. The id is a parameter so two grants can be told apart. */
const decided = (
  decision: "approve" | "reject",
  volume_m3: number,
  id = "evt_decided",
): DecisionAttribution["event"] =>
  JadalEventSchema.parse({
    id,
    at: AT,
    canal_id: "c1",
    actor: ACTOR,
    type: "request.decided",
    request_id: request.id,
    decision,
    volume_m3,
    note: "coordinator note",
  }) as DecisionAttribution["event"];

/** `[farmer, outlet, volume]` for a turn, as a `turn.delivered` event would report it. */
const TURN_DELIVERED: JadalEvent = {
  id: "evt_turn",
  at: AT,
  canal_id: "c1",
  actor: { kind: "farmer", id: "f1" },
  type: "turn.delivered",
  turn_id: "r1:t1",
  farmer_id: "f1",
  delivered_m3: 1300,
  conveyance_loss_m3: 60,
  overrun_h: 0,
};

/** `[from, to, volume]` for a water-moving event, in the order `entriesFor` must emit them. */
type Movement = [from: string, to: string, volume_m3: number];

interface Case {
  name: string;
  event: JadalEvent;
  /** `null` means the event moves no water at all. */
  movements: Movement[] | null;
}

/** 180 000 m³ of supply, 160 000 m³ of it allocated and 20 000 m³ still in the buffer. */
const SEASON_MOVEMENTS: Movement[] = [
  ...FARMERS.map((id): Movement => ["canal_supply", `farmer:${id}:quota`, 20_000]),
  ["canal_supply", "buffer", 20_000],
];

/** Every member of the `JadalEvent` union, water or not. Keep this list exhaustive. */
const CASES: Case[] = [
  {
    name: "farmer.registered",
    event: {
      id: "evt_farmer",
      at: AT,
      canal_id: "c1",
      actor: { kind: "farmer", id: "f9" },
      type: "farmer.registered",
      farmer: { id: "f9", name: "Test", phone: "+919000000009", language: "te", preferred_channels: ["voice"], has_smartphone: false },
      plots: [],
      crop_plans: [],
    },
    movements: null,
  },
  { name: "registration.verified", event: { id: "evt_verified", at: AT, canal_id: "c1", actor: ACTOR, type: "registration.verified", farmer_id: "f9" }, movements: null },
  { name: "season.approved", event: season(), movements: SEASON_MOVEMENTS },
  {
    name: "entitlement.proposed",
    event: { id: "evt_prop", at: AT, canal_id: "c1", actor: { kind: "agent", id: "need-1" }, type: "entitlement.proposed", entitlements: [entitlement("f1", "2026-09-14", 1500)] },
    movements: null,
  },
  { name: "entitlement.approved", event: { id: "evt_entapp", at: AT, canal_id: "c1", actor: ACTOR, type: "entitlement.approved", entitlement_ids: ["ent_f1_w36"] }, movements: null },
  {
    name: "release_window.announced",
    event: {
      id: "evt_window",
      at: AT,
      canal_id: "c1",
      actor: ACTOR,
      type: "release_window.announced",
      window: { id: "rw1", canal_id: "c1", start: AT, end: "2026-09-16T00:30:00.000Z", discharge_m3s: 0.15 },
    },
    movements: null,
  },
  {
    name: "roster.proposed",
    event: {
      id: "evt_roster",
      at: AT,
      canal_id: "c1",
      actor: { kind: "agent", id: "sched-1" },
      type: "roster.proposed",
      roster: { id: "r1", canal_id: "c1", release_window_id: "rw1", status: "proposed", turns: [], shortfall_m3: {} },
    },
    movements: null,
  },
  { name: "roster.approved", event: { id: "evt_rosterok", at: AT, canal_id: "c1", actor: ACTOR, type: "roster.approved", roster_id: "r1" }, movements: null },
  {
    name: "turn.delivered",
    event: TURN_DELIVERED,
    movements: [
      ["farmer:f1:quota", "farmer:f1:delivered", 1300],
      ["farmer:f1:quota", "losses:conveyance", 60],
    ],
  },
  { name: "request.raised", event: { id: "evt_raised", at: AT, canal_id: "c1", actor: { kind: "farmer", id: "f1" }, type: "request.raised", request }, movements: null },
  { name: "request.triaged", event: { id: "evt_triaged", at: AT, canal_id: "c1", actor: { kind: "system", id: "s1" }, type: "request.triaged", request_id: "req_f1_1", triage_score: 0.82, intent: "urgent extra water for flowering paddy" }, movements: null },
  {
    name: "request.recommended",
    event: {
      id: "evt_rec",
      at: AT,
      canal_id: "c1",
      actor: { kind: "agent", id: "assessor-1" },
      type: "request.recommended",
      request_id: "req_f1_1",
      recommendation: { decision: "partial", volume_m3: 200, rationale: "flowering stage, partial grant keeps the buffer intact" },
    },
    movements: null,
  },
  // SCHEMA NOTE: no farmer and no request type on the event, so nothing can be written. See
  // `entriesForDecision` below, which is what `db/repo.ts` must call.
  { name: "request.decided", event: decided("approve", 200), movements: null },
  {
    name: "week.released_to_buffer",
    event: { id: "evt_week", at: AT, canal_id: "c1", actor: { kind: "farmer", id: "f2" }, type: "week.released_to_buffer", farmer_id: "f2", week_start: "2026-09-14", volume_m3: 500 },
    movements: [["farmer:f2:quota", "buffer", 500]],
  },
  {
    name: "crop.harvested",
    event: { id: "evt_harvest", at: AT, canal_id: "c1", actor: { kind: "farmer", id: "f3" }, type: "crop.harvested", farmer_id: "f3", crop_plan_id: "cp_f3", remaining_m3: 1200 },
    movements: [["farmer:f3:quota", "buffer", 1200]],
  },
  {
    name: "rain.replanned",
    event: {
      id: "evt_rain",
      at: AT,
      canal_id: "c1",
      actor: { kind: "agent", id: "need-1" },
      type: "rain.replanned",
      saved_m3: 300,
      by_farmer_m3: { f5: 100, f4: 200 },
    },
    // Sorted by farmer, not by the order the saving happens to be written in the payload.
    movements: [
      ["farmer:f4:quota", "buffer", 200],
      ["farmer:f5:quota", "buffer", 100],
    ],
  },
  { name: "contact.updated", event: { id: "evt_contact", at: AT, canal_id: "c1", actor: { kind: "agent", id: "caller-1" }, type: "contact.updated", contact }, movements: null },
];

/** Look up a fixture event by type, failing loudly rather than silently testing a substitute. */
function eventOf(type: string): JadalEvent {
  const found = CASES.find((c) => c.event.type === type);
  if (!found) throw new Error(`no fixture event of type ${type}`);
  return found.event;
}

describe("ledger.entriesFor", () => {
  it("covers every member of the event union", () => {
    expect(CASES).toHaveLength(17);
    expect(new Set(CASES.map((c) => c.event.type)).size).toBe(CASES.length);
  });

  it.each(CASES)("$name moves exactly the water the architecture table says", ({ event, movements }) => {
    const entries = entriesFor(event);
    if (movements === null) {
      expect(entries).toEqual([]);
      return;
    }
    expect(entries.map((entry) => [entry.from, entry.to, entry.volume_m3])).toEqual(movements);
  });

  it.each(CASES)("$name produces entries the database would accept", ({ event }) => {
    for (const [index, entry] of entriesFor(event).entries()) {
      expect(LedgerEntrySchema.safeParse(entry).success).toBe(true);
      // Dense, stable ids: `${event.id}:e1`, `${event.id}:e2`, … over the *emitted* entries.
      expect(entry.id).toBe(`${event.id}:e${index + 1}`);
      expect(entry.at).toBe(event.at);
      expect(entry.event_id).toBe(event.id);
      // Both CHECK constraints from apps/api/migrations/0002_jadal.sql.
      expect(entry.volume_m3).toBeGreaterThan(0);
      expect(Number.isFinite(entry.volume_m3)).toBe(true);
      expect(entry.from).not.toBe(entry.to);
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });

  it("is pure: the same event always yields the same entries", () => {
    for (const { event } of CASES) {
      expect(entriesFor(event)).toEqual(entriesFor(event));
    }
  });

  it("writes a quota per entitlement and the unallocated remainder to the buffer", () => {
    const entries = entriesFor(season());
    expect(entries.map((entry) => [entry.from, entry.to, entry.volume_m3])).toEqual(SEASON_MOVEMENTS);
    const quota = entries.filter((entry) => entry.to.startsWith("farmer:")).reduce((sum, e) => sum + e.volume_m3, 0);
    const buffer = entries.filter((entry) => entry.to === "buffer").reduce((sum, e) => sum + e.volume_m3, 0);
    expect(quota + buffer).toBe(180_000);
  });

  it("omits zero-volume movements and keeps the remaining ids dense", () => {
    const event = JadalEventSchema.parse({
      id: "evt_season_partial",
      at: AT,
      canal_id: "c1",
      actor: ACTOR,
      type: "season.approved",
      season_supply_m3: 1000,
      entitlements: [entitlement("f1", "2026-09-14", 0), entitlement("f2", "2026-09-14", 1000)],
    });
    const entries = entriesFor(event);
    // The 0 m³ entitlement is gone (CHECK volume_m3 > 0), and with it the buffer remainder; the
    // surviving entry is still `e1` so the id a caller has already seen does not move.
    expect(entries.map((entry) => [entry.id, entry.from, entry.to, entry.volume_m3])).toEqual([
      ["evt_season_partial:e1", "canal_supply", "farmer:f2:quota", 1000],
    ]);
  });

  it("splits a delivered turn into the water that arrived and the water seepage ate", () => {
    const entries = entriesFor(TURN_DELIVERED);
    expect(entries.map((entry) => [entry.from, entry.to, entry.volume_m3])).toEqual([
      ["farmer:f1:quota", "farmer:f1:delivered", 1300],
      ["farmer:f1:quota", "losses:conveyance", 60],
    ]);
    // The quota is charged for the field-gate volume, loss included: 1360 m³ left the quota.
    expect(entries.reduce((sum, entry) => sum + entry.volume_m3, 0)).toBe(1360);

    const noLoss = { ...TURN_DELIVERED, conveyance_loss_m3: 0 };
    expect(entriesFor(noLoss).map((entry) => entry.id)).toEqual(["evt_turn:e1"]);
  });

  it("writes nothing for a rejected decision and nothing for an event that moves no water", () => {
    expect(entriesFor(decided("reject", 200))).toEqual([]);
    expect(entriesFor(decided("approve", 0))).toEqual([]);
  });
});

describe("entriesForDecision", () => {
  it("borrows an urgent grant from the farmer's own quota", () => {
    const entries = entriesForDecision({ event: decided("approve", 200), farmer_id: "f1", request_type: "urgent" });
    expect(entries).toEqual([
      {
        id: "evt_decided:e1",
        at: AT,
        from: "farmer:f1:quota",
        to: "farmer:f1:delivered",
        volume_m3: 200,
        reason: "urgent request req_f1_1 approved from future quota",
        event_id: "evt_decided",
      },
    ]);
  });

  it("pays a buffer grant out of the community buffer", () => {
    const entries = entriesForDecision({ event: decided("approve", 150), farmer_id: "f2", request_type: "buffer" });
    expect(entries.map((entry) => [entry.from, entry.to, entry.volume_m3])).toEqual([["buffer", "farmer:f2:delivered", 150]]);
  });

  it("moves nothing for a rejection, an empty grant, or the types that other events already book", () => {
    const rejected = decided("reject", 200);
    expect(entriesForDecision({ event: rejected, farmer_id: "f1", request_type: "urgent" })).toEqual([]);
    expect(entriesForDecision({ event: decided("approve", 0), farmer_id: "f1", request_type: "urgent" })).toEqual([]);
    for (const request_type of ["release_to_buffer", "harvest_exit"] as const) {
      expect(entriesForDecision({ event: decided("approve", 200), farmer_id: "f1", request_type })).toEqual([]);
    }
  });
});

describe("ledger.balances", () => {
  it("nets every account across from and to", () => {
    const entries: LedgerEntry[] = [
      ...entriesFor(season()),
      ...entriesFor(TURN_DELIVERED),
      ...entriesFor(eventOf("week.released_to_buffer")),
    ];
    const balances = ledger.balances(entries);
    expect(balances.canal_supply).toBe(-180_000);
    expect(balances.buffer).toBe(20_500);
    expect(balances.conveyance_losses).toBe(60);
    expect(balances.farmers.f1).toEqual({ quota: 18_640, delivered: 1300 });
    expect(balances.farmers.f2).toEqual({ quota: 19_500, delivered: 0 });
    expect(balances.farmers.f8).toEqual({ quota: 20_000, delivered: 0 });
  });

  it("is empty for an empty log", () => {
    expect(ledger.balances([])).toEqual({ canal_supply: 0, buffer: 0, conveyance_losses: 0, farmers: {} });
  });

  it("refuses to net an account outside the LedgerAccount union", () => {
    const bogus: LedgerEntry = {
      id: "evt_bogus:e1",
      at: AT,
      from: "canal_supply",
      to: "farmer:f1:mystery",
      volume_m3: 10,
      reason: "hand-written",
      event_id: "evt_bogus",
    };
    expect(() => ledger.balances([bogus])).toThrow(RangeError);
  });
});

describe("ledger.checkConservation", () => {
  /** A full season's worth of water, moved every way the system knows how. */
  const wholeLog = (): LedgerEntry[] => [
    ...entriesFor(season()),
    ...entriesFor(TURN_DELIVERED),
    ...entriesFor(eventOf("week.released_to_buffer")),
    ...entriesFor(eventOf("crop.harvested")),
    ...entriesFor(eventOf("rain.replanned")),
    ...entriesForDecision({ event: decided("approve", 200, "evt_urgent"), farmer_id: "f1", request_type: "urgent" }),
    ...entriesForDecision({ event: decided("approve", 150, "evt_buffer"), farmer_id: "f2", request_type: "buffer" }),
  ];

  it("holds after a full round trip of deliveries, releases, harvests, rain and grants", () => {
    const entries = wholeLog();
    const balances = ledger.balances(entries);
    // The auditor's arithmetic, spelled out: supply = Σ quotas + buffer + Σ delivered + losses.
    const accounted =
      Object.values(balances.farmers).reduce((sum, farmer) => sum + farmer.quota + farmer.delivered, 0) +
      balances.buffer +
      balances.conveyance_losses;
    expect(accounted).toBe(180_000);
    const result = ledger.checkConservation(entries, 180_000);
    expect(result).toEqual({ ok: true, diff_m3: 0 });
  });

  it("fails when the season supply on record disagrees with the log", () => {
    const result = ledger.checkConservation(wholeLog(), 181_000);
    expect(result).toEqual({ ok: false, diff_m3: 1000 });
    // The tolerance is the only slack: 0.4 m³ off is dust, 2 m³ off is a lost or duplicated event.
    expect(ledger.checkConservation(wholeLog(), 180_000.4, 0.5).ok).toBe(true);
    expect(ledger.checkConservation(wholeLog(), 180_002, 0.5).ok).toBe(false);
  });

  it("cannot see a missing delivery — that is the auditor's other check, and this is why", () => {
    // Dropping a movement removes it from both sides of the invariant, so conservation still holds…
    const withoutGrant = wholeLog().filter((entry) => entry.id !== "evt_urgent:e1");
    expect(ledger.checkConservation(withoutGrant, 180_000).ok).toBe(true);
    // … which is exactly why the fairness check has to compare the roster's planned volume with the
    // ledger's delivered volume instead of trusting this one.
    const withGrant = ledger.balances(wholeLog()).farmers.f1;
    const without = ledger.balances(withoutGrant).farmers.f1;
    expect(withGrant).toEqual({ quota: 18_440, delivered: 1500 });
    expect(without).toEqual({ quota: 18_640, delivered: 1300 });
  });

  it("treats an over-allocated season as a violation rather than hiding it", () => {
    const over = JadalEventSchema.parse({
      id: "evt_over",
      at: AT,
      canal_id: "c1",
      actor: ACTOR,
      type: "season.approved",
      season_supply_m3: 1000,
      entitlements: [entitlement("f1", "2026-09-14", 2000)],
    });
    // No negative remainder entry is invented; the 1000 m³ the coordinator invented shows up as a gap.
    expect(entriesFor(over).map((entry) => [entry.from, entry.to, entry.volume_m3])).toEqual([
      ["canal_supply", "farmer:f1:quota", 2000],
    ]);
    expect(ledger.checkConservation(entriesFor(over), 1000)).toEqual({ ok: false, diff_m3: -1000 });
  });
});

describe("ledger.gini", () => {
  it("matches the hand-computed values", () => {
    // G = (2·Σ(i·x_i))/(n·Σx) − (n+1)/n over the ascending values, i from 1.
    expect(ledger.gini([0, 0, 0, 1])).toBe(0.75);
    expect(ledger.gini([0, 0, 1, 1])).toBe(0.5);
    expect(ledger.gini([0, 0, 0, 0, 1])).toBeCloseTo(0.8, 6);
  });

  it("is 0 for a distribution with nothing to be unfair about", () => {
    expect(ledger.gini([])).toBe(0);
    expect(ledger.gini([42])).toBe(0);
    expect(ledger.gini([50, 50, 50, 50])).toBe(0);
    expect(ledger.gini([0, 0, 0, 0])).toBe(0);
  });

  it("is 0 when a value is negative or not a number, rather than reporting a meaningless figure", () => {
    expect(ledger.gini([-5, 5])).toBe(0);
    expect(ledger.gini([0, Number.NaN, 1])).toBe(0);
    expect(ledger.gini([0, Number.POSITIVE_INFINITY, 1])).toBe(0);
  });

  it("does not care about the order it is given, and never leaves [0, 1]", () => {
    expect(ledger.gini([1, 0, 0, 0])).toBe(ledger.gini([0, 0, 0, 1]));
    for (const values of [[1, 1, 1, 1.0000001], [0, 1], [0.5, 0.5, 0.5, 0.5, 0.5]]) {
      const g = ledger.gini(values);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
    }
  });

  it("separates the two roster modes: equal water is fair, equal hours is not", () => {
    // Need met on the demo fixture: equal water 100% for everyone, equal hours leaves the tail short.
    expect(ledger.gini([100, 100, 100, 100, 100, 100, 100, 100])).toBe(0);
    const equalHours = ledger.gini([119.16, 114.26, 109.56, 104.42, 99.53, 94.87, 90.96, 87.22]);
    expect(equalHours).toBeGreaterThan(0.02);
    expect(equalHours).toBeLessThan(0.06);
  });
});
