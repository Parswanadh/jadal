# Jadal — 3-minute pitch outline

> Placeholder-first (C8). Routes (`/farmer`, `/coordinator`, `/canal`,
> `/phone`, `/demo`) and the preview URL below are placeholders until C1–C7
> land. Demo beats follow `packages/contracts/fixtures/demo-scenario.json`
> (`demo_script` steps 1–6) and `docs/problem-statement.md`.
>
> Preview (placeholder): `https://demo.jadal.example.com`
> (local: `http://localhost:5173`). Set `$env:BASE_URL` before presenting.

Total: **180 seconds**. Times are hard caps — if a beat slips, cut to the
next `▶` cue, never steal from the close.

## 0:00–0:20 — Hook: "everyone got their hours" (20s)

Say (presenter):

> "On this canal, everyone received their allotted hours — and the tail-end
> farmer still lost her crop. Hours are not water."

Show: `/canal` hero visual (equal-hours mode). Point at tail outlets o7/o8:
~42% of need met vs head outlets near 100%.

Speaker note: name the case, not the tech. One sentence on warabandi:
a fixed weekly time roster that assumes one hour waters every field equally.

## 0:20–0:50 — Problem in three failures (30s)

Three one-liners, one finger each:

1. **Hours ≠ water.** Seepage + travel lag mean a tail hour delivers far less
   than a head hour — the register still says "fair".
2. **Needs are invisible.** Crop, stage, soil, rain and urgency have no fair
   way into a fixed roster.
3. **Changes miss people.** One chat group, no acknowledgement; night releases
   arrive unwarned; the register records time, not delivered volume.

Speaker note: land problem-statement §"Allocation and records are in hours,
but crops need usable water delivered at the field gate."

## 0:50–1:10 — Solution principle (20s)

> "LLMs propose, the deterministic core decides the numbers, the coordinator
> approves. Every litre is computed by tested code; every change is an
> acknowledged event in a volume ledger."

Show (no click-through yet): `/demo` event-log strip + ledger invariant line:
`supply = quotas + buffer + delivered + losses`.

▶ Cue: "Here is what that looks like on one canal with eight farms."

## 1:10–2:20 — Live demo, three beats (70s)

Seed: Kondaveedu Minor, 8 outlets, 8 farmers (f5/f8 voice-only, no
smartphone). If the preview is down, say so in one sentence and switch to
the backup video — do not debug on stage.

**Beat 1 (25s) — Equal water, not equal hours.** On `/coordinator`, toggle
`equal_hours → equal_water` for release window rw1. Tail o7/o8 jump from
~42% to >90% need met; Gini of need-met falls. One line:
"Same water, longer tail turns — because the model converts volume into
time with the flow that actually reaches each outlet."

**Beat 2 (25s) — Urgency without force.** On `/phone`, play the Telugu
urgent request (f1, head, rice flowering) → agent triage + recommendation →
on `/coordinator`, approve; note the deduction from f1's future quota.
"The extra water is granted — and subtracted. No more free overruns."

Telugu line (read or play, ~5s): «నాకు ఈ వారం అత్యవసరంగా నీరు కావాలి.»
("I urgently need water this week.")

**Beat 3 (20s) — Nobody is missed.** Roster re-plan fans out on
`/coordinator` → contacts queue: voice + WhatsApp for most, **voice-only**
for f5/f8; night-release rule (18:00–06:00) adds a warning call 1 h before.
Acknowledgements tick in on `/phone` + `/demo`. "A change is valid only
after acknowledgement."

## 2:20–2:45 — Proof it is fair (25s)

On `/demo` or `/coordinator` ledger panel:

- Conservation holds: supply = quotas + buffer + delivered + losses.
- Unused/post-harvest quota pooled to a public buffer; buffer grants are
  visible and coordinator-approved.
- Plain-language summary in Telugu + English (auditor agent).

One line: "The register used to show hours. Ours shows volumes — so
disputes can be settled, not shouted."

## 2:45–3:00 — Close (15s)

> "Jadal turns a fixed-hour roster into fair water: crop need in, canal
> physics applied, rain and urgency handled, every farmer acknowledged —
> even without a smartphone. Thank you — questions."

Hold on `/canal` equal-water view. QR/URL card: placeholder preview URL.

## Fallback lines (use verbatim, keep moving)

- Preview down at start: "The live preview is unreachable, so this is the
  3-minute backup recording of the same six demo steps — same seed, same
  routes."
- Mid-demo stall: "I will not debug on stage — this screenshot is the same
  screen, and the ledger invariant still holds. Moving on."
- Audio fails on Telugu line: read the transliteration + translation above;
  do not replay more than once.

## Timing discipline

- 1:10 checkpoint: must be starting Beat 1. If late, drop failure #2 detail.
- 2:20 checkpoint: must be on "Proof". If late, drop Beat 3 detail, keep
  "valid only after acknowledgement".
- Never skip the close. Cut Beat 2 detail before cutting proof or close.

## Click path (placeholder routes, in order)

1. `/canal` (equal-hours hero) → 2. `/coordinator` (roster compare, approve) →
   3. `/phone` (Telugu request + acks) → 4. `/demo` (event replay + ledger) →
   close on `/canal` (equal-water).
