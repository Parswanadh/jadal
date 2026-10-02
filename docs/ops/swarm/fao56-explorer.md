# FAO-56 Crop Parameter Explorer & Documentation Alignment

**Date:** 2026-10-02  
**Branch:** `integration/swarm-2026-10-02`  
**Author:** Slave Agent (Gemini via agy)  
**Standard:** All commands and outputs labelled `RAN`, `READ`, `COMPUTED`.  

---

## 1. What Was Built

### 1.1 Deliverable 1: FAO-56 Crop Parameter Explorer
- **Generator Script:** `showcase/deck/build_explorer.py`  
  A deterministic, rerunnable Python generator (no network calls) that ingests both tracked repository research documents and the local unabridged FAO-56 Rev.1 (2025) text (`/home/parshu/projects/cis/jadal/.ref/fao56-book/FAO56-full.txt`), parses crop parameters, cross-validates against shipped constants in `packages/core/src/data/crop-params.json`, performs automated sanity checks, and outputs both structured JSON and single-page HTML.
- **Dataset File:** `showcase/deck/fao56-data.json`  
  Full JSON database tracking:
  - 70 crop rows parsed from Table 6.2 of FAO-56 Rev.1 (2025) (pp. 168–170).
  - 49 crop rows parsed across three tracked research extracts in the repository (17 in `fao56-book-reference.md` §3, 23 in `fao56-crop-tables.md` §2.1, 9 in `fao56-model.md` §3).
  - Cross-validation results and constant status mappings for all 11 shipped rows (10 crops).
- **Interactive UI:** `showcase/deck/fao56-explorer.html`  
  A standalone, self-contained HTML page served at `http://127.0.0.1:5190/deck/fao56-explorer.html` featuring:
  - Claude-style aesthetic (surfaces `#FFFFFF` and `#FAF9F5`, ink `#1F1E1D`, secondary `#73726C`, border `#E8E6DC`, accents `#D97757` and `#C15F3C`).
  - Strict WCAG AA contrast compliance (computed via script; lowest normal text ratio is 4.56:1, large header accent text is 4.01:1 against 3.0:1 threshold).
  - Typography in "Source Serif 4" and "Inter", minimum body size 18px (`1.125rem`).
  - Search filtering by crop name, botanical name, group, and source citation.
  - Multi-attribute filtering (Group headings, Data sources, and "Shipped in Jadal" toggle).
  - Sortable table columns with accessible keyboard navigation and live `aria-sort` toggling.
  - Constant status tags (`● MEASURED`, `○ ASSUMED`, `✕ UNSOURCED`), "Differs from book" warnings, and "Parse uncertain" flags.
  - Responsive down to 390px mobile viewport with zero horizontal page overflow.

### 1.2 Deliverable 2: Documentation & Deck Alignment
- **Evaluator Brief (`docs/EVALUATOR-BRIEF.md`):**
  - Updated all slide-number references to match the 16-slide sequence (slide 15 closing, slide 16 appendix; slide 10 trust strip, slide 12 voice caveats).
  - Added new section `### (d2) Model and physics questions` detailing Laya vs. LLM selection, failure modes, unvalidated Telugu status, live demo AI tier (Laya ON, Jev OFF, rules floor), FAO-56 rationale, provenance accounting (59 MEASURED, 43 ASSUMED, 7 UNSOURCED), and honest coverage bounds.
  - Added Flooded Rice worked example reproducibility evidence ($ET_c = 42.0\text{ mm}$, net $51.5\text{ mm}$, gross $64.375\text{ mm}$, $643.75\text{ m}^3/\text{ha}$) and recorded non-reproduction of the groundnut example ($417.69\text{ m}^3$ shipped vs $462.12\text{ m}^3$ in doc).
  - Added explorer link `http://127.0.0.1:5190/deck/fao56-explorer.html` to companion files.
- **Case Study Plan (`docs/CASE-STUDY-PLAN.md`):**
  - Updated deck count to 16 slides and updated notes reference from slide 13 to slide 15.
  - Added explorer link to header companion files.
- **Speaker Script (`showcase/deck/script.json`, `docs/SPEAKER-SCRIPT.md`, `showcase/deck/speaker-script.html`):**
  - Updated "If asked: Does the product ingest the whole book?" with real explorer counts (70 Table 6.2 rows, 49 repo extract rows, 11 shipped rows in 10 crops).
  - Ran `python3 showcase/deck/build.py` verifying 16 slides output.

