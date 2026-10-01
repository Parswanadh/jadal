/**
 * Tests for the voice layer (B6) and the Open-Meteo weather client.
 *
 * NO NETWORK. Every provider call goes through `test/harness.ts`'s `createEnv`, whose `fetch` throws
 * on any URL it has not been given a canned response for. That is deliberate: a test that *needs* a
 * route it did not mock fails loudly instead of quietly reaching the internet, and a test that
 * asserts `env.calls.length === 0` is a real proof that a code path made no call at all.
 *
 * The requests themselves are asserted byte-for-byte — URL, query string, headers, and for STT the
 * decoded multipart parts — because these are wire formats, not implementation details. A test that
 * only checked the parsed result would pass with the wrong `language_code` or the wrong `daily`
 * series, and those are exactly the mistakes that reach a judge as an incomprehensible Telugu call.
 */

import { describe, expect, it } from "vitest";
import { WeatherDay } from "@jadal/contracts";

import { createEnv, type FetchCall, type FetchRoutes, type TestEnv } from "../test/harness";
import type { ProviderEnv } from "./system1";
import { effectiveRain_mm as coreEffectiveRain_mm } from "./core-shim";
import {
  MULTIPART_BOUNDARY,
  STT_MODEL,
  TTS_MODEL,
  audioFilename,
  buildMultipartBody,
  buildTtsRequestBody,
  decodeBase64,
  fetchWithDeadline,
  isBase64,
  stt,
  tts,
  ttsEnabled,
} from "./voice/sarvam";
import {
  DAILY_SERIES,
  GUNTUR,
  MAX_FORECAST_DAYS,
  buildForecastUrl,
  clampForecastDays,
  effectiveRain_mm,
  getForecast,
  loadDemoWeather,
  rainTriggerMm,
} from "./voice/openmeteo";
import {
  CONTACT_PURPOSES,
  ackRecordedEn,
  ackRecordedTe,
  farmerGreeting,
  formatIstDate,
  formatIstTime,
  formatMillimetres,
  formatVolumeM3,
  isLikelyFemaleName,
  nightReleaseWarningEn,
  nightReleaseWarningTe,
  rainPostponedEn,
  rainPostponedTe,
  reminderEn,
  reminderTe,
  requestUpdateEn,
  requestUpdateTe,
  rosterChangeEn,
  rosterChangeTe,
  templateForPurpose,
  type MessageFacts,
} from "./voice/telugu";

/* ------------------------------------------------------------------ helpers */

/** A `TestEnv` that also satisfies `ProviderEnv`, so the Sarvam key can be set on it. */
function providerEnv(routes: FetchRoutes = {}): ProviderEnv & TestEnv {
  return Object.assign(createEnv(routes), { SARVAM_API_KEY: "sarvam-test-key" });
}

/**
 * The same, with no key at all.
 *
 * Separate from `providerEnv` on purpose: a default parameter would swallow an explicit `undefined`
 * and hand the test a working key, which would turn "no key means no network call" into a test that
 * proves nothing.
 */
function envWithoutKey(routes: FetchRoutes = {}): ProviderEnv & TestEnv {
  return Object.assign(createEnv(routes), { SARVAM_API_KEY: undefined });
}

/** `env.calls[0]` without the `T | undefined` that `noUncheckedIndexedAccess` forces on every index. */
function firstCall(env: TestEnv): FetchCall {
  const call = env.calls[0];
  if (call === undefined) throw new Error("expected the provider to have been called, but calls was empty");
  return call;
}

const utf8 = new TextEncoder();
const latin1 = new TextDecoder("latin1");

/** The exact bytes handed to `fetch`. Both STT and TTS send something other than a plain string. */
function bodyBytes(call: FetchCall): Uint8Array {
  if (call.body instanceof Uint8Array) return call.body;
  if (typeof call.body === "string") return utf8.encode(call.body);
  throw new Error(`unexpected body type: ${typeof call.body}`);
}

function bodyJson(call: FetchCall): unknown {
  if (typeof call.body !== "string") throw new Error("expected a JSON string body");
  return JSON.parse(call.body);
}

/** One decoded multipart part. */
interface ParsedPart {
  readonly headers: string;
  readonly bytes: Uint8Array;
}

/**
 * Minimal RFC 7578 reader.
 *
 * Every byte the test feeds in is ASCII, so a latin1 round-trip is lossless and splitting the body
 * on the delimiter is exact. This is deliberately independent of `buildMultipartBody`'s own output
 * logic beyond the shared boundary constant, so a bug in the encoder cannot hide itself here.
 *
 * The leading and trailing CRLF around each part are stripped because per RFC 7578 both belong to
 * the delimiter, not to the part. That is only safe here because the payload is ASCII and does not
 * end in CRLF; a binary body would need the delimiter's own offset to find the true end.
 */
