/**
 * The Jadal voice **call script** — every meaningful thing the caller agent can say, in Telugu.
 *
 * `./telugu` owns the prose builders; this module owns the *selection*: it turns a typed description
 * of a conversational moment (`SpokenMessage`) into the Telugu sentence the agent speaks, and into the
 * English sentence shown beside it. Nothing here builds a sentence by hand — every branch delegates to
 * a `telugu.ts` builder — so the call script cannot drift from the WhatsApp/portal copy, and a phrase
 * that is missing from `telugu.ts` is a compile error here rather than English leaking onto the line.
 *
 * The five things task 2 names are all reachable through {@link spokenTelugu}:
 *
 *   * the farmer's next turn — `{ kind: "next_turn" }` → day, window and volume in m³
 *   * confirmation of an approved urgent request — `{ kind: "request_approved" }`
 *   * a warning/alert with a severity — `{ kind: "alert", severity }`, one of `info`/`warning`/`urgent`/`emergency`
 *   * the inbound answer — `{ kind: "inbound_greeting" }` and `{ kind: "inbound_prompt" }`
 *   * the honest failures — `{ kind: "not_understood" }`, `{ kind: "caller_unknown" }`
 *
 * Pure and total: no I/O, no clock, no network. The telephony layer synthesises whatever this returns.
 */

import {
  CALLER_UNKNOWN_EN,
  CALLER_UNKNOWN_TE,
  INBOUND_PROMPT_EN,
  INBOUND_PROMPT_TE,
  LISTEN_CUE_EN,
  LISTEN_CUE_TE,
  NOT_UNDERSTOOD_EN,
  NOT_UNDERSTOOD_TE,
  REQUEST_FAILED_EN,
  REQUEST_FAILED_TE,
  SCHEDULE_HOLD_EN,
  SCHEDULE_HOLD_TE,
  ackRecordedEn,
  ackRecordedTe,
  alertEn,
  alertTe,
  inboundGreetingEn,
  inboundGreetingTe,
  isAlertSeverity,
  nextTurnEn,
  nextTurnTe,
  requestApprovedEn,
  requestApprovedTe,
  requestRecordedEn,
  requestRecordedTe,
  type AlertSeverity,
  type MessageFacts,
} from "./telugu";

export { ALERT_SEVERITIES, isAlertSeverity, type AlertSeverity } from "./telugu";

/**
 * The conversational moments the agent can speak.
 *
 * `facts` carries whatever the caller already knows (name, window, volume, outlet); a builder given a
 * missing fact degrades to a shorter but still-correct sentence, so every kind is speakable with `{}`.
 */
export type SpokenMessage =
  /** Answering a call the farmer placed. */
  | { readonly kind: "inbound_greeting"; readonly farmerName?: string }
  /** The DTMF/voice prompt after the inbound greeting. */
  | { readonly kind: "inbound_prompt" }
  /** The cue before `<Record>` starts listening. */
  | { readonly kind: "listen_cue" }
  /** Day, time window and volume of the farmer's next turn. */
  | { readonly kind: "next_turn"; readonly facts: MessageFacts }
  /** An urgent request that has been approved, with the granted volume/window when known. */
  | { readonly kind: "request_approved"; readonly facts: MessageFacts }
  /** An urgent request just recorded on an inbound call; a callback is promised. */
  | { readonly kind: "request_recorded"; readonly facts: MessageFacts }
  /** A warning/alert at a severity. */
  | { readonly kind: "alert"; readonly severity: AlertSeverity; readonly facts: MessageFacts }
  /** A release-time question with no turn facts to answer from. */
  | { readonly kind: "schedule_hold" }
  /** A plain acknowledgement of a keypress/answer. */
  | { readonly kind: "acknowledge" }
  /** Nothing transcribable arrived. */
  | { readonly kind: "not_understood" }
  /** The caller's number is not on the roster. */
  | { readonly kind: "caller_unknown" }
  /** The request could not be written to the log. */
  | { readonly kind: "request_failed" };

/** Every {@link SpokenMessage} kind, as a runtime array. Drives enumeration and route validation. */
export const SPOKEN_MESSAGE_KINDS: readonly SpokenMessage["kind"][] = [
  "inbound_greeting",
  "inbound_prompt",
  "listen_cue",
  "next_turn",
  "request_approved",
  "request_recorded",
  "alert",
  "schedule_hold",
  "acknowledge",
  "not_understood",
  "caller_unknown",
  "request_failed",
];

/** Is this string one of {@link SPOKEN_MESSAGE_KINDS}? */
export function isSpokenMessageKind(value: string): value is SpokenMessage["kind"] {
  return (SPOKEN_MESSAGE_KINDS as readonly string[]).includes(value);
}

/**
 * Render a conversational moment as the Telugu the agent speaks.
 *
 * Exhaustive by construction: the `never` assignment in the default branch makes a new
 * `SpokenMessage` kind a typecheck failure until it is given a Telugu line.
 */
