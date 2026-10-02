# FROZEN BASELINE — 2026-10-02

**Tag:** `freeze/2026-10-02` · **Branch:** `integration/all` · **Commit:** see `git rev-parse freeze/2026-10-02`

This is the known-good state of the Jadal integration. If a later change breaks something and the
cause is not obvious, **revert to this tag** rather than debugging forward.

## How to restore

```bash
cd /home/parshu/projects/cis/jadal-integration
git fetch --tags origin
git checkout -B integration/all freeze/2026-10-02
pnpm install --config.verify-deps-before-run=false
cp /home/parshu/projects/cis/jadal/apps/api/.dev.vars apps/api/.dev.vars   # gitignored, never committed
pnpm --filter api migrate:local
```

Or to inspect it without disturbing the working tree:

```bash
git worktree add /tmp/jadal-frozen freeze/2026-10-02
```

## What is verified working at this commit

Measured, not assumed:

| Check | Result |
|---|---|
| `pnpm -r typecheck` | clean |
| `pnpm --filter api test` | **464 passed**, 29 files |
| Coordinator sees a farmer's request (live) | verified |
| Coordinator approves a request | verified, ledger records it |
| Coordinator edits a turn time | verified, backwards interval → 400 |
| Alert places a real call | verified against Twilio's call log |
| Real calls connect and are answered | 7s, 29s, 20s, 22s, 14s durations |
| Per-farmer demo number mapping | verified, Twilio dialled the mapped handset |
| All 9 API GET routes | 200 |
| Laya service (`:8099`) | 200, classifies short Telugu in ~30–220 ms |

## Branches merged into this freeze

`ws/B-models` (core audit), `ws/B-jev` (System-1 provider chain), `ws/B-laya` (Laya service),
`ws/B-voice` (inbound voice), `ws/B-coordalert` (coordinator alerting + `/api/alerts`),
`ws/B-failproof` (observability), `ws/C11-ux` (web: auth, hero video, coordinator tools),
`ws/C-showcase`, `ws/C-brag` (launch video), `ws/B-laya-verdict` — all on top of `ws/B9-integration`.

## Known state / honest limitations at this commit

These are **known and accepted**, not surprises:

1. **`LAYA_ENDPOINT` is unset**, so the System-1 chain skips Laya and uses keyword rules. Setting
   `LAYA_ENDPOINT=http://127.0.0.1:8099/decide` enables it. `source` on every result records which
   engine ran.
2. **`triage_score` is the constant 0.15** floor (`URGENCY_BASE` in `system1.rules.ts`) whenever no
   keyword matches, which is the case for the short English demo reasons.
3. **The Gini comparison returns 0 for both modes** in the live path: `needMet` clamps at 100 and
   `delivered` is 0 before delivery, so every farmer reads 100%. The canal seepage diagram
   (`/canal`, 0.145 → 0.106 m³/s) is the visible fairness evidence instead.
4. **The groundnut worked example does not reproduce**: README claims 462.12 m³, the shipped
   parameters give 417.69 m³. Pinned by a test; the divergence is documented in
   `docs/research/model-audit.md`.
5. **`place_call` is declared `gated: false`** in `packages/contracts/src/agents.ts`. The real
   dispatch path is still approval-gated (contacts are only created inside `approveRoster`), so this
   is a declaration inaccuracy, not a live hole.
6. **SMS/WhatsApp are accepted and audited but nothing is sent** — no transport.
7. **Laya runs on CPU**, not GPU.
8. **Telugu copy is machine-written** and needs a native speaker review.

## Credentials

Real keys live only in `apps/api/.dev.vars`, which is gitignored (`**/.dev.vars`). Nothing in this
tag contains a secret. Anyone restoring this state must supply their own `.dev.vars`.

## Corrections after the freeze

Recorded rather than rewritten, so the history stays honest.

### A frozen tag with a red typecheck

`pnpm --filter web typecheck` **fails at tag `freeze/2026-10-02`**. The contract route
`setTurnTime` was added (PATCH /api/rosters/:id/turns/:turnId) but the web client never gained a
matching function name, so `client.ts` and two `client.test.ts` cases fail. Found by the lane that
fixed the coordinator's Reject action; the fix (a `setTurnTime` alias over the existing `updateTurn`
PATCH) landed after the tag.

Anyone restoring this tag should expect **typecheck red on the web package** and apply that fix.

### Misattributed commit

Commit `4321458` (`fix(api): bound the outbound queue retry…`) also contains **12 `apps/web` files**
and two `tests/e2e` files belonging to a concurrent lane, because the orchestrator ran `git add -A`
on the shared worktree while that lane was mid-edit.

**No content was altered** — the lane verified the diff byte-for-byte. The damage is attribution only.
The commit was left as-is rather than rewritten, because it is already pushed and other agents branch
from it; a force-push on a shared branch is a worse risk than a misleading message.

A `pre-commit` hook now refuses a commit that stages files outside `LANE_SCOPE`, verified by probe.
**Rule going forward: on the shared integration worktree, stage explicit paths — never `git add -A`.**
