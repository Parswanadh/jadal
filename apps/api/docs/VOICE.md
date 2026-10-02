# The Jadal voice path

How the caller agent **answers a phone call and speaks Telugu**, how it **understands the farmer's
reply**, and how every provider failure stays visible instead of turning into silence.

Code: `apps/api/src/voice/` (the script and Sarvam/Deepgram clients) and `apps/api/src/telephony/`
(the Twilio webhooks and TwiML). Decisions: `docs/decisions/ADR-005-telephony.md` (real telephony) and
`ADR-003` in `docs/decisions/ADR-001-004-stack.md` (the simulated phone is the demo default).

## The two call directions

| | Outbound (`placeCall`) | Inbound (farmer calls us) |
| --- | --- | --- |
| Entry | `POST /api/telephony/twiml/:contactId` | `POST /api/telephony/inbound` |
| Who is known | a `Contact` and its farmer | the caller's number (`From`) only |
| Greeting | `Contact.message_te` | `inboundGreetingTe()` — "Jadal canal help desk" |
| Listening | one-digit DTMF `<Gather>`; `2` opens `<Record>` | one-digit DTMF `<Gather>`; no key falls through to `<Record>` |
| STT order | Sarvam `saaras` → Deepgram `nova-3` (ADR-005) | **Deepgram → Sarvam** (task 3) |
| Confirmation | `thankYouTwiml()` | a scripted Telugu message, synthesised |

Both directions share the signature guard, the TwiML shaping and the recording download in
`telephony/webhook.ts`, and both end at the same `classify` (System 1) and `raiseRequest` deps, so the
voice channel cannot diverge from the typed/WhatsApp flow.

## The inbound call, step by step

```
Twilio  POST /api/telephony/inbound              (From = farmer's number)
   |    -> <Play> Sarvam greeting (Telugu)
   |    -> <Gather input="dtmf" numDigits="1" timeout="5" action=".../inbound/respond">
   |         <Play> Sarvam prompt: "1 = confirm, 2 = urgent request, or speak"
   |       </Gather>
   |    -> <Redirect> .../inbound/listen          (if the farmer spoke instead of pressing)
   |
   +-- 1 --> .../inbound/respond
   |         recordAck(contactId, true, "inbound:dtmf:1") when the caller maps to an open contact
   |         -> <Play> acknowledge + <Hangup/>
   |
   +-- 2 --> .../inbound/respond
   |         -> <Record maxLength="30" playBeep action=".../inbound/recording?urgent=1"/>
   |
   +-- no key --> .../inbound/listen
   |         -> <Play> "speak after the beep" + <Record action=".../inbound/recording"/>
   |
   +--> POST /api/telephony/inbound/recording
            download RecordingUrl.wav (Twilio Basic auth, *.twilio.com only)
            transcribe: Deepgram -> Sarvam            (recorded via onSpeechPath)
            classify(transcript)                       (the same System-1 dep)
            urgent_request | buffer_request -> raiseRequest(farmerId, type, reason, "voice")
            schedule_question               -> nextTurnFor(farmerId) -> speak day/window/volume
            other                           -> acknowledge
            no transcript + keypad 2        -> still raise urgent, say the audio was not transcribed
            -> <Play> confirmation + <Hangup/>
```

**Why `input="dtmf"` and not Twilio's `input="speech"`.** Twilio's Gather recogniser would return a
`SpeechResult` string with no audio, so the transcript would have no engine we could name. Recording the
reply and transcribing it ourselves keeps the recorded engine honest (`sarvam` or `deepgram`, never a
guess) and keeps Deepgram genuinely in the loop. The cost is that a farmer who speaks instead of
pressing a key waits out the 5 s gather timeout before the beep; `INBOUND_GATHER_TIMEOUT_SEC` is the
knob.

## What the agent can say

Every line lives in `apps/api/src/voice/telugu.ts` (the prose) and is selected by
`apps/api/src/voice/script.ts` (the `SpokenMessage` union). `spokenTelugu()` is exhaustive over that
union, so adding a moment without a Telugu line is a typecheck failure.

