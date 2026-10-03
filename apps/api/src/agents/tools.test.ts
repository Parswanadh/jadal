/**
 * Tool-registry tests (B5).
 *
 * The registry must be exactly the contract's `toolSpecs` — same keys, same `agent`, same `gated` —
 * and every non-network tool must return a value that satisfies its contract shape. Inputs are
 * validated before a runner executes, so a malformed call throws rather than reaching core.
 *
 * NO NETWORK: the weather tool's request is mocked through `test/harness.ts`; every other tool reads
 * the seeded SQLite shim.
 */

import { describe, expect, it } from "vitest";

import { Contact, Entitlement, Roster, WaterRequest, routes, toolSpecs } from "@jadal/contracts";
import { createEnv, readMigrations, type FetchRoutes, type TestEnv } from "../../test/harness";
import { demoScenario, demoWeather, seedScenario, seedWeather } from "../../test/fixtures";
import { newId } from "../db/id";
import { appendEvent, getEventCount } from "../db/store";
import { callerTurn } from "./caller";
import { assessRequest } from "./request-assessor";
import { runTool, tools } from "./tools";

/* ------------------------------------------------------------------ helpers */

async function seeded(routes: FetchRoutes = {}): Promise<TestEnv> {
  const env = createEnv(routes);
  for (const migration of readMigrations()) await env.DB.exec(migration);
  const scenario = demoScenario();
  const weather = demoWeather();
  await seedScenario(env, scenario, weather);
  await seedWeather(env, weather, scenario.canal.id);
  return env;
}

const WEEK = "2026-09-14";

async function seedApprovedRequest(env: TestEnv, farmerId: string): Promise<void> {
  const request = WaterRequest.parse({
    id: newId("req"),
    farmer_id: farmerId,
    type: "urgent",
    volume_m3: 100,
    reason: "paddy leaves yellowing and the soil is cracking",
    channel: "voice",
    status: "raised",
    raised_at: "2026-09-14T06:00:00Z",
  });
  await appendEvent(env, {
    id: newId("evt"),
    at: "2026-09-14T06:00:00Z",
    canal_id: "c1",
    actor: { kind: "farmer", id: farmerId },
    type: "request.raised",
    request,
  });
  await appendEvent(env, {
    id: newId("evt"),
    at: "2026-09-14T06:00:00Z",
    canal_id: "c1",
    actor: { kind: "coordinator", id: "coord-1" },
    type: "request.decided",
    request_id: request.id,
    decision: "approve",
    volume_m3: 100,
  });
}

/* ------------------------------------------------------------------ registry integrity */

describe("tool registry", () => {
  it("has exactly the contract's tools", () => {
    expect(Object.keys(tools).sort()).toEqual(Object.keys(toolSpecs).sort());
  });

  it("copies agent and gated flags from the contract", () => {
    for (const name of Object.keys(toolSpecs) as (keyof typeof toolSpecs)[]) {
      expect(tools[name].gated).toBe(toolSpecs[name].gated);
      expect([...tools[name].agent].sort()).toEqual([...toolSpecs[name].agent].sort());
    }
  });

  it("validates input before running the tool", async () => {
    const env = await seeded();
    await expect(runTool(env, "crop_need", { crop_plan_id: 123 })).rejects.toThrow();
    await expect(runTool(env, "not_a_tool", {})).rejects.toThrow(/unknown tool/);
  });
});

/* ------------------------------------------------------------------ contract-shaped results */

