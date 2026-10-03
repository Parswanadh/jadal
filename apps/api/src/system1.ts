/**
 * System-1 classifier — the fast reflex layer described in
 * `docs/research/deterministic-and-system1.md` §3 and `ADR-004`, amended by `ADR-006`.
 *
 * ## One entry point, several providers
 *
 * `classify(env, text)` / `classifyDetailed(env, text)` are the only entry points. Behind them is a
 * provider chain selected by `SYSTEM1_PROVIDER`:
 *
 *   * `laya`  — the local Laya sidecar (`LAYA_ENDPOINT`, e.g. `http://127.0.0.1:8099/decide`).
 *               Laya's multilingual checkpoint is mmBERT-based and supports Telugu, which is why it
 *               is the preferred primary for Jadal's farmers.
 *   * `jev`   — Jev (`typesafe/jev-1.13`) over OpenRouter's typed Decisions API (`OPENROUTER_API_KEY`).
 *   * `rules` — `classifyByRules`, pure and offline. Always the floor.
 *
 * `auto` (the default when the variable is unset) prefers `laya`, then `jev`, then `rules`. Any
 * provider failure — unreachable, non-200, rate limit, timeout, malformed JSON, an out-of-schema
 * value — moves to the next provider in the chain and is recorded in the returned `attempts`, so a
 * fallback is never silent to a caller of `classifyDetailed` and never reported as if the model ran.
 *
 * `classify` never throws and never rejects. A triage service that 500s during a farmer's call is
 * worse than one that guesses conservatively with the Telugu keyword rules.
 *
 * Every result carries `source: "laya" | "jev" | "rules"` (already part of the `System1Result`
 * contract, so no contracts change was needed). **Provenance is available, but not yet persisted:**
 * `classify` returns the bare `System1Result`, and every production caller today (`requests.ts`,
 * `routes/voice.ts`, `agents/caller.ts`, `telephony-deps.ts`) reads only `intent`/`urgency`. The
 * `request.triaged` event (`packages/contracts/src/events.ts`) has no `source` field, so the stored
 * audit trail cannot yet distinguish a `source: "rules"` fallback from a real `laya`/`jev` decision.
 * A caller that wants the provenance now must use {@link classifyDetailed} and keep `source` /
 * `attempts` itself. Persisting it in `request.triaged` is planned and is a contract change, so it
 * needs `contracts-ok`; see ADR-006.
 *
 * Every outbound call goes through `env.fetch` so tests can intercept it and so Cloudflare AI
 * Gateway can sit in front of the OpenRouter call (`AI_GATEWAY_URL`). The Laya sidecar is local and
 * is never gateway-prefixed.
 *
 * ## The Jev wire contract (verified 2026-10-02)
 *
 * Jev is NOT a chat model, and `typesafe/jev-router` is NOT the decision model. On OpenRouter, Jev
 * is exposed through two typed-decision surfaces; this module uses the **Decisions API**:
 *
 *   POST https://openrouter.ai/api/alpha/decisions
 *   { "model": "typesafe/jev-1.13", "state": <string|object|array>,
 *     "questions": { "<name>": { "type": "choice"|"score"|"noul", "instructions": ..., "criteria": ... } } }
 *   -> { "id", "model", "provider", "answers": { "<name>": {...} }, "usage": {...} }
 *
 * A `choice` question requires an object `criteria` (label -> description) and answers with
 * `{ type, choice, confidence?, probabilities? }`. A `score` question requires an array `criteria`
 * (ordered levels) and answers with `{ type, score, confidence?, probabilities?, legend? }`, where
 * `score` is on the *index* scale `0..criteria.length-1`, not `0..1`. A `noul` question needs only
 * `instructions` and answers with `{ type, noul }`, the probability of "yes".
 *
 * `typesafe/jev-router` is an OpenRouter *router*: it is called through
 * `/api/v1/chat/completions`, picks a chat model and reasoning effort, and returns generated text —
 * it does not return `choice` / `score` / `noul` answers. ADR-004 named it before the distinction
 * was verified; ADR-006 records the correction. Sources:
 * `openrouter.ai/docs/guides/community/jev`, `.../jev-tutorial`, `.../guides/routing/routers/jev-router`,
 * and the Decisions API reference (`/api/alpha/decisions`). The failure-mode handling below is
 * modelled on the status codes that reference documents (400/401/402/403/404/413/429/5xx/524/529).
 *
 * ## The Laya sidecar contract (matches `services/laya` in lane L, read 2026-10-02)
 *
 *   POST <LAYA_ENDPOINT>   { "text": "<farmer message>",
 *                            "questions": { intent, urgency, mentions_crop_stress, is_release_time } }
 *   200                    { "intent": "<choice label>", "urgency": 0..1, "is_release_time": bool,
 *                            "source": "laya", "latency_ms": int, "model", "device",
 *                            "intent_confidence": 0..1 | null,
 *                            "mentions_crop_stress": bool | null, ... , "answers": { raw } }
 *   GET  /health            { "ok": true, "model": "<checkpoint>", "device": "cpu|cuda" }
 *
 * Two details are load-bearing and are pinned by tests:
 *
 *  * The sidecar's mapper refuses a request whose `questions` omit `is_release_time` (it answers 400,
 *    or 502 when a required answer is missing), so the Laya question set carries that id. The four
 *    ids must match the sidecar exactly.
 *  * `intent_confidence` and `mentions_crop_stress` are `null` when the model did not answer that
 *    question. `null` means "not reported", never "invalid": confidence then falls back to the raw
 *    `answers.intent.confidence` (else a neutral 0.5), and crop stress to the deterministic rules
 *    (`classifyByRules(text).mentions_crop_stress`). When the sidecar does report crop stress, its
 *    answer wins. `is_release_time` is accepted but never mapped onto `mentions_crop_stress` — they
 *    are different questions. See ADR-006.
 */

