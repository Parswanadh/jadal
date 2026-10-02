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

/**
 * True when the account is a Twilio *trial*, which refuses the extra call parameters.
 *
 * Set `TWILIO_TRIAL=1` on a trial account. Default is unset (treated as a paid account), because the
 * restriction is a property of the account, not of this code: guessing "trial" for a paid account
 * would silently drop the status callbacks that keep `Contact.status` accurate.
 */
export function trialAccount(env: TelephonyDeps["env"]): boolean {
  const flag = env.TWILIO_TRIAL;
  return flag === "1" || flag === "true";
}

export async function messageCacheKey(contactId: string, text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `telephony:msg:${contactId}:${toHex(digest).slice(0, 16)}`;
}

/**
 * Choose the number an outbound call is actually dialled to.
 *
 * The seeded farmers carry placeholder Mobiles (`+9190000000xx`) that cannot receive a real call, so
 * a live demo would dial dead numbers. `TWILIO_FORWARD_TO` overrides the destination with one or more
 * real numbers (comma-separated); the call is routed to one of them deterministically by hashing the
 * original recipient, so the same farmer always rings the same handset and a demo is repeatable.
 *
 * This changes only *who is dialled*. The TwiML, the spoken message and the contact the call is
 * attributed to are all still the original farmer's, so nothing downstream is affected.
 *
 * Unset `TWILIO_FORWARD_TO` keeps normal production behaviour: the call goes to the farmer's own
 * number. A malformed/empty entry is ignored rather than dialled.
 */
export function forwardTarget(env: TelephonyDeps["env"], to: string): string {
  const raw = env.TWILIO_FORWARD_TO;
  if (typeof raw !== "string" || raw.trim() === "") return to;
  const targets = raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => /^\+\d{8,15}$/.test(t));
  if (targets.length === 0) return to;
  if (targets.length === 1) return targets[0] as string;
  // Stable spread across the targets: the same recipient always picks the same handset.
  let hash = 0;
  for (let i = 0; i < to.length; i += 1) hash = (hash * 31 + to.charCodeAt(i)) >>> 0;
  return targets[hash % targets.length] as string;
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
  body.set("To", forwardTarget(env, input.to));
  body.set("From", env.TWILIO_FROM_NUMBER as string);
  body.set("Url", urls.twiml);
  // A Twilio *trial* account rejects `Method`, `Twilio` and the status-callback parameters with
  // "trial accounts have limited parameter access", which fails the whole call. Send only what a
  // trial permits there (To/From/Url) and keep the full set everywhere else. The TwiML URL is
  // served by a POST route, so omitting `Method` is safe either way.
  if (!trialAccount(env)) {
    body.set("Method", "POST");
    body.set("StatusCallback", urls.status);
    body.set("StatusCallbackMethod", "POST");
    for (const ev of ["initiated", "ringing", "answered", "completed"]) body.append("StatusCallbackEvent", ev);
  }

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
