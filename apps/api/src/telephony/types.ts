import type { Contact, System1Result } from "@jadal/contracts";

/** Env subset the telephony module needs. Declared locally so the module stays decoupled from the Worker `Env`. */
export interface TelephonyEnv {
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  /** E.164 Twilio number used as caller ID. */
  TWILIO_FROM_NUMBER?: string;
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
  onTranscript?(contactId: string, transcript: string, engine: "sarvam" | "deepgram"): Promise<void>;
  /** Optional: override for tests (back-off while a Twilio recording becomes available). */
  sleep?(ms: number): Promise<void>;
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
