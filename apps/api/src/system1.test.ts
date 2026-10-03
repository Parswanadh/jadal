/**
 * Tests for the System-1 provider abstraction: Laya (local sidecar) -> Jev (OpenRouter Decisions
 * API) -> Telugu keyword rules.
 *
 * NO NETWORK. Every provider call goes through an injected `env.fetch`; the stub records each call
 * and returns canned bytes. A test that asserts `calls.length === 0` is therefore a real proof that
 * a code path never reached the network (which is the `SYSTEM1_PROVIDER=rules` guarantee).
 *
 * The request bodies are asserted as wire formats, not implementation details: the Decisions API
 * rejects a wrong `type` or a missing `criteria` with a 400, so a test that only checked the parsed
 * result would pass while the real call fails.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  JEV_DEFAULT_TIMEOUT_MS,
  JEV_MODEL,
  JEV_TIMEOUT_MAX_MS,
  JEV_TIMEOUT_MIN_MS,
  LAYA_DEFAULT_TIMEOUT_MS,
  LAYA_TIMEOUT_MAX_MS,
  LAYA_TIMEOUT_MIN_MS,
  OPENROUTER_DECISIONS_URL,
  SYSTEM1_PROVIDERS,
  URGENCY_LEVELS,
  URGENCY_MAX_INDEX,
  buildJevQuestions,
  buildJevRequest,
  buildLayaQuestions,
  buildLayaRequest,
  classify,
  classifyByRules,
  classifyDetailed,
  gatewayUrl,
  jevEnabled,
  parseJevDecision,
  parseLayaDecision,
  parseProviderSetting,
  providerConfigured,
  resolveJevTimeoutMs,
  resolveLayaTimeoutMs,
  resolveProviderChain,
  type ProviderEnv,
} from "./system1";
import { recordSpendUsd, resetSpendTracker, spentUsd } from "./agents/llm";

/* ------------------------------------------------------------------ helpers */

const LAYA_DECIDE = "http://127.0.0.1:8099/decide";
const LAYA_OK = {
  intent: "urgent_request",
  urgency: 0.9,
  is_release_time: true,
  source: "laya",
  latency_ms: 42,
};

const JEV_OK = {
  id: "gen-dec-1790015143-AIaTutprXsJ5EwohRSjb",
  model: "typesafe/jev-1.13-20260917",
  provider: "TypeSafe",
  answers: {
    intent: {
      type: "choice",
      choice: "urgent_request",
      confidence: 0.91,
      probabilities: { urgent_request: 0.91, other: 0.09 },
    },
    urgency: {
      type: "score",
      score: 4,
      confidence: 0.97,
      probabilities: { "0": 0, "1": 0, "2": 0, "3": 0.03, "4": 0.97 },
      legend: { "4": URGENCY_LEVELS[4] },
    },
    mentions_crop_stress: { type: "noul", noul: 0.96 },
  },
  usage: { input_tokens: 476, output_tokens: 70, cost: 0.000019992 },
};

