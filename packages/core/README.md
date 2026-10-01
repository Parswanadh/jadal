# @jadal/core — Deterministic Water Accounting Engine

Pure TypeScript implementation of the deterministic irrigation engineering core ($S_0$ layer) for the **Jadal** canal irrigation and water accounting system.

## Principles

1. **Deterministic:** Same input produces the exact same output. No network, no LLMs, no database calls, no unseeded randomness.
2. **Contract-driven:** Directly implements the interfaces defined in `@jadal/contracts` using `satisfies` checks.
3. **Engineering Rigor:** Every agronomic and hydraulic equation is cited from authoritative references (FAO-56 2025 Rev. 1, FAO-56 1998, Manning open-channel hydraulics). All project-specific empirical assumptions are marked `ASSUMED`.

---

## Governing Equations & Reference Citations

### 1. Volumetric Water Depth Conversion
$$\text{Volume } [\text{m}^3] = 10 \times \text{Depth } [\text{mm}] \times \text{Area } [\text{ha}]$$
- **Citation:** FAO-56 Table 1, p. 15.
- $1\text{ mm depth} = 0.001\text{ m}$; $1\text{ ha} = 10{,}000\text{ m}^2 \implies 0.001 \times 10{,}000 = 10\text{ m}^3$.

---

### 2. Crop Evapotranspiration ($ET_c$)
$$\text{ET}_c(t) = K_c(t) \times \text{ET}_0(t) \quad [\text{mm day}^{-1}]$$
- **Citation:** FAO-56 (2025) Eq. 6.1 (p. 164) / FAO-56 (1998) Eq. 58.

---

### 3. Crop Coefficient ($K_c$) Piecewise-Linear Curve
Given growth stage lengths $L_{\text{ini}}, L_{\text{dev}}, L_{\text{mid}}, L_{\text{late}}$:
$$K_c(t) = \begin{cases}
K_{c,\text{ini}} & \text{if } 0 < t \le L_{\text{ini}} \\
K_{c,\text{ini}} + \dfrac{t - L_{\text{ini}}}{L_{\text{dev}}} (K_{c,\text{mid}} - K_{c,\text{ini}}) & \text{if } L_{\text{ini}} < t \le L_{\text{ini}} + L_{\text{dev}} \\
K_{c,\text{mid}} & \text{if } L_{\text{ini}} + L_{\text{dev}} < t \le L_{\text{ini}} + L_{\text{dev}} + L_{\text{mid}} \\
K_{c,\text{mid}} + \dfrac{t - (L_{\text{ini}} + L_{\text{dev}} + L_{\text{mid}})}{L_{\text{late}}} (K_{c,\text{end}} - K_{c,\text{mid}}) & \text{if } L_{\text{ini}} + L_{\text{dev}} + L_{\text{mid}} < t \le L_{\text{total}} \\
K_{c,\text{end}} & \text{if } t > L_{\text{total}}
\end{cases}$$
- **Citation:** FAO-56 (1998) Eq. 66; `docs/research/fao56-crop-tables.md` §4.3.

---

### 4. Effective Rainfall ($P_{\text{eff}}$)
- **Lowland Flooded Rice:**
  Rainfall captured in the bunded basin up to the spillway weir crest ($H_{\text{weir}} \approx 100\text{ mm}$):
  $$P_{\text{eff}} = \min(P, H_{\text{weir}} - h_{\text{water}})$$
  - *Source:* `docs/research/fao56-model.md` §2.4 (ASSUMED project rule).
- **Upland Crops (Maize, Groundnut, Cotton, Chilli, Pulses, Sugarcane):**
  $$P_{\text{eff}} = \begin{cases}
  0 & \text{if } P \le 3\text{ mm} \\
  0.80 \times (P - 3\text{ mm}) & \text{if } P > 3\text{ mm}
  \end{cases}$$
  - *Source:* `docs/research/fao56-model.md` §2.4 (ASSUMED project rule).

---

### 5. Root-Zone Soil Water Balance (TAW, RAW, $p$)
- **Total Available Water (TAW):**
  $$\text{TAW} = 1000 \times (\theta_{\text{FC}} - \theta_{\text{WP}}) \times Z_r \quad [\text{mm}]$$
  - *Citation:* FAO-56 Eq. 82; $\theta_{\text{FC}} - \theta_{\text{WP}}$ from FAO-56 (2025) Table 7.5 (p. 232).
- **Readily Available Water (RAW):**
  $$\text{RAW} = p \times \text{TAW} \quad [\text{mm}]$$
  - *Citation:* FAO-56 Eq. 83.
