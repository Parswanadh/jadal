# Swarm status — workflows-audit (P10)

**Branch:** `ws/swarm-workflows-audit` · **Lane:** `apps/api|docs`

## What changed

| Commit | Subject | Files |
|---|---|---|
| `fdab1ec` | `test(campaigns): pin durable workflow scheduling, retry and idempotency` | `apps/api/src/campaigns/workflows.test.ts` (new, 9 tests) |
| `ec0fa93` | fix: bound the workflow retry ceiling to a finite value | `apps/api/src/campaigns/workflows.ts`, test |
| `0eb2f2f` | `fix(campaigns): derive the workflow retry sleep from RETRY_DELAY_MINUTES` | `apps/api/src/campaigns/workflows.ts` |

Full findings: **`docs/research/workflows-audit.md`**.

## Commands run (evidence)

```text
$ pnpm --filter api exec vitest run src/campaigns --maxWorkers=1
 Test Files  4 passed (4)
      Tests  36 passed (36)

$ pnpm --filter api typecheck
$ tsc --noEmit          # clean

# red-before-fix for F1 (NaN ceiling):
× CallCampaignWorkflow > falls back to the default ceiling when maxAttempts is not a finite number
  AssertionError: expected 'sent' to be 'escalated'
```

## Headline result

The workflow classes are **dormant**: nothing calls `.create(...)` on either binding (READ/RAN),
so the durability-across-evictions behaviour they document never executes. Two local defects were
confirmed and fixed (unvalidated `maxAttempts` ceiling; duplicated 15-minute literal). The other
findings are documented for an owner.

## Left for a human / owner

- **F3 (HIGH):** wire a trigger for `UrgentRequestWorkflow` / `CallCampaignWorkflow`, or record
  that they are intentionally dormant. The durability claim is currently unverified.
- **F4 (MEDIUM):** `alert-coordinator` is a checkpoint, not an alert — decide whether it should
  dial the coordinator.
- **F5 (MEDIUM):** the fixed 15-minute inter-rung sleep overrides `nextEscalation.delayMinutes`;
  decide which timing is canonical.
- **F6 (LOW):** the local `cloudflare:workers` stand-in diverges from the real API and can only be
  validated with a real Workflow runtime.

No contract change is needed for any fix above; no secret or external service was touched.
