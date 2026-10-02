# voice-messages — swarm checkpoint

Lane: `ws/swarm-voice-messages` (`LANE_SCOPE=apps/api|docs`).

## What changed

1. **`docs/VOICE-MESSAGES.md`** — Comprehensive catalogue of every voice interaction in the Jadal system tailored to the Kondaveedu Minor canal case study (3 km unlined canal, 8 outlets, warabandi turns sized by equal volume rather than equal hours to compensate for canal seepage):
   - 15 situations documented with exact call sites (`file:line`), target listener (farmer vs. coordinator), variables used, English copy, Telugu copy, and spoken duration in seconds (all farmer messages <= ~25 s spoken).
   - Prominent disclaimer at the top stating that all Telugu copy is machine-written and NOT native-reviewed.

2. **`apps/api/src/voice/telugu.ts`** — Message builders tailored for Kondaveedu Minor:
   - Extended `MessageFacts` with optional `isLongerTurn?: boolean` and `isLongerThanBaseline?: boolean`.
   - Exported `whyLongerClauseTe` and `whyLongerClauseEn` explaining canal seepage in plain words: *"Part of the water soaks into the canal on the way, so tail farms get a longer turn so every farm receives its fair share of water"* (*"దారిలో కొంత నీరు కాలువలో ఇంకిపోతుంది, అందుకే ప్రతి పొలానికి న్యాయమైన వాటా అందేలా చివరి పొలాలకు ఎక్కువ సమయం వంతు ఇస్తారు."*). Contains no Gini, percentages, or need-met numbers.
   - Updated `nextTurnTe`/`En`, `rosterChangeTe`/`En`, `nightReleaseWarningTe`/`En`, `reminderTe`/`En`, `requestApprovedTe`/`En`, `requestUpdateTe`/`En`, and `alertTe`/`En` to include the seepage explanation when `isLongerTurn: true`.
   - Updated call-to-action closing clauses to give plain reply instructions (*"Press 1 to confirm, or speak your reply"* / *"నిర్ధారించడానికి 1 నొక్కండి లేదా మాట్లాడి చెప్పండి."*).
   - Added `STATUS_MAP_TE` mapping English status tokens (`approved`, `rejected`, etc.) to natural Telugu words when free-text status label is not provided.
   - Standardised `windowClauseTe` to include `IST` matching English.

3. **`apps/api/src/voice/script.ts`** — Added `isLongerTurn` and `isLongerThanBaseline` to `FACT_KEYS`, `BOOLEAN_FACT_KEYS`, and `factsFromParams` boolean parsing so URL params round-trip cleanly.

4. **`apps/api/src/coordinator-alert.ts`** — Updated coordinator alert template:
   - `COORDINATOR_REQUEST_EN`: *"Hello, this is the Jadal canal office calling. {farmer} has raised a request for {volume} cubic metres of water. Reason: {reason}. This request needs your approval, and nothing is final until you approve. Press 1 to approve, or press 2 to reject."*
   - `COORDINATOR_REQUEST_TE`: *"నమస్కారం, జడల్ కాలువ కార్యాలయం నుండి కాల్. {farmer} గారు {volume} ఘన మీటర్ల నీటి కోసం అభ్యర్థన పెట్టారు. కారణం: {reason}. ఈ అభ్యర్థనకు మీ ఆమోదం కావాలి, మీరు ఆమోదించే వరకు ఏదీ ఖరారు కాదు. ఆమోదించడానికి 1 నొక్కండి, తిరస్కరించడానికి 2 నొక్కండి."*
   - Preserves required phrase `"needs your approval"`, volume in m³ from allocation, and farmer's reason verbatim.
   - Added optional `isLongerTurn?: boolean` to `AllocationAlertInput` and forwarded to facts.

5. **`docs/review/telugu-native-review.csv`** — Appended all 9 new and modified Telugu strings with headers `key,file,en,te,context,auto_flag,reviewer_ok,reviewer_fix`.

6. **`apps/api/src/voice.test.ts`** — Added exhaustive case study verification suite:
   - Verified that every builder produces non-empty EN and TE output with all placeholders substituted, no `undefined`, no `NaN`, and no `Invalid Date` on both full facts and empty facts `{}`.
   - Verified that Telugu output contains no Latin letters except allowed units/brands (`m3`, `IST`, `Jadal`).
   - Verified that `whyLongerClause` is present when `isLongerTurn: true` and omitted when `false` or undefined.

No arithmetic in voice messages; all water quantities come from facts. Packages/contracts untouched. No real phone calls placed.

---

## Commands run and observed output

- **RAN** `pnpm --filter api exec vitest run src/voice-script.test.ts src/voice.test.ts src/coordinator-alert.test.ts --maxWorkers=1`
  - Observed output:
    ```
    ✓ src/coordinator-alert.test.ts (20 tests) 182ms
    ✓ src/voice.test.ts (106 tests) 91ms
    ✓ src/voice-script.test.ts (59 tests) 10ms

    Test Files  3 passed (3)
         Tests  185 passed (185)
      Duration  1.28s
    ```
  - Label: **COMPUTED** 185 tests passed across the 3 voice and alert test suites.

- **RAN** `pnpm --filter api typecheck`
  - Observed output:
    ```
    $ tsc --noEmit
    ```
    (Exit code 0, 0 type errors).
  - Label: **COMPUTED** Clean typecheck.

- **READ** `apps/api/src/voice/telugu.ts`
  - Builders verified: `rosterChange`, `nightReleaseWarning`, `rainPostponed`, `requestUpdate`, `reminder`, `ackRecorded`, `nextTurn`, `requestApproved`, `requestRecorded`, `alert`.
  - Label: **SOURCE** `apps/api/src/voice/telugu.ts`.

- **READ** `docs/review/telugu-native-review.csv`
  - Appended 9 rows for newly modified voice strings.
  - Label: **SOURCE** `docs/review/telugu-native-review.csv`.

---

## What is left / needs a human

1. **Native Speaker Audit**: Telugu strings in `docs/review/telugu-native-review.csv` must be reviewed by a native Telugu speaker from Andhra Pradesh before live deployment to verify local dialect and vocabulary appropriateness.
2. **Inbound Phone Purchase**: As documented in `apps/api/docs/INBOUND.md`, live inbound phone calls require purchasing a dedicated Twilio phone number; the code path is completely wired and tested with simulated replays.
