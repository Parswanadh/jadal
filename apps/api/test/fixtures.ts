/**
 * Scenario fixtures for the event-store and repository tests.
 *
 * The demo scenario in `packages/contracts/fixtures/demo-scenario.json` is the project's integration
 * seed: one canal, eight outlets, eight farmers, nine crop plans, two release windows, 180 000 m³ of
 * season supply. It is the *input*; these helpers turn it into *state* by driving `appendEvent`
 * through the same event sequence the app sees in production.
 *
 * Why seed through events rather than by writing projection tables directly:
 *
 *  * It is the only path the app is allowed to take (B-SPEC: "All state changes go through
 *    `appendEvent()`"), so seeding any other way would produce state the app cannot itself create.
 *  * It exercises the reducers. A fixture written as raw `INSERT`s would pass even if
 *    `projections.ts` had a bug.
 *  * It exercises the ledger. `season.approved` writes quota and buffer entries in the same batch, so
 *    the seeded state is conserved by construction rather than by assertion.
 *
 * `canal` and `outlet` are the two forced exceptions, marked as such at their insert site: no event
 * type projects them, so there is no event that could create them.
 */

import { readFileSync } from "node:fs";

import {
  Canal,
  Contact,
  CropPlan,
  Farmer,
  Outlet,
  Plot,
  ReleaseWindow,
  WaterRequest,
} from "@jadal/contracts/entities";
import type { CropParams } from "@jadal/contracts/entities";
import type { JadalEvent } from "@jadal/contracts/events";

import { cropParamsFor } from "../src/core/crop-params";
import { cropEngine } from "../src/core/crop-engine";
import { hydraulics } from "../src/core/hydraulics";
import { round } from "../src/core/units";
import { now } from "../src/db/clock";
import { deterministicId } from "../src/db/id";
import { applySchema } from "../src/db/schema.sql";
import { appendEvent, type DbEnv } from "../src/db/store";
import { createTestDb, type ShimDatabase } from "./harness";

// ---------------------------------------------------------------------------
// Fixture types
// ---------------------------------------------------------------------------

/** The shape of `packages/contracts/fixtures/demo-scenario.json`, minus its documentation keys. */
export interface DemoScenario {
  /** Scenario start time, as written in the fixture (an IST offset instant). */
  readonly now: string;
  readonly canal: Canal;
  readonly outlets: Outlet[];
  readonly farmers: Farmer[];
  readonly plots: Plot[];
  readonly crop_plans: CropPlan[];
  readonly release_windows: ReleaseWindow[];
  readonly season_supply_m3: number;
  readonly demo_script: readonly { readonly step: number; readonly what: string }[];
}

/** The shape of `packages/contracts/fixtures/demo-weather.json`, minus its `_note`. */
export interface DemoWeather {
  readonly lat: number;
  readonly lon: number;
  readonly days: readonly { readonly date: string; readonly et0_mm: number; readonly rain_mm: number }[];
}

/** What `seedScenario` returns, so a test can assert against it instead of re-deriving it. */
export interface SeedResult {
  readonly scenario: DemoScenario;
  /** Ids of every event appended, in log order. */
  readonly event_ids: readonly string[];
  /** Farmer ids in registration order. */
  readonly farmer_ids: readonly string[];
  /** The week the seeded entitlements cover, as `YYYY-MM-DD`. */
  readonly week_start: string;
  /** Sum of the seeded entitlement volumes, m³. Equals the season's allocated quota. */
  readonly allocated_m3: number;
}

/** What `seedInteractions` appends: one request's full lifecycle plus one contact. */
export interface InteractionSeed {
  /** The raised request's id. */
  readonly request_id: string;
  /** The logged contact's id. */
  readonly contact_id: string;
  /** Ids of every event appended, in log order. */
  readonly event_ids: readonly string[];
}

// ---------------------------------------------------------------------------
// Loading the fixtures
// ---------------------------------------------------------------------------

