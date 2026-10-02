# Audit — `apps/api/src/campaigns/workflows.ts` (handoff P10)

**Branch:** `ws/swarm-workflows-audit` · **Audited revision:** `27a3b7e` (workflows.ts, 170 lines)
**Scope:** the two durable workflow classes, their only effectful callee `runEscalation`
(`campaigns/escalation.ts`), and their callers (`src/index.ts`, `wrangler.jsonc`).
**Evidence:** every statement is labelled READ (source), RAN (command + output), or COMPUTED.

The handoff §5 listed this file as *"scheduling was never audited — flagged unverified, not claimed
safe."* This is the audit. Two defects were confirmed and fixed (`ec0fa93`, `0eb2f2f`); the rest are
reported, not papered over.

---

## 0. What the file is, and whether it runs

`UrgentRequestWorkflow` and `CallCampaignWorkflow` are exported from `src/index.ts` and bound in
`wrangler.jsonc` (`URGENT_REQUEST_WORKFLOW`, `CALL_CAMPAIGN_WORKFLOW`, class names matching).

**F3 — HIGH (open): neither workflow is ever triggered.** READ + RAN.

```text
$ grep -rn "URGENT_REQUEST_WORKFLOW\|CALL_CAMPAIGN_WORKFLOW\|\.create(" apps/api/src
(no matches outside index.ts's re-export)
```

Nothing in the repo creates a workflow instance (`env.<BINDING>.create(...)` has no occurrence), and
there is no route/agent/queue handler that constructs one. The only live driver of the escalation
ladder is the queue consumer in `src/index.ts` (`queue()` → `runEscalation`). Consequence: the
docstring's central claim — *"a call that was placed before an isolate was recycled is not placed
again after it restarts … the 15-minute retry … is a `step.sleep`"* — describes code that does not
execute in this build. The durability is **unverified by execution**, not proven safe. Wiring a
trigger is a product/owner decision (which event starts which campaign); this audit does not invent
one.

---

## 1. Confirmed defects, fixed

### F1 — MEDIUM (fixed `ec0fa93`): the documented "safety ceiling" was unvalidated

`CallCampaignParams.maxAttempts` is documented as a *"Safety ceiling on the number of durable
retries"*, but `CallCampaignWorkflow` used it verbatim as a loop bound. READ (`workflows.ts:155`
before the fix):

```ts
const limit = event.payload.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
for (let index = 1; index <= limit; index += 1) { … }
```

Because it arrives in the trigger payload it is untrusted:

* `maxAttempts: NaN` → `index <= NaN` is always false → **the loop never runs** and the campaign
  silently degrades to a single rung. RAN red-before-fix:
  `AssertionError: expected 'sent' to be 'escalated'`.
