# Core Model Audit — `packages/core`

**Lane:** Q (`ws/B-models`), branched from `origin/ws/B9-integration`.
**Scope:** `packages/core/src/**` and this document. `apps/**` was **read but not modified**.
**Companion:** `docs/architecture/models.md` is the model reference; this document is the evidence.

## Read this first: what kind of evidence each claim is

The brief's rules of evidence are the point of this exercise, so every claim below is labelled:

| Label | Meaning |
| :--- | :--- |
| **RAN** | I executed it in this worktree and the observed output is quoted. |
| **READ** | I read it in a file. The `file:line` is given. No execution. |
| **COMPUTED** | I recomputed it by hand (Python/`tsx` arithmetic) from stated inputs. |
| **SOURCE** | I read it in the authoritative source text and quote the line. |

A **negative finding is a valid result**, and several here are negative: numbers that are not in the
source, a test that does not test what it claims, a documented value the code does not produce. They
are reported as findings, not smoothed over. Nothing in this document is restated from prose as if I
had measured it, and no source is invented.

One delegated-verification artifact is used and is explicitly flagged as such in §9 — with the one
claim in it that I refuted recorded in place.

---

## 1. Summary of findings

| ID | Model | Finding | Verdict |
| :--- | :--- | :--- | :--- |
| F-01 | crop | **The documented groundnut worked example (462.12 m³) is not produced by the shipped parameter table (417.69 m³), and the test that asserts it passes hand-typed parameters that exist nowhere in the codebase.** The rice example does hold. | **REFUTED (as a claim about the code)** |
| F-02 | hydraulics | Seepage uses an exponential decay; both documents that *specify* Jadal seepage cite the **Moritz** linear form. | Open |
| F-03 | hydraulics | Overrun losses are computed per-outlet from head discharge and not deducted in sequence, so the total can exceed what the canal carries. | Open |
| F-04 | crop | FAO-56 Eq. 6.18/6.21 ($K_c$ climate adjustment) had **no implementation at all**. | **Fixed**, but opt-in |
| F-05 | crop | Paddy $P_{eff}$ applies no weir-crest cap; rice `bounds` is `null`. | Open |
| F-06 | crop | Upland $P_{eff}$ applies no root-zone-deficit cap (the core carries no $D_r$ state). | Open |
| F-07 | ledger | Urgent approval emitted a `quota → quota` self-transfer the DB CHECK rejects. | **Fixed** |
| F-08 | ledger | `rain.replanned` never reconciles `saved_m3` against `by_farmer_m3`. | Open |
| F-09 | policy | `canGrantBuffer` returned `{ok: true}` for a `NaN` volume. | **Fixed** |
| F-10 | hydraulics | A zero or adverse bed slope produced `NaN` velocity. | **Fixed** |
| F-11 | roster | `equal_hours` delivered the entire window while `needMet` reported 100% for everyone. | **Fixed / documented** |
| F-12 | crop | README §3 documents $K_{c,end}$ for $t > L_{total}$; code returns `kc: 0` / `done`. | README corrected |
| F-13 | crop | A zero-length stage caused $0/0$ in the Kc interpolation. | **Fixed** |
| F-14 | crop params | `percolation_mm_day` does not exist in FAO-56. | Tagged ASSUMED |
| F-15 | crop params | All 44 `stage_days` values, the whole `redgram` row, and 8/9 `t_base`/`t_upper` pairs have no source. | Tagged ASSUMED |
| F-16 | triage | `triage_score = 0.15` is **not** caused by the missing LLM key. | See §7 |

---

## 2. Task 2 — independent recomputation of the worked examples

The brief asks specifically whether `packages/core/README.md`'s claims (groundnut 462.12 m³, rice
643.75 m³) hold. **Answer: the arithmetic holds for both; the code reproduces the rice figure and
does not reproduce the groundnut figure.**

### 2.1 Groundnut — the arithmetic is correct

Source of the example: `docs/research/fao56-model.md` §5.2 (READ).

**COMPUTED** (`python3`, from the §5.1/§5.2 inputs):

