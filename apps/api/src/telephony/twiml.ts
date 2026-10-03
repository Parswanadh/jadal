/** TwiML builders. Every dynamic value is XML-escaped. */

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** "Press 1 to confirm, press 2 for an urgent request" in Telugu. */
export const PROMPT_TE = "1 నొక్కండి నిర్ధారించడానికి, 2 నొక్కండి అత్యవసర అభ్యర్థన కోసం";
/** "Thank you. Your response has been recorded." */
export const THANKS_TE = "ధన్యవాదాలు. మీ సమాధానం నమోదు చేయబడింది.";

const wrap = (inner: string) => `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${inner}</Response>`;

export interface CallUrls {
  twiml: string;
  twimlReplay: string;
  status: string;
  audio: string;
  promptAudio: string;
  gather: string;
  gatherReplay: string;
  recording: string;
}

export function callUrls(base: string, mountPath: string, contactId: string): CallUrls {
  const root = `${base.replace(/\/+$/, "")}${mountPath}`;
  const id = encodeURIComponent(contactId);
  return {
    twiml: `${root}/twiml/${id}`,
    twimlReplay: `${root}/twiml/${id}?replay=1`,
    status: `${root}/status/${id}`,
    audio: `${root}/audio/${id}`,
    promptAudio: `${root}/audio/${id}/prompt`,
    gather: `${root}/gather/${id}`,
    gatherReplay: `${root}/gather/${id}?replay=1`,
    recording: `${root}/recording/${id}`,
  };
}

export interface CallTwimlOptions {
  urls: CallUrls;
  replay: boolean;
  /** Per-part audio decision: `<Play>` when Sarvam really produced audio, `<Say>` when it did not. */
  message?: SpokenTwimlPart;
  prompt?: SpokenTwimlPart;
  /** Legacy shorthand: speak both parts with `<Say>`. Retained for the no-key path and old callers. */
  sayFallback?: { message: string; prompt: string };
}

/** One spoken part of a call: real audio to play, or the text Twilio reads instead. */
export interface SpokenTwimlPart {
  /** `<Play>` URL; set only when the audio was actually synthesised. */
  readonly play?: string;
  /** `<Say language="te-IN">` text; set when audio was not available. */
  readonly say?: string;
}

/** Render one spoken part. `play` wins when both are set, because it is the real audio. */
export function renderSpokenPart(part: SpokenTwimlPart): string {
  if (part.play !== undefined) return `<Play>${escapeXml(part.play)}</Play>`;
  return `<Say language="te-IN">${escapeXml(part.say ?? "")}</Say>`;
}

/** The speech path a TwiML body encodes: `sarvam` only when every part is real audio. */
export function spokenPath(...parts: readonly SpokenTwimlPart[]): "sarvam" | "say" {
  return parts.every((part) => part.play !== undefined) ? "sarvam" : "say";
}

/** Message, then a one-digit Gather holding the prompt, then replay once (the replay pass hangs up instead). */
export function callTwiml({ urls, replay, message, prompt, sayFallback }: CallTwimlOptions): string {
  const messagePart = message ?? (sayFallback ? { say: sayFallback.message } : { play: urls.audio });
  const promptPart = prompt ?? (sayFallback ? { say: sayFallback.prompt } : { play: urls.promptAudio });
  const action = replay ? urls.gatherReplay : urls.gather;
  const tail = replay ? "<Hangup/>" : `<Redirect method="POST">${escapeXml(urls.twimlReplay)}</Redirect>`;
  return wrap(
    `${renderSpokenPart(messagePart)}<Gather input="dtmf" numDigits="1" timeout="8" action="${escapeXml(action)}" method="POST">${renderSpokenPart(promptPart)}</Gather>${tail}`,
  );
}

export function thankYouTwiml(): string {
  return wrap(`<Say language="te-IN">${escapeXml(THANKS_TE)}</Say><Hangup/>`);
}

export function recordTwiml(urls: CallUrls): string {
  return wrap(`<Record maxLength="30" playBeep="true" action="${escapeXml(urls.recording)}" method="POST"/>`);
}

export function replayTwiml(urls: CallUrls): string {
  return wrap(`<Redirect method="POST">${escapeXml(urls.twimlReplay)}</Redirect>`);
}

export function hangupTwiml(): string {
  return wrap("<Hangup/>");
}

export function emptyTwiml(): string {
  return wrap("");
}

/* ------------------------------------------------------------------ inbound answer */

/**
 * URLs for the inbound (farmer-called-us) flow.
 *
 * Unlike {@link callUrls} these are not keyed by contact id: an inbound caller is identified by their
 * phone number, not by an outreach contact, so the phrases are the same for everyone and the audio
 * routes take the phrase name. `greeting` accepts an optional `?name=` so a resolved caller hears
 * their own name without a per-caller URL existing anywhere else.
 */
export interface InboundUrls {
  readonly respond: string;
  readonly listen: string;
  readonly recording: string;
  readonly recordingUrgent: string;
}

export function inboundUrls(base: string, mountPath: string): InboundUrls {
  const root = `${base.replace(/\/+$/, "")}${mountPath}`;
  return {
    respond: `${root}/inbound/respond`,
    listen: `${root}/inbound/listen`,
    recording: `${root}/inbound/recording`,
    recordingUrgent: `${root}/inbound/recording?urgent=1`,
  };
}

export interface InboundTwimlOptions {
  readonly urls: InboundUrls;
  readonly greeting: SpokenTwimlPart;
  readonly prompt: SpokenTwimlPart;
  /** Seconds to wait for a keypress before falling through to the recording step. */
  readonly gatherTimeoutSec?: number;
}

/**
 * Answer an inbound call: greet, then a one-digit DTMF `<Gather>` that also holds the prompt, then
 * fall through to {@link listenTwiml}.
 *
 * `input="dtmf"` only, deliberately: the farmer's spoken reply is captured by `<Record>` and
 * transcribed by Sarvam/Deepgram, so the transcript always has a named engine behind it. Twilio's own
 * `input="speech"` recogniser is not used (see `docs/VOICE.md`). A farmer who speaks instead of
 * pressing a key simply falls through to the recording step after `gatherTimeoutSec`.
 */
export function inboundTwiml({ urls, greeting, prompt, gatherTimeoutSec = 5 }: InboundTwimlOptions): string {
  return wrap(
    `${renderSpokenPart(greeting)}<Gather input="dtmf" numDigits="1" timeout="${gatherTimeoutSec}" action="${escapeXml(urls.respond)}" method="POST">${renderSpokenPart(prompt)}</Gather><Redirect method="POST">${escapeXml(urls.listen)}</Redirect>`,
  );
}

/** The cue, then `<Record>` — the step that actually listens to the farmer's free speech. */
export function listenTwiml(urls: InboundUrls, cue: SpokenTwimlPart): string {
  return wrap(
    `${renderSpokenPart(cue)}<Record maxLength="30" playBeep="true" action="${escapeXml(urls.recording)}" method="POST"/>`,
  );
}

/** `<Record>` for the DTMF-2 urgent path; `action` carries `?urgent=1` so the keypad signal survives. */
export function inboundRecordTwiml(action: string): string {
  return wrap(`<Record maxLength="30" playBeep="true" action="${escapeXml(action)}" method="POST"/>`);
}

/** Say one thing and hang up — the inbound confirmations and honest failures. */
export function speakAndHangupTwiml(part: SpokenTwimlPart): string {
  return wrap(`${renderSpokenPart(part)}<Hangup/>`);
}