function parseMultipart(bytes: Uint8Array, boundary: string): ParsedPart[] {
  const parts: ParsedPart[] = [];
  for (const segment of latin1.decode(bytes).split(`--${boundary}`)) {
    if (segment === "" || segment.startsWith("--")) continue;
    const chunk = segment.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const split = chunk.indexOf("\r\n\r\n");
    if (split < 0) continue;
    const body = chunk.slice(split + 4);
    parts.push({
      headers: chunk.slice(0, split),
      bytes: Uint8Array.from(body, (char) => char.charCodeAt(0) & 0xff),
    });
  }
  return parts;
}

function partNamed(parts: readonly ParsedPart[], name: string): ParsedPart {
  const found = parts.find((part) => part.headers.includes(`name="${name}"`));
  if (found === undefined) throw new Error(`multipart part ${name} missing; got ${parts.map((p) => p.headers).join(" | ")}`);
  return found;
}

/** `AbortError`, which is what a real runtime raises when `AbortSignal.timeout` fires. */
function abortError(): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

/**
 * A `fetch` that never settles and ignores the abort signal — the harder timeout case, which only
 * the explicit deadline race can rescue.
 */
function stubbornFetch(observed: FetchCall[]): ProviderEnv["fetch"] {
  return (input, init) => {
    observed.push({ url: input, method: init?.method ?? "GET", body: init?.body, headers: init?.headers ?? {} });
    return new Promise<Response>(() => undefined);
  };
}

/** A `fetch` that honours the abort signal and rejects with `AbortError` when it fires. */
function abortableFetch(observed: FetchCall[]): ProviderEnv["fetch"] {
  return (input, init) => {
    observed.push({ url: input, method: init?.method ?? "GET", body: init?.body, headers: init?.headers ?? {} });
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal === undefined) return;
      if (signal.aborted) {
        reject(abortError());
        return;
      }
      signal.addEventListener("abort", () => reject(abortError()));
    });
  };
}

/** A short ASCII stand-in for recorded Telugu speech. Real bytes, so base64 is exercised for real. */
const SPEECH_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, // "RIFF$....WAVE"
  0x66, 0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, // "fmt ..........."
  0x44, 0x61, 0x74, 0x61, 0x73, 0x69, 0x74, 0x65, 0x20, 0x6d, 0x6f, 0x63, // "Datasiste moc"
]);
const SPEECH_BASE64 = btoa(String.fromCharCode(...SPEECH_BYTES));

const TRANSCRIPT_TE = "నమస్కారం, నా నీటి వంతు ఎప్పుడు?";
/** Four bytes of "audio", which is valid padded base64 and decodes cleanly. */
const AUDIO_BASE64 = "YXVkaW8=";

/** The Open-Meteo shape from §7.3, extended to the seven days the client defaults to. */
const OM_RESPONSE = {
  latitude: 16.274164,
  longitude: 80.42735,
  timezone: "Asia/Kolkata",
  utc_offset_seconds: 19800,
  daily: {
    time: ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"],
    et0_fao_evapotranspiration: [4.99, 4.41, 4.49, 4.6, 4.2, 4.05, 3.9],
    precipitation_sum: [0.8, 1.1, 0.4, 0, 0, 16.2, 0],
    rain_sum: [0.8, 0.5, 0.4, 0, 0, 16.2, 0],
    precipitation_probability_max: [43, 75, 61, 10, 5, 88, 20],
    temperature_2m_max: [34.0, 32.7, 32.6, 33.1, 33.5, 31.2, 30.8],
    temperature_2m_min: [25.4, 25.7, 25.7, 25.9, 26.0, 24.8, 24.6],
  },
};

/** The exact query string §7.3 verifies, for `forecast_days=7`. */
const GUNTUR_QUERY_7 =
  "https://api.open-meteo.com/v1/forecast" +
  "?latitude=16.3067&longitude=80.4365" +
  "&daily=et0_fao_evapotranspiration,precipitation_sum,rain_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min" +
  "&timezone=Asia/Kolkata&forecast_days=7";

/* ------------------------------------------------------------------ the harness cannot reach the network */

describe("test-harness safety net", () => {
  it("throws on any unmocked provider URL, so no test can reach the network by accident", async () => {
    const env = createEnv({});
    await expect(env.fetch("https://api.open-meteo.com/v1/forecast")).rejects.toThrow(/Unmocked outbound fetch/);
    expect(env.fetch).not.toBe(globalThis.fetch);
  });
});

/* ------------------------------------------------------------------ Sarvam STT */