import { System1Intent, System1Result } from "@jadal/contracts";
import { classifyByRules } from "./system1.rules";

/**
 * The minimal environment every provider call needs.
 *
 * Declared here rather than imported from `src/index.ts` / `src/app.ts` because those files are
 * owned by the routing agent and this module must stay compilable while they are in flux. The
 * Worker's own `Env` satisfies every field except `fetch`; the routing layer passes its global
 * `fetch` in explicitly, which is also what lets `apps/api/test/harness.ts` inject mocks.
 */
export type ProviderFetch = (
  input: string,
  init?: { method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<Response>;

export interface ProviderEnv {
  fetch: ProviderFetch;
  /**
   * Which System-1 provider to use: `laya`, `jev`, `rules` or `auto`. Unset => `auto`. An
   * unrecognised spelling falls back to `rules` (fail safe, never a surprise network call).
   */
  SYSTEM1_PROVIDER?: string;
  /** Laya sidecar base URL, e.g. `http://127.0.0.1:8099/decide`. Absent => Laya is not configured. */
  LAYA_ENDPOINT?: string;
  /** Deadline for one Laya call, in milliseconds as a string. Default {@link LAYA_DEFAULT_TIMEOUT_MS}. */
  LAYA_TIMEOUT_MS?: string;
  /** OpenRouter key for Jev. Absent => Jev is not configured. */
  OPENROUTER_API_KEY?: string;
  /** Sarvam key for STT/TTS. See `src/voice/sarvam.ts`. */
  SARVAM_API_KEY?: string;
  /**
   * Cloudflare AI Gateway base, e.g. `https://gateway.ai.cloudflare.com/v1/<acct>/<gw>`. When set,
   * every OpenRouter URL becomes `<AI_GATEWAY_URL>/<full provider url>` (ADR-001). Local sidecars
   * are never gateway-prefixed.
   */
  AI_GATEWAY_URL?: string;
  /** Overrides the Jev route slug. Default {@link JEV_MODEL}. */
  JEV_MODEL?: string;
  /** Deadline for one Jev call, in milliseconds as a string. Default {@link JEV_DEFAULT_TIMEOUT_MS}. */
  JEV_TIMEOUT_MS?: string;
}

/* ------------------------------------------------------------------ provider selection */

/** The three System-1 tiers, in the order `auto` prefers them. Matches `System1Result.source`. */
export const SYSTEM1_PROVIDERS = ["laya", "jev", "rules"] as const;
export type System1ProviderName = (typeof SYSTEM1_PROVIDERS)[number];
export type System1ProviderSetting = System1ProviderName | "auto";

/** `auto` prefers Laya (Telugu-native, local, free), then Jev, then the rules floor. */
export const SYSTEM1_DEFAULT_PROVIDER: System1ProviderSetting = "auto";

/**
 * Reads `SYSTEM1_PROVIDER`. Blank/unset => `auto`; a recognised name => itself; anything else =>
 * `rules`, matching `isDemo`'s "a typo degrades to the safe path" rule rather than silently spending
 * OpenRouter credit.
 */
export function parseProviderSetting(value: string | undefined): System1ProviderSetting {
  if (value === undefined || value.trim() === "") return SYSTEM1_DEFAULT_PROVIDER;
  const normalized = value.trim().toLowerCase();
  if (normalized === "auto" || normalized === "laya" || normalized === "jev" || normalized === "rules") {
    return normalized;
  }
  return "rules";
}

/**
 * The ordered providers to try.
 *
 *  * `auto`  -> `laya`, `jev`, `rules`
 *  * `laya`  -> `laya`, `jev`, `rules` (the named provider leads, the rest still back it up)
 *  * `jev`   -> `jev`, `laya`, `rules`
 *  * `rules` -> `rules` only: an explicit offline deployment must never touch the network.
 *
 * Unconfigured providers are kept in the chain on purpose: attempting one records a precise
 * `not_configured` reason, which is more useful to the audit trail than silently omitting it.
 */
export function resolveProviderChain(env: Pick<ProviderEnv, "SYSTEM1_PROVIDER">): readonly System1ProviderName[] {
  const setting = parseProviderSetting(env.SYSTEM1_PROVIDER);
  if (setting === "rules") return ["rules"];
  if (setting === "auto") return SYSTEM1_PROVIDERS;
  return [setting, ...SYSTEM1_PROVIDERS.filter((provider) => provider !== setting)];
}

/**
 * True when a provider has the configuration it needs to be attempted. `rules` always does.
 *
 * This is the single config gate both model providers are called behind ({@link callLaya},
 * {@link callJev}), and it is exported so a status or diagnostic caller can ask the same question.
 */
export function providerConfigured(
  provider: System1ProviderName,
  env: Pick<ProviderEnv, "LAYA_ENDPOINT" | "OPENROUTER_API_KEY">,
): boolean {
  if (provider === "rules") return true;
  if (provider === "laya") return (env.LAYA_ENDPOINT?.trim().length ?? 0) > 0;
  return jevEnabled(env);
}

/* ------------------------------------------------------------------ configuration */

/**
 * The Jev release this module pins, reached through OpenRouter's Decisions API.
 *
 * Pinned rather than `~typesafe/jev-latest` so urgency thresholds tuned against one release stay
 * meaningful; set `JEV_MODEL` to the alias to float. `typesafe/jev-router` is deliberately NOT the
 * default: it is an OpenRouter chat-model router, not the typed-decision model (ADR-006).
 */
export const JEV_MODEL = "typesafe/jev-1.13";

/**
 * OpenRouter's typed-decisions endpoint for Jev.
 *
 * The OpenAI-compatible `/api/v1/chat/completions` endpoint is the wrong surface: Jev returns typed
 * `answers`, not message content, so there is nothing to parse out of `choices[0]`. OpenRouter also
 * exposes a TypeSafe-SDK-compatible `POST /api/v1/systemone` with the same body; the Decisions API
 * is the one documented for plain HTTP callers, so it is the one we use.
 */
export const OPENROUTER_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";

/** Sub-500 ms is Jev's advertised latency; 4 s leaves room for a cold start without stalling a call. */
export const JEV_DEFAULT_TIMEOUT_MS = 4000;

/** Lower/upper bounds for the `JEV_TIMEOUT_MS` env override. Below 250 ms a cold route always loses. */
export const JEV_TIMEOUT_MIN_MS = 250;
export const JEV_TIMEOUT_MAX_MS = 15_000;

/**
 * Laya runs locally (advertised ~33-40 ms on a GPU, more on CPU), but the first request after a
 * cold start may wait on the sidecar's model. 4 s matches Jev; the band is wider at the bottom
 * because a local socket either answers fast or is not there at all.
 */
export const LAYA_DEFAULT_TIMEOUT_MS = 4000;
export const LAYA_TIMEOUT_MIN_MS = 100;
export const LAYA_TIMEOUT_MAX_MS = 15_000;

/* ------------------------------------------------------------------ typed questions */

/**
 * One `choice` option per contract intent, with the description the model scores against. Written as
 * a complete `Record` so adding a `System1Intent` member is a type error here, not a silent miss.
 */
const INTENT_CRITERIA: Readonly<Record<System1Result["intent"], string>> = {
  urgent_request:
    "The farmer says the crop is suffering now and asks for water urgently: wilting, dying or yellowing crop, cracked or dry soil, an empty channel, 'need water today/immediately'.",
  buffer_request:
    "The farmer asks for extra water beyond their scheduled turn, or to draw on the common buffer pool.",
  not_needed_this_week:
    "The farmer says they do not need water this week, or declines / postpones a turn. No crop-stress claim.",
  harvested: "The farmer says the crop has been harvested, cut, or sold, so the season's water is done.",
  schedule_question: "The farmer asks when their turn is, or about the roster, the schedule or the release timing.",
  acknowledge:
    "The farmer acknowledges, confirms, thanks or agrees to a plan. No new water request and no crop-stress claim.",
  other: "None of the above: a greeting, unrelated chatter, or too little information to classify.",
};

/**
 * Ordered urgency rubric. A `score` answer comes back on this index scale
 * (`0..URGENCY_LEVELS.length-1`), so it is normalised to the contract's `0..1` by dividing by the
 * last index. The five bands keep the wording of the pre-ADR-006 prompt rubric.
 */
export const URGENCY_LEVELS: readonly string[] = [
  "No water needed, or a thank-you / acknowledgement only.",
  "A routine question or a plain ask, with no sign of crop stress and no time pressure.",
  "Visible wilting or cracked, drying soil: water is needed soon.",
  "The crop is dying without water today.",
  "The crop is dead or dying and the farmer says water is needed immediately.",
];

/** Highest index a model may return for {@link URGENCY_LEVELS}; anything outside `0..4` is out of schema. */
export const URGENCY_MAX_INDEX = URGENCY_LEVELS.length - 1;

const INTENT_INSTRUCTIONS =
  "Which single intent best describes what the farmer wants? Choose the most specific option that fits.";
const URGENCY_INSTRUCTIONS =
  "How urgent is the farmer's need for water right now? Use the levels in order, from no need to immediate.";
const STRESS_INSTRUCTIONS =
  "Does the farmer describe the crop itself suffering from lack of water (dry, wilting, yellowing, dying, or no water in the channel)? Answer yes only when the crop is described as harmed, not merely when water is requested.";
const RELEASE_TIME_INSTRUCTIONS =
  "Is the farmer asking about the timing of a canal release: when the water will be released, or when their turn starts?";

export interface JevChoiceQuestion {
  readonly type: "choice";
  readonly instructions: string;
  readonly criteria: Readonly<Record<string, string>>;
}

export interface JevScoreQuestion {
  readonly type: "score";
  readonly instructions: string;
  readonly criteria: readonly string[];
}

export interface JevNoulQuestion {
  readonly type: "noul";
  readonly instructions: string;
  readonly criteria?: Readonly<{ true: string; false: string }>;
}

/**
 * The three questions the Worker needs back for a `System1Result`. The noul id is
 * `mentions_crop_stress`, matching both the contract field and the id the Laya sidecar maps on.
 */
export interface JevQuestions {
  readonly intent: JevChoiceQuestion;
  readonly urgency: JevScoreQuestion;
  readonly mentions_crop_stress: JevNoulQuestion;
}

/**
 * The Laya sidecar additionally requires an `is_release_time` noul: its mapper refuses a request
 * whose `questions` omit it (`REQUIRED_QUESTION_IDS` in `services/laya/jadal_decision.py`), and the
 * id must match exactly or the sidecar answers 400/502 instead of a decision.
 */
export interface LayaQuestions extends JevQuestions {
  readonly is_release_time: JevNoulQuestion;
}

/**
 * The typed questions both model providers are asked, in the Decisions shape. Exported so tests can
 * assert the wire format, because a wrong `type` or a missing `criteria` is a 400, not a fallback.
 */
export function buildJevQuestions(): JevQuestions {
  return {
    intent: { type: "choice", instructions: INTENT_INSTRUCTIONS, criteria: INTENT_CRITERIA },
    urgency: { type: "score", instructions: URGENCY_INSTRUCTIONS, criteria: URGENCY_LEVELS },
    mentions_crop_stress: {
      type: "noul",
      instructions: STRESS_INSTRUCTIONS,
      criteria: {
        true: "The message describes the crop or the channel harming the crop through lack of water.",
        false: "No crop-stress description: a routine question, an acknowledgement, a schedule ask, or unrelated chatter.",
      },
    },
  };
}

/**
 * The Laya question set: the three above plus the release-time noul the sidecar insists on. The ids
 * (`intent`, `urgency`, `mentions_crop_stress`, `is_release_time`) are the sidecar's contract, not
 * an implementation detail — see `services/laya/jadal_decision.py`.
 */
export function buildLayaQuestions(): LayaQuestions {
  return {
    ...buildJevQuestions(),
    is_release_time: {
      type: "noul",
      instructions: RELEASE_TIME_INSTRUCTIONS,
      criteria: {
        true: "The message asks when the water will be released or when the farmer's turn starts.",
        false: "No question about release timing.",
      },
    },
  };
}

/* ------------------------------------------------------------------ Jev request shape */

/** The exact OpenRouter Decisions body sent to Jev. */
export interface JevRequestBody {
  readonly model: string;
  readonly state: string;
  readonly questions: JevQuestions;
}

/** Builds the exact OpenRouter Decisions body sent to Jev. */
export function buildJevRequest(text: string, model: string = JEV_MODEL): JevRequestBody {
  return { model, state: text, questions: buildJevQuestions() };
}

/* ------------------------------------------------------------------ Laya request shape */

/** The exact body sent to the local Laya sidecar (`POST $LAYA_ENDPOINT`). */
export interface LayaRequestBody {
  readonly text: string;
  readonly questions: LayaQuestions;
}

/** Builds the exact body sent to the local Laya sidecar. */
export function buildLayaRequest(text: string): LayaRequestBody {
  return { text, questions: buildLayaQuestions() };
}

/* ------------------------------------------------------------------ response parsing */

interface JevDecision {
  readonly intent: System1Result["intent"];
  readonly intentConfidence: number;
  /** Normalised to the contract's `0..1`. */
  readonly urgency: number;
  /** Probability of crop stress; >= 0.5 is yes. */
  readonly stressProbability: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A calibrated probability: finite and inside `0..1`. Anything else is out of schema. */
function asProbability(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A contract intent, or null when the model invented a label we never offered. */
function asIntent(value: unknown): System1Result["intent"] | null {
  if (typeof value !== "string") return null;
  return (System1Intent.options as readonly string[]).includes(value) ? (value as System1Result["intent"]) : null;
}

/** `container[key]` when it is a `{ choice }` answer, else undefined. */
function nestedChoice(container: Record<string, unknown> | undefined, key: string): unknown {
  if (container === undefined) return undefined;
  const answer = container[key];
  return isRecord(answer) ? answer["choice"] : undefined;
}

/** `container[key][field]` when both are records/numbers, else null. */
function nestedNumber(container: Record<string, unknown> | undefined, key: string, field: string): number | null {
  if (container === undefined) return null;
  const answer = container[key];
  if (!isRecord(answer)) return null;
  return asFiniteNumber(answer[field]);
}

/**
 * The documented `choice` answer keeps `confidence` optional, so when it is missing fall back to the
 * highest listed probability, and to a neutral 0.5 when the model sent neither. An *invalid*
 * confidence (a string, or `1.4`) is not salvaged — it rejects the whole answer and the chain moves
 * on. A JSON `null` counts as "not reported", because the Laya sidecar emits `intent_confidence:
 * null` when the model gave none.
 *
 * `answer_confidence` is Laya's own spelling of the same field.
 */
function readConfidence(answer: Record<string, unknown>): number | null {
  const direct = answer["confidence"] ?? answer["answer_confidence"];
  if (direct !== undefined && direct !== null) return asProbability(direct);

  const probabilities = answer["probabilities"];
  if (isRecord(probabilities)) {
    const values = Object.values(probabilities)
      .map(asProbability)
      .filter((value): value is number => value !== null);
    if (values.length > 0) return Math.max(...values);
  }
  return 0.5;
}

/**
 * Reads a crop-stress signal out of a Jev `answers` object or a Laya response object.
 *
 * Returns `undefined` when the object carries no usable signal (the caller may try the next object,
 * then derive from the rules), `null` when a signal is present but invalid (out of schema), and a
 * probability otherwise. JSON `null` means "the model did not answer this question" — the Laya
 * sidecar emits exactly that — so it is skipped rather than treated as invalid.
 *
 * Accepted spellings, in order: `mentions_crop_stress` (boolean, probability, or a `{ noul }`
 * answer), `crop_stress` (probability or `{ noul }`), then the sidecar's `*_probability` fields.
 * `is_release_time` is intentionally ignored: it answers a different question.
 */
function readStressSignal(container: Record<string, unknown> | undefined): number | null | undefined {
  if (container === undefined) return undefined;

  const keys = [
    "mentions_crop_stress",
    "crop_stress",
    "mentions_crop_stress_probability",
    "crop_stress_probability",
  ] as const;

  for (const key of keys) {
    const raw = container[key];
    if (raw === undefined || raw === null) continue;
    if (typeof raw === "boolean") return raw ? 1 : 0;
    if (typeof raw === "number") return asProbability(raw);
    if (isRecord(raw)) {
      const noul = raw["noul"];
      if (noul === undefined || noul === null) return null;
      return asProbability(noul);
    }
    return null;
  }
  return undefined;
}

/**
 * Reads `answers` out of an OpenRouter Decisions response and turns it into a decision, or null when
 * the model returned something outside the documented schema (an intent we never offered, a `noul`
 * above 1, an urgency score off the end of the scale, a missing `answers` object).
 */
export function parseJevDecision(payload: unknown): JevDecision | null {
  if (!isRecord(payload)) return null;
  const answers = payload["answers"];
  if (!isRecord(answers)) return null;

  /* choice -> intent */
  const intentAnswer = answers["intent"];
  if (!isRecord(intentAnswer) || intentAnswer["type"] !== "choice") return null;
  const intent = asIntent(intentAnswer["choice"]);
  if (intent === null) return null;
  const intentConfidence = readConfidence(intentAnswer);
  if (intentConfidence === null) return null;

  /* score -> urgency, on the index scale of the criteria we sent */
  const urgencyAnswer = answers["urgency"];
  if (!isRecord(urgencyAnswer) || urgencyAnswer["type"] !== "score") return null;
  const rawScore = asFiniteNumber(urgencyAnswer["score"]);
  if (rawScore === null || rawScore < 0 || rawScore > URGENCY_MAX_INDEX) return null;
  const urgency = rawScore / URGENCY_MAX_INDEX;

  /* noul -> crop stress probability */
  const stressAnswer = answers["mentions_crop_stress"] ?? answers["crop_stress"];
  if (!isRecord(stressAnswer) || stressAnswer["type"] !== "noul") return null;
  const stressProbability = asProbability(stressAnswer["noul"]);
  if (stressProbability === null) return null;

  return { intent, intentConfidence, urgency, stressProbability };
}

/**
 * Confidence for a Laya answer. The sidecar may report `intent_confidence: null` when the model gave
 * none, in which case the raw per-question `answers.intent.confidence` is tried, then a neutral 0.5.
 * A *present but invalid* (non-null) value still rejects the answer.
 */
function readLayaConfidence(
  payload: Record<string, unknown>,
  answers: Record<string, unknown> | undefined,
): number | null {
  for (const key of ["intent_confidence", "confidence"] as const) {
    const raw = payload[key];
    if (raw === undefined || raw === null) continue;
    return asProbability(raw);
  }
  if (answers !== undefined) {
    const nested = answers["intent"];
    if (isRecord(nested)) return readConfidence(nested);
  }
  return 0.5;
}

/**
 * Reads the local Laya sidecar's `/decide` response.
 *
 * The sidecar (lane L, `services/laya`) returns `{ intent, urgency (0..1), is_release_time, source,
 * latency_ms, model, device, intent_confidence, mentions_crop_stress, ... , answers }`, where
 * `intent_confidence` and `mentions_crop_stress` may be `null` when the model did not answer that
 * question. A nested Decisions shape under `answers` is also accepted, as is a `0..URGENCY_MAX_INDEX`
 * score instead of a `0..1` urgency. When no crop-stress signal is reported, the one boolean is
 * derived from the deterministic rules rather than guessed — see the module header and ADR-006.
 */
export function parseLayaDecision(payload: unknown, text: string): JevDecision | null {
  if (!isRecord(payload)) return null;
  const answers = isRecord(payload["answers"]) ? payload["answers"] : undefined;

  const intent = asIntent(payload["intent"]) ?? asIntent(nestedChoice(answers, "intent"));
  if (intent === null) return null;

  let urgency = asProbability(payload["urgency"]);
  if (urgency === null) {
    const rawScore = nestedNumber(answers, "urgency", "score");
    if (rawScore !== null && rawScore >= 0 && rawScore <= URGENCY_MAX_INDEX) urgency = rawScore / URGENCY_MAX_INDEX;
  }
  if (urgency === null) return null;

  const intentConfidence = readLayaConfidence(payload, answers);
  if (intentConfidence === null) return null;

  let stress = readStressSignal(payload);
  if (stress === undefined) stress = readStressSignal(answers);
  if (stress === null) return null;
  // Only when the sidecar reported no crop-stress signal at all (it sends `null` when the model did
  // not answer that question) is the one boolean derived deterministically rather than guessed.
  if (stress === undefined) stress = classifyByRules(text).mentions_crop_stress ? 1 : 0;

  return { intent, intentConfidence, urgency, stressProbability: stress };
}

/* ------------------------------------------------------------------ transport */

/**
 * Cloudflare AI Gateway proxying. The gateway's provider-proxied form is
 * `<gateway base>/<full upstream url>`, so we concatenate rather than replace. Only the OpenRouter
 * call is proxied; the local Laya sidecar is not reachable through Cloudflare.
 */
export function gatewayUrl(env: Pick<ProviderEnv, "AI_GATEWAY_URL">, url: string): string {
  const base = env.AI_GATEWAY_URL?.trim();
  if (!base) return url;
  return `${base.replace(/\/+$/, "")}/${url}`;
}

/** True when Jev may be attempted at all. */
export function jevEnabled(env: Pick<ProviderEnv, "OPENROUTER_API_KEY">): boolean {
  const key = env.OPENROUTER_API_KEY?.trim();
  return key !== undefined && key.length > 0;
}

/** First non-blank candidate, or `fallback`. Used so an empty `JEV_MODEL=` in `.dev.vars` is harmless. */
function firstNonBlank(...candidates: (string | undefined)[]): string | undefined {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Deadline resolution for one provider call.
 *
 * An explicit `opts.timeoutMs` (used by tests and by callers that know their budget) wins verbatim;
 * the per-provider env override is clamped to a sane band so a typo cannot make every farmer wait a
 * minute or time out before the first byte arrives. Exported so the clamping rule is testable
 * without timing assertions.
 */
export function resolveTimeoutMs(
  opts: ClassifyOptions,
  envValue: string | undefined,
  defaults: { readonly fallback: number; readonly min: number; readonly max: number },
): number {
  const explicit = opts.timeoutMs;
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);

  const raw = envValue?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return clamp(parsed, defaults.min, defaults.max);
  }
  return defaults.fallback;
}

/** Resolves the Jev deadline from `opts.timeoutMs` then `JEV_TIMEOUT_MS`. */
export function resolveJevTimeoutMs(env: Pick<ProviderEnv, "JEV_TIMEOUT_MS">, opts: ClassifyOptions): number {
  return resolveTimeoutMs(opts, env.JEV_TIMEOUT_MS, {
    fallback: JEV_DEFAULT_TIMEOUT_MS,
    min: JEV_TIMEOUT_MIN_MS,
    max: JEV_TIMEOUT_MAX_MS,
  });
}

/** Resolves the Laya deadline from `opts.timeoutMs` then `LAYA_TIMEOUT_MS`. */
export function resolveLayaTimeoutMs(env: Pick<ProviderEnv, "LAYA_TIMEOUT_MS">, opts: ClassifyOptions): number {
  return resolveTimeoutMs(opts, env.LAYA_TIMEOUT_MS, {
    fallback: LAYA_DEFAULT_TIMEOUT_MS,
    min: LAYA_TIMEOUT_MIN_MS,
    max: LAYA_TIMEOUT_MAX_MS,
  });
}

/** Distinguishes our own hard deadline (and an aborted fetch) from every other transport failure. */
class ProviderTimeoutError extends Error {
  constructor(provider: string, timeoutMs: number) {
    super(`${provider} timed out after ${timeoutMs}ms`);
    this.name = "ProviderTimeoutError";
  }
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof ProviderTimeoutError || (error instanceof Error && error.name === "AbortError");
}

interface TimedCall {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/**
 * Fetch with a hard deadline. The abort asks the runtime to cancel the socket; the explicit race
 * guarantees we give up even if a mock or a broken transport ignores the signal. A late rejection
 * from the losing fetch is swallowed so it can never surface as an unhandled rejection.
 */
async function callWithTimeout(
  env: ProviderEnv,
  provider: string,
  call: TimedCall,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    deadlineTimer = setTimeout(() => {
      controller.abort();
      reject(new ProviderTimeoutError(provider, timeoutMs));
    }, timeoutMs);
  });

  const request = env.fetch(call.url, {
    method: "POST",
    body: call.body,
    headers: call.headers,
    signal: controller.signal,
  });
  // The race may already have settled; keep the loser from becoming an unhandled rejection.
  void request.catch(() => {});

  try {
    return await Promise.race([request, deadline]);
  } finally {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
  }
}

/* ------------------------------------------------------------------ providers */

/** Why a provider did not answer. `source` plus this reason is the audit trail. */
export type FallbackReason =
  | "not_configured"
  | "transport_error"
  | "timeout"
  | "http_error"
  | "rate_limited"
  | "malformed_json"
  | "out_of_schema";

type ProviderAttemptResult =
  | { readonly ok: true; readonly result: System1Result }
  | { readonly ok: false; readonly reason: FallbackReason; readonly status?: number };

/**
 * The shared tail of both model providers: check the response, read JSON, parse a decision, and let
 * `System1Result.parse` be the final gate. Keeps the two providers' failure taxonomies identical.
 */
async function finishProviderCall(
  provider: "laya" | "jev",
  response: Response,
  parse: (payload: unknown) => JevDecision | null,
): Promise<ProviderAttemptResult> {
  if (!response.ok) {
    return {
      ok: false,
      reason: response.status === 429 ? "rate_limited" : "http_error",
      status: response.status,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, reason: "malformed_json" };
  }

  const decision = parse(payload);
  if (decision === null) return { ok: false, reason: "out_of_schema" };

  try {
    // `System1Result.parse` is the published contract. Anything outside it rejects the model answer
    // and lets the next provider in the chain speak.
    const result = System1Result.parse({
      intent: decision.intent,
      intent_confidence: decision.intentConfidence,
      urgency: decision.urgency,
      mentions_crop_stress: decision.stressProbability >= 0.5,
      source: provider,
    });
    return { ok: true, result };
  } catch {
    return { ok: false, reason: "out_of_schema" };
  }
}

/**
 * One Laya call against the local sidecar. Failure modes, all recorded and all non-throwing:
 *
 *  * `LAYA_ENDPOINT` unset         -> `not_configured` (never touches the network)
 *  * fetch throws / refused / DNS  -> `transport_error`
 *  * our deadline, or an abort     -> `timeout`
 *  * HTTP 429                      -> `rate_limited` (+ status)
 *  * any other non-2xx             -> `http_error` (+ status); a sidecar whose model failed to load
 *                                     answers with a 5xx, which is exactly how "Laya did not run" is
 *                                     told apart from a real decision
 *  * body is not JSON              -> `malformed_json`
 *  * JSON outside the schema       -> `out_of_schema`
 */
async function callLaya(env: ProviderEnv, text: string, opts: ClassifyOptions): Promise<ProviderAttemptResult> {
  if (!providerConfigured("laya", env)) return { ok: false, reason: "not_configured" };
  const endpoint = env.LAYA_ENDPOINT?.trim() ?? "";

  const body = JSON.stringify(buildLayaRequest(text));
  const timeoutMs = resolveLayaTimeoutMs(env, opts);

  let response: Response;
  try {
    response = await callWithTimeout(
      env,
      "laya",
      { url: endpoint, headers: { "content-type": "application/json" }, body },
      timeoutMs,
    );
  } catch (error) {
    return { ok: false, reason: isTimeoutError(error) ? "timeout" : "transport_error" };
  }

  return finishProviderCall("laya", response, (payload) => parseLayaDecision(payload, text));
}

/**
 * One Jev call against OpenRouter's Decisions API. Same failure taxonomy as Laya, plus the key
 * check, and the AI Gateway prefix on the URL.
 */
async function callJev(env: ProviderEnv, text: string, opts: ClassifyOptions): Promise<ProviderAttemptResult> {
  if (!providerConfigured("jev", env)) return { ok: false, reason: "not_configured" };
  const key = env.OPENROUTER_API_KEY?.trim() ?? "";

  const model = firstNonBlank(opts.model, env.JEV_MODEL) ?? JEV_MODEL;
  const url = gatewayUrl(env, OPENROUTER_DECISIONS_URL);
  const body = JSON.stringify(buildJevRequest(text, model));
  const timeoutMs = resolveJevTimeoutMs(env, opts);

  let response: Response;
  try {
    response = await callWithTimeout(
      env,
      "jev",
      { url, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body },
      timeoutMs,
    );
  } catch (error) {
    return { ok: false, reason: isTimeoutError(error) ? "timeout" : "transport_error" };
  }

  return finishProviderCall("jev", response, parseJevDecision);
}

/* ------------------------------------------------------------------ public API */

export interface ClassifyOptions {
  /** Deadline for one provider call, in milliseconds. Defaults to that provider's env value or 4000. */
  timeoutMs?: number;
  /** Override the Jev route slug (`typesafe/jev-1.13` by default). Ignored by the other providers. */
  model?: string;
}

/** One entry in the provider chain's attempt log. */
export interface ProviderAttempt {
  readonly provider: System1ProviderName;
  readonly ok: boolean;
  /** Present only on failure: why this provider did not answer. */
  readonly reason?: FallbackReason;
  /** HTTP status, when the failure was an HTTP response. */
  readonly status?: number;
}

/** A classification plus the provenance the UI and the audit trail need. */
export interface ClassifyOutcome {
  /** Schema-valid `System1Result`; `result.source` matches {@link ClassifyOutcome.source}. */
  readonly result: System1Result;
  /** The tier that actually answered. */
  readonly source: System1ProviderName;
  /** Every provider tried, in order, with its outcome. */
  readonly attempts: readonly ProviderAttempt[];
  /** Present only when the rules answered: why the preferred model provider was not used. */
  readonly fallback?: { readonly reason: FallbackReason; readonly status?: number };
}

function toFallback(attempt: ProviderAttempt): { reason: FallbackReason; status?: number } {
  const reason = attempt.reason ?? "out_of_schema";
  return attempt.status === undefined ? { reason } : { reason, status: attempt.status };
}

/**
 * Classify one farmer message and report which provider answered, and why.
 *
 * Walks the chain from {@link resolveProviderChain} and returns the first provider that produces a
 * schema-valid decision. The rules are always the last link, so this always resolves with a valid
 * result. `attempts` records every failure; `fallback` summarises the first one when the rules
 * ended up answering.
 */
export async function classifyDetailed(
  env: ProviderEnv,
  text: string,
  opts: ClassifyOptions = {},
): Promise<ClassifyOutcome> {
  const chain = resolveProviderChain(env);
  const attempts: ProviderAttempt[] = [];

  for (const provider of chain) {
    if (provider === "rules") {
      const result = classifyByRules(text);
      attempts.push({ provider, ok: true });
      const failure = attempts.find((attempt) => !attempt.ok);
      return failure === undefined
        ? { result, source: "rules", attempts }
        : { result, source: "rules", attempts, fallback: toFallback(failure) };
    }

    const attempt = provider === "laya" ? await callLaya(env, text, opts) : await callJev(env, text, opts);
    if (attempt.ok) {
      attempts.push({ provider, ok: true });
      return { result: attempt.result, source: provider, attempts };
    }
    attempts.push(
      attempt.status === undefined
        ? { provider, ok: false, reason: attempt.reason }
        : { provider, ok: false, reason: attempt.reason, status: attempt.status },
    );
  }

  // Defensive: `resolveProviderChain` always ends with `rules`, so this is unreachable, but the
  // function must still be total.
  const result = classifyByRules(text);
  const failure = attempts.find((attempt) => !attempt.ok);
  return failure === undefined
    ? { result, source: "rules", attempts }
    : { result, source: "rules", attempts, fallback: toFallback(failure) };
}

/**
 * Classify one farmer message into a `System1Result`.
 *
 * The thin wrapper every existing caller uses: same signature as before ADR-006, with `source` on
 * the result naming the tier. Callers that want the fallback trail call {@link classifyDetailed}.
 *
 * @param text Telugu transcript or typed message.
 */
export async function classify(env: ProviderEnv, text: string, opts: ClassifyOptions = {}): Promise<System1Result> {
  return (await classifyDetailed(env, text, opts)).result;
}

export { classifyByRules, extractVolumeM3, extractRequestedHours, normalizeText } from "./system1.rules";
