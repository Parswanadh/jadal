# gini-planned — PLANNED vs DELIVERED need met (handoff P4)

**Lane:** `ws/swarm-gini-planned` · **Scope:** `packages/core`, `apps/api`, `docs` · **Date:** 2026-10-02

## What changed

| File | Change |
|---|---|
| `packages/core/src/roster.ts` | Added `rosterEngine.plannedNeedMet(input, roster)`: the same `planned_volume_m3 / demand × 100` ratio as `needMet`, **without the 100% cap**. `needMet` is unchanged (capped, delivered). |
| `packages/core/src/roster-planned.test.ts` (new) | Four tests on the **shipped seed**, demands priced by `cropEngine.weeklyNeed` from `demo-scenario.json` + `data/crop-params.json` + `demo-weather.json` (no hand-typed demand). |
| `apps/api/src/agents/scheduler.ts` | `proposeRoster` now builds `need_met` and both comparison Ginis from `plannedNeedMet`. Contract response shape unchanged. |
| `docs/decisions/ADR-need-met-planned.md` (new) | Records the split, why no contract change, the measured numbers, and the refutation of the handoff's "42%". |

`apps/api/src/core-adapters.ts` was **not** changed — it holds no roster logic, so it does not drop
the field. `packages/contracts` was **not** touched.

## Evidence

All commands run from the worktree root. `LABEL` is RAN (command + observed output) unless noted.

**Core full suite — RAN**

```
$ pnpm --filter @jadal/core exec vitest run --maxWorkers=1
 ✓ src/ledger.test.ts (16 tests)   ✓ src/models.audit.test.ts (66 tests)
 ✓ src/roster.test.ts (14 tests)   ✓ src/crop.test.ts (15 tests)
 ✓ src/hydraulics.test.ts (12 tests)  ✓ src/data/crop-params.test.ts (7 tests)
 ✓ src/policy.test.ts (16 tests)   ✓ src/roster-planned.test.ts (4 tests)
 ✓ src/index.test.ts (4 tests)     ✓ src/index.api.test.ts (2 tests)
 Test Files  10 passed (10)      Tests  156 passed (156)
```

(Was 152 core tests at `live/2026-10-02`; +4 new.)

**New shipped-seed test — RAN**

```
$ pnpm --filter @jadal/core exec vitest run src/roster-planned.test.ts --maxWorkers=1
 ✓ src/roster-planned.test.ts (4 tests) 4ms
 Test Files  1 passed (1)      Tests  4 passed (4)
```

The tests encode (COMPUTED from the shipped data, asserted to 2–3 decimals):

| mode | view | o1 (head) | o8 (tail) | Gini |
|---|---|---|---|---|
| equal_hours | `needMet` (capped, old live path) | 100% | 100% | **0** ← the P4 bug |
| equal_hours | `plannedNeedMet` (un-capped) | **280.794%** | **205.536%** | **0.0593** |
| equal_water | `plannedNeedMet` | 100% | 100% | **0** |

The equal-hours planned percentages decrease monotonically o1→o8 with chainage; equal_water's Gini
(0) is strictly less than equal-hours' (0.0593).

**Typechecks — RAN**

```
$ pnpm --filter @jadal/core typecheck   # tsc --noEmit, clean
$ pnpm --filter api typecheck           # tsc --noEmit, clean
```

**API route + integration — RAN**

```
$ pnpm --filter api exec vitest run src/routes/write.test.ts --maxWorkers=1
 ✓ src/routes/write.test.ts (20 tests) 226ms      Tests  20 passed (20)

$ pnpm --filter api exec vitest run src/e2e.test.ts --maxWorkers=1
 ✓ src/e2e.test.ts (1 test) 100ms                 Tests  1 passed (1)
```

The e2e test re-prices the week to 1 300 m³/farmer through the legal approval flow and asserts
`equal_water_gini < equal_hours_gini` and `equal_water_gini === 0`; both still hold.

## READ / COMPUTED: the handoff's "42%" is refuted

`docs/HANDOFF-ENGINEERING.md` §1 says the seed's tail meets "roughly 42%" against a ~100% head.
READ: the only place that pattern exists is the illustrative mock, `apps/web/src/api/mock.ts:319`
(`i < 2 ? 98 : Math.max(40, 98 - i * 8)` → tail 42, `equal_hours_gini: 0.31`). COMPUTED on the
shipped seed, both modes over-satisfy the week's need (24 h window ≫ weekly need), so the honest
result is over-allocation, head 280.8% vs tail 205.5% — tail = 73% of head, the physical flow ratio
`Q(o1)/Q(o8) = 0.1447/0.1059 = 1.366`. A 42% tail would require the deficit regime (demand exceeding
window capacity), which on this seed only occurs for the *raw* season-scaled entitlements — and there
`equal_water` truncates at the head and is *worse* (f1 ≈ 30%, tail 0), as already documented in the
e2e header. The gap the product needs is now visible and monotonic; the specific 42% is not a
property of the shipped fixture.

## What is left / needs a human

1. **Raw-seed pricing is still misleading.** `deriveEntitlements` scales the whole 180 000 m³ season
   supply across one week's crop plans, so on the raw seed `equal_water` starves the tail and the
   comparison inverts. This predates this change and is worked around in the e2e by coordinator
   re-pricing. Fixing it is a product/seed decision (per-week vs per-season entitlement), not a
   metric fix — **owner decision needed**.
2. **UI: `pct` can now exceed 100** for `equal_hours`. `apps/web/src/canal/CanalVisual.tsx` draws
   need-met bars; it should clamp for display or label the over-allocation. Not touched (Task C).
3. **Preferred follow-up contract change** (needs `contracts-ok`): expose explicit `planned_pct` and
   `delivered_pct` fields, per `docs/decisions/ADR-need-met-planned.md` §"Why not a new field".
   Deferred; the current additive method needs no contract change.
4. **`GET /api/ledger` delivered need-met** stays ledger-based (`routes/read.ts`), so the delivered
   and planned views are now clearly distinct. No change made there.
