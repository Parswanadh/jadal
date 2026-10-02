/**
 * Inbound calls: the agent answers, speaks Telugu, and understands the farmer's reply.
 *
 * These tests are the evidence for tasks 1–5 on the inbound path:
 *
 *   1. the webhook returns valid TwiML whose greeting/prompt are real Sarvam audio;
 *   2. every confirmation the flow can speak is a Telugu script message;
 *   3. the recorded reply is transcribed (Deepgram first) and fed to the **same** `classify` dep the
 *      text flow uses, then raised through the **same** `raiseRequest` dep;
 *   4. DTMF `1` and `2` still behave;
 *   5. each provider failure degrades to `<Say>`/keyword and records which path ran.
 *
 * The network is always stubbed: no test calls Sarvam, Deepgram or Twilio.
 */

import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { Hono } from "hono";
import type { Contact, System1Result } from "@jadal/contracts";

import { SPOKEN_MESSAGE_KINDS } from "../voice/script";
import type { MessageFacts } from "../voice/telugu";
import { createTelephonyRoutes } from "./index";
import { computeTwilioSignature } from "./signature";
import type { InboundCaller, RaiseRequestInput, SpeechPathDetail, TelephonyDeps, TelephonyEnv } from "./types";

const BASE = "https://jadal.example.dev";
const MOUNT = "/api/telephony";
const TOKEN = "tok_secret";
const SID = "ACtest123";
const FROM = "+919999999999";
const RECORDING = "https://api.twilio.com/2010-04-01/Accounts/ACtest123/Recordings/RE1";
const DEEPGRAM_TEXT = "నాకు అత్యవసరంగా నీళ్లు కావాలి";
const SARVAM_TEXT = "సర్వం ట్రాన్స్క్రిప్ట్";
const WAV = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]); // "RIFF" + bytes
const WAV_B64 = btoa(String.fromCharCode(...WAV));

const env: TelephonyEnv = {
  TWILIO_ACCOUNT_SID: SID,
  TWILIO_AUTH_TOKEN: TOKEN,
  TWILIO_FROM_NUMBER: "+15005550006",
  PUBLIC_BASE_URL: BASE,
  SARVAM_API_KEY: "sarvam-key",
  DEEPGRAM_API_KEY: "dg-key",
};

const caller: InboundCaller = { farmerId: "f-7", farmerName: "రమణ", contactId: "c1" };

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

const URGENT: System1Result = {
  intent: "urgent_request",
  intent_confidence: 0.9,
  urgency: 0.9,
  mentions_crop_stress: true,
  source: "rules",
};

const SCHEDULE: System1Result = {
  intent: "schedule_question",
  intent_confidence: 0.8,
  urgency: 0.3,
  mentions_crop_stress: false,
  source: "rules",
};

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

/** Mounted exactly as the Worker does: `app.route("/api/telephony", createTelephonyRoutes(deps))`. */
function setup(
  opts: {
    env?: Partial<TelephonyEnv>;
    handler?: Handler;
    caller?: InboundCaller | null;
    contact?: Contact | null;
    classify?: System1Result;
    facts?: MessageFacts | null;
  } = {},
) {
  const calls: Call[] = [];
  const acks: [string, boolean, string][] = [];
  const raised: RaiseRequestInput[] = [];
  const classified: string[] = [];
  const speechPaths: SpeechPathDetail[] = [];
  const resolved: string[] = [];
  const transcripts: [string, string, string][] = [];
  const cache = memoryCache();

  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    if (opts.handler) return opts.handler(url, init);
    if (url.startsWith("https://api.sarvam.ai/text-to-speech")) return jsonRes({ audios: [WAV_B64] });
    if (url.startsWith("https://api.sarvam.ai/speech-to-text")) return jsonRes({ transcript: SARVAM_TEXT });
    if (url.startsWith("https://api.deepgram.com/")) {
      return jsonRes({ results: { channels: [{ alternatives: [{ transcript: DEEPGRAM_TEXT }] }] } });
    }
    if (url.endsWith(".wav")) return new Response(WAV, { status: 200 });
    return new Response("unexpected " + url, { status: 500 });
  }) as typeof fetch;

  const deps: TelephonyDeps = {
    env: { ...env, ...opts.env },
    fetch: fakeFetch,
    cache,
    getContact: async () => (opts.contact === undefined ? contact : opts.contact),
    getMessage: async () => "నమస్కారం, మీ నీటి వంతు రేపు ఉదయం",
    recordAck: async (id, a, via) => void acks.push([id, a, via]),
    updateContactStatus: async () => {},
    classify: async (t) => {
      classified.push(t);
      return opts.classify ?? URGENT;
    },
    raiseRequest: async (r) => void raised.push(r),
    onTranscript: async (id, t, e) => void transcripts.push([id, t, e]),
    sleep: async () => {},
    resolveCaller: async (phone) => {
      resolved.push(phone);
      return opts.caller === undefined ? caller : opts.caller;
    },
    nextTurnFor: async () => opts.facts ?? null,
    onSpeechPath: async (d) => void speechPaths.push(d),
  };

  const app = new Hono().route(MOUNT, createTelephonyRoutes(deps));
  return { app, deps, calls, acks, raised, classified, speechPaths, resolved, transcripts, cache };
}

