# Swarm lane report — telugu-review-pack

**Branch:** `ws/swarm-telugu-review-pack` · **Lane scope:** `docs` · **Handoff item:** P10
("Telugu copy is machine-written — needs a native speaker")
**Status:** complete for the extraction/review-pack objective. No string edited.

## What changed

| Commit | Change |
|---|---|
| `d86a072` | `docs(review): add Telugu native-speaker review pack (P10)` |

New files (all under `docs/`, the lane's allowed scope):

- `docs/review/build_pack.mjs` — rerunnable, offline extraction + flag script (COMPUTED).
- `docs/review/telugu-native-review.csv` — 680 review rows:
  `key,file,en,te,context,auto_flag,reviewer_ok,reviewer_fix`.
- `docs/review/telugu-native-review.md` — how to review, flag reference, limits,
  open owner decisions.

Harness auto-checkpoints `b587dee`, `3b39314`, `12befc8` are snapshots of the same
in-progress files; they contain no independent work.

No source string, contract, or test was touched (`git show --stat` above).

## Evidence

### RAN — extraction

```
$ node docs/review/build_pack.mjs
te.json leaves: 600  en.json leaves: 600  key parity: true
voice rows: 80
total rows: 680
flagged rows: 16
flags: {"te_equals_en":6,"latin_not_brand_unit":2,"no_en_pair":10}
wrote .../docs/review/telugu-native-review.csv
```

### RAN — flag-logic self-test

```
$ node docs/review/build_pack.mjs --self-test
PASS  empty te: auto_flag="empty_te"
PASS  te == en: auto_flag="te_equals_en;latin_not_brand_unit(Water)"
PASS  latin not brand/unit: auto_flag="te_equals_en;latin_not_brand_unit(Water|point)"
PASS  brand/unit latin ok: auto_flag="te_equals_en"
PASS  i18n placeholder differ: auto_flag="latin_not_brand_unit(water);placeholder_mismatch"
PASS  i18n placeholders match: auto_flag="te_equals_en;latin_not_brand_unit(water)"
PASS  voice slots match: auto_flag=""
PASS  voice slots differ: auto_flag="placeholder_mismatch"
PASS  clean telugu: auto_flag=""
self-test: all PASS
```

### COMPUTED — CSV integrity

```
header: key|file|en|te|context|auto_flag|reviewer_ok|reviewer_fix
data rows: 680   bad field counts: 0   duplicate keys: 0   unique keys: 680
```

### COMPUTED — independent cross-check of the voice extraction

A separate, from-scratch scan of `telugu.ts` (comments stripped, code string
literals only, Telugu block test) found **81** Telugu literal occurrences. The
pack emits **80** rows. The single difference is one nested template literal
(`` `…${volume.length === 0 ? "" : `${volume} `}…` ``) that the crude independent
regex splits in two at the inner backtick, while `build_pack.mjs`'s scanner keeps
it as one literal. **80 == 81 − 1**, so no code string was dropped.

### READ — source revision

Extraction ran against the worktree's `apps/web/src/i18n/{en,te}.json` and
`apps/api/src/voice/telugu.ts` at `d86a072`'s parent. i18n parity 600/600 was
asserted by the script (COMPUTED) and matches the handoff's stated "600/600".

## Bugs found and fixed while building (so the numbers are trustworthy)

Four extraction defects were caught by cross-checking, all fixed before the final
commit — recorded here because they are exactly the kind of quiet error the
handoff's evidence standard warns about:

1. Empty `""` literals from "omit when unknown" ternaries shifted Te/En index
   pairing. Fixed by filtering non-visible literals on both sides.
2. The `literal_index_mismatch` flag was computed but never attached to rows
   (the `push` helper recomputed `auto_flag`). Fixed.
3. `"emergency"` / `"urgent"` discriminator tokens appear in both the `alertTe`
   and `alertEn` bodies and skewed pairing. Now dropped as code (common to both
   scopes), not copy.
4. Non-`export`ed helper builders (`greetingTe`, `outletClauseTe`,
   `windowClauseTe`, `volumeClauseTe`, `dayClauseTe`) were skipped; their shared
   fragments are now included (7 rows).

## What is left / needs a human

- **A native Telugu speaker must fill `reviewer_ok` / `reviewer_fix`.** This lane
  cannot decide copy quality; that is the whole point of P10.
- **Owner decisions** (documented in the pack's `.md`, not decided here):
  1. accountable reviewer and SLA;
  2. whether `reviewer_fix` is applied directly or routed through a second reviewer;
  3. confirm the 6 `te_equals_en` rows (locale endonyms, numeric/format strings)
     are intentional;
  4. reconcile `apps/api/docs/VOICE.md` with the reviewed strings after the review.
- **Applying fixes is a separate, out-of-lane change** touching
  `apps/web/src/i18n/te.json` / `apps/api/src/voice/telugu.ts`; it must keep
  en/te parity and Te/En builder symmetry.
- No tests were run: no package source changed, and the script is dependency-free
  (`node` built-ins only). `node --version` is not pinned in this report.

## Explicitly not done (hard rules)

- Did not touch `packages/contracts`.
- Did not create, read or print `.dev.vars` or any secret.
- Did not place a call or hit Twilio or any external service; the script performs
  no network I/O.
- Staged explicit paths only; `git add` was invoked with the three file paths, never
  `-A`/`.`.
- Did not edit any user-visible string.