interface StubCall {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

type Responder = (call: StubCall) => Response | Promise<Response>;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function raw(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

/** An env whose `fetch` records calls and never touches the network. */
function stubEnv(responder: Responder, extra: Partial<ProviderEnv> = {}): ProviderEnv & { calls: StubCall[] } {
  const calls: StubCall[] = [];
  const base = {
    OPENROUTER_API_KEY: "test-openrouter-key",
    fetch: async (
      input: string,
      init?: { method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal },
    ): Promise<Response> => {
      const call: StubCall = {
        url: input,
        method: init?.method ?? "GET",
        body: init?.body,
        headers: init?.headers ?? {},
      };
      calls.push(call);
      return responder(call);
    },
  };
  return Object.assign(base, extra, { calls }) as ProviderEnv & { calls: StubCall[] };
}

/** Both model providers configured and routed by URL. */
function bothProviders(responder: Responder, extra: Partial<ProviderEnv> = {}) {
  return stubEnv(responder, { LAYA_ENDPOINT: LAYA_DECIDE, ...extra });
}

const NEVER: Responder = () => new Promise<Response>(() => {});

/* ------------------------------------------------------------------ provider selection */

describe("provider selection", () => {
  it("treats unset or blank SYSTEM1_PROVIDER as auto", () => {
    expect(parseProviderSetting(undefined)).toBe("auto");
    expect(parseProviderSetting("")).toBe("auto");
    expect(parseProviderSetting("   ")).toBe("auto");
  });

  it("accepts the four documented values, case- and space-insensitively", () => {
    expect(parseProviderSetting("laya")).toBe("laya");
    expect(parseProviderSetting(" JEV ")).toBe("jev");
    expect(parseProviderSetting("Rules")).toBe("rules");
    expect(parseProviderSetting("auto")).toBe("auto");
  });

  it("degrades an unrecognised spelling to rules rather than spending network calls", () => {
    expect(parseProviderSetting("layah")).toBe("rules");
    expect(parseProviderSetting("openrouter")).toBe("rules");
  });

  it("orders auto as laya, jev, rules", () => {
    expect(resolveProviderChain({})).toEqual(["laya", "jev", "rules"]);
    expect(SYSTEM1_PROVIDERS).toEqual(["laya", "jev", "rules"]);
  });

  it("leads with an explicitly named provider and keeps the rest as backup", () => {
    expect(resolveProviderChain({ SYSTEM1_PROVIDER: "jev" })).toEqual(["jev", "laya", "rules"]);
    expect(resolveProviderChain({ SYSTEM1_PROVIDER: "laya" })).toEqual(["laya", "jev", "rules"]);
  });

  it("makes explicit rules a single-link offline chain", () => {
    expect(resolveProviderChain({ SYSTEM1_PROVIDER: "rules" })).toEqual(["rules"]);
  });

  it("reports which providers are configured", () => {
    expect(providerConfigured("rules", {})).toBe(true);
    expect(providerConfigured("laya", {})).toBe(false);
    expect(providerConfigured("laya", { LAYA_ENDPOINT: LAYA_DECIDE })).toBe(true);
    expect(providerConfigured("jev", {})).toBe(false);
    expect(providerConfigured("jev", { OPENROUTER_API_KEY: "k" })).toBe(true);
  });

  it("jevEnabled is false without a key and true with one", () => {
    expect(jevEnabled({})).toBe(false);
    expect(jevEnabled({ OPENROUTER_API_KEY: "" })).toBe(false);
    expect(jevEnabled({ OPENROUTER_API_KEY: "   " })).toBe(false);
    expect(jevEnabled({ OPENROUTER_API_KEY: "sk-or-test" })).toBe(true);
  });
});

describe("timeouts", () => {
  it("uses the documented defaults when nothing is set", () => {
    expect(resolveJevTimeoutMs({}, {})).toBe(JEV_DEFAULT_TIMEOUT_MS);
    expect(resolveLayaTimeoutMs({}, {})).toBe(LAYA_DEFAULT_TIMEOUT_MS);
  });

  it("clamps an env override into a sane band", () => {
    expect(resolveJevTimeoutMs({ JEV_TIMEOUT_MS: "10" }, {})).toBe(JEV_TIMEOUT_MIN_MS);
    expect(resolveJevTimeoutMs({ JEV_TIMEOUT_MS: "999999" }, {})).toBe(JEV_TIMEOUT_MAX_MS);
    expect(resolveJevTimeoutMs({ JEV_TIMEOUT_MS: "1200" }, {})).toBe(1200);
    expect(resolveLayaTimeoutMs({ LAYA_TIMEOUT_MS: "1" }, {})).toBe(LAYA_TIMEOUT_MIN_MS);
    expect(resolveLayaTimeoutMs({ LAYA_TIMEOUT_MS: "999999" }, {})).toBe(LAYA_TIMEOUT_MAX_MS);
  });

  it("ignores an unparseable env override and lets opts.timeoutMs win verbatim", () => {
    expect(resolveJevTimeoutMs({ JEV_TIMEOUT_MS: "soon" }, {})).toBe(JEV_DEFAULT_TIMEOUT_MS);
    expect(resolveJevTimeoutMs({ JEV_TIMEOUT_MS: "10" }, { timeoutMs: 25 })).toBe(25);
    expect(resolveJevTimeoutMs({ JEV_TIMEOUT_MS: "999999" }, { timeoutMs: 30 })).toBe(30);
  });
});

/* ------------------------------------------------------------------ wire shapes */

describe("request wire shapes", () => {
  it("builds the Decisions body with exactly model/state/questions", () => {
    const body = buildJevRequest("నీళ్లు లేవు", "~typesafe/jev-latest");
    expect(Object.keys(body).sort()).toEqual(["model", "questions", "state"]);
    expect(body.model).toBe("~typesafe/jev-latest");
    expect(body.state).toBe("నీళ్లు లేవు");
    // The old chat-completions shape is gone: Jev returns typed answers, not message content.
    expect(body).not.toHaveProperty("messages");
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("response_format");
  });

  it("defaults the Jev model to the pinned release", () => {
    expect(buildJevRequest("hi").model).toBe(JEV_MODEL);
    expect(JEV_MODEL).toBe("typesafe/jev-1.13");
  });

  it("asks the three typed questions with the criteria each type requires", () => {
    const questions = buildJevQuestions();
    expect(questions.intent.type).toBe("choice");
    expect(Object.keys(questions.intent.criteria).sort()).toEqual([
      "acknowledge",
      "buffer_request",
      "harvested",
      "not_needed_this_week",
      "other",
      "schedule_question",
      "urgent_request",
    ]);
    expect(questions.urgency.type).toBe("score");
    expect(questions.urgency.criteria).toEqual(URGENCY_LEVELS);
    expect(questions.mentions_crop_stress.type).toBe("noul");
    expect(questions.mentions_crop_stress.criteria?.true).toBeTruthy();
    expect(questions.mentions_crop_stress.criteria?.false).toBeTruthy();
    expect(URGENCY_MAX_INDEX).toBe(URGENCY_LEVELS.length - 1);
  });

  it("builds the Laya sidecar body as { text, questions } with the ids the sidecar maps on", () => {
    const body = buildLayaRequest("పంట ఎండిపోతుంది");
    expect(Object.keys(body).sort()).toEqual(["questions", "text"]);
    expect(body.text).toBe("పంట ఎండిపోతుంది");
    expect(body.questions).toEqual(buildLayaQuestions());
    // `services/laya` refuses a request whose questions omit any of these ids.
    expect(Object.keys(body.questions).sort()).toEqual([
      "intent",
      "is_release_time",
      "mentions_crop_stress",
      "urgency",
    ]);
    expect(body.questions.is_release_time.type).toBe("noul");
  });

  it("prefixes the OpenRouter URL with the AI Gateway and leaves a local sidecar alone", () => {
    const gateway = "https://gateway.ai.cloudflare.com/v1/acct/gw";
    expect(gatewayUrl({ AI_GATEWAY_URL: gateway }, OPENROUTER_DECISIONS_URL)).toBe(
      `${gateway}/${OPENROUTER_DECISIONS_URL}`,
    );
    expect(gatewayUrl({ AI_GATEWAY_URL: `${gateway}/` }, OPENROUTER_DECISIONS_URL)).toBe(
      `${gateway}/${OPENROUTER_DECISIONS_URL}`,
    );
    expect(gatewayUrl({}, OPENROUTER_DECISIONS_URL)).toBe(OPENROUTER_DECISIONS_URL);
  });
});

/* ------------------------------------------------------------------ Jev parsing */

describe("parseJevDecision", () => {
  it("reads the documented Decisions response", () => {
    expect(parseJevDecision(JEV_OK)).toEqual({
      intent: "urgent_request",
      intentConfidence: 0.91,
      urgency: 1,
      stressProbability: 0.96,
    });
  });

  it("normalises a score on the criteria index scale to 0..1", () => {
    const payload = {
      answers: {
        intent: { type: "choice", choice: "buffer_request", confidence: 0.6 },
        urgency: { type: "score", score: 2 },
        mentions_crop_stress: { type: "noul", noul: 0.4 },
      },
    };
    expect(parseJevDecision(payload)).toEqual({
      intent: "buffer_request",
      intentConfidence: 0.6,
      urgency: 0.5,
      stressProbability: 0.4,
    });
  });

  it("falls back to the top probability when confidence is absent", () => {
    const payload = {
      answers: {
        intent: { type: "choice", choice: "harvested", probabilities: { harvested: 0.7, other: 0.3 } },
        urgency: { type: "score", score: 1 },
        mentions_crop_stress: { type: "noul", noul: 0.2 },
      },
    };
    expect(parseJevDecision(payload)?.intentConfidence).toBe(0.7);
  });

  it("accepts the crop_stress alias for the noul answer", () => {
    const payload = {
      answers: {
        intent: { type: "choice", choice: "other", confidence: 0.5 },
        urgency: { type: "score", score: 0 },
        crop_stress: { type: "noul", noul: 0.75 },
      },
    };
    expect(parseJevDecision(payload)?.stressProbability).toBe(0.75);
  });

  it("rejects out-of-schema answers", () => {
    const base = JEV_OK.answers;
    expect(parseJevDecision({})).toBeNull();
    expect(parseJevDecision({ answers: {} })).toBeNull();
    // An intent we never offered.
    expect(parseJevDecision({ answers: { ...base, intent: { type: "choice", choice: "banana" } } })).toBeNull();
    // A score off the end of the five-level scale, and a negative score.
    expect(parseJevDecision({ answers: { ...base, urgency: { type: "score", score: 5 } } })).toBeNull();
    expect(parseJevDecision({ answers: { ...base, urgency: { type: "score", score: -1 } } })).toBeNull();
    // A noul probability outside 0..1.
    expect(parseJevDecision({ answers: { ...base, mentions_crop_stress: { type: "noul", noul: 1.4 } } })).toBeNull();
    // A confidence that is present but not a probability.
    expect(parseJevDecision({ answers: { ...base, intent: { type: "choice", choice: "other", confidence: "high" } } })).toBeNull();
    // Wrong primitive types.
    expect(parseJevDecision({ answers: { ...base, urgency: { type: "noul", noul: 0.5 } } })).toBeNull();
  });
});

/* ------------------------------------------------------------------ Laya parsing */

describe("parseLayaDecision", () => {
  const urgentTe = "పంట ఎండిపోతుంది, నీళ్లు లేవు";

  it("reads the assigned sidecar shape and derives crop stress from the rules when absent", () => {
    const decision = parseLayaDecision(LAYA_OK, urgentTe);
    expect(decision).toEqual({
      intent: "urgent_request",
      intentConfidence: 0.5,
      urgency: 0.9,
      stressProbability: 1,
    });
  });

  it("reads the real sidecar body from services/laya build_decision", () => {
    // Copied in shape from services/laya/jadal_decision.py build_decision(): the supporting fields
    // and the raw per-question `answers` are all present.
    const real = {
      intent: "urgent_request",
      urgency: 0.9,
      is_release_time: false,
      source: "laya",
      latency_ms: 118,
      model: "convaiinnovations/laya-multilingual",
      device: "cpu",
      intent_confidence: 0.83,
      mentions_crop_stress: true,
      is_release_time_probability: 0.12,
      mentions_crop_stress_probability: 0.94,
      urgency_band: "needs_water_immediately",
      urgency_band_probabilities: { needs_water_immediately: 0.94 },
      intent_probabilities: { urgent_request: 0.83, buffer_request: 0.1 },
      answers: {
        intent: { type: "choice", choice: "urgent_request", confidence: 0.83, probabilities: { urgent_request: 0.83 } },
        urgency: { type: "score", score: 4, legend: { "0": "a", "1": "b", "2": "c", "3": "d", "4": "e" }, probabilities: { "4": 0.94 } },
        is_release_time: { type: "noul", noul: 0.12 },
        mentions_crop_stress: { type: "noul", noul: 0.94 },
      },
    };
    expect(parseLayaDecision(real, urgentTe)).toEqual({
      intent: "urgent_request",
      intentConfidence: 0.83,
      urgency: 0.9,
      stressProbability: 1,
    });
  });

  it("treats a null intent_confidence and null crop stress as 'not answered', not as invalid", () => {
    // The sidecar emits exactly this when the model did not answer those questions, but still keeps
    // the raw answers, which carry the real probability.
    const real = {
      ...LAYA_OK,
      intent_confidence: null,
      mentions_crop_stress: null,
      mentions_crop_stress_probability: null,
      answers: {
        intent: { type: "choice", choice: "urgent_request", confidence: 0.7 },
        urgency: { type: "score", score: 4 },
        mentions_crop_stress: { type: "noul", noul: 0.8 },
      },
    };
    expect(parseLayaDecision(real, urgentTe)).toEqual({
      intent: "urgent_request",
      intentConfidence: 0.7,
      urgency: 0.9,
      stressProbability: 0.8,
    });
  });

  it("falls back to the rules for crop stress and to a neutral confidence when nothing is reported", () => {
    const bare = { intent: "urgent_request", urgency: 0.9, intent_confidence: null, mentions_crop_stress: null };
    expect(parseLayaDecision(bare, urgentTe)).toEqual({
      intent: "urgent_request",
      intentConfidence: 0.5,
      urgency: 0.9,
      stressProbability: 1,
    });
    // Same answer for a calm message: the rules say no stress.
    expect(parseLayaDecision(bare, "ధన్యవాదాలు")?.stressProbability).toBe(0);
  });

  it("prefers an explicit crop-stress field over the rules", () => {
    const decision = parseLayaDecision({ ...LAYA_OK, mentions_crop_stress: false }, urgentTe);
    expect(decision?.stressProbability).toBe(0);
    const numeric = parseLayaDecision({ ...LAYA_OK, crop_stress: 0.25 }, urgentTe);
    expect(numeric?.stressProbability).toBe(0.25);
  });

  it("also accepts a nested Decisions-shaped response", () => {
    const decision = parseLayaDecision(
      {
        answers: {
          intent: { type: "choice", choice: "harvested", confidence: 0.8 },
          urgency: { type: "score", score: 0 },
          mentions_crop_stress: { type: "noul", noul: 0.1 },
        },
      },
      urgentTe,
    );
    expect(decision).toEqual({
      intent: "harvested",
      intentConfidence: 0.8,
      urgency: 0,
      stressProbability: 0.1,
    });
  });

  it("rejects out-of-schema answers", () => {
    expect(parseLayaDecision({}, "hi")).toBeNull();
    expect(parseLayaDecision({ intent: "banana", urgency: 0.5 }, "hi")).toBeNull();
    expect(parseLayaDecision({ intent: "other" }, "hi")).toBeNull();
    expect(parseLayaDecision({ intent: "other", urgency: 1.4 }, "hi")).toBeNull();
    expect(parseLayaDecision({ intent: "other", urgency: 0.5, mentions_crop_stress: "yes" }, "hi")).toBeNull();
  });
});

/* ------------------------------------------------------------------ rules-only guarantee */

describe("rules-only provider", () => {
  it("never touches the network even when both model providers are configured", async () => {
    const env = bothProviders(() => json(JEV_OK), { SYSTEM1_PROVIDER: "rules" });
    const outcome = await classifyDetailed(env, "నీళ్లు లేవు");
    expect(outcome.source).toBe("rules");
    expect(outcome.result.source).toBe("rules");
    expect(outcome.attempts).toEqual([{ provider: "rules", ok: true }]);
    expect(outcome.fallback).toBeUndefined();
    expect(env.calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ auto chain */

describe("auto provider chain", () => {
  it("prefers Laya when the sidecar is configured and answering", async () => {
    const env = bothProviders((call) => (call.url === LAYA_DECIDE ? json(LAYA_OK) : json(JEV_OK)));
    const outcome = await classifyDetailed(env, "పంట ఎండిపోతుంది, నీళ్లు లేవు");
    expect(outcome.source).toBe("laya");
    expect(outcome.result.source).toBe("laya");
    expect(outcome.result.intent).toBe("urgent_request");
    expect(outcome.result.urgency).toBe(0.9);
    expect(outcome.attempts).toEqual([{ provider: "laya", ok: true }]);
    expect(env.calls).toHaveLength(1);
    expect(env.calls[0]?.url).toBe(LAYA_DECIDE);
  });

  it("turns the real sidecar body into a contract result with source=laya", async () => {
    const real = {
      intent: "urgent_request",
      urgency: 0.9,
      is_release_time: false,
      source: "laya",
      latency_ms: 118,
      model: "convaiinnovations/laya-multilingual",
      device: "cpu",
      intent_confidence: 0.83,
      mentions_crop_stress: true,
      answers: {},
    };
    const env = bothProviders((call) => (call.url === LAYA_DECIDE ? json(real) : json(JEV_OK)));
    const outcome = await classifyDetailed(env, "పంట ఎండిపోతుంది, నీళ్లు లేవు");
    expect(outcome.result).toEqual({
      intent: "urgent_request",
      intent_confidence: 0.83,
      urgency: 0.9,
      mentions_crop_stress: true,
      source: "laya",
    });
  });

  it("falls back Laya -> Jev when the sidecar fails", async () => {
    const env = bothProviders((call) =>
      call.url === LAYA_DECIDE ? json({ error: "model not loaded" }, 503) : json(JEV_OK),
    );
    const outcome = await classifyDetailed(env, "నీళ్లు లేవు");
    expect(outcome.source).toBe("jev");
    expect(outcome.result.source).toBe("jev");
    expect(outcome.result.mentions_crop_stress).toBe(true);
    expect(outcome.attempts).toEqual([
      { provider: "laya", ok: false, reason: "http_error", status: 503 },
      { provider: "jev", ok: true },
    ]);
    expect(env.calls.map((call) => call.url)).toEqual([LAYA_DECIDE, OPENROUTER_DECISIONS_URL]);
  });

  it("falls back Laya -> Jev -> rules and records the first failure", async () => {
    const env = bothProviders((call) => (call.url === LAYA_DECIDE ? json({}, 500) : json({}, 502)));
    const text = "నీళ్లు లేవు";
    const outcome = await classifyDetailed(env, text);
    expect(outcome.source).toBe("rules");
    expect(outcome.result).toEqual(classifyByRules(text));
    expect(outcome.attempts).toEqual([
      { provider: "laya", ok: false, reason: "http_error", status: 500 },
      { provider: "jev", ok: false, reason: "http_error", status: 502 },
      { provider: "rules", ok: true },
    ]);
    expect(outcome.fallback).toEqual({ reason: "http_error", status: 500 });
  });

  it("records not_configured for every missing provider and still answers from the rules", async () => {
    const env = stubEnv(() => json(JEV_OK), { OPENROUTER_API_KEY: undefined });
    const outcome = await classifyDetailed(env, "ధన్యవాదాలు");
    expect(outcome.source).toBe("rules");
    expect(outcome.attempts).toEqual([
      { provider: "laya", ok: false, reason: "not_configured" },
      { provider: "jev", ok: false, reason: "not_configured" },
      { provider: "rules", ok: true },
    ]);
    expect(outcome.fallback).toEqual({ reason: "not_configured" });
    expect(env.calls).toHaveLength(0);
  });

  it("treats an unreachable sidecar as a transport error and moves to Jev", async () => {
    const env = bothProviders((call) => {
      if (call.url === LAYA_DECIDE) throw new Error("ECONNREFUSED 127.0.0.1:8099");
      return json(JEV_OK);
    });
    const outcome = await classifyDetailed(env, "నీళ్లు లేవు");
    expect(outcome.source).toBe("jev");
    expect(outcome.attempts[0]).toEqual({ provider: "laya", ok: false, reason: "transport_error" });
  });

  it("never gateway-prefixes the local sidecar", async () => {
    const env = bothProviders((call) => (call.url === LAYA_DECIDE ? json(LAYA_OK) : json(JEV_OK)), {
      AI_GATEWAY_URL: "https://gateway.ai.cloudflare.com/v1/acct/gw",
    });
    await classifyDetailed(env, "hi");
    expect(env.calls[0]?.url).toBe(LAYA_DECIDE);
  });
});

/* ------------------------------------------------------------------ Jev failure modes */

describe("Jev failure modes", () => {
  /** Jev first in the chain, so `fallback` names the Jev failure rather than Laya being unset. */
  function jevFirst(responder: Responder, extra: Partial<ProviderEnv> = {}) {
    return stubEnv(responder, { SYSTEM1_PROVIDER: "jev", ...extra });
  }

  const text = "పంట ఎండిపోతుంది";

  it("happy path returns the parsed schema-bounded decision with source=jev", async () => {
    const env = jevFirst(() => json(JEV_OK));
    const outcome = await classifyDetailed(env, text);
    expect(outcome.source).toBe("jev");
    expect(outcome.result).toEqual({
      intent: "urgent_request",
      intent_confidence: 0.91,
      urgency: 1,
      mentions_crop_stress: true,
      source: "jev",
    });
    expect(outcome.fallback).toBeUndefined();
    expect(env.calls).toHaveLength(1);
    expect(env.calls[0]?.method).toBe("POST");
    expect(env.calls[0]?.url).toBe(OPENROUTER_DECISIONS_URL);
    expect(env.calls[0]?.headers["authorization"]).toBe("Bearer test-openrouter-key");
    expect(env.calls[0]?.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(String(env.calls[0]?.body))).toMatchObject({ model: JEV_MODEL, state: text });
  });

  it("non-200 falls back to the rules", async () => {
    const env = jevFirst(() => json({ error: { code: 500, message: "Internal Server Error" } }, 500));
    const outcome = await classifyDetailed(env, text);
    expect(outcome.source).toBe("rules");
    expect(outcome.result).toEqual(classifyByRules(text));
    expect(outcome.fallback).toEqual({ reason: "http_error", status: 500 });
    expect(outcome.attempts[0]).toEqual({ provider: "jev", ok: false, reason: "http_error", status: 500 });
  });

  it("rate limit (429) falls back to the rules with a distinct reason", async () => {
    const env = jevFirst(() => json({ error: { code: 429, message: "Rate limit exceeded" } }, 429));
    const outcome = await classifyDetailed(env, text);
    expect(outcome.source).toBe("rules");
    expect(outcome.fallback).toEqual({ reason: "rate_limited", status: 429 });
  });

  it("a payment error (402) falls back as a plain http_error", async () => {
    const env = jevFirst(() => json({ error: { code: 402, message: "Insufficient credits" } }, 402));
    const outcome = await classifyDetailed(env, text);
    expect(outcome.fallback).toEqual({ reason: "http_error", status: 402 });
  });

  it("a timeout falls back to the rules and does not stall the request", async () => {
    const env = jevFirst(NEVER);
    const started = Date.now();
    const outcome = await classifyDetailed(env, text, { timeoutMs: 25 });
    expect(outcome.source).toBe("rules");
    expect(outcome.fallback).toEqual({ reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("an aborted fetch is treated as a timeout", async () => {
    const env = jevFirst(() => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      throw error;
    });
    const outcome = await classifyDetailed(env, text, { timeoutMs: 50 });
    expect(outcome.fallback).toEqual({ reason: "timeout" });
  });

  it("a transport throw falls back to the rules", async () => {
    const env = jevFirst(() => {
      throw new Error("getaddrinfo ENOTFOUND openrouter.ai");
    });
    const outcome = await classifyDetailed(env, text);
    expect(outcome.fallback).toEqual({ reason: "transport_error" });
  });

  it("malformed JSON falls back to the rules", async () => {
    const env = jevFirst(() => raw("<html>not json</html>"));
    const outcome = await classifyDetailed(env, text);
    expect(outcome.fallback).toEqual({ reason: "malformed_json" });
  });

  it("an out-of-schema intent falls back to the rules", async () => {
    const env = jevFirst(() =>
      json({ answers: { ...JEV_OK.answers, intent: { type: "choice", choice: "banana", confidence: 0.9 } } }),
    );
    const outcome = await classifyDetailed(env, text);
    expect(outcome.fallback).toEqual({ reason: "out_of_schema" });
  });

  it("an out-of-schema urgency falls back to the rules", async () => {
    const env = jevFirst(() => json({ answers: { ...JEV_OK.answers, urgency: { type: "score", score: 99 } } }));
    const outcome = await classifyDetailed(env, text);
    expect(outcome.fallback).toEqual({ reason: "out_of_schema" });
  });

  it("an out-of-schema noul falls back to the rules", async () => {
    const env = jevFirst(() => json({ answers: { ...JEV_OK.answers, mentions_crop_stress: { type: "noul", noul: -0.2 } } }));
    const outcome = await classifyDetailed(env, text);
    expect(outcome.fallback).toEqual({ reason: "out_of_schema" });
  });

  it("an empty body falls back as out_of_schema", async () => {
    const env = jevFirst(() => json({}));
    const outcome = await classifyDetailed(env, text);
    expect(outcome.fallback).toEqual({ reason: "out_of_schema" });
  });

  it("honours JEV_MODEL and lets opts.model win", async () => {
    const fromEnv = jevFirst(() => json(JEV_OK), { JEV_MODEL: "~typesafe/jev-latest" });
    await classifyDetailed(fromEnv, text);
    expect(JSON.parse(String(fromEnv.calls[0]?.body)).model).toBe("~typesafe/jev-latest");

    const fromOpts = jevFirst(() => json(JEV_OK), { JEV_MODEL: "~typesafe/jev-latest" });
    await classifyDetailed(fromOpts, text, { model: "typesafe/jev-1.13" });
    expect(JSON.parse(String(fromOpts.calls[0]?.body)).model).toBe("typesafe/jev-1.13");
  });

  it("routes Jev through the AI Gateway when configured", async () => {
    const gateway = "https://gateway.ai.cloudflare.com/v1/acct/gw";
    const env = jevFirst(() => json(JEV_OK), { AI_GATEWAY_URL: gateway });
    await classifyDetailed(env, text);
    expect(env.calls[0]?.url).toBe(`${gateway}/${OPENROUTER_DECISIONS_URL}`);
  });
});

/* ------------------------------------------------------------------ Laya failure modes */

describe("Laya failure modes", () => {
  function layaFirst(responder: Responder) {
    return stubEnv(responder, { SYSTEM1_PROVIDER: "laya", LAYA_ENDPOINT: LAYA_DECIDE });
  }

  it("a 5xx from a sidecar whose model failed to load is not reported as a Laya decision", async () => {
    const env = layaFirst(() => json({ error: "model not loaded" }, 503));
    const outcome = await classifyDetailed(env, "నీళ్లు లేవు");
    expect(outcome.source).toBe("rules");
    expect(outcome.result.source).toBe("rules");
    expect(outcome.attempts[0]).toEqual({ provider: "laya", ok: false, reason: "http_error", status: 503 });
  });

  it("malformed JSON from the sidecar falls back", async () => {
    const env = layaFirst(() => raw("not json"));
    const outcome = await classifyDetailed(env, "నీళ్లు లేవు");
    expect(outcome.fallback).toEqual({ reason: "malformed_json" });
  });

  it("an out-of-schema sidecar answer falls back", async () => {
    const env = layaFirst(() => json({ intent: "banana", urgency: 0.5 }));
    const outcome = await classifyDetailed(env, "నీళ్లు లేవు");
    expect(outcome.fallback).toEqual({ reason: "out_of_schema" });
  });

  it("a timeout falls back", async () => {
    const env = layaFirst(NEVER);
    const outcome = await classifyDetailed(env, "నీళ్లు లేవు", { timeoutMs: 25 });
    expect(outcome.fallback).toEqual({ reason: "timeout" });
  });

  it("sends { text, questions } with content-type json to the sidecar", async () => {
    const env = layaFirst(() => json(LAYA_OK));
    await classifyDetailed(env, "పంట ఎండిపోతుంది");
    const call = env.calls[0];
    expect(call?.method).toBe("POST");
    expect(call?.url).toBe(LAYA_DECIDE);
    expect(call?.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(String(call?.body))).toEqual(buildLayaRequest("పంట ఎండిపోతుంది"));
  });
});

/* ------------------------------------------------------------------ classify() contract */

describe("classify", () => {
  it("returns the same result as classifyDetailed and never throws", async () => {
    const ok = stubEnv(() => json(JEV_OK), { SYSTEM1_PROVIDER: "jev" });
    const [detailed, plain] = await Promise.all([
      classifyDetailed(ok, "నీళ్లు లేవు"),
      classify(ok, "నీళ్లు లేవు"),
    ]);
    expect(plain).toEqual(detailed.result);
    expect(plain.source).toBe("jev");

    const broken = stubEnv(() => {
      throw new Error("boom");
    });
    await expect(classify(broken, "నీళ్లు లేవు")).resolves.toEqual(classifyByRules("నీళ్లు లేవు"));
  });
});

/* ------------------------------------------------------------------ OpenRouter spend limit */

describe("OpenRouter spend limit", () => {
  beforeEach(() => resetSpendTracker());

  it("falls back to rules without calling Jev once the limit is reached", async () => {
    const env = stubEnv(() => json(JEV_OK), {
      SYSTEM1_PROVIDER: "jev",
      OPENROUTER_SPEND_LIMIT_USD: "1",
    });
    recordSpendUsd(1);

    const outcome = await classifyDetailed(env, "నీళ్లు లేవు");

    expect(env.calls).toHaveLength(0);
    expect(outcome.source).toBe("rules");
    expect(outcome.fallback?.reason).toBe("spend_limit");
  });

  it("records the cost Jev reports against the cumulative tracker", async () => {
    const env = stubEnv(() => json(JEV_OK), { SYSTEM1_PROVIDER: "jev" });

    const outcome = await classifyDetailed(env, "నీళ్లు లేవు");

    expect(outcome.source).toBe("jev");
    expect(spentUsd()).toBeCloseTo(JEV_OK.usage.cost);
  });
});
