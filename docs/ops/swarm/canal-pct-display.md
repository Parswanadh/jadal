# canal-pct-display — planned need-met above 100% in the web UI

**Lane:** `ws/swarm-canal-pct-display` · **Scope:** `apps/web` · **Date:** 2026-10-02
**Follows:** `docs/ops/swarm/gini-planned.md` "What is left" item 2 and
`docs/decisions/ADR-need-met-planned.md`.

## What changed

The API's `need_met.pct` for `equal_hours` is now the **un-capped planned need-met**, so it can
exceed 100 (shipped seed: head **280.8%**, tail **205.5%**). The web UI assumed `pct ≤ 100`.

| File | Change |
|---|---|
| `apps/web/src/lib/needMetDisplay.ts` (new) | Display-only helpers: `barWidthPct` clamps a bar width to `[0,100]`; `isOverAllocated` flags `pct > 100`; `needMetBand` returns `low/mid/high/over`. No water arithmetic, no number change. |
| `apps/web/src/lib/needMetDisplay.test.ts` (new) | Unit tests for pct = 98, 100, 205.5, 280.8 plus boundary/non-finite cases. |
| `apps/web/src/canal/canalPctDisplay.test.tsx` (new) | SSR render test of the real `CanalVisual` at those four values: bar width clamped, over-allocated label shown, shown number unchanged. |
| `apps/web/src/canal/CanalVisual.tsx` | Bar width `Math.min` via helper (was `${r.pct}%`, could overflow); `data-band="over"`; explicit over-allocated pill; `aria-label` uses `canal.rowLabelOver` when over. |
| `apps/web/src/canal/canal.css` | `.canal-fill[data-band="over"]` hatched accent fill; `.canal-over-pill` spacing. |
| `apps/web/src/coordinator/RosterCompare.tsx` | Roster comparison meter now uses the shared helper, `data-over`, over-allocated pill on each row and on the "Last farm gets" figure; `aria-label` uses `coord.roster.needMetLabelOver`. |
| `apps/web/src/components.css` | `.meter-fill[data-over="true"]` hatched accent style. |
| `apps/web/src/i18n/en.json`, `te.json` | 4 new keys (2 per surface): `canal.rowLabelOver`, `canal.overAllocated`, `coord.roster.needMetLabelOver`, `coord.roster.overAllocated`. Exact en/te parity. |

`MyWater.tsx` / `LedgerAudit.tsx` were inspected but **not changed**: they render
`need_met_pct` from `GET /api/ledger` (the **delivered**, still-capped `rosterEngine.needMet`), which
cannot exceed 100. Only the planned/proposal surfaces are affected.

The number shown is never altered: the raw `pct` is passed through unchanged, only the bar width is
clamped and the over-allocated state is labelled.

## Evidence

All commands run from the worktree root. Labels: RAN (command + observed output), READ.

**New tests — RAN**

```
$ pnpm --filter web exec vitest run src/lib/needMetDisplay.test.ts src/canal/canalPctDisplay.test.tsx src/i18n/i18n.test.ts --maxWorkers=1
 ✓ src/canal/canalPctDisplay.test.tsx (4 tests) 19ms
 ✓ src/i18n/i18n.test.ts (9 tests) 114ms
 ✓ src/lib/needMetDisplay.test.ts (14 tests) 3ms
 Test Files  3 passed (3)     Tests  27 passed (27)
```

The four required values are pinned test-by-test (98/100 not over, 205.5/280.8 clamped to 100 and
labelled). The i18n suite passing includes the en/te key-parity and placeholder-parity checks.

**Regression — RAN**

```
$ pnpm --filter web exec vitest run src/canal/canal.test.ts --maxWorkers=1
 Test Files  1 passed (1)     Tests  5 passed (5)
```

**Typecheck — RAN**

```
$ pnpm --filter web typecheck
$ tsc --noEmit        # exit 0
```

**Refuted/confirmed:** READ `apps/web/src/farmer/MyWater.tsx:124`, `apps/web/src/coordinator/LedgerAudit.tsx:78`,
`apps/web/src/farmer/farmerApi.ts:143` — these read `need_met_pct` from the ledger (delivered), so
they are out of scope for the un-cap change. READ `apps/web/src/api/mock.ts:319` still emits an
illustrative `≤ 98` pattern; it is mock-only and unaffected.

## What is left / needs a human

1. **Telugu copy is machine-written.** The two new Telugu strings ("అధిక కేటాయింపు" = over-allocated,
   and the two aria sentences) need a native-speaker review, like the rest of `te.json`.
2. **Preferred follow-up contract change** (needs `contracts-ok`): explicit `planned_pct` /
   `delivered_pct` fields per the ADR, so the UI stops overloading `pct`. Deferred here to avoid
   touching `packages/contracts`.
3. **`RosterCompare` has no component test** (no testing-library in `apps/web`); its meter change is
   covered by the shared helper tests and by typecheck, not by a rendered assertion. The new
   `canalPctDisplay.test.tsx` uses `react-dom/server` (no new dependency).
