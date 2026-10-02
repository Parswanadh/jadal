/**
 * Sarvam audio for the call script, cached, with an honest text fallback.
 *
 * One job: turn a Telugu sentence into WAV bytes via Sarvam `bulbul`, or say clearly that it could not.
 * The whole point of this module is that a caller never has to guess whether audio played: every
 * decision returns a {@link Spoken} whose `path` is `"sarvam"` only when real audio came back, and
 * `"say"` when Twilio must read the text itself. {@link recordSpeechPath} writes that decision through
 * the optional `onSpeechPath` dep (task 5).
 *
 * Caching is keyed by a hash of the **text**, not by contact, because the inbound phrases (greeting,
 * prompt, cue, confirmations) are the same sentences for every caller and only the interpolation
 * differs; the hash makes a personalised greeting a distinct cache entry without any bookkeeping.
 */

import { toHex } from "./signature";
import { sarvamTts } from "./speech";
import type { SpokenTwimlPart } from "./twiml";
import type { SpeechPathDetail, SpeechPhase, TelephonyDeps } from "./types";

/** The slice of `TelephonyDeps` audio synthesis needs. */
export type AudioDeps = Pick<TelephonyDeps, "env" | "fetch" | "cache" | "onSpeechPath">;

/** `telephony:phrase:<hash>` — a stable key for one exact sentence. */
export async function phraseCacheKey(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `telephony:phrase:${toHex(digest).slice(0, 24)}`;
}

/** What a synthesis attempt produced: audio bytes, or the reason there are none. */
export interface Synthesis {
  readonly audio: ArrayBuffer | null;
  readonly reason?: string;
}

/**
 * Sarvam TTS for `text`, from cache when warm. Never throws.
 *
 * Returns `{ audio: null, reason }` for empty text, a missing key, a non-200, an unparseable body or a
 * transport failure — the caller turns that into a `<Say>` fallback and records the reason.
 */
export async function phraseAudio(deps: AudioDeps, text: string): Promise<Synthesis> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { audio: null, reason: "empty text" };

  const key = await phraseCacheKey(trimmed);
  const hit = await deps.cache.get(key);
  if (hit) return { audio: hit };

  const apiKey = deps.env.SARVAM_API_KEY;
  if (!apiKey) return { audio: null, reason: "no SARVAM_API_KEY" };

  try {
    const audio = await sarvamTts(deps.fetch, apiKey, trimmed, deps.env.SARVAM_TTS_SPEAKER);
    await deps.cache.put(key, audio);
    return { audio };
  } catch (error) {
    return { audio: null, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Which TwiML verb a phase will use, and the bytes behind it when Sarvam produced them. */
export interface Spoken {
  readonly path: "sarvam" | "say";
  readonly audio?: ArrayBuffer;
  readonly reason?: string;
}

/**
 * Synthesise `text` and report the path TwiML should take.
 *
 * `path: "sarvam"` means the bytes exist and `<Play>` will serve them; `path: "say"` means Sarvam was
 * unavailable or failed and Twilio must read the text. This is the single decision point, so no route
 * can emit `<Play>` for audio that was never produced.
 */
export async function speak(deps: AudioDeps, text: string): Promise<Spoken> {
  const { audio, reason } = await phraseAudio(deps, text);
  if (audio !== null) return { path: "sarvam", audio };
  return reason === undefined ? { path: "say" } : { path: "say", reason };
}

/** Record which path ran. Swallows every failure: a log line must never break a farmer's call. */
export async function recordSpeechPath(deps: Pick<TelephonyDeps, "onSpeechPath">, detail: SpeechPathDetail): Promise<void> {
  try {
    await deps.onSpeechPath?.(detail);
  } catch {
    /* the call is more important than the record of it */
  }
}

/** Who/what a spoken part belongs to, copied onto the recorded path. */
export interface SpokenPartMeta {
  readonly caller?: string;
  readonly farmerId?: string;
  readonly contactId?: string;
}

/**
 * Synthesise one spoken part, record the path, and return the TwiML verb to use.
 *
 * The only place a `<Play>`/`<Say>` decision is made for a call, so no route can claim audio that was
 * not produced: `playUrl` is attached only when {@link speak} returned real bytes.
 */
export async function spokenPart(
  deps: AudioDeps,
  text: string,
  playUrl: string,
  phase: SpeechPhase,
  meta: SpokenPartMeta = {},
): Promise<SpokenTwimlPart> {
  const result = await speak(deps, text);
  await recordSpeechPath(deps, {
    phase,
    path: result.path,
    text,
    ...(result.reason === undefined ? {} : { reason: result.reason }),
    ...meta,
  });
  return result.path === "sarvam" ? { play: playUrl } : { say: text };
}
