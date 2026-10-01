/**
 * System-1 classifier — the fast reflex layer described in
 * `docs/research/deterministic-and-system1.md` §3 and `ADR-004`.
 *
 * Layering, in order:
 *   1. Jev (`typesafe/jev-router` over OpenRouter) for a typed `choice` / `score` / `noul` decision.
 *   2. Laya, the open-weight offline fallback. Not runnable in a Workers deployment (it needs an
 *      ONNX/PyPI runtime, see the research doc §3), so this module reports `source: "rules"` for
 *      that tier rather than pretending. The slot is kept so the ordering survives the swap.
 *   3. `classifyByRules`, pure and offline.
 *
 * Contract: `classify` never throws and never rejects. Any failure degrades to the rules, because a
 * triage service that 500s during a farmer's call is worse than one that guesses conservatively.
 *
 * Every outbound call goes through `env.fetch` so tests can intercept it and so Cloudflare AI
 * Gateway can sit in front of it (`AI_GATEWAY_URL`).
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
  /** OpenRouter key for Jev. Absent in every test and in the offline demo → rules only. */
  OPENROUTER_API_KEY?: string;
  /** Sarvam key for STT/TTS. See `src/voice/sarvam.ts`. */
  SARVAM_API_KEY?: string;
  /**
   * Cloudflare AI Gateway base, e.g. `https://gateway.ai.cloudflare.com/v1/<acct>/<gw>`. When set,
   * every provider URL becomes `<AI_GATEWAY_URL>/<full provider url>` (ADR-001).
   */
  AI_GATEWAY_URL?: string;
  /** Overrides the Jev route slug. */
  JEV_MODEL?: string;
}

/* ------------------------------------------------------------------ configuration */

/** ADR-004: Jev is reached as `typesafe/jev-router` on OpenRouter. */
export const JEV_MODEL = "typesafe/jev-router";

/**
 * OpenRouter's OpenAI-compatible chat endpoint.
 *
 * ASSUMED: `docs/research/deterministic-and-system1.md` §2 names Jev's own API
 * (`https://api.typesafe.ai/v1/systemone`) and confirms it is also served "via OpenRouter", but
 * gives no request/response shape for either. ADR-004 commits us to the OpenRouter route, and the
 * OpenRouter route is OpenAI-compatible, so we use the standard base below and ask for JSON with
 * `response_format: { type: "json_object" }` (the most broadly supported structured-output mode)
 * rather than the stricter `json_schema`, which an upstream router may not implement.
 */
export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Sub-500 ms is Jev's advertised latency; 4 s leaves room for a cold start without stalling a call. */
export const JEV_TIMEOUT_MS = 4000;

/* ------------------------------------------------------------------ Jev request shape */

const JEV_SCHEMA_TEXT = `{"intent":"<one of ${System1Intent.options.join("|")}>","intent_confidence":<number 0..1>,"urgency":<number 0..1>,"mentions_crop_stress":<number 0..1>}`;

const JEV_SYSTEM_PROMPT = [
  "You are Jev, the System-1 triage classifier for Jadal, an irrigation-canal allocation service for Andhra Pradesh farmers.",
  "You speak Telugu (te-IN) and English. Farmer messages arrive as Sarvam speech-to-text transcripts, often Tenglish or misspelt.",
  "Answer with ONE JSON object and nothing else. No prose, no markdown fence.",
  "",
  "Use these typed decision primitives:",
  '  choice   -> "intent": exactly one of: ' + System1Intent.options.join(", ") + ".",
  '  score    -> "urgency": 0..1 and "intent_confidence": 0..1, both calibrated.',
  '  noul     -> "mentions_crop_stress": calibrated yes/no probability in 0..1 (>= 0.5 means yes).',
  "",
  "Exact schema: " + JEV_SCHEMA_TEXT,
  "",
  "Urgency rubric: 0.00-0.15 thanks or no water needed; 0.16-0.35 routine question or a plain ask;",
  "0.36-0.60 visible wilting or cracking soil; 0.61-0.85 crop dying without water today;",
  "0.86-1.00 crop dead or dying and the farmer says they need water immediately.",
  'Set "mentions_crop_stress" high only when the farmer describes the crop suffering (dry, wilting, dying, no water in the channel).',
  "Never refuse and never invent farmer names, phone numbers or quotas.",
].join("\n");

export interface JevRequestBody {
  model: string;
  temperature: number;
  response_format: { type: "json_object" };
  messages: readonly { role: "system" | "user"; content: string }[];
}

/** Builds the exact OpenRouter body sent to Jev. Exported so tests can assert the shape. */
export function buildJevRequest(text: string, model: string = JEV_MODEL): JevRequestBody {
  return {
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: JEV_SYSTEM_PROMPT },
      { role: "user", content: text },
    ],
  };
}

/**
 * Reads `choices[0].message.content` out of an OpenAI-compatible envelope.
 *
 * Hand-rolled rather than zod-parsed: `zod` is a dependency of `@jadal/contracts`, not of this
 * package, and B-SPEC forbids pulling in packages we cannot install offline. Everything that must
 * satisfy the published contract is still gated by `System1Result.parse` at the end of `callJev`.
 */
