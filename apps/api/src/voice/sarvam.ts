/**
 * Sarvam AI speech wrappers — the Telugu voice layer of the caller agent (`ADR-003`).
 *
 * Two jobs, both transport-only:
 *   * `stt` — farmer audio (base64, as it arrives from the simulated phone and from `routes.intake`)
 *     → a Telugu transcript, model `saaras`.
 *   * `tts` — a Telugu message → base64 audio, model `bulbul`.
 *
 * Request shapes are copied verbatim from `docs/research/voice-and-data.md` §3.1:
 *   * STT `POST https://api.sarvam.ai/speech-to-text`, header `api-subscription-key`,
 *     `multipart/form-data` with `file` / `language_code` / `model`.
 *   * TTS `POST https://api.sarvam.ai/text-to-speech`, header `api-subscription-key`, JSON body
 *     `{ text, language_code, model, speaker, pace, speech_sample_rate }`, answer in `audios[0]`.
 *
 * DEVIATION FROM §3.1, DELIBERATE: §3.1 pins the *versioned* slugs `saaras:v4` and `bulbul:v3`.
 * `ADR-003` names the unversioned models `saaras` and `bulbul`, and an unversioned slug is what
 * the vendor currently serves as the moving default. Both are sent unversioned here; pin a version
 * in {@link STT_MODEL} / {@link TTS_MODEL} if reproducibility ever outweighs the always-latest model.
 *
 * AI Gateway (ADR-001): every URL is prefixed through `gatewayUrl` from `../system1` when
 * `AI_GATEWAY_URL` is set, so the same code path serves production and tests.
 *
 * CONTRACT: **neither function ever throws and neither ever rejects.** Both resolve `null` for
 * every failure mode — no `SARVAM_API_KEY`, audio that is not base64, transport throw, deadline
 * expiry, non-2xx status, a body that is not JSON, an envelope missing the transcript or the audio,
 * and a TTS answer whose `audios[0]` is not genuinely base64. Callers rely on this: `routes.intake`
 * and `routes.phoneReply` both accept an optional `text` beside `audio_base64`, so a `null` here
 * degrades the call to text instead of failing the farmer's request. A missing key therefore makes
 * **zero** network calls.
 */

import { gatewayUrl, type ProviderEnv } from "../system1";

/* ------------------------------------------------------------------ endpoints and parameters */

export const SARVAM_STT_URL = "https://api.sarvam.ai/speech-to-text";
export const SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech";

/** ADR-003: `saaras` is the Telugu speech-to-text model. */
export const STT_MODEL = "saaras";
/** ADR-003: `bulbul` is the Telugu text-to-speech model. */
export const TTS_MODEL = "bulbul";
/** BCP-47 tag for Telugu as spoken in Andhra Pradesh. §3.1 uses `te-IN` for both directions. */
export const TELUGU_LANGUAGE_CODE = "te-IN";
/** §3.1 lists `meera` and `shubh` as the Telugu speakers; `meera` is the default everywhere. */
export const DEFAULT_SPEAKER = "meera";
/**
 * §3.1 uses 8 kHz because these payloads travel over a PSTN/WhatsApp voice bridge. The simulated
 * phone in the portal can play 16 kHz, so this is overridable per call.
 */
export const DEFAULT_SPEECH_SAMPLE_RATE = 8000;
export const DEFAULT_PACE = 1.0;

/** ASSUMED: §3.1 advertises ~250–350 ms REST turnaround but documents no timeout. 8 s leaves room
 *  for a cold start without ever stalling a farmer's call past patience. */
export const SPEECH_TIMEOUT_MS = 8000;

/** §3.1's authentication header, spelled exactly as the vendor documents it (lowercase). */
const SUBSCRIPTION_KEY_HEADER = "api-subscription-key";

/** Default audio type for `stt`; §3.1 accepts WAV, MP3 or raw PCM. */
export const DEFAULT_AUDIO_MIME = "audio/wav";

/**
 * Multipart boundary. Fixed rather than random so a request is byte-for-byte reproducible, which is
 * what lets a test assert on the encoded body. A collision would require the audio payload to
 * contain this 22-byte ASCII run; the worst case is that the provider rejects the part, not that a
 * caller's data is corrupted.
 */
export const MULTIPART_BOUNDARY = "----JadalVoiceBoundary";

/* ------------------------------------------------------------------ shared transport */

/** Everything {@link fetchWithDeadline} needs for one provider call. */
export interface ProviderRequest {
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly headers: Record<string, string>;
  readonly body?: Uint8Array | string;
  readonly timeoutMs: number;
}

/**
 * Fetch with a hard deadline, returning `null` for any failure.
 *
 * It lives here because `../system1` has an equivalent (`callWithTimeout`) that is private to that
 * module, and this task does not own that file — so both voice clients share this one copy instead
 * of each keeping its own abort-and-race. Two deadlines are armed: `AbortSignal.timeout` asks the
 * runtime to abort the request, and an explicit race guarantees we give up even against a transport
 * or a mock that ignores the signal. Both timers are cleared so a Workers isolate is never held open
 * by a spent deadline.
 *
 * Never throws.
 */
