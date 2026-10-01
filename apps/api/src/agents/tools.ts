/**
 * The System-2 tool registry.
 *
 * Every tool in `@jadal/contracts`'s `toolSpecs` has exactly one entry here, and the entries' `agent`
 * and `gated` flags are copied from `toolSpecs` itself rather than retyped, so the registry cannot
 * drift from the contract (a test asserts the key sets and the flags are equal).
 *
 * Layering (docs/architecture/overview.md §2): each tool is a thin wrapper over `src/core` or
 * `src/db`. **No water arithmetic lives here** — the crop engine, hydraulics, roster engine, ledger
 * and policy own every number, and this module only reads inputs, calls them and shapes the result.
 *
 * Gating. `toolSpecs[name].gated` is the authority. A gated tool's runner is a *proposal builder*
 * that never writes: `runTool` centralises the decision, and a gated call is returned as
 * `{ gated: true, proposal: value }` and is never applied. The three gated tools
 * (`propose_entitlements`, `optimize_roster`, `recommend_decision`) therefore change nothing, which
 * is what the loop's "gated tool produces a proposal without state change" test proves.
 *
 * State changes go through `appendEvent` in the same file as everywhere else (`src/db/store.ts`),
 * which writes the event, its projections and its ledger entries atomically. `place_call`,
 * `send_whatsapp` and `record_ack` are the only tools that change state, and they do so by appending
 * a `contact.updated` event — there is no direct projection write.
 */

import { AgentName, Contact, CropPlan, toolSpecs } from "@jadal/contracts";
import type { CropParams, Plot, WeatherDay } from "@jadal/contracts";
import type { Db } from "../db/store";
import type { AgentEnv } from "./llm";
import type { ProviderEnv, ProviderFetch } from "../system1";
import { appendEvent } from "../db/store";
import { now } from "../db/clock";
import { newId } from "../db/id";
import { cropEngine } from "../core/crop-engine";
import { cropParamsFor } from "../core/crop-params";
import { daysBetween } from "../core/crop-engine";
import { hydraulics } from "../core/hydraulics";
import { ledger } from "../core/ledger";
import { round } from "../core/units";
import { getForecast, loadDemoWeather } from "../voice/openmeteo";
import {
  getCanal,
  getContact,
  getLedgerEntries,
  getSeason,
  getWeather,
  listFarmers,
  listOutlets,
  listRosters,
} from "../db/repo";
import { computeEntitlements } from "./need";
import { proposeRoster } from "./scheduler";

export type ToolName = keyof typeof toolSpecs;

/** The keys `toolSpecs` declares, as a runtime array, in declaration order. */
export const TOOL_NAMES = Object.keys(toolSpecs) as ToolName[];

export function isToolName(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(toolSpecs, name);
}

/**
 * The environment every tool needs.
 *
 * Deliberately the *structural* minimum (`Db` from the store, not D1Database) so the in-memory test
 * database in `test/harness.ts` and the Worker's real bindings both satisfy it. The OpenRouter keys
 * and `fetch` are shared with `./llm`, `../system1` and `../voice/*`.
 */
export interface ToolEnv {
  readonly DB: Db;
  readonly OUTBOUND?: Queue;
  readonly CACHE?: KVNamespace;
  readonly fetch?: ProviderFetch;
  readonly OPENROUTER_API_KEY?: string;
  readonly AI_GATEWAY_URL?: string;
  readonly OPENROUTER_MODEL?: string;
  readonly SARVAM_API_KEY?: string;
  readonly JEV_MODEL?: string;
}

/**
 * Structural adapter for `./llm`, which declares `DB: D1Database` because that is what the Worker
 * binding is. The loop only ever calls `chat`, which reads the OpenRouter keys and `fetch` and never
 * touches `DB`; the assertion is safe for that use and keeps the agents decoupled from the Worker
 * type surface so they stay testable with the SQLite shim.
 */
