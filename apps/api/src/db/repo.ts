/**
 * The read side of the store.
 *
 * Every function here maps projection rows to the **contract shapes** in `@jadal/contracts/entities`
 * — the same objects `routes.*.response` validates — rather than leaking SQL column names
 * (`has_smartphone`, `from_account`, `shortfall`) to callers. Routes hand these straight to
 * `c.json()`, so a shape drift shows up as a contract-test failure instead of a silent `undefined`.
 *
 * What that costs, and why each is worth it:
 *
 *  * **SQLite stores no boolean or JSON type.** `verified`, `has_smartphone`, `lined` and `escalated`
 *    are `INTEGER CHECK (… IN (0,1))`; `preferred_channels`, `shortfall`, `agent_recommendation` and
 *    `coordinator_decision` are `TEXT CHECK (json_valid(…))`. Both round-trip to JS values here.
 *  * **Column names differ from field names.** `ledger_entry.from_account` is the contract's `from`.
 *    `WaterRequest.crop_plan_id` is optional but the column is nullable, so NULL becomes *absent*
 *    rather than present-and-undefined.
 *  * **Ordering is specified, not incidental.** SQLite returns rows in whatever order the planner
 *    likes; contract tests and the demo need the same array every run. Every list function pins an
 *    `ORDER BY` with a unique tiebreak on the primary key, so output is total and stable even when
 *    the sort keys collide.
 *  * **Missing is not an error.** A filter that matches nothing returns `[]`; a single-row getter
 *    returns `null`. Neither throws, because "no such farmer" is a normal answer for a route.
 *
 * Nothing here writes. All state changes go through `appendEvent` (`store.ts`).
 */

import {
  Canal,
  Channel,
  Contact,
  CropPlan,
  Entitlement,
  Farmer,
  LedgerEntry,
  Outlet,
  Plot,
  ReleaseWindow,
  Roster,
  Turn,
  WaterRequest,
  WeatherDay,
} from "@jadal/contracts/entities";
import type { DbEnv } from "./store";

// ---------------------------------------------------------------------------
// Record shapes
// ---------------------------------------------------------------------------

/**
 * One entry of `routes.listFarmers.response`.
 *
 * `verified` is not on the contract's `Farmer` — it is a fact about the *registration*, not the
 * person — so it travels beside the farmer rather than inside it. The portal needs both in one call.
 */
export interface FarmerRecord {
  readonly farmer: Farmer;
  readonly plots: Plot[];
  readonly crop_plans: CropPlan[];
  readonly verified: boolean;
}

/**
 * `Roster` plus the one column the roster table carries that the contract does not model.
 *
 * `created_at` orders "which roster we tried first". Additive, so a `Roster` consumer is unaffected.
 *
 * The fairness mode is deliberately absent: the contract's `Roster` has no `mode`, and
 * `roster.proposed` does not carry one, so it cannot be recovered from the event log.
 */
export interface RosterRecord extends Roster {
  readonly created_at: string;
}

/**
 * `Contact` with its escalation-ladder flag.
 *
 * `contact.status` already says whether the *attempt* escalated; the separate `escalated` column says
 * whether the farmer had been contacted before this attempt, which is what the ladder branches on.
 */
export interface ContactRecord extends Contact {
  readonly escalated: boolean;
}