| Step | Working | Result |
| :--- | :--- | :--- |
| Kc adjustment bracket | $0.04(2.2-2) - 0.004(55-45)$ | $-0.0320$ |
| Height term | $(0.40/3)^{0.3}$ | $0.546363$ |
| $K_{c,mid}$ | $1.15 + (-0.0320)(0.546363)$ | $1.132516$ |
| Daily ETc | $1.132516 \times 5.00$ | $5.662582$ mm/d |
| Weekly ETc | $7 \times 5.662582$ | $39.638073$ mm |
| $P_{eff}$ | $0.8(15-3)$ | $9.600$ mm |
| $I_{net}$ | $39.638073 - 9.600$ | $30.038073$ mm |
| $I_{gross}$ | $30.038073 / 0.65$ | $46.212420$ mm |
| **$V$** | $10 \times 46.212420 \times 1.0$ | **$462.124199$ m³** → rounds to **462.12** |

**Verdict: the claim holds arithmetically.** A related sub-value in the prose is slightly off:
`fao56-model.md:361` prints $(0.1333)^{0.3} = 0.5478$; the true value is $0.5463634$ (COMPUTED).
That is a display rounding in the intermediate, not an error in the result — the final 462.12 is
reached with the correct value.

### 2.2 Groundnut — the code does *not* reproduce it

**RAN.** I built the §5.1 weather week (ET0 5.0 mm/day, 15 mm on day 3) at mid-season (t = 60..66,
sowing 2025-01-01), 1 ha of `sandy_loam`, `application_efficiency` 0.65, and called the real engine
with the **shipped** `crop-params.json` groundnut row:

```
$ npx tsx /tmp/probe2.mjs
--- groundnut, mid-season week (t=60..66) ---
  week kc = 1.05  etc_mm = 36.75 (doc: 39.638)  volume = 417.69 (claim 462.12)
  bounds: {"raw_mm":63.7,"taw_mm":130,"event_refill_m3":980,"event_cap_m3":2000}
          (doc Vmin_event=757.69, Vmax_event=1600.00)
```

**417.69 m³, not 462.12 m³** — a 44.43 m³ / **10.6%** shortfall. The cause is the parameter table,
not the arithmetic:

| Input | `docs/research/fao56-model.md` §5.2 | shipped `crop-params.json` | source of truth |
| :--- | :--- | :--- | :--- |
| `kc_mid` | 1.15 tabulated, adjusted to **1.1325** | **1.05** | Table 6.2 → 1.05 (SOURCE) |
| `root_depth_m.max` | **0.80** | **1.00** | Table 6.2 → 0.50–1.00 (SOURCE) |
| `max_height_m` | 0.4 | 0.5 | Table 6.2 → 0.50 (SOURCE) |

So the documented example was computed from a *climate-adjusted* 1.15 and a mid-season $Z_r$ of
0.80 m. The shipped table carries the **unadjusted** 1.05 and $Z_r$ 1.00 m, and — see **F-04** —
the engine had no climate adjustment to apply.

### 2.3 The passing test does not test this

**READ.** `packages/core/src/crop.test.ts:67-155` is titled *"reproduces Groundnut worked example
(§5.2) within 0.5 m3"*. At `crop.test.ts:92-102` it constructs its own inline `CropParams` literal:

```ts
const params: CropParams = {
  crop: 'groundnut',
  kc_ini: 0.4,
  kc_mid: 1.1325, // Adjusted Kc,mid from §5.2
  kc_end: 0.6,
  stage_days: { ini: 25, dev: 35, mid: 45, late: 25 },
  max_height_m: 0.4,
  root_depth_m: { min: 0.5, max: 0.8 },
  depletion_p: 0.5,
  source: 'FAO-56 (2025) Table 6.2; fao56-model.md §5.2',
};
```

Those values are typed by hand into the test. `kc_mid: 1.1325` appears in **no** data file; the
shipped table says 1.05. The test therefore verifies the *arithmetic chain* and never touches the
production parameter path — and it does so inside a **±0.5 m³** window (`crop.test.ts:141`), which
is loose enough to hide rounding disagreement.

**RAN.** With both parameter sets, side by side:

