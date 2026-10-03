/**
 * Demo seeding, simulation-time control and the demo-mode guard.
 *
 * The showcase replays one scenario: a single minor canal, eight farmers, nine crop plans and two
 * release windows, all defined in `packages/contracts/fixtures/demo-scenario.json`. This module turns
 * that fixture into live application state — *only* through `appendEvent`, so the seeded log is a log
 * the app itself could have produced, and the ledger is conserved by construction rather than by a
 * hand-written balance.
 *
 * Three exports matter to the rest of the app:
 *
 *  * `resetDemo(env)` — wipe every projection, event and ledger row, re-seed the clock and weather,
 *    then append the seed. Idempotent: two resets produce the same log and the same balances.
 *  * `advanceDemo(env, hours)` — move the simulated clock, which is what drives the night-release
 *    rule and the rain re-plan in the demo.
 *  * `demoEnabled(env)` — the safety interlock. `resetDemo` is destructive, so it refuses to run
 *    unless the environment explicitly opts in (see the predicate).
 *
 * The seed is defined once, in `demoEvents()`, and shared by `resetDemo` and the tests. It is
 * deliberately deterministic: every id comes from `deterministicId` and every timestamp is the
 * fixture's `now`, never wall-clock time.
 *
 * Two pieces of state have no `JadalEvent` variant and are therefore written directly, exactly as the
 * shared test fixture documents:
 *  * `canal` / `outlet` are surveyed infrastructure that predates the log.
 *  * `weather_day` and `clock` are cached inputs, not decisions anyone made.
 * Everything else — farmers, plots, crop plans, entitlements, release windows — enters through
 * `appendEvent`.
 */

import {
  Canal,
  CropPlan,
  type Entitlement,
  Farmer,
  Outlet,
  Plot,
  ReleaseWindow,
  WeatherDay,
} from "@jadal/contracts";
import type { JadalEvent } from "@jadal/contracts";

import demoScenarioRaw from "../../../packages/contracts/fixtures/demo-scenario.json";
import demoWeatherRaw from "../../../packages/contracts/fixtures/demo-weather.json";

import { cropEngine, cropParamsFor, round } from "./core-shim";
import { advanceHours, setNow } from "./db/clock";
import { deterministicId } from "./db/id";
import { appendEvent, type DbEnv } from "./db/store";

/* ------------------------------------------------------------------ environment */

/**
 * The slice of the Worker environment the demo needs.
 *
 * `DEMO_MODE` and `ENVIRONMENT` are optional so this stays structurally compatible with the
 * production `Env` (which need not carry them) and with the in-memory test env.
 */
export interface DemoEnv extends DbEnv {
  /** Explicit opt-in to destructive demo seeding. Only the literal `"1"` counts. */
  readonly DEMO_MODE?: string;
  /** Deployment name, e.g. `"production"`, `"demo"`, `"development"`. */
  readonly ENVIRONMENT?: string;
}

/**
 * Is destructive demo seeding allowed against this environment?
 *
 * `resetDemo` deletes every projection, event and ledger row, so it must never run against a
 * deployed database by accident. Three rules, in order:
 *
 *  1. `ENVIRONMENT === "production"` is **always** refused, even if `DEMO_MODE` is set. A production
 *     binding with a stray flag must not become wipeable.
 *  2. An explicit `DEMO_MODE === "1"` enables demo mode anywhere else (staging, preview, local).
 *  3. A whole deployment can be marked as a demo with `ENVIRONMENT === "demo"`, which is how the
 *     showcase worker is configured.
 *
 * Any other combination — an unset environment, `DEMO_MODE="0"`, `ENVIRONMENT="staging"` — is
 * refused, and `resetDemo` leaves the database untouched.
 */
export function demoEnabled(env: DemoEnv): boolean {
  if (env.ENVIRONMENT === "production") return false;
  return env.DEMO_MODE === "1" || env.ENVIRONMENT === "demo";
}

/* ------------------------------------------------------------------ fixtures */

