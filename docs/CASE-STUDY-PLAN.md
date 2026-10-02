# Jadal case study — plan

Audience: judges and evaluators at the presentation. Deck: http://127.0.0.1:5190/deck/ (source `showcase/deck/index.html`). Word-for-word script: `docs/SPEAKER-SCRIPT.md`.

Evidence labels used throughout: **RAN** (a command was run and its output observed), **READ** (read in a file), **COMPUTED** (arithmetic checked), **MODELLED** (output of the scenario's model, not a field measurement).

## 1. What the case study is

**One question:** when every farm on a canal gets the same number of hours of water, does every farm get the same water?

**The setting:** a demo scenario modelled on the Kondaveedu Minor command in Andhra Pradesh: a 3 km unlined earthen canal with 8 farm outlets (READ: `packages/contracts/fixtures/demo-scenario.json`). The numbers are model outputs. They are not gauge readings, and the deck says so on the slides where they appear.

**The claim we make:** under equal hours the tail of the canal gets materially less water per hour of turn than the head, so a time-based register can call an unequal outcome fair. Sharing by volume, with each farm's time solved from the flow that actually reaches it, removes that gap in the model.

**What we do not claim:** that the model matches field conditions. Calibrating the seepage model against gauge data is the next step, not something done.

## 2. Warabandi

- **Wara** is turn; **bandi** is fixing. A rotation in which each farm receives the canal outlet for a fixed time slot on a fixed weekly roster. It is used across Indian canal irrigation.
- **Why it lasts:** it is simple and easy to audit. Anyone can check the register against a clock.
- **On this canal:** every farm gets equal hours (READ: handoff §1).
- **What it records:** time. It does not record water. That is the gap the case study is about.

## 3. The problem, with evidence

| Claim | Value | Label | Source |
|---|---|---|---|
| Reach, outlets, lining | 3 km, 8 outlets, unlined | READ | `demo-scenario.json` |
| Flow model | Q(x) = Q₀·e^(−kx), Q₀ = 0.15 m³/s, k = 0.00012 per m | READ | `demo-scenario.json` (`seepage_k_per_m`), `packages/core/src/hydraulics.ts` |
| Flow at outlet 1 (300 m) | 0.1447 m³/s, 3.5% lost | COMPUTED, MODELLED | re-derived: 0.15·e^(−0.036) = 0.1447; loss 3.54% |
| Flow at outlet 8 (2900 m) | 0.1059 m³/s, 29.4% lost | COMPUTED, MODELLED | re-derived: 0.15·e^(−0.348) = 0.1059; loss 29.39% |
| Tail water per hour of turn, relative to head | about 0.73 | COMPUTED | 0.1059 ÷ 0.1447 = 0.732 |
| Tail turn needed to match head volume | about 1.37× | COMPUTED | 0.1447 ÷ 0.1059 = 1.366 |

The ratio and the 1.37 are arithmetic on the two modelled flows. They are shown on the slide with their derivation. They are not independent findings.

## 4. How Jadal addresses it

1. **Estimate need.** Each farm's weekly volume Vᵢ comes from a crop-water model (FAO-56 style) with weather and rain.
2. **Solve for time.** The deterministic core turns each volume into a turn length, **Tᵢ = Vᵢ ÷ Q(xᵢ)**, using the flow that reaches the outlet after seepage. The tail's turn runs longer.
3. **Approve.** A coordinator approves the roster before it is released. Other paths also place calls (coordinator alerts, the escalation ladder); every one of them goes through a single rate-limited call function (READ + RAN: `apps/api/src/placecall-guard.test.ts`). We have not verified that every path is approval-gated, and who may approve is not yet enforced by the server.
4. **Tell the farmer.** A caller agent phones farmers in Telugu. A double-entry ledger records every cubic metre and is checked for conservation.

**The governing principle, enforced in code:** LLMs propose, the deterministic core computes, the coordinator approves.

- Tools in `packages/contracts/src/agents.ts` carry `gated: true|false`; a gated tool returns a proposal (READ).
- `apps/api/src/agents/loop.ts` records the proposal and never applies it (READ).
- Water arithmetic lives only in `packages/core` (handoff §2, rule 2).

**Note on the toggle slide:** "equal volume" in the toggle illustrates equal need. In the product, each farm's volume comes from its own crop need, and the core then solves for time.

## 5. What we can show that is measured

| Item | Result | Label |
|---|---|---|
| Typecheck | clean across contracts, core, web, api | RAN, `pnpm -r typecheck`, rc 0 |
| Tests | 862 passed (core 180, web 114, api 568) | RAN, `pnpm -r test`, rc 0, merged swarm branch |
| Call rate limit | at most 3 calls per 60 s per handset; sliding window; 12 simultaneous requests still yield 3 | RAN, `apps/api/src/noloop.test.ts` |
| Only one route can dial | static guard test fails on a planted bypass | RAN, `apps/api/src/placecall-guard.test.ts` |
| i18n parity | 605 keys each, English and Telugu | RAN, key-count script |
| Planned need-met on the seed, equal hours | 280.8% head, 205.5% tail, Gini 0.059 (over-allocation) | RAN, `packages/core/src/roster-planned.test.ts` |

Caveat: the 862 figure was measured on the merged branch before one later web display change; that change passed its own typecheck and tests. Nothing here is merged into the live branch.

## 6. Talk track (6 to 8 minutes)

Full speaker script with stage cues: `docs/SPEAKER-SCRIPT.md`; second-screen reader: http://127.0.0.1:5190/deck/speaker-script.html. The table below is **generated** from `showcase/deck/script.json` by `showcase/deck/build.py`, so the slide numbers and times cannot drift from the deck. Times are computed from word counts, not rehearsed.

The deck is 13 slides. Two former slides, *What we caught in our own work* and *What is still simulated or open*, and the closing slide were removed from the deck. Their substance is still spoken: it is in the notes of slide 13 and in the speaker script's *If asked* section, and the section 5 and 9 tables of this document hold the evidence.

<!-- TALK-TRACK:START -->
| Slide | Beat | Standard | Architect |
|---|---|---|---|
| 1 Title | One question; everything numeric is labelled | 0:31 | 0:24 |
| 2 The place | 3 km, 8 outlets, unlined; demo data, not gauges | skip when short | skipped |
| 3 Warabandi | Wara and bandi; equal hours; the register records time | 0:29 | 0:15 |
| 4 Hours are not water | 0.145 vs 0.106 m³/s; 3.5% vs 29.4%; about 0.73 | 0:32 | 0:22 |
| 5 Hours or water | Click Equal volume: the tail's turn stretches about 1.37× | 0:33 | skipped |
| 6 Our answer | Tᵢ = Vᵢ ÷ Q(xᵢ) | 0:30 | 0:18 |
| 7 FAO-56 to cubic metres | One week of flooded rice, run on the shipped crop table: 643.75 m³ per hectare | 0:37 | 0:39 |
| 8 Who decides | Propose, compute, approve; code evidence; sign-in gap named | 0:33 | 0:32 |
| 9 Two speeds of thinking | System 1 classifier chain laya → jev → rules; System 2 gated agent loop; which is live | 0:38 | 1:46 |
| 10 How it stays trustworthy | Trust boundaries, controls, and the 'not built yet' strip | 0:33 | 1:30 |
| 11 The product | Coordinator console and farmer view; demo data | 0:22 | skipped |
| 12 Voice and ledger | Optional; caveats stated first | skip when short | skipped |
| 13 Launch film | Play about 54 s; say nothing over it | 1:06 | skipped |
| 14 What we measured | 862 tests; 3 per 60 s; one route; 605 keys | 0:33 | 0:12 |
| 15 Path to field telemetry | Roadmap, not built; closing line; open items and what we caught are spoken, not shown | 0:27 | 1:47 |
| 16 Appendix: crop data we ship | Generated from crop-params.json: 10 crops in 11 rows, each field tagged; the explorer lists every crop we hold | appendix | appendix |
| **Total** | computed at 145 wpm, plus fixed seconds and pauses; not rehearsed | **7:24** | **7:45** |
<!-- TALK-TRACK:END -->

Short versions (30 s and 2 min) are in the script file.

## 7. Questions to expect, and honest answers

**Is the seepage measured?** No. It is the scenario's decay model with a fixed constant. The numbers are modelled. Gauge calibration is the next step.

**Why not just lengthen the tail's time by a fixed factor?** The right factor depends on where the outlet sits, how much has seeped by then, and what each farm needs. The core solves it per outlet from the flow that reaches it.

**Can the language model change a number?** It cannot apply an action. A gated tool only returns a proposal, and the water arithmetic is outside the model, in `packages/core`. We have not red-teamed prompt injection, so we do not claim resistance beyond that.

**What if the coordinator disagrees?** They can reject a request or edit a turn time. The handoff records both as verified: the turn-time editor saves, a backwards interval is refused with a 400, and the reject path is covered by the live e2e (handoff §4).

**Does it actually phone farmers?** In testing, real Twilio calls connected and were answered (3, 13 and 20 s calls, handoff §4). The account is a trial with a $0 balance and the quota cut out once mid-session, so we do not call live calls demo-reliable.

**Do SMS and WhatsApp work?** No. The API accepts them and records them as simulated. No transport exists, and the interface now says so.

**Is the Telugu native-reviewed?** No. It is machine-written. A 680-row review pack with automatic flags is ready for a native speaker.

**Why do you not claim the tail meets 42% of its need?** The original handoff quoted it. Core does not reproduce it: on the seed, planned need-met is 280.8% at the head and 205.5% at the tail. The 42% came from an illustrative mock formula.

**Why is equal volume not simply better in your own test?** On the raw season-scaled seed, `equal_water` starves the tail, because the whole season supply is spread across one week's plans. That is a product decision about weekly versus seasonal entitlement, and it is listed as open.

**What would you do with funding or more time?** Fund the telephony account; get a native Telugu review; calibrate the seepage model against gauge readings; settle the groundnut table value; ship the two contract changes.

## 8. Claims we will not make

- That the tail meets any specific percentage of its need (the 42% and 90% figures are refuted or unverified).
- That a Gini figure shows fairness in the live path.
- That the groundnut worked example of 462.12 m³ reproduces (the shipped table gives 417.69).
- That SMS or WhatsApp messages are sent.
- That live phone calls are reliable for a demo.
- That the Telugu copy is native-reviewed.
- That the flows are field measurements.
- Any ledger figure. The ledger is shown qualitatively; invented ledger numbers were removed from an earlier video.

## 9. Known open items (from the build)

| Item | State |
|---|---|
| Groundnut doc (462.12) vs shipped table (417.69) | ADR written, **needs owner decision**: `docs/decisions/ADR-groundnut-worked-example.md` |
| `equal_water` on the raw season seed starves the tail | product decision, `docs/ops/swarm/gini-planned.md` |
| Contract changes (WeatherDay climate inputs, `place_call` gating, `planned_pct`/`delivered_pct`) | proposals written, wait on `contracts-ok` |
| Unscored triage shows a low-urgency pill | small web change not yet made |
| Workflow audit F4/F5 ("alert the coordinator" does not alert; fixed 15-minute gap) | open: `docs/research/workflows-audit.md` |
| Mock-mode screens show illustrative need-met bars that core does not produce | do not present the `/canal` need-met bars as results |