```
$ npx tsx /tmp/probe5.mjs
TEST-supplied params (kc_mid=1.1325, Zr=0.5-0.8, h=0.4):
   volume_m3 = 462.12  taw = 104  refill = 757.6  cap = 1600  kc = 1.1325
SHIPPED crop-params.json (kc_mid=1.05, Zr=0.5-1.0, h=0.5):
   volume_m3 = 417.69  taw = 130  refill = 980  cap = 2000  kc = 1.05

Delta in volume under the SHIPPED table:  44.43 m3  = 10.6%
```

**This is the most important finding in the audit.** The suite was green (85 tests) while the
documented number and the production number disagreed by 10.6%, because the test supplied its own
parameters. I have **not** adjusted the claim (the brief forbids it) and I have **not** changed the
shipped `kc_mid` — 1.05 is the value FAO-56 Table 6.2 actually prints. I added a test (F-01) that
pins the 417.69 result so the gap is visible and cannot silently regress.

### 2.4 Rice — the claim holds, and the code reproduces it

**COMPUTED**, from `fao56-model.md` §5.3:

| Step | Working | Result |
| :--- | :--- | :--- |
| Weekly ETc | $7 \times 1.20 \times 5.00$ | $42.000$ mm |
| Weekly PERC | $7 \times 3.50$ | $24.500$ mm |
| Consumptive demand | $42.000 + 24.500$ | $66.500$ mm |
| $P_{eff}$ | full storm, storage $100-35 = 65 > 15$ | $15.000$ mm |
| $I_{net}$ | $66.500 - 15.000$ | $51.500$ mm |
| $I_{gross}$ | $51.500 / 0.80$ | $64.375$ mm |
| **$V$** | $10 \times 64.375 \times 1.0$ | **$643.75$ m³** |

**RAN**, the real engine on the §5.3 inputs:

```
--- rice flooded, mid-season week (t=60..66) ---
  week kc = 1.2  etc_mm = 42 (doc: 42.000)  volume = 643.75 (claim 643.75)
  bounds = null (rice bounds are null by design)
```

**Verdict: the claim holds, and for once the test is honest** — the rice test
(`crop.test.ts:183-195`) supplies parameters that match the shipped `crop-params.json` rice row
exactly, because that row happens to be correct.

The rice maximum weekly bound in §5.3 also reproduces: $d_{max} = 51.50 + (100-50) = 101.50$ mm →
$V_{max} = 10 \times 101.50/0.80 = 1268.75$ m³ (COMPUTED).

---

## 3. F-01 detail — why the parameter path diverged

The divergence is not one bug; it is three, and they compound:

1. **The climate adjustment (F-04) was never implemented.** `fao56-model.md` §5.2 adjusts
   $K_{c,mid}$ from 1.15 to 1.1325 using FAO-56 Eq. 6.18. `crop.ts` had no code for it (READ: the
   only regex match for `RH|u2|wind|humidity` in the pre-fix file was the word "weather" at line
   103). So the documented example could never be produced from tabulated coefficients.
2. **The two crops disagree on tabulated $K_{c,mid}$.** `fao56-model.md` §3 lists groundnut
   $K_{c,mid} = 1.15$; FAO-56 Table 6.2 prints **1.05** (SOURCE, `FAO56-full.txt:11956`). The
   research document's §3 table carries an orchestrator warning that those values are **UNVERIFIED**
   (`fao56-model.md:5`). The shipped JSON correctly uses 1.05.
3. **Root depth.** §5.2 uses $Z_r = 0.80$ m mid-season; the table ships the range 0.50–1.00 m and
   the engine takes **$\max$** (1.00 m) for any week at or after the development stage. Using the
   range maximum from mid-season onward is defensible, but it is the opposite of §5.2's choice.

**Nothing here is "fixed" by editing a number.** Per the brief, the claim is left as written and the
finding is reported. The open question — which $Z_r$ the engine should use mid-season — is recorded
in `docs/architecture/models.md` §3.5 and is a modelling decision for the owner, not a typo.

---

## 4. F-04 — the missing Kc climate adjustment

**SOURCE.** FAO-56 Table 6.2's own caption states the limitation (`.ref/fao56-book/FAO56-full.txt:11926`):