function readMessageContent(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return null;
  const first = choices[0];
  if (typeof first !== "object" || first === null) return null;
  const message = (first as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

interface JevDecision {
  readonly intent: System1Result["intent"];
  readonly intentConfidence: number;
  readonly urgency: number;
  /** `noul` probability; >= 0.5 is yes. */
  readonly stressProbability: number;
}

/**
 * `mentions_crop_stress` is a `noul` probability; a bare boolean is accepted too because that is
 * what a chat-tuned route tends to emit. `urgency` and `intent_confidence` are range-checked later
 * by `System1Result.parse`, which is what makes an out-of-range urgency fall back to the rules.
 */
function parseJevDecision(value: unknown): JevDecision | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const intent = raw["intent"];
  const isIntent = typeof intent === "string" && (System1Intent.options as readonly string[]).includes(intent);
  if (!isIntent) return null;

  const intentConfidence = raw["intent_confidence"];
  const urgency = raw["urgency"];
  if (typeof intentConfidence !== "number" || typeof urgency !== "number") return null;
  if (!Number.isFinite(intentConfidence) || !Number.isFinite(urgency)) return null;

  const stress = raw["mentions_crop_stress"];
  let stressProbability: number;
  if (typeof stress === "number" && Number.isFinite(stress)) {
    stressProbability = stress;
  } else if (typeof stress === "boolean") {
    stressProbability = stress ? 1 : 0;
  } else {
    return null;
  }

  return { intent: intent as System1Result["intent"], intentConfidence, urgency, stressProbability };
}

/** Models sometimes wrap JSON in a ```json fence despite instructions. Strip it. */
function stripFence(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```[a-zA-Z]*\n?/, "")
    .replace(/```$/, "")
    .trim();
}

/* ------------------------------------------------------------------ transport */

/**
 * Cloudflare AI Gateway proxying. The gateway's provider-proxied form is
 * `<gateway base>/<full upstream url>`, so we concatenate rather than replace.
 */
export function gatewayUrl(env: Pick<ProviderEnv, "AI_GATEWAY_URL">, url: string): string {
  const base = env.AI_GATEWAY_URL?.trim();
  if (!base) return url;
  return `${base.replace(/\/+$/, "")}/${url}`;
}

/** True when System 1 may attempt a model call at all. */
export function jevEnabled(env: Pick<ProviderEnv, "OPENROUTER_API_KEY">): boolean {
  const key = env.OPENROUTER_API_KEY?.trim();
  return key !== undefined && key.length > 0;
}

interface TimedCall {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly signal: AbortSignal | undefined;
}

/**
 * Fetch with a hard deadline. `AbortSignal.timeout` asks the runtime to abort; the explicit race
 * guarantees we give up even if a mock or a broken transport ignores the signal. Both timers are
 * cleared so a Workers isolate is never held open by a spent deadline.
 */
async function callWithTimeout(env: ProviderEnv, call: TimedCall, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), timeoutMs);
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    deadlineTimer = setTimeout(() => {
      controller.abort();
      reject(new Error(`jev timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      env.fetch(call.url, {
        method: "POST",
        body: call.body,
        headers: call.headers,
        signal: call.signal === undefined ? controller.signal : call.signal,
      }),
      deadline,
    ]);
  } finally {
    clearTimeout(abortTimer);
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
  }
}

/**
 * One Jev call. Returns null for every failure mode — missing key, transport throw, non-2xx,
 * unparseable envelope, non-JSON content, or a decision that fails `System1Result.parse`
 * (for example an urgency of 1.4). Callers treat null as "use the rules".
 */
async function callJev(env: ProviderEnv, text: string, opts: ClassifyOptions): Promise<System1Result | null> {
  const key = env.OPENROUTER_API_KEY?.trim();
  if (!key) return null;

  const url = gatewayUrl(env, OPENROUTER_CHAT_URL);
  const body = JSON.stringify(buildJevRequest(text, opts.model ?? env.JEV_MODEL ?? JEV_MODEL));
  const timeoutMs = opts.timeoutMs ?? JEV_TIMEOUT_MS;

  let response: Response;
  try {
    response = await callWithTimeout(
      env,
      {
        url,
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body,
        signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined,
      },
      timeoutMs,
    );
  } catch {
    return null;
  }

  try {
    if (!response.ok) return null;
    const content = readMessageContent(await response.json());
    if (content === null) return null;

    const decision = parseJevDecision(JSON.parse(stripFence(content)));
    if (decision === null) return null;

    // Final gate: `System1Result.parse` is the published contract. Anything outside it (urgency 2,
    // confidence -1, an intent Jev hallucinated) rejects the model answer and lets the rules speak.
    return System1Result.parse({
      intent: decision.intent,
      intent_confidence: decision.intentConfidence,
      urgency: decision.urgency,
      mentions_crop_stress: decision.stressProbability >= 0.5,
      source: "jev",
    });
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ public API */

export interface ClassifyOptions {
  /** Deadline for the Jev call. Defaults to {@link JEV_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Override the Jev route slug (`typesafe/jev-router` by default). */
  model?: string;
}

/**
 * Classify one farmer message into a `System1Result`.
 *
 * Tries Jev, then Laya's offline slot (currently reported as `rules`), then the keyword rules.
 * Always resolves with a schema-valid result and `source` naming the tier that answered.
 *
 * @param text Telugu transcript or typed message.
 */
export async function classify(env: ProviderEnv, text: string, opts: ClassifyOptions = {}): Promise<System1Result> {
  const fallback = classifyByRules(text);

  if (!jevEnabled(env)) {
    // No key: never touch the network. The rules tier is the whole System-1 layer here.
    return fallback;
  }

  const fromJev = await callJev(env, text, opts);
  if (fromJev !== null) {
    return fromJev;
  }

  // Tier 2 is Laya (open-weight ONNX, multilingual checkpoint). A Workers isolate cannot host it
  // and the repo has no runtime for it, so we report the rules tier instead of a model that was
  // never consulted. Swap this block for `runLaya()` when the ONNX binding lands.
  return fallback;
}

export { classifyByRules, extractVolumeM3, extractRequestedHours, normalizeText } from "./system1.rules";
