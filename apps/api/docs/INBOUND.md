# Inbound calling: can a farmer phone Jadal?

**No — not today.** A farmer cannot phone the Jadal number to raise a request, and the reason is not
the code. The code is complete, wired and proven end to end (below). The reason is that **the Twilio
account owns zero phone numbers**, so there is no inbound voice endpoint for anyone to dial.

This page states that plainly, gives the evidence, and lists the exact steps that would turn inbound
calling on. It is the operator's answer to "can we call the Twilio number to raise a request from the
registered phone number?"

## 1. The honest answer, with evidence

Verified against the live Twilio REST API with read-only `GET`s (no call placed, no SMS sent, nothing
purchased):

| Check | Endpoint | Result |
| --- | --- | --- |
| Account is a Trial | `GET /2010-04-01/Accounts/{Sid}.json` | `"type": "Trial"`, `"status": "active"` |
| Owns an incoming number | `GET .../IncomingPhoneNumbers.json` | **`count: 0`** |
| Has verified caller IDs | `GET .../OutgoingCallerIds.json` | `count: 0` |
| `TWILIO_FROM_NUMBER` | env | set, but a **US (+1)** number — caller ID for *outbound* only |

The decisive row is the second. A Twilio account with no owned `IncomingPhoneNumber` has **no inbound
voice endpoint**: there is no number whose Voice webhook Twilio could fire, so nothing exists to call.
`TWILIO_FROM_NUMBER` does not change that — it is a caller-ID value the outbound path passes as `From`,
and a US trial number is not dialable as a Jadal helpdesk line by an Indian farmer.

It is also **not a code problem**. Replaying the real Twilio webhook against the running app — over a
real socket, with a real `X-Twilio-Signature` — answers, greets the farmer by name in Telugu, takes
DTMF, records, transcribes, classifies and raises a readable request. See §3.

## 2. The two things that must both be true

Inbound calling needs **both** halves. Today only the second exists:

1. **A provisioned, verified inbound number** — a Twilio phone number whose `VoiceUrl` points at Jadal.
   *Missing: the account owns none.*
2. **A reachable app with the inbound routes mounted** — `POST /api/telephony/inbound` and the three
   steps behind it, with `resolveCaller` wired so the call is attributed to a farmer. *Done and proven.*

## 3. What was proven, without buying a number

The inbound path was exercised **without purchasing a number and without contacting Twilio, Sarvam or
Deepgram**, two ways: a live replay against the running Worker, and the test suite.

### Live replay over a real socket

`test/replay-entry.ts` serves the real app on `wrangler dev` while stubbing only the two *outgoing*
provider calls (the Twilio recording download and Deepgram STT) — the same `env.fetch` seam the tests
use. Everything else is production code: the routes, real D1, real signature validation, the real
`resolveCaller`, System-1 and `raiseRequest`. `test/replay-inbound.mjs` then POSTs genuinely signed
Twilio-shaped webhooks.

