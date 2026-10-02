# Evaluator brief — Harsha Joshi

Evaluator profile (as supplied by the user, not independently checked): Senior Technical Fellow and Chief Architect, Connected Car Division, Stellantis. 25+ years at SAP, Nokia, Intel, PayPal, McAfee and Stellantis. Cloud, IoT, distributed systems, cybersecurity, AI. 20+ patents in IoT and cybersecurity. Systems for millions of users. Hands-on farmer outside work.

Everything below is inference from that bio, labelled as such. Nothing here is known about his views of this project. The aim is substance he can verify, not flattery.

Companion files: deck http://127.0.0.1:5190/deck/ · second-screen script http://127.0.0.1:5190/deck/speaker-script.html (press **A** for the architect cut) · `docs/SPEAKER-SCRIPT.md` · `docs/CASE-STUDY-PLAN.md`.

## 1. One-page read

**What he will probe (inference).** A connected-vehicle and IoT architect thinks in trust boundaries, device identity, telemetry integrity, over-the-air updates, failure modes and fleet scale. Expect him to ask where the trust boundary sits, who can make the system do something irreversible, what happens when a dependency fails, whether the data can be trusted, and how it behaves when connectivity is poor. A security background makes authentication, audit integrity, secrets and privacy near-certain questions.

**What will earn respect.**
- Boundaries enforced in code, not in prose, with the file to point at.
- Failure handled on purpose: a kill switch, fail-closed webhooks, an atomic limiter, a fallback that labels itself.
- Our own errors, found by us and stated first. This is no longer a slide: say it aloud from the notes of slide 13 or the speaker script's *If asked* (the refuted 42% claim, the Gini that was 0, the constant triage score, the QA pass that approved invented ledger figures). It is the strongest material, so do not let it drop out of the talk.
- A clear line between modelled, built and roadmap, with no blur.
- Admitting the gaps before he finds them. He will find them quickly.

**What will lose it.**
- Calling modelled flows "measured", or claiming anything about field telemetry that does not exist.
- "Secure" or "scalable" without evidence. We have no load test and no server-side authentication.
- AI-hype framing. The model proposes; the point of the design is that it cannot act.
- Pretending farming expertise. We modelled a canal; we have not farmed one.
- Quoting a number that is on the forbidden list (section 6).

**The three things he is most likely to find on his own, so say them first:**
1. **There is no server-side authentication.** The role gate is client-side by design (`apps/web/src/auth/session.ts` header says so). The approve route stamps a fixed coordinator identity (`apps/api/src/routes/write.ts:57`, route at `:417`). The demo reset and advance routes (`packages/contracts/src/api.ts:140-141`) have no authentication either. (READ; absence of any 401/403 or auth middleware in `apps/api/src` confirmed by grep.)
2. **The event log is append-only by convention, not tamper-evident.** The schema comment says nothing updates or deletes a row, but there are no database triggers and no hash chain (READ `apps/api/src/db/schema.sql.ts`; grep for TRIGGER and hash found none).
3. **There is no telemetry.** Every flow is modelled from the seed.

## 2. Tailored plan

### (a) Opening framing

Lead with the farmer's reality, not the technology. In his own words in the bio he is a hands-on farmer, so a tail-end outlet is familiar. Do not say "as a farmer yourself". Say the problem plainly and let him recognise it:

> If you have irrigated from a tail-end outlet, you know the problem: your hours arrive and the water is thin. We have not farmed this canal; we modelled it.

This is already the opening line of the architect cut. Then move quickly: the interesting part for this audience is that the system decides who gets irreversible effects (calls, ledger entries) and how it stays trustworthy while doing it.

### (b) Architecture points to land (6)

| # | Point | What it is | Evidence to point at |
|---|---|---|---|
| 1 | **Trust boundary at the model** | LLM output is a proposal. Tools carry `gated`; a gated tool returns a proposal and is never applied by the loop | READ `packages/contracts/src/agents.ts` (`gated`), `apps/api/src/agents/loop.ts:9` ("is never applied. The loop does not commit anything itself") |
| 2 | **One function can dial** | A static test scans the source and fails on any other route to `placeCall`. Shown failing on a planted bypass | RAN `pnpm --filter api exec vitest run src/placecall-guard.test.ts` (5 tests passed, observed); `docs/ops/swarm/placecall-guard.md` |
| 3 | **Bounded and stoppable** | At most 3 calls per 60 s per handset: a sliding window consumed in one atomic SQL statement; 12 simultaneous requests yield exactly 3. `REAL_TELEPHONY=false` stops all dialling with no deploy | RAN `src/noloop.test.ts` (49 tests passed, observed, with `placecall-guard`: 54 passed); READ `apps/api/src/noloop.ts` header; `docs/ops/CALL-SAFETY.md` |
| 4 | **Audit trail that cannot half-write** | `appendEvent()` writes the event, every projection and every double-entry ledger row in one `db.batch()`, which D1 commits or rolls back whole. The ledger checks a conservation invariant | READ `apps/api/src/db/store.ts:4-10`, `packages/core/src/ledger.ts` (invariant near `:418`). Caveat: no hash chain |
| 5 | **Provenance on every result** | `System1Result.source` is one of `jev`, `laya`, `rules`; call results are a union with `simulated: true` or `simulated: false`. A fallback is never reported as a model call | READ `packages/contracts/src/agents.ts:39`, `apps/api/src/telephony/types.ts:153-154` |
| 6 | **A pure, offline-capable core** | `packages/core` has no network, no I/O and no model calls. Its only dependency is the contracts package | RAN `grep -rn "fetch(\|process\.env\|Date\.now()\|XMLHttpRequest" packages/core/src --include=*.ts \| grep -v "\.test\.ts" \| wc -l` returned **0**; READ `packages/core/package.json` |

