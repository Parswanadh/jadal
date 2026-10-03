/**
 * OpenRouter chat client — the only place in Jadal that talks to a language model.
 *
 * Layering (docs/architecture/overview.md §2): System-2 agents propose, the deterministic core
 * decides the numbers. This module moves *prose* only. It never sees a crop, a volume or a ledger
 * balance, and it has no tool of its own: the agent loop hands it tool schemas and it answers with
 * either text or a typed tool call.
 *
 * ASSUMPTION (AI Gateway): `AI_GATEWAY_URL` is treated as an OpenAI-compatible base URL that is
 * *prefixed* with the same path OpenRouter uses, so a deployment can point every model call at
 * Cloudflare AI Gateway (logging, rate limits, provider failover) without any code change:
 *
 *   AI_GATEWAY_URL = "https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/openai"
 *   final URL      = AI_GATEWAY_URL + "/chat/completions"
 *
 * The `Authorization` header is still required in that mode, because AI Gateway's OpenAI-compatible
 * route forwards the provider key it is configured with. Set `env.fetch` for tests; leave it unset
 * in the Worker, where the runtime's own `fetch` is used.
 *
 * Fallback contract — this function NEVER throws and NEVER rejects:
 *   * no `OPENROUTER_API_KEY`      → `{ content: null, toolCalls: [], source: "fallback" }`
 *   * network error / timeout      → same
 *   * non-JSON or unrecognised body→ same
 *   * a single tool call whose `arguments` is not a JSON object → that call is dropped, the rest of
 *     the response is used normally. One malformed tool call must not discard a valid answer.
 *
 * Every agent therefore works with zero API keys: keys only improve prose, never behaviour.
 */

/** OpenRouter's OpenAI-compatible base. Also the path appended to `AI_GATEWAY_URL`. */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const CHAT_PATH = "/chat/completions";

/** Total budget for one model call, including connection and body read. */
export const CHAT_TIMEOUT_MS = 20_000;

/**
 * ASSUMED: a small, cheap, instruction-following model. The agents only need short prose rewrites
 * and one-shot tool selection, never reasoning; a large model costs more and is slower to fail over.
 * Override per deployment with `env.OPENROUTER_MODEL`.
 */
export const DEFAULT_MODEL = "openai/gpt-4o-mini";

/** ASSUMED: low temperature. Tool arguments are parsed as data, so sampling noise buys nothing. */
const TEMPERATURE = 0.1;

/**
 * The injected fetch surface, shaped like `test/harness.ts` `TestEnv.fetch` so the same `createEnv`
 * object serves both the app and the tests. `body` is `string`, not `unknown`, because that is
 * assignable to both this interface and the DOM `BodyInit`.
 */
export type AgentFetch = (input: string, init?: { method?: string; body?: string; headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>

/**
 * The bindings the agents read.
 *
 * `DB` / `CACHE` / `OUTBOUND` are the Worker's own bindings (`src/index.ts` `Env`), so an agent
 * runs unchanged in production and in a test. The three `OPENROUTER_*` keys are optional: with none
 * of them set, every agent takes its deterministic path.
 */
export interface AgentEnv {
  DB: D1Database;
  CACHE?: KVNamespace;
  OUTBOUND?: Queue;
  /** Present in tests (`test/harness.ts`); absent in the Worker, where global `fetch` is used. */
  fetch?: AgentFetch;
  OPENROUTER_API_KEY?: string;
  AI_GATEWAY_URL?: string;
  OPENROUTER_MODEL?: string;
  /** Maximum OpenRouter spend in USD, as a string. Unset/blank => no limit. See `isOverSpendLimit`. */
  OPENROUTER_SPEND_LIMIT_USD?: string;
}

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Present on `tool` messages: the `id` of the tool call being answered. */
  tool_call_id?: string;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  /** Parsed JSON arguments. Always an object; a malformed argument string yields `{}` and is dropped. */
  args: Record<string, unknown>;
}

export interface ChatResult {
  /** Assistant prose, or `null` when the model only asked for tools. */
  content: string | null;
  toolCalls: ToolCallRequest[];
  /** `"llm"` when a model actually answered; `"fallback"` when the caller must use its own path. */
  source: "llm" | "fallback";
}

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  tools?: unknown[];
  maxTokens?: number;
}

