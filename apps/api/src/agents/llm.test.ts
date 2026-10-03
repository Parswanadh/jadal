/**
 * Tests for the OpenRouter chat client's spending guard.
 *
 * NO NETWORK. Every call goes through an injected `env.fetch`; a test that asserts it was never
 * called is a real proof the spend limit short-circuited before the provider was reached.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  chat,
  estimateCostUsd,
  isOverSpendLimit,
  recordSpendUsd,
  resetSpendTracker,
  spendLimitUsd,
  spentUsd,
  type AgentEnv,
} from "./llm";

const OK_CHAT = {
  choices: [{ message: { role: "assistant", content: "hello" } }],
  usage: { prompt_tokens: 1_000, completion_tokens: 500 },
};

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function envWith(
  fetchImpl: AgentEnv["fetch"],
  extra: Partial<AgentEnv> = {},
): AgentEnv {
  return { OPENROUTER_API_KEY: "test-key", fetch: fetchImpl, ...extra } as unknown as AgentEnv;
}

describe("spend limit configuration", () => {
  it("parses a positive limit and treats blank, unset or invalid as no limit", () => {
    expect(spendLimitUsd({})).toBeNull();
    expect(spendLimitUsd({ OPENROUTER_SPEND_LIMIT_USD: "  " })).toBeNull();
    expect(spendLimitUsd({ OPENROUTER_SPEND_LIMIT_USD: "abc" })).toBeNull();
    expect(spendLimitUsd({ OPENROUTER_SPEND_LIMIT_USD: "-1" })).toBeNull();
    expect(spendLimitUsd({ OPENROUTER_SPEND_LIMIT_USD: "5" })).toBe(5);
    expect(spendLimitUsd({ OPENROUTER_SPEND_LIMIT_USD: "0" })).toBe(0);
  });
});

describe("cumulative spend tracker", () => {
  beforeEach(() => resetSpendTracker());

  it("accumulates only finite positive amounts", () => {
    recordSpendUsd(0.5);
    recordSpendUsd(-1);
    recordSpendUsd(Number.NaN);
    recordSpendUsd(0.25);
    expect(spentUsd()).toBeCloseTo(0.75);
  });

  it("is over the limit once cumulative spend reaches it", () => {
    const env = { OPENROUTER_SPEND_LIMIT_USD: "1" };
    expect(isOverSpendLimit(env)).toBe(false);
    recordSpendUsd(0.99);
    expect(isOverSpendLimit(env)).toBe(false);
    recordSpendUsd(0.01);
    expect(isOverSpendLimit(env)).toBe(true);
  });

  it("never limits when no limit is configured", () => {
    recordSpendUsd(1_000);
    expect(isOverSpendLimit({})).toBe(false);
  });

  it("a zero limit is reached immediately", () => {
    expect(isOverSpendLimit({ OPENROUTER_SPEND_LIMIT_USD: "0" })).toBe(true);
  });
});

describe("estimateCostUsd", () => {
  it("prefers a cost the provider reported", () => {
    expect(estimateCostUsd("x", { cost: 0.42, input_tokens: 10 })).toBeCloseTo(0.42);
  });

  it("estimates from tokens for a known model", () => {
    // gpt-4o-mini: $0.15/M input, $0.60/M output => $0.75 for 1M of each.
    expect(
      estimateCostUsd("openai/gpt-4o-mini", { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 }),
    ).toBeCloseTo(0.75);
  });

  it("accepts both chat and decisions token spellings", () => {
    expect(estimateCostUsd("openai/gpt-4o-mini", { input_tokens: 1_000_000 })).toBeCloseTo(0.15);
  });

  it("returns 0 for missing usage", () => {
    expect(estimateCostUsd("openai/gpt-4o-mini", undefined)).toBe(0);
  });
});

describe("chat spend gate", () => {
  beforeEach(() => resetSpendTracker());

  it("records spend from a successful response's usage", async () => {
    const env = envWith(async () => json(OK_CHAT));
    const result = await chat(env, { system: "s", messages: [] });
    expect(result.source).toBe("llm");
    expect(spentUsd()).toBeGreaterThan(0);
  });

  it("does not call the provider once the limit is reached", async () => {
    let calls = 0;
    const env = envWith(
      async () => {
        calls += 1;
        return json(OK_CHAT);
      },
      { OPENROUTER_SPEND_LIMIT_USD: "0.0001" },
    );
    recordSpendUsd(0.0002);

    const result = await chat(env, { system: "s", messages: [] });

    expect(result.source).toBe("fallback");
    expect(calls).toBe(0);
  });
});