---

## 2. QA Verification Runs & Observed Output

### QA 1: Generator Execution & Counts
- **Command:** `python3 showcase/deck/build_explorer.py`
- **Status:** `RAN`
- **Observed Output:**
```
Loading FAO56 text from: /home/parshu/projects/cis/jadal/.ref/fao56-book/FAO56-full.txt
Table 6.2 rows parsed: 70 (source found: True)
Tracked doc rows parsed: 49
  docs/research/fao56-book-reference.md: 17 rows
  docs/research/fao56-crop-tables.md: 23 rows
  docs/research/fao56-model.md: 9 rows
Shipped crops loaded: 11 rows
Sanity Checks for Table 6.2:
  Total parsed rows: 70
  Rows with all 3 Kc values: 69
  Rows marked parse='uncertain': 7
  Kc values outside [0.1, 1.6]: []

Spot Checks (10 randomly selected parsed rows vs .txt):
  [3] Bean > Mat bean, moth bean (Vigna aconitifolia) (p.168, lines 11937-11938)
      Parsed: Kc=(0.55, 1.05, 0.35), h={'min': 0.15, 'max': 0.25}, zr={'min': 0.8, 'max': 1.4}
      Line text: '        Mat bean, moth bean'
  [13] Fava bean (Vicia faba) (Dry) (p.168, lines 11953-11955)
      Parsed: Kc=(0.4, 1.1, 0.4), h={'min': 0.8, 'max': 0.8}, zr={'min': 0.5, 'max': 0.7}
      Line text: '       Fava bean (Vicia faba)'
  [14] Groundnut (peanut) (Arachis hypogaea) (p.168, lines 11956-11957)
      Parsed: Kc=(0.4, 1.05, 0.6), h={'min': 0.5, 'max': 0.5}, zr={'min': 0.5, 'max': 1.0}
      Line text: '       Groundnut (peanut) (Arachis'
  [17] Pea (Pisum sativum) (Dry) (p.168, lines 11959-11961)
      Parsed: Kc=(0.6, 1.1, 0.3), h={'min': 0.8, 'max': 0.8}, zr={'min': 0.6, 'max': 1.0}
      Line text: '       Pea (Pisum sativum)'
  [28] Linseed (Flax) (Linum usitatissimum) (p.169, lines 11986-11986)
      Parsed: Kc=(0.35, 0.95, 0.25), h={'min': 0.9, 'max': 0.9}, zr={'min': 1.0, 'max': 1.5}
      Line text: ' Linseed (Flax) (Linum usitatissimum)      0.35    0.95     0.25        0.90       1.00 – 1.50'
  [31] Sesame (Sesamum indicum) (p.169, lines 11989-11989)
      Parsed: Kc=(0.35, 1.05, 0.25), h={'min': 1.3, 'max': 1.3}, zr={'min': 1.0, 'max': 1.5}
      Line text: ' Sesame (Sesamum indicum)                  0.35    1.05     0.25        1.30       1.00 – 1.50'
  [35] Cattail (Typha latifolia) (p.169, lines 11995-11995)
      Parsed: Kc=(0.7, 1.15, 0.85), h={'min': 1.5, 'max': 2.0}, zr={'min': 1.0, 'max': 1.5}
      Line text: ' Cattail (Typha latifolia)                 0.70    1.15     0.85     1.50 – 2.00   1.00 – 1.50'
  [43] Barley (Hordeum vulgare) (p.169, lines 12007-12007)
      Parsed: Kc=(0.3, 1.1, 0.25), h={'min': 0.7, 'max': 0.9}, zr={'min': 0.6, 'max': 1.2}
      Line text: ' Barley (Hordeum vulgare)                  0.30    1.10     0.25     0.70 – 0.90   0.60 – 1.20'
  [47] Maize (Zea mays) (Silage) (p.169, lines 12014-12014)
      Parsed: Kc=(0.3, 1.15, 0.95), h={'min': 2.5, 'max': 3.2}, zr={'min': 0.6, 'max': 1.5}
      Line text: '  Silage                                   0.30    1.15     0.95     2.50 – 3.20   0.60 – 1.50'
  [57] Wheat, common (Triticum aestivum) (Winter, low grain moisture at harvest) (p.170, lines 12037-12041)
      Parsed: Kc=(0.7, 1.15, 0.25), h={'min': 0.7, 'max': 1.1}, zr={'min': 1.0, 'max': 1.5}
      Line text: '        Winter, low grain moisture at'

Wrote JSON dataset to: /home/parshu/projects/cis/jadal-w-merge/showcase/deck/fao56-data.json
Wrote Explorer HTML to: /home/parshu/projects/cis/jadal-w-merge/showcase/deck/fao56-explorer.html
```