export async function fetchWithDeadline(env: ProviderEnv, request: ProviderRequest): Promise<Response | null> {
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), request.timeoutMs);

  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    deadlineTimer = setTimeout(() => {
      controller.abort();
      reject(new Error(`provider call timed out after ${request.timeoutMs}ms: ${request.url}`));
    }, request.timeoutMs);
  });

  const runtimeSignal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(request.timeoutMs) : undefined;

  try {
    const init: {
      method: string;
      headers: Record<string, string>;
      body?: Uint8Array | string;
      signal: AbortSignal;
    } = {
      method: request.method,
      headers: request.headers,
      signal: runtimeSignal === undefined ? controller.signal : runtimeSignal,
    };
    if (request.body !== undefined) init.body = request.body;
    return await Promise.race([env.fetch(request.url, init), deadline]);
  } catch {
    return null;
  } finally {
    clearTimeout(abortTimer);
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
  }
}

/* ------------------------------------------------------------------ base64 */

/** Canonical padded base64: whole 4-character groups, optionally ending in one or two `=`. */
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Is this string genuinely base64?
 *
 * Sarvam has been observed returning an error page or a bare `"null"` inside `audios[0]` on some
 * failures, so the answer is pattern-checked *and* decoded before it is handed to the caller. An
 * empty string is rejected: it decodes to zero bytes of audio, which would look like success.
 */
export function isBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false;
  if (!BASE64_PATTERN.test(value)) return false;
  try {
    atob(value);
  } catch {
    return false;
  }
  return true;
}

/** Strict base64 → bytes. `null` for anything `atob` refuses, which is how bad input degrades. */
export function decodeBase64(value: string): Uint8Array | null {
  if (!isBase64(value)) return null;
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i) & 0xff;
  }
  return bytes;
}

/* ------------------------------------------------------------------ multipart */

/** One text field, e.g. `language_code`. */
export interface MultipartField {
  readonly name: string;
  readonly value: string;
}

/** One file part, e.g. `file`. */
export interface MultipartFile {
  readonly name: string;
  readonly filename: string;
  readonly contentType: string;
  readonly data: Uint8Array;
}

/**
 * Encode a multipart/form-data body by hand.
 *
 * Hand-rolled rather than `FormData`/`Blob` on purpose: this module runs both on the Workers
 * runtime and under Node in vitest, and building the bytes ourselves means the exact octets — and
 * therefore the exact `content-type` with its boundary — are identical in both, with nothing relying
 * on a runtime-specific `FormData` implementation or on `fetch` deriving a boundary we would then
 * have to recover. CRLF line endings throughout, per RFC 7578.
 */