- **Dynamic Depletion Fraction ($p$) Adjustment:**
  $$p = p_{\text{Tab}} + 0.04 \times (5 - \text{ET}_c) \quad \text{constrained to } 0.10 \le p \le 0.80$$
  - *Citation:* FAO-56 (2025) Eq. 8.5 (p. 257) / FAO-56 (1998) p. 162.

---

### 6. Irrigation Depth & Volume
- **Upland Net Irrigation:**
  $$I_{\text{net}} = \max(0, \text{ET}_c - P_{\text{eff}}) \quad [\text{mm}]$$
- **Paddy Rice Net Irrigation:**
  $$I_{\text{net}} = \max(0, \text{ET}_c + \text{PERC} - P_{\text{eff}}) \quad [\text{mm}]$$
  - *Citation:* $\text{PERC} \approx 3.5\text{ mm/day}$ default puddled Vertisol percolation (ANGRAU experimental baseline, `docs/research/fao56-crop-tables.md` §5.1).
- **Gross Irrigation Depth & Volume:**
  $$I_{\text{gross}} = \frac{I_{\text{net}}}{E_a}, \quad V_{\text{gross}} = 10 \times I_{\text{gross}} \times A \quad [\text{m}^3]$$
  - $E_a$: Plot application efficiency (basin $\approx 0.80$, furrow $\approx 0.65$).

---

### 7. Canal Hydraulics
- **Manning Mean Velocity:**
  $$v = \frac{1}{n} R^{2/3} S^{1/2} \quad [\text{m s}^{-1}]$$
  - $n$: Manning roughness coefficient; $R$: Hydraulic radius [$\text{m}$]; $S$: Bed slope.
- **Exponential Seepage Flow Decay:**
  $$Q(x) = Q_0 \cdot e^{-k \cdot x} \quad [\text{m}^3\text{ s}^{-1}]$$
  - $k$: Seepage coefficient per metre; $x$: Outlet chainage [$\text{m}$].
- **Transit Travel Lag:**
  $$\text{lag} = \frac{x}{3600 \cdot v} \quad [\text{hours}]$$
- **Downstream Overrun Impact:**
  $$\text{Lost Volume } [\text{m}^3] = Q_{\text{outlet}} \times (\text{overrun\_h} \times 3600)$$
  - Applied to each outlet with chainage $x > x_{\text{overrun}}$.

---

### 8. Roster Optimization (Equal Water vs. Equal Hours)
- **Turn Duration:**
  - `equal_water`: $T_i = \frac{V_i}{Q(x_i)}$ seconds (allocates time to deliver required volume at local flow).
  - `equal_hours` (Warabandi): $T_i = \frac{V_i}{Q_0}$ seconds (allocates time assuming uniform head discharge, causing downstream tail deficits).
- **Lag Accounting:**
  First turn at each outlet waits for the wetting front arrival:
  $$\text{Earliest Start} = \text{Window Start} + \text{lag}(x_i)$$
- **Shortfall Tracking:**
  Any volume that cannot fit before release window closing is reported in `shortfall_m3[farmer_id]`.

---

### 9. Volume Ledger & Conservation Invariant
- **Double-Entry Accounts:**
  - `canal_supply`
  - `buffer`
  - `losses:conveyance`
  - `farmer:{id}:quota`
  - `farmer:{id}:delivered`
- **Conservation Invariant:**
  At all times, across every valid sequence of events:
  $$\text{Season Supply} = \sum \text{Quotas} + \text{Buffer} + \sum \text{Delivered} + \text{Conveyance Losses}$$
- **Gini Coefficient ($G$):**
  $$G = \frac{\sum_{i=1}^n \sum_{j=1}^n |x_i - x_j|}{2 n \sum_{i=1}^n x_i}$$
  - $0 = \text{perfect equality}$; $1 = \text{absolute inequality}$.

---

### 10. Water Allocation Policies
- **Urgent Request (`canGrantUrgent`):**
  - Deducts approved volume from farmer's future seasonal quota.
  - Rejects if `quota < volume_m3`.
- **Buffer Request (`canGrantBuffer`):**
  - Weekly cap: $25\%$ of weekly entitlement per farmer per week (ASSUMED project rule).
  - Physical check: common buffer pool must have sufficient volume (`buffer >= volume_m3`).

---

## Exports

Import pure engines directly:
```typescript
import {
  cropEngine,
  hydraulics,
  rosterEngine,
  ledger,
  policy,
  getCropParams,
  allCropParams,
  mmHaToCubicMeters,
} from "@jadal/core";
```