> "…in the standardized subhumid climate (RHmin ≈ 45%, u2 ≈ 2 m s-1) for use with the FAO-PM ETo
> equation"

**READ.** `docs/research/fao56-crop-tables.md` §4.2.1–4.2.2 gives the adjustment and its validity
domain ($1 \le u_2 \le 6$ m/s, $20 \le \text{RH}_{min} \le 80\%$, $0.1 \le h \le 10$ m), and the
governing rule that Eq. 6.21 applies to $K_{c,end}$ **only if** $K_{c,end(Tab)} > 0.45$.

**RAN** (pre-fix): the engine returned the unadjusted value in every case, because no code path
referenced humidity or wind.

**Fix:** `adjustKcForClimate` in `src/crop.ts`, wired into `weeklyNeed` via two new **optional**
arguments `wind_u2_ms` / `rh_min_pct`. Additive and optional, so the published `CropEngine`
interface is unchanged and every existing caller compiles and behaves identically.

**Honest limitation, stated plainly:** `WeatherDay` carries no humidity or wind field, so **in
production the adjustment still never fires**. I did not add those fields because `WeatherDay` lives
in `packages/contracts`, which is immutable in this lane. The function is covered by tests and is
ready for a caller that has the data. **This is a partial fix and is labelled as one.**

**RAN**, post-fix, the documented adjustment reproduced:
`adjustKcForClimate(1.15, 0.4, 2.2, 55) = 1.1325164` — matching §5.2's 1.1325 to 6 decimals.

---

## 5. Boundary behaviour — what was actually run

**RAN** (`npx tsx`, pre- and post-fix). The brief asks for zero flow, zero area, zero duration,
division by zero and negative inputs.

### 5.1 Crop engine

| Case | Observed | Verdict |
| :--- | :--- | :--- |
| `dev = 0`, $t = 26$ (division by zero) | pre-fix `{kc: 1.05, stage: "mid"}` — already guarded by branch order; post-fix an explicit guard returns the boundary value | **Fixed** (F-13) for the negative/zero-length case that could reach the interpolation |
| $t > L_{total}$ | `{kc: 0, stage: "done"}` at $t = 131$ and $t = 10^9$ | Correct; README wrong (F-12) |
| $t \le 0$ | `{kc: 0.4, stage: "ini"}` | Documented ASSUMED extension |
| Tiny area (`1e-7` ha) | `volume_m3 = 0` | Scales to zero, no division by area |
| Empty `weather` | all depths 0, `volume_m3 = 0`, `bounds` still populated, `kc` falls back to `kc_ini` | Documented |
| `application_efficiency = 0` | post-fix and pre-fix both fall back to $E_a = 1.0$; volume finite | Guarded (contract forbids it anyway) |
| Rain 400 mm | `net_irrigation_mm = 0`, `volume_m3 = 0` | Floored correctly |
| Past harvest (`t = 200`) | `stage = "done"`, `etc_mm = 0`, `volume_m3 = 0` | Correct |

### 5.2 Hydraulics — the `NaN` path

**RAN** (pre-fix):

```
=== BOUNDARY: hydraulics zero slope / zero n ===
  velocity with bed_slope=0 -> NaN
  velocity with manning_n=0 -> NaN
  velocity with negative slope -> NaN
```

**RAN** (post-fix):

```
  velocity with bed_slope=0 -> 0
  velocity with manning_n=0 -> 0
  velocity with negative slope -> 0
```

**Why this mattered (READ):** `apps/api/src/db/schema.sql.ts:66-68` constrains
`head_discharge_m3s > 0`, `seepage_k_per_m >= 0` and `manning_n > 0` — but **not** `bed_slope`. A
zero or adverse slope could reach the core from stored data and produce `NaN` lag times, which then
propagate into roster turn `start`/`end` ISO strings as `"Invalid Date"`. Now returns 0 (F-10).

### 5.3 Roster

| Case | Observed | Verdict |
| :--- | :--- | :--- |
| Unknown `outlet_id` | `shortfall {fx: 100}`, 0 turns | Correct |
| Negative volume | no turn, **no shortfall** | Documented ASSUMED |
| Zero-length window | every demand shortfall, 0 turns | Correct |
| Closed window | every demand shortfall | Correct |
| Total demand 0, `equal_hours` | even split fallback | Documented ASSUMED |

