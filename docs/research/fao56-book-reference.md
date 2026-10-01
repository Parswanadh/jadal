# FAO-56 (2025 Revised Edition) Engineering Reference

> **Document ID:** `docs/research/fao56-book-reference.md`  
> **Status:** VERIFIED IRRIGATION-ENGINEERING REFERENCE  
> **Source Document:** *Crop Evapotranspiration – Guidelines for computing crop water requirements*, Second Edition, Revised 2025. FAO Irrigation and Drainage Paper No. 56 Rev. 1. Rome, FAO.  
> **Authors:** Luis S. Pereira, Richard G. Allen, Paula Paredes, Ramón López-Urrea, Dirk Raes, Martin Smith, Ayse Kilic, Maher Salman (2025). ISBN: 978-92-5-140060-9. DOI: [10.4060/cd6621en](https://doi.org/10.4060/cd6621en).  
> **File Citation Key:** `(p. N)` refers to the printed book page number; `[pdf N]` refers to the 1-indexed PDF page of `.ref/fao56-book/FAO56-full.pdf` (`pdf = printed + 38` for main text).  
> **Target Component:** Jadal Deterministic Core ($S_0$) — Crop-Need Engine (`docs/research/fao56-model.md`).

---

## 1. Edition Notes: 2025 Revision vs. 1998 Edition

The 2025 revision (FAO-56 Rev. 1) updates and expands the landmark 1998 publication (Allen et al., 1998). The key differences impacting Jadal's deterministic engineering architecture are:

1. **Chapter-Based Equation and Table Numbering:**
   - *1998 Edition:* Numbered sequentially across the entire book (Equations 1 to 110, Tables 1 to 41).
   - *2025 Edition:* Numbered by chapter (e.g., Eq. 2.4 instead of Eq. 6; Eq. 3.55 instead of Eq. 52; Eq. 6.16 instead of Eq. 62; Eq. 8.3 instead of Eq. 82; Eq. 8.6 instead of Eq. 84; Eq. 8.7 instead of Eq. 85). All references in this document use the 2025 numbering and cross-reference the 1998 numbering where relevant.

2. **Removal of Static Calendar Stage Lengths (Old Table 11) in Favor of Growing Degree Days (GDD):**
   - The authors explicitly removed the static calendar-day stage length tables (old Table 11) from the book text (p. 202) [pdf 240]:
     > *"In this revised version of FAO56, guidance for determining thermal lengths of crop growth stages and the shape of the seasonal Kc curve is provided rather than static stage lengths as provided in the 1998 FAO56 publication. Stage lengths, expressed in days, are available in the previous version of these guidelines."*
   - In place of fixed calendar days, the 2025 edition introduces a thermal time framework:
     - Equation 6.23a–c (p. 203) [pdf 241]: Calculation of Growing Degree Days ($GDD$) using base temperature ($T_{\text{base}}$) and upper cutoff ($T_{\text{upper}}$).
     - Table 6.10 (p. 204–206) [pdf 242–244]: $T_{\text{base}}$ and $T_{\text{upper}}$ for vegetables, field crops, fruit trees, and grasses.
     - Table 6.11 (p. 209–210) [pdf 247–248]: Field-observed indicative cumulative $GDD$ per growth stage ($GDD_{\text{ini}}, GDD_{\text{dev}}, GDD_{\text{mid}}, GDD_{\text{late}}$, and $\text{Total } GDD$).
     - Table 6.12 (p. 211–212) [pdf 249–250]: Approximate ranges for cumulative $GDD$ converted from the original 1998 Table 11.
     - Calendar time conversion procedure (p. 213–214) [pdf 251–252]: Translating accumulated thermal time into local days based on daily temperature time series.

3. **Restructuring and Expansion of Crop Coefficient Tables:**
   - Single crop coefficients ($K_c$) are split into dedicated tables by agronomic category:
     - Table 6.1: Vegetable crops (p. 165–168) [pdf 203–206].
     - Table 6.2: Field crops and grasses (p. 168–170) [pdf 206–208].
     - Table 6.3: Fruit trees, shrubs, and vines with canopy cover fraction ($f_c$) and plant density (p. 170–175) [pdf 208–213].
     - Table 6.4 & 6.5: Wetland, aquatic, and riparian vegetation (p. 176–178) [pdf 214–216].
   - Maximum plant height ($h$) and maximum root depth range ($Z_r$) are integrated directly into Tables 6.1 and 6.2 (previously dispersed across Tables 12, 16, and 22 in 1998).
   - Rice management conditions are differentiated into 7 explicit practices (Table 6.2, p. 170) [pdf 208]: flooded, flooded with dry seeding, flooded with anticipated cut-off, intermittent irrigation (AWD), aerobic sprinkler irrigation, aerobic surface irrigation, and rainfed.

4. **Soil Water Depletion ($p$) Restructuring and Rice Thresholds:**
   - Depletion fractions ($p$) for no stress are separated into Table 8.1 (vegetables), Table 8.2 (field crops), Table 8.3 (fruit trees/shrubs), and Table 8.4 (grasses) (p. 258–262) [pdf 296–300].
   - Rice is no longer represented as an arbitrary depletion fraction ($p = 0.20$ in 1998 Table 22); Table 8.2 (p. 260) [pdf 298] establishes physical soil water thresholds:
     - Flooded paddies (anaerobic): $\text{Threshold} = 0.80 \, \theta_{\text{sat}}$.
     - Sprinkler/surface irrigated (aerobic): $\text{Threshold} = 0.90 \, \theta_{\text{FC}}$.
   - The numerical adjustment of $p$ for atmospheric evaporative demand ($ET_c$) is formalized as Equation 8.5 (p. 257) [pdf 295] (was an unnumbered formula/footnote in 1998).

5. **Modern Technologies and Operational Methods:**
   - Remote sensing estimation of basal and single crop coefficients ($K_{cb}, K_c$) from vegetation indices ($NDVI, SAVI$) is formalized in Chapters 5, 7, and 9 (Eq. 5.3–5.5, p. 157–158) [pdf 195–196].
   - Chapter 9 formalizes the density coefficient ($K_d$) approach (Allen & Pereira) to adjust $K_{cb}$ for density, canopy cover ($f_c$), and leaf area index ($LAI$) (Eq. 9.1–9.14, p. 294–313) [pdf 332–351].
   - Chapter 10 provides operational guidelines for surface mulching (organic and plastic), intercropping, deficit irrigation, and automated surface/sprinkler irrigation systems (p. 329–351) [pdf 367–389].
   - Multilinear regressions for the Hargreaves radiation coefficient $k_{Rs}$ and temperature-only $ET_0$ calibrated by aridity index ($AI$) (Eq. 3.53–3.57d, p. 104–108) [pdf 142–146].

---

## 2. End-to-End Mathematical Equation Chain

This section details the complete deterministic equation chain for Jadal's core engine, citing exact 2025 equations, units, and conditions.

### 2.1 Reference Crop Evapotranspiration ($ET_0$)

#### Tier 2 Physical Method: FAO Penman-Monteith Equation (Daily Time Step)
Cited as **Equation 2.4** (p. 23) [pdf 61] and repeated as **Equation 2.4bis** (p. 114) [pdf 152] [1998: Eq. 6]:

$$\text{ET}_0 = \frac{0.408 \Delta (R_n - G) + \gamma \frac{900}{T + 273} u_2 (e_s - e_a)}{\Delta + \gamma (1 + 0.34 u_2)}$$

**Variables and Units:**
- $\text{ET}_0$: Reference crop evapotranspiration [$\text{mm day}^{-1}$]
- $R_n$: Net radiation at the crop surface [$\text{MJ m}^{-2}\text{ day}^{-1}$]
- $G$: Soil heat flux density [$\text{MJ m}^{-2}\text{ day}^{-1}$]
- $T$: Mean daily air temperature at $2\text{ m}$ height [$^\circ\text{C}$]
- $u_2$: Wind speed at $2\text{ m}$ height [$\text{m s}^{-1}$]
- $e_s$: Mean saturation vapour pressure [$\text{kPa}$]
- $e_a$: Actual vapour pressure [$\text{kPa}$]
- $e_s - e_a$: Saturation vapour pressure deficit [$\text{kPa}$]
- $\Delta$: Slope of saturation vapour pressure curve [$\text{kPa }^\circ\text{C}^{-1}$]
- $\gamma$: Psychrometric constant [$\text{kPa }^\circ\text{C}^{-1}$]
- $0.408$: Coefficient converting net energy $\text{MJ m}^{-2}\text{ day}^{-1}$ to equivalent water depth $\text{mm day}^{-1}$ [$\text{m}^2\text{ mm MJ}^{-1}$] (Table 1.1, p. 4) [pdf 42]

**Constituent Equations for Penman-Monteith:**
1. **Atmospheric Pressure ($P$):** Eq. 3.1 (p. 64) [pdf 102] [1998: Eq. 7]:
   $$P = 101.3 \left(\frac{293 - 0.0065 z}{293}\right)^{5.26} \quad [\text{kPa}]$$
   where $z$ is elevation above sea level [$\text{m}$].
2. **Latent Heat of Vaporization ($\lambda$):** Eq. 3.2 (p. 65) [pdf 103]:
   $$\lambda = 2.501 - (2.361 \times 10^{-3}) T \quad [\text{MJ kg}^{-1}]$$
   For standard $T = 20^\circ\text{C}$, $\lambda \approx 2.45\text{ MJ kg}^{-1}$.
3. **Psychrometric Constant ($\gamma$):** Eq. 3.3 (p. 65) [pdf 103] [1998: Eq. 8]:
   $$\gamma = \frac{c_p P}{\varepsilon \lambda} \approx 0.665 \times 10^{-3} P \quad [\text{kPa }^\circ\text{C}^{-1}]$$
   where $c_p = 1.013 \times 10^{-3}\text{ MJ kg}^{-1 }^\circ\text{C}^{-1}$ (specific heat at constant pressure) and $\varepsilon = 0.622$ (molecular weight ratio water vapour/dry air).
4. **Mean Air Temperature ($T_{\text{mean}}$):** Eq. 3.4 (p. 66) [pdf 104] [1998: Eq. 9]:
   $$T_{\text{mean}} = \frac{T_{\max} + T_{\min}}{2} \quad [^\circ\text{C}]$$
5. **Saturation Vapour Pressure Function ($e^\circ(T)$):** Eq. 3.6 (p. 67) [pdf 105] [1998: Eq. 11]:
   $$e^\circ(T) = 0.6108 \exp\left[\frac{17.27 T}{T + 237.3}\right] \quad [\text{kPa}]$$
6. **Mean Saturation Vapour Pressure ($e_s$):** Eq. 3.7 (p. 67) [pdf 105] [1998: Eq. 12]:
   $$e_s = \frac{e^\circ(T_{\max}) + e^\circ(T_{\min})}{2} \quad [\text{kPa}]$$
   *(Note: Using $e^\circ(T_{\text{mean}})$ rather than Eq. 3.7 is strongly discouraged as it underestimates $e_s$ by 10–15% in arid/semi-arid climates; p. 67 [pdf 105]).*
7. **Slope of Saturation Vapour Pressure Curve ($\Delta$):** Eq. 3.8 (p. 68) [pdf 106] [1998: Eq. 13]:
   $$\Delta = \frac{4098 \left[0.6108 \exp\left(\frac{17.27 T_{\text{mean}}}{T_{\text{mean}} + 237.3}\right)\right]}{(T_{\text{mean}} + 237.3)^2} \quad [\text{kPa }^\circ\text{C}^{-1}]$$
8. **Actual Vapour Pressure ($e_a$):**
   - From relative humidity: Eq. 3.11 (p. 70) [pdf 108] [1998: Eq. 17]:
     $$e_a = \frac{e^\circ(T_{\min})\frac{\text{RH}_{\max}}{100} + e^\circ(T_{\max})\frac{\text{RH}_{\min}}{100}}{2} \quad [\text{kPa}]$$
   - From dewpoint temperature: Eq. 3.14 (p. 70) [pdf 108] [1998: Eq. 14]:
     $$e_a = e^\circ(T_{\text{dew}}) = 0.6108 \exp\left[\frac{17.27 T_{\text{dew}}}{T_{\text{dew}} + 237.3}\right] \quad [\text{kPa}]$$
9. **Extraterrestrial Radiation ($R_a$):** Eq. 3.17 (p. 73) [pdf 111] [1998: Eq. 21]:
   $$R_a = \frac{24 (60)}{\pi} G_{sc} d_r \left[\omega_s \sin(\varphi)\sin(\delta) + \cos(\varphi)\cos(\delta)\sin(\omega_s)\right] \quad [\text{MJ m}^{-2}\text{ day}^{-1}]$$
   where $G_{sc} = 0.0820\text{ MJ m}^{-2}\text{ min}^{-1}$ (solar constant, p. 73) [pdf 111], $d_r = 1 + 0.033\cos\left(\frac{2\pi}{365} J\right)$ (inverse relative distance Earth-Sun, Eq. 3.21, p. 74) [pdf 112], $\delta = 0.409\sin\left(\frac{2\pi}{365} J - 1.39\right)$ (solar declination, Eq. 3.22, p. 74) [pdf 112], $\varphi$ is latitude in radians (Eq. 3.20, p. 74) [pdf 112], and $\omega_s = \arccos[-\tan(\varphi)\tan(\delta)]$ (sunset hour angle, Eq. 3.25, p. 76) [pdf 114]. $J$ is the day of the year ($1 \le J \le 365/366$).
10. **Daylight Hours ($N$):** Eq. 3.32 (p. 77) [pdf 115] [1998: Eq. 34]:
    $$N = \frac{24}{\pi} \omega_s \quad [\text{hours}]$$
11. **Solar Radiation ($R_s$):** Eq. 3.23 (p. 75) [pdf 113] [1998: Eq. 35]:
    $$R_s = \left(a_s + b_s \frac{n}{N}\right) R_a \quad [\text{MJ m}^{-2}\text{ day}^{-1}]$$
    where $n$ is actual sunshine duration [$\text{hours}$], and default Angstrom values are $a_s = 0.25, b_s = 0.50$ (p. 75) [pdf 113].
12. **Clear-Sky Solar Radiation ($R_{so}$):** Eq. 3.24 (p. 76) [pdf 114] [1998: Eq. 37]:
    $$R_{so} = (0.75 + 2 \times 10^{-5} z) R_a \quad [\text{MJ m}^{-2}\text{ day}^{-1}]$$
13. **Net Shortwave / Solar Radiation ($R_{ns}$):** Eq. 3.41 (p. 80) [pdf 118] [1998: Eq. 38]:
    $$R_{ns} = (1 - \alpha) R_s \quad [\text{MJ m}^{-2}\text{ day}^{-1}]$$
    where $\alpha = 0.23$ is the albedo for the hypothetical grass reference crop (dimensionless, p. 80) [pdf 118].
14. **Net Longwave Radiation ($R_{nl}$):** Eq. 3.42 (p. 80) [pdf 118] [1998: Eq. 39]:
    $$R_{nl} = \sigma \left[\frac{T_{\max, K}^4 + T_{\min, K}^4}{2}\right] \left(0.34 - 0.14\sqrt{e_a}\right) \left(1.35 \frac{R_s}{R_{so}} - 0.35\right) \quad [\text{MJ m}^{-2}\text{ day}^{-1}]$$
    where $\sigma = 4.903 \times 10^{-9}\text{ MJ K}^{-4}\text{ m}^{-2}\text{ day}^{-1}$ (Stefan-Boltzmann constant, p. 80) [pdf 118], $T_{\max, K} = T_{\max} + 273.16$, and $T_{\min, K} = T_{\min} + 273.16$. The relative shortwave ratio is bounded: $0.3 \le R_s / R_{so} \le 1.0$.
15. **Net Radiation ($R_n$):** Eq. 3.43 (p. 81) [pdf 119] [1998: Eq. 40]:
    $$R_n = R_{ns} - R_{nl} \quad [\text{MJ m}^{-2}\text{ day}^{-1}]$$
16. **Soil Heat Flux Density ($G_{\text{day}}$):** Eq. 3.45 (p. 82) [pdf 120] [1998: Eq. 42]:
    $$G_{\text{day}} \approx 0 \quad [\text{MJ m}^{-2}\text{ day}^{-1}]$$
    *(For daily and ten-day periods, soil heat flux beneath the dense grass reference surface is negligible).*
17. **Wind Speed Adjustment to $2\text{ m}$ Height ($u_2$):** Eq. 3.50 (p. 84) [pdf 122] [1998: Eq. 47]:
    $$u_2 = u_z \frac{4.87}{\ln(67.8 z_w - 5.42)} \quad [\text{m s}^{-1}]$$
    where $u_z$ is measured wind speed [$\text{m s}^{-1}$] at anemometer height $z_w$ [$\text{m}$].

---

#### Tier 3 Temperature-Only Alternative: Hargreaves-Samani (HS) Equation
Cited as **Equation 3.55** (p. 107) [pdf 145] [1998: Eq. 52, p. 64]:

$$\text{ET}_{0,\text{HS}} = 0.0135 \, k_{Rs,\text{HS}} \frac{R_a}{\lambda} \sqrt{T_{\max} - T_{\min}} \, (T_{\text{mean}} + 17.8)$$

**Variables and Units:**
- $\text{ET}_{0,\text{HS}}$: Reference evapotranspiration [$\text{mm day}^{-1}$]
- $R_a$: Extraterrestrial solar radiation [$\text{MJ m}^{-2}\text{ day}^{-1}$] from Eq. 3.17 (p. 73) [pdf 111]
- $\lambda$: Latent heat of vaporization [$\text{MJ kg}^{-1}$] ($\approx 2.45\text{ MJ kg}^{-1}$, Eq. 3.2, p. 65) [pdf 103]
- $T_{\max}, T_{\min}, T_{\text{mean}}$: Maximum, minimum, and mean daily air temperatures [$^\circ\text{C}$]
- $k_{Rs,\text{HS}}$: Empirical radiation adjustment coefficient [$^\circ\text{C}^{-0.5}$]. Default is $0.17$ (p. 107) [pdf 145]. (Note: $0.0135 \times 0.17 / 2.45 \approx 0.0023 \times 0.408 = 0.000938$, which is algebraically identical to the 1998 formulation $\text{ET}_0 = 0.0023 \times 0.408 R_a \sqrt{T_{\max} - T_{\min}} (T_{\text{mean}} + 17.8)$).
- Regional multilinear adjustment for semi-arid locations ($0.20 \le AI < 0.50$, Eq. 3.57b, p. 107) [pdf 145]:
  $$k_{Rs,\text{HS}} = 0.296 - 0.0049 \overline{TD} + 0.0117 \overline{u}_2 - 0.0014 \overline{\text{RH}} \quad [^\circ\text{C}^{-0.5}]$$
  where $\overline{TD} = \overline{T_{\max} - T_{\min}}$ [$^\circ\text{C}$], $\overline{u}_2$ [$\text{m s}^{-1}$], and $\overline{\text{RH}}$ [%] are long-term climatic averages.

---

### 2.2 Crop Evapotranspiration ($ET_c$)

Under standard disease-free, well-managed agronomic conditions:
Cited as **Equation 5.1** (p. 140) [pdf 178] and **Equation 6.1** (p. 164) [pdf 202] [1998: Eq. 56]:

$$\text{ET}_c(t) = K_c(t) \times \text{ET}_0(t) \quad [\text{mm day}^{-1}]$$

---

### 2.3 $K_c$ Curve Construction Across Growth Stages

The seasonal crop coefficient curve is defined by three values ($K_{c,\text{ini}}, K_{c,\text{mid}}, K_{c,\text{end}}$) connected across four growth stages ($L_{\text{ini}}, L_{\text{dev}}, L_{\text{mid}}, L_{\text{late}}$):

$$\text{Total Season Length: } L_{\text{total}} = L_{\text{ini}} + L_{\text{dev}} + L_{\text{mid}} + L_{\text{late}} \quad [\text{days}]$$

Linear interpolation formula across any stage: **Equation 6.20** (p. 201) [pdf 239] [1998: Eq. 66]:

$$K_c(t) = K_{c,\text{prev}} + \left[\frac{t - \sum L_{\text{prev}}}{L_{\text{stage}}}\right] (K_{c,\text{next}} - K_{c,\text{prev}})$$

**Piecewise Form:**
$$K_c(t) = \begin{cases}
K_{c,\text{ini}} & \text{if } 0 < t \le L_{\text{ini}} \\
K_{c,\text{ini}} + \left(\frac{t - L_{\text{ini}}}{L_{\text{dev}}}\right) (K_{c,\text{mid}} - K_{c,\text{ini}}) & \text{if } L_{\text{ini}} < t \le L_{\text{ini}} + L_{\text{dev}} \\
K_{c,\text{mid}} & \text{if } L_{\text{ini}} + L_{\text{dev}} < t \le L_{\text{ini}} + L_{\text{dev}} + L_{\text{mid}} \\
K_{c,\text{mid}} + \left(\frac{t - (L_{\text{ini}} + L_{\text{dev}} + L_{\text{mid}})}{L_{\text{late}}}\right) (K_{c,\text{end}} - K_{c,\text{mid}}) & \text{if } L_{\text{ini}} + L_{\text{dev}} + L_{\text{mid}} < t \le L_{\text{total}}
\end{cases}$$

#### Thermal Stage Lengths (Growing Degree Days, GDD)
In the 2025 revision, stage lengths are primarily evaluated in thermal units ($GDD$ in $^\circ\text{C}\text{-day}$):
Cited as **Equation 6.23a, b, c** (p. 203) [pdf 241]:

$$GDD_t = \begin{cases}
\frac{T_{\max, t} + T_{\min, t}}{2} - T_{\text{base}} & \text{if } T_{\text{base}} < \frac{T_{\max, t} + T_{\min, t}}{2} < T_{\text{upper}} \quad \text{[Eq. 6.23a]} \\
T_{\text{upper}} - T_{\text{base}} & \text{if } \frac{T_{\max, t} + T_{\min, t}}{2} \ge T_{\text{upper}} \quad \text{[Eq. 6.23b]} \\
0 & \text{if } \frac{T_{\max, t} + T_{\min, t}}{2} \le T_{\text{base}} \quad \text{[Eq. 6.23c]}
\end{cases}$$

Thresholds $T_{\text{base}}$ and $T_{\text{upper}}$ are listed in Table 6.10 (p. 204–206) [pdf 242–244]. A growth stage transitions when cumulative $\sum GDD_t$ reaches the tabulated stage threshold from Table 6.11 (p. 209–210) [pdf 247–248] or Table 6.12 (p. 211–212) [pdf 249–250].

---

### 2.4 Climate Adjustment of $K_{c,\text{mid}}$ and $K_{c,\text{end}}$

Tabulated values for $K_{c,\text{mid}}$ and $K_{c,\text{end}}$ reflect standard subhumid conditions ($\text{RH}_{\min} = 45\%$, $u_2 = 2.0\text{ m s}^{-1}$). For local conditions where $\text{RH}_{\min} \ne 45\%$ or $u_2 \ne 2.0\text{ m s}^{-1}$, coefficients are adjusted for mean plant height $h$:

#### $K_{c,\text{mid}}$ Climatic Adjustment:
Cited as **Equation 6.16** (p. 191) [pdf 229] [1998: Eq. 62]:

$$K_{c,\text{mid}} = K_{c,\text{mid(Tab)}} + \left[0.04 (u_2 - 2) - 0.004(\text{RH}_{\min} - 45)\right] \left(\frac{h}{3}\right)^{0.3}$$

**Application Limits:** $1.0\text{ m s}^{-1} \le u_2 \le 6.0\text{ m s}^{-1}$, $20\% \le \text{RH}_{\min} \le 80\%$, $0.1\text{ m} \le h \le 3.0\text{ m}$ (for $h > 3\text{ m}$, use $h = 3\text{ m}$).

#### $K_{c,\text{end}}$ Climatic Adjustment:
Cited as **Equation 6.19** (p. 195) [pdf 233] [1998: Eq. 65]:

$$K_{c,\text{end}} = K_{c,\text{end(Tab)}} + \left[0.04 (u_2 - 2) - 0.004(\text{RH}_{\min} - 45)\right] \left(\frac{h}{3}\right)^{0.3}$$

**Application Rule:** Applied only when $K_{c,\text{end(Tab)}} \ge 0.45$. For crops harvested in a fully dried/senesced state where $K_{c,\text{end(Tab)}} < 0.45$, no adjustment is made (evaporative demand is governed by dead vegetative cover and dry surface soil; p. 195 [pdf 233]).

---

### 2.5 Effective Rainfall ($P_e$ / $P_{\text{eff}}$)

#### FAO-56 Specification Status:
- The term *effective precipitation* ($P_e$) is explicitly defined in FAO-56 Box 1.1 (p. 8) [pdf 46] and listed in Annex 1 (p. 357) [pdf 395] as:
  > *"The irrigation water requirement can be defined as the difference between the crop water requirement and effective precipitation."*
- **Explicit Finding:** **FAO-56 does NOT prescribe or endorse an empirical equation for effective rainfall** (such as the USDA-SCS method or linear percentage rules).
- Instead, FAO-56 addresses rainfall directly and dynamically inside the **root-zone soil water balance** (Equation 8.7, p. 266) [pdf 304]:
  1. Precipitation is partitioned into surface runoff ($RO_i$) and infiltrating depth $(P_i - RO_i)$.
  2. FAO-56 explicitly notes (p. 267) [pdf 305]:
     > *"Daily precipitation in amounts less than about $0.2 \text{ ET}_0$ is normally entirely evaporated and can usually be ignored in the water balance calculations especially when the single crop coefficient approach is being used."*
  3. Rainfall infiltrating the root zone reduces the depletion $D_r$. Any infiltrated rainfall in excess of the root zone deficit ($D_{r, i-1}$) drains beyond the root zone as deep percolation ($DP_i$, Eq. 8.15, p. 272) [pdf 310].
- *Engineering Note for Jadal:* The rule $P_{\text{infiltrated}} = 0.80 \times (P - 3\text{ mm})$ used in `docs/research/fao56-model.md` §2.4 is an external project engineering heuristic, not an FAO-56 textbook equation. Under pure FAO-56 daily water balance accounting, effective rain is computed dynamically: $P_{\text{eff}, i} = (P_i - RO_i) - DP_i$.

---

### 2.6 Root-Zone Soil Water Balance (TAW, RAW, $D_r$, $K_s$)

#### Total Available Soil Water (TAW):
Cited as **Equation 8.3** (p. 255) [pdf 293] [1998: Eq. 82]:

$$\text{TAW} = 1000 \left(\theta_{\text{FC}} - \theta_{\text{WP}}\right) Z_r \quad [\text{mm}]$$

**Variables and Units:**
- $\text{TAW}$: Total available soil water in the root zone [$\text{mm}$]
- $\theta_{\text{FC}}$: Volumetric water content at field capacity [$\text{m}^3\text{ m}^{-3}$] (Table 7.5, p. 232) [pdf 270]
- $\theta_{\text{WP}}$: Volumetric water content at permanent wilting point [$\text{m}^3\text{ m}^{-3}$] (Table 7.5, p. 232) [pdf 270]
- $Z_r$: Effective rooting depth [$\text{m}$] (Tables 6.1–6.3, p. 165–175) [pdf 203–213]
- $1000$: Conversion factor from meters to millimeters [$\text{mm m}^{-1}$]

#### Readily Available Soil Water (RAW):
Cited as **Equation 8.4** (p. 256) [pdf 294] [1998: Eq. 83]:

$$\text{RAW} = p \times \text{TAW} \quad [\text{mm}]$$

where $p$ is the soil water depletion fraction for no stress [dimensionless, $0 < p \le 1$] from Tables 8.1–8.4 (p. 258–262) [pdf 296–300].

#### Depletion Fraction ($p$) Adjustment for $ET_c$:
Cited as **Equation 8.5** (p. 256) [pdf 294] [1998: unnumbered formula / footnote, p. 162]:

$$p = p_{\text{Table}} + 0.04 (5 - \text{ET}_c) \quad \text{bounded by } 0.1 \le p \le 0.8$$

where $\text{ET}_c$ is in $\text{mm day}^{-1}$. When evaporative demand is high ($\text{ET}_c > 5\text{ mm day}^{-1}$), $p$ is reduced to prevent stomatal closure; when $\text{ET}_c < 5\text{ mm day}^{-1}$, $p$ is increased.

#### Daily Root-Zone Water Balance Depletion ($D_{r, i}$):
Cited as **Equation 8.7** (p. 266) [pdf 304] [1998: Eq. 85]:

$$D_{r, i} = D_{r, i-1} - (P_i - RO_i) - I_i - CR_i + \text{ET}_{c,\text{act}, i} + DP_i \quad [\text{mm}]$$

**Variables and Units:**
- $D_{r, i}$: Root zone depletion at the end of day $i$ [$\text{mm}$]
- $D_{r, i-1}$: Root zone depletion at the end of previous day $i-1$ [$\text{mm}$]
- $P_i$: Precipitation on day $i$ [$\text{mm}$]
- $RO_i$: Surface runoff on day $i$ [$\text{mm}$]
- $I_i$: Net irrigation depth infiltrated on day $i$ [$\text{mm}$]
- $CR_i$: Capillary rise from shallow groundwater on day $i$ [$\text{mm}$] (Eq. 8.14a–c, p. 270) [pdf 308]; $\approx 0$ for deep regional water tables
- $\text{ET}_{c,\text{act}, i}$: Actual crop evapotranspiration on day $i$ [$\text{mm}$]
- $DP_i$: Deep percolation / gravitational drainage loss on day $i$ [$\text{mm}$]

**Boundary Limits on $D_{r, i}$ (p. 267) [pdf 305]:**
$$0 \le D_{r, i} \le \text{TAW}$$
- When water inputs drive $D_{r, i} < 0$, drainage occurs immediately on the same day:
  $$\text{Deep Percolation: } DP_i = \max\left(0, \; (P_i - RO_i) + I_i - \text{ET}_{c,\text{act}, i} - D_{r, i-1}\right) \quad \text{[Eq. 8.15, p. 272] [pdf 310]}$$
  and $D_{r, i}$ resets to $0$ (soil at field capacity).
- Initial depletion is determined from measured water content $\theta_{i-1}$:
  $$D_{r, i-1} = 1000 (\theta_{\text{FC}} - \theta_{i-1}) Z_r \quad \text{[Eq. 8.8, p. 267] [pdf 305]}$$

#### Water Stress Reduction Coefficient ($K_s$):
Cited as **Equation 8.6** (p. 264) [pdf 302] [1998: Eq. 84]:

$$K_s(t) = \begin{cases}
1.0 & \text{if } D_{r, t} \le \text{RAW}(t) \\
\frac{\text{TAW}(t) - D_{r, t}}{\text{TAW}(t) - \text{RAW}(t)} = \frac{\text{TAW}(t) - D_{r, t}}{(1 - p)\text{TAW}(t)} & \text{if } \text{RAW}(t) < D_{r, t} < \text{TAW}(t) \\
0.0 & \text{if } D_{r, t} \ge \text{TAW}(t)
\end{cases}$$

Under single crop coefficient modeling, actual crop evapotranspiration is:
Cited as **Equation 8.2** (p. 255) [pdf 293] [1998: Eq. 80]:

$$\text{ET}_{c,\text{act}}(t) = K_s(t) \, K_c(t) \, \text{ET}_0(t) \quad [\text{mm day}^{-1}]$$

---

### 2.7 Rice/Paddy-Specific Guidance in the Book

1. **Flooded Basins & Bund Hydrology (Ch. 10, p. 350) [pdf 388]:**
   - Traditional flooded paddy fields maintain standing ponding depths of $50\text{--}100\text{ mm}$ ($5\text{--}10\text{ cm}$).
   - Perimeter soil bunds prevent surface runoff ($RO = 0$) up to the bund crest or spillway weir height.
   - Laser land levelling allows standing water depth to be reduced to $\approx 50\text{ mm}$ ($5\text{ cm}$), substantially reducing hydrostatic pressure and deep percolation ($DP$).
   - Intermittent flooding / Alternate Wetting and Drying (AWD) keeps the soil near saturation without continuous submergence, further reducing $DP$ while maintaining full transpiration.

2. **Crop Coefficients for Diverse Rice Systems (Table 6.2, p. 170) [pdf 208]:**
   - Flooded (conventional continuous): $K_{c,\text{ini}} = 1.05, K_{c,\text{mid}} = 1.20, K_{c,\text{end}} = 1.05, h = 1.00\text{ m}, Z_r = 0.50\text{ m}$.
   - Flooded, dry seeding: $K_{c,\text{ini}} = 0.85, K_{c,\text{mid}} = 1.20, K_{c,\text{end}} = 1.05, h = 1.00\text{ m}, Z_r = 0.50\text{ m}$.
   - Flooded, anticipated cut-off: $K_{c,\text{ini}} = 1.05, K_{c,\text{mid}} = 1.20, K_{c,\text{end}} = 0.80, h = 1.00\text{ m}, Z_r = 0.50\text{ m}$.
   - Intermittent irrigation (AWD): $K_{c,\text{ini}} = 0.95, K_{c,\text{mid}} = 1.20, K_{c,\text{end}} = 1.00, h = 1.00\text{ m}, Z_r = 0.70\text{ m}$.
   - Aerobic, sprinkler irrigation: $K_{c,\text{ini}} = 0.90, K_{c,\text{mid}} = 1.10, K_{c,\text{end}} = 0.80, h = 0.80\text{ m}, Z_r = 1.00\text{ m}$.
   - Aerobic, surface irrigation: $K_{c,\text{ini}} = 0.90, K_{c,\text{mid}} = 1.10, K_{c,\text{end}} = 0.85, h = 0.80\text{ m}, Z_r = 1.00\text{ m}$.
   - Rainfed: $K_{c,\text{ini}} = 0.80, K_{c,\text{mid}} = 1.00, K_{c,\text{end}} = 0.80, h = 0.70\text{ m}, Z_r = 0.80\text{--}1.20\text{ m}$.

3. **Climate Adjustment of $K_{c,\text{ini}}$ for Flooded Rice (Table 6.7, p. 185) [pdf 223]:**
   During the initial stage of flooded rice, $ET_c$ is dominated by direct water evaporation. $K_{c,\text{ini}}$ varies with wind speed and atmospheric humidity:
   - *Arid / Semi-arid:* Light wind ($< 1\text{ m s}^{-1}$) = $1.10$; Moderate ($1\text{--}3\text{ m s}^{-1}$) = $1.15$; Strong ($> 3\text{ m s}^{-1}$) = $1.20$.
   - *Sub-humid / Humid:* Light wind = $1.05$; Moderate wind = $1.10$; Strong wind = $1.15$.
   - *Very Humid:* Light wind = $1.00$; Moderate wind = $1.05$; Strong wind = $1.10$.

4. **Soil Water Stress Thresholds for Rice (Table 8.2, p. 260) [pdf 298]:**
   - Flooded paddies (anaerobic): $\text{Threshold} = 0.80 \, \theta_{\text{sat}}$ (stress begins if soil dries below 80% saturation).
   - Sprinkler / surface aerobic rice: $\text{Threshold} = 0.90 \, \theta_{\text{FC}}$ (stress begins if soil dries below 90% field capacity).

5. **Puddling & Land Preparation Water:**
   - **NOT IN BOOK:** FAO-56 does *not* provide explicit equations for puddling plow-pan hydraulic conductivity or pre-saturation depth for land soaking / land preparation (often $150\text{--}200\text{ mm}$ in Asian monsoonal practices). These remain regional agronomic parameters (e.g. from IRRI or FAO Irrigation Paper 24).

---

### 2.8 Application / Irrigation Efficiency Guidance in the Book

- **Status in Book:** The word *application efficiency* appears only once in the entire book (p. 350) [pdf 388]:
  > *"If irrigation scheduling is appropriate in terms of the crop and soil water contents dynamics, these characteristics lead to high ratios of requirement to water applied, i.e., water application efficiencies."*
- **Explicit Finding:** **FAO-56 does NOT provide tables, values, or equations for application efficiency ($E_a$), conveyance efficiency ($E_c$), or project irrigation efficiency ($E_p$).**
- FAO-56 calculates strictly *net* irrigation requirements ($I_{\text{net}}$). The gross water application at the farm gate:
  $$I_{\text{gross}} = \frac{I_{\text{net}}}{E_a} \quad [\text{mm}], \qquad V_{\text{gross}} = 10 \times I_{\text{gross}} \times A = 10 \times \frac{I_{\text{net}}}{E_a} \times A \quad [\text{m}^3]$$
  requires $E_a$ to be supplied by external irrigation engineering standards (e.g., Central Water Commission (CWC) India guidelines, USBR, or FAO Irrigation and Drainage Paper No. 24).

---

## 3. Verified Per-Crop Parameter Table

> [!IMPORTANT]
> **Source Verification Principles:**
> 1. All values below are transcribed directly from the 2025 revised edition tables.
> 2. Cites follow the format: `(p. N) [pdf N], Table X.Y`.
> 3. Under the 2025 revision, static stage lengths in days ($L_{\text{ini}} / L_{\text{dev}} / L_{\text{mid}} / L_{\text{late}}$ in days) were removed from the book text (p. 202) [pdf 240]; hence they are marked **`NOT IN BOOK`**. The verified thermal stage lengths in Growing Degree Days ($GDD$ in $^\circ\text{C}\text{-day}$) from Tables 6.11 and 6.12 are provided in the companion column, together with $T_{\text{base}}$ and $T_{\text{upper}}$ from Table 6.10.
> 4. Where a crop or parameter is absent from the 2025 edition, it is explicitly labeled **`NOT IN BOOK`**.

| Crop Name | $K_{c,\text{ini}}$ | $K_{c,\text{mid}}$ | $K_{c,\text{end}}$ | Max Height $h$ [m] | Stage Lengths in Days ($L_{\text{ini}} / L_{\text{dev}} / L_{\text{mid}} / L_{\text{late}}$) | Thermal Stage Lengths ($GDD_{\text{ini}} / GDD_{\text{dev}} / GDD_{\text{mid}} / GDD_{\text{late}} = \text{Total}$) [$^\circ\text{C}\text{-day}$] | Max Root Depth $Z_r$ [m] | Depletion $p$ (no stress) | Source Citations (2025 Edition) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **Rice (paddy, flooded)**<br>*(Oryza sativa)* | 1.05 | 1.20 | 1.05 | 1.00 | **NOT IN BOOK** *(replaced by GDD)* | Short: $235 / 465 / 665 / 295 = 1660$<br>Long: $255 / 490 / 740 / 320 = 1805$<br>($T_{\text{base}} = 10^\circ\text{C}, T_{\text{upper}} = 38^\circ\text{C}$) | 0.50 | Threshold = $0.80 \, \theta_{\text{sat}}$ *(anaerobic)* | (p. 170) [pdf 208], Table 6.2;<br>(p. 205) [pdf 243], Table 6.10;<br>(p. 210) [pdf 248], Table 6.11;<br>(p. 260) [pdf 298], Table 8.2 |
| **Rice (intermittent / AWD)**<br>*(Oryza sativa)* | 0.95 | 1.20 | 1.00 | 1.00 | **NOT IN BOOK** *(replaced by GDD)* | As above (Table 6.11) | 0.70 | Threshold = $0.80 \, \theta_{\text{sat}}$ | (p. 170) [pdf 208], Table 6.2;<br>(p. 260) [pdf 298], Table 8.2 |
| **Maize (grain, low moisture)**<br>*(Zea mays)* | 0.30 | 1.20 | 0.30 | 2.50–3.50 | **NOT IN BOOK** *(replaced by GDD)* | Short: $200 / 380 / 500 / 340 = 1420$<br>Long: $250 / 500 / 600 / 380 = 1730$<br>($T_{\text{base}} = 8^\circ\text{C}, T_{\text{upper}} = 38^\circ\text{C}$) | 0.60–1.50 | 0.50 | (p. 169) [pdf 207], Table 6.2;<br>(p. 205) [pdf 243], Table 6.10;<br>(p. 209) [pdf 247], Table 6.11;<br>(p. 260) [pdf 298], Table 8.2 |
| **Groundnut / peanut**<br>*(Arachis hypogaea)* | 0.40 | 1.05 | 0.60 | 0.50 | **NOT IN BOOK** *(replaced by GDD)* | Min: $240 / 470 / 760 / 460 = 1930$<br>Max: $430 / 800 / 600 / 310 = 2140$<br>($T_{\text{base}} = 13^\circ\text{C}, T_{\text{upper}} = 35^\circ\text{C}$) | 0.50–1.00 | 0.50 | (p. 168) [pdf 206], Table 6.2;<br>(p. 205) [pdf 243], Table 6.10;<br>(p. 212) [pdf 250], Table 6.12;<br>(p. 260) [pdf 298], Table 8.2 |
| **Cotton**<br>*(Gossypium hirsutum)* | 0.40 | 1.10 | 0.50 | 1.20 | **NOT IN BOOK** *(replaced by GDD)* | Short: $280 / 520 / 800 / 350 = 1950$<br>Long: $300 / 550 / 820 / 400 = 2070$<br>($T_{\text{base}} = 14^\circ\text{C}, T_{\text{upper}} = 38^\circ\text{C}$) | 1.00–1.70 | 0.60 | (p. 168) [pdf 206], Table 6.2;<br>(p. 205) [pdf 243], Table 6.10;<br>(p. 209) [pdf 247], Table 6.11;<br>(p. 260) [pdf 298], Table 8.2 |
| **Chilli pepper**<br>*(Capsicum annuum)* | 0.60 | 1.10 | 0.80 | 0.75 | **NOT IN BOOK** *(replaced by GDD)* | Bell pepper common:<br>$445 / 1180 / 745 / 45 = 2415$<br>($T_{\text{base}} = 10^\circ\text{C}, T_{\text{upper}} = 35^\circ\text{C}$) | 0.50–1.20 | 0.40 | (p. 166) [pdf 204], Table 6.1;<br>(p. 204) [pdf 242], Table 6.10;<br>(p. 209) [pdf 247], Table 6.11;<br>(p. 258) [pdf 296], Table 8.1 |
| **Chili habanero**<br>*(Capsicum chinense)* | 0.60 | 1.15 | 0.75 | 0.80 | **NOT IN BOOK** *(replaced by GDD)* | As above (Table 6.10 thresholds) | 0.50–1.20 | 0.40 | (p. 166) [pdf 204], Table 6.1;<br>(p. 258) [pdf 296], Table 8.1 |
| **Sugarcane (virgin)**<br>*(Saccharum officinarum)* | 0.40 | 1.20 | 0.80 | 3.00–4.00 | **NOT IN BOOK** *(replaced by GDD)* | Min: $350 / 810 / 3480 / 1510 = 6150$<br>Max: $530 / 1200 / 4760 / 2410 = 8900$<br>($T_{\text{base}} = 12^\circ\text{C}, T_{\text{upper}} = 38^\circ\text{C}$) | 1.00–1.50 | 0.60 | (p. 169) [pdf 207], Table 6.2;<br>(p. 205) [pdf 243], Table 6.10;<br>(p. 212) [pdf 250], Table 6.12;<br>(p. 260) [pdf 298], Table 8.2 |
| **Green gram (dry)**<br>*(Vigna mungo / V. radiata)* | 0.40 | 1.10 | 0.40 | 0.60–0.90 | **NOT IN BOOK** *(replaced by GDD)* | Common: $110 / 240 / 420 / 200 = 970$<br>($T_{\text{base}} = 10^\circ\text{C}, T_{\text{upper}} = 38^\circ\text{C}$) | 0.40–1.00 | 0.45 | (p. 168) [pdf 206], Table 6.2;<br>(p. 205) [pdf 243], Table 6.10;<br>(p. 211) [pdf 249], Table 6.12;<br>(p. 260) [pdf 298], Table 8.2 |
| **Black gram (dry)**<br>*(Vigna mungo)* | 0.40 | 1.10 | 0.35 | 0.50–0.70 | **NOT IN BOOK** *(replaced by GDD)* | Common: $110 / 240 / 420 / 200 = 970$<br>($T_{\text{base}} = 10^\circ\text{C}, T_{\text{upper}} = 38^\circ\text{C}$) | 0.60–1.00 | 0.45 | (p. 168) [pdf 206], Table 6.2;<br>(p. 205) [pdf 243], Table 6.10;<br>(p. 211) [pdf 249], Table 6.12;<br>(p. 260) [pdf 298], Table 8.2 |
| **Pigeon pea / red gram**<br>*(Cajanus cajan)* | **NOT IN BOOK** | **NOT IN BOOK** | **NOT IN BOOK** | **NOT IN BOOK** | **NOT IN BOOK** | **NOT IN BOOK** | **NOT IN BOOK** | **NOT IN BOOK** | Absent from all FAO-56 tables |
| **Chickpea / garbanzo**<br>*(Cicer arietinum)* | 0.40 | 1.05 | 0.35 | 0.50–0.70 | **NOT IN BOOK** *(replaced by GDD)* | Min: $80 / 200 / 400 / 220 = 900$<br>Max: $120 / 250 / 430 / 210 = 1010$<br>($T_{\text{base}} = 8^\circ\text{C}, T_{\text{upper}} = 35^\circ\text{C}$) | 0.70–1.00 | 0.45 | (p. 168) [pdf 206], Table 6.2;<br>(p. 205) [pdf 243], Table 6.10;<br>(p. 211) [pdf 249], Table 6.12;<br>(p. 260) [pdf 298], Table 8.2 |
| **Sorghum (grain)**<br>*(Sorghum bicolor)* | 0.30 | 1.05 | 0.45 | 1.50–2.00 | **NOT IN BOOK** *(replaced by GDD)* | Short: $280 / 300 / 570 / 230 = 1380$<br>Long: $280 / 310 / 650 / 280 = 1520$<br>($T_{\text{base}} = 10^\circ\text{C}, T_{\text{upper}} = 38^\circ\text{C}$) | 1.00–1.50 | 0.55 | (p. 169) [pdf 207], Table 6.2;<br>(p. 205) [pdf 243], Table 6.10;<br>(p. 210) [pdf 248], Table 6.11;<br>(p. 260) [pdf 298], Table 8.2 |
| **Tomato (processing)**<br>*(Solanum lycopersicum)* | 0.60 | 1.10 | 0.85 | 0.60 | **NOT IN BOOK** *(replaced by GDD)* | Industry: $280 / 520 / 880 / 220 = 1900$<br>Fresh: $280 / 470 / 790 / 270 = 1810$<br>($T_{\text{base}} = 10^\circ\text{C}, T_{\text{upper}} = 35^\circ\text{C}$) | 0.60–1.20 | 0.40 | (p. 167) [pdf 205], Table 6.1;<br>(p. 204) [pdf 242], Table 6.10;<br>(p. 209) [pdf 247], Table 6.11;<br>(p. 259) [pdf 297], Table 8.1 |
| **Onion (dry)**<br>*(Allium cepa)* | 0.70 | 1.05 | 0.70 | 0.45 | **NOT IN BOOK** *(replaced by GDD)* | Common: $460 / 470 / 880 / 480 = 2290$<br>($T_{\text{base}} = 6^\circ\text{C}, T_{\text{upper}} = 35^\circ\text{C}$) | 0.30–0.60 | 0.30 | (p. 165) [pdf 203], Table 6.1;<br>(p. 204) [pdf 242], Table 6.10;<br>(p. 209) [pdf 247], Table 6.11;<br>(p. 258) [pdf 296], Table 8.1 |
| **Banana (1st cycle)**<br>*(Musa acuminata)* | 0.50 | 1.05 | 1.00 | 2.00–3.30 | **NOT IN BOOK** *(replaced by GDD)* | Table 6.10 thresholds:<br>$T_{\text{base}} = 11^\circ\text{C}, T_{\text{upper}} = 38^\circ\text{C}$<br>*(GDD values not in Table 6.11/6.12)* | 0.50–1.20 | 0.35 | (p. 166) [pdf 204], Table 6.1;<br>(p. 204) [pdf 242], Table 6.10;<br>(p. 258) [pdf 296], Table 8.1 |
| **Banana (2nd cycle)**<br>*(Musa acuminata)* | 1.00 | 1.15 | 1.10 | 2.50–4.00 | **NOT IN BOOK** *(replaced by GDD)* | As above (Table 6.10 thresholds) | 0.50–1.20 | 0.35 | (p. 166) [pdf 204], Table 6.1;<br>(p. 258) [pdf 296], Table 8.1 |

---

## 4. Diff Table: Earlier §3 Values vs. Verified Book Values

This table cross-examines the unverified agronomic parameters in `docs/research/fao56-model.md` §3 against the verified 2025 FAO-56 publication, documenting and explaining every mismatch.

| Crop / Parameter | Earlier §3 Value (`fao56-model.md`) | Verified Book Value (2025 Edition) | Status & Variance | Technical Explanation / Root Cause |
| :--- | :---: | :---: | :---: | :--- |
| **Rice: $K_{c,\text{end}}$** | 0.90 | **1.05** (flooded) / **0.80** (anticipated cut-off) | **MISMATCH** | Earlier §3 assumed an arbitrary 0.90. FAO-56 Table 6.2 distinguishes continuous flooding ($K_{c,\text{end}} = 1.05$) from drainage before harvest ($K_{c,\text{end}} = 0.80$). |
| **Rice: Root Depth $Z_r$** | 0.3–0.5 m | **0.50 m** (flooded) / **0.70 m** (intermittent) | **MISMATCH** | Table 6.2 specifies single maximum rooting depths: 0.50 m for flooded paddy and 0.70 m for intermittent AWD. |
| **Rice: Depletion $p$** | 0.20 | **Threshold = $0.80 \, \theta_{\text{sat}}$** | **MISMATCH** | The 1998 static $p = 0.20$ was replaced in Table 8.2 with a physical moisture content threshold ($0.80 \, \theta_{\text{sat}}$). Numerical 0.20 is obsolete in the 2025 edition. |
| **Rice: Stage Lengths in Days** | 30/30/40/20 (120 d) | **NOT IN BOOK** *(GDD: 1660 / 1805 $^\circ\text{C}\text{-d}$)* | **MISMATCH** | Static calendar days were removed from FAO-56 in 2025 (p. 202). Table 6.11 gives cumulative GDD. |
| **Maize: $K_{c,\text{end}}$** | 0.35 | **0.30** (low moisture) / **0.65** (high moisture) | **MISMATCH** | Table 6.2 provides $K_{c,\text{end}} = 0.30$ for grain harvested dry, or $0.65$ for grain harvested at higher moisture. The value 0.35 was from the 1998 Table 12. |
| **Maize: Max Height $h$** | 2.0 m | **2.50–3.50 m** | **MISMATCH** | Modern field maize hybrid heights in Table 6.2 are 2.50–3.50 m, compared to the generic 2.0 m in 1998. |
| **Maize: Root Depth $Z_r$** | 0.8–1.2 m | **0.60–1.50 m** | **MISMATCH** | Table 6.2 expands the verified rooting depth range to 0.60–1.50 m. |
| **Maize: Depletion $p$** | 0.55 | **0.50** | **MISMATCH** | Table 8.2 lists $p = 0.50$ for field maize. The earlier 0.55 was an erroneous assumption. |
| **Maize: Stage Lengths in Days** | 20/35/40/30 (125 d) | **NOT IN BOOK** *(GDD: 1420 / 1730 $^\circ\text{C}\text{-d}$)* | **MISMATCH** | Replaced by GDD in Table 6.11. |
| **Groundnut: $K_{c,\text{mid}}$** | 1.15 | **1.05** | **MISMATCH (Critical)** | Earlier §3 cited 1.15 (which was the 1998 Table 12 value). The 2025 revision lowered standard $K_{c,\text{mid}}$ for groundnut to **1.05** in Table 6.2 based on modern lysimetric reviews. |
| **Groundnut: Max Height $h$** | 0.4 m | **0.50 m** | **MISMATCH** | Table 6.2 gives $h = 0.50$ m. |
| **Groundnut: Root Depth $Z_r$** | 0.6–0.9 m | **0.50–1.00 m** | **MISMATCH** | Table 6.2 range is 0.50–1.00 m. |
| **Groundnut: Stage Lengths** | 25/35/45/25 (130 d) | **NOT IN BOOK** *(GDD: 1930 / 2140 $^\circ\text{C}\text{-d}$)* | **MISMATCH** | Replaced by GDD in Table 6.12. |
| **Cotton: $K_{c,\text{ini}}$** | 0.35 | **0.40** | **MISMATCH** | Table 6.2 specifies $K_{c,\text{ini}} = 0.40$. |
| **Cotton: $K_{c,\text{mid}}$** | 1.20 | **1.10** | **MISMATCH (Critical)** | Earlier §3 cited 1.20 (1998 Table 12). The 2025 revision adjusted standard subhumid $K_{c,\text{mid}}$ for cotton downward to **1.10** in Table 6.2. |
| **Cotton: $K_{c,\text{end}}$** | 0.60 | **0.50** | **MISMATCH** | Table 6.2 lists $K_{c,\text{end}} = 0.50$ (down from 0.60 in 1998). |
| **Cotton: Max Height $h$** | 1.3 m | **1.20 m** | **MISMATCH** | Table 6.2 lists $h = 1.20$ m. |
| **Cotton: Depletion $p$** | 0.65 | **0.60** | **MISMATCH** | Table 8.2 specifies $p = 0.60$ for cotton. |
| **Cotton: Stage Lengths** | 30/50/60/45 (185 d) | **NOT IN BOOK** *(GDD: 1950 / 2070 $^\circ\text{C}\text{-d}$)* | **MISMATCH** | Replaced by GDD in Table 6.11. |
| **Chilli: $K_{c,\text{mid}}$** | 1.05 | **1.10** (Capsicum annuum) / **1.15** (chinense) | **MISMATCH** | Table 6.1 lists $K_{c,\text{mid}} = 1.10$ for chili pepper ($C. annuum$) and $1.15$ for Habanero ($C. chinense$). |
| **Chilli: $K_{c,\text{end}}$** | 0.90 | **0.80** ($C. annuum$) / **0.75** ($C. chinense$) | **MISMATCH** | Table 6.1 gives 0.80 for chili pepper and 0.75 for Habanero. The earlier 0.90 overestimated end need. |
| **Chilli: Max Height $h$** | 0.8 m | **0.75 m** ($C. annuum$) / **0.80 m** ($C. chinense$) | **MISMATCH** | Table 6.1 gives $h = 0.75$ m for $C. annuum$. |
| **Chilli: Root Depth $Z_r$** | 0.5–1.0 m | **0.50–1.20 m** | **MISMATCH** | Table 6.1 extends maximum rooting depth to 1.20 m. |
| **Chilli: Depletion $p$** | 0.30 | **0.40** | **MISMATCH** | Table 8.1 lists $p = 0.40$ for Bell and Chili pepper ($C. annuum$). 0.30 severely underestimated stress tolerance. |
| **Chilli: Stage Lengths** | 25/35/50/30 (140 d) | **NOT IN BOOK** *(GDD: 2415 $^\circ\text{C}\text{-d}$ for Bell pepper)* | **MISMATCH** | Replaced by GDD in Table 6.10/6.11. |
| **Sugarcane: $K_{c,\text{mid}}$** | 1.25 | **1.20** | **MISMATCH** | Table 6.2 lists $K_{c,\text{mid}} = 1.20$ (1998 Table 12 was 1.25). |
| **Sugarcane: $K_{c,\text{end}}$** | 0.75 | **0.80** | **MISMATCH** | Table 6.2 lists $K_{c,\text{end}} = 0.80$ (1998 Table 12 was 0.75). |
| **Sugarcane: Max Height $h$** | 3.0 m | **3.00–4.00 m** | **MISMATCH** | Table 6.2 gives 3.00–4.00 m. |
| **Sugarcane: Root Depth $Z_r$** | 1.2–2.0 m | **1.00–1.50 m** | **MISMATCH** | Table 6.2 narrows rooting depth to 1.00–1.50 m (1998 cited up to 2.0 m). |
| **Sugarcane: Depletion $p$** | 0.65 | **0.60** | **MISMATCH** | Table 8.2 lists $p = 0.60$ for sugarcane. |
| **Sugarcane: Stage Lengths** | 35/60/180/90 (365 d) | **NOT IN BOOK** *(GDD: 6150 / 8900 $^\circ\text{C}\text{-d}$)* | **MISMATCH** | Replaced by GDD in Table 6.12. |
| **Green Gram: $K_{c,\text{mid}}$** | 1.05 | **1.10** | **MISMATCH** | Table 6.2 lists $K_{c,\text{mid}} = 1.10$. |
| **Green Gram: $K_{c,\text{end}}$** | 0.35 | **0.40** | **MISMATCH** | Table 6.2 lists $K_{c,\text{end}} = 0.40$ for green gram ($0.35$ is for dry black gram). |
| **Green Gram: Max Height $h$** | 0.5 m | **0.60–0.90 m** | **MISMATCH** | Table 6.2 specifies 0.60–0.90 m. |
| **Green Gram: Root Depth $Z_r$** | 0.5–0.7 m | **0.40–1.00 m** | **MISMATCH** | Table 6.2 specifies 0.40–1.00 m. |
| **Green Gram: Depletion $p$** | 0.55 | **0.45** | **MISMATCH** | Table 8.2 specifies $p = 0.45$ for black & green gram. Earlier 0.55 was too high. |
| **Black Gram: $K_{c,\text{mid}}$** | 1.05 | **1.10** | **MISMATCH** | Table 6.2 lists $K_{c,\text{mid}} = 1.10$. |
| **Black Gram: $K_{c,\text{end}}$** | 0.35 | **0.35** | **MATCH** | Verified from Table 6.2 for dry black gram. |
| **Black Gram: Max Height $h$** | 0.5 m | **0.50–0.70 m** | **MISMATCH** | Table 6.2 specifies 0.50–0.70 m. |
| **Black Gram: Root Depth $Z_r$** | 0.5–0.7 m | **0.60–1.00 m** | **MISMATCH** | Table 6.2 specifies 0.60–1.00 m. |
| **Black Gram: Depletion $p$** | 0.55 | **0.45** | **MISMATCH** | Table 8.2 specifies $p = 0.45$. |
| **Pigeon Pea (Redgram): ALL** | $0.35 / 1.10 / 0.40, h=1.8, Z_r=1.0\text{-}1.5, p=0.60$ | **NOT IN BOOK** | **FAILED VERIFICATION** | **Pigeon pea (*Cajanus cajan*) does not appear in FAO-56.** All values in §3 were unverified model assumptions. Parameters must be sourced from regional agronomic literature (e.g. ICRISAT / ANGRAU). |
| **Chickpea: $K_{c,\text{mid}}$** | 1.00 | **1.05** | **MISMATCH** | Table 6.2 lists $K_{c,\text{mid}} = 1.05$ (1998 Table 12 was 1.00). |
| **Chickpea: Max Height $h$** | 0.5 m | **0.50–0.70 m** | **MISMATCH** | Table 6.2 specifies 0.50–0.70 m. |
| **Chickpea: Root Depth $Z_r$** | 0.6–1.0 m | **0.70–1.00 m** | **MISMATCH** | Table 6.2 specifies 0.70–1.00 m. |
| **Chickpea: Depletion $p$** | 0.50 | **0.45** | **MISMATCH** | Table 8.2 specifies $p = 0.45$. |
| **All Crops: Field Efficiency $E_a$** | 0.65 / 0.80 | **NOT IN BOOK** | **STRUCTURAL GAP** | FAO-56 does not tabulate or model irrigation efficiencies. $E_a$ is an external parameter. |

---

## 5. Soil Water Characteristics Table

Directly transcribed from **Table 7.5: Typical soil water characteristics for different soil types** (p. 232) [pdf 270]:

| Soil Type (USDA Soil Texture Classification) | Soil Water Content at Field Capacity $\theta_{\text{FC}}$ [$\text{m}^3\text{ m}^{-3}$] | Soil Water Content at Wilting Point $\theta_{\text{WP}}$ [$\text{m}^3\text{ m}^{-3}$] | Available Water Capacity ($\theta_{\text{FC}} - \theta_{\text{WP}}$) [$\text{m}^3\text{ m}^{-3}$] | Available Water Capacity per Meter Depth [$\text{mm m}^{-1}$] | Readily Evaporable Water Stage 1 ($REW$) [$\text{mm}$] | Total Evaporable Water Stages 1 & 2 ($TEW$, $Z_e = 0.10\text{ m}$) [$\text{mm}$] |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Sand** | 0.07 – 0.17 | 0.02 – 0.07 | 0.05 – 0.11 | 50 – 110 | 2 – 7 | 6 – 12 |
| **Loamy sand** | 0.11 – 0.19 | 0.03 – 0.10 | 0.06 – 0.12 | 60 – 120 | 4 – 8 | 9 – 14 |
| **Sandy loam** | 0.18 – 0.28 | 0.06 – 0.16 | 0.11 – 0.15 | 110 – 150 | 6 – 10 | 15 – 20 |
| **Loam** | 0.20 – 0.30 | 0.07 – 0.17 | 0.13 – 0.18 | 130 – 180 | 8 – 10 | 16 – 22 |
| **Silt loam** | 0.22 – 0.36 | 0.09 – 0.21 | 0.13 – 0.19 | 130 – 190 | 8 – 11 | 18 – 25 |
| **Silt** | 0.28 – 0.36 | 0.12 – 0.22 | 0.16 – 0.20 | 160 – 200 | 8 – 11 | 22 – 26 |
| **Silt clay loam** | 0.30 – 0.37 | 0.17 – 0.24 | 0.13 – 0.18 | 130 – 180 | 8 – 11 | 22 – 27 |
| **Silty clay** | 0.30 – 0.42 | 0.17 – 0.29 | 0.13 – 0.19 | 130 – 190 | 8 – 12 | 22 – 28 |
| **Clay** | 0.32 – 0.40 | 0.20 – 0.24 | 0.12 – 0.20 | 120 – 200 | 8 – 12 | 22 – 29 |

*Note on Rice and Wetlands (p. 232) [pdf 270]:* When standing water is maintained above field capacity, $TEW$ may be modified by replacing $\theta_{\text{FC}}$ with the saturation water content $\theta_{\text{sat}}$ or adopted wet threshold $\theta_{\text{WT}}$, and $REW$ may be increased accordingly.

---

## 6. Engineer's Book Index: Topic & Page Lookup Reference

This index provides direct page references (printed page number and PDF index) for core topics required by an irrigation-engineering analyst working with the 2025 FAO-56 publication:

| Topic / Parameter / Section | 2025 Equation / Table | Printed Page `(p. N)` | PDF Page `[pdf N]` | Chapter / Context |
| :--- | :---: | :---: | :---: | :--- |
| **Conversion Factors for Evapotranspiration** | Table 1.1 | p. 4 | [pdf 42] | Ch. 1: Introduction |
| **Agroclimatic ETo Averages by Region** | Table 1.2 | p. 7 | [pdf 45] | Ch. 1: Regional ranges |
| **Distinction between ETc and Irrigation Need** | Box 1.1 | p. 8 | [pdf 46] | Ch. 1: Concepts ($I_{\text{net}} = \text{ET}_c - P_e$) |
| **FAO Penman-Monteith Equation (Daily Step)** | **Equation 2.4** | p. 23 | [pdf 61] | Ch. 2: Full physical specification |
| **FAO Penman-Monteith Equation (Hourly Steps)** | Eq. 2.5a (day), 2.5b (night) | p. 24 | [pdf 62] | Ch. 2: Sub-daily scheduling |
| **Atmospheric Pressure Formula ($P$)** | **Equation 3.1** | p. 64 | [pdf 102] | Ch. 3: Elevation dependency |
| **Latent Heat of Vaporization ($\lambda$)** | **Equation 3.2** | p. 65 | [pdf 103] | Ch. 3: Temperature dependency |
| **Psychrometric Constant Formula ($\gamma$)** | **Equation 3.3** | p. 65 | [pdf 103] | Ch. 3: Barometric psychrometry |
| **Mean Air Temperature Calculation ($T_{\text{mean}}$)** | **Equation 3.4** | p. 66 | [pdf 104] | Ch. 3: Day/night average |
| **Saturation Vapour Pressure Curve ($e^\circ(T)$)** | **Equation 3.6** | p. 67 | [pdf 105] | Ch. 3: Tetens formula |
| **Mean Saturation Vapour Pressure ($e_s$)** | **Equation 3.7** | p. 67 | [pdf 105] | Ch. 3: Non-linear mean |
| **Slope of Saturation Curve ($\Delta$)** | **Equation 3.8** | p. 68 | [pdf 106] | Ch. 3: First derivative |
| **Actual Vapour Pressure from RH ($e_a$)** | **Equation 3.11** | p. 70 | [pdf 108] | Ch. 3: Relative humidity |
| **Actual Vapour Pressure from $T_{\text{dew}}$ ($e_a$)** | **Equation 3.14** | p. 70 | [pdf 108] | Ch. 3: Dewpoint humidity |
| **Extraterrestrial Solar Radiation ($R_a$)** | **Equation 3.17** | p. 73 | [pdf 111] | Ch. 3: Orbital geometry |
| **Solar Radiation from Sunshine Hours ($R_s$)** | **Equation 3.23** | p. 75 | [pdf 113] | Ch. 3: Angstrom-Prescott |
| **Clear-Sky Solar Radiation ($R_{so}$)** | **Equation 3.24** | p. 76 | [pdf 114] | Ch. 3: Atmospheric turbidity |
| **Net Solar / Shortwave Radiation ($R_{ns}$)** | **Equation 3.41** | p. 80 | [pdf 118] | Ch. 3: Albedo $\alpha = 0.23$ |
| **Net Longwave Terrestrial Radiation ($R_{nl}$)** | **Equation 3.42** | p. 80 | [pdf 118] | Ch. 3: Stefan-Boltzmann Stefan law |
| **Net Surface Radiation ($R_n$)** | **Equation 3.43** | p. 81 | [pdf 119] | Ch. 3: Energy balance |
| **Soil Heat Flux Density ($G_{\text{day}} \approx 0$)** | **Equation 3.45** | p. 82 | [pdf 120] | Ch. 3: Daily thermal storage |
| **Wind Speed Height Adjustment ($u_2$)** | **Equation 3.50** | p. 84 | [pdf 122] | Ch. 3: Logarithmic profile |
| **Hargreaves-Samani $ET_0$ Formula** | **Equation 3.55** | p. 107 | [pdf 145] | Ch. 3: Temperature-only fallback |
| **Regional $k_{Rs}$ Adjustment Regressions** | Eq. 3.56, 3.57a–d | p. 107–108 | [pdf 145–146] | Ch. 3: Aridity Index calibration |
| **Penman-Monteith Repeated Specification** | Equation 2.4bis | p. 114 | [pdf 152] | Ch. 4: Operational determination |
| **Pan Evaporation Method ($K_p$)** | Tables 4.1–4.4, Eq. 4.2 | p. 131–132 | [pdf 169–170] | Ch. 4: Class A & Colorado sunken |
| **Potential Crop Evapotranspiration ($ET_c$)** | **Equation 5.1** | p. 140 | [pdf 178] | Ch. 5: Single Kc definition |
| **Remote Sensing $K_{cb}$ and $K_c$ from NDVI** | Equations 5.3–5.5 | p. 157–158 | [pdf 195–196] | Ch. 5: Satellite vegetation index |
| **Single Crop Coefficients: Vegetable Crops** | **Table 6.1** | p. 165–168 | [pdf 203–206] | Ch. 6: $K_{c,\text{ini}}, K_{c,\text{mid}}, K_{c,\text{end}}, h, Z_r$ |
| **Single Crop Coefficients: Field Crops & Grasses** | **Table 6.2** | p. 168–170 | [pdf 206–208] | Ch. 6: Cereals, pulses, fiber, rice |
| **Single Crop Coefficients: Fruit Trees & Vines** | **Table 6.3** | p. 170–175 | [pdf 208–213] | Ch. 6: Canopy $f_c$, height, density |
| **Single Crop Coefficients: Wetlands & Aquatic** | Tables 6.4, 6.5 | p. 176–178 | [pdf 214–216] | Ch. 6: Reeds, cattail, riparian |
| **Flooded Rice Initial Stage $K_{c,\text{ini}}$** | **Table 6.7** | p. 185 | [pdf 223] | Ch. 6: Climate/wind adjustment |
| **$K_{c,\text{mid}}$ Climatic Adjustment Formula** | **Equation 6.16** | p. 191 | [pdf 229] | Ch. 6: Wind, humidity, height |
| **$K_{c,\text{end}}$ Climatic Adjustment Formula** | **Equation 6.19** | p. 195 | [pdf 233] | Ch. 6: Late season adjustment |
| **$K_c$ Curve Linear Interpolation Across Stages** | **Equation 6.20** | p. 201 | [pdf 239] | Ch. 6: Segmented trajectory |
| **Removal of Static Days / GDD Rationale** | Section text | p. 202 | [pdf 240] | Ch. 6: Methodological transition |
| **Growing Degree Days Calculation Formula** | **Equation 6.23a–c** | p. 203 | [pdf 241] | Ch. 6: $T_{\text{base}}, T_{\text{upper}}$ thresholds |
| **Base and Upper Temperatures by Crop** | **Table 6.10** | p. 204–206 | [pdf 242–244] | Ch. 6: $T_{\text{base}}, T_{\text{upper}}$ list |
| **Field Observed Cumulative GDD by Stage** | **Table 6.11** | p. 209–210 | [pdf 247–248] | Ch. 6: Stage GDD totals |
| **Approximate GDD Ranges (ex-Table 11)** | **Table 6.12** | p. 211–212 | [pdf 249–250] | Ch. 6: 1998 Table 11 conversion |
| **Converting GDD into Calendar Days** | Section text & figures | p. 213–214 | [pdf 251–252] | Ch. 6: Operational lookups |
| **Dual Crop Coefficient ($K_c = K_{cb} + K_e$)** | Equation 7.1 | p. 216 | [pdf 254] | Ch. 7: Transpiration + soil evap |
| **Soil Water Characteristics by Texture** | **Table 7.5** | p. 232 | [pdf 270] | Ch. 7: $\theta_{\text{FC}}, \theta_{\text{WP}}, \text{TAW}, REW, TEW$ |
| **Wetted Soil Fractions by Irrigation Method** | Table 7.6 | p. 236 | [pdf 274] | Ch. 7: $f_w$ for furrow, drip, basin |
| **Actual ET under Water Stress ($K_s$)** | Equations 8.1, 8.2 | p. 255 | [pdf 293] | Ch. 8: Stress reduction |
| **Total Available Soil Water ($TAW$)** | **Equation 8.3** | p. 255 | [pdf 293] | Ch. 8: Soil storage capacity |
| **Readily Available Soil Water ($RAW$)** | **Equation 8.4** | p. 256 | [pdf 294] | Ch. 8: Non-stress threshold |
| **Depletion Fraction ($p$) Adjustment for $ET_c$** | **Equation 8.5** | p. 256 | [pdf 294] | Ch. 8: Atmospheric demand scaling |
| **Depletion Fraction ($p$): Vegetable Crops** | **Table 8.1** | p. 258–259 | [pdf 296–297] | Ch. 8: Vegetables $p$ |
| **Depletion Fraction ($p$): Field Crops** | **Table 8.2** | p. 260–261 | [pdf 298–299] | Ch. 8: Field crops & rice thresholds |
| **Depletion Fraction ($p$): Fruit Trees & Vines** | Table 8.3 | p. 261–262 | [pdf 299–300] | Ch. 8: Woody perennials $p$ |
| **Depletion Fraction ($p$): Grasses & Forage** | Table 8.4 | p. 262 | [pdf 300] | Ch. 8: Forages $p$ |
| **Water Stress Coefficient Formula ($K_s$)** | **Equation 8.6** | p. 264 | [pdf 302] | Ch. 8: Linear stress depletion |
| **Daily Root Zone Water Balance ($D_{r, i}$)** | **Equation 8.7** | p. 266 | [pdf 304] | Ch. 8: Depletion continuity |
| **Initial Soil Water Depletion ($D_{r, 0}$)** | **Equation 8.8** | p. 267 | [pdf 305] | Ch. 8: Season start condition |
| **Precipitation Evaporation Cutoff ($0.2 ET_0$)** | Section text | p. 267 | [pdf 305] | Ch. 8: Rain infiltration limit |
| **Capillary Rise Parametric Model ($CR$)** | Equations 8.9–8.14c | p. 268–271 | [pdf 306–309] | Ch. 8: Water table upward flux |
| **Deep Percolation Continuity Formula ($DP_i$)** | **Equation 8.15** | p. 272 | [pdf 310] | Ch. 8: Gravitational drainage |
| **Soil Salinity Tolerance and Stress ($EC_e$)** | Equations 8.19–8.26 | p. 279–289 | [pdf 317–327] | Ch. 8: Osmotic stress & leaching |
| **Salt Tolerance Thresholds by Crop** | Tables 8.8–8.11 | p. 281–284 | [pdf 319–322] | Ch. 8: $EC_e$ threshold and slope |
| **Vegetation Density Scaling ($K_d, LAI, f_c$)** | Equations 9.1–9.14 | p. 294–313 | [pdf 332–351] | Ch. 9: Sparse vegetation ET |
| **Surface Mulching Reductions in $K_c$** | Tables 10.1, 10.2 | p. 330–333 | [pdf 368–371] | Ch. 10: Organic / plastic mulch |
| **Intercropping Evapotranspiration** | Equations 10.1–10.3b | p. 334–337 | [pdf 372–375] | Ch. 10: Mixed cropping |
| **Flooded Paddy Hydrology & AWD Guidance** | Section text | p. 350 | [pdf 388] | Ch. 10: Puddle depth & water savings |
| **Application Efficiency Context** | Section text | p. 350 | [pdf 388] | Ch. 10: Inflow & distribution control |
| **Nomenclature, Principal Symbols, and Units** | **Annex 1** | p. 353–362 | [pdf 391–400] | Comprehensive symbol table |
| **Meteorological Lookup Tables** | **Annex 2** | p. 363–372 | [pdf 401–410] | Tables A2.1 to A2.9 |
| **Quality Control & Screening of Weather Data** | **Annex 3** | p. 373–384 | [pdf 411–422] | Data correction regressions |