export function buildMultipartBody(
  fields: readonly MultipartField[],
  files: readonly MultipartFile[],
  boundary: string = MULTIPART_BOUNDARY,
): { body: Uint8Array; contentType: string } {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const push = (text: string): void => {
    chunks.push(encoder.encode(text));
  };

  for (const field of fields) {
    push(`--${boundary}\r\n`);
    push(`Content-Disposition: form-data; name="${field.name}"\r\n\r\n`);
    push(`${field.value}\r\n`);
  }

  for (const file of files) {
    push(`--${boundary}\r\n`);
    push(`Content-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\n`);
    push(`Content-Type: ${file.contentType}\r\n\r\n`);
    chunks.push(file.data);
    push("\r\n");
  }

  push(`--${boundary}--\r\n`);

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

/** Filenames for the audio types §3.1 accepts. Unknown types fall back to the WAV name. */
const AUDIO_FILENAMES: Readonly<Record<string, string>> = {
  "audio/wav": "audio.wav",
  "audio/x-wav": "audio.wav",
  "audio/wave": "audio.wav",
  "audio/vnd.wave": "audio.wav",
  "audio/mpeg": "audio.mp3",
  "audio/mp3": "audio.mp3",
  "audio/webm": "audio.webm",
  "audio/ogg": "audio.ogg",
  "audio/flac": "audio.flac",
};

/** MIME type (with any `;codecs=` parameter dropped) → the filename sent in the `file` part. */
export function audioFilename(mime: string): string {
  const bare = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return AUDIO_FILENAMES[bare] ?? "audio.wav";
}

/* ------------------------------------------------------------------ STT */

/**
 * ASSUMED RESPONSE SHAPE: §3.1 documents the STT request and lists the languages and models but
 * gives no response body. The vendor serves Telugu transcripts as `transcripts[0].text`, and older
 * deployments returned a bare top-level `text`. Both are read; anything else degrades to `null`
 * rather than being guessed at, which keeps a transcript out of the ledger that never existed.
 */
function readTranscript(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const root = payload as { transcripts?: unknown; text?: unknown };

  if (Array.isArray(root.transcripts)) {
    for (const entry of root.transcripts) {
      if (typeof entry !== "object" || entry === null) continue;
      const text = (entry as { text?: unknown }).text;
      if (typeof text === "string" && text.trim().length > 0) return text.trim();
    }
  }

  if (typeof root.text === "string" && root.text.trim().length > 0) return root.text.trim();
  return null;
}

/**
 * Transcribe farmer audio to Telugu text.
 *
 * @param audioBase64 Raw audio, base64-encoded, exactly as `routes.intake` and `routes.phoneReply`
 *   receive it (`audio_base64`). Must decode to real bytes; invalid input returns `null` without a
 *   network call.
 * @param mime Audio content type. Drives the `Content-Type` of the `file` part and the filename;
 *   defaults to `audio/wav`.
 * @returns The transcript, or `null` for every failure (see the module contract).
 */
export async function stt(env: ProviderEnv, audioBase64: string, mime: string = DEFAULT_AUDIO_MIME): Promise<string | null> {
  const key = env.SARVAM_API_KEY?.trim();
  // No key: never touch the network. The voice loop falls back to the typed `text` on the request.
  if (key === undefined || key.length === 0) return null;

  const audio = decodeBase64(audioBase64);
  if (audio === null) return null;

  const { body, contentType } = buildMultipartBody(
    [
      { name: "language_code", value: TELUGU_LANGUAGE_CODE },
      { name: "model", value: STT_MODEL },
    ],
    [{ name: "file", filename: audioFilename(mime), contentType: mime, data: audio }],
    MULTIPART_BOUNDARY,
  );

  const response = await fetchWithDeadline(env, {
    url: gatewayUrl(env, SARVAM_STT_URL),
    method: "POST",
    headers: { [SUBSCRIPTION_KEY_HEADER]: key, "content-type": contentType },
    body,
    timeoutMs: SPEECH_TIMEOUT_MS,
  });
  if (response === null || !response.ok) return null;

  try {
    return readTranscript(await response.json());
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ TTS */

/** Per-call TTS overrides; the defaults are §3.1's documented values. */
export interface TtsOptions {
  readonly speaker?: string;
  readonly pace?: number;
  readonly speechSampleRate?: number;
  readonly timeoutMs?: number;
}

/** The exact JSON body sent to §3.1's TTS endpoint. Exported so tests assert the shape, not a copy. */
export interface TtsRequestBody {
  readonly text: string;
  readonly language_code: string;
  readonly model: string;
  readonly speaker: string;
  readonly pace: number;
  readonly speech_sample_rate: number;
}

export function buildTtsRequestBody(text: string, options: TtsOptions = {}): TtsRequestBody {
  return {
    text,
    language_code: TELUGU_LANGUAGE_CODE,
    model: TTS_MODEL,
    speaker: options.speaker ?? DEFAULT_SPEAKER,
    pace: options.pace ?? DEFAULT_PACE,
    speech_sample_rate: options.speechSampleRate ?? DEFAULT_SPEECH_SAMPLE_RATE,
  };
}

/** `audios[0]`, if it is a string that is genuinely base64. `null` otherwise. */
function readAudio(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const audios = (payload as { audios?: unknown }).audios;
  if (!Array.isArray(audios) || audios.length === 0) return null;
  const first = audios[0];
  if (typeof first !== "string" || !isBase64(first)) return null;
  return first;
}

/**
 * Synthesise a Telugu message into base64 audio.
 *
 * @param text Message to speak. Templates come from `./telugu`; plain Telugu works too.
 * @returns `audios[0]` as base64, or `null` for every failure — including a response whose audio is
 *   not decodable, which is why {@link isBase64} is a gate and not a formality.
 */
export async function tts(env: ProviderEnv, text: string, options: TtsOptions = {}): Promise<string | null> {
  const key = env.SARVAM_API_KEY?.trim();
  if (key === undefined || key.length === 0) return null;

  const spoken = text.trim();
  if (spoken.length === 0) return null;

  const response = await fetchWithDeadline(env, {
    url: gatewayUrl(env, SARVAM_TTS_URL),
    method: "POST",
    headers: { [SUBSCRIPTION_KEY_HEADER]: key, "content-type": "application/json" },
    body: JSON.stringify(buildTtsRequestBody(spoken, options)),
    timeoutMs: options.timeoutMs ?? SPEECH_TIMEOUT_MS,
  });
  if (response === null || !response.ok) return null;

  try {
    return readAudio(await response.json());
  } catch {
    return null;
  }
}

/** True when a TTS attempt is worth making at all. Mirrors the key check inside {@link tts}. */
export function ttsEnabled(env: Pick<ProviderEnv, "SARVAM_API_KEY">): boolean {
  const key = env.SARVAM_API_KEY?.trim();
  return key !== undefined && key.length > 0;
}