export function toAgentEnv(env: ToolEnv): AgentEnv {
  return env as unknown as AgentEnv;
}

/** Runtime fetch when no test injected one. Only used in the Worker, where a global fetch exists. */
const runtimeFetch: ProviderFetch = (input, init) => globalThis.fetch(input, init as RequestInit);

/** `ProviderEnv` for the voice/System-1 clients, with a real fetch guaranteed to be present. */
export function providerEnvOf(env: ToolEnv): ProviderEnv {
  const provider: ProviderEnv = { ...env, fetch: env.fetch ?? runtimeFetch };
  return provider;
}

/* ------------------------------------------------------------------ small readers */

function inputString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`tool input ${key} must be a non-empty string`);
  }
  return value;
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new TypeError(`tool input ${key} must be a string`);
  return value;
}

function inputNumber(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`tool input ${key} must be a finite number`);
  }
  return value;
}

function inputBoolean(input: Record<string, unknown>, key: string): boolean {
  const value = input[key];
  if (typeof value !== "boolean") throw new TypeError(`tool input ${key} must be a boolean`);
  return value;
}

/* ------------------------------------------------------------------ canal / plan lookups */

interface CanalContext {
  readonly canal: NonNullable<Awaited<ReturnType<typeof getCanal>>>;
  readonly outlets: Awaited<ReturnType<typeof listOutlets>>;
}

async function canalContext(env: ToolEnv): Promise<CanalContext> {
  const outlets = await listOutlets(env);
  const canalId = outlets[0]?.canal_id;
  if (canalId === undefined) throw new Error("no canal configured: seed the demo scenario first");
  const canal = await getCanal(env, canalId);
  if (canal === null) throw new Error(`canal ${canalId} referenced by an outlet does not exist`);
  return { canal, outlets };
}

interface PlanContext {
  readonly plan: CropPlan;
  readonly plot: Plot;
  readonly farmer_id: string;
  readonly params: CropParams;
}

/** Every crop plan with its plot, farmer and FAO-56 parameters, keyed by plan id. */
async function planContexts(env: ToolEnv): Promise<Map<string, PlanContext>> {
  const farmers = await listFarmers(env);
  const contexts = new Map<string, PlanContext>();
  for (const record of farmers) {
    const plotById = new Map(record.plots.map((plot) => [plot.id, plot]));
    for (const plan of record.crop_plans) {
      const plot = plotById.get(plan.plot_id);
      if (plot === undefined) continue;
      contexts.set(plan.id, { plan, plot, farmer_id: record.farmer.id, params: cropParamsFor(plan) });
    }
  }
  return contexts;
}

function requirePlan(contexts: Map<string, PlanContext>, cropPlanId: string): PlanContext {
  const context = contexts.get(cropPlanId);
  if (context === undefined) throw new RangeError(`no crop plan ${cropPlanId}`);
  return context;
}

/** Seven days of weather for a week, from the cache, falling back to the bundled snapshot. */
async function weatherForWeek(env: ToolEnv, canalId: string, weekStart: string): Promise<WeatherDay[]> {
  const cached = await getWeather(env, canalId, weekStart, 7);
  if (cached.length >= 7) return cached.slice(0, 7);

  const byDate = new Map(loadDemoWeather().map((day) => [day.date, day]));
  const anchor = Date.parse(`${weekStart}T00:00:00Z`);
  const week: WeatherDay[] = [];
  for (let day = 0; day < 7; day += 1) {
    const iso = new Date(anchor + day * 86_400_000).toISOString().slice(0, 10);
    const weatherDay = byDate.get(iso);
    if (weatherDay !== undefined) week.push(weatherDay);
  }
  return week;
}

/* ------------------------------------------------------------------ contact helpers */

type ContactPurpose = Contact["purpose"];

