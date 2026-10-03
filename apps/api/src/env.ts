/// <reference path="./env.d.ts" />
/**
 * Canonical Worker bindings and configuration for the Jadal API.
 *
 * Every credential is optional: the whole application must run with no keys, because the
 * deterministic core, the append-only event log and the simulated phone are the primary demo path
 * (ADR-003). External providers (OpenRouter/Jev, Sarvam, Twilio, Meta WhatsApp, AI Gateway) only
 * improve prose, audio quality or reach; none of them is required for a correct answer.
 *
 * `src/index.ts` is the only place that constructs an `Env`. Modules that need a slice of it
 * declare a structural subset (for example `AgentEnv` in `src/agents/llm.ts` and `ProviderEnv` in
 * `src/system1.ts`) so they stay compilable and testable in isolation, as the interface map
 * requires.
 */
export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  OUTBOUND: Queue;
  ASSETS?: Fetcher;
  DEMO_MODE?: string;
  ENVIRONMENT?: string;
  AI_GATEWAY_URL?: string;
  // --- System 1 (src/system1.ts). One entry point, several providers, chosen by SYSTEM1_PROVIDER.
  /** `laya` | `jev` | `rules` | `auto`. Unset => `auto` (Laya, then Jev, then rules). */
  SYSTEM1_PROVIDER?: string;
  /** Local Laya sidecar base URL, e.g. `http://127.0.0.1:8099/decide`. Unset => Laya is skipped. */
  LAYA_ENDPOINT?: string;
  /** Deadline for one Laya call, in milliseconds as a string. Default 4000; clamped to 100..15000. */
  LAYA_TIMEOUT_MS?: string;
  OPENROUTER_API_KEY?: string;
  /**
   * OpenRouter chat-model slug for the System-2 agent prose. Unset => the module default
   * `openai/gpt-4o-mini` (see `src/agents/llm.ts`).
   */
  OPENROUTER_MODEL?: string;
  /**
   * Maximum OpenRouter spend in USD. Unset => no limit. When the cumulative spend reaches this
   * value, the System-1 provider chain and System-2 agent prose fall back to rules/templates.
   */
  OPENROUTER_SPEND_LIMIT_USD?: string;
  /**
   * Jev route slug on OpenRouter's Decisions API. Unset => the module default `typesafe/jev-1.13`
   * (see `src/system1.ts`). `~typesafe/jev-latest` floats to the newest release; `typesafe/jev-router`
   * is a chat-model router and is NOT a valid Decisions model (ADR-006).
   */
  JEV_MODEL?: string;
  /** Deadline for one Jev call, in milliseconds as a string. Default 4000; clamped to 250..15000. */
  JEV_TIMEOUT_MS?: string;
  SARVAM_API_KEY?: string;
  // --- telephony (B8 module, mounted by B9). Names only; values live in `.dev.vars` or `wrangler
  // secret put`. Real calls need the four Twilio/public-URL names together.
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  /** Caller ID, E.164. Named `TWILIO_FROM_NUMBER` because that is what `src/telephony` reads. */
  TWILIO_FROM_NUMBER?: string;
  /**
   * Demo-only redirect of outbound call destinations: one or more E.164 numbers, comma-separated.
   * Unset keeps production behaviour (dial the farmer's own number). See `forwardTarget`.
   */
  TWILIO_FORWARD_TO?: string;
  /** Public https origin Twilio can reach for webhooks, e.g. a cloudflared tunnel or the deployed Worker. */
  PUBLIC_BASE_URL?: string;
  /** Optional: Deepgram `nova-3` STT fallback when Sarvam cannot transcribe. */
  DEEPGRAM_API_KEY?: string;
  /** Optional: Sarvam `bulbul` speaker for Telugu TTS (module default `shubh`). */
  SARVAM_TTS_SPEAKER?: string;
  /** "1" skips `X-Twilio-Signature` validation. LOCAL TESTS ONLY; never set on a deployed Worker. */
  SKIP_TWILIO_SIGNATURE?: string;
  META_WHATSAPP_TOKEN?: string;
  META_PHONE_NUMBER_ID?: string;
  REAL_TELEPHONY?: string;
  // --- Failproof observability
  FAILPROOF_API_KEY?: string;
  FAILPROOF_TRACE?: string;
  // --- Durable Workflows (B7)
  URGENT_REQUEST_WORKFLOW?: Workflow;
  CALL_CAMPAIGN_WORKFLOW?: Workflow;
}

/**
 * A message placed on the `jadal-outbound` queue is typed by
 * `src/campaigns/escalation.ts`'s `OutboundMessage`; the queue consumer below reads its
 * `contact_id` and hands the rest to `runEscalation`.
 */

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off", ""]);

/** `true`/`false` for a recognised spelling, `undefined` for "unset" or "unrecognised". */
function parseFlag(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (TRUTHY.has(normalized)) return true;
  if (FALSY.has(normalized)) return false;
  return undefined;
}

function hasText(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

/**
 * True when the deployment runs the offline demo path.
 *
 * Demo mode is the default: with `DEMO_MODE` unset the app still serves the seed scenario, the
 * simulated clock and the simulated phone without a single key (ADR-003, B-SPEC §4). Set
 * `DEMO_MODE=false` (`0`/`no`/`off`) to opt into live providers. An unrecognised value also means
 * "demo", so a typo degrades to the safe path instead of turning on real traffic.
 */
export function isDemo(env: Pick<Env, "DEMO_MODE">): boolean {
  return parseFlag(env.DEMO_MODE) ?? true;
}

/**
 * True only when real PSTN calling is explicitly enabled *and* a complete Twilio credential set is
 * present. A half-configured deployment therefore keeps using the simulated phone instead of
 * failing a judge's call, which is the ADR-003 hard requirement. Callers that must never place a
 * real call during the demo should additionally require `!isDemo(env)`.
 *
 * This mirrors `realCallsEnabled` in `src/telephony/twilio.ts`, including `PUBLIC_BASE_URL`: without a
 * public origin Twilio cannot fetch the TwiML, so a call placed without it would ring and then go
 * silent. B9 aligned the two predicates — before, this one ignored the base URL and reported `true`
 * for a deployment that could not actually complete a call.
 */
export function isRealTelephony(
  env: Pick<Env, "REAL_TELEPHONY" | "TWILIO_ACCOUNT_SID" | "TWILIO_AUTH_TOKEN" | "TWILIO_FROM_NUMBER" | "PUBLIC_BASE_URL">,
): boolean {
  if (parseFlag(env.REAL_TELEPHONY) !== true) return false;
  return (
    hasText(env.TWILIO_ACCOUNT_SID) &&
    hasText(env.TWILIO_AUTH_TOKEN) &&
    hasText(env.TWILIO_FROM_NUMBER) &&
    hasText(env.PUBLIC_BASE_URL)
  );
}