### 5.4 Ledger and policy

**RAN.** `gini([100,0,0]) = 0.6666666666666666` (COMPUTED check: $400/(2\cdot3\cdot100) = 2/3$).
`gini([]) = gini([50]) = gini([0,0,0]) = 0`.

**RAN.** 5000 × 0.1 m³ entries → `canal_supply = 500` exactly; `checkConservation` passes at
tolerance 0.001 and fails at 100.0011.

**RAN** (pre-fix) — the policy hole:

```
  buffer, NaN vol: {"ok":true,"max_m3":25,"reason":"Buffer grant approved: NaN m³ (max allowable: 25 m³)"}
```

**RAN** (post-fix):

```
  buffer, NaN vol: {"ok":false,"max_m3":25,"reason":"Requested volume must be a finite positive number"}
```

Both checks in `canGrantBuffer` compared false against `NaN`, so a `NaN` volume was **approved** and
would have reached the ledger as a `NaN` movement (F-09).

---

## 6. F-11 — the `equal_hours` finding, traced

This one required running all three modules against each other, because each is internally
consistent and the inconsistency is between them.

**RAN.** Three farmers, 800 m³ each, one turnout each at chainage 300/650/1000 m, 12-hour window,
$Q_0 = 0.15$ m³/s:

```
=== equal_hours, demand 800 m3 each, 12h window, Q0=0.15 ===
  o1 06:00->10:00 Q=0.14470 delivered=2083.6 m3
  o2 10:00->14:00 Q=0.13874 delivered=1997.9 m3
  o3 14:00->18:00 Q=0.13304 delivered=1915.7 m3
  TOTAL delivered = 5997.3 m3  <-- window can physically carry Q0*12h = 6480 m3
  needMet = [{f1,100},{f2,100},{f3,100}]
  shortfall = {}   <-- 3x demand=2400m3 delivered against 6480m3 of canal capacity
```

**The finding:** `equal_hours` hands out the *entire window* rather than the demand, delivering
**5997 m³ against 2400 m³ requested**, while `shortfall_m3` is empty and `needMet` reports **100% for
every farmer**. Because `needMet` is capped at 100% it cannot expose over-delivery, so the equity
comparison the mode exists to provide was uninformative — `equal_hours` and `equal_water` both
scored a perfect 100%, and the Gini was 0 for both.

I also checked the comparison in the other direction and found it **sound**: `equal_water` on the
same inputs delivers exactly 800 m³ to each farmer. The asymmetry is the story, and it is exactly
the warabandi tail-end deficit the project exists to fix.

**Fix:** the delivered volume now reflects $Q(x_i) \times T_i$, so it **decays with chainage**
(o1 > o2 > o3 in the same hours) and the tail-end deficit is visible and measurable. A test pins the
decay, the 4-hour split, and that each turn is capped by its own outlet flow. `needMet` still caps
at 100% — that is the documented contract, and the honest fix was to make delivery correct, not to
make the metric lie differently.

---

## 7. F-16 — the live `triage_score = 0.15` defect

The brief states this comes from `triage.urgency` in `apps/api/src/requests.ts` because System-1
falls back to keyword rules with no LLM key. The path is **out of my scope** and I did not modify
it. I investigated and the stated cause is **incomplete** — this is a correction, not a
confirmation.

**READ — the chain:**

1. `apps/api/src/requests.ts:49` — `const triage = await classify(providerEnv(env), input.reason);`
2. `apps/api/src/requests.ts:60` and `:78` — `triage_score: triage.urgency`, written to both the
   `request.raised` and `request.triaged` events.
3. `apps/api/src/system1.ts:309-312` — with no `OPENROUTER_API_KEY`, `classify` returns
   `classifyByRules(text)` and never touches the network.
4. `apps/api/src/system1.rules.ts:345` — `const URGENCY_BASE = 0.15;`
5. `apps/api/src/system1.rules.ts:364-379` — `scoreUrgency` **starts at `URGENCY_BASE` and only
   adds** on keyword hits, then subtracts calm/negation terms and clamps to [0,1].

