# Swarm checkpoint — climate-adjust (handoff P7, Eq. 6.18 / 6.21)

Branch: `ws/swarm-climate-adjust` · Lane scope: `packages/core|docs` · No push, no contract edits.

## What changed

| File | Change |
|---|---|
| `packages/core/src/crop.ts` | New `adjustCropParamsForClimate(params, climate)` — the single application point for the FAO-56 Eq. 6.18/6.21 Kc correction; strict no-op (same object reference) unless both optional inputs are finite and in-domain. `weeklyNeed` now routes through it instead of duplicating the logic. Also fixed `adjustKcForClimate` to no-op when `h` is outside `[0.1, 10] m` (it previously clamped, contradicting its own doc comment and `docs/architecture/models.md`). |
| `packages/core/src/index.ts` | Additive public exports: `adjustKcForClimate`, `adjustCropParamsForClimate`, `KC_END_ADJUSTMENT_THRESHOLD`, type `ClimateInputs`. |
| `packages/core/src/climate-adjust.test.ts` | New 13-test suite: domain bounds inclusive, exact no-op just outside them, missing/non-finite no-ops, helper identity no-op, `kc_end` 0.45 threshold, and weeklyNeed output unchanged for omitted/null/out-of-domain inputs. |
| `docs/decisions/ADR-climate-weatherday.md` | Proposal to add optional `rh_min_pct` / `wind_u2_ms` to `WeatherDay`. **Not applied.** |
| `docs/decisions/patches/weatherday-additive.patch` | Exact, verified, **unapplied** unified diff against `packages/contracts/src/entities.ts`. |

No file under `packages/contracts` was modified.

## Evidence (RAN / READ / COMPUTED)

- **RAN** `pnpm --filter @jadal/core exec vitest run --maxWorkers=1` →
  `Test Files 10 passed (10)` · `Tests 165 passed (165)` (includes the new 13).
- **RAN** `pnpm --filter @jadal/core exec vitest run src/models.audit.test.ts src/crop.test.ts --maxWorkers=1`
  → `Test Files 2 passed (2)` · `Tests 81 passed (81)` (the two suites most exposed to the `h` fix and
  the `weeklyNeed` refactor).
- **RAN** `pnpm --filter @jadal/core typecheck` → `tsc --noEmit` clean, no output.
- **RAN** `git apply --check --verbose docs/decisions/patches/weatherday-additive.patch` →
  `Checking patch packages/contracts/src/entities.ts...` exit 0 (patch valid, and **not applied**).
- **RAN** `git status --short packages/contracts` → empty (contracts untouched).
- **RAN** `grep -rn "relative_humidity|windspeed_10m|wind_speed|rh_min|wind_u2" apps/api/src` → no
  output: the API fetches neither RHmin nor wind, so the contract change alone would not light the
  adjustment up.
- **READ** `packages/core/src/crop.ts` (existing opt-in path), `docs/architecture/models.md` §3.3
  (validity domain + reconstruction), `docs/research/fao56-crop-tables.md` §4.2.1/§4.2.2,
  `packages/contracts/src/entities.ts` (`WeatherDay`), `docs/HANDOFF-ENGINEERING.md` §5 P7.
- **COMPUTED** the `h`-domain discrepancy: `adjustKcForClimate` checked only u2/RH ranges and
  `Math.min(10, Math.max(0.1, h))`-clamped `h`, while its doc comment and models.md both say
  out-of-range inputs return the tabulated Kc unchanged. Shipped `crop-params.json` `max_height_m`
  is 0.5–3.0 m (all in range), so the fix changes no shipped result.

## What is left / needs a human

1. **`contracts-ok` review of `docs/decisions/patches/weatherday-additive.patch`.** This is the
   blocking one; do not apply without the label.
2. **`apps/api` weather fetch must populate `rh_min_pct` / `wind_u2_ms`** (e.g. Open-Meteo
   `relative_humidity_2m_min`, `wind_speed_10m`). Until then the adjustment stays dormant — the
   contract change is necessary but not sufficient.
3. **Owner decision (not made here):** whether `seasonNeed` should forward the optional climate
   inputs. It currently does not, to keep this change minimal and its input type unchanged.
4. `adjustKcForClimate`'s `h` fix changes behavior only for out-of-range heights. If an owner wants
   clamping instead of no-op, revert that hunk; the tests currently pin no-op to match the
   documented contract.

## Notes for the next agent

The `chore(climate-adjust): checkpoint` commits in this branch are harness auto-checkpoints, not
another agent's work; there was no prior P7 checkpoint to continue from.