// `apps/api/test/fixtures.ts` → `packages/contracts/fixtures/`. Three levels up from `test/` is the
// repo root, because the fixture is read from the monorepo rather than copied, so there is exactly one
// copy of the demo scenario in the repository.
const SCENARIO_URL = new URL("../../../packages/contracts/fixtures/demo-scenario.json", import.meta.url);
const WEATHER_URL = new URL("../../../packages/contracts/fixtures/demo-weather.json", import.meta.url);

/** The demo scenario, each entity validated through its contract schema. */
export function demoScenario(): DemoScenario {
  const raw = JSON.parse(readFileSync(SCENARIO_URL, "utf8")) as Record<string, unknown>;
  const script = raw["demo_script"];
  return {
    now: requireString(raw, "now"),
    canal: Canal.parse(raw["canal"]),
    outlets: parseEach(Outlet, raw["outlets"], "outlets"),
    farmers: parseEach(Farmer, raw["farmers"], "farmers"),
    plots: parseEach(Plot, raw["plots"], "plots"),
    crop_plans: parseEach(CropPlan, raw["crop_plans"], "crop_plans"),
    release_windows: parseEach(ReleaseWindow, raw["release_windows"], "release_windows"),
    season_supply_m3: Number(raw["season_supply_m3"]),
    demo_script: Array.isArray(script) ? (script as DemoScenario["demo_script"]) : [],
  };
}

/** The offline weather series the demo replays from. */
export function demoWeather(): DemoWeather {
  const raw = JSON.parse(readFileSync(WEATHER_URL, "utf8")) as Record<string, unknown>;
  const days = raw["days"];
  if (!Array.isArray(days)) throw new TypeError("demo-weather.json: days must be an array");
  return {
    lat: Number(raw["lat"]),
    lon: Number(raw["lon"]),
    days: days.map((day) => day as DemoWeather["days"][number]),
  };
}

function requireString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string") throw new TypeError(`demo-scenario.json: ${key} must be a string`);
  return value;
}

function parseEach<T>(schema: { parse(value: unknown): T }, value: unknown, key: string): T[] {
  if (!Array.isArray(value)) throw new TypeError(`demo-scenario.json: ${key} must be an array`);
  return value.map((entry) => schema.parse(entry));
}

// ---------------------------------------------------------------------------
// Event construction
// ---------------------------------------------------------------------------

/**
 * The scenario's `now`, as the UTC instant `IsoTime` requires.
 *
 * The fixture writes `2026-09-14T06:00:00+05:30`, which is 06:00 IST — deliberately *not* the
 * migration's clock seed, so a test can tell "the clock was pinned" from "the clock never moved".
 * `IsoTime` is `z.string().datetime()`, which rejects a bare offset, so the conversion happens here
 * rather than at every call site.
 */
function utcNow(scenario: DemoScenario): string {
  const parsed = new Date(scenario.now);
  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError(`demo scenario now is not a valid instant: ${JSON.stringify(scenario.now)}`);
  }
  return parsed.toISOString();
}

/** A Monday-aligned week start on or after the scenario's local date, so weekly need lines up with the engine. */
function weekStartFor(scenario: DemoScenario): string {
  const local = new Date(utcNow(scenario));
  // Monday-indexed: `getUTCDay()` is 0 for Sunday, so shift by 6 to make Monday 0.
  const sinceMonday = (local.getUTCDay() + 6) % 7;
  const monday = new Date(local.getTime() - sinceMonday * 86_400_000);
  return monday.toISOString().slice(0, 10);
}

function eventId(type: JadalEvent["type"], ...parts: readonly string[]): string {
  return deterministicId("evt", type, ...parts);
}

/** The seven `WeatherDay`s of `weekStart`, from the offline series. Empty when the fixture has no cover. */
function weekOf(weather: DemoWeather, weekStart: string): { date: string; et0_mm: number; rain_mm: number }[] {
  const byDate = new Map<string, { date: string; et0_mm: number; rain_mm: number }>();
  for (const day of weather.days) byDate.set(day.date, { ...day });
  const anchor = Date.parse(`${weekStart}T00:00:00Z`);
  const out: { date: string; et0_mm: number; rain_mm: number }[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const iso = new Date(anchor + offset * 86_400_000).toISOString().slice(0, 10);
    const day = byDate.get(iso);
    if (day !== undefined) out.push(day);
  }
  return out;
}