**So the constant is not 0.15 *because* the key is missing.** 0.15 is the **floor**, and it is also
the answer whenever **no keyword matches**. The rules tier would return 0.15 for these strings
*with* a key too.

**READ — why no keyword matches:** the score is computed over `input.reason` only. The rule tables
are overwhelmingly **Telugu script** (`STRESS_TERMS` at `system1.rules.ts:80-90`,
`URGENCY_TERMS` at `:133-146`). The English entries that could fire are limited to
`urgent / asap / immediately / emergency` and `cracked / wilt / dying / wilting`. A demo request
reason phrased as ordinary English ("borewell failed") contains none of them, so every term misses
and the score stays exactly at `URGENCY_BASE` — which is the constant the coordinator sees.

**Corollary:** `mentions_crop_stress` (line 429) *does* require a Telugu stress term or a crop term
plus a distress term, so that flag is more informative than the score. The displayed number is the
degenerate one.

**Why I did not fix it:** it is in `apps/api`, explicitly outside my scope. Proposed fixes for the
owner, cheapest first:
1. Treat "no signal matched" as a distinct low-confidence state instead of emitting the floor as if
   it were a computed score.
2. Extend the rule tables to cover the English/transliterated reasons the demo actually seeds.
3. Supply an `OPENROUTER_API_KEY`, which routes to Jev and produces a genuinely computed urgency.

Only (3) makes the number *computed*; (1) makes it *honest*; (2) makes it *useful* offline. I'd argue
(1) and (2) matter most for a demo, since the offline path is the one that runs.

---

## 8. F-15 — `crop-params.json` provenance

Verified against the **unabridged FAO-56 Rev.1 (2025)** text at
`/home/parshu/projects/cis/jadal/.ref/fao56-book/FAO56-full.txt` (a pdftotext extraction of
`FAO56-full.pdf`).

### 8.1 What IS sourced — verified by me at source

**SOURCE**, Table 6.2 ("Single (time-averaged) crop coefficients…"), read directly:

| Crop | Line | Source row | JSON | Verdict |
| :--- | :--- | :--- | :--- | :--- |
| groundnut | 11956 | `0.40  1.05  0.60  h=0.50  Zr=0.50–1.00` | `0.40/1.05/0.60`, `0.5`, `0.5–1.0` | **MATCH** |
| cotton | 11964 | `0.40  1.10  0.50  h=1.20  Zr=1.00–1.70` | `0.40/1.10/0.50`, `1.2`, `1.0–1.7` | **MATCH** |
| sugarcane | 11995 | `0.40  1.20  0.80  h=3.00–4.00  Zr=1.00–1.50` | `0.40/1.20/0.80`, `3.0`, `1.0–1.5` | **MATCH** |
| maize | 12035 | `0.30  1.20  0.30  h=2.50–3.50  Zr=0.60–1.50` | `0.30/1.20/0.30`, `2.5`, `0.6–1.5` | **MATCH** |
| rice flooded | 12052 | `1.05  1.20  1.05  h=1.00  Zr=0.50` | `1.05/1.20/1.05`, `1.0`, `0.5–1.0` | Kc **MATCH**; `Zr.max` 1.0 not in row |
| rice intermittent | 12055 | `0.95  1.20  1.00  h=1.00  Zr=0.70` | `0.95/1.20/1.00`, `1.0`, `0.5–0.7` | Kc **MATCH**; `Zr.min` 0.5 not in row |
| greengram | 11943 | `0.40  1.10  0.40  h=0.60–0.90  Zr=0.40–1.00` | `0.40/1.10/0.40` | **MATCH** |
| blackgram | 11942 | `0.40  1.10  0.35  h=0.50–0.70  Zr=0.60–1.00` | `0.40/1.10/0.35` | **MATCH** |
| chickpea | 11945 | `0.40  1.05  0.35  h=0.50–0.70  Zr=0.70–1.00` | `0.40/1.05/0.35` | **MATCH** |

**SOURCE**, Table 8.2 ("Soil water depletion fraction for no stress (p) for field crops"), p. 260:

| Crop | Line | Source | JSON | Verdict |
| :--- | :--- | :--- | :--- | :--- |
| groundnut | 17797 | `0.50` | `0.50` | **MATCH** |
| cotton | 17802 | `0.60` | `0.60` | **MATCH** |
| maize | 17827 | `0.50` | `0.50` | **MATCH** |
| sugarcane | 17823 | `0.60` | `0.60` | **MATCH** |
| greengram/blackgram | 17793 | `0.45` | `0.45` | **MATCH** |
| chickpea | 17794 | `0.45` | `0.45` | **MATCH** |
| **rice** | 17837-8 | `Flooded paddies, anaerobic rice   Threshold = 0.80 of θsat` | `0.20` | **MISMATCH** — Table 8.2 gives rice *no numeric p*; the basis is saturation, not TAW |

**SOURCE**, Table 7.5 ("Typical soil water characteristics for different soil types"):
$(\theta_{FC} - \theta_{WP})$ ranges — sand 0.05–0.11, loamy sand 0.06–0.12, sandy loam 0.11–0.15,
loam 0.13–0.18, silt loam 0.13–0.19, clay 0.12–0.20 (lines 16112-16131). Every
`SOIL_AVAILABLE_WATER` entry lies inside its range (pinned by a test). **`clay_loam` has no row in
Table 7.5** — the shipped 0.15 is our interpolation → **ASSUMED**.

### 8.2 What is NOT sourced — negative findings

**SOURCE.** The 2025 edition **abolished static calendar stage lengths**. Verbatim
(`FAO56-full.txt:14290-14293`):

> "…the use of GDD to determine the lengths of crop growth stages and the shape of the seasonal Kc
> curve is provided rather than static stage lengths as provided in the 1998 FAO56 publication.
> Stage lengths, expressed in days, are available in the previous version of these guidelines."

**Consequence:** there is **no growth-stage-length table in FAO-56 Rev.1 (2025)**, so all **44**
`stage_days` values in the JSON are unsourced from the current edition. They are 1998-era or project
values.

**RAN** (negative findings, greps returning nothing):

```
$ grep -niE "percolat" .ref/fao56-book/FAO56-full.txt
   -> only DEEP percolation (DP) concepts; no paddy percolation rate in mm/day
$ grep -ni "pigeonpea\|Cajanus\|red gram\|redgram" .ref/fao56-book/FAO56-full.txt
   -> (no output)
```

- `percolation_mm_day` (rice 3.5 and 2.0) — **NOT FOUND**. FAO-56 tabulates no paddy percolation
  rate. These are **ASSUMED** project/ANGRAU values.
- The entire `redgram` row — **NOT FOUND**. Its `source` string cites "FAO-56 (2025) book reference
  (p. 410…)"; **the document's last printed page is 401** (Selected Bibliography), so **p. 410 does
  not exist**. The citation is invalid. **ASSUMED** regional proxy.
- `stage_gdd`, `t_base_c`, `t_upper_c` — Tables 6.10/6.11/6.12 do exist (GDD and
  base/upper-temperature tables), but 8 of the 9 `t_base`/`t_upper` pairs do not match Table 6.10,
  and the `stage_gdd` 4-tuples were not traced to rows. **ASSUMED.**

### 8.3 What I did about it

I did **not** delete or silently rewrite values — that would break downstream behaviour with no
evidence that the replacements are better. Instead every row now carries:

- a `constant_status` object tagging each field **MEASURED** or **ASSUMED**;
- a `source` string split into `KC / STAGE_DAYS / STAGE_GDD / DEPLETION_P / PERCOLATION` clauses,
  each stating its own status, so a reader can see at a glance which numbers are sourced.

The existing `crop-params.test.ts` "cites official FAO-56 source" test (`:48-58`) only checked that
the string contained "FAO-56" — which the invalid `p. 410` citation satisfied. It tested the
presence of a citation, not its validity. I left that test alone (it is still true) and added the
provenance assertions in the new audit test file instead.

---

## 9. Delegated verification and its provenance

To cover 11 crops × 13 fields against a 1.58 MB OCR text I delegated a verification pass to a
subagent. Its full report is at **`.ref/audit/crop-params-vs-fao56-2025.md`** (714 lines;
`.ref/` is gitignored scratch, so it is cited here rather than shipped).

