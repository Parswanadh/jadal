# placecall-guard — swarm checkpoint

Lane: `ws/swarm-placecall-guard` (`LANE_SCOPE=apps/api|docs`). Handoff P8.

## What changed

1. **`docs/decisions/ADR-place-call-gated.md`** — ADR proposing `place_call.gated: true` in
   `packages/contracts/src/agents.ts:25`, with options A–D and the owner-decision note. No contract
   file was edited (rule: `packages/contracts` immutable without `contracts-ok`).
2. **`docs/decisions/patches/place-call-gated.patch`** — the unapplied one-line patch
   (`- gated: false` / `+ gated: true`). Label: **needs contracts-ok**. Validated with
   `git apply --check`; nothing was applied.
3. **`apps/api/src/placecall-guard.test.ts`** — static-guard vitest that reads every non-test `.ts`
   under `apps/api/src`, strips comments and string/template literals, and fails if:
   - `placeCall(` is called anywhere except inside `placeCallFromCampaign` in `telephony-deps.ts`;
   - `placeCallIfAllowed(` is called by any file other than `coordinator-alert.ts` and
     `campaigns/escalation.ts`;
   - `placeCallFromCampaign(` (the unguarded wrapper) is called from outside `placeCallIfAllowed`.
   The rule is a pure exported `violations(files)` function, unit-tested on synthetic sources so a
   green run cannot be vacuous.

No water arithmetic, no user-visible strings, no i18n keys, no network, no real call.

## Commands run and observed output

- **RAN** `git apply --check --verbose docs/decisions/patches/place-call-gated.patch`
  → `Checking patch packages/contracts/src/agents.ts...`, exit 0 (`PATCH_CHECK_OK`). The working
  tree still shows `git status --short` with no `packages/contracts` entry. READ:
  `grep -n place_call packages/contracts/src/agents.ts` → line 25 is still `gated: false`.

- **RAN** `pnpm --filter api exec vitest run src/telephony-deps.test.ts src/placecall-guard.test.ts --maxWorkers=1`
  → `Test Files 2 passed (2)` / `Tests 18 passed (18)`; `src/telephony-deps.test.ts (13 tests)`,
  `src/placecall-guard.test.ts (5 tests)`.

- **RAN** `pnpm --filter api typecheck` → `tsc --noEmit`, exit 0.

- **RAN (guard bites, then reverted)** created temporary `apps/api/src/__placecall-probe.ts`
  containing `return placeCall({} as never, {} as never);` and ran only the guard test:
  - exit code **1**; `Tests 2 failed | 3 passed (5)`;
  - `× finds no illegal call site anywhere under apps/api/src`
    `AssertionError: expected [ Array(1) ] to deeply equal []`;
  - diff line: `+ "direct placeCall() call outside telephony-deps.ts: __placecall-probe.ts:4 (in badBypass)"`;
  - `× invokes the raw placeCall() in exactly one place, inside the guarded wrapper`
    `AssertionError: expected [ …(2) ] to deeply equal [ Array(1) ]`.
  - The probe file was deleted in the same shell invocation; `test -e` printed `REMOVED`, and
    `git status --short` afterwards listed only the new test file. The probe was never committed.

- **READ** `grep -rn "placeCall(" apps/api/src --include=*.ts` before the guard →
  `apps/api/src/telephony-deps.ts:154:  return placeCall(placeCallDeps(env), input);` is the only
  direct invocation; `placeCallIfAllowed(` appears at `coordinator-alert.ts:208` and
  `campaigns/escalation.ts:319` (plus its definition at `telephony-deps.ts:131`).

## What is left / needs a human

- **Apply the contract patch** — requires a human/orchestrator with the `contracts-ok` label, since
  this lane must not touch `packages/contracts`. After applying, re-run
  `pnpm --filter api exec vitest run src/placecall-guard.test.ts --maxWorkers=1`; search the repo
  for any assertion that `place_call.gated === false` before merging.
- **ADR option choice** — the ADR recommends option A (flip the flag). Options B (add a real gated
  handler) and C (leave `false` + disclaimer) are documented for the owner; option B would be a
  larger contracts + agent-runtime change, not attempted here.
- No push was performed, per the lane rules.

## Commits

- `483aa13 docs(decisions): propose gated:true for place_call with unapplied contracts patch`
- `93fc532 test(api): static guard that outbound calls only leave via placeCallIfAllowed`