/**
 * One `farmer.registered` event per farmer, carrying that farmer's plots and crop plans.
 *
 * The event schema nests plots and crop plans under the farmer, which matches the real flow: a
 * registration *is* one submission of a person, their land and their intended cropping. Splitting it
 * into three events would need three event types that do not exist.
 */
function registrationEvents(scenario: DemoScenario, at: string): JadalEvent[] {
  const plotsByFarmer = new Map<string, Plot[]>();
  for (const plot of scenario.plots) {
    const bucket = plotsByFarmer.get(plot.farmer_id) ?? [];
    bucket.push(plot);
    plotsByFarmer.set(plot.farmer_id, bucket);
  }

  const plansByFarmer = new Map<string, CropPlan[]>();
  const farmerOfPlot = new Map<string, string>();
  for (const plot of scenario.plots) farmerOfPlot.set(plot.id, plot.farmer_id);
  for (const plan of scenario.crop_plans) {
    const farmer_id = farmerOfPlot.get(plan.plot_id);
    if (farmer_id === undefined) {
      throw new Error(`demo scenario: crop plan ${plan.id} references unknown plot ${plan.plot_id}`);
    }
    const bucket = plansByFarmer.get(farmer_id) ?? [];
    bucket.push(plan);
    plansByFarmer.set(farmer_id, bucket);
  }

  return scenario.farmers.map((farmer) => ({
    id: eventId("farmer.registered", farmer.id),
    at,
    canal_id: scenario.canal.id,
    actor: { kind: "farmer", id: farmer.id },
    type: "farmer.registered",
    farmer,
    plots: plotsByFarmer.get(farmer.id) ?? [],
    crop_plans: plansByFarmer.get(farmer.id) ?? [],
  }));
}

/** A `registration.verified` per farmer, so every seeded farmer reaches `verified = 1`. */
function verificationEvents(scenario: DemoScenario, at: string): JadalEvent[] {
  return scenario.farmers.map((farmer) => ({
    id: eventId("registration.verified", farmer.id),
    at,
    canal_id: scenario.canal.id,
    actor: { kind: "coordinator", id: "coord_demo" },
    type: "registration.verified" as const,
    farmer_id: farmer.id,
  }));
}

/**
 * The week's entitlements, one per verified crop plan, priced by the crop engine.
 *
 * Volumes come from `cropEngine.weeklyNeed` rather than being written by hand, for the same reason
 * the app calls core: a fixture that hard-codes volumes would assert nothing about the numbers, and
 * an invented constant here would be an invented agronomic constant. ASSUMED-free by construction —
 * every number traces to FAO-56 parameters in `core/crop-params.ts` and the offline weather fixture.
 *
 * The rainfall offset the demo weather carries on some days is left in: a week with rain needs less,
 * and that is the behaviour the engine exists to produce.
 */
