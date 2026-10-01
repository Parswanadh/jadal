/**
 * C6 — Simulated phone: mock fixtures, API client with mock fallback, and
 * pure helpers. All numbers/audio shown by the phone UI come from either the
 * API (`/api/contacts`, `/api/phone/:id/reply`) or these clearly-labelled
 * mocks — never hardcoded elsewhere in the UI.
 */

/** Caller ID shown on the incoming-call screen (required by the demo). */
export const CALLER_ID = "Jadal \u2013 Water Committee";
export const CALLER_ID_TE = "\u0C1C\u0C21\u0C32\u0C4D \u2013 \u0C28\u0C40\u0C1F\u0C3F \u0C15\u0C2E\u0C3F\u0C1F\u0C40";

/** Mock sender number. Obviously fake; used only when the API is unreachable. */
export const MOCK_CALLER_NUMBER = "+91 90000 00000";

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

/** Incoming voice call used when `/api/contacts` is unreachable (demo seed). */
export const MOCK_VOICE_CONTACT: PhoneContact = {
  id: "contact-mock-voice-1",
  farmer_id: "farmer-mock-1",
  channel: "voice",
  purpose: "release_warning",
  status: "delivered",
  message_te:
    "\u0C30\u0C48\u0C24\u0C41 \u0C17\u0C3E\u0C30\u0C41, \u0C28\u0C2E\u0C38\u0C4D\u0C15\u0C3E\u0C30\u0C02. \u0C30\u0C47\u0C2A\u0C1F\u0C3F \u0C30\u0C3E\u0C24\u0C4D\u0C30\u0C3F 10 \u0C17\u0C02\u0C1F\u0C32\u0C15\u0C41 \u0C2E\u0C40 \u0C2A\u0C4A\u0C24\u0C15\u0C41 \u0C28\u0C40\u0C30\u0C41 \u0C35\u0C3F\u0C21\u0C41\u0C26\u0C32 \u0C05\u0C35\u0C41\u0C24\u0C41\u0C02\u0C26\u0C3F. \u0C26\u0C2F\u0C1A\u0C47\u0C38\u0C3F \u0C15\u0C3E\u0C32\u0C41\u0C35 \u0C35\u0C26\u0C4D\u0C26\u0C15\u0C41 \u0C35\u0C46\u0C33\u0C4D\u0C32\u0C02\u0C21\u0C3F.",
  message_en:
    "Namaskaram, farmer. Water will be released to your outlet tonight at 10 PM. Please be at the field channel.",
  at: "2026-03-15T16:30:00.000Z",
};

/** Night-release WhatsApp alerts shown in the message drawer (demo seed). */
export const MOCK_WHATSAPP_ALERTS: PhoneContact[] = [
  {
    id: "contact-mock-wa-1",
    farmer_id: "farmer-mock-1",
    channel: "whatsapp",
    purpose: "release_warning",
    status: "delivered",
    message_te:
      "\u0C30\u0C3E\u0C24\u0C4D\u0C30\u0C3F 10 \u0C17\u0C02\u0C1F\u0C32\u0C15\u0C41 \u0C28\u0C40\u0C30\u0C41 \u0C35\u0C3F\u0C21\u0C41\u0C26\u0C32 \u0C05\u0C35\u0C41\u0C24\u0C41\u0C02\u0C26\u0C3F. \u0C2E\u0C40 \u0C35\u0C02\u0C24\u0C41 2 \u0C17\u0C02\u0C1F\u0C32\u0C41 \u0C09\u0C02\u0C1F\u0C41\u0C02\u0C26\u0C3F.",
    message_en:
      "Night release at 10 PM tonight. Your turn is 2 hours. Reply ACK to confirm.",
    at: "2026-03-15T16:00:00.000Z",
  },
  {
    id: "contact-mock-wa-2",
    farmer_id: "farmer-mock-1",
    channel: "whatsapp",
    purpose: "roster_change",
    status: "sent",
    message_te:
      "\u0C30\u0C47\u0C2A\u0C1F\u0C3F \u0C35\u0C02\u0C24\u0C41 \u0C30\u0C3E\u0C24\u0C4D\u0C30\u0C3F 10 \u0C17\u0C02\u0C1F\u0C32 \u0C28\u0C41\u0C02\u0C21\u0C3F 12 \u0C17\u0C02\u0C1F\u0C32\u0C15\u0C41 \u0C2E\u0C3E\u0C30\u0C3F\u0C02\u0C26\u0C3F. \u0C17\u0C2E\u0C28\u0C3F\u0C02\u0C1A\u0C02\u0C21\u0C3F.",
    message_en:
      "Tomorrow's turn moved from 10 PM to 12 midnight. Please note the change.",
    at: "2026-03-15T15:30:00.000Z",
  },
];

