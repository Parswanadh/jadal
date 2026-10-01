// @ts-ignore vitest is provided by the workspace test runner; apps/api does not declare it yet.
import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Contact, System1Result } from "@jadal/contracts";
import { createTelephonyRoutes, placeCall } from "./index";
import { computeTwilioSignature } from "./signature";
import { escapeXml } from "./twiml";
import type { RaiseRequestInput, TelephonyDeps, TelephonyEnv } from "./types";

const BASE = "https://jadal.example.dev";
const TOKEN = "tok_secret";
const SID = "ACtest123";

const env: TelephonyEnv = {
  TWILIO_ACCOUNT_SID: SID,
  TWILIO_AUTH_TOKEN: TOKEN,
  TWILIO_FROM_NUMBER: "+15005550006",
  PUBLIC_BASE_URL: BASE,
  SARVAM_API_KEY: "sarvam-key",
};

const contact: Contact = {
  id: "c1",
  farmer_id: "f-7",
  channel: "voice",
  purpose: "roster_change",
  status: "sent",
  attempt: 1,
  message_te: "నమస్కారం",
  message_en: "Hello",
  at: "2026-01-01T00:00:00.000Z",
};

const WAV = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]); // "RIFF" + bytes
const WAV_B64 = btoa(String.fromCharCode(...WAV));

interface Call {
  url: string;
  init?: RequestInit;
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function memoryCache() {
  const m = new Map<string, ArrayBuffer>();
  return {
    m,
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: ArrayBuffer) => void m.set(k, v),
  };
}

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** Mounted exactly as Task B does: app.route("/api/telephony", createTelephonyRoutes(deps)). */
const mount = (deps: TelephonyDeps) => new Hono().route("/api/telephony", createTelephonyRoutes(deps));

function setup(opts: { env?: Partial<TelephonyEnv>; handler?: Handler; contact?: Contact | null; classify?: System1Result } = {}) {
  const calls: Call[] = [];
  const acks: [string, boolean, string][] = [];
  const statuses: [string, string, unknown][] = [];
  const raised: RaiseRequestInput[] = [];
  const transcripts: [string, string, string][] = [];
  const classified: string[] = [];
  const cache = memoryCache();
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    if (opts.handler) return opts.handler(url, init);
    if (url.startsWith("https://api.sarvam.ai/text-to-speech")) return jsonRes({ audios: [WAV_B64] });
    if (url.startsWith("https://api.sarvam.ai/speech-to-text")) return jsonRes({ transcript: "నాకు అత్యవసరంగా నీళ్లు కావాలి" });
    if (url.includes(".twilio.com/") && url.endsWith(".wav")) return new Response(WAV, { status: 200 });
    if (url.startsWith("https://api.deepgram.com/")) {
      return jsonRes({ results: { channels: [{ alternatives: [{ transcript: "I need water urgently" }] }] } });
    }
    return new Response("unexpected " + url, { status: 500 });
  }) as typeof fetch;

  const mergedEnv: TelephonyEnv = { ...env, ...opts.env };
  const deps: TelephonyDeps = {
    env: mergedEnv,
    fetch: fakeFetch,
    cache,
    getContact: async () => (opts.contact === undefined ? contact : opts.contact),
    getMessage: async () => "నమస్కారం, మీ నీటి వంతు రేపు ఉదయం",
    recordAck: async (id, a, via) => void acks.push([id, a, via]),
    updateContactStatus: async (id, s, d) => void statuses.push([id, s, d]),
    classify: async (t) => {
      classified.push(t);
      return (
        opts.classify ?? {
          intent: "urgent_request",
          intent_confidence: 0.9,
          urgency: 0.9,
          mentions_crop_stress: true,
          source: "rules",
        }
      );
    },
    raiseRequest: async (r) => void raised.push(r),
    onTranscript: async (id, t, e) => void transcripts.push([id, t, e]),
    sleep: async () => {},
  };
  return { app: mount(deps), deps, calls, acks, statuses, raised, transcripts, classified, cache };
}

/** Build a request signed the way Twilio signs it. */
async function signed(path: string, params: Record<string, string> = {}, method: "POST" | "GET" = "POST", token = TOKEN) {
  const entries = Object.entries(params);
  const sig = await computeTwilioSignature(token, BASE + path, method === "POST" ? entries : []);
  const init: RequestInit = { method, headers: { "X-Twilio-Signature": sig } };
  if (method === "POST") {
    init.body = new URLSearchParams(params).toString();
    (init.headers as Record<string, string>)["Content-Type"] = "application/x-www-form-urlencoded";
  }
  return new Request(BASE + path, init);
}