### QA 2: Static Server HTTP Check
- **Command:** `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5190/deck/fao56-explorer.html`
- **Status:** `RAN`
- **Observed Output:**
```
200
```

### QA 3: Playwright Headless Chrome Validation
- **Command:** Real Chrome execution via `node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core/index.mjs`
- **Status:** `RAN`
- **Observed Output:**
```
Desktop screenshot: 1920x1080 captured
Mobile screenshot: 390x844 captured
Mobile width check: scrollWidth=390, windowWidth=390 (no overflow: true)
Search "groundnut": row count line = "Showing 4 of 119 crop parameter rows"
Toggle "Shipped in Jadal": row count line = "Showing 9 of 119 crop parameter rows"
Shipped rows displayed: 9
Click Kc mid header: aria-sort="ascending"
Second click Kc mid header: aria-sort="descending"
Row order changed: "Black and green gram (Vigna mungo) (Black gram (dry))" -> "Sugar cane (Saccharum officinarum)"
No unhandled page errors or console errors encountered.
```
- **Visual Inspection:** Screenshots verified at `/home/parshu/.gemini/antigravity-cli/brain/04cb4f53-6f46-4687-82a4-a8ecac387469/scratch/explorer-1920.png` and `explorer-390.png`. No layout breakages, clean serif headings, clear filter pills, responsive card padding, and horizontal scroll boundary contained within table element.

### QA 4: Computed Color Contrast Audit
- **Command:** WCAG 2.1 relative luminance script evaluation on all foreground/background pairs
- **Status:** `COMPUTED` & `RAN`
- **Observed Output:**
```
ink on surface: 15.80:1 (is_large=False)
ink on white: 16.64:1 (is_large=False)
sec_text on surface: 4.58:1 (is_large=False)
sec_text on white: 4.82:1 (is_large=False)
accent_deep on surface (large text 24px): 4.01:1 (is_large=True)
badge-shipped (#7A3508 on #FFE8D6): 7.59:1 (is_large=False)
badge-differs (#BF360C on #FFEBEE): 4.90:1 (is_large=False)
badge-uncertain (#6A1B9A on #F3E5F5): 7.75:1 (is_large=False)
badge-status-measured on white: 5.13:1 (is_large=False)
badge-status-assumed on white: 7.18:1 (is_large=False)
badge-status-unsourced on white: 5.62:1 (is_large=False)
exact match badge (#2E7D32 on #E8F5E9): 4.56:1 (is_large=False)
unsourced badge (#C62828 on #FFEBEE): 4.92:1 (is_large=False)
table 6.1 proxy badge (#BF360C on #FFF3E0): 5.11:1 (is_large=False)

Lowest ratio overall: accent_deep on surface (large text 24px) = 4.01:1
Pairs below 4.5 that are not large text: []
```

### QA 5: Orchestrator Number Audit
- **Command:** `python3 /home/parshu/projects/cis/jadal-integration/.ref/orch/audit_numbers.py /home/parshu/projects/cis/jadal-w-merge/showcase/deck`
- **Status:** `RAN`
- **Observed Output Summary:**
  - `fao56-explorer.html`: 0 forbidden tokens; all numbers (e.g. 70, 49, 11, 168, 170, 2025) are validly audited and checked.
  - Justification of flagged deck numbers: `index.html` contains historical review notes discussing the refuted 417.69 vs 462.12 groundnut numbers and 862 test count; `fao56-explorer.html` contains only verified book constants and citations.

---

## 3. Cross-Validation Results: Shipped Crops vs. FAO-56 Table 6.2