/** One declared season's authoritative supply, as stored by the `season.approved` projection. */
export interface SeasonRecord {
  readonly canal_id: string;
  readonly season_supply_m3: number;
  readonly declared_at: string;
  readonly tolerance_m3: number;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface EntitlementFilter {
  readonly farmerId?: string;
  readonly cropPlanId?: string;
  /** Exact `week_start` (`YYYY-MM-DD`). */
  readonly weekStart?: string;
  readonly status?: Entitlement["status"];
}

export interface RosterFilter {
  readonly canalId?: string;
  readonly releaseWindowId?: string;
  readonly status?: Roster["status"];
}

export interface RequestFilter {
  readonly farmerId?: string;
  readonly status?: WaterRequest["status"];
  readonly type?: WaterRequest["type"];
  /** Most rows to return, applied after ordering so it keeps the *oldest* N. */
  readonly limit?: number;
}

export interface ContactFilter {
  readonly farmerId?: string;
  readonly status?: Contact["status"];
  readonly purpose?: Contact["purpose"];
  readonly channel?: Contact["channel"];
  readonly limit?: number;
}

export interface LedgerFilter {
  readonly eventId?: string;
  /** Matches either side of the movement — "everything touching this account". */
  readonly account?: string;
  readonly from?: string;
  readonly to?: string;
  /** Inclusive lower bound on `at` (ISO-8601). */
  readonly since?: string;
  readonly limit?: number;
}

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

interface CanalRow {
  id: string;
  name: string;
  length_m: number;
  head_discharge_m3s: number;
  seepage_k_per_m: number;
  manning_n: number;
  bed_slope: number;
  hydraulic_radius_m: number;
  lined: number;
}

interface OutletRow {
  id: string;
  canal_id: string;
  name: string;
  chainage_m: number;
}

interface FarmerRow {
  id: string;
  name: string;
  phone: string;
  language: string;
  preferred_channels: string;
  has_smartphone: number;
  verified: number;
  registered_at: string;
}

interface PlotRow {
  id: string;
  farmer_id: string;
  outlet_id: string;
  area_ha: number;
  soil: string;
  lat: number;
  lon: number;
}

interface CropPlanRow {
  id: string;
  plot_id: string;
  crop: string;
  sowing_date: string;
  area_fraction: number;
  application_efficiency: number;
  rice_practice: string | null;
  status: string;
}

interface EntitlementRow {
  id: string;
  farmer_id: string;
  crop_plan_id: string;
  week_start: string;
  volume_m3: number;
  net_irrigation_mm: number;
  status: string;
  explanation: string | null;
}

interface ReleaseWindowRow {
  id: string;
  canal_id: string;
  start: string;
  end: string;
  discharge_m3s: number;
}

interface RosterRow {
  id: string;
  canal_id: string;
  release_window_id: string;
  status: string;
  shortfall: string;
  created_at: string;
}

interface TurnRow {
  id: string;
  roster_id: string;
  outlet_id: string;
  farmer_id: string;
  start: string;
  end: string;
  planned_volume_m3: number;
  expected_flow_m3s: number;
  lag_h: number;
}

interface RequestRow {
  id: string;
  farmer_id: string;
  crop_plan_id: string | null;
  type: string;
  volume_m3: number;
  reason: string;
  channel: string;
  status: string;
  raised_at: string;
  triage_score: number | null;
  agent_recommendation: string | null;
  coordinator_decision: string | null;
}

interface ContactRow {
  id: string;
  farmer_id: string;
  channel: string;
  purpose: string;
  status: string;
  attempt: number;
  message_te: string;
  message_en: string;
  at: string;
  transcript: string | null;
  escalated: number;
}

interface LedgerEntryRow {
  id: string;
  at: string;
  from_account: string;
  to_account: string;
  volume_m3: number;
  reason: string;
  event_id: string;
}

interface SeasonRow {
  canal_id: string;
  season_supply_m3: number;
  declared_at: string;
  tolerance_m3: number;
}

interface ClockRow {
  now: string;
}

interface WeatherRow {
  date: string;
  et0_mm: number;
  rain_mm: number;
  tmax_c: number | null;
  tmin_c: number | null;
}

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

/**
 * SQLite's `INTEGER CHECK (… IN (0,1))` back to a JS boolean.
 *
 * The CHECK means only 0 and 1 can be stored, so `=== 1` is total: it cannot silently read a
 * corrupt row as `false`, because a corrupt row cannot exist. The migration is the authority here,
 * not defensiveness.
 */
function toBool(value: number): boolean {
  return value === 1;
}

/**
 * `NULL` → *absent*.
 *
 * Optional contract fields (`crop_plan_id`, `triage_score`, `transcript`, `rice_practice`,
 * `explanation`) must be missing, not present with an `undefined` value: `JSON.stringify` drops
 * `undefined` properties so both look the same on the wire, but `Object.keys()` and zod's
 * `.optional()` handling differ, and a test that reads `Object.keys()` would see the difference.
 * Spreading only defined fields keeps the object honest.
 */
function withOptional<T extends object, K extends string>(base: T, key: K, value: unknown): T | (T & { [P in K]: unknown }) {
  return value === null || value === undefined ? base : { ...base, [key]: value };
}

/**
 * Parse a `json_valid` TEXT column into a `Record<string, number>`.
 *
 * `json_valid` guarantees the text parses; it does not guarantee the shape. A roster's `shortfall`
 * written by a future refactor as `{"f1": "12"}` would still pass the CHECK and then poison every
 * consumer downstream, so the value shape is re-checked here rather than trusted.
 */
function parseNumberRecord(raw: string, column: string, rowId: string): Record<string, number> {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(`${column} on row ${rowId} is not a JSON object: ${raw}`);
  }
  const source = parsed as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError(`${column} on row ${rowId} has a non-finite value at ${key}: ${raw}`);
    }
    out[key] = value;
  }
  return out;
}

