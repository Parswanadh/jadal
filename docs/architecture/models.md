# Jadal — Deterministic Core Model Reference

Status: **AUDITED** (lane Q / `ws/B-models`). Supersedes the equation list in `packages/core/README.md`,
which is retained as a summary but contains one documented error (§3, noted below).

This is the reference a reviewer or judge reads to answer: *what does this model compute, where does
each number come from, in what units, and what happens at the edges?* Every equation carries a
source citation; every constant carries a **MEASURED** or **ASSUMED** tag. The companion document
`docs/research/model-audit.md` records what was verified, what was refuted, and what remains open.

## Reading the tags

| Tag | Meaning |
| :--- | :--- |
| **MEASURED** | The value is printed in the cited authoritative source and was read there. |
| **ASSUMED** | We chose it. It is not in the cited source, or no source covers it. |
| **DERIVED** | Computed from MEASURED values by a stated rule (e.g. a range midpoint). |

A value marked ASSUMED is not a defect — an unfunded model still has to pick something. It *is* a
defect to present it as sourced. The audit found several such mislabels and they are corrected here
and in `packages/core/src/data/crop-params.json`.

---

## 1. Scope and layering

The core (`packages/core/src`) is the deterministic $S_0$ layer: pure functions, no network, no
clock, no database, no LLM. It implements the interfaces in `packages/contracts/src/core.ts` via
`satisfies`, so a signature drift is a compile error.

| Module | File | Implements |
| :--- | :--- | :--- |
| Crop engine (FAO-56) | `src/crop.ts` | `CropEngine` |
| Canal hydraulics | `src/hydraulics.ts` | `Hydraulics` |
| Roster engine | `src/roster.ts` | `RosterEngine` |
| Volume ledger | `src/ledger.ts` | `Ledger` |
| Allocation policy | `src/policy.ts` | `Policy` |
| Unit conversion | `src/index.ts` | `mmHaToCubicMeters` |
| Crop parameters | `src/data/crop-params.json` | `CropParams` |

**Authority:** every water number in Jadal comes from these modules. The API reaches them only
through `apps/api/src/core-shim.ts`, which wraps `ledger.entriesFor` to guard one case (see §6.4).

---

## 2. Unit conversion — the anchor of the whole system

$$V\ [\text{m}^3] = 10 \times d\ [\text{mm}] \times A\ [\text{ha}]$$