describe("sarvam stt", () => {
  it("posts multipart/form-data to §3.1's endpoint with the subscription-key header", async () => {
    const env = providerEnv({ "api.sarvam.ai": { transcripts: [{ text: TRANSCRIPT_TE }] } });

    const transcript = await stt(env, SPEECH_BASE64);

    expect(transcript).toBe(TRANSCRIPT_TE);
    expect(env.calls.length).toBe(1);

    const call = firstCall(env);
    expect(call.method).toBe("POST");
    expect(call.url).toContain("api.sarvam.ai/speech-to-text");
    expect(call.headers["api-subscription-key"]).toBe("sarvam-test-key");
    expect(call.headers["content-type"]).toBe(`multipart/form-data; boundary=${MULTIPART_BOUNDARY}`);
  });

  it("sends file, language_code=te-IN and model=saaras, and puts the audio bytes in the file part", async () => {
    const env = providerEnv({ "api.sarvam.ai": { transcripts: [{ text: TRANSCRIPT_TE }] } });
    await stt(env, SPEECH_BASE64, "audio/mpeg");

    const parts = parseMultipart(bodyBytes(firstCall(env)), MULTIPART_BOUNDARY);

    expect(parts.length).toBe(3);
    expect(latin1.decode(partNamed(parts, "language_code").bytes)).toBe("te-IN");
    expect(latin1.decode(partNamed(parts, "model").bytes)).toBe(STT_MODEL);
    expect(STT_MODEL).toBe("saaras");

    const file = partNamed(parts, "file");
    expect(file.headers).toContain('name="file"; filename="audio.mp3"');
    expect(file.headers).toContain("Content-Type: audio/mpeg");
    // The decoded audio, not a re-encoding of it.
    expect(Array.from(file.bytes)).toEqual(Array.from(SPEECH_BYTES));
  });

  it("derives the filename from the audio type, defaulting to WAV", async () => {
    expect(audioFilename("audio/wav")).toBe("audio.wav");
    expect(audioFilename("audio/webm;codecs=opus")).toBe("audio.webm");
    expect(audioFilename("application/octet-stream")).toBe("audio.wav");
  });

  it("reads a bare top-level text envelope as well as transcripts[0].text", async () => {
    const nested = providerEnv({ "api.sarvam.ai": { transcripts: [{ text: TRANSCRIPT_TE }] } });
    expect(await stt(nested, SPEECH_BASE64)).toBe(TRANSCRIPT_TE);

    const flat = providerEnv({ "api.sarvam.ai": { text: `  ${TRANSCRIPT_TE}  ` } });
    expect(await stt(flat, SPEECH_BASE64)).toBe(TRANSCRIPT_TE);
  });

  it("returns null and makes no call when there is no key, so the voice loop falls back to text", async () => {
    const routes: FetchRoutes = { "api.sarvam.ai": { transcripts: [{ text: TRANSCRIPT_TE }] } };

    const noKey = envWithoutKey(routes);
    const blankKey = Object.assign(createEnv(routes), { SARVAM_API_KEY: "   " });

    expect(await stt(noKey, SPEECH_BASE64)).toBeNull();
    expect(await stt(blankKey, SPEECH_BASE64)).toBeNull();
    expect(noKey.calls.length).toBe(0);
    expect(blankKey.calls.length).toBe(0);
  });

  it("returns null without a call for audio that is not base64", async () => {
    const env = providerEnv({ "api.sarvam.ai": { transcripts: [{ text: TRANSCRIPT_TE }] } });

    expect(await stt(env, "not base64 !!")).toBeNull();
    expect(await stt(env, "")).toBeNull();
    expect(env.calls.length).toBe(0);
  });

  it("returns null on an HTTP error, a non-JSON body, and an envelope with no transcript", async () => {
    const serverError = providerEnv({ "api.sarvam.ai": new Response("upstream 502", { status: 502 }) });
    expect(await stt(serverError, SPEECH_BASE64)).toBeNull();

    const notJson = providerEnv({ "api.sarvam.ai": new Response("<html>error</html>", { status: 200 }) });
    expect(await stt(notJson, SPEECH_BASE64)).toBeNull();

    const noTranscript = providerEnv({ "api.sarvam.ai": { transcripts: [{ confidence: 0.1 }] } });
    expect(await stt(noTranscript, SPEECH_BASE64)).toBeNull();
  });

  it("returns null when the transport itself throws", async () => {
    const env = createEnv({}); // nothing mocked → the harness throws
    expect(await stt(Object.assign(env, { SARVAM_API_KEY: "k" }), SPEECH_BASE64)).toBeNull();
    expect(env.calls.length).toBe(1);
  });
});

/* ------------------------------------------------------------------ Sarvam TTS */

