import type { Contact, System1Result } from "@jadal/contracts";

import type { MessageFacts } from "../voice/telugu";

/** Env subset the telephony module needs. Declared locally so the module stays decoupled from the Worker `Env`. */
export interface TelephonyEnv {
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  /** E.164 Twilio number used as caller ID. */
  TWILIO_FROM_NUMBER?: string;
  /**
   * Demo-only redirect of the call destination: one or more E.164 numbers, comma-separated.
   * Unset keeps production behaviour (dial the farmer). See `forwardTarget` in `./twilio`.
   */
  TWILIO_FORWARD_TO?: string;
  /** Public https origin Twilio can reach, e.g. https://jadal-api.example.workers.dev (trailing slash tolerated). */
  PUBLIC_BASE_URL?: string;
  SARVAM_API_KEY?: string;
  DEEPGRAM_API_KEY?: string;
  /** Optional Sarvam speaker override for bulbul. */
  SARVAM_TTS_SPEAKER?: string;
  /** "1" skips X-Twilio-Signature validation. LOCAL TESTS ONLY. */
  SKIP_TWILIO_SIGNATURE?: string;
  /** "0" or "false" forces simulated mode even when the Twilio vars are present. */
  REAL_TELEPHONY?: string;
}

/** Binary cache (KV / R2 / Cache API / Map). Keys are opaque strings. */
export interface AudioCache {
  get(key: string): Promise<ArrayBuffer | null>;
  put(key: string, value: ArrayBuffer): Promise<void>;
}

export type ContactStatusValue = Contact["status"];
export type RaisedRequestType = "urgent" | "buffer";

export interface RaiseRequestInput {
  farmerId: string;
  type: RaisedRequestType;
  reason: string;
  channel: "voice";
}

export interface StatusDetail {
  callStatus: string;
  callSid?: string;
  durationSec?: number;
}

/* ------------------------------------------------------------------ inbound + speech paths */

/**
 * A speech-to-text engine the telephony module can call. `sarvam` (`saaras`, primary per ADR-005) and
 * `deepgram` (`nova-3`, `language=te`) are the two real engines; there is deliberately no "twilio"
 * member, because Twilio's own `<Gather input="speech">` recogniser is never used here — the reply is
 * always recorded and transcribed by a provider we can name, so the engine recorded is always true.
 */
export type SttEngine = "sarvam" | "deepgram";

/**
 * Which path actually ran for one spoken phase, recorded so a failed provider is never silently
 * reported as audio that played (task 5).
 *
 *  * `sarvam` — real Sarvam audio was synthesised and is what `<Play>` fetches.
 *  * `deepgram` — Deepgram produced the transcript.
 *  * `say` — Sarvam was unavailable/failed, so Twilio's `<Say language="te-IN">` reads the text.
 *  * `keyword` — no engine produced a transcript, so System-1 keyword rules classified the empty text.
 *  * `none` — nothing could be spoken (used only for a phase that was skipped).
 */
export type SpeechPath = "sarvam" | "deepgram" | "say" | "keyword" | "none";

/** The phases a call can record a {@link SpeechPath} for. */
export type SpeechPhase = "greeting" | "prompt" | "listen_cue" | "confirmation" | "alert" | "transcript";

/** One recorded decision about which speech path ran. */
export interface SpeechPathDetail {
  readonly phase: SpeechPhase;
  readonly path: SpeechPath;
  /** The Telugu/English text spoken or transcribed, when there is one. */
  readonly text?: string;
  /** Why the fallback happened, e.g. `sarvam tts 503`. Never a credential. */
  readonly reason?: string;
  /** Caller's number (`From`) for an inbound call. */
  readonly caller?: string;
  /** Resolved farmer, when the caller could be matched. */
  readonly farmerId?: string;
  /** Resolved contact, when the caller could be matched to an open contact. */
  readonly contactId?: string;
}

/**
 * The farmer an inbound call is attributed to.
 *
 * `contactId` is optional: a farmer calling in about an urgent request usually has no open contact, so
 * an acknowledgement (`DTMF 1`) is only written when a contact is known.
 */
export interface InboundCaller {
  readonly farmerId: string;
  readonly farmerName?: string;
  readonly contactId?: string;
}

export interface TelephonyDeps {
  env: TelephonyEnv;
  fetch: typeof fetch;
  cache: AudioCache;
  /** Path the module is mounted at. Default "/api/telephony". */
  mountPath?: string;
  getContact(contactId: string): Promise<Contact | null>;
  /** Telugu text spoken to the farmer for this contact. */
  getMessage(contactId: string): Promise<string>;
  recordAck(contactId: string, acknowledged: boolean, via: string): Promise<void>;
  updateContactStatus(contactId: string, status: ContactStatusValue, detail?: StatusDetail): Promise<void>;
  classify(transcript: string): Promise<System1Result>;
  raiseRequest(input: RaiseRequestInput): Promise<void>;
  /** Optional: persist the transcript and the STT engine that produced it. */
  onTranscript?(contactId: string, transcript: string, engine: SttEngine): Promise<void>;
  /** Optional: override for tests (back-off while a Twilio recording becomes available). */
  sleep?(ms: number): Promise<void>;

  /**
   * Optional: resolve the caller of an **inbound** call (`From`, E.164) to a farmer.
   *
   * Absent (or returning `null`) is not an error: the agent still answers, greets and understands, it
   * just cannot attribute a raised request to a farmer, and says so honestly. Wiring this in
   * `telephony-deps.ts` is the one change this module needs but does not make (see `docs/VOICE.md`).
   */
  resolveCaller?(phone: string): Promise<InboundCaller | null>;
  /**
   * Optional: the facts for a farmer's next turn, so a spoken release-time question can be answered
   * with the real day/window/volume. Absent → the agent promises a callback rather than inventing one.
   */
  nextTurnFor?(farmerId: string): Promise<MessageFacts | null>;
  /**
   * Optional: record which speech path ran for a phase. Called for every `<Play>`/`<Say>` decision and
   * for every transcription, so "Sarvam was down" is visible instead of looking like silence.
   */
  onSpeechPath?(detail: SpeechPathDetail): Promise<void>;
}

export type PlaceCallResult =
  | { simulated: true }
  | { simulated: false; ok: true; callSid: string; status: string }
  | { simulated: false; ok: false; error: string; httpStatus?: number };

export interface PlaceCallInput {
  contactId: string;
  /** E.164 destination (+91...). Must be a verified caller ID on a Twilio trial. */
  to: string;
  /** Telugu message; used to pre-warm the TTS cache. */
  messageTe: string;
}