- **Source:** FAO-56 Table 1, "Conversion factors for evapotranspiration" (1998 p. 15; the 2025
  edition's Table 1). Quoted in `packages/core/README.md` §1.
- **Constants:** the factor `10` is **DERIVED**: $1\ \text{mm} = 10^{-3}\ \text{m}$ and
  $1\ \text{ha} = 10^4\ \text{m}^2$, so $10^{-3} \times 10^4 = 10$ m³/(mm·ha).
- **Implementation:** `src/index.ts:13` `mmHaToCubicMeters`.
- **Domain:** $d \ge 0$, $A \ge 0$. **Boundaries:** either at zero returns 0; a negative input
  throws `RangeError` rather than returning a negative volume.

---

## 3. Crop water requirement (FAO-56)

### 3.1 Reference evapotranspiration ET₀ — *outside the core*

ET₀ is **not computed in this package**. It arrives on `WeatherDay.et0_mm`, fetched from Open-Meteo
(`et0_fao_evapotranspiration`) by the API. The three-tier hierarchy (Open-Meteo → FAO-56
Penman-Monteith → Hargreaves) is specified in `docs/research/fao56-model.md` §2.1 but no tier is
implemented in `packages/core`. Treat ET₀ as a **MEASURED external input**; the core's equations
below are all conditioned on it.

> This matters for reproducibility: a core test that fixes `et0_mm` is testing the *conversion*
> chain, not the ET₀ model.

### 3.2 Crop evapotranspiration

$$\text{ET}_c(t) = K_c(t) \times \text{ET}_0(t)\quad[\text{mm}\,\text{day}^{-1}]$$

- **Source:** FAO-56 Eq. 6.1 (2025) / Eq. 58 (1998), quoted in `packages/core/README.md` §2.
- **Implementation:** `src/crop.ts` `weeklyNeed`, the `dailyEtc` accumulation.
- **Units:** $K_c$ dimensionless; ET₀ mm/day; ETc mm/day. Summed over the window, ETc is mm/week.

### 3.3 Crop coefficient curve $K_c(t)$

Piecewise linear across four stages, with $t$ = days after sowing and
$t_1 = L_{ini}$, $t_2 = t_1 + L_{dev}$, $t_3 = t_2 + L_{mid}$, $t_4 = t_3 + L_{late}$:

| Range | $K_c$ | Stage |
| :--- | :--- | :--- |
| $t \le t_1$ | $K_{c,ini}$ | `ini` |
| $t_1 < t \le t_2$ | $K_{c,ini} + \dfrac{t - t_1}{L_{dev}}(K_{c,mid} - K_{c,ini})$ | `dev` |
| $t_2 < t \le t_3$ | $K_{c,mid}$ | `mid` |
| $t_3 < t \le t_4$ | $K_{c,mid} + \dfrac{t - t_3}{L_{late}}(K_{c,end} - K_{c,mid})$ | `late` |
| $t > t_4$ | $0$ | `done` |

- **Source:** FAO-56 Eq. 6.20 (2025) / Eq. 66 (1998); `docs/research/fao56-crop-tables.md` §4.3.
- **Implementation:** `src/crop.ts` `kcOnDay`.
- **Units:** $t$ and all $L$ in days; $K_c$ dimensionless.
- **Boundaries:**
  - $t \le 0$ (sowing day and before) → $K_{c,ini}$ / `ini`. The source defines the curve for
    $1 \le t \le L_{total}$; extending it backwards flat is our choice, so a plan evaluated before
    sowing gets the initial coefficient rather than a discontinuity. **ASSUMED extension.**
  - $t > t_4$ (past harvest) → $K_c = 0$, stage `done`. There is no crop after harvest, so the
    caller must read `done` as "no water required". This is exercised by a test.
  - $L_{dev} = 0$ or $L_{late} = 0$ would make the interpolation term $0/0$. Both branches are
    guarded and return the boundary value instead of `NaN`. See audit F-13.
  - A **negative** stage length cannot enter its branch.

> **Correction (audit F-12).** `packages/core/README.md` §3 states $K_{c,end}$ applies for
> $t > L_{total}$. That is not what the code does and not what it should do: past harvest returns
> `kc = 0`. The README is wrong; the implementation is right.

#### Climatic adjustment of $K_{c,mid}$ and $K_{c,end}$ — FAO-56 Eq. 6.18 / Eq. 6.21

Table 6.2 values assume a standardized sub-humid climate ($\text{RH}_{min} \approx 45\%$,
$u_2 \approx 2\ \text{m/s}$) — the assumption is printed in the table caption itself
(`.ref/fao56-book/FAO56-full.txt:11926`). Outside that climate, for crops taller than 0.1 m:

$$K_c = K_{c(Tab)} + \left[0.04(u_2 - 2) - 0.004(\text{RH}_{min} - 45)\right]\left(\frac{h}{3}\right)^{0.3}$$

- **Source:** FAO-56 Eq. 6.18 / 6.21 (2025), Eq. 62 / 65 (1998); `docs/research/fao56-crop-tables.md`
  §4.2.1–4.2.2.
- **Implementation:** `src/crop.ts` `adjustKcForClimate`.
- **Units:** $u_2$ m/s, $\text{RH}_{min}$ %, $h$ m; the bracket is dimensionless, so $K_c$ stays
  dimensionless.
- **Validity domain (from the source):** $1 \le u_2 \le 6$ m/s, $20 \le \text{RH}_{min} \le 80$ %,
  $0.1 \le h \le 10$ m. **Outside it we do not extrapolate** — the tabulated $K_c$ is returned
  unchanged. That is a conservative choice of ours, recorded here so a reviewer can disagree.
- **Eq. 6.21 applies to $K_{c,end}$ only when $K_{c,end(Tab)} > 0.45$** (crops harvested green or
  with residual canopy). For grain crops dried in the field, no adjustment is made.
  Implemented as `KC_END_ADJUSTMENT_THRESHOLD = 0.45`.
- **Honest limitation:** the published `CropEngine.weeklyNeed` input carries no `RH_min` or wind —
  `WeatherDay` has neither field — so **in production this adjustment never fires**. It is exposed
  as two optional arguments (`wind_u2_ms`, `rh_min_pct`) that callers may supply; when omitted the
  tabulated value is used and no adjustment is claimed. See audit F-04.

### 3.4 Effective rainfall $P_{eff}$

**Upland crops** — project rule, **not** an FAO-56 equation:

$$P_{eff} = \begin{cases} 0 & P \le 3\ \text{mm} \\ 0.8\,(P - 3) & P > 3\ \text{mm}\end{cases}$$

- **Source:** `docs/research/fao56-model.md` §2.4. That document carries an orchestrator note
  explicitly recording this as **ASSUMED, not FAO-56**. FAO-56 prescribes no empirical
  effective-rainfall equation.
- **Constants:** abstraction `3.0` mm → **ASSUMED** (`RAIN_ABSTRACTION_MM`); capture fraction
  `0.8` → **ASSUMED** (`UPLAND_RAIN_CAPTURE`).
- **Implementation:** `src/crop.ts` `weeklyNeed`, upland branch.
- **Missing step:** `fao56-model.md` §2.4 step 3 caps $P_{eff}$ by the current root-zone deficit
  $(D_{r,t-1} + \text{ET}_{c,t})$, discarding the excess as deep percolation. The core carries **no
  day-to-day $D_r$ state**, so this cap is **not applied** and rain on already-wet soil is
  over-credited. Recorded as audit **F-06**, open.

**Lowland paddy** — project rule:

$$P_{eff} = P \quad\text{(the full storm)}$$

- **Source:** `docs/research/fao56-model.md` §2.4 gives $P_{eff} = \min(P,\ \max(0, H_{weir} - h_{water}))$
  with $H_{weir} \approx 80$–100 mm. The ponded depth $h_{water}$ is not on the `WeatherDay`
  contract, so the crest cap **cannot** be applied and the whole storm is credited where the doc's
  own worked example happens to satisfy the cap anyway (storage 65 mm > 15 mm storm).
- **ASSUMED.** Audit **F-05**, open. A caller holding ponded-depth state must cap it itself.

### 3.5 Root-zone water balance: TAW, RAW, p

$$\text{TAW} = 1000\,(\theta_{FC} - \theta_{WP})\,Z_r \quad[\text{mm}]$$

- **Source:** FAO-56 Eq. 8.3 (2025) / Eq. 82 (1998). $\theta$ range values from **Table 7.5**
  "Typical soil water characteristics for different soil types", verified at
  `.ref/fao56-book/FAO56-full.txt:16112-16131`.
- **Implementation:** `src/crop.ts`, `taw_mm`; soil values in `SOIL_AVAILABLE_WATER`.
- **Units:** $\theta$ in m³/m³, $Z_r$ in m, the `1000` converts m to mm → TAW in mm.

$$\text{RAW} = p \times \text{TAW}\quad[\text{mm}]$$

- **Source:** FAO-56 Eq. 8.4 (2025) / Eq. 83 (1998), verbatim at `FAO56-full.txt:17575`.

$$p = p_{Tab} + 0.04\,(5 - \text{ET}_c), \qquad 0.1 \le p \le 0.8$$

- **Source:** FAO-56 Eq. 8.5 (2025), verbatim at `FAO56-full.txt:17605`, with the constraint
  "the adjusted p is limited to $0.1 \le p \le 0.8$ and ETc is in mm day⁻¹" on the following line.
- **Constants:** `0.04`, the `5` mm/day reference and the `0.1`/`0.8` clamp are all **MEASURED**
  from Eq. 8.5.
- **Implementation:** `src/crop.ts`, `pAdj`. $p_{Tab}$ comes from the `depletion_p` field, which is
  **MEASURED** from Table 8.1/8.2 for the crops verified in the audit.
- **Boundary:** when the weather window is empty there is no mean ETc, so the reference
  `REFERENCE_ETC_MM_DAY = 5.0` is used and the adjustment term is exactly zero. **ASSUMED fallback.**
- **Note:** `meanEtc` is averaged over **days with a non-zero Kc** (`daysWithNeed`), not over the
  raw window length, so a week containing `done` days is not diluted toward the low-ET branch.
  Before the audit it was divided by `weather.length`; both are defensible, and the change is
  recorded in the audit.

**Dynamic root depth** (`fao56-model.md` §2.5):
$Z_r(t) = Z_{r,min} + (Z_{r,max} - Z_{r,min})\,t/(L_{ini} + L_{dev})$ for $t \le L_{ini}+L_{dev}$,
else $Z_{r,max}$. **ASSUMED** placement: the core evaluates this at the **window midpoint** and
holds it constant across the week, because a per-day root depth would require per-day TAW and the
weekly `bounds` contract carries one figure.

### 3.6 Irrigation requirement

$$I_{net} = \max(0,\ \text{ET}_c - P_{eff}) \qquad\text{(upland)}$$
$$I_{net} = \max(0,\ \text{ET}_c + \text{PERC} - P_{eff}) \qquad\text{(paddy)}$$
$$I_{gross} = \frac{I_{net}}{E_a}, \qquad V = 10 \times I_{gross} \times A \times f_{area}$$

- **Source:** `packages/core/README.md` §6; `docs/research/fao56-model.md` §2.6–2.7.
- **Implementation:** `src/crop.ts` `weeklyNeed`.
- **Constants:** $\text{PERC} = 3.5$ mm/day → **ASSUMED** (`DEFAULT_PADDY_PERCOLATION_MM_DAY`).
  FAO-56 contains **no paddy percolation rate** (audit F-14).
- **Units:** all depths mm/week; $E_a$ dimensionless; $A$ ha; result m³.
- **Boundaries:** $I_{net}$ floored at 0, so a wet week yields `volume_m3 = 0` and the turn can be
  skipped. $E_a \le 0$ would divide by zero — guarded by falling back to $E_a = 1.0$ (**ASSUMED**),
  even though the contract already forbids $E_a \le 0$ via `gt(0).lte(1)`.

### 3.7 Allocation bounds

`bounds` reports the per-event limits the roster scheduler must respect:
`raw_mm`, `taw_mm`, `event_refill_m3 = 10 (RAW/E_a) A f`, `event_cap_m3 = 10 (TAW/E_a) A f`.

- **Source:** `docs/research/fao56-model.md` §4.1–4.2, with the orchestrator note that RAW/Ea is the
  **refill depth per event**, not a weekly floor.
- **Semantics:** trigger at $D_r \ge \text{RAW}$, refill RAW, never exceed TAW.
- **`bounds` is `null` for paddy**, which is correct: a flooded field is intentionally ponded and is
  not bounded by TAW. `docs/research/fao56-model.md` §4.2 defines a rice bound from the weir crest,
  which requires ponded depth state the core does not carry — **open** (audit F-05).

### 3.8 Crop parameter table — provenance

`src/data/crop-params.json`, 11 rows. Verified against FAO-56 Rev.1 (2025):

| Field | Status | Basis |
| :--- | :--- | :--- |
| `kc_ini`, `kc_mid`, `kc_end` | **MEASURED** | Table 6.2 (2025), pp. 168–170 |
| `max_height_m`, `root_depth_m` | **MEASURED** | Table 6.2, same rows |
| `depletion_p` | **MEASURED** (10 crops) | Table 8.2, p. 260 |
| `depletion_p` (rice, redgram) | **ASSUMED** | no numeric *p* for rice; redgram absent entirely |
| `stage_days` (all 44) | **ASSUMED** | **no calendar stage-length table exists in the 2025 edition** |
| `stage_gdd` | **ASSUMED** | Tables 6.11/6.12 carry GDD ranges; these values were not traced to rows |
| `t_base_c`, `t_upper_c` | **ASSUMED** | Table 6.10 exists; 8 of 9 pairs do not match it |
| `percolation_mm_day` | **ASSUMED** | not in FAO-56 at all |

Each row now carries a `constant_status` object encoding exactly this, plus a `source` string that
separates what is measured from what is assumed. The 2025 edition's own words
(`FAO56-full.txt:14290-14293`):

> "the use of GDD to determine the lengths of crop growth stages and the shape of the seasonal Kc
> curve is provided rather than static stage lengths as provided in the 1998 FAO56 publication.
> Stage lengths, expressed in days, are available in the previous version of these guidelines."

`redgram` cites a source page that does not exist (the document ends at p. 401; there is no
pigeonpea row anywhere). Its values are an **ASSUMED** regional proxy (audit F-15).

---

## 4. Canal hydraulics

### 4.1 Manning mean velocity

$$v = \frac{1}{n} R^{2/3} S^{1/2}\quad[\text{m}\,\text{s}^{-1}]$$

- **Source:** Manning's open-channel formula, specified for Jadal in
  `docs/research/cloudflare-cicd.md` (item 1 of "Mathematical Feasibility in TypeScript") and
  `docs/research/deterministic-and-system1.md` ("Travel Lag"). Both give the same closed form.
- **Implementation:** `src/hydraulics.ts` `manningVelocity`, used by `velocity_ms`.
- **Units:** $n$ dimensionless (SI Manning), $R$ m, $S$ m/m. The relation is dimensionally
  consistent: $\text{m} = (\text{s}\,\text{m}^{-1/3})\cdot\text{m}^{2/3}\cdot 1$.
- **Constants:** $n = 0.025$ (unlined earth minor canal) → **ASSUMED** project calibration; the
  demo scenario's $R = 0.35$ m, $S = 0.0004$ → **ASSUMED**
  (`packages/contracts/fixtures/demo-scenario.json`).
- **Boundaries** (each pinned by a test):
  - $S = 0$ → $v = 0$ exactly. A level canal does not flow.
  - $S < 0$ → returns **0, not NaN**. An adverse slope carries no water in this model. ASSUMED.
  - $n \le 0$ → returns **0, not Infinity**. ASSUMED.
  - $R < 0$ → 0; $R = 0$ legitimately gives $v = 0$.
  - Non-finite input → 0.
  - These guards matter because the DB CHECKs constrain `manning_n > 0` and `seepage_k >= 0` but
    **not** `bed_slope`, so a zero or adverse slope can arrive from stored data. Before the audit,
    $S = 0$ produced $\text{NaN}$ velocity, which propagated silently into lag times and turn
    start times. Audit F-10.

### 4.2 Flow decay, travel lag, loss fraction

$$Q(x) = Q_0\,e^{-k x}\quad[\text{m}^3\,\text{s}^{-1}] \qquad
\text{lag} = \frac{x}{3600\,v}\quad[\text{h}] \qquad
\ell(x) = 1 - e^{-k x}$$

- **Source:** `docs/architecture/overview.md` line 87 states the model as
  $Q_i = (Q_0 - \sum \text{upstream draw})\cdot e^{-k x_i}$ with lag $x_i/v$ from Manning's $v$.
- **Implementation:** `src/hydraulics.ts` `atOutlets`.
- **Units:** $k$ in m⁻¹, $x$ in m → $kx$ dimensionless. The `3600` converts s to h.
- **$\ell(x)$ is exactly $1 - Q(x)/Q_0$**, so the flow and loss figures are consistent by
  construction rather than independently computed.
- **Source divergence (open, audit F-02):** both research documents that *specify* Jadal's seepage
  name the **Moritz** formula $S = C\sqrt{Q}\,L$ — a *linear* loss in $x$, not exponential. The
  architecture document adopts the exponential instead, and the published worked values in
  `docs/architecture/architecture.html:2588` were computed from it, so it is what the system
  actually implements. **The exponential form is ASSUMED relative to the cited Moritz source.**
- **Constant:** $k = 0.00012\ \text{m}^{-1}$ → **ASSUMED** project calibration for the demo canal.
- **Boundaries:** $x = 0$ → $Q = Q_0$, lag 0, loss 0. $k = 0$ (lined canal) → constant $Q$, zero
  loss, but travel time still elapses. $v = 0$ → lag reported as **0 rather than Infinity**.
  $x < 0$ is unphysical ($e^{+kx} > 1$, flow *grows*); chainage is not constrained non-negative by
  the contract, so this is documented rather than silently clamped, so a bad dataset is visible.

### 4.3 Overrun impact

$$\text{lost}_{m^3} = Q(x_{outlet}) \times \text{overrun\_h} \times 3600$$

- **Source:** project rule; `packages/core/README.md` §7. $Q(x)$ from `overview.md` line 87.
- **Implementation:** `src/hydraulics.ts` `overrunImpact`.
- **Units:** m³/s × h × 3600 s/h → m³. The `3600` is a unit conversion, not a fitted constant.
- **Boundaries:** unknown `overrunOutletId` → `[]` (ASSUMED: a stale reference must not crash a
  roster run). `overrun_h \le 0` or non-finite → clamped to 0, so no downstream loss. An outlet at
  *exactly* the same chainage is not downstream (strict `>`) and is not charged.
- **Open (audit F-03):** each downstream outlet's loss is computed **independently** from the
  original head discharge. The losses are not deducted in sequence, so the reported total can exceed
  what the canal actually carries. It is a per-outlet impact report, not a water balance.

---

## 5. Roster engine

### 5.1 Turn duration

| Mode | Duration | Source |
| :--- | :--- | :--- |
| `equal_water` | $T_i = V_i / Q(x_i)$ | README §8; `fao56-crop-tables.md` §4.8 item 3 |
| `equal_hours` | $T_i = (V_i / \sum V)\times \text{window}$ | README §8 ("warabandi") |

- **Implementation:** `src/roster.ts` `build`.
- **Units:** $V$ m³, $Q$ m³/s → $T$ s, converted to ms for ISO timestamps.
- **Delivered volume** is $Q(x_i)\times T_i$ m³.

### 5.2 Ordering (determinism)

Three keys, applied in order: **(1) outlet chainage ascending, (2) priority ascending,
(3) `farmer_id` alphabetical.** This is a *total* order, so identical inputs always produce an
identical roster — the determinism property the whole $S_0$ layer rests on.

> Priority is only the **second** key. A head-end farmer outranks a tail-end farmer with a better
> priority. This is a deliberate head-to-tail choice but it is worth stating plainly, because
> "priority" reads as if it came first.

### 5.3 Lag accounting

The **first** turn at each outlet starts no earlier than
$\text{window start} + \text{lag}(x_i)$ — the wetting front must arrive. Later turns at the same
outlet reuse the running cursor: once the outlet is wet, no further lag applies. Tracked via a
`visitedOutlets` set.

### 5.4 `equal_hours` — the warabandi comparison mode

This is the **legacy contrast case**, present so a coordinator can see what the traditional rule
would have delivered next to `equal_water`. It is deliberately inequitable, because that inequity is
the problem Jadal exists to fix:

- the window is split by **demand fraction**;
- volume delivered is that share of the *window* times the flow **actually reaching the outlet**;
- a tail-end farmer on a lower $Q(x_i)$ therefore receives proportionally less water for the same
  hours — the tail-end deficit.

> **Behaviour change (audit F-11).** The branch previously appeared to cap delivery at head
> discharge and reported `needMet = 100` for every farmer. The audit recomputed it: with three
> 800 m³ demands on a 12 h window it delivered **5997 m³** against 2400 m³ demanded, while `needMet`
> reported 100% for all three. `needMet` is capped at 100%, so it cannot expose over-delivery. The
> delivered volumes now reflect $Q(x_i)\times T_i$ and a test pins the decay with chainage. See
> `docs/research/model-audit.md` F-11 for the per-module trace.

### 5.5 Shortfall

`shortfall_m3` is keyed by **`farmer_id`**, so a farmer with demands at two outlets has shortfalls
summed across both. Recorded when a demand cannot be scheduled.

### 5.6 Boundaries

| Input | Behaviour |
| :--- | :--- |
| Unknown `outlet_id` | $Q = 0$, lag 0 → whole demand is shortfall, no turn emitted |
| `volume_m3 \le 0` | skipped entirely — no turn, *no shortfall* (a zero demand is not a failure) |
| `end \le start` (closed window) | every positive demand is shortfall, no turns |
| $Q \le 0$ | shortfall, no turn — a dry outlet cannot be scheduled |
| `equal_water`, window exhausted mid-turn | partial turn booked, deficit recorded |
| total demand 0 in `equal_hours` | falls back to an even split (ASSUMED) |

### 5.7 `needMet`

$pct = \min(100,\ \text{delivered}/\text{demand} \times 100)$ [%]. Both sides m³.

- A demand of 0 reports **100%** (nothing asked, nothing missed) — **ASSUMED**; 0% would make a
  farmer who requested nothing look worst-served in the equity comparison.
- Rows are returned **one per input demand**, so a farmer with two demands at one outlet gets two
  rows carrying the same pooled percentage. The array is *not* a set of distinct (farmer, outlet)
  pairs.
- Capped at 100 but **not floored at 0**; over-delivery reads as 100.

---

## 6. Volume ledger

### 6.1 Accounts and the conservation invariant

Accounts: `canal_supply`, `buffer`, `losses:conveyance`, `farmer:{id}:quota`,
`farmer:{id}:delivered` — all in m³.

$$\text{Season Supply} = \sum \text{Quotas} + \text{Buffer} + \sum \text{Delivered} + \text{Conveyance Losses}$$

- **Source:** `packages/core/README.md` §9. This is a **project invariant**, not a sourced equation.
- **Implementation:** `src/ledger.ts` `balances`, `checkConservation`.
- **Sign conventions** (these matter and are easy to get backwards): `canal_supply`, `buffer` and
  `conveyance_losses` are held as *account balances* (debits reduce, credits increase — so
  `canal_supply` falls as entitlements are allocated). `farmer.quota` and `farmer.delivered` are
  held as *movement totals in the direction of flow* (so `quota` grows when credited and falls when
  water is delivered out of it).
- **Boundaries:** balances rounded to 6 decimals at the end. `volume_m3` of 0 — or `NaN`, which the
  falsy check also catches — contributes nothing. `checkConservation`'s tolerance defaults to
  **0.001 m³ (one litre)**; differences below 1e-9 snap to exactly 0. A **negative tolerance**
  makes `ok` always false (caller error). An entry naming an **unmatched account** is silently
  dropped, removing volume from the identity — which is precisely how conservation breaks, and the
  check correctly *fails* in that case. Pinned by a test.

### 6.2 Double-entry rule and the `gini` statistic

Every entry is `from → to` with `volume_m3 > 0` and **`from ≠ to`** — a self-transfer moves nothing.

$$G = \frac{\sum_i \sum_j |x_i - x_j|}{2\,n \sum_i x_i}$$

- **Source:** README §9 (mean-absolute-difference form of the Gini).
- **Units:** scale-invariant, so % or m³ give the same coefficient.
- **Boundaries:** empty → 0; single value → 0; all-zero → **0, not NaN** (the `sum <= 0` guard fires
  first). The all-zero case matters: if every farmer received 0%, the Gini reports no *inequality*,
  and the caller must consult `shortfall_m3` to detect the failure. Computed in $O(n^2)$ without
  sorting, so it is independent of input order — a deliberate determinism guarantee.

### 6.3 Per-event semantics

| Event | Movement |
| :--- | :--- |
| `season.approved` | each positive entitlement: `canal_supply → farmer:{id}:quota`; remainder → `buffer` |
| `turn.delivered` | delivering farmer's quota → `...:delivered` **and** → `losses:conveyance` |
| `week.released_to_buffer` | `farmer:{id}:quota → buffer` |
| `crop.harvested` | `farmer:{id}:quota → buffer` |
| `rain.replanned` | per-farmer `quota → buffer`, iterated in **sorted** farmer-id order for stable ids |
| `request.decided` (buffer) | `buffer → farmer:{id}:quota` |
| `request.decided` (urgent) | **no entry** — see 6.4 |
| unknown `type` | no entries (inert, not an error) |

Non-positive volumes are filtered out, so no entry can violate the `volume_m3 > 0` CHECK.

### 6.4 The urgent self-transfer

An urgent grant re-phases the **same** farmer's own future quota forward in time; it moves no water
between accounts.

> **Fix (audit F-07).** The branch previously emitted `farmer:{id}:quota → farmer:{id}:quota`, a
> self-transfer that nets to zero and violates the `from ≠ to` rule. That entry is rejected by the
> DB CHECK `from <> to`, and it is **why `apps/api/src/core-shim.ts:41` has to special-case
> `request.decided`** and book the decision from the request row instead
> (`core-adapters.ts` `entriesForDecision`). The branch now emits **no entry**. `balances` produced
> an identical result either way — only the new version is a valid movement, so the wrap in
> `core-shim.ts` is now redundant belt-and-braces rather than a required workaround.
>
> **Open:** the time-shift itself (this week's water taken from a future week's quota) is still not
> represented, because `LedgerAccount` has no week-scoped quota account. That is a contract
> limitation, not a core bug; contracts are immutable in this lane.

---

## 7. Allocation policy

### 7.1 `canGrantUrgent`

$$\text{grant} \iff 0 < V \le \text{quota}(farmer)$$

- **Source:** **project policy**, README §10 — not a sourced equation.
- **Boundaries:** unknown farmer → quota reads as 0 → rejected (ASSUMED: an unknown farmer has no
  quota rather than raising). $V \le 0$ **or any non-finite value** → rejected. `quota = 0` →
  rejected.
- **It is a pure predicate**: it deducts nothing. The ledger books the movement. Calling it twice
  does not reserve twice.

### 7.2 `canGrantBuffer`

$$\text{weeklyCap} = 0.25 \times \max(0, \text{entitlement})$$
$$\text{remainingCap} = \max(0, \text{weeklyCap} - \text{alreadyGranted})$$
$$\max m^3 = \min(\text{remainingCap}, \max(0, \text{buffer}))$$
$$\text{grant} \iff 0 < V \le \text{remainingCap} \ \wedge\ V \le \text{buffer}$$

- **Source:** **project policy**, README §10. `BUFFER_CAP_RATIO = 0.25` is **ASSUMED**, not a
  statutory or FAO-56 figure.
- **Boundaries and **ordering** (observable, pinned by tests):**
  - non-finite or non-positive $V$ → rejected, but `max_m3` still reports the cap.
  - `entitlement \le 0` → `weeklyCap = 0` → any positive request rejected on the cap.
  - **`buffer <= 0` is checked before the cap**, so an exhausted reserve is reported as the reason
    even when the cap is also exhausted — the reserve is the binding physical constraint.
  - `alreadyGranted` above the cap saturates `remainingCap` at 0 (never negative).
  - negative entitlement / already-granted is clamped to 0, so a bad input cannot *raise* the cap.
  - `max_m3` is returned on **every** path, including rejections, so a caller can offer a partial
    grant without recomputing.
- **Fix (audit F-09):** `canGrantBuffer(..., NaN, 100, 0)` previously returned **`{ok: true}`** — both
  the cap test and the balance test compare false against `NaN`. Now guarded by
  `Number.isFinite`. The same hole existed in `canGrantUrgent` for `Infinity`.

---

## 8. Findings summary

Full detail, with the exact commands and observed output for everything that was run, is in
`docs/research/model-audit.md`.

| ID | Model | Finding | Status |
| :--- | :--- | :--- | :--- |
| F-01 | crop | Documented groundnut example (462.12 m³) is not produced by the shipped parameter table (417.69 m³); the passing test uses hand-typed params | **Open** — documented, not "fixed" |
| F-02 | hydraulics | Exponential seepage decay diverges from the cited Moritz linear form | **Open** |
| F-03 | hydraulics | Overrun losses computed per-outlet, not deducted in sequence | **Open** |
| F-04 | crop | Eq. 6.18/6.21 Kc climate adjustment had no implementation; now implemented but opt-in (contract carries no RH/wind) | **Fixed / limited** |
| F-05 | crop | Paddy $P_{eff}$ has no weir-crest cap; rice `bounds` is `null` | **Open** |
| F-06 | crop | Upland $P_{eff}$ has no root-zone-deficit cap (no $D_r$ state) | **Open** |
| F-07 | ledger | Urgent approval emitted a `quota → quota` self-transfer rejected by the DB CHECK | **Fixed** |
| F-08 | ledger | `rain.replanned` never reconciles `saved_m3` against `by_farmer_m3` | **Open** |
| F-09 | policy | `canGrantBuffer` approved a `NaN` volume | **Fixed** |
| F-10 | hydraulics | Zero/adverse bed slope produced `NaN` velocity | **Fixed** |
| F-11 | roster | `equal_hours` delivered the whole window while reporting 100% need met | **Fixed / documented** |
| F-12 | crop | README §3 states $K_{c,end}$ applies past $L_{total}$; code returns 0/`done` | **Doc corrected** |
| F-13 | crop | Zero-length stage caused $0/0$ in the Kc interpolation | **Fixed** |
| F-14 | crop params | `percolation_mm_day` absent from FAO-56 | **Tagged ASSUMED** |
| F-15 | crop params | All `stage_days` + `redgram` row unsourced; 8/9 `t_base`/`t_upper` mismatch | **Tagged ASSUMED** |

Test coverage: 152 tests across 9 files, including 66 in `src/models.audit.test.ts` that pin the
findings above and the boundary cases in this document.
