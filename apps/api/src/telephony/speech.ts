import { fromBase64 } from "./signature";

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