describe("sarvam tts", () => {
  it("posts §3.1's JSON body and returns audios[0]", async () => {
    const text = "నమస్కారం వెంకటేశ్వర్లు గారు. మీ నీటి వంతు ఈ రాత్రి 10:30 కు ప్రారంభమవుతుంది.";
    const env = providerEnv({ "api.sarvam.ai": { audios: [AUDIO_BASE64] } });

    const audio = await tts(env, text);

    expect(audio).toBe(AUDIO_BASE64);
    expect(env.calls.length).toBe(1);

    const call = firstCall(env);
    expect(call.method).toBe("POST");
    expect(call.url).toContain("api.sarvam.ai/text-to-speech");
    expect(call.headers["api-subscription-key"]).toBe("sarvam-test-key");
    expect(call.headers["content-type"]).toBe("application/json");
    expect(bodyJson(call)).toEqual({
      text,
      language_code: "te-IN",
      model: "bulbul",
      speaker: "meera",
      pace: 1.0,
      speech_sample_rate: 8000,
    });
    expect(TTS_MODEL).toBe("bulbul");
  });

  it("honours speaker, pace and sample-rate overrides", async () => {
    const env = providerEnv({ "api.sarvam.ai": { audios: [AUDIO_BASE64] } });

    await tts(env, "ధన్యవాదాలు.", { speaker: "shubh", pace: 0.9, speechSampleRate: 16000 });

    expect(bodyJson(firstCall(env))).toEqual({
      text: "ధన్యవాదాలు.",
      language_code: "te-IN",
      model: "bulbul",
      speaker: "shubh",
      pace: 0.9,
      speech_sample_rate: 16000,
    });
    expect(buildTtsRequestBody("x").speaker).toBe("meera");
  });

  it("prefixes both endpoints through AI Gateway when one is configured", async () => {
    const routes: FetchRoutes = { "api.sarvam.ai": { audios: [AUDIO_BASE64], transcripts: [{ text: TRANSCRIPT_TE }] } };

    const sttEnv = Object.assign(providerEnv(routes), { AI_GATEWAY_URL: "https://gw.test/v1/acct/jadal/" });
    await stt(sttEnv, SPEECH_BASE64);
    expect(firstCall(sttEnv).url).toBe(
      "https://gw.test/v1/acct/jadal/https://api.sarvam.ai/speech-to-text",
    );

    const ttsEnv = Object.assign(providerEnv(routes), { AI_GATEWAY_URL: "https://gw.test/v1/acct/jadal" });
    await tts(ttsEnv, "నమస్కారం.");
    expect(firstCall(ttsEnv).url).toBe("https://gw.test/v1/acct/jadal/https://api.sarvam.ai/text-to-speech");
  });

  it("returns null and makes no call when there is no key", async () => {
    const routes: FetchRoutes = { "api.sarvam.ai": { audios: [AUDIO_BASE64] } };

    const noKey = envWithoutKey(routes);
    const blankKey = Object.assign(createEnv(routes), { SARVAM_API_KEY: "  " });

    expect(await tts(noKey, "నమస్కారం.")).toBeNull();
    expect(await tts(blankKey, "నమస్కారం.")).toBeNull();
    expect(noKey.calls.length).toBe(0);
    expect(blankKey.calls.length).toBe(0);
    expect(ttsEnabled(noKey)).toBe(false);
    expect(ttsEnabled(blankKey)).toBe(false);
    expect(ttsEnabled(providerEnv(routes))).toBe(true);
  });

  it("returns null for text that is blank after trimming, without a call", async () => {
    const env = providerEnv({ "api.sarvam.ai": { audios: [AUDIO_BASE64] } });
    expect(await tts(env, "   ")).toBeNull();
    expect(env.calls.length).toBe(0);
  });

  it("returns null when audios[0] is not genuinely base64", async () => {
    const htmlError = providerEnv({ "api.sarvam.ai": { audios: ["<html>Bad Gateway</html>"] } });
    expect(await tts(htmlError, "నమస్కారం.")).toBeNull();

    const dataUri = providerEnv({ "api.sarvam.ai": { audios: ["data:audio/mp3;base64,YXVkaW8="] } });
    expect(await tts(dataUri, "నమస్కారం.")).toBeNull();

    const wrongLength = providerEnv({ "api.sarvam.ai": { audios: ["YXVkaW"] } });
    expect(await tts(wrongLength, "నమస్కారం.")).toBeNull();

    const emptyAudio = providerEnv({ "api.sarvam.ai": { audios: [""] } });
    expect(await tts(emptyAudio, "నమస్కారం.")).toBeNull();

    const notAString = providerEnv({ "api.sarvam.ai": { audios: [1234] } });
    expect(await tts(notAString, "నమస్కారం.")).toBeNull();

    const emptyArray = providerEnv({ "api.sarvam.ai": { audios: [] } });
    expect(await tts(emptyArray, "నమస్కారం.")).toBeNull();

    const noAudios = providerEnv({ "api.sarvam.ai": { error: "quota exceeded" } });
    expect(await tts(noAudios, "నమస్కారం.")).toBeNull();
  });

  it("returns null on HTTP 500", async () => {
    const env = providerEnv({ "api.sarvam.ai": new Response("server error", { status: 500 }) });

    expect(await tts(env, "నమస్కారం.")).toBeNull();
    expect(firstCall(env).url).toContain("api.sarvam.ai/text-to-speech");
  });

  it("returns null when the deadline expires, whether or not the transport honours the signal", async () => {
    const observed: FetchCall[] = [];
    const stubborn = { SARVAM_API_KEY: "k", fetch: stubbornFetch(observed) };
    const abortable = { SARVAM_API_KEY: "k", fetch: abortableFetch(observed) };

    expect(await tts(stubborn, "నమస్కారం.", { timeoutMs: 20 })).toBeNull();
    expect(await tts(abortable, "నమస్కారం.", { timeoutMs: 20 })).toBeNull();
    // Both attempts were actually made; neither hung the caller.
    expect(observed.length).toBe(2);
  });

  it("returns null rather than propagating a transport throw", async () => {
    const env = createEnv({}); // nothing mocked → the harness throws
    expect(await tts(Object.assign(env, { SARVAM_API_KEY: "k" }), "నమస్కారం.")).toBeNull();
  });
});