**Calibration — how much to trust it.** It is **machine-assisted reading**, not hand verification.
I spot-checked ten of its value-level claims at source (§8.1) and all ten agreed, which is
reasonable grounds for treating the rest as probably right. But **one claim it made was wrong**, and
I caught it because I had already read the same region myself:

> The subagent asserted Table 7.5 is *"Lengths of the Kcb growth stages (days)"*.

**RAN**, refuting it:

```
$ grep -n "TABLE 7.5" .ref/fao56-book/FAO56-full.txt
16112:      TABLE 7.5

$ sed -n '16112,16118p' .ref/fao56-book/FAO56-full.txt
      TABLE 7.5
      Typical soil water characteristics for different soil types
       Soil type                         Soil water characteristics                 Evaporation parameters
                                 θFC                θWP               (θFC-θWP)   ...
       Sand                  0.07 - 0.17        0.02 - 0.07       0.05 - 0.11        2-7            6 - 12
```

Table 7.5 is the **soil water** table, the string occurs exactly once, and it is the source I cite
for `SOIL_AVAILABLE_WATER`. I corrected the subagent's report in place and added a provenance
section to it recording the refutation.

**What I rely on from it:** only the **negative** findings, which I then re-established
independently (§8.2) — no stage-length table in 2025, no paddy percolation rate, no redgram row,
no numeric rice *p*. Negative findings are hard to fabricate and easy to check, which is why they
are the part worth keeping. The individual MISMATCH deltas should be re-checked before being quoted
as fact.

---

## 10. Test coverage

**RAN**, before and after:

```
$ pnpm --filter core test          # baseline, before any change
 Test Files  8 passed (8)
      Tests  85 passed (85)

$ pnpm --filter core test          # after
 Test Files  9 passed (9)
      Tests  152 passed (152)
```

New file `packages/core/src/models.audit.test.ts` — **66 tests**, one group per finding plus the
Task-1 boundary cases. Each test asserts values derived by hand or from the cited source, never
values copied from what the implementation happened to return.

One existing test was **changed**, deliberately and with the reason recorded in its comment:
`ledger.test.ts` "creates entry for request.decided approve urgent" asserted the `quota → quota`
self-transfer as correct (F-07). It now asserts the absence of that entry and adds a regression
sweep over every type-detection shape asserting `from !== to`.

---

## 11. What remains open

Findings I did **not** fix, and why:

| ID | Why it is still open |
| :--- | :--- |
| F-01 | Fixing it means choosing between a documented example and a sourced table value. That is an owner decision, not a code change; the brief forbids adjusting the claim. |
| F-02 | Replacing exponential with Moritz seepage would invalidate every published worked value in `architecture.html`. It needs a decision, not a patch. |
| F-03 | Requires a sequential water balance across outlets — a model change, and it would change `overrunImpact`'s published signature semantics. |
| F-04 | **Partial.** Blocked on `WeatherDay` gaining humidity/wind fields; `packages/contracts` is immutable in this lane. |
| F-05, F-06 | Both need state the core deliberately does not carry ($D_r$, ponded depth). Adding it changes the `CropEngine` contract. |
| F-08 | Would require rejecting an event the contract permits; needs a contracts decision. |
| F-16 | In `apps/api`, explicitly out of scope. Reported with proposed fixes. |

No contract change was required for anything I fixed, so nothing needed to be escalated under the
"stop and report" rule.

---

## 12. Reproducing this audit

```bash
cd /home/parshu/projects/cis/jadal-models
pnpm install --config.verify-deps-before-run=false
pnpm --filter core typecheck && pnpm --filter core test
```

Source text used for every SOURCE-labelled claim:

```bash
# FAO-56 Rev.1 (2025), unabridged
/home/parshu/projects/cis/jadal/.ref/fao56-book/FAO56-full.txt
# 1998 15-page excerpt (for the equations it does contain)
/home/parshu/projects/cis/jadal/.ref/fao56/fao56-extract.md
```

Probe scripts used for the RAN evidence are in `/tmp/probe*.mjs` and are reproduced inline above;
they import the core directly via `npx tsx`.