/** Build a request signed the way Twilio signs it (query string included in the URL). */
async function signed(
  path: string,
  params: Record<string, string> = {},
  method: "POST" | "GET" = "POST",
  token = TOKEN,
) {
  const entries = Object.entries(params);
  const sig = await computeTwilioSignature(token, BASE + path, method === "POST" ? entries : []);
  const init: RequestInit = { method, headers: { "X-Twilio-Signature": sig } };
  if (method === "POST") {
    init.body = new URLSearchParams(params).toString();
    (init.headers as Record<string, string>)["Content-Type"] = "application/x-www-form-urlencoded";
  }
  return new Request(BASE + path, init);
}

const ttsCalls = (t: ReturnType<typeof setup>) => t.calls.filter((c) => c.url.includes("text-to-speech"));
const ttsText = (t: ReturnType<typeof setup>, index = 0) =>
  JSON.parse(ttsCalls(t)[index]!.init?.body as string).text as string;

describe("inbound webhook: the agent answers and speaks", () => {
  it("returns TwiML that greets in Sarvam Telugu audio and starts listening", async () => {
    const t = setup();
    const res = await t.app.fetch(await signed(`${MOUNT}/inbound`, { From: FROM, To: "+15005550006", CallSid: "CA1" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/xml");
    expect(res.headers.get("X-Jadal-Speech")).toBe("sarvam");

    const body = await res.text();
    expect(body).toContain(`<Play>${BASE}${MOUNT}/script/audio?kind=inbound_greeting`);
    expect(body).toContain("farmerName=");
    expect(body).toContain(
      `<Gather input="dtmf" numDigits="1" timeout="5" action="${BASE}${MOUNT}/inbound/respond" method="POST">`,
    );
    expect(body).toContain(`<Play>${BASE}${MOUNT}/script/audio?kind=inbound_prompt</Play></Gather>`);
    expect(body).toContain(`<Redirect method="POST">${BASE}${MOUNT}/inbound/listen</Redirect>`);
    expect(body.indexOf("<Play>")).toBeLessThan(body.indexOf("<Gather"));
    expect(body.indexOf("</Gather>")).toBeLessThan(body.indexOf("<Redirect"));

    // The greeting really went to Sarvam, in Telugu, with the caller addressed.
    expect(ttsText(t)).toContain("నమస్కారం");
    expect(ttsText(t)).toContain("రమణ గారు");
    expect(JSON.parse(ttsCalls(t)[0]!.init?.body as string)).toMatchObject({
      target_language_code: "te-IN",
      model: "bulbul:v3",
    });
    // The caller's number is what resolution was asked about.
    expect(t.resolved).toEqual([FROM]);
  });

  it("falls back to <Say language=te-IN> with no Sarvam key and records the text path", async () => {
    const t = setup({ env: { SARVAM_API_KEY: undefined } });
    const res = await t.app.fetch(await signed(`${MOUNT}/inbound`, { From: FROM }));

    const body = await res.text();
    expect(res.headers.get("X-Jadal-Speech")).toBe("say");
    expect(body).toContain('<Say language="te-IN">నమస్కారం రమణ గారు');
    expect(body).not.toContain("<Play>");
    expect(ttsCalls(t)).toHaveLength(0);
    expect(t.speechPaths.map((p) => `${p.phase}:${p.path}`)).toEqual(["greeting:say", "prompt:say"]);
  });

  it("never emits <Play> for audio Sarvam failed to produce, and records the reason", async () => {
    const t = setup({
      handler: (url) =>
        url.includes("text-to-speech") ? new Response("boom", { status: 500 }) : new Response("x", { status: 500 }),
    });
    const res = await t.app.fetch(await signed(`${MOUNT}/inbound`, { From: FROM }));

    const body = await res.text();
    expect(res.headers.get("X-Jadal-Speech")).toBe("say");
    expect(body).toContain('<Say language="te-IN">');
    expect(body).not.toContain("<Play>");
    const greeting = t.speechPaths.find((p) => p.phase === "greeting")!;
    expect(greeting.path).toBe("say");
    expect(greeting.reason).toContain("sarvam tts 500");
  });

  it("403s an unsigned or wrongly-signed inbound webhook", async () => {
    const t = setup();
    const none = await t.app.fetch(
      new Request(`${BASE}${MOUNT}/inbound`, { method: "POST", body: "From=%2B919999999999" }),
    );
    expect(none.status).toBe(403);
    const wrong = await t.app.fetch(await signed(`${MOUNT}/inbound`, { From: FROM }, "POST", "other-token"));
    expect(wrong.status).toBe(403);
  });
});

describe("inbound DTMF: 1 = acknowledge, 2 = record a request", () => {
  it("1 acknowledges the open contact and thanks the farmer with Sarvam audio", async () => {
    const t = setup();
    const res = await t.app.fetch(await signed(`${MOUNT}/inbound/respond`, { From: FROM, Digits: "1" }));

    const body = await res.text();
    expect(t.acks).toEqual([["c1", true, "inbound:dtmf:1"]]);
    expect(body).toContain(`<Play>${BASE}${MOUNT}/script/audio?kind=acknowledge</Play>`);
    expect(body).toContain("<Hangup/>");
    expect(res.headers.get("X-Jadal-Speech")).toBe("sarvam");
  });

  it("2 starts a 30 s recording, carrying the keypad signal in the action URL", async () => {
    const t = setup();
    const body = await (
      await t.app.fetch(await signed(`${MOUNT}/inbound/respond`, { From: FROM, Digits: "2" }))
    ).text();
    expect(body).toContain(
      `<Record maxLength="30" playBeep="true" action="${BASE}${MOUNT}/inbound/recording?urgent=1" method="POST"/>`,
    );
    expect(t.acks).toHaveLength(0);
  });

  it("no keypress falls through to a spoken cue and <Record>", async () => {
    const t = setup();
    const body = await (
      await t.app.fetch(await signed(`${MOUNT}/inbound/respond`, { From: FROM, Digits: "" }))
    ).text();
    expect(body).toContain(`<Play>${BASE}${MOUNT}/script/audio?kind=listen_cue</Play>`);
    expect(body).toContain(
      `<Record maxLength="30" playBeep="true" action="${BASE}${MOUNT}/inbound/recording" method="POST"/>`,
    );
  });

  it("POST /inbound/listen is the same cue-then-record response", async () => {
    const t = setup();
    const body = await (await t.app.fetch(await signed(`${MOUNT}/inbound/listen`, { From: FROM }))).text();
    expect(body).toContain("kind=listen_cue");
    expect(body).toContain("<Record");
  });
});

describe("inbound reply: STT -> System 1 -> raiseRequest -> speak", () => {
  it("transcribes with Deepgram first and raises the urgent request through the shared path", async () => {
    const t = setup();
    const res = await t.app.fetch(
      await signed(`${MOUNT}/inbound/recording`, { From: FROM, RecordingUrl: RECORDING, RecordingSid: "RE1" }),
    );

    const body = await res.text();
    expect(res.status).toBe(200);

    // Recording downloaded from Twilio itself, with Basic auth.
    const dl = t.calls.find((c) => c.url.endsWith("RE1.wav"))!;
    expect((dl.init?.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa(`${SID}:${TOKEN}`)}`);

    // Deepgram first (task 3); Sarvam was not needed.
    const dg = t.calls.find((c) => c.url.startsWith("https://api.deepgram.com/v1/listen"))!;
    expect(dg.url).toContain("model=nova-3");
    expect(dg.url).toContain("language=te");
    expect((dg.init?.headers as Record<string, string>).Authorization).toBe("Token dg-key");
    expect(t.calls.some((c) => c.url.startsWith("https://api.sarvam.ai/speech-to-text"))).toBe(false);

    // The same classifier the typed flow uses.
    expect(t.classified).toEqual([DEEPGRAM_TEXT]);
    expect(t.raised).toEqual([
      { farmerId: "f-7", type: "urgent", reason: DEEPGRAM_TEXT, channel: "voice" },
    ]);

    // Which path ran, recorded for both the transcript and the spoken confirmation.
    expect(t.speechPaths.find((p) => p.phase === "transcript")?.path).toBe("deepgram");
    expect(t.speechPaths.find((p) => p.phase === "confirmation")?.path).toBe("sarvam");
    expect(t.transcripts).toEqual([["c1", DEEPGRAM_TEXT, "deepgram"]]);

    expect(body).toContain(`<Play>${BASE}${MOUNT}/script/audio?kind=request_recorded</Play>`);
    expect(body).toContain("<Hangup/>");
  });

  it("falls back to Sarvam when Deepgram fails, and records Sarvam as the engine", async () => {
    const t = setup({
      handler: (url) => {
        if (url.startsWith("https://api.deepgram.com/")) return new Response("down", { status: 503 });
        if (url.startsWith("https://api.sarvam.ai/speech-to-text")) return jsonRes({ transcript: SARVAM_TEXT });
        if (url.includes("text-to-speech")) return jsonRes({ audios: [WAV_B64] });
        if (url.endsWith(".wav")) return new Response(WAV, { status: 200 });
        return new Response("unexpected", { status: 500 });
      },
    });
    await t.app.fetch(await signed(`${MOUNT}/inbound/recording`, { From: FROM, RecordingUrl: RECORDING }));

    expect(t.calls.some((c) => c.url.startsWith("https://api.sarvam.ai/speech-to-text"))).toBe(true);
    expect(t.speechPaths.find((p) => p.phase === "transcript")?.path).toBe("sarvam");
    expect(t.classified).toEqual([SARVAM_TEXT]);
    expect(t.raised).toHaveLength(1);
  });

  it("feeds a release-time question to the classifier and answers with the next turn", async () => {
    const facts: MessageFacts = {
      farmerName: "రమణ",
      windowStart: "2026-10-15T05:00:00Z", // 10:30 IST on 15-10-2026
      windowEnd: "2026-10-15T07:30:00Z",
      allocatedM3: 180,
    };
    const t = setup({ classify: SCHEDULE, facts });
    const body = await (
      await t.app.fetch(await signed(`${MOUNT}/inbound/recording`, { From: FROM, RecordingUrl: RECORDING }))
    ).text();

    expect(t.raised).toHaveLength(0);
    expect(body).toContain("kind=next_turn");
    expect(body).toContain("allocatedM3=180");
    expect(ttsText(t)).toContain("15-10-2026");
    expect(ttsText(t)).toContain("180");
  });

  it("promises a callback when a release-time question cannot be answered from facts", async () => {
    const t = setup({ classify: SCHEDULE });
    const body = await (
      await t.app.fetch(await signed(`${MOUNT}/inbound/recording`, { From: FROM, RecordingUrl: RECORDING }))
    ).text();
    expect(body).toContain("kind=schedule_hold");
  });

  it("raises the keypad-2 request even when no engine can transcribe, and says so", async () => {
    const t = setup({
      handler: (url) => {
        if (url.includes("text-to-speech")) return jsonRes({ audios: [WAV_B64] });
        if (url.endsWith(".wav")) return new Response(WAV, { status: 200 });
        return new Response("down", { status: 503 });
      },
    });
    const body = await (
      await t.app.fetch(
        await signed(`${MOUNT}/inbound/recording?urgent=1`, { From: FROM, RecordingUrl: RECORDING }),
      )
    ).text();

    expect(t.classified).toHaveLength(0);
    expect(t.raised).toHaveLength(1);
    expect(t.raised[0]).toMatchObject({ farmerId: "f-7", type: "urgent", channel: "voice" });
    expect(t.raised[0]!.reason).toContain("could not be transcribed");
    expect(t.speechPaths.find((p) => p.phase === "transcript")?.path).toBe("keyword");
    expect(body).toContain("kind=request_recorded");
  });

  it("admits it did not understand when no engine can transcribe and no key was pressed", async () => {
    const t = setup({
      handler: (url) => {
        if (url.includes("text-to-speech")) return jsonRes({ audios: [WAV_B64] });
        if (url.endsWith(".wav")) return new Response(WAV, { status: 200 });
        return new Response("down", { status: 503 });
      },
    });
    const body = await (
      await t.app.fetch(await signed(`${MOUNT}/inbound/recording`, { From: FROM, RecordingUrl: RECORDING }))
    ).text();

    expect(t.raised).toHaveLength(0);
    expect(t.classified).toHaveLength(0);
    expect(body).toContain("kind=not_understood");
  });

  it("understands but refuses to attribute a request when the caller is not on the roster", async () => {
    const t = setup({ caller: null });
    const body = await (
      await t.app.fetch(await signed(`${MOUNT}/inbound/recording`, { From: FROM, RecordingUrl: RECORDING }))
    ).text();

    expect(t.classified).toEqual([DEEPGRAM_TEXT]);
    expect(t.raised).toHaveLength(0);
    expect(body).toContain("kind=caller_unknown");
  });

  it("never fetches a recording from a non-Twilio host", async () => {
    const t = setup();
    const body = await (
      await t.app.fetch(
        await signed(`${MOUNT}/inbound/recording`, { From: FROM, RecordingUrl: "https://evil.example.com/x" }),
      )
    ).text();

    expect(t.calls.some((c) => c.url.includes("evil.example.com"))).toBe(false);
    expect(t.raised).toHaveLength(0);
    expect(body).toContain("kind=not_understood");
  });
});

describe("the call script as real audio", () => {
  it("serves Telugu text for any scripted message, and 400s an unknown one", async () => {
    const t = setup();
    const res = await t.app.fetch(new Request(`${BASE}${MOUNT}/script/text?kind=alert&severity=emergency`));
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { kind: string; te: string; en: string };
    expect(payload.kind).toBe("alert");
    expect(payload.te).toContain("అత్యవసరం");
    expect(payload.en).toContain("Emergency");

    for (const kind of SPOKEN_MESSAGE_KINDS) {
      const suffix = kind === "alert" ? "&severity=warning" : "";
      const r = await t.app.fetch(new Request(`${BASE}${MOUNT}/script/text?kind=${kind}${suffix}`));
      expect(r.status).toBe(200);
    }

    expect((await t.app.fetch(new Request(`${BASE}${MOUNT}/script/text?kind=sing`))).status).toBe(400);
    expect((await t.app.fetch(new Request(`${BASE}${MOUNT}/script/text?kind=alert`))).status).toBe(400);
  });

  it("synthesises any scripted message with Sarvam, with honest 503/502/400 failures", async () => {
    const t = setup();
    const url = `${BASE}${MOUNT}/script/audio?kind=next_turn&windowStart=2026-10-15T05:00:00Z&allocatedM3=180`;
    const res = await t.app.fetch(new Request(url));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([...WAV]);
    expect(ttsText(t)).toContain("180");
    expect(ttsText(t)).toContain("15-10-2026");

    const noKey = setup({ env: { SARVAM_API_KEY: undefined } });
    expect((await noKey.app.fetch(new Request(`${BASE}${MOUNT}/script/audio?kind=inbound_prompt`))).status).toBe(503);

    const bad = setup({ handler: () => new Response("boom", { status: 500 }) });
    expect((await bad.app.fetch(new Request(`${BASE}${MOUNT}/script/audio?kind=inbound_prompt`))).status).toBe(502);

    expect((await t.app.fetch(new Request(`${BASE}${MOUNT}/script/audio?kind=sing`))).status).toBe(400);
  });
});

describe("local server replay (real socket)", () => {
  it("answers a Twilio webhook posted over HTTP with Telugu audio TwiML", async () => {
    const t = setup({ env: { SKIP_TWILIO_SIGNATURE: "1" } });
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === "string") headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(", "));
      }
      const request = new Request(`http://127.0.0.1${req.url}`, {
        method: req.method,
        headers,
        ...(req.method === "GET" || req.method === "HEAD" ? {} : { body: Buffer.concat(chunks) }),
      });
      const response = await t.app.fetch(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    try {
      const res = await fetch(`http://127.0.0.1:${port}${MOUNT}/inbound`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ From: FROM, To: "+15005550006", CallSid: "CA1" }).toString(),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/xml");
      const body = await res.text();
      expect(body).toContain(`<Play>${BASE}${MOUNT}/script/audio?kind=inbound_greeting`);
      expect(body).toContain('<Gather input="dtmf"');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    }
  });
});

describe("outbound honesty", () => {
  it("uses <Say> and records the path when Sarvam TTS fails, instead of a silent <Play>", async () => {
    const t = setup({
      handler: (url) =>
        url.includes("text-to-speech") ? new Response("boom", { status: 500 }) : new Response("x", { status: 500 }),
    });
    const res = await t.app.fetch(await signed(`${MOUNT}/twiml/c1`, {}, "GET"));

    const body = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Jadal-Speech")).toBe("say");
    expect(body).not.toContain("<Play>");
    expect(body).toContain('<Say language="te-IN">');
    expect(t.speechPaths.map((p) => `${p.phase}:${p.path}`)).toEqual(["confirmation:say", "prompt:say"]);
  });
});