/** Map a free-text tool purpose onto the contact contract's enum. Deterministic, no model call. */
function contactPurpose(purpose: string): ContactPurpose {
  const text = purpose.toLowerCase();
  if (text.includes("warning") || text.includes("night") || text.includes("release")) return "release_warning";
  if (text.includes("request") || text.includes("update") || text.includes("status")) return "request_update";
  if (text.includes("remind")) return "reminder";
  return "roster_change";
}

function plainContact(record: Contact): Contact {
  return Contact.parse({
    id: record.id,
    farmer_id: record.farmer_id,
    channel: record.channel,
    purpose: record.purpose,
    status: record.status,
    attempt: record.attempt,
    message_te: record.message_te,
    message_en: record.message_en,
    at: record.at,
    ...(record.transcript === undefined ? {} : { transcript: record.transcript }),
  });
}

/** Enqueue an outbound message when the binding is present; a missing queue is not an error. */
async function enqueue(env: ToolEnv, message: Record<string, unknown>): Promise<boolean> {
  if (env.OUTBOUND === undefined) return false;
  await env.OUTBOUND.send(message);
  return true;
}

/* ------------------------------------------------------------------ json schema for the model */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** zod stores its discriminator on `_def.typeName`; there is no public offline introspection API. */
function defOf(schema: unknown): Record<string, unknown> | null {
  const record = asRecord(schema);
  return record === null ? null : asRecord(record["_def"]);
}

function isOptionalLike(schema: unknown): boolean {
  const typeName = defOf(schema)?.["typeName"];
  return typeName === "ZodOptional" || typeName === "ZodDefault";
}

/**
 * Minimal zod → JSON-schema conversion for the shapes `toolSpecs` uses (objects of strings, numbers,
 * booleans, enums, optionals, defaults and arrays). Unknown constructs fall back to `{}`, which the
 * model reads as "any JSON value"; the real gate is always `toolSpecs[name].input.parse`.
 */
function jsonSchemaOf(schema: unknown): Record<string, unknown> {
  const def = defOf(schema);
  if (def === null) return {};
  switch (def["typeName"]) {
    case "ZodObject": {
      const shape = asRecord(def["shape"]);
      if (shape === null) return { type: "object" };
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const key of Object.keys(shape)) {
        properties[key] = jsonSchemaOf(shape[key]);
        if (!isOptionalLike(shape[key])) required.push(key);
      }
      return required.length === 0
        ? { type: "object", properties, additionalProperties: false }
        : { type: "object", properties, required, additionalProperties: false };
    }
    case "ZodString":
      return { type: "string" };
    case "ZodNumber":
      return { type: "number" };
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodEnum": {
      const values = def["values"];
      return { type: "string", enum: Array.isArray(values) ? values : [] };
    }
    case "ZodLiteral":
      return { const: def["value"] };
    case "ZodArray":
      return { type: "array", items: jsonSchemaOf(def["type"]) };
    case "ZodOptional":
    case "ZodDefault":
    case "ZodNullable":
      return jsonSchemaOf(def["innerType"]);
    default:
      return {};
  }
}

/** OpenAI-shaped tool declarations for one agent, filtered by `toolSpecs[*].agent`. */
export function toolSchemasFor(agent: AgentName): unknown[] {
  return TOOL_NAMES.filter((name) => (toolSpecs[name].agent as readonly string[]).includes(agent)).map((name) => ({
    type: "function",
    function: {
      name,
      description: `Jadal ${agent} tool: ${name}`,
      parameters: jsonSchemaOf(toolSpecs[name].input),
    },
  }));
}

/* ------------------------------------------------------------------ registry */

/** A tool's implementation. Inputs are already `toolSpecs[name].input`-validated by `runTool`. */
export type ToolRunner = (env: ToolEnv, input: Record<string, unknown>) => Promise<unknown>;

export interface ToolDefinition {
  readonly agent: readonly AgentName[];
  readonly gated: boolean;
  readonly run: ToolRunner;
}

