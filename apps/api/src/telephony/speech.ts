import { fromBase64 } from "./signature";
import type { SttEngine } from "./types";

export const SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech";
export const SARVAM_STT_URL = "https://api.sarvam.ai/speech-to-text";
export const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen";
/** Deepgram `language=multi` does NOT cover Telugu; nova-3 supports Telugu only as monolingual `te`. See ADR-005. */
export const DEEPGRAM_QUERY = "model=nova-3&language=te&smart_format=true";

type Fetch = typeof fetch;

/** Sarvam bulbul TTS (Telugu). Returns WAV bytes; 8 kHz suits the PSTN. */
export async function sarvamTts(f: Fetch, apiKey: string, text: string, speaker = "shubh"): Promise<ArrayBuffer> {
  const res = await f(SARVAM_TTS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-subscription-key": apiKey },
    body: JSON.stringify({
      text,
      target_language_code: "te-IN",
      model: "bulbul:v3",
      speaker,
      pace: 1.0,
      speech_sample_rate: 8000,
    }),
  });
  if (!res.ok) throw new Error(`sarvam tts ${res.status}`);
  const data = (await res.json()) as { audios?: string[] };
  const b64 = data.audios?.[0];
  if (!b64) throw new Error("sarvam tts: empty audio");
  const bytes = fromBase64(b64);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Sarvam saaras STT (Telugu, tolerates code-mixing). Returns the transcript. */
export async function sarvamStt(f: Fetch, apiKey: string, wav: ArrayBuffer): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([wav], { type: "audio/wav" }), "recording.wav");
  form.append("language_code", "te-IN");
  form.append("model", "saaras:v4");
  const res = await f(SARVAM_STT_URL, { method: "POST", headers: { "api-subscription-key": apiKey }, body: form });
  if (!res.ok) throw new Error(`sarvam stt ${res.status}`);
  const data = (await res.json()) as { transcript?: string };
  return (data.transcript ?? "").trim();
}

/** Deepgram nova-3 fallback: raw WAV body, Token auth. */
export async function deepgramStt(f: Fetch, apiKey: string, wav: ArrayBuffer): Promise<string> {
  const res = await f(`${DEEPGRAM_URL}?${DEEPGRAM_QUERY}`, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": "audio/wav" },
    body: wav,
  });
  if (!res.ok) throw new Error(`deepgram ${res.status}`);
  const data = (await res.json()) as {
    results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
  };
  return (data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "").trim();
}

/** Keys the STT chain needs; a structural slice of `TelephonyEnv` so this stays decoupled. */
export interface SttKeys {
  readonly SARVAM_API_KEY?: string;
  readonly DEEPGRAM_API_KEY?: string;
}

/**
 * The outcome of one transcription attempt across the engine chain.
 *
 * `ok: false` carries the last engine's failure text so the caller can record **why** nothing was
 * transcribed — "Sarvam 503, then no Deepgram key" is a fact worth keeping, and it is what makes the
 * keyword fallback honest rather than a silent default.
 */
export type TranscriptionOutcome =
  | { readonly ok: true; readonly transcript: string; readonly engine: SttEngine }
  | { readonly ok: false; readonly reason: string };

/**
 * Transcribe a recorded reply by trying each engine in `order` until one returns a non-empty
 * transcript. Never throws; a thrown engine is recorded and the next one is tried.
 *
 * The order is a parameter because the two call sites have different mandates: the outbound recording
 * path keeps ADR-005's Sarvam-first order, while the inbound answer path (task 3) puts Deepgram first.
 * Both fall through to the same System-1 classifier, so the order changes who transcribes, never what
 * the transcript means.
 */
export async function transcribe(
  f: Fetch,
  keys: SttKeys,
  wav: ArrayBuffer,
  order: readonly SttEngine[] = ["sarvam", "deepgram"],
): Promise<TranscriptionOutcome> {
  const reasons: string[] = [];
  for (const engine of order) {
    const key = engine === "sarvam" ? keys.SARVAM_API_KEY : keys.DEEPGRAM_API_KEY;
    if (!key) {
      reasons.push(`${engine}: no key`);
      continue;
    }
    try {
      const transcript = (engine === "sarvam" ? await sarvamStt(f, key, wav) : await deepgramStt(f, key, wav)).trim();
      if (transcript.length > 0) return { ok: true, transcript, engine };
      reasons.push(`${engine}: empty transcript`);
    } catch (error) {
      reasons.push(`${engine}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { ok: false, reason: reasons.join("; ") };
}