/** A `json_valid` TEXT column holding a single JSON object, or `null` when the column is NULL. */
function parseJsonObject(raw: string | null, column: string, rowId: string): unknown {
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(`${column} on row ${rowId} is not a JSON object: ${raw}`);
  }
  return parsed;
}

/** Assemble a `WHERE` fragment and its bindings from an already-built list of clauses. */
interface Where {
  readonly sql: string;
  readonly bindings: unknown[];
}

function emptyWhere(): Where {
  return { sql: "", bindings: [] };
}

/** Append one `col = ?` clause. Does nothing when `value` is `undefined`, so filters are all optional. */
function eq(where: Where, column: string, value: string | number | undefined): Where {
  if (value === undefined) return where;
  return {
    sql: where.sql === "" ? ` WHERE ${column} = ?` : `${where.sql} AND ${column} = ?`,
    bindings: [...where.bindings, value],
  };
}

/** Append one `col IN (?, …)` clause. An empty value list matches nothing, which is the honest answer. */
function inList(where: Where, column: string, values: readonly string[]): Where {
  if (values.length === 0) {
    return { sql: where.sql === "" ? " WHERE 0" : `${where.sql} AND 0`, bindings: where.bindings };
  }
  const placeholders = values.map(() => "?").join(", ");
  return {
    sql: where.sql === "" ? ` WHERE ${column} IN (${placeholders})` : `${where.sql} AND ${column} IN (${placeholders})`,
    bindings: [...where.bindings, ...values],
  };
}

/** Trailing `LIMIT ?`, or nothing when `limit` is undefined. */
function limitClause(limit: number | undefined): { sql: string; bindings: unknown[] } {
  return limit === undefined ? { sql: "", bindings: [] } : { sql: " LIMIT ?", bindings: [limit] };
}

// ---------------------------------------------------------------------------
// Row → contract mappers
// ---------------------------------------------------------------------------

function toCanal(row: CanalRow): Canal {
  return Canal.parse({
    id: row.id,
    name: row.name,
    length_m: row.length_m,
    head_discharge_m3s: row.head_discharge_m3s,
    seepage_k_per_m: row.seepage_k_per_m,
    manning_n: row.manning_n,
    bed_slope: row.bed_slope,
    hydraulic_radius_m: row.hydraulic_radius_m,
    lined: toBool(row.lined),
  });
}

function toOutlet(row: OutletRow): Outlet {
  return Outlet.parse({
    id: row.id,
    canal_id: row.canal_id,
    name: row.name,
    chainage_m: row.chainage_m,
  });
}

/**
 * `farmer` table row → contract `Farmer`.
 *
 * `verified` and `registered_at` are deliberately *not* included: they are registration facts, not
 * person facts, and `Farmer` has no place for them. `FarmerRecord` carries them alongside.
 *
 * The parse is not decoration — `preferred_channels` comes out of a JSON column, so it is the one
 * place a projection bug (a bad enum written by an agent) becomes a typed error here rather than an
 * unvalidated string reaching a route.
 */
function toFarmer(row: FarmerRow): Farmer {
  const channels: unknown = JSON.parse(row.preferred_channels);
  return Farmer.parse({
    id: row.id,
    name: row.name,
    phone: row.phone,
    language: row.language,
    preferred_channels: Channel.array().parse(channels),
    has_smartphone: toBool(row.has_smartphone),
  });
}

function toPlot(row: PlotRow): Plot {
  return Plot.parse({
    id: row.id,
    farmer_id: row.farmer_id,
    outlet_id: row.outlet_id,
    area_ha: row.area_ha,
    soil: row.soil,
    lat: row.lat,
    lon: row.lon,
  });
}

function toCropPlan(row: CropPlanRow): CropPlan {
  return CropPlan.parse(
    withOptional(
      {
        id: row.id,
        plot_id: row.plot_id,
        crop: row.crop,
        sowing_date: row.sowing_date,
        area_fraction: row.area_fraction,
        application_efficiency: row.application_efficiency,
        status: row.status,
      },
      "rice_practice",
      row.rice_practice,
    ),
  );
}

function toEntitlement(row: EntitlementRow): Entitlement {
  return Entitlement.parse(
    withOptional(
      {
        id: row.id,
        farmer_id: row.farmer_id,
        crop_plan_id: row.crop_plan_id,
        week_start: row.week_start,
        volume_m3: row.volume_m3,
        net_irrigation_mm: row.net_irrigation_mm,
        status: row.status,
      },
      "explanation",
      row.explanation,
    ),
  );
}