function entitlementEvent(
  scenario: DemoScenario,
  weather: DemoWeather,
  weekStart: string,
  at: string,
): { event: JadalEvent; allocated_m3: number } {
  const plotById = new Map(scenario.plots.map((plot) => [plot.id, plot]));
  const farmerOfPlot = new Map(scenario.plots.map((plot) => [plot.id, plot.farmer_id]));
  const forecast = weekOf(weather, weekStart);

  const entitlements = scenario.crop_plans
    // `harvested` is terminal and must not be re-entitled; the fixture ships none, but the guard makes
    // the fixture correct if one is added rather than silently watering a harvested field.
    .filter((plan) => plan.status !== "harvested")
    .map((plan) => {
      const plot = plotById.get(plan.plot_id);
      const farmer_id = farmerOfPlot.get(plan.plot_id);
      if (plot === undefined || farmer_id === undefined) {
        throw new Error(`demo scenario: crop plan ${plan.id} has no resolvable plot`);
      }
      const params: CropParams = cropParamsFor(plan);
      const need = cropEngine.weeklyNeed({ plan, plot, params, weather: forecast, weekStart });
      return {
        id: deterministicId("ent", plan.id, weekStart),
        farmer_id,
        crop_plan_id: plan.id,
        week_start: weekStart,
        // A plan outside its growing season has no demand; the engine already reports `volume_m3: 0`,
        // and `entitlement.volume_m3 >= 0` allows it, so the row is written honestly as zero rather
        // than dropped — a farmer with two plans sees both, one of them with nothing due.
        volume_m3: round(need.volume_m3, 3),
        net_irrigation_mm: round(need.net_irrigation_mm, 3),
        status: "approved" as const,
        explanation: `FAO-56 weekly need for ${plan.crop}, ${need.stage} stage, Kc ${need.kc}`,
      };
    });

  const allocated_m3 = round(
    entitlements.reduce((sum, entitlement) => sum + entitlement.volume_m3, 0),
    3,
  );

  const event: JadalEvent = {
    id: eventId("season.approved", scenario.canal.id, weekStart),
    at,
    canal_id: scenario.canal.id,
    actor: { kind: "coordinator", id: "coord_demo" },
    type: "season.approved",
    season_supply_m3: scenario.season_supply_m3,
    entitlements,
  };
  return { event, allocated_m3 };
}

/** One `release_window.announced` per window in the fixture. */
function windowEvents(scenario: DemoScenario, at: string): JadalEvent[] {
  return scenario.release_windows.map((window) => ({
    id: eventId("release_window.announced", window.id),
    at,
    canal_id: scenario.canal.id,
    actor: { kind: "coordinator", id: "coord_demo" },
    type: "release_window.announced" as const,
    window,
  }));
}

/**
 * A roster for the first window, built from real hydraulics.
 *
 * `expected_flow_m3s` and `lag_h` come from `hydraulics.atOutlets`, so the turns carry the same
 * numbers the scheduler would compute rather than plausible-looking constants. Turn duration is
 * `volume / flow` converted to hours — the physical definition of a turn — and each turn starts at
 * the previous one's end plus that outlet's travel lag, which is the head-to-tail sequencing warabandi
 * depends on. `shortfall_m3` is the week's need minus what the window could actually deliver, so a
 * test can assert the shortfall path with a number that came from somewhere.
 */
function rosterEvent(
  scenario: DemoScenario,
  window: ReleaseWindow,
  entitlementVolumes: ReadonlyMap<string, number>,
  at: string,
): JadalEvent {
  const atOutlets = hydraulics.atOutlets(scenario.canal, scenario.outlets, window.discharge_m3s);
  const flowByOutlet = new Map(atOutlets.map((outlet) => [outlet.outlet_id, outlet.flow_m3s]));
  const lagByOutlet = new Map(atOutlets.map((outlet) => [outlet.outlet_id, outlet.lag_h]));

  const plotOfFarmer = new Map<string, Plot>();
  for (const plot of scenario.plots) plotOfFarmer.set(plot.farmer_id, plot);

  const shortfall_m3: Record<string, number> = {};
  const turns: {
    id: string;
    roster_id: string;
    outlet_id: string;
    farmer_id: string;
    start: string;
    end: string;
    planned_volume_m3: number;
    expected_flow_m3s: number;
    lag_h: number;
  }[] = [];

  let cursor = Date.parse(window.start);
  for (const farmer of scenario.farmers) {
    const plot = plotOfFarmer.get(farmer.id);
    const required = entitlementVolumes.get(farmer.id) ?? 0;
    if (plot === undefined || required <= 0) continue;

    const flow = flowByOutlet.get(plot.outlet_id) ?? 0;
    const lag_h = lagByOutlet.get(plot.outlet_id) ?? 0;
    if (!(flow > 0) || !Number.isFinite(lag_h)) continue;

    // What the window's discharge can deliver at this outlet in a quarter of the window. Anything
    // more than that is the shortfall the coordinator has to see — a real constraint, not a guess.
    const windowHours = (Date.parse(window.end) - Date.parse(window.start)) / 3_600_000;
    const capacity = flow * (windowHours / scenario.outlets.length) * 3600;
    const planned = round(Math.min(required, capacity), 3);
    const short = round(Math.max(0, required - planned), 3);

    const startMs = cursor + lag_h * 3_600_000;
    const durationH = planned / flow / 3600;
    const endMs = startMs + durationH * 3_600_000;

    turns.push({
      id: deterministicId("turn", window.id, farmer.id),
      roster_id: deterministicId("rost", window.id),
      outlet_id: plot.outlet_id,
      farmer_id: farmer.id,
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      planned_volume_m3: planned,
      expected_flow_m3s: round(flow, 6),
      lag_h: round(lag_h, 3),
    });

    if (short > 0) shortfall_m3[farmer.id] = short;
    cursor = endMs;
  }

  return {
    id: eventId("roster.proposed", window.id),
    at,
    canal_id: scenario.canal.id,
    actor: { kind: "agent", id: "agent_scheduler" },
    type: "roster.proposed",
    roster: {
      id: deterministicId("rost", window.id),
      canal_id: scenario.canal.id,
      release_window_id: window.id,
      status: "proposed",
      turns,
      shortfall_m3,
    },
  };
}

