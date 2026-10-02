# swarm/crop-reproduce — P5 groundnut worked example

**Branch:** `ws/swarm-crop-reproduce` · **Lane scope:** `packages/core|docs` · **Commits:** `e4ac87d`, `3208f18`

Goal (handoff P5): the docs claim a groundnut worked example of 462.12 m³, but the shipped
`crop-params.json` produces 417.69 m³, and the only test asserting 462.12 used hand-typed parameters
that exist in no data file. No `kc`/root-depth value may be changed (owner decision).

## What changed

1. **`packages/core/src/crop.test.ts`** (commit `e4ac87d`)
   - Renamed the hand-typed test to
     `DOC-ONLY inputs: the §5.2 adjusted Kc_mid (1.1325) reproduces the documented 462.12 m3`, with a
     comment stating the params are typed from prose and are **not** the production path. Kept as the
     explicitly named "what inputs give 462.12" test.
   - Added `SHIPPED crop-params.json groundnut gives 417.69 m3, NOT the documented 462.12 m3`. It
     **loads the groundnut row from `./data/crop-params.json`** (not a fixture), asserts
     `kc_mid === 1.05` and `root_depth_m.max === 1.0`, then pins `volume_m3 ≈ 417.69` (2 dp) and
     asserts it is not 462.12.
2. **`docs/decisions/ADR-groundnut-worked-example.md`** (commit `3208f18`)
   - Option A (update the doc to 417.69) vs Option B (change the table, incl. B1 static edit vs B2
     make FAO-56 Eq. 6.18 live via a `contracts-ok` addition), COMPUTED numbers for both, a
     recommendation (Option A), status **NEEDS-OWNER-DECISION**.
3. **`packages/core/README.md`** (commit `3208f18`)
   - Short blockquote warning: doc §5.2 says 462.12, shipped table gives 417.69, pointing at the ADR.

No `kc` or `root_depth` value was changed. `packages/contracts` was not touched.

## Commands run and observed output

**RAN — baseline, before the change** (`pnpm exec vitest run src/crop.test.ts --maxWorkers=1`, cwd
`packages/core`):

```
 ✓ src/crop.test.ts (15 tests) 13ms
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

**RAN — the task command, after the change** (`pnpm --filter @jadal/core exec vitest run
src/crop.test.ts --maxWorkers=1` from the repo root):

```
 RUN  v3.2.7 /home/parshu/projects/cis/jadal-w-crop-reproduce/packages/core
 ✓ src/crop.test.ts (16 tests) 13ms
 Test Files  1 passed (1)
      Tests  16 passed (16)
```

**RAN — typecheck** (`pnpm exec tsc --noEmit`, cwd `packages/core`): exit code 0, no output.

**READ — `packages/core/src/data/crop-params.json`** groundnut row: `kc_mid: 1.05`,
`root_depth_m: {min: 0.5, max: 1.0}`, `max_height_m: 0.5`, `depletion_p: 0.5`,
`constant_status.kc_mid === "MEASURED"`, `constant_status.root_depth_m === "MEASURED"`.

**READ — `docs/research/model-audit.md` F-01** already recorded the divergence and stated that
`packages/core/src/models.audit.test.ts` added an F-01 test pinning 417.69. That existing test uses a
hand-typed `GROUNDNUT` constant equal to the shipped row; the new `crop.test.ts` test is the first to
load the JSON file itself.

**COMPUTED** (Python, from the §5.2 inputs; reproduced by both `crop.test.ts` tests):

| Quantity | Doc inputs (adjusted Kc) | Shipped inputs |
| :--- | ---: | ---: |
| Weekly ET_c | 39.6381 mm | 36.7500 mm |
| P_eff | 9.6000 mm | 9.6000 mm |
| I_net | 30.0381 mm | 27.1500 mm |
| I_gross | 46.2124 mm | 41.7692 mm |
| **V_gross** | **462.1240 m³** | **417.6923 m³** |
| TAW / RAW | 104.00 / 49.2437 mm | 130.00 / 63.7000 mm |
| event refill / cap | 757.59 / 1600.00 m³ | 980.00 / 2000.00 m³ |

**COMPUTED** gap = 44.4317 m³ = **9.615 %** of the documented figure = **10.637 %** of the shipped
figure. (Both bases are stated because the handoff's "10.6 % low" uses the shipped base and is easy to
misquote.)

## What is left / needs a human

- **Owner decision (blocking the doc fix):** choose Option A or Option B in
  `docs/decisions/ADR-groundnut-worked-example.md`. The doc still carries 462.12 and the table still
  carries 1.05 / Zr 1.00; that is deliberate.
- If Option B2 is chosen, it needs an **additive `packages/contracts` change** (`WeatherDay` gains
  wind/humidity) and the `contracts-ok` label — out of scope here.
- This lane did not modify `docs/research/fao56-model.md` (the §5.2 prose still prints 462.12); the
  ADR and the README warning flag it. Whoever accepts Option A must also edit that file.
- The existing `packages/core/src/models.audit.test.ts` F-01 test still uses a hand-typed constant
  rather than the JSON. It is redundant with the new JSON-backed test and could be consolidated, but
  it was left untouched to keep this lane minimal.
