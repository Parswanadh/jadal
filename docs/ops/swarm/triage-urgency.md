# Triage urgency: stop reporting the rules floor as a score

**Lane:** `ws/swarm-triage-urgency` (`LANE_SCOPE=apps/api|docs`) · **Handoff item:** P2
**Contract changes:** none (`packages/contracts` untouched)

## Problem (READ)

`apps/api/src/system1.rules.ts` started every urgency score at `URGENCY_BASE = 0.15` and only added
on keyword hits. The seeded demo reasons are short English phrases, and the term tables were
predominantly Telugu, so an unmatched reason scored a flat `0.15` — a number that measured nothing.
`HANDOFF-ENGINEERING.md` §5 P2 records the same finding.

The handoff's wording mentions carrying the marker "through the existing fields
(source/confidence/reasons)". **`System1Result` has no `reasons` field.** Its fields are `intent`,
`intent_confidence`, `urgency`, `mentions_crop_stress`, `source`
(`packages/contracts/src/agents.ts:34`). The marker below is therefore encoded in the fields that do
exist.

## What changed

| File | Change |
|---|---|
| `apps/api/src/system1.rules.ts` | English term coverage for the seeded reasons; unmatched input returns an explicit unscored marker instead of `0.15`; new exported `isUnscored()` |
| `apps/api/src/system1.ts` | re-exports `isUnscored` (one line) |
| `apps/api/src/system1.rules.test.ts` | tests for matched, unmatched and English cases |
| `apps/api/src/coordinator-alert.ts` | comment only: the triage score is no longer a constant floor, but is still a keyword heuristic |
| `apps/api/docs/COORDINATOR-ALERT.md` | §"Severity is not derived from triage_score" updated to match |

### The unscored marker (no contract change)

When **no** term in any table fires (no intent, stress, distress, urgency, request or calm term),
`classifyByRules` returns:

```
intent: "other"   intent_confidence: 0   urgency: 0   mentions_crop_stress: false   source: "rules"
```

`isUnscored(result)` reads that combination back. It additionally requires `source: "rules"`, so a
model result that happens to carry those numbers is never reported as unscored. `URGENCY_BASE` is
still added for messages that matched *something* (so the pre-existing Telugu behaviour is
unchanged); it is never added to the unmatched path.

English coverage added for the reasons the demo seeds (`apps/web/src/api/mock.ts`
`MOCK_FIXTURE_TEXT` and `apps/web/src/i18n/en.json` `fixture.*`):

- severe: `leaves are rolling`, `leaves rolling`, `rolling in the heat`
- mild/growth stage: `tasseling`, `tasselling`, `flowering`, `drying out`, `drying up`
- request: `water needed`, `water is needed`, `short of water`, `short turn`
- urgency: `right away`, `as soon as possible`
- intents: `tasseling`/`tasselling`/`flowering` in `urgent_request`; `short turn`/`short of water`/`tail end` in `buffer_request`

## Evidence

### Before (RAN — pre-change file run as a temporary copy, then deleted)

```
$ git show 27a3b7e:apps/api/src/system1.rules.ts > apps/api/src/_oldrules.tmp.ts   # temp, deleted
$ pnpm --filter api exec vitest run src/_oldevidence.tmp.test.ts --maxWorkers=1
OLDEV "My maize is tasseling and the leaves are rolling in the heat." -> intent=other urgency=0.15 confidence=0.15
OLDEV "My field at the tail end got a short turn."                    -> intent=other urgency=0.15 confidence=0.15
OLDEV "Water needed for my crop."                                     -> intent=other urgency=0.15 confidence=0.15
OLDEV "I need water urgently, my paddy is flowering."                 -> intent=urgent_request urgency=0.4 confidence=0.65
OLDEV "hello there, how are you today"                                -> intent=other urgency=0.15 confidence=0.15
 Test Files  1 passed (1)   Tests  1 passed (1)
```

### After (RAN — same cases against the changed rules; temporary test, then deleted)

