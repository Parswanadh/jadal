# ADR: the groundnut worked example (462.12 m³ vs the shipped table's 417.69 m³)

Status: **NEEDS-OWNER-DECISION** (not accepted; an owner must pick A or B).
Related: `docs/research/model-audit.md` F-01 · `docs/architecture/models.md` F-01 ·
`docs/HANDOFF-ENGINEERING.md` P5 · tests: `packages/core/src/crop.test.ts`
(`DOC-ONLY … 462.12` and `SHIPPED crop-params.json … 417.69`), `packages/core/src/models.audit.test.ts`
(`reproduces the documented groundnut case` / `F-01: the SHIPPED groundnut params`).

This ADR does **not** change any `kc` or root-depth value. The handoff reserves that to an owner.

## Context

The groundnut worked example in `docs/research/fao56-model.md` §5.2 (and summarised in the core
READMEs) claims a weekly gross irrigation volume of **462.12 m³** for 1.0 ha of groundnut in the
mid-season week. The shipped `packages/core/src/data/crop-params.json` groundnut row, which is what
production actually reads, gives **417.69 m³** for the identical weather, plot, and efficiency.

For a long time the divergence was invisible because the only test that asserted 462.12 supplied its
own hand-typed `CropParams` (`kc_mid: 1.1325`, `root_depth_m: {0.5, 0.8}`) that appears in no data
file, inside a ±0.5 m³ window. A shipped-parameter test now pins the real value, so the gap is
visible; see `packages/core/src/crop.test.ts`.

## What actually differs (READ + COMPUTED)

The divergence is entirely in two table inputs, not in the arithmetic. The engine was run on both
parameter sets with the same inputs (1.0 ha `sandy_loam`, `Ea = 0.65`, 7 days at ET₀ 5.0 mm/day with
a 15 mm storm on day 3, mid-season).

| Input | Doc §5.2 (`fao56-model.md`) | Shipped `crop-params.json` | FAO-56 source |
| :--- | :--- | :--- | :--- |
| `kc_mid` | 1.1325 (climate-adjusted from 1.15) | **1.05** | Table 6.2 prints 1.05 (READ, model-audit F-01) |
| `root_depth_m.max` | 0.80 (mid-season Z_r) | **1.00** | Table 6.2 prints 0.50–1.00 (READ, model-audit F-01) |
| `max_height_m` | 0.40 | 0.50 | Table 6.2 prints 0.50; only affects the climate adjustment |
| `stage_days` | 25 / 35 / 45 / 25 | 25 / 35 / 45 / 25 | identical (both ASSUMED, F-15) |

**COMPUTED** (Python, from the inputs above; the engine reproduces both — see the two `crop.test.ts`
tests):

| Quantity | Doc inputs | Shipped inputs |
| :--- | ---: | ---: |
| Weekly ET_c | 39.6381 mm | 36.7500 mm |
| P_eff (0.8·(15−3)) | 9.6000 mm | 9.6000 mm |
| I_net | 30.0381 mm | 27.1500 mm |
| I_gross = I_net / 0.65 | 46.2124 mm | 41.7692 mm |
| **V_gross** | **462.1240 m³** | **417.6923 m³** |
| TAW (1000·0.13·Z_r) | 104.00 mm | 130.00 mm |
| p_adj = 0.50 + 0.04·(5 − ET_c,daily) | 0.4735 | 0.4900 |
| RAW = p_adj·TAW | 49.2437 mm | 63.7000 mm |
| V_min_event = 10·RAW/E_a | 757.59 m³ | 980.00 m³ |
| V_max_event = 10·TAW/E_a | 1600.00 m³ | 2000.00 m³ |

**COMPUTED** gap: 462.1240 − 417.6923 = **44.4317 m³**.
Expressed against the documented figure that is **9.615 %**; expressed against the shipped figure it
is **10.637 %**. The handoff's "10.6 % low" is the second base ("the shipped number is 10.6 % below
the doc"), and both are recorded here so the number cannot be quoted ambiguously.

## Option A — update the doc to the shipped behaviour

Change `docs/research/fao56-model.md` §5.2 and the summary in the core README to state **417.69 m³**,
and keep the arithmetic chain (ET_c 36.75 → I_net 27.15 → I_gross 41.769 → V 417.69). Optionally keep
the 462.12 case as a clearly labelled *climate-adjusted* variant rather than the headline number.

- **Numbers:** doc headline 462.12 → 417.69; bounds 757.59/1600.00 → 980.00/2000.00 (COMPUTED/READ).
- **Cost:** documentation-only; no code, no contracts, no retagging. The shipped value stays
  provenance-clean: `kc_mid` 1.05 and `root_depth_m` 0.50–1.00 are tagged `MEASURED` and are the
  values FAO-56 Table 6.2 prints.
- **Risk:** the published example no longer demonstrates the climate adjustment (F-04). The
  adjustment exists in `adjustKcForClimate` but is opt-in; using it needs wind and humidity, which
  `WeatherDay` does not carry (contract change).

## Option B — change the table to reproduce 462.12

Set the groundnut row to `kc_mid: 1.1325` and `root_depth_m.max: 0.8`, so the shipped engine returns
the documented 462.12 m³.

- **Numbers:** shipped result 417.6923 → 462.1240; TAW 130 → 104; RAW 63.70 → 49.24; event bounds
  980/2000 → 757.59/1600.00 (COMPUTED from the table change).
- **Cost / risk:**
  - `kc_mid: 1.1325` is not a tabulated FAO-56 value; it is 1.15 adjusted by Eq. 6.18 for
    u₂ = 2.2 m/s, RH_min = 55 %, h = 0.40 m. Hard-coding a site-specific climate adjustment into a
    shared table makes every plot in every climate use Kondaveedu's wind and humidity, and would
    require re-tagging `kc_mid` from `MEASURED` to `ASSUMED` (regressing F-15/P6 provenance).
  - `root_depth_m.max: 0.8` replaces the tabulated seasonal maximum (0.50–1.00) with a mid-season
    value, and would likewise need re-tagging from `MEASURED`.
  - Preferable sub-option **B2**: make the climate adjustment live end-to-end instead of editing the
    table — supply wind/humidity to `weeklyNeed`. That is an **additive `packages/contracts` change**
    (`WeatherDay`), so it needs the `contracts-ok` label and is out of scope for this lane.
- **Upside:** the published worked example and the running code agree without editing a doc.

## Recommendation

**Option A.** The shipped values (1.05, Z_r ≤ 1.00, h 0.50) are the ones FAO-56 Table 6.2 actually
prints and are tagged `MEASURED`; the doc's 1.1325 depends on a climate adjustment the data model
cannot yet carry (F-04). Correcting the doc is the smallest, provenance-preserving change, and the
462.12 arithmetic remains available as a clearly labelled climate-adjusted variant. If the owner wants
the 462.12 number to be the *production* number, the right route is B2 (make Eq. 6.18 live via a
`contracts-ok` addition), not a hard-coded table edit.

**Decision required from the owner:** pick A or B (and B1 vs B2). Until then the status stays
`NEEDS-OWNER-DECISION`; no `kc`/`Zr` value was changed and the doc still carries 462.12.