function toReleaseWindow(row: ReleaseWindowRow): ReleaseWindow {
  return ReleaseWindow.parse({
    id: row.id,
    canal_id: row.canal_id,
    start: row.start,
    end: row.end,
    discharge_m3s: row.discharge_m3s,
  });
}

function toTurn(row: TurnRow): Turn {
  return Turn.parse({
    id: row.id,
    roster_id: row.roster_id,
    outlet_id: row.outlet_id,
    farmer_id: row.farmer_id,
    start: row.start,
    end: row.end,
    planned_volume_m3: row.planned_volume_m3,
    expected_flow_m3s: row.expected_flow_m3s,
    lag_h: row.lag_h,
  });
}

/** Roster row plus its already-parsed turns and JSON shortfall. */
function toRoster(row: RosterRow, turns: Turn[]): RosterRecord {
  return Roster.parse({
    id: row.id,
    canal_id: row.canal_id,
    release_window_id: row.release_window_id,
    status: row.status,
    turns,
    shortfall_m3: parseNumberRecord(row.shortfall, "roster.shortfall", row.id),
    created_at: row.created_at,
  }) as RosterRecord;
}

/**
 * `request` table row → contract `WaterRequest`.
 *
 * The table is self-contained: every field of `WaterRequest` is a column, with the two decisions
 * held as JSON text. That is why this mapper does no joining — the request row is the whole request.
 *
 * The two JSON columns are re-validated through the contract's own sub-schemas rather than trusted as
 * `unknown`, because `request.recommended` and `request.decided` write them as opaque `json(...)`
 * blobs and a `decision` value the contract rejects would otherwise surface as a 500 from a route
 * that only meant to read a list.
 */
function toRequest(row: RequestRow): WaterRequest {
  const recommendation = WaterRequest.shape.agent_recommendation.parse(
    parseJsonObject(row.agent_recommendation, "request.agent_recommendation", row.id),
  );
  const decision = WaterRequest.shape.coordinator_decision.parse(
    parseJsonObject(row.coordinator_decision, "request.coordinator_decision", row.id),
  );
  return WaterRequest.parse(
    withDecision(
      withOptional(
        withOptional(
          withOptional(
            {
              id: row.id,
              farmer_id: row.farmer_id,
              type: row.type,
              volume_m3: row.volume_m3,
              reason: row.reason,
              channel: row.channel,
              status: row.status,
              raised_at: row.raised_at,
            },
            "crop_plan_id",
            row.crop_plan_id,
          ),
          "triage_score",
          row.triage_score,
        ),
        "agent_recommendation",
        recommendation,
      ),
      decision,
    ),
  );
}

function toContact(row: ContactRow): ContactRecord {
  return Contact.parse(
    withOptional(
      {
        id: row.id,
        farmer_id: row.farmer_id,
        channel: row.channel,
        purpose: row.purpose,
        status: row.status,
        attempt: row.attempt,
        message_te: row.message_te,
        message_en: row.message_en,
        at: row.at,
        escalated: toBool(row.escalated),
      },
      "transcript",
      row.transcript,
    ),
  ) as ContactRecord;
}

function toLedgerEntry(row: LedgerEntryRow): LedgerEntry {
  return LedgerEntry.parse({
    id: row.id,
    at: row.at,
    from: row.from_account,
    to: row.to_account,
    volume_m3: row.volume_m3,
    reason: row.reason,
    event_id: row.event_id,
  });
}

function toSeason(row: SeasonRow): SeasonRecord {
  return {
    canal_id: row.canal_id,
    season_supply_m3: row.season_supply_m3,
    declared_at: row.declared_at,
    tolerance_m3: row.tolerance_m3,
  };
}

function toWeatherDay(row: WeatherRow): WeatherDay {
  return WeatherDay.parse(
    withOptional(
      withOptional(
        { date: row.date, et0_mm: row.et0_mm, rain_mm: row.rain_mm },
        "tmax_c",
        row.tmax_c,
      ),
      "tmin_c",
      row.tmin_c,
    ),
  );
}

// ---------------------------------------------------------------------------
// Canal and outlets
// ---------------------------------------------------------------------------

/** The canal's physical parameters, or `null` when no such canal exists. */
export async function getCanal(env: DbEnv, canalId: string): Promise<Canal | null> {
  const row = await env.DB.prepare("SELECT * FROM canal WHERE id = ?").bind(canalId).first<CanalRow>();
  return row === null ? null : toCanal(row);
}