**Step 1 — `POST /api/telephony/inbound`** (the farmer's number is `+919000000001`, seeded as f1):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response><Say language="te-IN">నమస్కారం Ramaiah Kota గారు, ఇది జడల్ కాలువ సహాయ కేంద్రం. మీ నీటి సమస్యను చెప్పండి.</Say><Gather input="dtmf" numDigits="1" timeout="5" action="http://127.0.0.1:8799/api/telephony/inbound/respond" method="POST"><Say language="te-IN">1 నొక్కండి మీ నీటి వంతు నిర్ధారించడానికి, 2 నొక్కండి అత్యవసర అభ్యర్థన కోసం. లేదా మాట్లాడి మీ సమస్యను చెప్పండి.</Say></Gather><Redirect method="POST">http://127.0.0.1:8799/api/telephony/inbound/listen</Redirect></Response>
```

The greeting names the caller — "నమస్కారం **Ramaiah Kota గారు**" — which is the visible proof that
`resolveCaller` matched the dialled number to a farmer. An unknown number gets the same TwiML *without*
the name, which is the control case.

**Step 2 — `POST /api/telephony/inbound/respond` with `Digits=2`** (DTMF 2 = urgent request):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response><Record maxLength="30" playBeep="true" action="http://127.0.0.1:8799/api/telephony/inbound/recording?urgent=1" method="POST"/></Response>
```

**Step 3 — `POST /api/telephony/inbound/recording?urgent=1`** (recording → transcript → classify → raise):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response><Say language="te-IN">జడల్: మీ అత్యవసర అభ్యర్థన నమోదు చేయబడింది. నమస్కారం. మా కాలువ కార్యాలయం త్వరలో మిమ్మల్ని సంప్రదిస్తుంది. ధన్యవాదాలు.</Say><Hangup/></Response>
```

That is the *request recorded* confirmation, not the failure message — so a request was written. And it
is readable on the coordinator's own surface, `GET /api/requests`:

```json
[
  {
    "id": "req_e258c49379ff4fc686e2897cec18c78d",
    "farmer_id": "f1",
    "type": "urgent",
    "status": "triaged",
    "channel": "voice",
    "volume_m3": 0,
    "reason": "నాకు అత్యవసరంగా నీళ్లు కావాలి",
    "raised_at": "2026-09-14T00:30:00.000Z"
  }
]
```

`reason` is the Telugu transcript the STT stub returned; `farmer_id` is `f1`, resolved from the caller's
phone number; `channel` is `voice`. Reproduce it with:

```bash
cd apps/api
# terminal 1 — the real app, providers stubbed, signature check ARMED
npx wrangler dev test/replay-entry.ts --local --port 8799 --ip 127.0.0.1 \
  --compatibility-date 2026-07-29 --compatibility-flags nodejs_compat --assets ./test/live-assets \
  --var ENVIRONMENT:development --var DEMO_MODE:1 --var REAL_TELEPHONY:false --var SKIP_TWILIO_SIGNATURE:0 \
  --var TWILIO_AUTH_TOKEN:<any-local-token> --var PUBLIC_BASE_URL:http://127.0.0.1:8799 \
  --var TWILIO_ACCOUNT_SID:ACreplayonly0000000000000000000000 --var TWILIO_FROM_NUMBER:+17320008034 \
  --var DEEPGRAM_API_KEY:<local-stub-key>

# terminal 2
npx wrangler d1 migrations apply jadal-db --local
curl -X POST http://127.0.0.1:8799/api/demo/reset -H 'content-type: application/json' -d '{}'
node test/replay-inbound.mjs --base http://127.0.0.1:8799 --token <the same token> --from +919000000001
```

Signature enforcement was verified in the same session: an unsigned webhook, one signed with the wrong
token, and one whose body was tampered with after signing each get **403** and write nothing.

### Automated tests

`src/telephony/inbound-e2e.test.ts` (17 tests) drives the mounted `/api/telephony` through the real
`createApp()` with the network stubbed, and covers the whole flow plus the `resolveCaller` seam:
greeting-by-name, unknown-number control, DTMF 1, DTMF 2 → `?urgent=1`, the listen fallthrough, the
full transcribe → classify → raise → `GET /api/requests` path, the keypad-only raise when the recording
cannot be fetched, and four signature-rejection cases. `src/telephony/inbound.test.ts` covers the
inbound module against hand-built deps. No test contacts Twilio, Sarvam or Deepgram:
`test/harness.ts`'s fetch throws on any unmocked URL.

## 4. The one code change that was missing

`resolveCaller` is what attributes an inbound call to a farmer. It is declared optional in
`telephony/types.ts` and consumed in `telephony/inbound.ts`, but `buildTelephonyDeps` did **not**
supply it, so `raiseFromInbound` always refused and every caller heard the unknown-caller reply. It is
now wired in `apps/api/src/telephony-deps.ts`:

* the caller's `From` is normalised to digits (`phoneKey`) and matched against the seeded roster, so
  `+919000000001`, `+91 90000 00001` and `tel:+919000000001` are one handset;
* ties resolve deterministically to the lowest farmer `id`;
* the farmer's most recent **open** contact (`queued` / `sent` / `delivered`) is attached, so DTMF `1`
  acknowledges something real — a farmer raising a fresh urgent request has none, and `contactId` stays
  undefined, which the module already handles;
* an unknown number returns `null`, which the module treats as an honest "not on the roster", not an
  error.

## 5. Enabling inbound for real — exact steps

All of this is the operator's decision: it **costs money** and none of it is done here.

1. **Buy an inbound-capable number.** In the Twilio Console (or
   `POST /2010-04-01/Accounts/{Sid}/IncomingPhoneNumbers.json`) purchase a number that can receive
   voice. For farmers in Andhra Pradesh/Telangana an **Indian (+91)** number is the right choice; a US
   number is not dialable as a local helpdesk line. *This is the step that does not exist today.*
2. **Leave the Trial account, or accept its limits.** A Trial account can receive calls on a number it
   owns, but (a) it plays a trial message before your TwiML and (b) it can only call **verified**
   numbers. For a real pilot, upgrade the account **and** verify the farmers' handsets
   (`OutgoingCallerIds`), which is also what the outbound escalation ladder needs.
3. **Expose the API on a public HTTPS origin.** Twilio must be able to reach it. Either deploy
   (`pnpm --filter api deploy`) or run a tunnel in front of the local Worker. Set `PUBLIC_BASE_URL` to
   that origin — the signature guard rebuilds the signed URL from it, never from the `Host` header.
4. **Set the environment variables** on the Worker (names only here; never commit values):

   | Variable | Purpose |
   | --- | --- |
   | `TWILIO_ACCOUNT_SID` | account for the REST API and recording download |
   | `TWILIO_AUTH_TOKEN` | **signs/validates every webhook** and authenticates recording downloads |
   | `PUBLIC_BASE_URL` | public HTTPS origin Twilio reaches; the signature is computed against it |
   | `DEEPGRAM_API_KEY` | inbound STT (first engine on this path) |
   | `SARVAM_API_KEY` | Telugu TTS/STT (fallback + the spoken greeting) |
   | `TWILIO_FROM_NUMBER` | outbound caller ID; not an inbound line |
   | `REAL_TELEPHONY` | `true` to allow real outbound calls (inbound needs no flag) |

   Do **not** set `SKIP_TWILIO_SIGNATURE` on a deployed Worker — ADR-005 forbids it; it would let anyone
   raise requests as any farmer.
5. **Point the number's Voice webhook at Jadal.** In the number's configuration set:

   | Setting | Value |
   | --- | --- |
   | **A call comes in** (Voice URL) | `{PUBLIC_BASE_URL}/api/telephony/inbound` |
   | HTTP method | `POST` |

   The **Call status changes** callback is left unset on the inbound number: there is no bare inbound
   status route (the call-progress route, `POST /api/telephony/status/:contactId`, is per-contact and
   belongs to the outbound ladder, which knows the contact id before it dials). The inbound flow needs
   no status callback to work. Twilio fetches TwiML for each call, and the `/inbound/respond`,
   `/inbound/listen` and `/inbound/recording` URLs are produced *by* that TwiML, so nothing else needs
   configuring in the console.
6. **Confirm the wiring** with a single call from a **registered** handset. Listen for the greeting to
   use the farmer's name (that is `resolveCaller` working), press `2`, speak, and check that a `voice`
   request appears in `GET /api/requests` and in the coordinator UI.

Until step 1 is done, the answer stays **no** — and the reason to give the user is "we have not
provisioned an inbound number", not "the feature is missing".