/** The subset of `demo-scenario.json` the seed consumes. */
interface DemoScenario {
  readonly now: string;
  readonly canal: Canal;
  readonly outlets: Outlet[];
  readonly farmers: Farmer[];
  readonly plots: Plot[];
  readonly crop_plans: CropPlan[];
  readonly release_windows: ReleaseWindow[];
  readonly season_supply_m3: number;
}

function requireString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`demo-scenario.json: ${key} must be a non-empty string`);
  }
  return value;
}

function requireFiniteNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`demo-scenario.json: ${key} must be a finite number`);
  }
  return value;
}

/** Validate the fixture against the contract schemas at module load, so a bad asset fails loudly. */
function parseScenario(raw: unknown): DemoScenario {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TypeError("demo-scenario.json: root must be an object");
  }
  const source = raw as Record<string, unknown>;
  return {
    now: requireString(source, "now"),
    canal: Canal.parse(source["canal"]),
    outlets: Outlet.array().parse(source["outlets"]),
    farmers: Farmer.array().parse(source["farmers"]),
    plots: Plot.array().parse(source["plots"]),
    crop_plans: CropPlan.array().parse(source["crop_plans"]),
    release_windows: ReleaseWindow.array().parse(source["release_windows"]),
    season_supply_m3: requireFiniteNumber(source, "season_supply_m3"),
  };
}

function parseWeather(raw: unknown): WeatherDay[] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TypeError("demo-weather.json: root must be an object");
  }
  const days = (raw as Record<string, unknown>)["days"];
  return WeatherDay.array().parse(days);
}

const SCENARIO: DemoScenario = parseScenario(demoScenarioRaw);
const WEATHER: WeatherDay[] = parseWeather(demoWeatherRaw);

/** The single canal every demo event is scoped to. */
export const DEMO_CANAL_ID: string = SCENARIO.canal.id;
/** The declared season supply, the figure `ledger.checkConservation` audits against. */
export const DEMO_SEASON_SUPPLY_M3: number = SCENARIO.season_supply_m3;
/** The coordinator actor id used for system/coordinator-authored demo events. */
const DEMO_COORDINATOR_ID = "coord_demo";

/* ------------------------------------------------------------------ time helpers */

/**
 * The scenario's `now` as a UTC ISO instant.
 *
 * `JadalEvent.at` is `z.string().datetime()`, which rejects the fixture's `+05:30` offset, so the
 * fixed fixture string is normalised here. This parses a constant — it never reads wall-clock time,
 * so it stays deterministic.
 */
function scenarioNowUtc(): string {
  const parsed = new Date(SCENARIO.now);
  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError(`demo scenario now is not a valid instant: ${JSON.stringify(SCENARIO.now)}`);
  }
  return parsed.toISOString();
}

/** Monday-aligned week start on or after the scenario's date, as `YYYY-MM-DD`. */
function weekStartFor(utcIso: string): string {
  const local = new Date(utcIso);
  // `getUTCDay()` is 0 for Sunday; shift by 6 so Monday is 0.
  const sinceMonday = (local.getUTCDay() + 6) % 7;
  const monday = new Date(local.getTime() - sinceMonday * 86_400_000);
  return monday.toISOString().slice(0, 10);
}

/** The seven weather days beginning at `weekStart`, from the offline series. */
function weekOf(weather: readonly WeatherDay[], weekStart: string): WeatherDay[] {
  const anchor = Date.parse(`${weekStart}T00:00:00Z`);
  const byDate = new Map(weather.map((day) => [day.date, day]));
  const out: WeatherDay[] = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const iso = new Date(anchor + offset * 86_400_000).toISOString().slice(0, 10);
    const day = byDate.get(iso);
    if (day !== undefined) out.push(day);
  }
  return out;
}

/* ------------------------------------------------------------------ entitlements */

interface NeededPlan {
  readonly plan: CropPlan;
  readonly farmer_id: string;
  readonly need_m3: number;
  readonly net_irrigation_mm: number;
  readonly stage: string;
  readonly kc: number;
}