export const MOCK_AGENT_REPLY_TE =
  "\u0C27\u0C28\u0C4D\u0C2F\u0C35\u0C3E\u0C26\u0C3E\u0C32\u0C41. \u0C2E\u0C40 \u0C38\u0C2E\u0C3E\u0C27\u0C3E\u0C28\u0C02 \u0C28\u0C2E\u0C4B\u0C26\u0C41 \u0C05\u0C2F\u0C3F\u0C02\u0C26\u0C3F.";
export const MOCK_AGENT_REPLY_EN =
  "Thank you. Your reply has been recorded.";

/* ------------------------------------------------------------------ */
/* API client (with mock fallback)                                     */
/* ------------------------------------------------------------------ */

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
}

function isPhoneContact(value: unknown): value is PhoneContact {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["id"] === "string" &&
    typeof v["farmer_id"] === "string" &&
    typeof v["channel"] === "string" &&
    typeof v["status"] === "string" &&
    typeof v["message_te"] === "string" &&
    typeof v["message_en"] === "string" &&
    typeof v["at"] === "string"
  );
}

/** GET /api/contacts; falls back to mocks when the backend is unreachable. */
export async function fetchContacts(): Promise<{
  contacts: PhoneContact[];
  source: ApiSource;
}> {
  try {
    const res = await fetch("/api/contacts");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: unknown = await readJson(res);
    if (!Array.isArray(data)) throw new Error("unexpected shape");
    const contacts = (data as unknown[]).filter(isPhoneContact);
    if (contacts.length === 0) throw new Error("empty contacts");
    return { contacts, source: "api" };
  } catch {
    return {
      contacts: [MOCK_VOICE_CONTACT, ...MOCK_WHATSAPP_ALERTS],
      source: "mock",
    };
  }
}

export interface ReplyInput {
  text?: string;
  audio_base64?: string;
  mime?: string;
}

/**
 * POST /api/phone/:contactId/reply. On any failure returns a mock
 * acknowledgement so the demo works offline.
 */
export async function postPhoneReply(
  contact: PhoneContact,
  input: ReplyInput,
): Promise<{ result: PhoneReplyResult; source: ApiSource }> {
  const fallback: PhoneReplyResult = {
    contact: { ...contact, status: "acknowledged" },
    agent_reply_te: MOCK_AGENT_REPLY_TE,
    agent_reply_en: MOCK_AGENT_REPLY_EN,
    audio_base64: makeToneWavBase64(),
  };
  try {
    const res = await fetch(
      `/api/phone/${encodeURIComponent(contact.id)}/reply`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await readJson(res)) as {
      contact?: unknown;
      agent_reply_te?: unknown;
      agent_reply_en?: unknown;
      audio_base64?: unknown;
    } | null;
    if (
      !data ||
      !isPhoneContact(data.contact) ||
      typeof data.agent_reply_te !== "string" ||
      typeof data.agent_reply_en !== "string"
    ) {
      throw new Error("unexpected shape");
    }
    return {
      result: {
        contact: data.contact,
        agent_reply_te: data.agent_reply_te,
        agent_reply_en: data.agent_reply_en,
        audio_base64:
          typeof data.audio_base64 === "string"
            ? data.audio_base64
            : undefined,
      },
      source: "api",
    };
  } catch {
    return { result: fallback, source: "mock" };
  }
}

/* ------------------------------------------------------------------ */
/* Pure helpers (unit-tested)                                          */
/* ------------------------------------------------------------------ */

/** Bilingual acknowledgement label for a contact status. */
export function ackLabel(status: ContactStatus, lang: "te" | "en"): string {
  const table: Record<ContactStatus, { te: string; en: string }> = {
    queued: { te: "\u0C2A\u0C02\u0C2A\u0C28\u0C41 \u0C35\u0C30\u0C41\u0C38\u0C32\u0C4B \u0C09\u0C02\u0C26\u0C3F", en: "Queued" },
    sent: { te: "\u0C2A\u0C02\u0C2A\u0C3E\u0C30\u0C41", en: "Sent" },
    delivered: { te: "\u0C1A\u0C47\u0C30\u0C3F\u0C02\u0C26\u0C3F", en: "Delivered" },
    acknowledged: { te: "\u0C27\u0C43\u0C35\u0C40\u0C15\u0C30\u0C3F\u0C02\u0C1A\u0C3E\u0C30\u0C41", en: "Acknowledged" },
    failed: { te: "\u0C35\u0C3F\u0C2B\u0C32\u0C02", en: "Failed" },
    escalated: { te: "\u0C2A\u0C48\u0C15\u0C3F \u0C38\u0C4D\u0C25\u0C3E\u0C2F\u0C3F\u0C15\u0C3F \u0C2A\u0C02\u0C2A\u0C3E\u0C30\u0C41", en: "Escalated" },
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

/** Format an ISO timestamp for the phone UI (UTC, deterministic). */
export function formatTime(iso: string, lang: "te" | "en"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return lang === "te" ? "\u0C24\u0C46\u0C32\u0C3F\u0C2F\u0C26\u0C41" : "unknown";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} UTC`;
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
