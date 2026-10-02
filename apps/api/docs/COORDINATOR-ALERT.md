# Coordinator alerting

Task B. The two phone calls the water-approval loop was missing, and why they are best-effort by
design.

## The gap this closes

`POST /api/requests` and the telephony webhook both funnel through `raiseRequest()` in
`apps/api/src/requests.ts`. Before this change it appended `request.raised` + `request.triaged`,
read the request back, and returned. System 1 only **scores** a request (`triage_score`, `intent`);
it never decides water, and the coordinator's approval is a separate step (`request.decided` in
`apps/api/src/routes/write.ts`).

**Nothing told the coordinator a request was waiting.** A farmer could ask for water on the voice
keypad, in the portal or on the phone, and the request would sit in `raised`/`triaged` with no human
ever prompted to decide it. Symmetrically, an approved decision never reached the farmer: they were
granted a volume and a window by a coordinator who assumed someone would call.

Both directions now ring a phone.

| Direction | Entry point | Where it is called from |
| --- | --- | --- |
| Farmer raises a request → **coordinator** is phoned for approval | `notifyCoordinatorOfRequest` | `raiseRequest()` in `src/requests.ts`, after the request is durable |
| Coordinator approves → **farmer** hears the allocation | `notifyFarmerOfAllocation` | the `decideRequest` handler in `src/routes/write.ts`, on `approve` only |

Everything lives in `apps/api/src/coordinator-alert.ts`. Neither call site is a new Twilio client:
both go through `placeCall` in `src/telephony/twilio.ts`, reached through `placeCallFromCampaign` in
`src/telephony-deps.ts` — the same seam the escalation ladder uses.

## No keys, no problem (ADR-003)

A missing `COORDINATOR_PHONE` or missing Twilio env is a **clean no-op returning
`{ simulated: true }`**. Concretely:

- `coordinatorPhone(env)` returns `null` when `COORDINATOR_PHONE` is unset, blank, or not a plausible
  E.164 number. `null` is the switch: no destination, no dispatch.
- `placeCall` itself returns `{ simulated: true }` without touching the network when the Twilio
  variable set is incomplete or `REAL_TELEPHONY` is `0`/`false`.
- The request is created either way. **A notification failure never fails the farmer's request** —
  `placeCall` never throws, and every effect in this module is additionally wrapped in `attempt()`,
  which converts any throw into a reported `{ alerted: false, error }`.

The offline guarantee is asserted structurally in the tests rather than assumed: with no Twilio env
the suite asserts `env.calls.length === 0`, i.e. no fetch was even attempted.

## Honest simulated vs. real

`AlertOutcome` carries `simulated` straight from `placeCall`, and the three cases are kept distinct:

| `placeCall` result | `simulated` | `alerted` | audit `Contact.status` |
| --- | --- | --- | --- |
| no keys, no destination, or `REAL_TELEPHONY=0` | `true` | simulated only | `failed` |
| Twilio accepted | `false` | `true` | `sent` |
| Twilio refused / transport error | `false` | `false` | `failed` |

A simulated dispatch is **never** reported as a real call. That is also why it is audited as
`failed`: `sent` would claim a call went out, and for a simulated dispatch nobody was actually rung.
The cost is that a simulated attempt is indistinguishable from a genuine Twilio rejection in the
contact list — see the contracts gap below.

## The spoken text

### Coordinator (task 1) — the one phrase this lane added

`voice/telugu.ts` renders *farmer-facing* messages keyed by `Contact.purpose`, a vocabulary with
nothing to say to a coordinator about an approval queue. This lane must not edit `src/voice/**`
(another lane owns it), so the coordinator line is a clearly-named constant pair owned by
`coordinator-alert.ts`:

```
COORDINATOR_REQUEST_TE
  నమస్కారం, జడల్ కాలువ కార్యాలయం నుండి కాల్. {farmer} గారు {volume} ఘన మీటర్ల నీటి కోసం
  అభ్యర్థన పెట్టారు. కారణం: {reason}. ఈ అభ్యర్థనకు మీ ఆమోదం కావాలి.
  ఆమోదించడానికి వన్ నొక్కండి, తిరస్కరించడానికి టూ నొక్కండి.

COORDINATOR_REQUEST_EN
  Hello, this is the Jadal canal office calling. {farmer} has raised a request for {volume}
  cubic metres of water. Reason: {reason}. This request needs your approval.
  Press 1 to approve, or press 2 to reject.
```

`{volume}` is formatted by `formatVolumeM3` — the same formatter the farmer templates use, so the
number the coordinator hears is the number the farmer typed. `{reason}` is spoken verbatim because
it is the farmer's own words (or the transcript of them).

### Farmer (task 2) — composed from what already exists

No new farmer-facing phrase was introduced. The message is `templateForPurpose("request_update", …)`,
so the sentence a farmer hears on the allocation call is the same sentence the existing Telugu
templates already produce for a decided request. The text below is **captured from a real run** of
`notifyFarmerOfAllocation` against the seeded scenario — farmer `f1` (`Ramaiah Kota`), a granted
120 m³ over the seeded `rw1` window (`00:30Z`–`00:30Z` = `06:00`–`06:00` IST):