/**
 * Split the declared season supply across the crop plans in proportion to their FAO-56 weekly need.
 *
 * ASSUMED — demo-seed normalisation, not an agronomic rule. The contract's `season.approved` event
 * carries both `season_supply_m3` and the entitlements it allocates, and `ledger.entriesFor` books
 * the difference into the buffer automatically. That means conservation holds whichever way the
 * volumes are set. The demo fixture nevertheless specifies that the entitlements should sum to the
 * *whole* declared supply, so each plan's engine-computed need is scaled by
 * `season_supply_m3 / Σ need`. The rounding dust is absorbed by the largest allocation so the sum is
 * exact; a zero-need week falls back to an equal split so the seed still conserves.
 */
function allocateSupply(needed: readonly NeededPlan[], supply: number): number[] {
  if (needed.length === 0) return [];
  const totalNeed = needed.reduce((sum, item) => sum + item.need_m3, 0);
  // ASSUMED: scaling the engine's weekly need by `supply / Σ need` is a demo-seed device, not an
  // agronomic rule. A zero-need week falls back to an equal split.
  const raw = needed.map((item) =>
    totalNeed > 0 ? round((item.need_m3 / totalNeed) * supply, 3) : round(supply / needed.length, 3),
  );

  const allocated = raw.reduce((sum, value) => sum + value, 0);
  const residual = round(supply - allocated, 3);
  if (residual !== 0) {
    let target = 0;
    for (let i = 1; i < raw.length; i += 1) {
      if ((raw[i] ?? 0) > (raw[target] ?? 0)) target = i;
    }
    raw[target] = round(Math.max(0, (raw[target] ?? 0) + residual), 3);
  }
  return raw;
}

/**
 * One approved weekly entitlement per verified crop plan, priced by the crop engine and then scaled
 * to the declared supply (see `allocateSupply`). `net_irrigation_mm` is left as the engine's FAO-56
 * value: only the field-gate *volume* is a demo allocation.
 */
function deriveEntitlements(weekStart: string): Entitlement[] {
  const plotById = new Map(SCENARIO.plots.map((plot) => [plot.id, plot]));
  const farmerOfPlot = new Map(SCENARIO.plots.map((plot) => [plot.id, plot.farmer_id]));
  const week = weekOf(WEATHER, weekStart);

  const needed: NeededPlan[] = [];
  for (const plan of SCENARIO.crop_plans) {
    // `harvested` is terminal and must never be re-entitled.
    if (plan.status === "harvested") continue;
    const plot = plotById.get(plan.plot_id);
    const farmer_id = farmerOfPlot.get(plan.plot_id);
    if (plot === undefined || farmer_id === undefined) {
      throw new Error(`demo scenario: crop plan ${plan.id} references an unknown plot ${plan.plot_id}`);
    }
    const need = cropEngine.weeklyNeed({
      plan,
      plot,
      params: cropParamsFor(plan),
      weather: week,
      weekStart,
    });
    needed.push({
      plan,
      farmer_id,
      need_m3: need.volume_m3,
      net_irrigation_mm: need.net_irrigation_mm,
      stage: need.stage,
      kc: need.kc,
    });
  }

  const volumes = allocateSupply(needed, SCENARIO.season_supply_m3);
  return needed.map((item, index) => ({
    id: deterministicId("ent", item.plan.id, weekStart),
    farmer_id: item.farmer_id,
    crop_plan_id: item.plan.id,
    week_start: weekStart,
    volume_m3: volumes[index] ?? 0,
    net_irrigation_mm: round(item.net_irrigation_mm, 3),
    status: "approved" as const,
    explanation: `FAO-56 weekly need for ${item.plan.crop} (${item.stage}, Kc ${item.kc}); volume scaled to the demo season supply`,
  }));
}

/* ------------------------------------------------------------------ the seed */

