# Telugu native-speaker review pack

**Handoff P10** — "Telugu copy is machine-written — needs a native speaker for
`apps/web/src/i18n/te.json` and `apps/api/src/voice/telugu.ts`."

This pack is a **review aid**. It does not fix anything: **no string was edited** to
produce it. It extracts every Telugu string with its English source, file and
UI/voice context so a native Telugu speaker can review the copy in one pass.

| Artifact | What it is |
|---|---|
| [`telugu-native-review.csv`](./telugu-native-review.csv) | 680 review rows: `key,file,en,te,context,auto_flag,reviewer_ok,reviewer_fix` |
| [`build_pack.mjs`](./build_pack.mjs) | the extraction script (offline, deterministic, rerunnable) |

## What is in the pack

COMPUTED with `node docs/review/build_pack.mjs`:

```
te.json leaves: 600  en.json leaves: 600  key parity: true
voice rows: 80
total rows: 680
flagged rows: 16
flags: {"te_equals_en":6,"latin_not_brand_unit":2,"no_en_pair":10}
wrote .../docs/review/telugu-native-review.csv
```

- **600 rows** from `apps/web/src/i18n/te.json` (every leaf key; `en.json` has the
  same 600 keys, so en/te parity holds — READ and COMPUTED).
- **80 rows** from `apps/api/src/voice/telugu.ts`. Each row is one Telugu string
  literal, paired with the matching English literal from the parallel `…En`
  builder (or the `…_EN` constant). Because the builders are TypeScript templates,
  the row text is the **literal fragment**; runtime values (`${farmerName}`,
  `${volume}`, clock times) are shown as `${…}` and are not clouding the review.
- **16 flagged rows** that the script found mechanically suspicious. A flag is a
  prompt to look, not a verdict — for example `te === en` on `controls.langOptionEn`
  (`"EN"`) is correct.

### Row key convention

| Source | `key` example |
|---|---|
| i18n | `mywater.nextTurn` (dotted JSON path) |
| voice builder literal | `voice.rosterChange[1]` (builder + occurrence index) |
| voice constant | `voice.INBOUND_PROMPT` |
| voice label object | `voice.ALERT_LABEL.warning` |
| voice honorific list | `voice.TRAILING_HONORIFICS[2]` |

Keys are stable for a given revision of the two source files. Re-running the
script after any copy change produces new indices for changed builders — re-review
the diff, do not assume old indices still point at the same string.

## How to review

1. Open `telugu-native-review.csv` in a spreadsheet (it is RFC-4180 quoted, so
   commas and embedded quotes inside a string are safe).
2. Read each row and fill **`reviewer_ok`** with `ok`, `fix`, or `doubt`. Leave it
   blank when unreviewed.
3. When it is not `ok`, put the corrected Telugu in **`reviewer_fix`** (full
   replacement text for that `te` value) and a one-line reason. Do not overwrite
   the `te` column — it is the machine-written original and is the audit trail.
4. Pay first attention to the 16 rows with a non-empty `auto_flag`, then the
   high-traffic strings: `voice.alert*` (spoken on every alert), the honest-failure
   constants (`voice.NOT_UNDERSTOOD`, `voice.CALLER_UNKNOWN`,
   `voice.SCHEDULE_HOLD`, `voice.REQUEST_FAILED`), the inbound prompt, and the
   `nav` / `login` / `mywater` / `coord` i18n namespaces.
5. Hand the reviewed CSV back to engineering. Applying a fix is a separate code
   change in `apps/web/src/i18n/te.json` or `apps/api/src/voice/telugu.ts`; it must
   keep en/te parity (600/600) and, for voice, keep the `…Te`/`…En` builders
   symmetric. This pack deliberately does not apply those edits.

### `auto_flag` reference

| Flag | Meaning |
|---|---|
| `empty_te` | `te` is empty or whitespace |
| `te_equals_en` | `te` is character-identical to `en` (review whether that is intended) |
| `latin_not_brand_unit(…)` | Latin letters outside the brand/unit allow-list (`Jadal`, `IST`, `m`, `mm`, `cm`, `km`, `m3`, `HH`, `MM`) |
| `placeholder_mismatch` | i18n `{placeholders}` (or voice interpolation slot counts) differ from English |
| `no_en_pair` | the Telugu string has no English source (honorific suffixes, arrays) |
| `literal_index_mismatch` | a Te/En builder had different literal counts; pairing may be off — inspect manually |

COMPUTED flags observed on this revision: 6 `te_equals_en`, 2
`latin_not_brand_unit`, 10 `no_en_pair`. There were **zero** `empty_te`,
`placeholder_mismatch`, and `literal_index_mismatch` rows, which is evidence that
en/te placeholders line up and no builder pair is out of step at this revision.

The 10 `no_en_pair` rows are the honorific heuristics and constants
(`FEMININE_NAME_ENDINGS`, `TRAILING_HONORIFICS`, `NEUTRAL_VOCATIVE`,
`FEMININE_VOCATIVE`); they are Telugu morphology with no English equivalent by
design. `voice.rosterChange[0]` etc. are not in this group.

## Rerunning / verifying

```bash
# regenerate the CSV exactly (no network, no writes outside docs/review/)
node docs/review/build_pack.mjs

# prove the flag logic on synthetic inputs
node docs/review/build_pack.mjs --self-test
```

RAN — `--self-test` output on this revision:

```
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

The script reads only `te.json`, `en.json` and `telugu.ts`; it never touches the
network, `.dev.vars`, Twilio, or any secret (verified by inspection — the only
`fs` calls are `readFileSync` on those three paths and `writeFileSync` on the CSV).

## Limits / what this pack is not

- **It is not a translation.** No string was changed. A native speaker must still
  judge meaning, register, dialect (this command area is Rayalaseema / Western
  Andhra), and whether the `గారు` / `గుడి` honorific heuristic is acceptable.
- **Voice rows are fragments, not rendered sentences.** A builder joins fragments
  at runtime (`join(...)`), so a reviewer should mentally assemble e.g.
  `voice.nightReleaseWarning[0..3]` with the shared fragments
  (`voice.greeting*`, `voice.outletClause*`, `voice.windowClause*`,
  `voice.volumeClause*`, `voice.dayClause*`). The shared fragments are included so
  they are reviewed once rather than 12 times.
- **Doc-comment Telugu was intentionally skipped.** `telugu.ts` discusses Telugu
  terms in its comments; those are not user-visible and are not in the CSV.
- **Owner decisions left open** (documented, not decided here):
  1. Who is the accountable native reviewer, and on what SLA?
  2. Should `reviewer_fix` text be applied directly by an engineer, or routed back
     through the normal i18n change process with a second reviewer?
  3. Are the 6 `te_equals_en` rows all intended (locale endonyms, numeric formats)?
     A human must confirm; the script must not guess.
  4. `apps/api/docs/VOICE.md` describes the Telugu call script; it should be
     reconciled with the reviewed strings once the review lands.