describe("twiml", () => {
  it("returns Play + Gather + Redirect in order, with escaped URLs", async () => {
    const { app } = setup();
    const res = await app.fetch(await signed("/api/telephony/twiml/c1", {}, "GET"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/xml");
    const body = await res.text();
    expect(body).toContain(`<Play>${BASE}/api/telephony/audio/c1</Play>`);
    expect(body).toContain(
      `<Gather input="dtmf" numDigits="1" timeout="8" action="${BASE}/api/telephony/gather/c1" method="POST">`,
    );
    expect(body).toContain(`<Play>${BASE}/api/telephony/audio/c1/prompt</Play></Gather>`);
    expect(body).toContain(`<Redirect method="POST">${BASE}/api/telephony/twiml/c1?replay=1</Redirect>`);
    expect(body.indexOf("<Play>")).toBeLessThan(body.indexOf("<Gather"));
    expect(body.indexOf("</Gather>")).toBeLessThan(body.indexOf("<Redirect"));
  });

  it("replay pass hangs up instead of redirecting again, and escapes & in URLs", async () => {
    const { app } = setup();
    const body = await (await app.fetch(await signed("/api/telephony/twiml/c1?replay=1", {}, "GET"))).text();
    expect(body).not.toContain("<Redirect");
    expect(body).toContain("<Hangup/>");
    expect(body).toContain(`action="${BASE}/api/telephony/gather/c1?replay=1"`);
    expect(escapeXml(`a&b<c>"d'`)).toBe("a&amp;b&lt;c&gt;&quot;d&apos;");
  });

  it("accepts POST as well, and 404s unknown contacts", async () => {
    const ok = setup();
    expect((await ok.app.fetch(await signed("/api/telephony/twiml/c1", { CallSid: "CA1" }))).status).toBe(200);
    const missing = setup({ contact: null });
    expect((await missing.app.fetch(await signed("/api/telephony/twiml/zzz", {}, "GET"))).status).toBe(404);
  });

  it("falls back to <Say> without a Sarvam key", async () => {
    const { app } = setup({ env: { SARVAM_API_KEY: undefined } });
    const body = await (await app.fetch(await signed("/api/telephony/twiml/c1", {}, "GET"))).text();
    expect(body).toContain('<Say language="te-IN">నమస్కారం, మీ నీటి వంతు రేపు ఉదయం</Say>');
    expect(body).not.toContain("<Play>");
  });
});

describe("audio", () => {
  it("synthesises once via Sarvam and serves cached audio afterwards", async () => {
    const { app, calls, cache } = setup();
    const r1 = await app.fetch(new Request(`${BASE}/api/telephony/audio/c1`));
    expect(r1.status).toBe(200);
    expect(r1.headers.get("content-type")).toBe("audio/wav");
    expect([...new Uint8Array(await r1.arrayBuffer())]).toEqual([...WAV]);
    const r2 = await app.fetch(new Request(`${BASE}/api/telephony/audio/c1`));
    expect(r2.status).toBe(200);
    expect(calls.filter((c) => c.url.includes("text-to-speech"))).toHaveLength(1);
    expect(cache.m.size).toBe(1);

    const tts = calls.find((c) => c.url.includes("text-to-speech"))!;
    const headers = tts.init?.headers as Record<string, string>;
    expect(headers["api-subscription-key"]).toBe("sarvam-key");
    const payload = JSON.parse(tts.init?.body as string);
    expect(payload).toMatchObject({ target_language_code: "te-IN", model: "bulbul:v3" });
    expect(payload.text).toContain("నమస్కారం");
  });

  it("serves the prompt audio cached, 503 without key, 502 on TTS failure", async () => {
    const a = setup();
    await a.app.fetch(new Request(`${BASE}/api/telephony/audio/c1/prompt`));
    const r = await a.app.fetch(new Request(`${BASE}/api/telephony/audio/c1/prompt`));
    expect(r.headers.get("content-type")).toBe("audio/wav");
    expect(a.calls.filter((c) => c.url.includes("text-to-speech"))).toHaveLength(1);
    expect(JSON.parse(a.calls[0]!.init?.body as string).text).toContain("నొక్కండి");

    const noKey = setup({ env: { SARVAM_API_KEY: undefined } });
    expect((await noKey.app.fetch(new Request(`${BASE}/api/telephony/audio/c1`))).status).toBe(503);

    const bad = setup({ handler: () => new Response("boom", { status: 500 }) });
    expect((await bad.app.fetch(new Request(`${BASE}/api/telephony/audio/c1`))).status).toBe(502);
  });
});

describe("signature enforcement", () => {
  it("403s on missing, wrong and tampered signatures for every webhook", async () => {
    const paths = ["/api/telephony/twiml/c1", "/api/telephony/gather/c1", "/api/telephony/recording/c1", "/api/telephony/status/c1"];
    for (const p of paths) {
      const { app, acks } = setup();
      const none = await app.fetch(new Request(BASE + p, { method: "POST", body: "Digits=1" }));
      expect(none.status).toBe(403);
      const wrongKey = await app.fetch(await signed(p, { Digits: "1" }, "POST", "other-token"));
      expect(wrongKey.status).toBe(403);
      // Valid signature for Digits=2, body swapped to Digits=1.
      const good = await signed(p, { Digits: "2" });
      const forged = new Request(BASE + p, {
        method: "POST",
        headers: { "X-Twilio-Signature": good.headers.get("X-Twilio-Signature")!, "Content-Type": "application/x-www-form-urlencoded" },
        body: "Digits=1",
      });
      expect((await app.fetch(forged)).status).toBe(403);
      expect(acks).toHaveLength(0);
    }
  });

  it("validates against PUBLIC_BASE_URL even when the request arrives on another host", async () => {
    const { app } = setup();
    const req = await signed("/api/telephony/gather/c1", { Digits: "1" });
    const viaProxy = new Request("http://localhost:8787/api/telephony/gather/c1", {
      method: "POST",
      headers: req.headers,
      body: "Digits=1",
    });
    expect((await app.fetch(viaProxy)).status).toBe(200);
  });

  it("SKIP_TWILIO_SIGNATURE=1 bypasses validation (tests only)", async () => {
    const { app, acks } = setup({ env: { SKIP_TWILIO_SIGNATURE: "1" } });
    const res = await app.fetch(new Request(`${BASE}/api/telephony/gather/c1`, { method: "POST", body: "Digits=1" }));
    expect(res.status).toBe(200);
    expect(acks).toHaveLength(1);
  });

  it("is closed when the auth token is not configured", async () => {
    const { app } = setup({ env: { TWILIO_AUTH_TOKEN: undefined } });
    const res = await app.fetch(new Request(`${BASE}/api/telephony/status/c1`, { method: "POST", body: "CallStatus=busy" }));
    expect(res.status).toBe(403);
  });
});

describe("gather (DTMF)", () => {
  it("1 acknowledges and thanks", async () => {
    const { app, acks } = setup();
    const res = await app.fetch(await signed("/api/telephony/gather/c1", { Digits: "1" }));
    const body = await res.text();
    expect(acks).toEqual([["c1", true, "dtmf:1"]]);
    expect(body).toContain("<Say");
    expect(body).toContain("<Hangup/>");
  });

  it("2 starts a 30 s recording with beep", async () => {
    const { app, acks } = setup();
    const body = await (await app.fetch(await signed("/api/telephony/gather/c1", { Digits: "2" }))).text();
    expect(acks).toHaveLength(0);
    expect(body).toContain(`<Record maxLength="30" playBeep="true" action="${BASE}/api/telephony/recording/c1"`);
  });

  it("anything else replays once, then hangs up", async () => {
    const { app, acks } = setup();
    const first = await (await app.fetch(await signed("/api/telephony/gather/c1", { Digits: "7" }))).text();
    expect(first).toContain(`<Redirect method="POST">${BASE}/api/telephony/twiml/c1?replay=1</Redirect>`);
    const none = await (await app.fetch(await signed("/api/telephony/gather/c1", {}))).text();
    expect(none).toContain("<Redirect");
    const again = await (await app.fetch(await signed("/api/telephony/gather/c1?replay=1", { Digits: "7" }))).text();
    expect(again).toContain("<Hangup/>");
    expect(again).not.toContain("<Redirect");
    expect(acks).toHaveLength(0);
  });
});

describe("recording -> STT -> classify -> raiseRequest", () => {
  const rec = { RecordingUrl: "https://api.twilio.com/2010-04-01/Accounts/ACtest123/Recordings/RE1", RecordingSid: "RE1" };

  it("transcribes with Sarvam, classifies and raises an urgent request", async () => {
    const t = setup();
    const res = await t.app.fetch(await signed("/api/telephony/recording/c1", rec));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<Hangup/>");

    const dl = t.calls.find((c) => c.url.endsWith("RE1.wav"))!;
    expect((dl.init?.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa(`${SID}:${TOKEN}`)}`);

    const stt = t.calls.find((c) => c.url === "https://api.sarvam.ai/speech-to-text")!;
    const form = stt.init?.body as FormData;
    expect(form.get("language_code")).toBe("te-IN");
    expect(form.get("model")).toMatch(/^saaras/);
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect((stt.init?.headers as Record<string, string>)["api-subscription-key"]).toBe("sarvam-key");

    expect(t.classified).toEqual(["నాకు అత్యవసరంగా నీళ్లు కావాలి"]);
    expect(t.raised).toEqual([
      { farmerId: "f-7", type: "urgent", reason: "నాకు అత్యవసరంగా నీళ్లు కావాలి", channel: "voice" },
    ]);
    expect(t.transcripts[0]).toEqual(["c1", "నాకు అత్యవసరంగా నీళ్లు కావాలి", "sarvam"]);
    expect(t.calls.some((c) => c.url.includes("deepgram"))).toBe(false);
  });

  it("buffer_request raises a buffer request; other intents raise nothing", async () => {
    const buf = setup({ classify: { intent: "buffer_request", intent_confidence: 0.8, urgency: 0.4, mentions_crop_stress: false, source: "jev" } });
    await buf.app.fetch(await signed("/api/telephony/recording/c1", rec));
    expect(buf.raised.map((r) => r.type)).toEqual(["buffer"]);

    const other = setup({ classify: { intent: "acknowledge", intent_confidence: 0.8, urgency: 0, mentions_crop_stress: false, source: "rules" } });
    await other.app.fetch(await signed("/api/telephony/recording/c1", rec));
    expect(other.raised).toHaveLength(0);
    expect(other.classified).toHaveLength(1);
  });

  it("falls back to Deepgram when Sarvam fails", async () => {
    const t = setup({
      env: { DEEPGRAM_API_KEY: "dg-key" },
      handler: (url) => {
        if (url.includes("sarvam")) return new Response("down", { status: 503 });
        if (url.endsWith(".wav")) return new Response(WAV);
        return jsonRes({ results: { channels: [{ alternatives: [{ transcript: "I need water urgently" }] }] } });
      },
    });
    await t.app.fetch(await signed("/api/telephony/recording/c1", rec));
    const dg = t.calls.find((c) => c.url.startsWith("https://api.deepgram.com/v1/listen"))!;
    expect(dg.url).toContain("model=nova-3");
    expect(dg.url).toContain("language=te");
    expect((dg.init?.headers as Record<string, string>).Authorization).toBe("Token dg-key");
    expect(t.classified).toEqual(["I need water urgently"]);
    expect(t.transcripts[0]![2]).toBe("deepgram");
    expect(t.raised).toHaveLength(1);
  });

  it("uses Deepgram directly when there is no Sarvam key", async () => {
    const t = setup({ env: { SARVAM_API_KEY: undefined, DEEPGRAM_API_KEY: "dg-key" } });
    await t.app.fetch(await signed("/api/telephony/recording/c1", rec));
    expect(t.calls.some((c) => c.url.includes("sarvam"))).toBe(false);
    expect(t.classified).toEqual(["I need water urgently"]);
  });

  it("raises an urgent request from the keypad signal if no engine can transcribe", async () => {
    const t = setup({ handler: () => new Response("down", { status: 500 }) });
    const res = await t.app.fetch(await signed("/api/telephony/recording/c1", rec));
    expect(res.status).toBe(200);
    expect(t.classified).toHaveLength(0);
    expect(t.raised).toHaveLength(1);
    expect(t.raised[0]).toMatchObject({ farmerId: "f-7", type: "urgent", channel: "voice" });
  });

  it("never sends Twilio credentials to a non-Twilio recording URL", async () => {
    const t = setup();
    await t.app.fetch(await signed("/api/telephony/recording/c1", { RecordingUrl: "https://evil.example.com/x" }));
    expect(t.calls).toHaveLength(0);
    expect(t.raised).toHaveLength(0);
  });
});

describe("status callback", () => {
  it.each([
    ["initiated", "sent"],
    ["ringing", "sent"],
    ["in-progress", "delivered"],
    ["completed", "delivered"],
    ["no-answer", "failed"],
    ["busy", "failed"],
    ["failed", "failed"],
    ["canceled", "failed"],
  ])("%s -> %s", async (callStatus: string, expected: string) => {
    const t = setup();
    const res = await t.app.fetch(
      await signed("/api/telephony/status/c1", { CallStatus: callStatus, CallSid: "CA9", CallDuration: "12" }),
    );
    expect(res.status).toBe(200);
    expect(t.statuses).toEqual([["c1", expected, { callStatus, callSid: "CA9", durationSec: 12 }]]);
  });

  it("ignores unknown statuses and does not overwrite an acknowledged contact", async () => {
    const t = setup();
    await t.app.fetch(await signed("/api/telephony/status/c1", { CallStatus: "weird" }));
    expect(t.statuses).toHaveLength(0);
    const acked = setup({ contact: { ...contact, status: "acknowledged" } });
    await acked.app.fetch(await signed("/api/telephony/status/c1", { CallStatus: "completed" }));
    expect(acked.statuses).toHaveLength(0);
  });
});

describe("placeCall", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup({
      handler: (url) =>
        url.includes("text-to-speech")
          ? jsonRes({ audios: [WAV_B64] })
          : jsonRes({ sid: "CAabc", status: "queued" }, 201),
    });
  });

  it("POSTs a form-encoded call to Twilio with Basic auth and webhook URLs", async () => {
    const out = await placeCall(t.deps, { contactId: "c1", to: "+919999999999", messageTe: "నమస్కారం" });
    expect(out).toEqual({ simulated: false, ok: true, callSid: "CAabc", status: "queued" });
    const call = t.calls.find((c) => c.url.includes("api.twilio.com"))!;
    expect(call.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Calls.json`);
    expect(call.init?.method).toBe("POST");
    const headers = call.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${btoa(`${SID}:${TOKEN}`)}`);
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(call.init?.body as string);
    expect(form.get("To")).toBe("+919999999999");
    expect(form.get("From")).toBe("+15005550006");
    expect(form.get("Url")).toBe(`${BASE}/api/telephony/twiml/c1`);
    expect(form.get("StatusCallback")).toBe(`${BASE}/api/telephony/status/c1`);
    expect(form.getAll("StatusCallbackEvent")).toEqual(["initiated", "ringing", "answered", "completed"]);
    expect(form.has("MachineDetection")).toBe(false);
  });

  it("pre-warms the TTS cache so the audio route does not synthesise again", async () => {
    await placeCall(t.deps, { contactId: "c1", to: "+919999999999", messageTe: "నమస్కారం" });
    expect(t.cache.m.size).toBe(1);
    const before = t.calls.filter((c) => c.url.includes("text-to-speech")).length;
    t.deps.getMessage = async () => "నమస్కారం";
    const app = mount(t.deps);
    expect((await app.fetch(new Request(`${BASE}/api/telephony/audio/c1`))).status).toBe(200);
    expect(t.calls.filter((c) => c.url.includes("text-to-speech")).length).toBe(before);
  });

  it("reports Twilio errors without throwing", async () => {
    const bad = setup({ handler: () => jsonRes({ message: "Unverified number" }, 400) });
    const out = await placeCall(bad.deps, { contactId: "c1", to: "+910000000000", messageTe: "x" });
    expect(out).toEqual({ simulated: false, ok: false, httpStatus: 400, error: "Unverified number" });
  });

  it("is simulated and does nothing without Twilio env", async () => {
    for (const missing of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "PUBLIC_BASE_URL"] as const) {
      const s = setup({ env: { [missing]: undefined } });
      expect(await placeCall(s.deps, { contactId: "c1", to: "+91", messageTe: "x" })).toEqual({ simulated: true });
      expect(s.calls).toHaveLength(0);
    }
    const off = setup({ env: { REAL_TELEPHONY: "0" } });
    expect(await placeCall(off.deps, { contactId: "c1", to: "+91", messageTe: "x" })).toEqual({ simulated: true });
    expect(off.calls).toHaveLength(0);
  });
});