function groupPlansByFarmer(): Map<string, CropPlan[]> {
  const farmerOfPlot = new Map(SCENARIO.plots.map((plot) => [plot.id, plot.farmer_id]));
  const grouped = new Map<string, CropPlan[]>();
  for (const plan of SCENARIO.crop_plans) {
    const farmer_id = farmerOfPlot.get(plan.plot_id);
    if (farmer_id === undefined) {
      throw new Error(`demo scenario: crop plan ${plan.id} references an unknown plot ${plan.plot_id}`);
    }
    const bucket = grouped.get(farmer_id) ?? [];
    bucket.push(plan);
    grouped.set(farmer_id, bucket);
  }
  return grouped;
}

function groupPlotsByFarmer(): Map<string, Plot[]> {
  const grouped = new Map<string, Plot[]>();
  for (const plot of SCENARIO.plots) {
    const bucket = grouped.get(plot.farmer_id) ?? [];
    bucket.push(plot);
    grouped.set(plot.farmer_id, bucket);
  }
  return grouped;
}

/** `farmer.registered` × N, each carrying that farmer's plots and crop plans. */
function registrationEvents(at: string): JadalEvent[] {
  const plotsByFarmer = groupPlotsByFarmer();
  const plansByFarmer = groupPlansByFarmer();
  return SCENARIO.farmers.map(
    (farmer): JadalEvent => ({
      id: deterministicId("evt", "farmer.registered", farmer.id),
      at,
      canal_id: DEMO_CANAL_ID,
      actor: { kind: "farmer", id: farmer.id },
      type: "farmer.registered",
      farmer,
      plots: plotsByFarmer.get(farmer.id) ?? [],
      crop_plans: plansByFarmer.get(farmer.id) ?? [],
    }),
  );
}

/** `registration.verified` × N, so every seeded farmer reaches `verified = 1`. */
function verificationEvents(at: string): JadalEvent[] {
  return SCENARIO.farmers.map(
    (farmer): JadalEvent => ({
      id: deterministicId("evt", "registration.verified", farmer.id),
      at,
      canal_id: DEMO_CANAL_ID,
      actor: { kind: "coordinator", id: DEMO_COORDINATOR_ID },
      type: "registration.verified",
      farmer_id: farmer.id,
    }),
  );
}

/**
 * The ordered seed, as event objects.
 *
 *   1. `farmer.registered` for every farmer, with their plots and crop plans.
 *   2. `registration.verified` for every farmer.
 *   3. one `season.approved` carrying the declared supply and the derived entitlements.
 *   4. `release_window.announced` for every window in the fixture.
 *
 * Pure and deterministic: same output on every call and every machine.
 */
export function demoEvents(): JadalEvent[] {
  const at = scenarioNowUtc();
  const weekStart = weekStartFor(at);

  const season: JadalEvent = {
    id: deterministicId("evt", "season.approved", DEMO_CANAL_ID, weekStart),
    at,
    canal_id: DEMO_CANAL_ID,
    actor: { kind: "coordinator", id: DEMO_COORDINATOR_ID },
    type: "season.approved",
    season_supply_m3: DEMO_SEASON_SUPPLY_M3,
    entitlements: deriveEntitlements(weekStart),
  };

  const windows = SCENARIO.release_windows.map(
    (window): JadalEvent => ({
      id: deterministicId("evt", "release_window.announced", window.id),
      at,
      canal_id: DEMO_CANAL_ID,
      actor: { kind: "coordinator", id: DEMO_COORDINATOR_ID },
      type: "release_window.announced",
      window,
    }),
  );

  return [...registrationEvents(at), ...verificationEvents(at), season, ...windows];
}

/* ------------------------------------------------------------------ direct writes */

/**
 * Projection, log and ledger tables, in an order that satisfies every foreign key on delete
 * (`ledger_entry` before `events`; children before parents).
 */
const WIPE_TABLES: readonly string[] = [
  "ledger_entry",
  "turn",
  "roster",
  "request",
  "contact",
  "entitlement",
  "crop_plan",
  "plot",
  "farmer",
  "release_window",
  "season",
  "weather_day",
  "outlet",
  "canal",
  "events",
];