| Shipped Crop | Variant | Shipped $K_c$ (`ini`/`mid`/`end`) | Shipped Height / Root | Counterpart in Table 6.2 | Book Parameters | Status | Cross-Validation Finding |
|---|---|---|---|---|---|---|---|
| **rice** | flooded | 1.05 / 1.20 / 1.05 | $h=1.0\text{ m}$, $Z_r=0.5\text{--}1.0\text{ m}$ | Rice (*Oryza sativa*), Flooded | $K_c = 1.05 / 1.20 / 1.05$<br>$h=1.00\text{ m}, Z_r=0.50\text{ m}$ | `DIFFERS` | $K_c$ and height match. Root depth differs: shipped assumes $0.5\text{--}1.0\text{ m}$, whereas Table 6.2 specifies single maximum $0.50\text{ m}$. |
| **rice** | intermittent | 0.95 / 1.20 / 1.00 | $h=1.0\text{ m}$, $Z_r=0.5\text{--}0.7\text{ m}$ | Rice (*Oryza sativa*), Intermittent irrigation | $K_c = 0.95 / 1.20 / 1.00$<br>$h=1.00\text{ m}, Z_r=0.70\text{ m}$ | `DIFFERS` | $K_c$ and height match. Root depth differs: shipped assumes $0.5\text{--}0.7\text{ m}$, whereas Table 6.2 specifies single maximum $0.70\text{ m}$. |
| **maize** | — | 0.30 / 1.20 / 0.30 | $h=2.5\text{ m}$, $Z_r=0.6\text{--}1.5\text{ m}$ | Maize (*Zea mays*), Grain, low grain moisture at harvest | $K_c = 0.30 / 1.20 / 0.30$<br>$h=2.50\text{--}3.50\text{ m}, Z_r=0.60\text{--}1.50\text{ m}$ | `DIFFERS` | $K_c$ and root depth match. Height differs: shipped is scalar $2.5\text{ m}$, book specifies range $2.50\text{--}3.50\text{ m}$. |
| **groundnut** | — | 0.40 / 1.05 / 0.60 | $h=0.5\text{ m}$, $Z_r=0.5\text{--}1.0\text{ m}$ | Groundnut (peanut) (*Arachis hypogaea*) | $K_c = 0.40 / 1.05 / 0.60$<br>$h=0.50\text{ m}, Z_r=0.50\text{--}1.00\text{ m}$ | `MATCH` | Exact match on $K_c$, height, and root depth. |
| **cotton** | — | 0.40 / 1.10 / 0.50 | $h=1.2\text{ m}$, $Z_r=1.0\text{--}1.7\text{ m}$ | Cotton (*Gossypium hirsutum*) | $K_c = 0.40 / 1.10 / 0.50$<br>$h=1.20\text{ m}, Z_r=1.00\text{--}1.70\text{ m}$ | `MATCH` | Exact match on $K_c$, height, and root depth. |
| **chilli** | — | 0.60 / 1.10 / 0.80 | $h=0.75\text{ m}$, $Z_r=0.5\text{--}1.2\text{ m}$ | *None in Table 6.2* | Sourced from Table 6.1 (p. 166, Sweet peppers / Chilli pepper) | `DIFFERS` | Absent from Table 6.2 (field crops); sourced from Table 6.1 vegetable crops. |
| **sugarcane** | — | 0.40 / 1.20 / 0.80 | $h=3.0\text{ m}$, $Z_r=1.0\text{--}1.5\text{ m}$ | Sugar cane (*Saccharum officinarum*) | $K_c = 0.40 / 1.20 / 0.80$<br>$h=3.00\text{--}4.00\text{ m}, Z_r=1.00\text{--}1.50\text{ m}$ | `DIFFERS` | $K_c$ and root depth match. Height differs: shipped is scalar $3.0\text{ m}$, book specifies range $3.00\text{--}4.00\text{ m}$. |
| **greengram** | — | 0.40 / 1.10 / 0.40 | $h=0.6\text{ m}$, $Z_r=0.4\text{--}1.0\text{ m}$ | Black and green gram (*Vigna mungo*), Green gram | $K_c = 0.40 / 1.10 / 0.40$<br>$h=0.60\text{--}0.90\text{ m}, Z_r=0.40\text{--}1.00\text{ m}$ | `DIFFERS` | $K_c$ and root depth match. Height differs: shipped is scalar $0.6\text{ m}$, book specifies range $0.60\text{--}0.90\text{ m}$. |
| **blackgram** | — | 0.40 / 1.10 / 0.35 | $h=0.5\text{ m}$, $Z_r=0.6\text{--}1.0\text{ m}$ | Black and green gram (*Vigna mungo*), Black gram (dry) | $K_c = 0.40 / 1.10 / 0.35$<br>$h=0.50\text{--}0.70\text{ m}, Z_r=0.60\text{--}1.00\text{ m}$ | `DIFFERS` | $K_c$ and root depth match. Height differs: shipped is scalar $0.5\text{ m}$, book specifies range $0.50\text{--}0.70\text{ m}$. |
| **redgram** | — | 0.35 / 1.10 / 0.40 | $h=1.8\text{ m}$, $Z_r=1.0\text{--}1.5\text{ m}$ | *None in Table 6.2* | Absent from FAO-56 tables | `UNSOURCED` | Completely unsourced. Earlier repo document cited page 410 of a publication ending at page 401. |
| **chickpea** | — | 0.40 / 1.05 / 0.35 | $h=0.5\text{ m}$, $Z_r=0.7\text{--}1.0\text{ m}$ | Chickpea, garbanzo (*Cicer arietinum*) | $K_c = 0.40 / 1.05 / 0.35$<br>$h=0.50\text{--}0.70\text{ m}, Z_r=0.70\text{--}1.00\text{ m}$ | `DIFFERS` | $K_c$ and root depth match. Height differs: shipped is scalar $0.5\text{ m}$, book specifies range $0.50\text{--}0.70\text{ m}$. |

