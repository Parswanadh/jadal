import { formatDateTime } from "../lib/format";

/**
 * C6 - Simulated phone: constants, view types and pure helpers.
 * Contacts and replies come from the shared API client (see api.ts), which
 * serves the contract-validated mock in demo mode. Nothing shown by the phone
 * UI is hard-coded here except the caller ID and the simulated-audio tone.
 */

/** Caller ID shown on the incoming-call screen (required by the demo). */
export const CALLER_ID = "Jadal Water Committee";
export const CALLER_ID_TE = "జాదల్ నీటి కమిటీ";

export type ContactChannel = "voice" | "whatsapp" | "sms" | "portal";
export type ContactStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "acknowledged"
  | "failed"
  | "escalated";

/** Structural subset of the contracts `Contact` entity (kept local so this
 *  module stays dependency-free and runnable under plain node). */
export interface PhoneContact {
  id: string;
  farmer_id: string;
  channel: ContactChannel;
  purpose: "roster_change" | "release_warning" | "request_update" | "reminder";
  status: ContactStatus;
  message_te: string;
  message_en: string;
  at: string;
  transcript?: string;
}

export interface PhoneReplyResult {
  contact: PhoneContact;
  agent_reply_te: string;
  agent_reply_en: string;
  /** base64-encoded audio payload (TTS), when the API provides one. */
  audio_base64?: string;
}

export type ApiSource = "api" | "mock";

export interface TranscriptTurn {
  id: string;
  from: "committee" | "farmer" | "agent";
  text_te: string;
  text_en: string;
  at: string;
}

/* ------------------------------------------------------------------ */
/* Pure helpers (unit-tested)                                          */
/* ------------------------------------------------------------------ */

/** Plain-language label for a contact status, in the active language. */
export function ackLabel(status: ContactStatus, lang: "te" | "en"): string {
  const table: Record<ContactStatus, { te: string; en: string }> = {
    queued: { te: "పంపడానికి వేచి ఉంది", en: "Waiting" },
    sent: { te: "పంపాము", en: "Sent" },
    delivered: { te: "చేరింది", en: "Delivered" },
    acknowledged: { te: "ధృవీకరించారు", en: "Confirmed" },
    failed: { te: "చేరలేదు", en: "Failed" },
    escalated: { te: "సమన్వయకర్తకు పంపాము", en: "Passed to the coordinator" },
  };
  return table[status][lang];
}

/** UI tone key for a status badge (resolved to colours in CSS). */
export function ackTone(status: ContactStatus): "wait" | "ok" | "bad" {
  switch (status) {
    case "acknowledged":
      return "ok";
    case "failed":
    case "escalated":
      return "bad";
    default:
      return "wait";
  }
}

/** Build a playable data URL from an API/mocked base64 audio payload. */
export function toAudioDataUrl(
  audio_base64: string,
  mime = "audio/wav",
): string {
  return `data:${mime};base64,${audio_base64}`;
}

/** Decoded byte length of a base64 payload (validates the `=` padding). */
export function base64ByteLength(b64: string): number {
  const clean = b64.replace(/\s+/g, "");
  if (clean.length === 0) return 0;
  if (clean.length % 4 !== 0) {
    throw new Error("invalid base64 length");
  }
  let padding = 0;
  if (clean.endsWith("==")) padding = 2;
  else if (clean.endsWith("=")) padding = 1;
  return (clean.length / 4) * 3 - padding;
}

/** Format an ISO timestamp for the phone UI, for example "Mon 14 Sep, 6:00 am" (India time). */
export function formatTime(iso: string, lang: "te" | "en"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return lang === "te" ? "తెలియదు" : "unknown";
  return formatDateTime(iso, lang);
}

/**
 * Synthesize a tiny mono WAV (sine tone) and return it base64-encoded.
 * Used ONLY as the mock TTS payload when the API is unreachable, so the
 * "play announcement" button still produces audio offline. The UI always
 * labels this path as simulated.
 */
export function makeToneWavBase64(
  freqHz = 440,
  seconds = 0.6,
  sampleRate = 8000,
): string {
  const samples = Math.max(1, Math.floor(sampleRate * seconds));
  const data = new Uint8Array(44 + samples * 2);
  const view = new DataView(data.buffer);
  const writeAscii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i += 1) {
    const t = i / sampleRate;
    const envelope = Math.min(1, (i / sampleRate) * 20, ((samples - i) / sampleRate) * 20);
    const sample = Math.round(
      32767 * 0.5 * envelope * Math.sin(2 * Math.PI * freqHz * t),
    );
    view.setInt16(44 + i * 2, sample, true);
  }
  return base64Encode(data);
}

/** Dependency-free base64 encoder (browser + node safe, no btoa/Buffer). */
export function base64Encode(bytes: Uint8Array): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const triple = (a << 16) | (b << 8) | c;
    out += alphabet[(triple >> 18) & 63];
    out += alphabet[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? alphabet[triple & 63] : "=";
  }
  return out;
}

/** Browser-only: read an uploaded voice clip as base64. Kept out of tests. */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const url = String(reader.result ?? "");
      const comma = url.indexOf(",");
      resolve(comma >= 0 ? url.slice(comma + 1) : url);
    };
    reader.readAsDataURL(file);
  });
}

/** Feature detection: mic recording is optional (upload always offered). */
export function detectCapabilities(): {
  speechSynthesis: boolean;
  mediaRecorder: boolean;
} {
  return {
    speechSynthesis:
      typeof window !== "undefined" &&
      "speechSynthesis" in window &&
      typeof window.speechSynthesis?.speak === "function",
    mediaRecorder:
      typeof window !== "undefined" &&
      typeof (window as unknown as Record<string, unknown>)["MediaRecorder"] ===
        "function",
  };
}