Supporting, one line each: Twilio webhooks fail closed (a missing token or base URL, or a bad signature, returns 403; `SKIP_TWILIO_SIGNATURE` is local-only; READ `apps/api/src/telephony/webhook.ts:48-55`). Secrets: `.dev.vars` is gitignored and no `.dev.vars` file was ever added on any branch (RAN `git log --all --diff-filter=A --name-only --format= | grep -c "\.dev\.vars$"` returned **0**). Tests stub the network so an accidental real call fails loudly (handoff §7).

**Be precise about point 1.** The honest claim is "a model cannot apply an action", and "every outbound call passes one rate-limited function". It is **not** "nothing reaches a farmer without approval". Contact events are appended from at least nine call sites (coordinator alerts, agent tools, and the night-release, rain and escalation campaigns; READ by grep of `type: "contact.updated"`), and we have verified the single call function, not that every path is approval-gated. The app's own headline copy ("Nothing reaches a farmer until you do") is broader than what we have verified; do not quote it as a guarantee.

### (c) The honest gap he will ask about: no telemetry

**Say:** flows are modelled from the seed with a fixed decay constant (Q(x)=Q₀·e^(−kx), Q₀=0.15 m³/s, k=0.00012 per m). They are not gauge readings. No telemetry feed, device, or fleet exists.

**Then give a credible next step, labelled roadmap, not built** (this is slide 13, the last slide, and the telemetry part of the architect cut):
1. Flow gauge at each outlet.
2. Reading signed on the device (device identity and signed telemetry).
3. Edge buffer, offline-first, because rural connectivity is patchy.
4. Compare each reading with the model, flag drift, alert the coordinator on divergence. This is also the first defence against a faulty or spoofed sensor.
5. Core change needed: a measured-flow input beside the modelled one. Today `packages/core` derives Q(x) from the model constants.
6. After a pilot: device fleet management and over-the-air updates. Not before.
7. A pilot must answer: gauge accuracy, tamper and spoofing resistance, connectivity, who owns and maintains the devices.

Do not claim the architecture "already supports" any of this. The honest framing is: the core is pure and takes its inputs as arguments, so a measured input is a contained change, and the pilot questions above are open.

### (d) Hard questions and honest answers

