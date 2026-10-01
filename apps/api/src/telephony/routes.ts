import { Hono } from "hono";
import type { Context } from "hono";
import { deepgramStt, sarvamStt, sarvamTts } from "./speech";
import { validateTwilioSignature } from "./signature";
import {
  PROMPT_TE,
  callTwiml,
  callUrls,
  emptyTwiml,
  hangupTwiml,
  recordTwiml,
  replayTwiml,
  thankYouTwiml,
} from "./twiml";
import { DEFAULT_MOUNT, basicAuth, messageAudio } from "./twilio";
import type { ContactStatusValue, TelephonyDeps } from "./types";

const XML = { "Content-Type": "text/xml; charset=utf-8" } as const;
const xml = (body: string, status = 200) => new Response(body, { status, headers: XML });

/** Twilio CallStatus -> Contact status. Anything unlisted is ignored. */
export const CALL_STATUS_MAP: Record<string, ContactStatusValue> = {
  initiated: "sent",
  queued: "sent",
  ringing: "sent",
  "in-progress": "delivered",
  answered: "delivered",
  completed: "delivered",
  "no-answer": "failed",
  busy: "failed",
  failed: "failed",
  canceled: "failed",
};

const PROMPT_CACHE_KEY = "telephony:prompt:te:v1";
const RECORDING_ATTEMPTS = 3;