| `kind` | When | Telugu (first line) |
| --- | --- | --- |
| `inbound_greeting` | answering | నమస్కారం, ఇది జడల్ కాలువ సహాయ కేంద్రం. మీ నీటి సమస్యను చెప్పండి. |
| `inbound_prompt` | the keypad prompt | 1 నొక్కండి మీ నీటి వంతు నిర్ధారించడానికి, 2 నొక్కండి అత్యవసర అభ్యర్థన కోసం. లేదా మాట్లాడి మీ సమస్యను చెప్పండి. |
| `listen_cue` | before `<Record>` | బీప్ శబ్దం తర్వాత మాట్లాడండి. |
| `next_turn` | day + window + volume | జడల్: మీ తదుపరి నీటి వంతు వివరాలు. … మీ విడుదల రోజు 15-10-2026. … 180 ఘన మీటర్లు. |
| `request_approved` | an urgent request was approved | జడల్: మీ అత్యవసర అభ్యర్థన ఆమోదించబడింది. … 120 ఘన మీటర్లు మంజూరు చేయబడ్డాయి. |
| `request_recorded` | an inbound urgent request was logged | జడల్: మీ అత్యవసర అభ్యర్థన నమోదు చేయబడింది. … మా కాలువ కార్యాలయం త్వరలో మిమ్మల్ని సంప్రదిస్తుంది. |
| `alert` (info/warning/urgent/emergency) | a warning with a severity | జడల్ హెచ్చరిక: … / జడల్ అత్యవసరం: … వెంటనే మా కాలువ కార్యాలయానికి తెలియజేయండి. |
| `schedule_hold` | a release-time question with no facts | జడల్: మీ విడుదల సమయం గురించి మా కార్యాలయం త్వరలో మిమ్మల్ని సంప్రదిస్తుంది. |
| `acknowledge` | DTMF 1 / a plain answer | జడల్: మీ ధృవీకరణ నమోదు అయింది. … |
| `not_understood` | nothing transcribable | క్షమించండి, మీ మాటలు స్పష్టంగా వినిపించలేదు. దయచేసి మళ్లీ ప్రయత్నించండి. |
| `caller_unknown` | the number is not on the roster | క్షమించండి, ఈ ఫోన్ నంబర్ మా రికార్డులో లేదు. … |
| `request_failed` | the request write failed | క్షమించండి, మీ అభ్యర్థనను నమోదు చేయలేకపోయాము. దయచేసి మళ్లీ ప్రయత్నించండి. |

Each kind also has an English line (`spokenEnglish`) for the portal/WhatsApp thread beside the call.

### Speaking any of them as real audio

* `GET /api/telephony/script/text?kind=…&<facts>` → `{ kind, te, en }` (pure; no key, no network).
* `GET /api/telephony/script/audio?kind=…&<facts>` → Sarvam `bulbul` WAV (8 kHz). Unsigned, like the
  other `<Play>` targets, and it can only synthesise messages the script knows — never arbitrary text,
  so it is not an open TTS proxy. `503` without a Sarvam key, `502` when Sarvam fails.

Facts travel as query params (`farmerName`, `windowStart`, `windowEnd`, `outletName`, `chainageM`,
`allocatedM3`, `rainMm`, `leadHours`, `requestStatus`, `requestVolumeM3`, `statusLabelTe`), and
`scriptAudioUrl()` / `messageFromParams()` are exact inverses, so the sentence the agent decided to say
is the sentence Sarvam is asked for.

## Honest failure (the rule that shapes the code)

`<Play>` is emitted **only** when Sarvam really returned audio. Both the outbound TwiML route and the
inbound flow pre-synthesise before choosing the verb, so a Sarvam outage degrades to
`<Say language="te-IN">` reading the same Telugu text, not to a `<Play>` URL that 502s into silence.

