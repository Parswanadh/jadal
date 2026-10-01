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
  /** When set, speak this text with <Say> instead of playing Sarvam audio (no Sarvam key). */
  sayFallback?: { message: string; prompt: string };
}

/** Message, then a one-digit Gather holding the prompt, then replay once (the replay pass hangs up instead). */
export function callTwiml({ urls, replay, sayFallback }: CallTwimlOptions): string {
  const say = (t: string) => `<Say language="te-IN">${escapeXml(t)}</Say>`;
  const message = sayFallback ? say(sayFallback.message) : `<Play>${escapeXml(urls.audio)}</Play>`;
  const prompt = sayFallback ? say(sayFallback.prompt) : `<Play>${escapeXml(urls.promptAudio)}</Play>`;
  const action = replay ? urls.gatherReplay : urls.gather;
  const tail = replay ? "<Hangup/>" : `<Redirect method="POST">${escapeXml(urls.twimlReplay)}</Redirect>`;
  return wrap(
    `${message}<Gather input="dtmf" numDigits="1" timeout="8" action="${escapeXml(action)}" method="POST">${prompt}</Gather>${tail}`,
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