/* ------------------------------------------------------------------ Sarvam primitives */

describe("sarvam primitives", () => {
  it("accepts only canonical base64 and decodes it", () => {
    expect(isBase64(AUDIO_BASE64)).toBe(true);
    expect(isBase64(SPEECH_BASE64)).toBe(true);
    expect(isBase64("")).toBe(false);
    expect(isBase64("YXVkaW8")).toBe(false); // length not a multiple of 4
    expect(isBase64("YXVk aW8=")).toBe(false); // embedded space
    expect(isBase64("****")).toBe(false);

    const decoded = decodeBase64(SPEECH_BASE64);
    expect(decoded).not.toBeNull();
    expect(Array.from(decoded ?? [])).toEqual(Array.from(SPEECH_BYTES));
    expect(decodeBase64("not base64 !!")).toBeNull();
  });

  it("encodes multipart bodies with CRLF delimiters and a matching content-type", () => {
    const { body, contentType } = buildMultipartBody([{ name: "model", value: "saaras" }], [], "BOUND");
    expect(contentType).toBe("multipart/form-data; boundary=BOUND");
    expect(latin1.decode(body)).toBe(
      "--BOUND\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nsaaras\r\n--BOUND--\r\n",
    );
  });

  it("returns null from the shared deadline transport instead of throwing", async () => {
    const env = createEnv({}); // every URL throws
    const response = await fetchWithDeadline(env, {
      url: "https://api.sarvam.ai/text-to-speech",
      method: "GET",
      headers: {},
      timeoutMs: 500,
    });
    expect(response).toBeNull();
  });
});

/* ------------------------------------------------------------------ Open-Meteo */