/** Atomically empty every table `resetDemo` owns. Table names are code constants, never input. */
async function wipe(env: DbEnv): Promise<void> {
  const statements = WIPE_TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`));
  await env.DB.batch(statements);
}

/**
 * Insert the canal and its outlets.
 *
 * SCHEMA GAP: no `JadalEvent` variant projects `canal` or `outlet` — they are surveyed
 * infrastructure that predates the event log, not decisions. This is the only place `resetDemo`
 * writes a projection table directly, and it is parameterised like everything else.
 */
async function seedInfrastructure(env: DbEnv): Promise<void> {
  const { canal, outlets } = SCENARIO;
  const statements = [
    env.DB.prepare(
      `INSERT INTO canal (id, name, length_m, head_discharge_m3s, seepage_k_per_m, manning_n, bed_slope,
                          hydraulic_radius_m, lined)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      canal.id,
      canal.name,
      canal.length_m,
      canal.head_discharge_m3s,
      canal.seepage_k_per_m,
      canal.manning_n,
      canal.bed_slope,
      canal.hydraulic_radius_m,
      canal.lined ? 1 : 0,
    ),
    ...outlets.map((outlet) =>
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
 * Upsert the bundled offline weather series into `weather_day` for one canal.
 *
 * Weather is a cached input, not an event, so there is no `appendEvent` path for it. Upserting keeps
 * the call idempotent and safe to run again after a live forecast has refreshed the cache.
 *
 * @param env Test or Worker environment.
 * @param canalId The canal the cache belongs to. The row's foreign key requires it to exist first.
 */
export async function seedWeather(env: DbEnv, canalId: string): Promise<void> {
  const statements = WEATHER.map((day) =>
    env.DB.prepare(
      `INSERT INTO weather_day (canal_id, date, et0_mm, rain_mm, tmax_c, tmin_c)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (canal_id, date) DO UPDATE SET
         et0_mm = excluded.et0_mm,
         rain_mm = excluded.rain_mm,
         tmax_c = excluded.tmax_c,
         tmin_c = excluded.tmin_c`,
    ).bind(canalId, day.date, day.et0_mm, day.rain_mm, day.tmax_c ?? null, day.tmin_c ?? null),
  );
  if (statements.length === 0) return;
  await env.DB.batch(statements);
}

/* ------------------------------------------------------------------ public API */

/**
 * Reset the world to the demo scenario.
 *
 * Refuses with `{ ok: false }` unless `demoEnabled(env)` — see that predicate — leaving the database
 * untouched. When enabled it:
 *
 *   1. atomically empties every projection, event and ledger table;
 *   2. re-inserts the canal and outlets (reference data with no event type);
 *   3. pins the simulated clock back to the fixture's `now` and zeroes its travel counter;
 *   4. upserts the offline weather series;
 *   5. appends `demoEvents()` one `db.batch()` at a time through `appendEvent`.
 *
 * Because every state change goes through `appendEvent`, the ledger is conserved by construction and
 * `ledger.checkConservation` is satisfied without any hand-balancing. Because the event ids are
 * `deterministicId`s, calling this twice yields the same log and the same balances.
 */
export async function resetDemo(env: DemoEnv): Promise<{ ok: boolean }> {
  if (!demoEnabled(env)) return { ok: false };

  await wipe(env);
  await seedInfrastructure(env);
  await setNow(env, SCENARIO.now);
  // `setNow` only moves the clock; a full reset also clears the accumulated travel counter.
  await env.DB.prepare("UPDATE clock SET offset_h = 0 WHERE id = 1").run();
  await seedWeather(env, DEMO_CANAL_ID);

  for (const event of demoEvents()) {
    await appendEvent(env, event);
  }

  return { ok: true };
}

/**
 * Move the simulated clock forward (or back, for a negative `hours`) and return the new instant.
 *
 * This is what drives the night-release rule and the rain re-plan: the campaigns read `clock.now`,
 * so advancing time is advancing the demo. Uses `db/clock`, the single source of simulated time.
 */
export async function advanceDemo(env: DbEnv, hours: number): Promise<{ now: string }> {
  const advanced = await advanceHours(env, hours);
  return { now: advanced };
}
