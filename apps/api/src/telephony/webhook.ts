/**
 * Shared Twilio webhook plumbing: signature guard, TwiML response shaping, and recording download.
 *
 * Extracted from `routes.ts` when the inbound answer path landed, so the outbound and inbound routes
 * validate a webhook, render TwiML and fetch a recording through **one** implementation. The security
 * properties live here and therefore cannot drift between the two call directions:
 *
 *  * the signed URL is rebuilt from `PUBLIC_BASE_URL` + the request path + query, never from the
 *    `Host` header, so a tunnel or proxy cannot change what Twilio signed;
 *  * recordings are fetched only from `*.twilio.com`, so the account credentials are never sent to a
 *    URL an attacker put in a webhook body.
 */

import type { Context } from "hono";

import { basicAuth } from "./twilio";
import { validateTwilioSignature } from "./signature";
import type { TelephonyDeps } from "./types";

/** Twilio reads TwiML as XML; the charset is explicit so Telugu is never decoded as Latin-1. */
export const TWIML_CONTENT_TYPE = "text/xml; charset=utf-8";

export interface TwimlResponseOptions {
  readonly status?: number;
  /**
   * Which speech path this TwiML chose. Written as `X-Jadal-Speech` so a replaying operator (or a
   * test) can see "say" and know Sarvam did not play, instead of inferring it from a silent call.
   */
  readonly speechPath?: string;
}

/** A TwiML `Response` with the right content type and, when known, the speech path it encodes. */
export function twimlResponse(body: string, options: TwimlResponseOptions = {}): Response {
  const headers: Record<string, string> = { "Content-Type": TWIML_CONTENT_TYPE };
  if (options.speechPath !== undefined) headers["X-Jadal-Speech"] = options.speechPath;
  return new Response(body, { status: options.status ?? 200, headers });
}

/**
 * Validate `X-Twilio-Signature` and return the form params (empty for GET), or a `Response` to send.
 *
 * `SKIP_TWILIO_SIGNATURE=1` bypasses the check for local replays; the ADR-005 warning stands — never
 * set it on a deployed Worker.
 */
export async function guardTwilioRequest(deps: TelephonyDeps, c: Context): Promise<URLSearchParams | Response> {
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

/** How many times to poll for a Twilio recording before giving up on it. */
export const RECORDING_ATTEMPTS = 3;

/** Only fetch recordings from Twilio itself, so the account credentials are never sent elsewhere. */
export function isTwilioHost(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "api.twilio.com" || u.hostname.endsWith(".twilio.com"));
  } catch {
    return false;
  }
}

/**
 * Download a Twilio recording as WAV, retrying while it becomes available.
 *
 * Twilio's `RecordingUrl` can 404 for a moment after the webhook fires, so this backs off
 * `500ms, 1000ms` before returning `null`. Returns `null` for a non-Twilio host without a network
 * call, which is the property the test "never sends Twilio credentials to a non-Twilio recording URL"
 * pins.
 */
export async function fetchTwilioRecording(
  deps: Pick<TelephonyDeps, "env" | "fetch" | "sleep">,
  recordingUrl: string,
  sleep: (ms: number) => Promise<void>,
): Promise<ArrayBuffer | null> {
  if (!isTwilioHost(recordingUrl)) return null;
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
