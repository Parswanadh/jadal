import { Hono } from "hono";

import { recordSpeechPath } from "./audio";
import { registerInboundRoutes } from "./inbound";
import { sarvamTts, transcribe } from "./speech";
import {
  PROMPT_TE,
  callTwiml,
  callUrls,
  emptyTwiml,
  expiredTwiml,
  hangupTwiml,
  recordTwiml,
  replayTwiml,
  thankYouTwiml,
  type SpokenTwimlPart,
} from "./twiml";
import { DEFAULT_MOUNT, messageAudio } from "./twilio";
import type { ContactStatusValue, SpeechPath, SttEngine, TelephonyDeps } from "./types";
import { fetchTwilioRecording, guardTwilioRequest, isTwilioHost, twimlResponse } from "./webhook";

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

/**
 * ADR-005's engine order for the **outbound** recording path: Sarvam `saaras` first, Deepgram `nova-3`
 * fallback. The inbound answer path reverses it (task 3); both orders are named constants so neither is
 * a hidden default.
 */
export const OUTBOUND_STT_ORDER: readonly SttEngine[] = ["sarvam", "deepgram"];

export function createTelephonyRoutes(deps: TelephonyDeps): Hono {
  const app = new Hono();
  const mount = deps.mountPath ?? DEFAULT_MOUNT;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const urlsFor = (contactId: string) => callUrls(deps.env.PUBLIC_BASE_URL ?? "", mount, contactId);

  /**
   * The prompt audio, cached under the exact key `/audio/:contactId/prompt` serves.
   *
   * Shared by the route and by the TwiML handler's pre-synthesis so a call synthesises the prompt at
   * most once, and so the handler can tell whether `<Play>` is honest.
   */
  async function promptAudio(): Promise<ArrayBuffer> {
    let audio = await deps.cache.get(PROMPT_CACHE_KEY);
    if (!audio) {
      audio = await sarvamTts(deps.fetch, deps.env.SARVAM_API_KEY as string, PROMPT_TE, deps.env.SARVAM_TTS_SPEAKER);
      await deps.cache.put(PROMPT_CACHE_KEY, audio);
    }
    return audio;
  }

  // 2. TwiML for the call: message, one-digit gather, replay once.
  app.on(["GET", "POST"], "/twiml/:contactId", async (c) => {
    const g = await guardTwilioRequest(deps, c);
    if (g instanceof Response) return g;
    const contactId = c.req.param("contactId");
    // A contact can be gone while its call is still up: `POST /api/demo/reset` clears the store, and
    // Twilio still holds the TwiML URL it was handed when the call started. Answering 404 there made
    // Twilio play "we could not reach your server" to a farmer who is on the line — an error about
    // our storage, told to someone who only wanted to know about their water. The call is answered
    // with a spoken message and a clean hangup instead, which is true and useful.
    if (!(await deps.getContact(contactId))) return twimlResponse(expiredTwiml(), { status: 200 });
    const replay = c.req.query("replay") === "1";
    const urls = urlsFor(contactId);
    const message = await deps.getMessage(contactId);

    // Pre-synthesise before choosing the verb. `<Play>` is emitted only for audio that really exists;
    // a Sarvam failure degrades to `<Say>` and is recorded, instead of a `<Play>` URL that 502s and
    // leaves the farmer listening to silence (task 5).
    let messagePart: SpokenTwimlPart = { say: message };
    let messagePath: SpeechPath = "say";
    let messageReason: string | undefined = "no SARVAM_API_KEY";
    let promptPart: SpokenTwimlPart = { say: PROMPT_TE };
    let promptPath: SpeechPath = "say";
    let promptReason: string | undefined = "no SARVAM_API_KEY";

    if (deps.env.SARVAM_API_KEY) {
      try {
        await messageAudio(deps, contactId, message);
        messagePart = { play: urls.audio };
        messagePath = "sarvam";
        messageReason = undefined;
      } catch (error) {
        messageReason = error instanceof Error ? error.message : String(error);
      }
      try {
        await promptAudio();
        promptPart = { play: urls.promptAudio };
        promptPath = "sarvam";
        promptReason = undefined;
      } catch (error) {
        promptReason = error instanceof Error ? error.message : String(error);
      }
    }

    await recordSpeechPath(deps, {
      phase: "confirmation",
      path: messagePath,
      text: message,
      ...(messageReason === undefined ? {} : { reason: messageReason }),
      contactId,
    });
    await recordSpeechPath(deps, {
      phase: "prompt",
      path: promptPath,
      text: PROMPT_TE,
      ...(promptReason === undefined ? {} : { reason: promptReason }),
      contactId,
    });

    const body = callTwiml({ urls, replay, message: messagePart, prompt: promptPart });
    return twimlResponse(body, { speechPath: messagePath === "sarvam" && promptPath === "sarvam" ? "sarvam" : "say" });
  });

  // 3. Telugu audio. Twilio does not sign <Play> fetches, so this route is unsigned; it serves only the call text.
  app.get("/audio/:contactId", async (c) => {
    if (!deps.env.SARVAM_API_KEY) return c.text("tts not configured", 503);
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
    if (!deps.env.SARVAM_API_KEY) return c.text("tts not configured", 503);
    try {
      const audio = await promptAudio();
      return new Response(audio, { headers: { "Content-Type": "audio/wav", "Cache-Control": "public, max-age=86400" } });
    } catch {
      return c.text("tts failed", 502);
    }
  });

  // 4. DTMF result.
  app.post("/gather/:contactId", async (c) => {
    const g = await guardTwilioRequest(deps, c);
    if (g instanceof Response) return g;
    const contactId = c.req.param("contactId");
    const urls = urlsFor(contactId);
    const digits = (g.get("Digits") ?? "").trim();
    if (digits === "1") {
      await deps.recordAck(contactId, true, "dtmf:1");
      return twimlResponse(thankYouTwiml());
    }
    if (digits === "2") return twimlResponse(recordTwiml(urls));
    // Anything else: replay once, then hang up (no replay loop).
    return twimlResponse(c.req.query("replay") === "1" ? hangupTwiml() : replayTwiml(urls));
  });

  // 5. Recording -> STT -> System 1 -> optional request.
  app.post("/recording/:contactId", async (c) => {
    const g = await guardTwilioRequest(deps, c);
    if (g instanceof Response) return g;
    const contactId = c.req.param("contactId");
    const contact = await deps.getContact(contactId);
    // Same reasoning as `/twiml`: a reset can remove the contact while the call is live, and a 404
    // makes Twilio tell the caller our server is unreachable. Say something true instead.
    if (!contact) return twimlResponse(expiredTwiml(), { status: 200 });

    const recordingUrl = g.get("RecordingUrl");
    if (!recordingUrl || !isTwilioHost(recordingUrl)) return twimlResponse(thankYouTwiml());

    const wav = await fetchTwilioRecording(deps, recordingUrl, sleep);
    const outcome =
      wav === null
        ? ({ ok: false, reason: "recording could not be downloaded" } as const)
        : await transcribe(deps.fetch, deps.env, wav, OUTBOUND_STT_ORDER);

    if (!outcome.ok) {
      // The farmer pressed 2 (urgent). Never drop that signal because speech recognition failed.
      await recordSpeechPath(deps, { phase: "transcript", path: "keyword", reason: outcome.reason, contactId });
      await deps.raiseRequest({
        farmerId: contact.farmer_id,
        type: "urgent",
        reason: "Urgent request by keypad (2); the voice recording could not be transcribed.",
        channel: "voice",
      });
      return twimlResponse(thankYouTwiml());
    }

    await recordSpeechPath(deps, {
      phase: "transcript",
      path: outcome.engine,
      text: outcome.transcript,
      contactId,
    });
    await deps.onTranscript?.(contactId, outcome.transcript, outcome.engine);
    const result = await deps.classify(outcome.transcript);
    if (result.intent === "urgent_request" || result.intent === "buffer_request") {
      await deps.raiseRequest({
        farmerId: contact.farmer_id,
        type: result.intent === "urgent_request" ? "urgent" : "buffer",
        reason: outcome.transcript,
        channel: "voice",
      });
    }
    return twimlResponse(thankYouTwiml());
  });

  // 6. Call progress -> contact status so the escalation ladder can retry.
  app.post("/status/:contactId", async (c) => {
    const g = await guardTwilioRequest(deps, c);
    if (g instanceof Response) return g;
    const contactId = c.req.param("contactId");
    const callStatus = (g.get("CallStatus") ?? "").toLowerCase();
    const mapped = CALL_STATUS_MAP[callStatus];
    if (!mapped) return twimlResponse(emptyTwiml());
    const contact = await deps.getContact(contactId);
    // A confirmed or escalated contact must not be overwritten by late call-progress events.
    if (contact && (contact.status === "acknowledged" || contact.status === "escalated")) return twimlResponse(emptyTwiml());
    const duration = g.get("CallDuration");
    await deps.updateContactStatus(contactId, mapped, {
      callStatus,
      callSid: g.get("CallSid") ?? undefined,
      durationSec: duration ? Number(duration) : undefined,
    });
    return twimlResponse(emptyTwiml());
  });

  // 7. Inbound: the farmer called us. Answer, speak Telugu, understand the reply.
  registerInboundRoutes(app, deps);

  return app;
}