export function spokenTelugu(message: SpokenMessage): string {
  switch (message.kind) {
    case "inbound_greeting":
      return inboundGreetingTe(message.farmerName);
    case "inbound_prompt":
      return INBOUND_PROMPT_TE;
    case "listen_cue":
      return LISTEN_CUE_TE;
    case "next_turn":
      return nextTurnTe(message.facts);
    case "request_approved":
      return requestApprovedTe(message.facts);
    case "request_recorded":
      return requestRecordedTe(message.facts);
    case "alert":
      return alertTe(message.severity, message.facts);
    case "schedule_hold":
      return SCHEDULE_HOLD_TE;
    case "acknowledge":
      return ackRecordedTe({});
    case "not_understood":
      return NOT_UNDERSTOOD_TE;
    case "caller_unknown":
      return CALLER_UNKNOWN_TE;
    case "request_failed":
      return REQUEST_FAILED_TE;
    default: {
      const exhaustive: never = message;
      return exhaustive;
    }
  }
}

/** The same moment in English, for the portal/WhatsApp thread that sits beside the call. */
export function spokenEnglish(message: SpokenMessage): string {
  switch (message.kind) {
    case "inbound_greeting":
      return inboundGreetingEn(message.farmerName);
    case "inbound_prompt":
      return INBOUND_PROMPT_EN;
    case "listen_cue":
      return LISTEN_CUE_EN;
    case "next_turn":
      return nextTurnEn(message.facts);
    case "request_approved":
      return requestApprovedEn(message.facts);
    case "request_recorded":
      return requestRecordedEn(message.facts);
    case "alert":
      return alertEn(message.severity, message.facts);
    case "schedule_hold":
      return SCHEDULE_HOLD_EN;
    case "acknowledge":
      return ackRecordedEn({});
    case "not_understood":
      return NOT_UNDERSTOOD_EN;
    case "caller_unknown":
      return CALLER_UNKNOWN_EN;
    case "request_failed":
      return REQUEST_FAILED_EN;
    default: {
      const exhaustive: never = message;
      return exhaustive;
    }
  }
}

/* ------------------------------------------------------------------ transport round-trip */

/** The `MessageFacts` keys that travel in a query string, in a stable order. */
const FACT_KEYS = [
  "farmerName",
  "windowStart",
  "windowEnd",
  "outletName",
  "chainageM",
  "allocatedM3",
  "rainMm",
  "leadHours",
  "requestStatus",
  "requestVolumeM3",
  "statusLabelTe",
  "isLongerTurn",
  "isLongerThanBaseline",
] as const;

/** Facts that are numbers; everything else is text. Keeps `chainageM=4B` from becoming `NaN`. */
const NUMERIC_FACT_KEYS = new Set<string>(["chainageM", "allocatedM3", "rainMm", "leadHours", "requestVolumeM3"]);
/** Facts that are boolean flags. */
const BOOLEAN_FACT_KEYS = new Set<string>(["isLongerTurn", "isLongerThanBaseline"]);

/** Read {@link MessageFacts} out of a query string, dropping empty and unparseable values. */
export function factsFromParams(params: URLSearchParams): MessageFacts {
  const facts: Record<string, string | number | boolean> = {};
  for (const key of FACT_KEYS) {
    const raw = params.get(key);
    if (raw === null || raw.length === 0) continue;
    if (NUMERIC_FACT_KEYS.has(key)) {
      const value = Number(raw);
      if (Number.isFinite(value)) facts[key] = value;
    } else if (BOOLEAN_FACT_KEYS.has(key)) {
      if (raw === "true" || raw === "1") facts[key] = true;
      else if (raw === "false" || raw === "0") facts[key] = false;
    } else {
      facts[key] = raw;
    }
  }
  return facts as MessageFacts;
}

/**
 * Rebuild a {@link SpokenMessage} from query params — the inverse of {@link scriptAudioUrl}.
 *
 * `null` for an unknown `kind` or a missing/invalid severity, so the audio route 400s instead of
 * synthesising something the caller never asked for.
 */
export function messageFromParams(params: URLSearchParams): SpokenMessage | null {
  const kind = params.get("kind") ?? "";
  if (!isSpokenMessageKind(kind)) return null;
  switch (kind) {
    case "inbound_greeting": {
      const farmerName = params.get("farmerName");
      return farmerName === null || farmerName.length === 0 ? { kind } : { kind, farmerName };
    }
    case "alert": {
      const severity = params.get("severity") ?? "";
      if (!isAlertSeverity(severity)) return null;
      return { kind, severity, facts: factsFromParams(params) };
    }
    case "next_turn":
    case "request_approved":
    case "request_recorded":
      return { kind, facts: factsFromParams(params) };
    default:
      return { kind } as SpokenMessage;
  }
}

/**
 * The `<Play>` URL that speaks `message` — `/script/audio?kind=…&<facts>` under `root`.
 *
 * One URL builder for both the TwiML that references the audio and the route that serves it, so the
 * text the agent decided to say and the text Sarvam is asked for cannot diverge.
 */
export function scriptAudioUrl(root: string, message: SpokenMessage): string {
  const params = new URLSearchParams();
  params.set("kind", message.kind);
  if (message.kind === "inbound_greeting" && message.farmerName !== undefined && message.farmerName.length > 0) {
    params.set("farmerName", message.farmerName);
  }
  if (message.kind === "alert") params.set("severity", message.severity);
  if (
    message.kind === "next_turn" ||
    message.kind === "request_approved" ||
    message.kind === "request_recorded" ||
    message.kind === "alert"
  ) {
    for (const [key, value] of Object.entries(message.facts)) {
      if (value !== undefined && value !== "") params.set(key, String(value));
    }
  }
  return `${root.replace(/\/+$/, "")}/script/audio?${params.toString()}`;
}