const FALLBACK: ChatResult = { content: null, toolCalls: [], source: "fallback" };

/* ------------------------------------------------------------------ spend limit */

/**
 * USD per 1M tokens for the models Jadal may call. Only the default model is listed; an unknown slug
 * is charged at a deliberately high fallback so an unpriced model is over-counted, never free.
 */
const MODEL_PRICES: Readonly<Record<string, { readonly inputPerM: number; readonly outputPerM: number }>> = {
  "openai/gpt-4o-mini": { inputPerM: 0.15, outputPerM: 0.6 },
};
const DEFAULT_PRICE = { inputPerM: 1, outputPerM: 3 } as const;

/**
 * Cumulative OpenRouter spend this isolate has observed, in USD.
 *
 * Module-level on purpose: this is a coarse guard against a runaway demo, not a billing ledger. A
 * Worker runs many isolates and recycles them, so each isolate counts only what it saw; the hard
 * stop remains the account limit on OpenRouter itself. A durable counter would need D1 or KV.
 */
let cumulativeSpendUsd = 0;

/** The configured limit in USD, or `null` when unset, blank or unparseable (i.e. no limit). */
export function spendLimitUsd(env: Pick<AgentEnv, "OPENROUTER_SPEND_LIMIT_USD">): number | null {
  const raw = env.OPENROUTER_SPEND_LIMIT_USD?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Cumulative spend this isolate has recorded, in USD. */
export function spentUsd(): number {
  return cumulativeSpendUsd;
}

/** Add to the cumulative spend. Only finite, positive amounts count; anything else is ignored. */
export function recordSpendUsd(usd: number): void {
  if (Number.isFinite(usd) && usd > 0) cumulativeSpendUsd += usd;
}

/** Reset the counter. Exported for tests. */
export function resetSpendTracker(): void {
  cumulativeSpendUsd = 0;
}

/** True once cumulative spend has reached the configured limit. `false` when no limit is set. */
export function isOverSpendLimit(env: Pick<AgentEnv, "OPENROUTER_SPEND_LIMIT_USD">): boolean {
  const limit = spendLimitUsd(env);
  return limit !== null && cumulativeSpendUsd >= limit;
}

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Cost of one call from a provider `usage` object, in USD.
 *
 * Prefers a `cost` the provider reported (Jev's Decisions API returns one); otherwise estimates from
 * the token counts, accepting both the chat (`prompt_tokens`/`completion_tokens`) and Decisions
 * (`input_tokens`/`output_tokens`) spellings. A missing or malformed usage counts as 0.
 */
export function estimateCostUsd(model: string, usage: unknown): number {
  const record = asRecord(usage);
  if (record === null) return 0;
  const reported = record["cost"];
  if (typeof reported === "number" && Number.isFinite(reported) && reported >= 0) return reported;
  const inputTokens = tokenCount(record["prompt_tokens"] ?? record["input_tokens"]);
  const outputTokens = tokenCount(record["completion_tokens"] ?? record["output_tokens"]);
  const price = MODEL_PRICES[model] ?? DEFAULT_PRICE;
  return (inputTokens * price.inputPerM + outputTokens * price.outputPerM) / 1_000_000;
}

/** `null` for both "no key configured" and "runtime has no fetch to use". */
function endpoint(env: AgentEnv): { url: string; key: string } | null {
  const key = env.OPENROUTER_API_KEY;
  if (key === undefined || key.trim().length === 0) return null;
  const gateway = env.AI_GATEWAY_URL;
  const base =
    gateway === undefined || gateway.trim().length === 0
      ? OPENROUTER_BASE_URL
      : gateway.trim().replace(/\/+$/, "");
  return { url: `${base}${CHAT_PATH}`, key: key.trim() };
}

/** The injected `env.fetch` when present, otherwise the runtime's own fetch. */
function fetcherFor(env: AgentEnv): AgentFetch {
  const injected = env.fetch;
  if (injected !== undefined) return injected;
  return (input, init) => globalThis.fetch(input, init);
}

/** Exactly the body posted to the provider. Exported so tests can assert the wire shape. */
export function requestBody(req: ChatRequest, model: string): Record<string, unknown> {
  const messages: Record<string, unknown>[] = [{ role: "system", content: req.system }];
  for (const message of req.messages) {
    const entry: Record<string, unknown> = { role: message.role, content: message.content };
    if (message.tool_call_id !== undefined) entry.tool_call_id = message.tool_call_id;
    messages.push(entry);
  }
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: TEMPERATURE,
    max_tokens: req.maxTokens ?? 900,
  };
  if (req.tools !== undefined && req.tools.length > 0) {
    body.tools = req.tools;
    body.tool_choice = "auto";
  }
  return body;
}

function requestHeaders(key: string): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${key}`,
    // OpenRouter attributes traffic with these two; harmless elsewhere, useful for cost tracking.
    "x-title": "Jadal",
    "http-referer": "https://jadal.local",
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Parse an OpenAI-compatible chat completion. Returns `null` when the payload is not a completion
 * this client understands, which the caller treats as a fallback.
 */
export function parseChatResponse(payload: unknown): ChatResult | null {
  const root = asRecord(payload);
  if (root === null) return null;
  const choices = root.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const message = asRecord(asRecord(choices[0])?.message);
  if (message === null) return null;

  const content = asString(message.content);
  const rawCalls = message.tool_calls;

  const toolCalls: ToolCallRequest[] = [];
  if (Array.isArray(rawCalls)) {
    for (const [index, entry] of rawCalls.entries()) {
      const call = asRecord(entry);
      if (call === null) continue;
      const fn = asRecord(call.function);
      if (fn === null) continue;
      const name = asString(fn.name);
      if (name === null || name.length === 0) continue;
      const argumentText = asString(fn.arguments) ?? "{}";
      let args: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(argumentText);
        args = asRecord(parsed) ?? {};
      } catch {
        // Dropping the call is safer than passing raw text to a tool: every tool validates its
        // input against a zod schema, and a string is never a valid input object.
        continue;
      }
      toolCalls.push({ id: asString(call.id) ?? `call_${index}`, name, args });
    }
  }

  const trimmed = content === null ? null : content.trim();
  if (toolCalls.length === 0 && (trimmed === null || trimmed.length === 0)) {
    // An empty completion is useless to the caller and indistinguishable from a failure.
    return null;
  }
  return { content: trimmed === null || trimmed.length === 0 ? null : trimmed, toolCalls, source: "llm" };
}

/** One model call. Never throws; see the fallback contract at the top of this file. */
export async function chat(env: AgentEnv, req: ChatRequest): Promise<ChatResult> {
  const target = endpoint(env);
  if (target === null) return { ...FALLBACK };
  // The spend limit short-circuits before the provider is reached, so a capped deployment makes no
  // call at all and the caller takes its deterministic path.
  if (isOverSpendLimit(env)) return { ...FALLBACK };

  const model = env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
  const body = JSON.stringify(requestBody(req, model));

  try {
    const response = await fetcherFor(env)(target.url, {
      method: "POST",
      headers: requestHeaders(target.key),
      body,
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
    if (!response.ok) return { ...FALLBACK };
    const payload = await response.json();
    recordSpendUsd(estimateCostUsd(model, asRecord(payload)?.["usage"]));
    const parsed = parseChatResponse(payload);
    return parsed ?? { ...FALLBACK };
  } catch {
    // Network failure, DNS, TLS, abort on timeout, or a body that is not JSON. All are fallbacks.
    return { ...FALLBACK };
  }
}

/**
 * Prose-only helper for the agents' explanations: same fallback contract, no tools, no tool calls.
 * Returns `null` when there is no usable model answer, and every caller has a deterministic
 * template for that case.
 */
export async function rewrite(env: AgentEnv, system: string, prompt: string, maxTokens?: number): Promise<string | null> {
  const result = await chat(env, { system, messages: [{ role: "user", content: prompt }], maxTokens });
  return result.source === "llm" ? result.content : null;
}