describe("open-meteo getForecast", () => {
  it("requests §7.2's daily series in §7.3's order, with timezone=Asia/Kolkata", async () => {
    const env = createEnv({ "api.open-meteo.com": OM_RESPONSE });

    const days = await getForecast(env, GUNTUR.lat, GUNTUR.lon);

    expect(firstCall(env).url).toBe(GUNTUR_QUERY_7);
    expect(firstCall(env).method).toBe("GET");
    expect(buildForecastUrl(16.3067, 80.4365, 7)).toBe(GUNTUR_QUERY_7);
    expect(DAILY_SERIES).toEqual([
      "et0_fao_evapotranspiration",
      "precipitation_sum",
      "rain_sum",
      "precipitation_probability_max",
      "temperature_2m_max",
      "temperature_2m_min",
    ]);
    expect(days.length).toBe(7);
  });

  it("maps every day onto a WeatherDay the contract accepts", async () => {
    const env = createEnv({ "api.open-meteo.com": OM_RESPONSE });

    const days = await getForecast(env, GUNTUR.lat, GUNTUR.lon);

    for (const day of days) {
      expect(WeatherDay.safeParse(day).success).toBe(true);
    }
    // §8.2 maps rain_mm from precipitation_sum, and carries the temperature extremes across.
    expect(days[0]).toEqual({ date: "2026-10-01", et0_mm: 4.99, rain_mm: 0.8, tmax_c: 34, tmin_c: 25.4 });
    expect(days[5]).toEqual({ date: "2026-10-06", et0_mm: 4.05, rain_mm: 16.2, tmax_c: 31.2, tmin_c: 24.8 });
  });

  it("clamps days to 1..16, matching toolSpecs.weather_forecast", async () => {
    expect(MAX_FORECAST_DAYS).toBe(16);
    expect(clampForecastDays(40)).toBe(16);
    expect(clampForecastDays(16)).toBe(16);
    expect(clampForecastDays(3)).toBe(3);
    expect(clampForecastDays(0)).toBe(1);
    expect(clampForecastDays(-7)).toBe(1);
    expect(clampForecastDays(Number.NaN)).toBe(7);
    expect(clampForecastDays(4.6)).toBe(5);

    const env = createEnv({ "api.open-meteo.com": OM_RESPONSE });
    await getForecast(env, GUNTUR.lat, GUNTUR.lon, 40);
    expect(firstCall(env).url).toContain("forecast_days=16");

    await getForecast(env, GUNTUR.lat, GUNTUR.lon, 0);
    expect(env.calls[1]?.url).toContain("forecast_days=1");
  });

  it("treats a null aggregate as 0 mm rather than rejecting the day", async () => {
    const withNulls = {
      daily: {
        time: ["2026-10-01", "2026-10-02"],
        et0_fao_evapotranspiration: [4.5, null],
        precipitation_sum: [0, null],
        rain_sum: [0, null],
        precipitation_probability_max: [10, null],
        temperature_2m_max: [33, null],
        temperature_2m_min: [25, null],
      },
    };
    const env = createEnv({ "api.open-meteo.com": withNulls });

    const days = await getForecast(env, GUNTUR.lat, GUNTUR.lon, 2);

    expect(days).toHaveLength(2);
    expect(days[1]).toEqual({ date: "2026-10-02", et0_mm: 0, rain_mm: 0 });
    expect(WeatherDay.safeParse(days[1]).success).toBe(true);
  });

  it("falls back to the bundled snapshot when the network is unreachable", async () => {
    const env = createEnv({}); // the harness throws on the unmocked host
    const days = await getForecast(env, GUNTUR.lat, GUNTUR.lon);

    expect(env.calls.length).toBe(1);
    expect(days).toEqual(loadDemoWeather());
  });

  it("falls back on HTTP 500, non-JSON, a missing daily block and an unusable date", async () => {
    const snapshot = loadDemoWeather();

    const serverError = createEnv({ "api.open-meteo.com": new Response("gateway down", { status: 500 }) });
    expect(await getForecast(serverError, GUNTUR.lat, GUNTUR.lon)).toEqual(snapshot);

    const notJson = createEnv({ "api.open-meteo.com": new Response("<html>", { status: 200 }) });
    expect(await getForecast(notJson, GUNTUR.lat, GUNTUR.lon)).toEqual(snapshot);

    const noDaily = createEnv({ "api.open-meteo.com": { latitude: 16.2, daily_units: {} } });
    expect(await getForecast(noDaily, GUNTUR.lat, GUNTUR.lon)).toEqual(snapshot);

    const emptyDaily = createEnv({ "api.open-meteo.com": { daily: { time: [] } } });
    expect(await getForecast(emptyDaily, GUNTUR.lat, GUNTUR.lon)).toEqual(snapshot);

    const badDate = createEnv({
      "api.open-meteo.com": { daily: { time: ["01/10/2026"], et0_fao_evapotranspiration: [4], precipitation_sum: [0] } },
    });
    expect(await getForecast(badDate, GUNTUR.lat, GUNTUR.lon)).toEqual(snapshot);
  });

  it("falls back for coordinates off the globe, without a call", async () => {
    const env = createEnv({ "api.open-meteo.com": OM_RESPONSE });

    expect(await getForecast(env, Number.NaN, 80.4)).toEqual(loadDemoWeather());
    expect(await getForecast(env, 16.3, 200)).toEqual(loadDemoWeather());
    expect(env.calls.length).toBe(0);
  });
});

describe("open-meteo offline snapshot and constants", () => {
  it("loads every day of the bundled fixture, contract-valid and in date order", () => {
    const days = loadDemoWeather();

    expect(days.length).toBe(21);
    expect(days[0]?.date).toBe("2026-09-01");
    expect(days[20]?.date).toBe("2026-09-21");
    for (const day of days) {
      expect(WeatherDay.safeParse(day).success).toBe(true);
    }
    const dates = days.map((day) => day.date);
    expect([...dates].sort()).toEqual(dates);
    // The fixture's wet days, so a silent regression in the fallback is visible.
    expect(days.find((day) => day.date === "2026-09-09")?.rain_mm).toBe(25);
  });

  it("re-exports the crop engine's effective-rain formula instead of repeating it", () => {
    expect(effectiveRain_mm).toBe(coreEffectiveRain_mm);
  });

  it("publishes §7.4's rain re-plan threshold", () => {
    expect(rainTriggerMm).toBe(15);
  });
});