/**
 * Outlets on a canal, head to tail.
 *
 * `chainage_m` is the physical ordering — warabandi is sequenced by distance from the head, so this
 * is the order the portal and the caller agent render. `id` breaks ties so two outlets at the same
 * chainage still have a total order.
 */
export async function listOutlets(env: DbEnv, canalId?: string): Promise<Outlet[]> {
  const where = eq(emptyWhere(), "canal_id", canalId);
  const rows = await env.DB.prepare(
    `SELECT * FROM outlet${where.sql} ORDER BY chainage_m ASC, id ASC`,
  )
    .bind(...where.bindings)
    .all<OutletRow>();
  return rows.map(toOutlet);
}

// ---------------------------------------------------------------------------
// Farmers, plots, crop plans
// ---------------------------------------------------------------------------

/**
 * Every registered farmer, with their plots and crop plans, ordered by name.
 *
 * Name rather than id because every screen that lists farmers is read by a human looking for a person.
 * `id` is the tiebreak so two farmers sharing a name still order deterministically.
 *
 * The three tables are fetched with three queries rather than one joined query on purpose: a join
 * would fan out to one row per (plot × crop_plan) combination and the grouping would then have to be
 * reassembled anyway. Three flat reads plus an in-memory fold is both easier to reason about and the
 * same number of round trips.
 */
export async function listFarmers(env: DbEnv): Promise<FarmerRecord[]> {
  const farmerRows = await env.DB.prepare("SELECT * FROM farmer ORDER BY name ASC, id ASC").all<FarmerRow>();
  if (farmerRows.length === 0) return [];

  const ids = farmerRows.map((row) => row.id);
  const plotWhere = inList(emptyWhere(), "farmer_id", ids);
  const plotRows = await env.DB.prepare(
    `SELECT * FROM plot${plotWhere.sql} ORDER BY farmer_id ASC, id ASC`,
  )
    .bind(...plotWhere.bindings)
    .all<PlotRow>();

  // Crop plans hang off plots, so the plot ids — not the farmer ids — are what filters them.
  const plotIds = plotRows.map((row) => row.id);
  const planWhere = inList(emptyWhere(), "plot_id", plotIds);
  const planRows = await env.DB.prepare(
    `SELECT * FROM crop_plan${planWhere.sql} ORDER BY plot_id ASC, id ASC`,
  )
    .bind(...planWhere.bindings)
    .all<CropPlanRow>();

  const plotsByFarmer = new Map<string, Plot[]>();
  for (const row of plotRows) {
    const bucket = plotsByFarmer.get(row.farmer_id) ?? [];
    bucket.push(toPlot(row));
    plotsByFarmer.set(row.farmer_id, bucket);
  }

  const plansByFarmer = new Map<string, CropPlan[]>();
  const farmerOfPlot = new Map<string, string>();
  for (const row of plotRows) farmerOfPlot.set(row.id, row.farmer_id);
  for (const row of planRows) {
    const farmer_id = farmerOfPlot.get(row.plot_id);
    if (farmer_id === undefined) continue;
    const bucket = plansByFarmer.get(farmer_id) ?? [];
    bucket.push(toCropPlan(row));
    plansByFarmer.set(farmer_id, bucket);
  }

  return farmerRows.map((row) => ({
    farmer: toFarmer(row),
    plots: plotsByFarmer.get(row.id) ?? [],
    crop_plans: plansByFarmer.get(row.id) ?? [],
    verified: toBool(row.verified),
  }));
}

/** One farmer with their plots and crop plans, or `null` when the id is unknown. */
export async function getFarmer(env: DbEnv, farmerId: string): Promise<FarmerRecord | null> {
  const row = await env.DB.prepare("SELECT * FROM farmer WHERE id = ?").bind(farmerId).first<FarmerRow>();
  if (row === null) return null;

  const plotRows = await env.DB.prepare("SELECT * FROM plot WHERE farmer_id = ? ORDER BY id ASC")
    .bind(farmerId)
    .all<PlotRow>();
  const planRows = await env.DB.prepare(
    `SELECT cp.* FROM crop_plan cp
     JOIN plot p ON p.id = cp.plot_id
     WHERE p.farmer_id = ?
     ORDER BY cp.id ASC`,
  )
    .bind(farmerId)
    .all<CropPlanRow>();

  return {
    farmer: toFarmer(row),
    plots: plotRows.map(toPlot),
    crop_plans: planRows.map(toCropPlan),
    verified: toBool(row.verified),
  };
}

