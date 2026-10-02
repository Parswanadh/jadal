# Swarm record — cropparams-provenance (handoff §5 P6)

**Agent lane:** `ws/swarm-cropparams-provenance` · **LANE_SCOPE:** `packages/core|docs`
**Budget:** 25 min wall clock. **REAL_TELEPHONY is false** — no call was placed, no external
service or Twilio endpoint was touched, no network was used by any test.

## What changed

| Path | Change |
| :--- | :--- |
| `packages/core/src/data/crop-params-provenance.ts` | **new.** Shared checker: field→`source`-clause map, `pagesIn()` page parser, `provenanceRows()` verdicts, `checkAll()` violations. No water arithmetic, no value mutation. |
| `packages/core/src/data/crop-params.provenance.test.ts` | **new.** 10 vitest tests over the *shipped* JSON: every field tagged; no MEASURED field cites a page outside `1..401` or cites none; non-vacuity guards; redgram retagging + retention. |
| `packages/core/src/data/crop-params.json` | **edited, metadata only.** `redgram`: all 7 present fields retagged `UNSOURCED` (were `MEASURED`); `source` rewritten to record that the old `p. 410` citation is invalid. **No numeric value changed.** |
| `packages/core/scripts/generate-crop-params-provenance.ts` | **new.** Rerunnable generator (COMPUTED) for the provenance table. |
| `packages/core/package.json` | added `gen:provenance` script. |
| `docs/research/crop-params-provenance.md` | **new, generated.** crop × field → value, status, source, finding (156 lines, 109 rows). |

`packages/contracts` was **not touched**. `constant_status` already exists in the shipped JSON as an
untyped extra key; adding it to the contract would be a separate additive `contracts-ok` change
(noted under *Left for a human*).

## Commands run, with observed output

### RAN — generator is rerunnable and idempotent

```
$ pnpm --filter @jadal/core gen:provenance
wrote /home/parshu/projects/cis/jadal-w-cropparams-provenance/docs/research/crop-params-provenance.md
  rows=11 fields=109 MEASURED=59 ASSUMED=43 UNSOURCED=7 violations=0
$ git status --porcelain --untracked-files=all      # immediately after the rerun
(no output — byte-identical output, no drift)
```

### RAN — the requested full core suite

```
$ pnpm --filter @jadal/core exec vitest run --maxWorkers=1
Test Files  10 passed (10)
     Tests  162 passed (162)
```

Baseline before this lane was 152 core tests; the +10 are the new provenance tests.

### RAN — the new provenance test, verbose

```
$ pnpm --filter @jadal/core exec vitest run src/data/crop-params.provenance.test.ts --maxWorkers=1 --reporter=verbose
 ✓ loads the shipped table
 ✓ every agronomic field carries a valid constant_status tag
 ✓ no MEASURED field cites a page outside 1..401 (or cites no page at all)
 ✓ the check is not vacuous: a synthetic p. 410 MEASURED row IS flagged
 ✓ the check is not vacuous: an untagged synthetic field IS flagged
 ✓ parses both single pages and page ranges
 ✓ still ships the row with every numeric value unchanged
 ✓ tags every redgram field UNSOURCED, not MEASURED
 ✓ records the invalid p. 410 citation honestly, including the 401 page ceiling
 ✓ the page ceiling used by the check matches the document end
 Test Files  1 passed (1)      Tests  10 passed (10)
```

### RAN — typecheck

```
$ pnpm --filter @jadal/core typecheck
$ tsc --noEmit
(no output — clean)
```

### RAN — no numeric value changed (diff is metadata-only)

```
$ node --input-type=module -e "<deep-compare each row minus source/constant_status>"
numeric/structural payload identical (source+constant_status excluded): true
```

The compare was `27a3b7e:…/crop-params.json` (pre-lane) vs the working file, stripping `source` and
`constant_status`. It is `true`, so the only deltas are provenance metadata.

### COMPUTED — shipped-table counts (from the generator)

| Metric | Value |
| :--- | ---: |
| Crop rows | 11 |
| Tagged agronomic fields | 109 |
| MEASURED / ASSUMED / UNSOURCED | 59 / 43 / 7 |
| Provenance violations | 0 |

The 7 `UNSOURCED` fields are exactly the redgram row's present fields.

## READ — sources for the decisions

- **Page ceiling 401.** `docs/research/model-audit.md` §8.2: the unabridged FAO-56 Rev.1 (2025)
  text's last printed page is 401 (Selected Bibliography); `p. 410` therefore does not exist. This
  is a READ constant (`MAX_SOURCED_PAGE = 401`), not a computed one.
- **The p. 410 citation history.** `docs/research/model-audit.md` §8.2 / F-15 and
  `docs/architecture/models.md` §3.8 record that the whole `redgram` row was unsourced and that its
  earlier `source` string cited `p. 410`, and that `grep -ni "pigeonpea|Cajanus|red gram|redgram"`
  over the 2025 text returns nothing.
- **Redgram values retained.** `docs/research/model-audit.md` §8.3: the prior audit explicitly did
  **not** delete or rewrite values, only tagged them.

## What a reader should not over-claim

- The new test verifies that *the page number a `source` clause names* is inside the document; it
  **cannot** verify that the book actually contains the number. A human still has to spot-check the
  values against the text (audit §8.1 did this for 10 of 11 crops; redgram was not in that set).
- The test is deliberately stricter than the literal handoff wording: a MEASURED field must cite
  **at least one** page, not merely avoid a page > 401. A MEASURED field with no page is treated as
  a violation. This was a judgement call; it can be relaxed if an owner wants.
- `UNSOURCED` is a third status value alongside `MEASURED`/`ASSUMED`. It is inert JSON today — no
  code reads `constant_status` (grep of `packages/core` finds only the data file), so nothing
  downstream changed.

## Left for a human / needs an owner decision

1. **Redgram replacement.** `redgram` has no FAO-56 row. Whether to replace the row with a sourced
   regional proxy (e.g. ANGRAU) or drop the crop is an agronomy/product decision, not a code one.
   Values are retained untouched meanwhile.
2. **Rice `depletion_p` (0.20) and `percolation_mm_day` (3.5 / 2.0).** Still `ASSUMED`; if an
   owner supplies a citable paddy source, retag to `MEASURED` and add the page.
3. **`stage_days` (all 44/45 values).** The 2025 edition abolished static calendars; the 1998 vs
   2025 choice (P5/P6) remains an owner decision.
4. **Type `constant_status` in the contract.** Currently an untyped extra key. Making it a
   validated additive field in `packages/contracts/src/entities.ts` needs the `contracts-ok` label;
   this lane did not touch contracts.
5. **Page-range semantics.** `pagesIn` reads `pp. 168-170` as only its two endpoints (168, 170),
   not the interior (169). Interior pages cannot be out of range if the endpoints are in range, so
   no false negative is possible for the ceiling check; noted for transparency.

## Provenance of this document's own history

The swarm harness auto-created two `chore(cropparams-provenance): checkpoint` commits while this lane
ran: `8b5f3c8` (the three `src/data` files) and `f4c16d1` (script, package.json, generated doc). The
base was `27a3b7e` (`docs: engineering handoff`). This file is committed separately with a
conventional message.