/* ------------------------------------------------------------------ effective rain (§7.4) */

describe("effectiveRain_mm — USDA-SCS, §7.4 item 2", () => {
  it("matches the §7.4 piecewise curve at and around both break points", () => {
    expect(effectiveRain_mm(0)).toBe(0);
    expect(effectiveRain_mm(5)).toBe(0); // <= 5 mm intercepts and evaporates
    expect(effectiveRain_mm(6)).toBeCloseTo(0.75, 10); // (6 - 5) * 0.75
    expect(effectiveRain_mm(50)).toBeCloseTo(33.75, 10); // (50 - 5) * 0.75, upper end of the ramp
    expect(effectiveRain_mm(51)).toBeCloseTo(35.7, 10); // 0.70 * 51
  });

  it("is monotonic and clamps nonsense to zero effective rain", () => {
    expect(effectiveRain_mm(10)).toBeGreaterThan(effectiveRain_mm(6));
    expect(effectiveRain_mm(60)).toBeGreaterThan(effectiveRain_mm(50));
    expect(effectiveRain_mm(-5)).toBe(0);
    expect(effectiveRain_mm(Number.NaN)).toBe(0);
  });
});

/* ------------------------------------------------------------------ Telugu templates */

const FACTS: MessageFacts = {
  farmerName: "వెంకటేశ్వర్లు",
  windowStart: "2026-09-15T05:00:00Z", // 10:30 IST
  windowEnd: "2026-09-14T19:30:00Z", // 01:00 IST the next morning
  outletName: "Outlet 4B (Tail End)",
  chainageM: 12480,
  allocatedM3: 180,
  rainMm: 16.2,
  leadHours: 24,
  requestStatus: "approved",
  requestVolumeM3: 180,
};

/** Telugu script is U+0C00–U+0C7F. A `length > 0` check would pass on English; this cannot. */
const TELUGU = /[\u0C00-\u0C7F]/u;

/** Every builder, paired, with the facts it needs. */
const BUILDERS: ReadonlyArray<readonly [string, (f: MessageFacts) => string, (f: MessageFacts) => string]> = [
  ["rosterChange", rosterChangeTe, rosterChangeEn],
  ["nightReleaseWarning", nightReleaseWarningTe, nightReleaseWarningEn],
  ["rainPostponed", rainPostponedTe, rainPostponedEn],
  ["requestUpdate", requestUpdateTe, requestUpdateEn],
  ["reminder", reminderTe, reminderEn],
  ["ackRecorded", ackRecordedTe, ackRecordedEn],
];

describe("telugu templates", () => {
  it.each(BUILDERS)("%s renders the outlet, the IST window and the allocated volume in both languages", (_name, te, en) => {
    for (const render of [te, en]) {
      const message = render(FACTS);
      expect(message.length).toBeGreaterThan(0);
      expect(message).toContain("Outlet 4B (Tail End)");
      expect(message).toContain("12480");
      expect(message).toContain("10:30");
      expect(message).toContain("180");
      expect(message).not.toContain("undefined");
      expect(message).not.toMatch(/\s{2,}/);
    }
  });

  it.each(BUILDERS)("%s's Telugu is Telugu script, not transliteration", (_name, te) => {
    const message = te(FACTS);
    expect(TELUGU.test(message)).toBe(true);
    // A romanised "namaskaram" alongside the script would mean someone fell back to transliteration.
    expect(message).not.toMatch(/namaskaram/i);
  });

  it("renders a message even when every optional fact is missing", () => {
    for (const [, te, en] of BUILDERS) {
      expect(te({}).length).toBeGreaterThan(0);
      expect(en({}).length).toBeGreaterThan(0);
      expect(te({})).not.toContain("undefined");
      expect(en({})).not.toContain("undefined");
    }
  });

  it("carries the rain forecast and the preserved quota in the postponement message", () => {
    expect(rainPostponedTe(FACTS)).toContain("16.2");
    expect(rainPostponedTe(FACTS)).toContain("కోటా సురక్షితంగా ఉంది");
    expect(rainPostponedEn(FACTS)).toContain("16.2 mm");
    expect(rainPostponedEn(FACTS)).toContain("Your quota is safe");
  });
});

