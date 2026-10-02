/**
 * Replay a *signed* Twilio inbound voice webhook against a locally running Jadal API.
 *
 * This is the operator's tool for proving the inbound path without buying a number: it speaks the same
 * HTTP a real Twilio call would, over a real socket, with a real `X-Twilio-Signature`. Nothing here
 * contacts Twilio — the only network is to the local server you point it at.
 *
 * Usage:
 *   node test/replay-inbound.mjs --base http://127.0.0.1:8799 --token <same token the dev server has>
 *
 * The token must be the one the server was started with (`--var TWILIO_AUTH_TOKEN:...`). It is never
 * read from `.dev.vars` and never printed.
 */

import { createHmac } from "node:crypto";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const BASE = arg("base", "http://127.0.0.1:8799").replace(/\/+$/, "");
const TOKEN = arg("token", process.env.REPLAY_TWILIO_TOKEN ?? "");
const FROM = arg("from", "+919000000001");
const MOUNT = `${BASE}/api/telephony`;

if (TOKEN.length === 0) {
  console.error("need --token (the dev server's TWILIO_AUTH_TOKEN)");
  process.exit(2);
}

/** Twilio's signature: base64(HMAC-SHA1(token, url + concat(sorted(key+value)))). */
function sign(url, params) {
  const sorted = [...params].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const payload = url + sorted.map(([k, v]) => k + v).join("");
  return createHmac("sha1", TOKEN).update(Buffer.from(payload, "utf8")).digest("base64");
}

async function post(path, params) {
  const url = `${MOUNT}${path}`;
  const body = new URLSearchParams(params);
  const signature = sign(url, [...body.entries()]);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature,
    },
    body: body.toString(),
  });
  return { status: res.status, speech: res.headers.get("x-jadal-speech"), text: await res.text() };
}

const step = (n, s) => console.log(`\n=== ${n} ===\nHTTP ${s.status}  X-Jadal-Speech: ${s.speech ?? "-"}\n${s.text}`);

console.log(`replaying signed inbound call from ${FROM} against ${MOUNT}`);

const answer = await post("/inbound", { From: FROM, To: "+17320008034", CallSid: "CAreplay0001", CallStatus: "ringing" });
step("1. POST /inbound  (Twilio answers the call)", answer);

const respond = await post("/inbound/respond", { From: FROM, To: "+17320008034", CallSid: "CAreplay0001", Digits: "2" });
step("2. POST /inbound/respond  (farmer pressed 2 = urgent request)", respond);

// Twilio's real recording URL. `src/telephony/webhook.ts` allow-lists downloads to `*.twilio.com` (a
// security property), so the URL must be a Twilio host — the replay entry stubs the *outgoing* fetch
// for it. Nothing leaves the machine.
const recording = await post("/inbound/recording?urgent=1", {
  From: FROM,
  To: "+17320008034",
  CallSid: "CAreplay0001",
  RecordingUrl: "https://api.twilio.com/2010-04-01/Accounts/ACreplay/Recordings/REreplay0001",
  RecordingSid: "REreplay0001",
  RecordingDuration: "4",
});
step("3. POST /inbound/recording?urgent=1  (recording -> Deepgram stub -> System-1 -> raise)", recording);