/**
 * Crop plans that have cleared verification, ordered by sowing date then id.
 *
 * "Verified" means the *plan* passed the coordinator's field check, so the filter is
 * `status IN ('verified','active')` — a plan that is verified and running is still verified, and
 * excluding `active` would hide most of the season from the portal's verification view. `harvested`
 * is excluded: that is a terminal state, not a pending verification.
 *
 * Ordered by sowing date because the verification queue is worked oldest-crop-first, matching the
 * order the coordinator registered them in.
 */
export async function listVerifiedCropPlans(env: DbEnv, farmerId?: string): Promise<CropPlan[]> {
  const clauses = ["cp.status IN ('verified','active')"];
  const bindings: unknown[] = [];
  if (farmerId !== undefined) {
    clauses.push("p.farmer_id = ?");
    bindings.push(farmerId);
  }
  const rows = await env.DB.prepare(
    `SELECT cp.* FROM crop_plan cp
     JOIN plot p ON p.id = cp.plot_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY cp.sowing_date ASC, cp.id ASC`,
  )
    .bind(...bindings)
    .all<CropPlanRow>();
  return rows.map(toCropPlan);
}

// ---------------------------------------------------------------------------
// Entitlements
// ---------------------------------------------------------------------------

/**
 * Entitlements, ordered by `week_start` then farmer name.
 *
 * The week is the outer key because every consumer of this list — the portal's weekly board, the
 * coordinator's approval screen — reasons in weeks. Within a week, farmers in name order matches
 * `listFarmers`, so a farmer's position does not jump between two lists.
 *
 * The `ORDER BY` joins `farmer` for the name; `entitlement.id` is the final tiebreak so two
 * entitlements in the same week for the same farmer (two crop plans) are still totally ordered.
 */
export async function listEntitlements(env: DbEnv, filter: EntitlementFilter = {}): Promise<Entitlement[]> {
  let where = eq(emptyWhere(), "e.farmer_id", filter.farmerId);
  where = eq(where, "e.crop_plan_id", filter.cropPlanId);
  where = eq(where, "e.week_start", filter.weekStart);
  where = eq(where, "e.status", filter.status);

  const rows = await env.DB.prepare(
    `SELECT e.* FROM entitlement e
     JOIN farmer f ON f.id = e.farmer_id
     ${where.sql}
     ORDER BY e.week_start ASC, f.name ASC, e.id ASC`,
  )
    .bind(...where.bindings)
    .all<EntitlementRow>();
  return rows.map(toEntitlement);
}

/**
 * One week's entitlements, same ordering as `listEntitlements`.
 *
 * A convenience over `listEntitlements({ weekStart })` so callers that only care about a week do not
 * have to construct the filter, and so the "empty week" answer is `[]` in one obvious place.
 */
export async function getEntitlementsForWeek(
  env: DbEnv,
  weekStart: string,
  filter: Omit<EntitlementFilter, "weekStart"> = {},
): Promise<Entitlement[]> {
  return listEntitlements(env, { ...filter, weekStart });
}

/**
 * Append the coordinator decision to the base request shape.
 *
 * Split out because it is the only nested-JSON field whose absence and whose `undefined` have to be
 * distinguished from the other two, and getting that wrong silently drops a coordinator's decision
 * out of an audit view.
 */
function withDecision<T extends object>(base: T, decision: unknown): T | (T & { coordinator_decision: unknown }) {
  return decision === undefined ? base : { ...base, coordinator_decision: decision };
}

// ---------------------------------------------------------------------------
// Release windows and rosters
// ---------------------------------------------------------------------------

/**
 * Release windows in start order, then id.
 *
 * Head-to-tail chronology: a coordinator comparing two upcoming windows reads them earliest-first,
 * which is also the order they will actually be run in.
 */
export async function listReleaseWindows(env: DbEnv, canalId?: string): Promise<ReleaseWindow[]> {
  const where = eq(emptyWhere(), "canal_id", canalId);
  const rows = await env.DB.prepare(
    `SELECT * FROM release_window${where.sql} ORDER BY start ASC, id ASC`,
  )
    .bind(...where.bindings)
    .all<ReleaseWindowRow>();
  return rows.map(toReleaseWindow);
}

/** One release window, or `null` when the id is unknown. */
export async function getReleaseWindow(env: DbEnv, windowId: string): Promise<ReleaseWindow | null> {
  const row = await env.DB.prepare("SELECT * FROM release_window WHERE id = ?")
    .bind(windowId)
    .first<ReleaseWindowRow>();
  return row === null ? null : toReleaseWindow(row);
}

/**
 * Turn rows for several rosters at once, grouped by roster id.
 *
 * Both `getRoster` and `listRosters` need turns, and a list that issued one query per roster would
 * be O(n) round trips over the demo's whole history. One `IN` query plus a fold keeps it at two.
 * Rosters with no turns get no map entry, and every caller substitutes `?? []`.
 */