export function createTelephonyRoutes(deps: TelephonyDeps): Hono {
  const app = new Hono();
  const mount = deps.mountPath ?? DEFAULT_MOUNT;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  /**
   * Validates X-Twilio-Signature and returns the form params (empty for GET), or a Response to send back.
   * The URL signed is rebuilt from PUBLIC_BASE_URL so tunnels and proxies cannot change it.
   */
  async function guard(c: Context): Promise<URLSearchParams | Response> {
    const raw = c.req.method === "POST" ? await c.req.text() : "";
    const params = new URLSearchParams(raw);
    if (deps.env.SKIP_TWILIO_SIGNATURE === "1") return params;
    const token = deps.env.TWILIO_AUTH_TOKEN;
    const base = deps.env.PUBLIC_BASE_URL;
    if (!token || !base) return new Response("telephony not configured", { status: 403 });
    const u = new URL(c.req.url);
    const fullUrl = `${base.replace(/\/+$/, "")}${u.pathname}${u.search}`;
    const ok = await validateTwilioSignature(token, c.req.header("X-Twilio-Signature"), fullUrl, params.entries());
    return ok ? params : new Response("invalid signature", { status: 403 });
  }

  const urlsFor = (contactId: string) => callUrls(deps.env.PUBLIC_BASE_URL ?? "", mount, contactId);

  // 2. TwiML for the call: message, one-digit gather, replay once.
  app.on(["GET", "POST"], "/twiml/:contactId", async (c) => {
    const g = await guard(c);
    if (g instanceof Response) return g;
    const contactId = c.req.param("contactId");
    if (!(await deps.getContact(contactId))) return xml(hangupTwiml(), 404);
    const replay = c.req.query("replay") === "1";
    const urls = urlsFor(contactId);
    if (deps.env.SARVAM_API_KEY) return xml(callTwiml({ urls, replay }));
    // No Sarvam key: let Twilio read the Telugu text itself rather than going silent.
    const message = await deps.getMessage(contactId);
    return xml(callTwiml({ urls, replay, sayFallback: { message, prompt: PROMPT_TE } }));
  });

  // 3. Telugu audio. Twilio does not sign <Play> fetches, so this route is unsigned; it serves only the call text.
  app.get("/audio/:contactId", async (c) => {
    const key = deps.env.SARVAM_API_KEY;
    if (!key) return c.text("tts not configured", 503);
    const contactId = c.req.param("contactId");
    try {
      const text = await deps.getMessage(contactId);
      const audio = await messageAudio(deps, contactId, text);
      return new Response(audio, { headers: { "Content-Type": "audio/wav", "Cache-Control": "private, max-age=3600" } });
    } catch {
      return c.text("tts failed", 502);
    }
  });

  app.get("/audio/:contactId/prompt", async (c) => {
    const key = deps.env.SARVAM_API_KEY;
    if (!key) return c.text("tts not configured", 503);
    try {
      let audio = await deps.cache.get(PROMPT_CACHE_KEY);
      if (!audio) {
        audio = await sarvamTts(deps.fetch, key, PROMPT_TE, deps.env.SARVAM_TTS_SPEAKER);
        await deps.cache.put(PROMPT_CACHE_KEY, audio);
      }
      return new Response(audio, { headers: { "Content-Type": "audio/wav", "Cache-Control": "public, max-age=86400" } });
    } catch {
      return c.text("tts failed", 502);
    }
  });

  // 4. DTMF result.
  app.post("/gather/:contactId", async (c) => {
    const g = await guard(c);
    if (g instanceof Response) return g;
    const contactId = c.req.param("contactId");
    const urls = urlsFor(contactId);
    const digits = (g.get("Digits") ?? "").trim();
    if (digits === "1") {
      await deps.recordAck(contactId, true, "dtmf:1");
      return xml(thankYouTwiml());
    }
    if (digits === "2") return xml(recordTwiml(urls));
    // Anything else: replay once, then hang up (no replay loop).
    return xml(c.req.query("replay") === "1" ? hangupTwiml() : replayTwiml(urls));
  });

  // 5. Recording -> STT -> System 1 -> optional request.
  app.post("/recording/:contactId", async (c) => {
    const g = await guard(c);
    if (g instanceof Response) return g;
    const contactId = c.req.param("contactId");
    const contact = await deps.getContact(contactId);
    if (!contact) return xml(hangupTwiml(), 404);

    const recordingUrl = g.get("RecordingUrl");
    if (!recordingUrl || !isTwilioHost(recordingUrl)) return xml(thankYouTwiml());

    const wav = await fetchRecording(recordingUrl);
    let transcript = "";
    let engine: "sarvam" | "deepgram" | undefined;
    if (wav) {
      const sarvamKey = deps.env.SARVAM_API_KEY;
      if (sarvamKey) {
        try {
          transcript = await sarvamStt(deps.fetch, sarvamKey, wav);
          if (transcript) engine = "sarvam";
        } catch {
          transcript = "";
        }
      }
      const dgKey = deps.env.DEEPGRAM_API_KEY;
      if (!transcript && dgKey) {
        try {
          transcript = await deepgramStt(deps.fetch, dgKey, wav);
          if (transcript) engine = "deepgram";
        } catch {
          transcript = "";
        }
      }
    }

    if (!transcript || !engine) {
      // The farmer pressed 2 (urgent). Never drop that signal because speech recognition failed.
      await deps.raiseRequest({
        farmerId: contact.farmer_id,
        type: "urgent",
        reason: "Urgent request by keypad (2); the voice recording could not be transcribed.",
        channel: "voice",
      });
      return xml(thankYouTwiml());
    }

    await deps.onTranscript?.(contactId, transcript, engine);
    const result = await deps.classify(transcript);
    if (result.intent === "urgent_request" || result.intent === "buffer_request") {
      await deps.raiseRequest({
        farmerId: contact.farmer_id,
        type: result.intent === "urgent_request" ? "urgent" : "buffer",
        reason: transcript,
        channel: "voice",
      });
    }
    return xml(thankYouTwiml());
  });

  async function fetchRecording(recordingUrl: string): Promise<ArrayBuffer | null> {
    const sid = deps.env.TWILIO_ACCOUNT_SID;
    const token = deps.env.TWILIO_AUTH_TOKEN;
    const headers: Record<string, string> = sid && token ? { Authorization: basicAuth(sid, token) } : {};
    const target = recordingUrl.endsWith(".wav") ? recordingUrl : `${recordingUrl}.wav`;
    for (let attempt = 1; attempt <= RECORDING_ATTEMPTS; attempt++) {
      try {
        const res = await deps.fetch(target, { headers });
        if (res.ok) return await res.arrayBuffer();
      } catch {
        /* retry */
      }
      if (attempt < RECORDING_ATTEMPTS) await sleep(500 * attempt);
    }
    return null;
  }

  // 6. Call progress -> contact status so the escalation ladder can retry.
  app.post("/status/:contactId", async (c) => {
    const g = await guard(c);
    if (g instanceof Response) return g;
    const contactId = c.req.param("contactId");
    const callStatus = (g.get("CallStatus") ?? "").toLowerCase();
    const mapped = CALL_STATUS_MAP[callStatus];
    if (!mapped) return xml(emptyTwiml());
    const contact = await deps.getContact(contactId);
    // A confirmed or escalated contact must not be overwritten by late call-progress events.
    if (contact && (contact.status === "acknowledged" || contact.status === "escalated")) return xml(emptyTwiml());
    const duration = g.get("CallDuration");
    await deps.updateContactStatus(contactId, mapped, {
      callStatus,
      callSid: g.get("CallSid") ?? undefined,
      durationSec: duration ? Number(duration) : undefined,
    });
    return xml(emptyTwiml());
  });

  return app;
}

/** Only fetch recordings from Twilio itself, so the account credentials are never sent elsewhere. */
function isTwilioHost(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "api.twilio.com" || u.hostname.endsWith(".twilio.com"));
  } catch {
    return false;
  }
}