/** The outcome of one dispatch. `proposal` is present iff the tool is gated. */
export interface ToolOutcome {
  readonly name: ToolName;
  readonly gated: boolean;
  readonly value: unknown;
  readonly proposal?: unknown;
}

/* -- individual runners ------------------------------------------------------- */

async function runCropNeed(env: ToolEnv, input: Record<string, unknown>): Promise<unknown> {
  const cropPlanId = inputString(input, "crop_plan_id");
  const weekStart = inputString(input, "week_start");
  const contexts = await planContexts(env);
  const context = requirePlan(contexts, cropPlanId);
  const canalId = (await canalContext(env)).canal.id;
  const weather = await weatherForWeek(env, canalId, weekStart);
  return cropEngine.weeklyNeed({
    plan: context.plan,
    plot: context.plot,
    params: context.params,
    weather,
    weekStart,
  });
}

async function runWeatherForecast(env: ToolEnv, input: Record<string, unknown>): Promise<unknown> {
  const lat = inputNumber(input, "lat");
  const lon = inputNumber(input, "lon");
  const days = inputNumber(input, "days");
  return getForecast(providerEnvOf(env), lat, lon, days);
}

async function runProposeEntitlements(env: ToolEnv, input: Record<string, unknown>): Promise<unknown> {
  return computeEntitlements(env, inputString(input, "week_start"));
}

async function runHydraulics(env: ToolEnv, input: Record<string, unknown>): Promise<unknown> {
  const headDischarge = inputNumber(input, "head_discharge_m3s");
  const { canal, outlets } = await canalContext(env);
  return {
    velocity_ms: hydraulics.velocity_ms(canal),
    outlets: hydraulics.atOutlets(canal, outlets, headDischarge),
  };
}

async function runOptimizeRoster(env: ToolEnv, input: Record<string, unknown>): Promise<unknown> {
  const releaseWindowId = inputString(input, "release_window_id");
  const mode = inputString(input, "mode");
  if (mode !== "equal_water" && mode !== "equal_hours") {
    throw new RangeError(`mode must be equal_water or equal_hours, got ${mode}`);
  }
  return proposeRoster(env, releaseWindowId, mode);
}

async function runOverrunImpact(env: ToolEnv, input: Record<string, unknown>): Promise<unknown> {
  const outletId = inputString(input, "outlet_id");
  const overrunHours = inputNumber(input, "overrun_h");
  const { canal, outlets } = await canalContext(env);
  return hydraulics.overrunImpact({
    canal,
    outlets,
    overrunOutletId: outletId,
    overrun_h: overrunHours,
    headDischarge_m3s: canal.head_discharge_m3s,
  });
}

async function runCropStageRisk(env: ToolEnv, input: Record<string, unknown>): Promise<unknown> {
  const cropPlanId = inputString(input, "crop_plan_id");
  const contexts = await planContexts(env);
  const context = requirePlan(contexts, cropPlanId);
  const today = (await now(env)).slice(0, 10);
  const daysAfterSowing = daysBetween(context.plan.sowing_date, today);
  const { kc, stage } = cropEngine.kcOnDay(context.params, daysAfterSowing);
  return {
    crop_plan_id: cropPlanId,
    crop: context.plan.crop,
    days_after_sowing: Number.isFinite(daysAfterSowing) ? daysAfterSowing : 0,
    stage,
    kc: round(kc),
    // ASSUMED: the mid stage carries peak Kc (peak water use) in the FAO-56 curve, so it is treated
    // as the stress-sensitive window. This is a qualitative label, not a water number.
    stress_sensitive: stage === "mid",
  };
}

async function runQuotaStatus(env: ToolEnv, input: Record<string, unknown>): Promise<unknown> {
  const farmerId = inputString(input, "farmer_id");
  const balances = ledger.balances(await getLedgerEntries(env));
  const farmer = balances.farmers[farmerId] ?? { quota: 0, delivered: 0 };
  return {
    farmer_id: farmerId,
    quota_m3: round(farmer.quota),
    delivered_m3: round(farmer.delivered),
    undelivered_m3: round(farmer.quota - farmer.delivered),
  };
}