async function turnsByRoster(env: DbEnv, rosterIds: readonly string[]): Promise<Map<string, Turn[]>> {
  const grouped = new Map<string, Turn[]>();
  if (rosterIds.length === 0) return grouped;

  const where = inList(emptyWhere(), "roster_id", rosterIds);
  const rows = await env.DB.prepare(
    `SELECT * FROM turn${where.sql} ORDER BY start ASC, id ASC`,
  )
    .bind(...where.bindings)
    .all<TurnRow>();

  for (const row of rows) {
    const bucket = grouped.get(row.roster_id) ?? [];
    bucket.push(toTurn(row));
    grouped.set(row.roster_id, bucket);
  }
  return grouped;
}

/** Roster rows plus their turn groups, in `created_at` order. Ordering helper, shared by both roster getters. */
async function rostersWithTurns(env: DbEnv, filter: RosterFilter): Promise<RosterRecord[]> {
  let where = eq(emptyWhere(), "canal_id", filter.canalId);
  where = eq(where, "release_window_id", filter.releaseWindowId);
  where = eq(where, "status", filter.status);

  const rows = await env.DB.prepare(
    `SELECT * FROM roster${where.sql} ORDER BY created_at ASC, id ASC`,
  )
    .bind(...where.bindings)
    .all<RosterRow>();
  if (rows.length === 0) return [];

  const turns = await turnsByRoster(
    env,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toRoster(row, turns.get(row.id) ?? []));
}

/**
 * Rosters, oldest first, each with its turns in `start` order.
 *
 * `created_at` first so "the roster we tried before the re-plan" reads forwards, matching the event
 * log's `seq` order. `id` breaks ties for two rosters proposed in the same batch.
 */
export async function listRosters(env: DbEnv, filter: RosterFilter = {}): Promise<RosterRecord[]> {
  return rostersWithTurns(env, filter);
}

/**
 * One roster with its turns, or `null` when the id is unknown.
 *
 * An empty `turns` array is a legitimate answer — a roster whose window could schedule nothing is
 * still a real roster, and the coordinator needs to see it to understand the shortfall.
 */