---

## 4. Parsed Rows Marked `parse="uncertain"` (7 rows)

1. `Clusterbean, guar (Cyamopsis tetragonoloba) (Seed / General)` (p. 168, lines 11946–11947): $K_c = 0.40 / 1.00 / 0.90$. Line wrapping in the source text separated numeric columns across lines without distinct sub-variant labeling.
2. `Clusterbean, guar (Cyamopsis tetragonoloba) (For green beans)` (p. 168, line 11948): $K_c = 0.40 / 1.00 / 0.40$, $h=0.80\text{--}1.50$, $Z_r=0.50\text{--}1.00$.
3. `Clusterbean, guar (Cyamopsis tetragonoloba) (For guar gum)` (p. 168, line 11949): $K_c = \text{null}$, $h=0.80\text{--}1.50$, $Z_r=0.50\text{--}1.00$.
4. `Wheat, common (Triticum aestivum) (Winter, low grain moisture at harvest)` (p. 170, lines 12037–12041): text description broken across lines 12037–12038 while numeric tokens shifted to line 12041.
5. `Wheat, common (Triticum aestivum) (Winter, high grain moisture at harvest)` (p. 170, lines 12039–12043): multi-line offset between crop label and coefficient column alignment.
6. `Wheat, durum (Triticum durum) (Winter, low grain moisture at harvest)` (p. 170, lines 12047–12049): line break on "harvest" separated header from numeric values.
7. `Wheat, durum (Triticum durum) (Winter, high grain moisture at harvest)` (p. 170, lines 12049–12050): same multi-line wrapping ambiguity.

---

## 5. Verification Boundaries & Open Findings

1. **Table 6.2 Scope:** Table 6.2 in FAO-56 covers field crops (grain legumes, fiber crops, oil crops, sugar crops, bioenergy crops, cereals/pseudocereals, and rice). It does not include vegetables (e.g. chilli, onion, tomato, cabbage), fruit trees, or forage crops, which are cataloged in separate tables (Tables 6.1, 6.3, 6.4, 6.7).
2. **Groundnut Discrepancy:** The groundnut worked example in repo documentation claims $462.12\text{ m}^3$, whereas the shipped table constants yield $417.69\text{ m}^3$ (a 10.6% difference). The explorer flags this and `packages/core/src/data/crop-params.json` was intentionally left untouched pending owner decision.
3. **Redgram Absence:** Pigeonpea / redgram does not exist anywhere in the FAO-56 text. Its parameters in the shipped table remain flagged as `UNSOURCED`.
