import { sarvamTts } from "./speech";
import { toHex } from "./signature";
import { callUrls } from "./twiml";
import type { PlaceCallInput, PlaceCallResult, TelephonyDeps } from "./types";

export const DEFAULT_MOUNT = "/api/telephony";

export function basicAuth(sid: string, token: string): string {
  return `Basic ${btoa(`${sid}:${token}`)}`;
}

/** True when every Twilio variable is present and REAL_TELEPHONY is not switched off. */
export function realCallsEnabled(env: TelephonyDeps["env"]): boolean {
  if (env.REAL_TELEPHONY === "0" || env.REAL_TELEPHONY === "false") return false;
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER && env.PUBLIC_BASE_URL);
}

export async function messageCacheKey(contactId: string, text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `telephony:msg:${contactId}:${toHex(digest).slice(0, 16)}`;
}

/** Return the message audio from cache, or synthesise it with Sarvam and store it. */
export async function messageAudio(
  deps: Pick<TelephonyDeps, "env" | "fetch" | "cache">,
  contactId: string,
  text: string,
): Promise<ArrayBuffer> {
  const key = await messageCacheKey(contactId, text);
  const hit = await deps.cache.get(key);
  if (hit) return hit;
  const audio = await sarvamTts(deps.fetch, deps.env.SARVAM_API_KEY as string, text, deps.env.SARVAM_TTS_SPEAKER);
  await deps.cache.put(key, audio);
  return audio;
}

/**
 * Start an outbound Twilio call. Without Twilio env this is a no-op returning {simulated: true}
 * (the browser simulated phone stays the demo default).
 */
export async function placeCall(
  deps: Pick<TelephonyDeps, "env" | "fetch" | "cache" | "mountPath">,
  input: PlaceCallInput,
): Promise<PlaceCallResult> {
  const { env } = deps;
  if (!realCallsEnabled(env)) return { simulated: true };
  const sid = env.TWILIO_ACCOUNT_SID as string;
  const token = env.TWILIO_AUTH_TOKEN as string;
  const urls = callUrls(env.PUBLIC_BASE_URL as string, deps.mountPath ?? DEFAULT_MOUNT, input.contactId);

  // Best effort: synthesise now so the farmer never waits on TTS after picking up.
  if (env.SARVAM_API_KEY && input.messageTe) {
    try {
      await messageAudio(deps, input.contactId, input.messageTe);
    } catch {
      /* the /audio route retries on demand */
    }
  }

  const body = new URLSearchParams();
  body.set("To", input.to);
  body.set("From", env.TWILIO_FROM_NUMBER as string);
  body.set("Url", urls.twiml);
  body.set("Method", "POST");
  body.set("StatusCallback", urls.status);
  body.set("StatusCallbackMethod", "POST");
  for (const ev of ["initiated", "ringing", "answered", "completed"]) body.append("StatusCallbackEvent", ev);

  let res: Response;
  try {
    res = await deps.fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls.json`, {
      method: "POST",
      headers: { Authorization: basicAuth(sid, token), "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (e) {
    return { simulated: false, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const data = (await res.json().catch(() => ({}))) as { sid?: string; status?: string; message?: string };
  if (!res.ok || !data.sid) {
    return { simulated: false, ok: false, httpStatus: res.status, error: data.message ?? `twilio ${res.status}` };
  }
  return { simulated: false, ok: true, callSid: data.sid, status: data.status ?? "queued" };
}