async function runBufferStatus(env: ToolEnv, _input: Record<string, unknown>): Promise<unknown> {
  const balances = ledger.balances(await getLedgerEntries(env));
  return { buffer_m3: round(balances.buffer), conveyance_losses_m3: round(balances.conveyance_losses) };
}

async function runRecommendDecision(_env: ToolEnv, input: Record<string, unknown>): Promise<unknown> {
  return {
    decision: inputString(input, "decision"),
    volume_m3: inputNumber(input, "volume_m3"),
    rationale: inputString(input, "rationale"),
  };
}

async function runPlaceCall(env: ToolEnv, input: Record<string, unknown>): Promise<unknown> {
  const farmerId = inputString(input, "farmer_id");
  const purpose = inputString(input, "purpose");
  const messageTe = inputString(input, "message_te");
  const messageEn = inputString(input, "message_en");
  const at = await now(env);
  const canalId = (await canalContext(env)).canal.id;
  const contact: Contact = Contact.parse({
    id: newId("ctc"),
    farmer_id: farmerId,
    channel: "voice",
    purpose: contactPurpose(purpose),
    status: "queued",
    attempt: 1,
    message_te: messageTe,
    message_en: messageEn,
    at,
  });
  await appendEvent(env, {
    id: newId("evt"),
    at,
    canal_id: canalId,
    actor: { kind: "agent", id: "caller" },
    type: "contact.updated",
    contact,
  });
  const queued = await enqueue(env, {
    kind: "place_call",
    contact_id: contact.id,
    farmer_id: farmerId,
    channel: "voice",
    message_te: messageTe,
    message_en: messageEn,
    at,
  });
  return { contact, queued };
}

async function runSendWhatsapp(env: ToolEnv, input: Record<string, unknown>): Promise<unknown> {
  const farmerId = inputString(input, "farmer_id");
  const messageTe = inputString(input, "message_te");
  const messageEn = inputString(input, "message_en");
  const at = await now(env);
  const canalId = (await canalContext(env)).canal.id;
  const contact: Contact = Contact.parse({
    id: newId("ctc"),
    farmer_id: farmerId,
    channel: "whatsapp",
    purpose: "request_update",
    status: "queued",
    attempt: 1,
    message_te: messageTe,
    message_en: messageEn,
    at,
  });
  await appendEvent(env, {
    id: newId("evt"),
    at,
    canal_id: canalId,
    actor: { kind: "agent", id: "caller" },
    type: "contact.updated",
    contact,
  });
  const queued = await enqueue(env, {
    kind: "send_whatsapp",
    contact_id: contact.id,
    farmer_id: farmerId,
    channel: "whatsapp",
    message_te: messageTe,
    message_en: messageEn,
    at,
  });
  return { contact, queued };
}

async function runRecordAck(env: ToolEnv, input: Record<string, unknown>): Promise<unknown> {
  const contactId = inputString(input, "contact_id");
  const acknowledged = inputBoolean(input, "acknowledged");
  const transcript = inputString(input, "transcript");
  const existing = await getContact(env, contactId);
  if (existing === null) throw new RangeError(`no contact ${contactId}`);
  const updated: Contact = Contact.parse({
    ...plainContact(existing),
    status: acknowledged ? "acknowledged" : existing.status,
    transcript,
  });
  const at = await now(env);
  await appendEvent(env, {
    id: newId("evt"),
    at,
    canal_id: (await canalContext(env)).canal.id,
    actor: { kind: "agent", id: "caller" },
    type: "contact.updated",
    contact: updated,
  });
  return updated;
}