* `maxAttempts: Infinity` → the loop's only stop condition was the `escalated` status produced in a
  *different module* (`nextEscalation`'s `priorAttempts >= 3` rule), so the local ceiling bounded
  nothing. The observed termination is real (RAN, test *"terminates … with a huge maxAttempts"*) but
  it is an invariant of `escalation.ts`, not of the loop.
* A negative value silently disables the ladder.

Fix: `normaliseMaxAttempts` falls back to `DEFAULT_MAX_ATTEMPTS` for any non-finite value, floors to
an integer, rejects negatives, and clamps to `DEFAULT_MAX_ATTEMPTS` (the ladder escalates at attempt 4
regardless, so this is not observable for finite requests within the design).

### F2 — LOW (fixed `0eb2f2f`): the retry gap was duplicated as a string literal

`escalation.ts` owns `RETRY_DELAY_MINUTES = 15` and exported it, yet `workflows.ts` hardcoded the
literal `"15 minutes"` in both workflows. Changing the ladder's constant would have left the durable
workflow sleeping the old gap. READ. Fix: one `RETRY_SLEEP = \`${RETRY_DELAY_MINUTES} minutes\`` used
by both `step.sleep` calls; the test pins each sleep to the exported constant.

---

## 2. Confirmed behaviour (tests added in `fdab1ec`)

`apps/api/src/campaigns/workflows.test.ts` (9 tests) drives both classes through a hand-written
`WorkflowStep` that records every `do` / `sleep` / `waitForEvent`, a fake acknowledgement, and a
"checkpoint lost" replay mode. Network is stubbed by `test/harness.ts` (unmocked URLs throw).

| # | Behaviour pinned | Result |
|---|---|---|
| F8 | A `first-contact` step whose callback ran twice (lost checkpoint) dials **once**: `runEscalation` derives the next contact id deterministically and returns the existing contact before dialling. | RAN: `invoked` contains `first-contact` twice, `twilioCalls === 1`. |
| F10 | The queue consumer and the workflow both advancing the same ladder converge, because the per-`(contact, attempt)` deterministic id short-circuits the second driver before any dial or `OUTBOUND` send. | READ/COMPUTED from `escalation.ts:255-291`; covered by F8's mechanism. |
| — | `UrgentRequestWorkflow` with an acknowledgement: step order `alert-coordinator → first-call → await-acknowledgement`, no sleep, one dial, `acknowledged: true`. | RAN, 1 test. |
| — | Timeout: exactly one `"15 minutes"` sleep then exactly one `retry-call`; `acknowledged: false`; two dials for a voice-only farmer. | RAN, 1 test. |
| — | No `contactId`: alert step only, no wait, no dial, `final_contact_id: null`. | RAN, 1 test. |
| — | The `alert-coordinator` step places no call and sends nothing (see F4). | RAN, 1 test. |
| — | `maxAttempts: 1e9` still terminates at `escalated` with ≤4 `do` steps. | RAN, 1 test. |
| F7 | With `CALL_RATE_MAX_CALLS=1`, the workflow's second voice rung is refused and **never fetched** (1 Twilio request, `status: escalated`). No dial bypasses `placeCallIfAllowed`. | RAN, 1 test. |
| F9 | Every wait is a relative duration string derived from `RETRY_DELAY_MINUTES`; no wall-clock arithmetic in this file. | RAN, 1 test. |

Commands:

```text
$ pnpm --filter api exec vitest run src/campaigns --maxWorkers=1
 Test Files  4 passed (4)
      Tests  36 passed (36)
$ pnpm --filter api typecheck
$ tsc --noEmit          # clean
```

---

## 3. Open findings — reported, not fixed

### F4 — MEDIUM: "alert the coordinator" does not alert

`UrgentRequestWorkflow.run`'s first step is named `alert-coordinator`, and the class docstring says
it will *"alert the coordinator"*, but the callback only returns a checkpoint object:

```ts
await step.do("alert-coordinator", async () => ({
  request_id: requestId,
  alerted_at: event.timestamp.toISOString(),
}));
```

READ. It never calls `coordinator-alert.ts` (the handoff's only other approved call site) and never
enqueues on `OUTBOUND`. Test pins the no-op. Wiring it means placing a real coordinator call from a
workflow, which needs the coordinator phone/approval context and is therefore an owner decision.

### F5 — MEDIUM: the workflow overrides the pure ladder's own timing

`nextEscalation` returns `delayMinutes: 0` for attempts ≥ 2 (message and escalation rungs); the
workflow sleeps a fixed 15 minutes before **every** rung. READ/COMPUTED. Net effect: WhatsApp/SMS and
the coordinator flag land 15 minutes later than the pure decision prescribes, and the workflow is a
second source of truth for inter-rung timing. The class docstring ("sleeping 15 minutes between
rungs") and `escalation.ts`'s `retryDelayMinutes` comment ("a Workflow that resumes … return the
remaining time instead of sleeping the full 15 minutes again") point in different directions. Which
one is intended is a product question for the owner; the timing is not broken, just inconsistent.

### F6 — LOW (latent): the local `WorkflowStep` stand-in is not the real runtime API

The file header claims swapping to `cloudflare:workers` is a one-line change needing no body edits.
READ/SOURCE: the stand-in declares `sleep(duration: string)`, while Cloudflare's GA
`WorkflowStep.sleep(name, duration)` takes a name first, and the class extends a locally declared
`WorkflowEntrypoint` rather than the platform one. The bodies call `step.sleep("15 minutes")`, which
under the real signature would pass the duration in the name slot. This cannot be executed here (no
`wrangler`/`miniflare`, no real binding), so it is reported, not "fixed": the swap is not one line,
and the durability claim (F3) needs a real-runtime test before it can be trusted.

### F7 — LOW: the workflows trust the contact id

Both classes call `runEscalation(contactId)` directly. `runEscalation` dials any contact whose status
is not `acknowledged`/`escalated` — it does not check that the contact came from `approveRoster`.
READ. Today no workflow trigger exists (F3), so this is defence-in-depth rather than a live bypass,
and it does **not** violate the "never report a simulated dispatch as real" or
`placeCallIfAllowed` rules (F7 test). If a trigger is wired, it should assert the contact was
coordinator-approved before starting the ladder.

---

## 4. Summary

| Finding | Severity | State |
|---|---|---|
| F1 `maxAttempts` unvalidated (NaN no-op, Infinity unbounded locally) | MEDIUM | **fixed `ec0fa93`**, red→green test |
| F2 hardcoded `"15 minutes"` duplicates `RETRY_DELAY_MINUTES` | LOW | **fixed `0eb2f2f`**, pinned |
| F3 workflows have no trigger; durability claim unexecuted | HIGH | open (owner) |
| F4 `alert-coordinator` is a no-op | MEDIUM | open (owner) |
| F5 fixed 15-min gap overrides `nextEscalation.delayMinutes` | MEDIUM | open (owner) |
| F6 stand-in diverges from real `cloudflare:workers` | LOW | open (needs real runtime) |
| F7 contact id is trusted, no approval assertion | LOW | open (defence-in-depth) |

No unbounded loop remains in `workflows.ts`: the loop is locally bounded by F1's clamp, and the
ladder itself escalates at attempt 4. No path from this file places a call without going through
`placeCallIfAllowed`. No timezone/DST arithmetic exists in this file.