/** `roster.approved` for a roster id, so `listRosters` has a non-`proposed` row to assert on. */
function rosterApprovedEvent(scenario: DemoScenario, window: ReleaseWindow, at: string): JadalEvent {
  return {
    id: eventId("roster.approved", window.id),
    at,
    canal_id: scenario.canal.id,
    actor: { kind: "coordinator", id: "coord_demo" },
    type: "roster.approved",
    roster_id: deterministicId("rost", window.id),
  };
}

// ---------------------------------------------------------------------------
// Reference data with no event type
// ---------------------------------------------------------------------------

/**
 * Insert the canal and its outlets.
 *
 * SCHEMA GAP: no `JadalEvent` variant projects `canal` or `outlet` — the log records what *people*
 * did, and the canal's geometry is surveyed infrastructure that predates the log. So there is no
 * event that could create these rows and no `appendEvent` path to seed them through. This is the one
 * place a fixture writes projection tables directly, and it is parameterised like everything else.
 *
 * ASSUMED: this is a fixture, not app code. If the app ever needs to create a canal at runtime it
 * needs an event type, not this helper.
 */
async function seedInfrastructure(env: DbEnv, scenario: DemoScenario): Promise<void> {
  const statements = [
    env.DB.prepare(
      `INSERT INTO canal (id, name, length_m, head_discharge_m3s, seepage_k_per_m, manning_n, bed_slope,
                          hydraulic_radius_m, lined)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      scenario.canal.id,
      scenario.canal.name,
      scenario.canal.length_m,
      scenario.canal.head_discharge_m3s,
      scenario.canal.seepage_k_per_m,
      scenario.canal.manning_n,
      scenario.canal.bed_slope,
      scenario.canal.hydraulic_radius_m,
      scenario.canal.lined ? 1 : 0,
    ),
    ...scenario.outlets.map((outlet) =>
      env.DB.prepare("INSERT INTO outlet (id, canal_id, name, chainage_m) VALUES (?, ?, ?, ?)").bind(
        outlet.id,
        outlet.canal_id,
        outlet.name,
        outlet.chainage_m,
      ),
    ),
  ];
  await env.DB.batch(statements);
}

/**
 * Insert the offline weather series into `weather_day`.
 *
 * Same reason as `seedInfrastructure`: no event type projects the weather cache. It is reference
 * data fetched from Open-Meteo and cached, not a decision anyone made.
 *
 * `weather_day.canal_id` is a real foreign key onto `canal`, so the canal row must already exist —
 * call this *after* `seedScenario`, which is what creates it.
 */
export async function seedWeather(env: DbEnv, weather: DemoWeather, canalId: string): Promise<number> {
  const statements = weather.days.map((day) =>
    env.DB.prepare(
      "INSERT INTO weather_day (canal_id, date, et0_mm, rain_mm, tmax_c, tmin_c) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(canalId, day.date, day.et0_mm, day.rain_mm, null, null),
  );
  await env.DB.batch(statements);
  return weather.days.length;
}

/** Pin the simulated clock to the scenario's `now`, so seeded event times are reproducible. */
export async function seedClock(env: DbEnv, scenario: DemoScenario): Promise<string> {
  const target = utcNow(scenario);
  await env.DB.prepare("UPDATE clock SET now = ?, offset_h = 0 WHERE id = 1").bind(target).run();
  return target;
}

// ---------------------------------------------------------------------------
// The seed
// ---------------------------------------------------------------------------

/**
 * Drive `appendEvent` through a full, valid, conserved scenario.
 *
 * The sequence, in log order:
 *
 *   1. `farmer.registered` × N — every farmer with their plots and crop plans.
 *   2. `registration.verified` × N — so `verified = 1` and crop plans advance to `active`.
 *   3. `season.approved` — the week's entitlements priced by the crop engine, plus the season row.
 *   4. `release_window.announced` × M — every window in the fixture.
 *   5. `roster.proposed` + `roster.approved` for the first window — real hydraulics, real shortfall.
 *
 * Step 3 is what makes the state *conserved*: `ledger.entriesFor` writes one
 * `canal_supply → farmer:*:quota` entry per entitlement and one `canal_supply → buffer` entry for the
 * unallocated remainder, in the same batch as the event. So
 * `checkConservation(entries, season_supply_m3)` holds to the migration's 0.5 m³ tolerance without the
 * fixture having to balance anything by hand.
 *
 * @param weather Injectable so a test can price a wet week or a dry one. Defaults to the fixture.
 */
export async function seedScenario(
  env: DbEnv,
  scenario: DemoScenario = demoScenario(),
  weather: DemoWeather = demoWeather(),
): Promise<SeedResult> {
  // Idempotent, so callers that already applied the migrations (via `createTestDb`) are unaffected,
  // while callers handed a bare `createEnv()` database get the schema they need. Every statement is
  // `IF NOT EXISTS` / `INSERT OR IGNORE`, so re-applying cannot throw or reset state.
  await applySchema(env.DB);

  const at = await seedClock(env, scenario);
  await seedInfrastructure(env, scenario);

  const weekStart = weekStartFor(scenario);
  const { event: season, allocated_m3 } = entitlementEvent(scenario, weather, weekStart, at);

  // Per-farmer totals, for the roster to schedule against.
  const volumes = new Map<string, number>();
  if (season.type === "season.approved") {
    for (const entitlement of season.entitlements) {
      volumes.set(entitlement.farmer_id, (volumes.get(entitlement.farmer_id) ?? 0) + entitlement.volume_m3);
    }
  }

  const firstWindow = scenario.release_windows[0];

  const ordered: JadalEvent[] = [
    ...registrationEvents(scenario, at),
    ...verificationEvents(scenario, at),
    season,
    ...windowEvents(scenario, at),
  ];
  if (firstWindow !== undefined) {
    ordered.push(rosterEvent(scenario, firstWindow, volumes, at));
    ordered.push(rosterApprovedEvent(scenario, firstWindow, at));
  }

  const event_ids: string[] = [];
  for (const event of ordered) {
    await appendEvent(env, event);
    event_ids.push(event.id);
  }

  return {
    scenario,
    event_ids,
    farmer_ids: scenario.farmers.map((farmer) => farmer.id),
    week_start: weekStart,
    allocated_m3,
  };
}

/**
 * Append one request's full lifecycle and one logged contact, on top of `seedScenario`.
 *
 * Kept separate from `seedScenario` rather than folded into it so the base scenario stays the exact
 * register → verify → season → windows → roster sequence every other test already relies on, while
 * the repository tests still get the `request` and `contact` projections (and their JSON columns) to
 * read. It drives `appendEvent`, so nothing here writes a projection table directly.
 *
 * The request is raised by the first farmer against their first crop plan, triaged, recommended with
 * a nested `agent_recommendation`, then approved with a nested `coordinator_decision`. The contact is
 * a delivered `request_update` carrying a transcript. Neither moves water — `entriesFor` returns `[]`
 * for all five event types — so the scenario's conservation is untouched.
 */
export async function seedInteractions(env: DbEnv, scenario: DemoScenario): Promise<InteractionSeed> {
  const at = await now(env);
  const farmer = scenario.farmers[0];
  if (farmer === undefined) throw new Error("seedInteractions: demo scenario has no farmers");
  const plot = scenario.plots.find((candidate) => candidate.farmer_id === farmer.id);
  if (plot === undefined) throw new Error(`seedInteractions: farmer ${farmer.id} has no plot`);
  const plan = scenario.crop_plans.find((candidate) => candidate.plot_id === plot.id);
  if (plan === undefined) throw new Error(`seedInteractions: plot ${plot.id} has no crop plan`);

  const request_id = deterministicId("req", farmer.id, "urgent");
  const contact_id = deterministicId("cnt", farmer.id, "request_update");
  const request = WaterRequest.parse({
    id: request_id,
    farmer_id: farmer.id,
    crop_plan_id: plan.id,
    type: "urgent",
    volume_m3: 200,
    reason: "Paddy at flowering needs a top-up",
    channel: "voice",
    status: "raised",
    raised_at: at,
  });
  const contact = Contact.parse({
    id: contact_id,
    farmer_id: farmer.id,
    channel: "voice",
    purpose: "request_update",
    status: "delivered",
    attempt: 1,
    message_te: "మీ అభ్యర్థన నమోదు చేయబడింది.",
    message_en: "Your request has been recorded.",
    at,
    transcript: "farmer: నా పంటకు నీళ్లు అవసరం",
  });

  const events: JadalEvent[] = [
    {
      id: eventId("request.raised", request_id),
      at,
      canal_id: scenario.canal.id,
      actor: { kind: "farmer", id: farmer.id },
      type: "request.raised",
      request,
    },
    {
      id: eventId("request.triaged", request_id),
      at,
      canal_id: scenario.canal.id,
      actor: { kind: "agent", id: "agent_assessor" },
      type: "request.triaged",
      request_id,
      triage_score: 0.82,
      intent: "urgent_shortfall",
    },
    {
      id: eventId("request.recommended", request_id),
      at,
      canal_id: scenario.canal.id,
      actor: { kind: "agent", id: "agent_assessor" },
      type: "request.recommended",
      request_id,
      recommendation: {
        decision: "partial",
        volume_m3: 150,
        rationale: "Future quota covers the critical flowering window; grant partially.",
      },
    },
    {
      id: eventId("request.decided", request_id),
      at,
      canal_id: scenario.canal.id,
      actor: { kind: "coordinator", id: "coord_demo" },
      type: "request.decided",
      request_id,
      decision: "approve",
      volume_m3: 150,
      note: "Approved against future quota.",
    },
    {
      id: eventId("contact.updated", contact_id),
      at,
      canal_id: scenario.canal.id,
      actor: { kind: "agent", id: "agent_caller" },
      type: "contact.updated",
      contact,
    },
  ];

  const event_ids: string[] = [];
  for (const event of events) {
    await appendEvent(env, event);
    event_ids.push(event.id);
  }
  return { request_id, contact_id, event_ids };
}

/**
 * A fresh in-memory database with the demo scenario and weather seeded into it.
 *
 * Order matters and is the reason this helper exists: `seedScenario` creates the canal (which
 * `weather_day.canal_id` references) and only then can the weather rows be inserted. Splitting the two
 * calls across a test would make every caller re-derive that ordering.
 */
export async function seededEnv(): Promise<{
  env: DbEnv;
  db: ShimDatabase;
  seed: SeedResult;
  scenario: DemoScenario;
  weather: DemoWeather;
}> {
  const db = await createTestDb();
  const env: DbEnv = { DB: db };
  const scenario = demoScenario();
  const weather = demoWeather();
  const seed = await seedScenario(env, scenario, weather);
  await seedWeather(env, weather, scenario.canal.id);
  return { env, db, seed, scenario, weather };
}