export async function getRoster(env: DbEnv, rosterId: string): Promise<RosterRecord | null> {
  const row = await env.DB.prepare("SELECT * FROM roster WHERE id = ?").bind(rosterId).first<RosterRow>();
  if (row === null) return null;
  const turns = await turnsByRoster(env, [rosterId]);
  return toRoster(row, turns.get(rosterId) ?? []);
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/**
 * Water requests in `raised_at` order, oldest first.
 *
 * Chronological, matching how a coordinator triages a queue: the request that has been waiting
 * longest is the one to answer first. `id` is the tiebreak for two requests raised in the same
 * batch — which the demo does, since one event append is one timestamp.
 */
export async function listRequests(env: DbEnv, filter: RequestFilter = {}): Promise<WaterRequest[]> {
  let where = eq(emptyWhere(), "farmer_id", filter.farmerId);
  where = eq(where, "status", filter.status);
  where = eq(where, "type", filter.type);

  const limit = limitClause(filter.limit);
  const rows = await env.DB.prepare(
    `SELECT * FROM request${where.sql} ORDER BY raised_at ASC, id ASC${limit.sql}`,
  )
    .bind(...where.bindings, ...limit.bindings)
    .all<RequestRow>();
  return rows.map(toRequest);
}

/** One request, or `null` when the id is unknown. */
export async function getRequest(env: DbEnv, requestId: string): Promise<WaterRequest | null> {
  const row = await env.DB.prepare("SELECT * FROM request WHERE id = ?").bind(requestId).first<RequestRow>();
  return row === null ? null : toRequest(row);
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

/**
 * Contacts in `at` order, oldest first — the conversation, forwards.
 *
 * `id` breaks ties so two attempts logged in one batch still order totally.
 */
export async function listContacts(env: DbEnv, filter: ContactFilter = {}): Promise<ContactRecord[]> {
  let where = eq(emptyWhere(), "farmer_id", filter.farmerId);
  where = eq(where, "status", filter.status);
  where = eq(where, "purpose", filter.purpose);
  where = eq(where, "channel", filter.channel);

  const limit = limitClause(filter.limit);
  const rows = await env.DB.prepare(
    `SELECT * FROM contact${where.sql} ORDER BY at ASC, id ASC${limit.sql}`,
  )
    .bind(...where.bindings, ...limit.bindings)
    .all<ContactRow>();
  return rows.map(toContact);
}

/** One contact, or `null` when the id is unknown. */
export async function getContact(env: DbEnv, contactId: string): Promise<ContactRecord | null> {
  const row = await env.DB.prepare("SELECT * FROM contact WHERE id = ?").bind(contactId).first<ContactRow>();
  return row === null ? null : toContact(row);
}

// ---------------------------------------------------------------------------
// Ledger and season
// ---------------------------------------------------------------------------

/**
 * Ledger entries in `at` order, then id.
 *
 * The order is the audit trail's spine: an auditor reading entries top to bottom sees water move in
 * the sequence the log records. `id` (which is `${event_id}:e${n}`) breaks ties within one event, and
 * the `n` suffix already orders them by movement, so two entries from one append are listed in the
 * order `entriesFor` emitted them.
 */
export async function getLedgerEntries(env: DbEnv, filter: LedgerFilter = {}): Promise<LedgerEntry[]> {
  let where = eq(emptyWhere(), "event_id", filter.eventId);
  where = eq(where, "from_account", filter.from);
  where = eq(where, "to_account", filter.to);
  if (filter.account !== undefined) {
    where = {
      sql: where.sql === "" ? " WHERE (from_account = ? OR to_account = ?)" : `${where.sql} AND (from_account = ? OR to_account = ?)`,
      bindings: [...where.bindings, filter.account, filter.account],
    };
  }
  if (filter.since !== undefined) {
    where = { sql: `${where.sql === "" ? " WHERE" : where.sql} at >= ?`, bindings: [...where.bindings, filter.since] };
  }

  const limit = limitClause(filter.limit);
  const rows = await env.DB.prepare(
    `SELECT * FROM ledger_entry${where.sql} ORDER BY at ASC, id ASC${limit.sql}`,
  )
    .bind(...where.bindings, ...limit.bindings)
    .all<LedgerEntryRow>();
  return rows.map(toLedgerEntry);
}

/**
 * The declared season for a canal, or `null` before `season.approved` has been appended.
 *
 * `season_supply_m3` is the figure `ledger.checkConservation` audits against, so it is read from the
 * projection rather than recomputed: the point of the table is to hold the coordinator's *declared*
 * number even when it disagrees with the sum of the entitlements, which is exactly the case an audit
 * needs to see.
 */
export async function getSeason(env: DbEnv, canalId: string): Promise<SeasonRecord | null> {
  const row = await env.DB.prepare("SELECT * FROM season WHERE canal_id = ?").bind(canalId).first<SeasonRow>();
  return row === null ? null : toSeason(row);
}

// ---------------------------------------------------------------------------
// Clock and weather
// ---------------------------------------------------------------------------

/**
 * The simulated current time, normalised to an ISO-8601 UTC instant, or `null` if no clock row exists.
 *
 * `db/clock.ts` owns moving the clock and throws when the row is missing, because a route that
 * stamps an event with no clock is a real failure. This is the read counterpart used by the demo
 * panel and by tests, where "no migrations applied yet" is a legitimate state to observe rather than
 * an error, so it answers `null`.
 */
export async function getClockNow(env: DbEnv): Promise<string | null> {
  const row = await env.DB.prepare("SELECT now FROM clock WHERE id = 1").first<ClockRow>();
  if (row === null) return null;
  const parsed = new Date(row.now);
  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError(`clock.now is not an ISO-8601 instant: ${JSON.stringify(row.now)}`);
  }
  return parsed.toISOString();
}

/**
 * Cached weather for a canal, from `fromDate` onwards, at most `days` rows.
 *
 * `days` is a cap rather than a window width on purpose: it is a LIMIT, so a canal with a gap in its
 * cached series returns the days it does have instead of silently shifting the window to fill the
 * hole. Callers that need a dense series (the crop engine's weekly balance) supply their own slice.
 *
 * A non-positive or non-finite `days` yields `[]` instead of a SQLite error, since "no days" is a
 * meaningful answer for a caller computing a window that falls outside the cached range.
 */
export async function getWeather(env: DbEnv, canalId: string, fromDate: string, days: number): Promise<WeatherDay[]> {
  if (!Number.isFinite(days) || days <= 0) return [];
  const take = Math.floor(days);
  const rows = await env.DB.prepare(
    `SELECT * FROM weather_day
     WHERE canal_id = ? AND date >= ?
     ORDER BY date ASC
     LIMIT ?`,
  )
    .bind(canalId, fromDate, take)
    .all<WeatherRow>();
  return rows.map(toWeatherDay);
}
