/**
 * Loop tests (B5).
 *
 * NO NETWORK. `test/harness.ts`'s `createEnv` throws on any URL it has not been given a canned
 * response for, so every test here either mocks `openrouter.ai` explicitly or asserts
 * `env.calls.length === 0`. A loop that reached the network would fail loudly.
 */

import { describe, expect, it } from "vitest";

import { WaterRequest } from "@jadal/contracts";
import { createEnv, readMigrations, type FetchRoutes, type TestEnv } from "../../test/harness";
import { demoScenario, demoWeather, seedScenario, seedWeather } from "../../test/fixtures";
import { newId } from "../db/id";
import { appendEvent, getEventCount } from "../db/store";
import { runAgent } from "./loop";
import type { ToolEnv } from "./tools";

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

/** The same env with an OpenRouter key, so `chat` actually POSTs to the mocked route. */
function withKey(env: TestEnv): ToolEnv {
  return { ...env, OPENROUTER_API_KEY: "test-key" };
}

interface MockToolCall {
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
}

function toolCallResponse(calls: readonly MockToolCall[], content: string | null = null): unknown {
  return {
    choices: [
      {
        message: {
          content,
          tool_calls: calls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.args) },
          })),
        },
      },
    ],
  };
}

function textResponse(content: string): unknown {
  return { choices: [{ message: { content } }] };
}

/* ------------------------------------------------------------------ tests */

describe("runAgent", () => {
  it("falls back deterministically with zero network calls when no key is configured", async () => {
    const env = createEnv();
    const result = await runAgent(env, { name: "need", system: "s", goal: "suggest the week" });

    expect(result.source).toBe("fallback");
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.toolCalls).toHaveLength(0);
    expect(env.calls).toHaveLength(0);
  });

  it("executes a mocked tool call and feeds the result back to the model", async () => {
    let turn = 0;
    const env = await seeded({
      "openrouter.ai": () => {
        turn += 1;
        return turn === 1 ? toolCallResponse([{ id: "call_1", name: "buffer_status", args: {} }]) : textResponse("The buffer is healthy.");
      },
    });

    const result = await runAgent(withKey(env), { name: "auditor", system: "s", goal: "check the buffer" });

    expect(result.source).toBe("llm");
    expect(result.text).toBe("The buffer is healthy.");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe("buffer_status");
    expect(result.steps.some((step) => step.type === "tool" && step.name === "buffer_status")).toBe(true);

    // The second model call must carry the tool result back: the request body is the JSON sent.
    const secondBody = env.calls[1]?.body;
    expect(typeof secondBody).toBe("string");
    expect(String(secondBody)).toContain('"role":"tool"');
    expect(String(secondBody)).toContain("buffer_m3");
  });

  it("stops a looping model at maxSteps", async () => {
    let turn = 0;
    const env = await seeded({
      "openrouter.ai": () => {
        turn += 1;
        return toolCallResponse([{ id: `call_${turn}`, name: "delivered_vs_planned", args: { roster_id: `r${turn}` } }]);
      },
    });

    const result = await runAgent(withKey(env), { name: "auditor", system: "s", goal: "loop", maxSteps: 3 });

    expect(env.calls).toHaveLength(3);
    expect(result.steps.some((step) => step.type === "cap" && step.detail.includes("maxSteps"))).toBe(true);
    // Every executed call was a real, distinct tool call; the cap is what ended the run.
    expect(result.source).toBe("llm");
    expect(result.toolCalls).toHaveLength(3);
  });

  it("refuses to re-run an identical (name, args) call", async () => {
    const env = await seeded({
      "openrouter.ai": () => {
        // The model asks for the same call twice in one turn; the second must not execute.
        return toolCallResponse([
          { id: "call_1", name: "place_call", args: { farmer_id: "f1", purpose: "reminder", message_te: "జడల్", message_en: "Jadal" } },
          { id: "call_2", name: "place_call", args: { farmer_id: "f1", purpose: "reminder", message_te: "జడల్", message_en: "Jadal" } },
        ]);
      },
    });

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

    const before = await getEventCount(env);
    const result = await runAgent(withKey(env), { name: "caller", system: "s", goal: "call twice", maxSteps: 1 });

    expect(result.steps.some((step) => step.type === "refused")).toBe(true);
    expect(await getEventCount(env)).toBe(before + 1);
  });

  it("returns a gated tool as a proposal without changing state", async () => {
    const env = await seeded({
      "openrouter.ai": () =>
        toolCallResponse([{ id: "call_1", name: "propose_entitlements", args: { week_start: "2026-09-14" } }]),
    });

    const before = await getEventCount(env);
    const result = await runAgent(withKey(env), { name: "need", system: "s", goal: "propose the week", maxSteps: 1 });

    expect(result.proposal?.tool).toBe("propose_entitlements");
    expect(result.toolCalls[0]?.gated).toBe(true);
    expect(result.steps.some((step) => step.type === "tool" && step.detail.includes("not committed"))).toBe(true);
    expect(await getEventCount(env)).toBe(before);
  });
});