describe("telugu IST formatting", () => {
  it("renders 10:30 for 2026-09-15T05:00:00Z", () => {
    expect(formatIstTime("2026-09-15T05:00:00Z")).toBe("10:30");
  });

  it("adds the fixed +05:30 offset, including across the date line", () => {
    expect(formatIstTime("2026-09-14T19:30:00Z")).toBe("01:00"); // next day in IST
    expect(formatIstTime("2026-09-15T18:30:00Z")).toBe("00:00"); // midnight, zero-padded
    expect(formatIstTime("2026-09-15T00:00:00Z")).toBe("05:30");
    // India has no DST, so the offset never moves.
    expect(formatIstTime("2026-01-15T05:00:00Z")).toBe("10:30");
    expect(formatIstTime("2026-07-15T05:00:00Z")).toBe("10:30");
  });

  it("renders the §6 WhatsApp date format DD-MM-YYYY", () => {
    expect(formatIstDate("2026-10-02T00:00:00Z")).toBe("02-10-2026");
    expect(formatIstDate("2026-09-14T19:30:00Z")).toBe("15-09-2026");
  });

  it("returns an empty string rather than Invalid Date for unusable input", () => {
    expect(formatIstTime(undefined)).toBe("");
    expect(formatIstTime("not-a-date")).toBe("");
    expect(formatIstDate(undefined)).toBe("");
    expect(formatIstDate("2026-13-45")).toBe("");
  });

  it("formats a volume for speech without a spurious decimal place", () => {
    expect(formatVolumeM3(180)).toBe("180");
    expect(formatVolumeM3(12.5)).toBe("12.5");
    expect(formatVolumeM3(12.34)).toBe("12.3");
    expect(formatVolumeM3(0)).toBe("0");
    expect(formatVolumeM3(undefined)).toBe("");
    expect(formatVolumeM3(Number.NaN)).toBe("");
  });

  it("formats a millimetre depth the same way, so rainfall reads like a roster volume", () => {
    expect(formatMillimetres(16.2)).toBe("16.2");
    expect(formatMillimetres(16.24)).toBe("16.2");
    expect(formatMillimetres(15)).toBe("15");
    expect(formatMillimetres(undefined)).toBe("");
  });
});

describe("telugu greeting and the gender heuristic", () => {
  it("addresses a farmer with the gender-neutral honorific by default", () => {
    const greeting = farmerGreeting("రమణ");
    expect(greeting).toContain("రమణ గారు");
    expect(TELUGU.test(greeting)).toBe(true);
    expect(greeting).toContain("జడల్ కాలువ");
  });

  it("uses the feminine honorific for a confidently feminine name ending", () => {
    expect(farmerGreeting("సీతమ్మ")).toContain("సీతమ్మ గుడి");
    expect(farmerGreeting("కాంతమ్మ")).toContain("కాంతమ్మ గుడి");
  });

  it("does not append an honorific twice when the stored name already carries one", () => {
    expect(farmerGreeting("రమణ గారు")).toContain("రమణ గారు");
    expect(farmerGreeting("రమణ గారు")).not.toContain("గారు గారు");
    expect(farmerGreeting("రమణ")).toContain("రమణ గారు");
  });

  it("falls back to a bare greeting when no usable name is held", () => {
    expect(farmerGreeting("")).not.toContain("గారు");
    expect(farmerGreeting("   ").length).toBeGreaterThan(0);
    expect(farmerGreeting(undefined, "en")).toContain("Jadal");
    expect(farmerGreeting("రమణ", "en")).toContain("Hello రమణ");
  });

  it("documents its own limits: the suffix list is conservative and never claims a surname", () => {
    expect(isLikelyFemaleName("సీతమ్మ")).toBe(true);
    expect(isLikelyFemaleName("లక్ష్మీదేవి")).toBe(true);
    expect(isLikelyFemaleName("రమణ")).toBe(false);
    expect(isLikelyFemaleName("వెంకటేశ్వర్లు")).toBe(false);
    expect(isLikelyFemaleName("రెడ్డి")).toBe(false); // a surname carries no gender signal
    // A false negative is the documented safe failure: లక్ష్మీ still gets a valid, respectful line.
    expect(isLikelyFemaleName("లక్ష్మీ")).toBe(false);
    expect(farmerGreeting("లక్ష్మీ")).toContain("లక్ష్మీ గారు");
  });
});

describe("templateForPurpose", () => {
  it("covers every Contact.purpose in the contract, in both languages", () => {
    expect([...CONTACT_PURPOSES].sort()).toEqual(["release_warning", "reminder", "request_update", "roster_change"]);

    for (const purpose of CONTACT_PURPOSES) {
      const pair = templateForPurpose(purpose, FACTS);
      expect(pair.te.length).toBeGreaterThan(0);
      expect(pair.en.length).toBeGreaterThan(0);
      expect(TELUGU.test(pair.te)).toBe(true);
      expect(pair.te).toContain("Outlet 4B (Tail End)");
      expect(pair.en).toContain("Outlet 4B (Tail End)");
    }
  });

  it("maps release_warning to the night-release wording", () => {
    const pair = templateForPurpose("release_warning", FACTS);
    expect(pair.te).toBe(nightReleaseWarningTe(FACTS));
    expect(pair.en).toBe(nightReleaseWarningEn(FACTS));
  });
});