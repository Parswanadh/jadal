# ADR-005 Real telephony: Twilio Voice + Sarvam, optional Deepgram fallback

Status: accepted. Implements checklist item B8 of issue #2 and extends ADR-003. Code: `apps/api/src/telephony/`.

## Decision

- **Calls** go out through **Twilio Programmable Voice** using plain `fetch` with Basic auth. The Twilio Node SDK is not used because the API runs on Cloudflare Workers.
- **Telugu audio** comes from **Sarvam** `bulbul` TTS (`POST https://api.sarvam.ai/text-to-speech`, `te-IN`, 8 kHz WAV). Twilio `<Play>`s it from our `/audio/:contactId` route. The audio is cached (injected `cache`), and `placeCall` pre-warms it, so a call never waits on TTS twice.
- **Speech recognition** of the farmer's recorded reply uses **Sarvam** `saaras` (`te-IN`, multipart upload). If Sarvam fails or no Sarvam key is set, and `DEEPGRAM_API_KEY` is set, it falls back to **Deepgram** `nova-3`.
- The **simulated browser phone stays the demo default** (ADR-003). Without Twilio env, `placeCall` returns `{ simulated: true }` and does nothing.

### Call flow

1. `placeCall` creates the call with `Url=/api/telephony/twiml/{contactId}` and `StatusCallback=/api/telephony/status/{contactId}` (events `initiated ringing answered completed`; no machine detection).
2. `twiml` returns `<Play>` of the message, then `<Gather input="dtmf" numDigits="1" timeout="8">` containing the Telugu prompt audio ("1 నొక్కండి నిర్ధారించడానికి, 2 నొక్కండి అత్యవసర అభ్యర్థన కోసం": press 1 to confirm, 2 for an urgent request), then `<Redirect>` to replay once. The replay pass ends with `<Hangup/>`, and an invalid key on the replay pass hangs up, so there is no loop.
3. `gather`: `1` calls `recordAck(contactId, true, "dtmf:1")` and thanks the farmer. `2` returns `<Record maxLength="30" playBeep="true">`. Anything else replays.
4. `recording`: download `RecordingUrl + ".wav"` (Twilio Basic auth; refused for non-`twilio.com` hosts so credentials never leak), transcribe, `classify` (System 1), and if the intent is `urgent_request` or `buffer_request` call `raiseRequest({ farmerId, type, reason: transcript, channel: "voice" })` with type `urgent` or `buffer`. If no engine can transcribe, an urgent request is still raised from the keypad `2` signal with a note saying the recording was not transcribed, so a farmer asking for help is never dropped.
5. `status`: Twilio `CallStatus` maps to a contact status: `initiated`/`ringing` to `sent`; `in-progress`/`completed` to `delivered`; `no-answer`/`busy`/`failed`/`canceled` to `failed`. This lets the B7 escalation ladder retry. Already `acknowledged` or `escalated` contacts are never overwritten by late events.

## Why DTMF for acknowledgement

DTMF works on every feature phone and on bad lines, and a keypress is unambiguous. Speech recognition of "yes" in rural Telugu over an 8 kHz PSTN link is the riskiest step in the loop, so the confirmation must not depend on it. Free speech is only used for the optional urgent request (key 2), where a transcript is a bonus and the keypress alone is already enough to raise a request.

## Deepgram and Telugu

Checked against Deepgram's models and languages overview: **nova-3 supports Telugu (`te`) as a monolingual language, but the `multi` code-switching mode covers only English, Spanish, French, German, Hindi, Russian, Portuguese, Japanese, Italian and Dutch. It does not include Telugu.** Nova-2 does not support Telugu.

So the fallback calls `https://api.deepgram.com/v1/listen?model=nova-3&language=te&smart_format=true` (header `Authorization: Token <key>`), not `language=multi`. `language=te` handles Telugu speech; for English or Hindi-heavy code-mixing, `language=multi` (or `en-IN`) would be better, but a Telugu-only call is the dominant case. Sarvam remains the primary engine because the research doc rates it best on rural Telugu and code-mixing, and Deepgram's Telugu quality on dialect speech is unproven here. Treat the fallback as best effort.

## Twilio trial limits