describe("tool results", () => {
  it("each non-network tool returns a contract-shaped value", async () => {
    const env = await seeded();
    await seedApprovedRequest(env, "f1");

    const entitlements = await runTool(env, "propose_entitlements", { week_start: WEEK });
    expect(routes.suggestEntitlements.response.parse(entitlements.value)).toBeTruthy();

    const roster = await runTool(env, "optimize_roster", { release_window_id: "rw1", mode: "equal_water" });
    expect(routes.proposeRoster.response.parse(roster.value)).toBeTruthy();

    const recommendation = await runTool(env, "recommend_decision", {
      request_id: "req_1",
      decision: "approve",
      volume_m3: 120,
      rationale: "The crop is at the flowering stage.",
    });
    expect(recommendation.value).toMatchObject({ decision: "approve", volume_m3: 120 });

    const need = await runTool(env, "crop_need", { crop_plan_id: "cp1", week_start: WEEK });
    expect(need.value).toMatchObject({ crop_plan_id: "cp1", week_start: WEEK });
    expect((need.value as { volume_m3: number }).volume_m3).toBeGreaterThanOrEqual(0);

    const canal = await runTool(env, "hydraulics", { head_discharge_m3s: 0.15 });
    expect(Array.isArray((canal.value as { outlets: unknown[] }).outlets)).toBe(true);

    const impact = await runTool(env, "overrun_impact", { outlet_id: "o1", overrun_h: 1 });
    expect(Array.isArray(impact.value)).toBe(true);

    const risk = await runTool(env, "crop_stage_risk", { crop_plan_id: "cp1" });
    expect((risk.value as { stage: string }).stage.length).toBeGreaterThan(0);

    const quota = await runTool(env, "quota_status", { farmer_id: "f1" });
    expect(typeof (quota.value as { quota_m3: number }).quota_m3).toBe("number");

    const buffer = await runTool(env, "buffer_status", {});
    expect(typeof (buffer.value as { buffer_m3: number }).buffer_m3).toBe("number");

    const invariants = await runTool(env, "ledger_invariants", {});
    expect(typeof (invariants.value as { ok: boolean }).ok).toBe("boolean");

    const delivered = await runTool(env, "delivered_vs_planned", {});
    expect(Array.isArray(delivered.value)).toBe(true);

    const call = await runTool(env, "place_call", { farmer_id: "f1", purpose: "reminder", message_te: "జడల్", message_en: "Jadal" });
    const callContact = Contact.parse((call.value as { contact: unknown }).contact);
    expect(callContact.channel).toBe("voice");

    const whatsapp = await runTool(env, "send_whatsapp", { farmer_id: "f1", message_te: "జడల్", message_en: "Jadal" });
    expect(Contact.parse((whatsapp.value as { contact: unknown }).contact).channel).toBe("whatsapp");

    // `record_ack` needs an existing contact; the call above created one.
    const ack = await runTool(env, "record_ack", { contact_id: callContact.id, acknowledged: true, transcript: "సరే" });
    const acked = Contact.parse(ack.value);
    expect(acked.status).toBe("acknowledged");
    expect(acked.transcript).toBe("సరే");
  });

  it("places a call on the outbound queue and appends a contact.updated event", async () => {
    const env = await seeded();
    await seedApprovedRequest(env, "f2");
    const before = await getEventCount(env);
    const outcome = await runTool(env, "place_call", { farmer_id: "f2", purpose: "night release warning", message_te: "జడల్", message_en: "Jadal" });

    expect(await getEventCount(env)).toBe(before + 1);
    expect(env.OUTBOUND.sent).toHaveLength(1);
    expect((outcome.value as { queued: boolean }).queued).toBe(true);
  });

  it("sends a WhatsApp message via the Meta Graph API when credentials are set", async () => {
    const env = await seeded({
      "graph.facebook.com": {
        messages: [{ id: "wamid.123" }],
      },
    });
    env.META_WHATSAPP_TOKEN = "test-token";
    env.META_PHONE_NUMBER_ID = "test-phone-id";

    const outcome = await runTool(env, "send_whatsapp", { farmer_id: "f1", message_te: "జడల్", message_en: "Jadal" });
    const value = outcome.value as { whatsapp: { ok: boolean; messageId?: string } };

    expect(value.whatsapp.ok).toBe(true);
    expect(value.whatsapp.messageId).toBe("wamid.123");
    expect(env.calls).toHaveLength(1);
    const call = env.calls[0]!;
    expect(call.url).toContain("graph.facebook.com");
    expect(call.url).toContain("test-phone-id");
    expect(call.method).toBe("POST");
    expect(call.headers.Authorization).toBe("Bearer test-token");
  });

  it("falls back to event-log behavior when WhatsApp credentials are not set", async () => {
    const env = await seeded();
    const before = await getEventCount(env);

    const outcome = await runTool(env, "send_whatsapp", { farmer_id: "f1", message_te: "జడల్", message_en: "Jadal" });
    const value = outcome.value as { contact: unknown; queued: boolean; whatsapp?: unknown };

    expect(value.whatsapp).toBeUndefined();
    expect(Contact.parse(value.contact).channel).toBe("whatsapp");
    expect(value.queued).toBe(true);
    expect(await getEventCount(env)).toBe(before + 1);
    expect(env.calls).toHaveLength(0);
  });

  it("fetches a mocked forecast without touching the network", async () => {
    const env = await seeded({
      "api.open-meteo.com": {
        daily: {
          time: ["2026-09-14", "2026-09-15"],
          et0_fao_evapotranspiration: [4.2, 4.5],
          precipitation_sum: [0, 2],
          temperature_2m_max: [32, 33],
          temperature_2m_min: [24, 24],
        },
      },
    });
    const forecast = await runTool(env, "weather_forecast", { lat: 16.3, lon: 80.4, days: 7 });
    expect(Array.isArray(forecast.value)).toBe(true);
    expect((forecast.value as unknown[]).length).toBeGreaterThan(0);
    expect(env.calls.every((call) => call.url.includes("api.open-meteo.com"))).toBe(true);
  });

  it("prices entitlements and rosters as valid contract entities", async () => {
    const env = await seeded();
    const suggestion = await runTool(env, "propose_entitlements", { week_start: WEEK });
    const parsed = routes.suggestEntitlements.response.parse(suggestion.value);
    for (const entitlement of parsed.entitlements) Entitlement.parse(entitlement);

    const proposal = await runTool(env, "optimize_roster", { release_window_id: "rw1", mode: "equal_hours" });
    Roster.parse(routes.proposeRoster.response.parse(proposal.value).roster);
  });
});