| # | Question | Honest answer | Point at |
|---|---|---|---|
| 1 | Who is allowed to approve? Is there authentication? | Not on the server. The role gate is client-side by design in this build; the approve route records a fixed coordinator identity. Approval is a required workflow step but who may perform it is not enforced. First hardening item: server-side identity, roles and per-user audit | `apps/web/src/auth/session.ts` (header comment), `apps/api/src/routes/write.ts:57,417` |
| 2 | Can the model make the system do something? | It cannot apply an action. Gated tools return a proposal; the loop never commits. All water arithmetic is in a pure core. Every outbound call passes one function that a static test enforces | `packages/contracts/src/agents.ts`, `apps/api/src/agents/loop.ts:9`, `placecall-guard.test.ts` |
| 3 | Prompt injection through a farmer's request text? | System 1 only classifies and scores a request; the file header says it never decides water. The agent tools that act are gated. We have **not** red-teamed prompt injection, so we cannot claim resistance, only that the model's output is a proposal | `apps/api/src/routes/write.ts:9-13`; say plainly that no adversarial test has been run |
| 4 | What if the model provider is down or wrong? | System 1 is a chain: Laya, then Jev, then keyword rules. Each result says which one ran. Laya is trusted for intent only; urgency and release-time are discarded in code. Fallback paths are tested with a stubbed network (502, timeout, malformed body) | `apps/api/src/system1.ts`, `system1.test.ts`, `docs/research/laya-verdict.md` |
| 5 | Failure modes of telephony: runaway or duplicate calls? | Limit of 3 calls per 60 s per handset (atomic, sliding); retry cap; kill switch `REAL_TELEPHONY=false`; a workflow audit found and fixed an unvalidated retry ceiling. Known gaps: the limit is per handset, so a roster walk still places one call per farmer | `docs/ops/CALL-SAFETY.md`, `docs/research/workflows-audit.md` (F1, F2 fixed) |
| 6 | Can I trust the data and the ledger? | Event, projections and ledger rows commit in one D1 batch, and the ledger checks conservation (debits equal credits). But the log is append-only by convention, with no hash chain, so it is not tamper-evident | `apps/api/src/db/store.ts:4-10`, `packages/core/src/ledger.ts` |
| 7 | Sensor spoofing? | There are no sensors yet, so no spoofing surface exists today. The roadmap: signed readings, plausibility checks against the model, alert on divergence. All unbuilt | slide 13 |
| 8 | Model drift and model correctness? | The flows are modelled with a fixed constant, so there is no drift detection until there is measurement. The crop table is partly unsourced: stage lengths and a rice depletion value are project values, one row cited a page that does not exist, and the groundnut worked example disagrees with the shipped table. All tagged, none hidden | `docs/research/crop-params-provenance.md`, `docs/decisions/ADR-groundnut-worked-example.md` |
| 9 | Privacy of farmers' phone numbers? | Stored in plain text in the database; the limiter is per handset. No masking, encryption, consent record or retention policy exists yet. Fixtures use fake numbers; real demo numbers live only in a gitignored `.dev.vars`. That must be solved before real farmers are loaded | `apps/api/src/db/schema.sql.ts:87`, `.gitignore:31-32` |
| 10 | Dependence on one telephony provider? | Yes: Twilio only, currently a trial account with a $0 balance, so live calls are not demo-reliable. The kill switch degrades to simulated mode, not to another provider. A second channel is a transport addition | `docs/HANDOFF-ENGINEERING.md` §5 P1 |
| 11 | Why not just send the schedule as an SMS? | SMS is not sent today (no transport exists, and Twilio blocks SMS to India on a trial). The value is the allocation, the approval and the audit; the delivery channel is replaceable, and SMS is a reasonable first transport. Voice was chosen because some farmers have no smartphone and calls can be acknowledged | `apps/api/src/alerts.ts` (returns simulated), `phone.png` (2 of 8 demo farmers have no WhatsApp) |
| 12 | Does it scale to many canals and millions of users? | We have not measured scale and have no load test (grep found none). The schema has a `canal` table so another canal is more rows, but we have run one demo canal on D1. We will not quote a number | `apps/api/src/db/schema.sql.ts` (canal table comment) |
| 13 | Secrets handling? | `.dev.vars` is gitignored; no `.dev.vars` file was ever added on any branch (observed 0). The web sign-in uses non-secret default passwords in the client bundle; that is a demo gate, not a secret store | `.gitignore:31-32`, `apps/web/src/auth/session.ts` |
| 14 | Offline and patchy connectivity? | The core is offline-capable in principle (no I/O, observed 0 network or env reads). The system as built is cloud-hosted and has no offline mode or edge deployment. Edge buffering is the roadmap | `packages/core`, slide 13 |
| 15 | What would you harden first? | In order: server-side identity and roles with per-user audit; locking down the demo routes; a hash-chained or signed event log; masking and consent for phone numbers; then a gauge pilot with signed telemetry. Answer this one directly; it shows you know the list | slide 8's "Not built yet" strip and the closing notes on slide 13 |

### (e) What NOT to say

- That live phone calls are reliable (trial account, $0 balance, quota cut out once).
- That SMS or WhatsApp work (they are simulated; nothing is sent).
- Any need-met percentage for the tail (the "42%" and ">90%" figures are refuted or unverified), or any Gini figure as a product result.
- That the groundnut 462.12 m³ example reproduces (the shipped table gives 417.69).
- That the Telugu copy is native-reviewed (it is machine-written).
- That the flows are measured, or that any telemetry, device, fleet or OTA capability exists.
- Any scale, latency or throughput number. None has been measured.
- That the system is "secure". Say what is enforced and what is not.
- That nothing reaches a farmer without approval, or that "a human approves" in a way the server enforces (it does not).
- That prompt injection is handled (not tested).
- Anything about the evaluator you cannot source from the supplied bio, and any flattery.

### (f) Three questions to ask him at the end

1. "In field deployments of flow gauges or other telemetry, what has been hardest to keep trustworthy: device identity, signing, or keeping readings consistent when connectivity drops?"
2. "Where do you draw the trust boundary when a component that proposes actions, like a model, sits next to one that carries them out? What do you enforce in code versus in process?"
3. "If you had one week to harden this before a pilot, what would you do first?"

Take the answer to question 3 seriously and write it down. It is the most useful thing the evaluator can give.

## 3. What is spoken but not on a slide

The deck no longer has slides for what we caught or for what is still open. Both are in the notes of slide 13 and in `docs/SPEAKER-SCRIPT.md` under *If asked*, and the architect cut recites the open items in one breath before the floor opens. Nothing remaining on a slide implies that live calls, SMS, WhatsApp or the Telugu copy are finished: slide 10 states the caveats first, slide 8 carries the "Not built yet" strip, and slide 13 is labelled roadmap.

## 4. Rehearsal checklist

- Run the architect cut once against the clock (computed 6:09; the standard cut computes to 6:32; neither has been rehearsed).
- Practise saying the three gaps (section 1) without softening them.
- Have the repo open in a second window at the files in section 2(b), and be ready to run the three commands marked RAN.
- Know where the two sentences are that you must not drift from: "a model cannot apply an action" and "every outbound call passes one rate-limited function".