- Calls only reach **verified caller IDs** (up to 5 numbers verified by OTP in the Console).
- A trial account plays a **trial preamble** (a "your call is from a trial account, press any key" message) before our TwiML runs, and calls are capped at 10 minutes.
- Outbound calls to India must be enabled under Voice Geographic Permissions.
- The caller ID is a +1 number; Indian carriers and Truecaller often flag it as spam, so a phone may not ring. Never make the live call the sole demo dependency.

## India calling notes (from `docs/research/voice-and-data.md`)

- Production bulk calling needs TRAI DLT registration and a **160-series** service number; promotional calls are limited to 09:00-21:00 IST, transactional water alerts may run 24x7. None of this fits a 12-hour build, so real calls are limited to verified team numbers.
- Calls from a Twilio trial number can be silently dropped by the carrier. The in-browser simulated phone is the demo vehicle; real calls are a stretch.

## Webhooks in local development

Twilio must reach the Worker over public HTTPS. Either:

- `wrangler dev` plus `cloudflared tunnel --url http://localhost:8787`, then set `PUBLIC_BASE_URL` to the printed `https://*.trycloudflare.com` origin; or
- deploy the Worker and set `PUBLIC_BASE_URL` to its URL.

The signature check rebuilds the signed URL from `PUBLIC_BASE_URL` plus the request path and query, so the tunnel hostname must match `PUBLIC_BASE_URL` exactly (scheme and host).

## Security

- Every webhook (`twiml`, `gather`, `recording`, `status`) validates `X-Twilio-Signature` (base64 HMAC-SHA1 keyed by the auth token over the full URL plus POST params sorted by key and concatenated as key+value, via Web Crypto, constant-time compare) and returns 403 otherwise. Missing auth token or base URL also returns 403.
- `SKIP_TWILIO_SIGNATURE=1` disables the check. **Local tests only; never set it on a deployed Worker.**
- The two `/audio` routes are not signed because Twilio does not sign `<Play>` fetches. They serve only the call text synthesised by TTS, keyed by contact id.

## Environment variables

Set secrets with `wrangler secret put NAME` (or in `apps/api/.dev.vars` for local dev; make sure it is not committed). Never commit values.

| Name | Required | Purpose |
| --- | --- | --- |
| `TWILIO_ACCOUNT_SID` | for real calls | Twilio account |
| `TWILIO_AUTH_TOKEN` | for real calls | API auth and webhook signature key |
| `TWILIO_FROM_NUMBER` | for real calls | Caller ID, E.164 |
| `PUBLIC_BASE_URL` | for real calls | Public origin Twilio can reach, no path |
| `SARVAM_API_KEY` | recommended | Telugu TTS and STT. Without it TwiML uses `<Say language="te-IN">` and no transcription happens |
| `DEEPGRAM_API_KEY` | optional | STT fallback |
| `SARVAM_TTS_SPEAKER` | optional | bulbul speaker (default `shubh`) |
| `REAL_TELEPHONY` | optional | `0` or `false` forces simulated mode even if Twilio vars exist |
| `SKIP_TWILIO_SIGNATURE` | tests only | `1` skips signature validation |

## How Task B mounts it

```ts
import { createTelephonyRoutes, placeCall } from "./telephony";

app.route("/api/telephony", createTelephonyRoutes(deps));
```

`deps` (type `TelephonyDeps`) is built per request or once at boot from the Worker env and the DB:

- `env`, `fetch`, and `cache` (KV or R2 wrapper with `get`/`put` of `ArrayBuffer`; a Map works for tests)
- `getContact`, `getMessage` (Telugu text for the contact), `recordAck`, `updateContactStatus`, `classify` (System 1), `raiseRequest`
- optional `onTranscript` to store `Contact.transcript`

The B7 workflow calls `placeCall(deps, { contactId, to, messageTe })` for a voice contact. It returns `{ simulated: true }` (do nothing, the browser phone handles it), `{ simulated: false, ok: true, callSid }`, or `{ simulated: false, ok: false, error }` (treat as a failed attempt and escalate). The module does not import the database or any other api file; `apps/api` needs `vitest` as a devDependency to run the tests.