```
$ pnpm --filter api exec vitest run src/_evidence.tmp.test.ts --maxWorkers=1
EVIDENCE "My maize is tasseling and the leaves are rolling in the heat." -> intent=urgent_request urgency=0.55 confidence=0.65 stress=true unscored=false
EVIDENCE "My field at the tail end got a short turn."                    -> intent=buffer_request urgency=0.25 confidence=0.55 stress=false unscored=false
EVIDENCE "Water needed for my crop."                                     -> intent=urgent_request urgency=0.25 confidence=0.45 stress=false unscored=false
EVIDENCE "I need water urgently, my paddy is flowering."                 -> intent=urgent_request urgency=0.6  confidence=0.85 stress=true unscored=false
EVIDENCE "hello there, how are you today"                                -> intent=other urgency=0 confidence=0 unscored=true
EVIDENCE "ధన్యవాదాలు" (thanks; a *matched* calm message)                   -> intent=acknowledge urgency=0 confidence=0.45 unscored=false
 Test Files  1 passed (1)   Tests  1 passed (1)
```

The last two rows are the point: unmatched input is `unscored=true`, while a matched low-urgency
message is `unscored=false` with a distinct intent. The `0.15` floor no longer appears on either.

### Required test command (RAN)

```
$ pnpm --filter api exec vitest run src/system1.rules.test.ts src/system1.test.ts --maxWorkers=1
 ✓ src/system1.test.ts (56 tests) 119ms
 ✓ src/system1.rules.test.ts (23 tests) 20ms
 Test Files  2 passed (2)
      Tests  79 passed (79)
```

### Typecheck (RAN)

```
$ pnpm --filter api typecheck
$ tsc --noEmit          # exit 0, no output
```

### Coordinator-alert regression after the comment edit (RAN)

```
$ pnpm --filter api exec vitest run src/coordinator-alert.test.ts --maxWorkers=1
 ✓ src/coordinator-alert.test.ts (20 tests) 219ms
 Test Files  1 passed (1)   Tests  20 passed (20)
```

## What is NOT done / needs a human

1. **The unscored state does not survive persistence.** `request.triaged` in
   `packages/contracts/src/events.ts` requires `triage_score: z.number()`, so the event still carries
   `0` for an unscored result and the projection overwrites the raised request's value
   (`apps/api/src/db/projections.ts:380`). `WaterRequest.triage_score` is already optional
   (`entities.ts:201`), but the mandatory event field blocks a true null. Making persistence honest
   needs an additive contract change (below), which this lane must not apply.
2. **The coordinator UI is another lane.** It cannot distinguish `urgency: 0` from "unscored" yet.
   Until the contract/persistence carries the marker, render `intent: "other"` (and/or an absent
   `triage_score`) as "not scored", never as a measured zero. OWNER DECISION.
3. **`P3` (wire Laya) is the real fix for calibrated urgency.** Laya is trusted for `intent` only
   (`docs/research/laya-verdict.md`); it returns `null` for `urgency` by design, so the rules remain
   the urgency source even when Laya is wired. Keep the rules.
4. **Telugu/Gini etc.** untouched by this lane.

### Proposal (NOT applied) — additive contract change

```diff
 // packages/contracts/src/events.ts
-  z.object({ ...base, type: z.literal("request.triaged"), request_id: Id, triage_score: z.number(), intent: z.string() }),
+  z.object({
+    ...base,
+    type: z.literal("request.triaged"),
+    request_id: Id,
+    // Absent/null means the rules matched no signal: explicitly unscored, not a measured 0.
+    triage_score: z.number().min(0).max(1).nullable(),
+    intent: z.string(),
+  }),
```

That is the only change needed for the DB projection (`triage_score = ?`) to store `NULL` and for the
read path to surface "not scored". It needs the `contracts-ok` label and the orchestrator's
approval; this branch did not touch `packages/contracts`.

## References

- `docs/HANDOFF-ENGINEERING.md` §5 P2, §5 P3
- `apps/api/src/system1.rules.ts` (`isUnscored`, `unscored`, `scoreUrgency`)
- `packages/contracts/src/agents.ts:34` (`System1Result`)
- `packages/contracts/src/entities.ts:190` (`WaterRequest.triage_score` optional)
- `apps/web/src/api/mock.ts:33` and `apps/web/src/i18n/en.json:85` (seeded reasons)
