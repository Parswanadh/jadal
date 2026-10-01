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
  OPENROUTER_API_KEY?: string;
  SARVAM_API_KEY?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM?: string;
  META_WHATSAPP_TOKEN?: string;
  META_PHONE_NUMBER_ID?: string;
  REAL_TELEPHONY?: string;
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
 */
export function isRealTelephony(
  env: Pick<Env, "REAL_TELEPHONY" | "TWILIO_ACCOUNT_SID" | "TWILIO_AUTH_TOKEN" | "TWILIO_FROM">,
): boolean {
  if (parseFlag(env.REAL_TELEPHONY) !== true) return false;
  return (
    hasText(env.TWILIO_ACCOUNT_SID) && hasText(env.TWILIO_AUTH_TOKEN) && hasText(env.TWILIO_FROM)
  );
}