Which path ran is recorded in three places:

1. `onSpeechPath(detail)` — the optional dep, called for every `<Play>`/`<Say>` decision and every
   transcription, with `phase`, `path` (`sarvam`/`deepgram`/`say`/`keyword`/`none`), the text and the
   reason. `telephony-deps.ts` wires it to a structured `console.log`.
2. `X-Jadal-Speech: sarvam | say` on every TwiML response, so a webhook replay shows the choice.
3. `onTranscript(contactId, transcript, engine)` for the transcript, when the caller maps to a contact.

The spoken failure modes are distinct on purpose: `not_understood` (we heard nothing), `caller_unknown`
(we heard you, but cannot attribute the request), `request_failed` (we tried to write it and could not).
The agent never confirms a request that was not raised.

## Environment variables

Names only; values live in `apps/api/.dev.vars` (gitignored) or `wrangler secret put`. All are optional:
with none of them the offline demo path runs unchanged and the agent falls back to `<Say>` + rules.

| Name | Purpose |
| --- | --- |
| `SARVAM_API_KEY` | Telugu TTS (`bulbul`) and STT (`saaras`) |
| `DEEPGRAM_API_KEY` | STT fallback (outbound) / primary (inbound), `nova-3`, `language=te` |
| `SARVAM_TTS_SPEAKER` | optional `bulbul` speaker (module default `shubh`) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | API auth, webhook signature key, recording download |
| `TWILIO_FROM_NUMBER` | caller ID for outbound |
| `PUBLIC_BASE_URL` | public https origin Twilio reaches; every webhook URL is rebuilt from it |
| `SKIP_TWILIO_SIGNATURE` | `1` disables signature validation. **Local replays only.** |

## Wiring the inbound path

The routes are registered inside `createTelephonyRoutes`, which `app.ts` already mounts at
`/api/telephony`, so **no route mount or env var is needed**. One dep is:

```ts
// apps/api/src/telephony-deps.ts — buildTelephonyDeps(env)
import { listFarmers } from "./db/repo";

async resolveCaller(phone) {
  const digits = phone.replace(/\D/g, "").slice(-10);
  const farmers = await listFarmers(env);
  const hit = farmers.find((f) => f.farmer.phone.replace(/\D/g, "").endsWith(digits));
  return hit === undefined ? null : { farmerId: hit.farmer.id, farmerName: hit.farmer.name };
},
async nextTurnFor(farmerId) { /* the farmer's next release as MessageFacts, or null */ },
async onSpeechPath(d) { console.log("[voice]", JSON.stringify(d)); },
```

Without `resolveCaller` the agent still answers, greets, listens, transcribes and classifies; it just
cannot attribute a raised request and says `caller_unknown`. Without `nextTurnFor` a release-time
question is answered with `schedule_hold` rather than an invented time.

## Local testing and a live check

* **Unit/integration** — `pnpm --filter api test`. The network is always stubbed; no test calls Sarvam,
  Deepgram or Twilio. `src/telephony/inbound.test.ts` replays signed webhooks through a real Hono mount.
* **Replay a webhook by hand** — run the Worker with `SKIP_TWILIO_SIGNATURE=1` and POST a Twilio-shaped
  form body to `/api/telephony/inbound`; the response is the TwiML above.
* **Live smoke (one-off, from the shell)** — POST one short Telugu sentence to
  `https://api.sarvam.ai/text-to-speech` and one WAV to `https://api.deepgram.com/v1/listen`, and report
  only the HTTP status and the response shape (`audios[0]` present / `transcripts[0].text` present).
  Never print the key or the raw headers.
* **Real inbound calls** need a public HTTPS origin (`cloudflared tunnel --url http://localhost:8788`)
  set as `PUBLIC_BASE_URL`, and the Twilio number's Voice webhook pointed at
  `https://<origin>/api/telephony/inbound`. Outbound stays simulated unless `REAL_TELEPHONY` is set by
  the orchestrator.
