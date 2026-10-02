# ADR: planned vs delivered need-met for the roster comparison

**Status:** accepted (implemented) · **Date:** 2026-10-02 · **Area:** `packages/core`,
`apps/api` · **Context:** handoff `docs/HANDOFF-ENGINEERING.md` P4

## Problem

`rosterEngine.needMet` computes `planned_volume_m3 / demand` and **caps the result at 100%**
(`packages/core/src/roster.ts`). The cap is correct for a delivered claim — a farmer cannot have
more than all of their need met — but it destroyed the equal-hours vs equal-water fairness
comparison the product exists to make:

* `POST /api/rosters/propose` uses `needMet` for both modes' need-met rows and their Gini.
* On the shipped seed's `rw1` window the canal physically carries more than the week's FAO-56 need,
  so equal-hours over-allocates the head-end outlets past 100%.
* The cap then reported **100% for every farmer**, the Gini collapsed to **0 for both modes**, and
  the head-vs-tail gap was invisible (the reported symptom in P4).

## Decision

**Separate the two measures; do not change any contract shape.**

1. Add `rosterEngine.plannedNeedMet(input, roster)` in `packages/core` — the same planned/demand
   ratio as `needMet`, **without the 100% cap**, so over-allocation stays visible. One row per input
   demand, keyed by `farmer_id` + `outlet_id`, matching `needMet` row for row. A zero demand reports
   100%, matching `needMet`'s documented boundary.
2. Keep `rosterEngine.needMet` exactly as it is: the capped **delivered** measure. This is the
   documented contract in `docs/architecture/models.md` and the fix the earlier audit chose (F-15:
   "the honest fix was to make delivery correct, not to make the metric lie differently").
3. `apps/api/src/agents/scheduler.ts` (the Scheduler agent, which the route and the gated
   `optimize_roster` tool both call) now builds `need_met` and both comparison Ginis from
   `plannedNeedMet`. The comparison is explicitly a **proposal-time** comparison, before delivery.
4. **No new response field.** The contract's `proposeRoster.response.need_met[].pct` is already a
   bare `z.number()`; it now carries the planned percentage. Contract shapes stay valid, so this
   needs no `contracts-ok` change. `packages/contracts` is untouched.

`apps/api/src/core-adapters.ts` does **not** drop the field — it holds no roster logic at all — so it
is unchanged. `apps/api/src/core-shim.ts` re-exports the core's `rosterEngine` value, so the
additive method is visible to the API without an adapter.

## Why not a new `planned`/`delivered` field

The honest long-term shape is two explicit fields (`planned_pct`, `delivered_pct`). That is an
**additive** change to `packages/contracts/src/api.ts` and therefore requires the `contracts-ok`
label and the orchestrator. It is recorded here as the preferred follow-up, but it is not needed to
make the fairness number visible today, and adding it now would break the three-way parallel build.
`pct` keeps its current meaning of "need met" and is now documented as the planned value at proposal
time; the delivered value remains available from `GET /api/ledger` / the auditor's `need_met_pct`,
which is computed from ledger balances.

## Evidence (shipped seed, not hand-typed)

Demands were derived by `cropEngine.weeklyNeed` from the shipped `demo-scenario.json` crop plans,
the core's `data/crop-params.json`, and `demo-weather.json`, summed per farmer at their plot outlet.
Reproduce with `packages/core/src/roster-planned.test.ts`:

```
$ pnpm --filter @jadal/core exec vitest run src/roster-planned.test.ts --maxWorkers=1
 ✓ src/roster-planned.test.ts (4 tests)

equal_hours  plannedNeedMet: o1 280.794% … o8 205.536%   Gini 0.0593   (monotonic head→tail)
equal_water  plannedNeedMet: every outlet 100%           Gini 0
equal_hours  needMet (capped, unchanged): every 100%      Gini 0
```

## Refuted claim

The handoff says the seed's tail meets "roughly 42%" against a ~100% head. **That does not
reproduce from the shipped fixture.** The ~42% pattern is the *illustrative mock* in
`apps/web/src/api/mock.ts` (`i < 2 ? 98 : Math.max(40, 98 - i * 8)` → 98/90/82/74/66/58/50/42 with
`equal_hours_gini: 0.31`), not a physical result. On the shipped seed both modes over-satisfy the
week's need (the 24 h window is generous), so the honest measure is over-allocation: head 280.8%,
tail 205.5% (tail = 73% of head, the physical flow ratio `Q(o1)/Q(o8) = 0.1447/0.1059`). The gap is
real, monotonic across all eight outlets, and `equal_water` reduces it to zero. The specific "42%"
would only appear in the deficit regime (demands exceeding window capacity), which is the *raw*
seed's `equal_water` truncation documented in `apps/api/src/e2e.test.ts`.

## Consequences

* The live proposal now reports a non-zero `equal_hours_gini` and a zero `equal_water_gini` on the
  coordinator-re-priced week, so the coordinator can see the fairness gap. On the **raw** seed both
  Ginis remain misleading (equal-water starves the tail because the season supply is booked as
  weekly demand); that is a seed-pricing problem, not a metric problem, and is why the e2e test
  re-prices the week through the legal approval flow.
* `needMet` callers are unaffected.
* A UI that assumed `pct ≤ 100` will now see values above 100 for `equal_hours`. The canal fair-share
  bars should either clamp for display or label the over-allocation — flagged for the web lane.