async function runLedgerInvariants(env: ToolEnv, _input: Record<string, unknown>): Promise<unknown> {
  const entries = await getLedgerEntries(env);
  const balances = ledger.balances(entries);
  const canalId = (await canalContext(env)).canal.id;
  const season = await getSeason(env, canalId);
  const supply = season?.season_supply_m3 ?? balances.canal_supply;
  const conservation = ledger.checkConservation(entries, supply, season?.tolerance_m3);
  return {
    ok: conservation.ok,
    diff_m3: conservation.diff_m3,
    season_supply_m3: round(supply),
    entry_count: entries.length,
    balances,
  };
}

async function runDeliveredVsPlanned(env: ToolEnv, input: Record<string, unknown>): Promise<unknown> {
  const rosterId = optionalString(input, "roster_id");
  const rosters = await listRosters(env);
  const balances = ledger.balances(await getLedgerEntries(env));
  const chosen = rosterId === undefined ? rosters : rosters.filter((roster) => roster.id === rosterId);
  return chosen.map((roster) => {
    const planned = new Map<string, number>();
    for (const turn of roster.turns) {
      planned.set(turn.farmer_id, (planned.get(turn.farmer_id) ?? 0) + turn.planned_volume_m3);
    }
    const farmers = [...planned.keys()].sort().map((farmer_id) => {
      const planned_m3 = round(planned.get(farmer_id) ?? 0);
      const delivered_m3 = round(balances.farmers[farmer_id]?.delivered ?? 0);
      return { farmer_id, planned_m3, delivered_m3, gap_m3: round(delivered_m3 - planned_m3) };
    });
    return { roster_id: roster.id, status: roster.status, farmers };
  });
}

/* -- the runners table -------------------------------------------------------- */

/**
 * A total record over every `toolSpecs` key: adding a tool to the contract fails this file's
 * typecheck until a runner exists, so the registry can never silently omit one.
 */
const runners: Record<ToolName, ToolRunner> = {
  crop_need: runCropNeed,
  weather_forecast: runWeatherForecast,
  propose_entitlements: runProposeEntitlements,
  hydraulics: runHydraulics,
  optimize_roster: runOptimizeRoster,
  overrun_impact: runOverrunImpact,
  crop_stage_risk: runCropStageRisk,
  quota_status: runQuotaStatus,
  buffer_status: runBufferStatus,
  recommend_decision: runRecommendDecision,
  place_call: runPlaceCall,
  send_whatsapp: runSendWhatsapp,
  record_ack: runRecordAck,
  ledger_invariants: runLedgerInvariants,
  delivered_vs_planned: runDeliveredVsPlanned,
};

/**
 * The registry, assembled from `toolSpecs` so `agent`/`gated` are the contract's values, never a
 * second copy. A test asserts `Object.keys(tools)` equals `Object.keys(toolSpecs)`.
 */
export const tools: Record<ToolName, ToolDefinition> = Object.fromEntries(
  TOOL_NAMES.map((name) => [
    name,
    { agent: toolSpecs[name].agent, gated: toolSpecs[name].gated, run: runners[name] },
  ]),
) as unknown as Record<ToolName, ToolDefinition>;

/* ------------------------------------------------------------------ dispatch */

/**
 * Validate `rawInput` against the contract, run the tool, and centralise gating.
 *
 * Input validation happens *before* the runner: a tool never sees an input the contract rejects.
 * For a gated tool the return value is wrapped as a proposal and is not applied — the loop records
 * it and waits for the coordinator.
 *
 * @throws {RangeError} for an unknown tool name.
 * @throws {import("zod").ZodError} when the input does not satisfy `toolSpecs[name].input`.
 */
export async function runTool(env: ToolEnv, name: string, rawInput: unknown): Promise<ToolOutcome> {
  if (!isToolName(name)) throw new RangeError(`unknown tool: ${name}`);
  const definition = tools[name];
  const input = toolSpecs[name].input.parse(rawInput) as Record<string, unknown>;
  const value = await definition.run(env, input);
  if (definition.gated) return { name, gated: true, value, proposal: value };
  return { name, gated: false, value };
}
