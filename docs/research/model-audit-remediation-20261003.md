# Model Audit Remediation — 2026-10-03

Remediation of the open findings in `docs/research/model-audit.md` (F-01, F-02, F-03, F-04,
F-05, F-06, F-08). Each row records the fix and the red/green evidence.

## Ledger

| ID | Finding | Fix | Status | Evidence |
| :--- | :--- | :--- | :--- | :--- |
| F-01 | Groundnut documented example (462.12 m³) ≠ shipped table (417.69 m³) | **Docs + test.** `fao56-model.md` §5.2 now records that the shipped table uses the verified $K_{c,mid}$ 1.05 / $Z_r$ max 1.00 m and that 462.12 m³ is reproducible only with the unverified inputs. `crop.test.ts` groundnut test now loads the shipped `crop-params.json` row and asserts 417.69 m³. | fixed | `crop.test.ts` groundnut test: red (hand-typed 462.12) → green (shipped 417.69). |
| F-02 | Exponential seepage diverges from cited Moritz linear form | **Docs.** `models.md` §4.2 records the decision to keep the exponential form (replacing it would invalidate every published worked value in `architecture.html`). | documented | Decision recorded; no code change. |
| F-03 | Overrun losses computed per-outlet, not deducted in sequence | **Code.** `hydraulics.ts` `overrunImpact` now deducts losses in sequence (head to tail), capping the total at $Q(x_{overrun}) \cdot \text{overrun\_h} \cdot 3600$ — the water the canal carries past the overrunning outlet. | fixed | `hydraulics.test.ts` F-03 test: red (987.2 vs 520.9) → green. |
| F-04 | $K_c$ climate adjustment is opt-in | **Docs.** `models.md` §3.3 records that the adjustment cannot be automatic: `WeatherDay` carries no RHmin/wind and `packages/contracts` is immutable in this lane. | documented | Limitation recorded; no code change possible. |
| F-05 | Paddy $P_{eff}$ has no weir-crest cap | **Docs.** `models.md` §3.4 records that the cap needs ponded-depth state ($h_{water}$) not on the `WeatherDay` contract. | documented | Limitation recorded; no code change possible. |
| F-06 | Upland $P_{eff}$ has no root-zone-deficit cap | **Docs.** `models.md` §3.4 records that the cap needs day-to-day $D_r$ state the core does not carry. | documented | Limitation recorded; no code change possible. |
| F-08 | `rain.replanned` never reconciles `saved_m3` against `by_farmer_m3` | **Code.** `ledger.ts` `rain.replanned` now books the unattributed remainder (`saved_m3` − Σ `by_farmer_m3`) as `canal_supply → buffer`, so the ledger accounts for the full declared saving and a mismatch surfaces in `checkConservation`. | fixed | `models.audit.test.ts` F-08 test: red (2 entries / 200 m³) → green (3 entries / 500 m³). |

## Verification

- Revision: `main` @ `c1c888` + uncommitted remediation changes.
- Command: `CI=true pnpm --filter @jadal/core typecheck` → clean (exit 0).
- Command: `CI=true pnpm --filter @jadal/core test` → **160 passed (160)**, 10 files.
- Command: `CI=true pnpm --filter api test` → **539 passed (539)**, 36 files (no regression in the API consumer).
- Not verified: the API's live `rain.cron` path (covered by `rain.test.ts`, which passes); no contract change was made or needed.