```
message_te  జడల్: మీ నీటి అభ్యర్థన స్థితి. నమస్కారం Ramaiah Kota గారు, స్థితి: approved. మీరు
            అభ్యర్థించిన పరిమాణం 120 ఘన మీటర్లు. ఎప్పుడు పొందుతారో అయితే: 06:00 నుండి 06:00 వరకు.
            వివరాలకు మా కాలువ కార్యాలయాన్ని సంప్రదించండి.

message_en  Jadal: status of your water request. Hello Ramaiah Kota, Status: approved.
            You asked for 120 cubic metres. Expected release: from 06:00 to 06:00 IST.
            Contact the canal office for details.
```

And the coordinator line, for the same farmer raising a 40 m³ urgent request:

```
message_te  నమస్కారం, జడల్ కాలువ కార్యాలయం నుండి కాల్. Ramaiah Kota గారు 40 ఘన మీటర్ల నీటి కోసం
            అభ్యర్థన పెట్టారు. కారణం: urgent 40 m3 needed. ఈ అభ్యర్థనకు మీ ఆమోదం కావాలి.
            ఆమోదించడానికి వన్ నొక్కండి, తిరస్కరించడానికి టూ నొక్కండి.

message_en  Hello, this is the Jadal canal office calling. Ramaiah Kota has raised a request for
            40 cubic metres of water. Reason: urgent 40 m3 needed. This request needs your approval.
            Press 1 to approve, or press 2 to reject.
```

Two deliberate choices:

- **The granted volume, not the asked-for volume.** The call is given `event.volume_m3` — what the
  coordinator actually approved — so a partial grant is read out as the partial number.
- **The status is pinned to `approved`**, because this call only ever goes out for a granted
  allocation.

## Audit trail (task 3)

`packages/contracts`' `JadalEvent` has no `notification.*` variant, and contracts are immutable
without the orchestrator's `contracts-ok` label, so **nothing is invented**. Each attempt appends
**one `contact.updated` event** through `appendEvent`, carrying a real `Contact` row for the person
who was rung — exactly the idiom `telephony-deps.ts` and `campaigns/escalation.ts` already use. The
actor is `{ kind: "agent", id: "caller" }`, matching the escalation ladder.

The order is deliberate: **dial first, audit second.** A `contact.updated` row means "we tried to
ring this person", so writing it before the dispatch would put a call in the audit trail that never
happened. A crash between the two leaves an unlogged call, which is the safer of the two lies for a
surface a coordinator reasons about.

The row is re-readable through the ordinary contacts projection (`GET /api/contacts`), which is what
makes it visible in the coordinator's audit view.

### Contracts gap (reported, not papered over)

`Contact` has no field for:

- the recipient's phone number,
- the Twilio `CallSid` (already a known gap noted in `telephony-deps.ts`),
- the spoken text of a *coordinator* call (`message_te` exists but is typed as farmer-facing),
- **whether the call was simulated**.

The last one is the one this lane newly exposes: it forces a simulated dispatch to be recorded as
`failed`, which is honest but indistinguishable from a real Twilio rejection. The clean fix is an
additive contracts change — a `notification.attempted` event carrying `{ to, simulated, callSid,
purpose, request_id }`, or a `Contact.simulated` boolean. **This lane did not take that decision**;
it needs `contracts-ok`.

## Environment

| Name | Required | Purpose |
| --- | --- | --- |
| `COORDINATOR_PHONE` | for the coordinator call | E.164 number phoned when a request is raised. Unset ⇒ clean no-op. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `PUBLIC_BASE_URL` | for any real call | Incomplete set ⇒ `{ simulated: true }`, no fetch. |
| `REAL_TELEPHONY` | optional | `0`/`false` forces simulated mode even with a full credential set. |
| `TWILIO_FORWARD_TO` | optional, demo only | Redirects the *destination* (honoured inside `placeCall`). **During a demo the coordinator's approval call rings the forwarding number, not `COORDINATOR_PHONE` itself.** |

Never commit values; `.dev.vars` is gitignored and only `.dev.vars.example` (names only) is tracked.

## Tests

`apps/api/src/coordinator-alert.test.ts` — 20 tests. **No real call can be placed from it**: every
test drives `test/harness.ts`'s `createEnv()`, whose injected `fetch` throws on any URL that is not
explicitly routed, and the Twilio endpoint is a canned `Response`. The offline case asserts
`env.calls.length === 0`; the failure case asserts the only call made was the mocked `api.twilio.com`
one.

Covered: exactly one coordinator notification per raised request; no notification and no contact when
`COORDINATOR_PHONE` is unset; a Twilio 401 does not fail the request; a throwing notifier does not
fail the request; the composed Telugu/English allocation text; the granted (not asked-for) volume;
no call on a rejection; one `contact.updated` per attempt; the simulated/real distinction including
the `REAL_TELEPHONY=0` kill switch.

## Running it

```bash
pnpm --filter api typecheck
pnpm --filter api test
```

To exercise the real path locally, set `COORDINATOR_PHONE`, the four Twilio variables,
`REAL_TELEPHONY=true` and — while developing — `TWILIO_FORWARD_TO` to a handset you control. Do not
place calls to farmers' numbers while developing.