/* ------------------------------------------------------------------ the route-facing agents */

describe("request assessor and caller", () => {
  it("assesses an urgent request with the volume the policy grants", async () => {
    const env = await seeded();
    const request = WaterRequest.parse({
      id: newId("req"),
      farmer_id: "f1",
      type: "urgent",
      volume_m3: 100,
      reason: "paddy leaves yellowing and the soil is cracking",
      channel: "voice",
      status: "raised",
      raised_at: "2026-09-14T06:00:00Z",
    });
    await appendEvent(env, {
      id: newId("evt"),
      at: "2026-09-14T06:00:00Z",
      canal_id: "c1",
      actor: { kind: "farmer", id: "f1" },
      type: "request.raised",
      request,
    });

    const assessment = await assessRequest(env, request.id);
    expect(assessment.decision).toBe("approve");
    expect(assessment.volume_m3).toBe(100);
    expect(assessment.rationale.length).toBeGreaterThan(0);
    expect(env.calls).toHaveLength(0);
  });

  it("records a caller acknowledgement and renders a Telugu reply", async () => {
    const env = await seeded();
    await seedApprovedRequest(env, "f1");
    const call = await runTool(env, "place_call", { farmer_id: "f1", purpose: "reminder", message_te: "జడల్", message_en: "Jadal" });
    const contact = Contact.parse((call.value as { contact: unknown }).contact);

    const turn = await callerTurn(env, contact.id, { text: "సరే అండీ" });
    expect(turn.contact.status).toBe("acknowledged");
    expect(turn.agent_reply_te).toMatch(/[\u0C00-\u0C7F]/);
    expect(turn.agent_reply_en.length).toBeGreaterThan(0);
    // No Sarvam key in the harness: synthesis is skipped, never attempted.
    expect(turn.audio_base64).toBeUndefined();
    expect(env.calls).toHaveLength(0);
  });
});
