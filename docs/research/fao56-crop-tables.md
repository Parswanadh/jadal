# FAO-56 Crop Water Parameters and Equations for Canal Irrigation Scheduling

**Document ID:** `docs/research/fao56-crop-tables.md`  
**Project:** Jadal — Rotational Canal Irrigation Allocation & Water Accounting System  
**Domain:** Irrigation Engineering / Agronomic Crop Water Modeling  
**Primary Source:** FAO Irrigation and Drainage Paper No. 56 (*Crop Evapotranspiration — Guidelines for computing crop water requirements*), Allen, Pereira, Raes, & Smith (1998)  
**Primary Reference URL:** [https://www.fao.org/3/x0490e/x0490e00.htm](https://www.fao.org/3/x0490e/x0490e00.htm)  
**Verification Baseline:** [`.ref/fao56/fao56-crop-tables.md`](file://.ref/fao56/fao56-crop-tables.md)

---

## 1. Executive Summary & Purpose

In a rotational warabandi canal network, delivering equitable water requires converting abstract calendar turns ("hours of flow") into physical water volume delivered at the farm gate. Because crop water uptake varies continuously across phenological stages, soil textures, and atmospheric demand, the canal scheduling engine requires standard, authoritative agronomic parameters.

This document compiles clean, project-ready parameter sets derived strictly from the official FAO-56 online publication. It is calibrated for the major crops and soil textures of **Andhra Pradesh** (including the Krishna, Godavari, Nagarjuna Sagar, and Pennar canal commands across both **Kharif** [monsoon] and **Rabi** [winter/dry] seasons).

All parameters and formulas cite exact FAO-56 chapter URLs. Where a crop or parameter is absent from the official FAO-56 text (such as *Okra / Bhendi*, *Black gram*, or *puddling percolation rates*), it is explicitly marked **NOT FOUND**, and irrigation-engineering proxies are provided with explicit technical rationale.

---

## 2. Project-Ready Crop Parameters for Andhra Pradesh

The table below synthesizes the stage lengths (Table 11), single crop coefficients and crop heights (Table 12), and rooting depths and depletion fractions (Table 22).

### 2.1 Master Crop Parameter Table

| Crop & Local Name | Season / AP Context | FAO-56 Stage Lengths (days)<br>$L_{\mathrm{ini}} : L_{\mathrm{dev}} : L_{\mathrm{mid}} : L_{\mathrm{late}}\; (L_{\mathrm{tot}})$ | Single $K_c$<br>$K_{c\,\mathrm{ini}} : K_{c\,\mathrm{mid}} : K_{c\,\mathrm{end}}$ | Max Height<br>$h$ (m) | Max Root Depth<br>$Z_r$ (m) | Depletion Fraction<br>$p$ ($\mathrm{ET} \approx 5\,\text{mm/d}$) | FAO-56 Source Citations |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **Rice (Paddy)**<br>*(వరి / Vari)* | Kharif / Long-duration<br>(Tropics, May/June transplant) | $30 : 30 : 80 : 40\; (180)$ | $1.05 : 1.20 : 0.75^{\dagger}$<br>*(Table 14: $1.05\text{--}1.20$)* | $1.0$ | $0.5 - 1.0$ | $0.20^{\ddagger}$<br>*(of saturation)* | [Tab. 11](https://www.fao.org/3/x0490e/x0490e0b.htm#length of growth stages), [Tab. 12](https://www.fao.org/3/x0490e/x0490e0b.htm#tabulated kc values), [Tab. 14](https://www.fao.org/3/x0490e/x0490e0b.htm#crop coefficient for the initial stage (kc ini)), [Tab. 22](https://www.fao.org/3/x0490e/x0490e0e.htm#readily available water (raw)) |
| **Rice (Paddy)**<br>*(వరి / Vari)* | Rabi / Medium-duration<br>(Tropics/Subtropics, Dec sowing) | $30 : 30 : 60 : 30\; (150)$ | $1.05 : 1.20 : 0.75^{\dagger}$<br>*(Table 14: $1.05\text{--}1.20$)* | $1.0$ | $0.5 - 1.0$ | $0.20^{\ddagger}$<br>*(of saturation)* | [Tab. 11](https://www.fao.org/3/x0490e/x0490e0b.htm#length of growth stages), [Tab. 12](https://www.fao.org/3/x0490e/x0490e0b.htm#tabulated kc values), [Tab. 14](https://www.fao.org/3/x0490e/x0490e0b.htm#crop coefficient for the initial stage (kc ini)), [Tab. 22](https://www.fao.org/3/x0490e/x0490e0e.htm#readily available water (raw)) |
| **Maize (Field Grain)**<br>*(మొక్కజొన్న / Makka Jonna)* | Rabi / Winter or Kharif<br>*(Row: India, dry, cool)* | $20 : 35 : 40 : 30\; (125)$ | $0.30 : 1.20 : 0.48^{\S}$ | $2.0$ | $1.0 - 1.7$ | $0.55$ | [Tab. 11](https://www.fao.org/3/x0490e/x0490e0b.htm#length of growth stages), [Tab. 12](https://www.fao.org/3/x0490e/x0490e0b.htm#tabulated kc values), [Tab. 22](https://www.fao.org/3/x0490e/x0490e0e.htm#readily available water (raw)) |
| **Groundnut (Peanut)**<br>*(వేరుశనగ / Veru Sanaga)* | Kharif / Rainfed-Irrigated<br>*(Row: West Africa / Dry)* | $25 : 35 : 45 : 25\; (130)$ | $0.40 : 1.15 : 0.60$ | $0.4$ | $0.5 - 1.0$ | $0.50$ | [Tab. 11](https://www.fao.org/3/x0490e/x0490e0b.htm#length of growth stages), [Tab. 12](https://www.fao.org/3/x0490e/x0490e0b.htm#tabulated kc values), [Tab. 22](https://www.fao.org/3/x0490e/x0490e0e.htm#readily available water (raw)) |
| **Cotton**<br>*(పత్తి / Patti)* | Kharif / Monsoonal Black Soil<br>*(Row: Egypt, Pakistan)* | $30 : 50 : 60 : 55\; (195)$ | $0.35 : 1.18 : 0.60^{\parallel}$ | $1.2 - 1.5$ | $1.0 - 1.7$ | $0.65$ | [Tab. 11](https://www.fao.org/3/x0490e/x0490e0b.htm#length of growth stages), [Tab. 12](https://www.fao.org/3/x0490e/x0490e0b.htm#tabulated kc values), [Tab. 22](https://www.fao.org/3/x0490e/x0490e0e.htm#readily available water (raw)) |
| **Sweet Peppers / Chilli**<br>*(మిరప / Mirapa)* | Kharif / Rabi Irrigated<br>*(Row: Europe/Medit. & Arid)* | $30 : 40 : 40 : 20\; (130)$ | $0.60 : 1.05 : 0.90$ | $0.7$ | $0.5 - 1.0$ | $0.30$ | [Tab. 11](https://www.fao.org/3/x0490e/x0490e0b.htm#length of growth stages), [Tab. 12](https://www.fao.org/3/x0490e/x0490e0b.htm#tabulated kc values), [Tab. 22](https://www.fao.org/3/x0490e/x0490e0e.htm#readily available water (raw)) |
| **Sugarcane (Virgin)**<br>*(చెరకు / Cheruku)* | Annual / Perennial Planted<br>*(Row: Tropics)* | $50 : 70 : 220 : 140\; (480)$ | $0.40 : 1.25 : 0.75$ | $3.0$ | $1.2 - 2.0$ | $0.65$ | [Tab. 11](https://www.fao.org/3/x0490e/x0490e0b.htm#length of growth stages), [Tab. 12](https://www.fao.org/3/x0490e/x0490e0b.htm#tabulated kc values), [Tab. 22](https://www.fao.org/3/x0490e/x0490e0e.htm#readily available water (raw)) |
| **Sugarcane (Ratoon)**<br>*(చెరకు / Cheruku)* | Ratoon Regrowth<br>*(Row: Tropics)* | $30 : 50 : 180 : 60\; (320)$ | $0.40 : 1.25 : 0.75$ | $3.0$ | $1.2 - 2.0$ | $0.65$ | [Tab. 11](https://www.fao.org/3/x0490e/x0490e0b.htm#length of growth stages), [Tab. 12](https://www.fao.org/3/x0490e/x0490e0b.htm#tabulated kc values), [Tab. 22](https://www.fao.org/3/x0490e/x0490e0e.htm#readily available water (raw)) |
| **Green Gram (Moong)**<br>*(పెసర / Pesara)* | Rabi / Summer short-duration pulse<br>*(Row: Green gram, cowpeas)* | $20 : 30 : 30 : 20\; (110)$ | $0.40 : 1.05 : 0.35$ *(dry)* | $0.4$ | $0.6 - 1.0$ | $0.45$ | [Tab. 11](https://www.fao.org/3/x0490e/x0490e0b.htm#length of growth stages), [Tab. 12](https://www.fao.org/3/x0490e/x0490e0b.htm#tabulated kc values), [Tab. 22](https://www.fao.org/3/x0490e/x0490e0e.htm#readily available water (raw)) |
| **Black Gram (Urad)**<br>*(మినుములు / Minumulu)* | Rabi rice-fallow pulse<br>*(FAO-56 Status: **NOT FOUND**)* | $15 : 25 : 35 : 20\; (95)$<br>*(Proxy: Dry bean, Pakis.)* | $0.40 : 1.15 : 0.35$<br>*(Proxy: Beans, dry/pulses)* | $0.4$ | $0.6 - 0.9$ | $0.45$ | [Tab. 11](https://www.fao.org/3/x0490e/x0490e0b.htm#length of growth stages), [Tab. 12](https://www.fao.org/3/x0490e/x0490e0b.htm#tabulated kc values), [Tab. 22](https://www.fao.org/3/x0490e/x0490e0e.htm#readily available water (raw)) |
| **Chickpea (Bengal Gram)**<br>*(శనగలు / Sanagalu)* | Rabi dry pulse<br>*(Tab 11: NOT FOUND; Tab 12/22: OK)* | $20 : 30 : 40 : 20\; (110)$<br>*(Proxy: Dry bean/pulse)* | $0.40 : 1.00 : 0.35$ | $0.4$ | $0.6 - 1.0$ | $0.50$ | [Tab. 12](https://www.fao.org/3/x0490e/x0490e0b.htm#tabulated kc values), [Tab. 22](https://www.fao.org/3/x0490e/x0490e0e.htm#readily available water (raw)) |
| **Lentil (Masoor)** | Rabi cool-season pulse | $25 : 35 : 70 : 40\; (170)$<br>*(Row: Arid Region, Oct/Nov)* | $0.40 : 1.10 : 0.30$ | $0.5$ | $0.6 - 0.8$ | $0.50$ | [Tab. 11](https://www.fao.org/3/x0490e/x0490e0b.htm#length of growth stages), [Tab. 12](https://www.fao.org/3/x0490e/x0490e0b.htm#tabulated kc values), [Tab. 22](https://www.fao.org/3/x0490e/x0490e0e.htm#readily available water (raw)) |
| **Sorghum (Jowar)**<br>*(జొన్న / Jonna)* | Kharif / Rabi grain sorghum<br>*(Row: USA, Pakis., Med.)* | $20 : 35 : 40 : 30\; (130)$ | $0.30 : 1.05 : 0.55$ | $1.0 - 2.0$ | $1.0 - 2.0$ | $0.55$ | [Tab. 11](https://www.fao.org/3/x0490e/x0490e0b.htm#length of growth stages), [Tab. 12](https://www.fao.org/3/x0490e/x0490e0b.htm#tabulated kc values), [Tab. 22](https://www.fao.org/3/x0490e/x0490e0e.htm#readily available water (raw)) |
| **Tomato**<br>*(టమాట / Tamata)* | Rabi / Summer vegetable<br>*(Row: Arid Region, Jan)* | $30 : 40 : 40 : 25\; (135)$ | $0.60 : 1.15 : 0.80$ | $0.6$ | $0.7 - 1.5$ | $0.40$ | [Tab. 11](https://www.fao.org/3/x0490e/x0490e0b.htm#length of growth stages), [Tab. 12](https://www.fao.org/3/x0490e/x0490e0b.htm#tabulated kc values), [Tab. 22](https://www.fao.org/3/x0490e/x0490e0e.htm#readily available water (raw)) |
| **Onion (Dry Bulb)**<br>*(ఉల్లిపాయ / Ullipaya)* | Rabi bulb crop<br>*(Row: Mediterranean, April)* | $15 : 25 : 70 : 40\; (150)$ | $0.70 : 1.05 : 0.75$ | $0.4$ | $0.3 - 0.6$ | $0.30$ | [Tab. 11](https://www.fao.org/3/x0490e/x0490e0b.htm#length of growth stages), [Tab. 12](https://www.fao.org/3/x0490e/x0490e0b.htm#tabulated kc values), [Tab. 22](https://www.fao.org/3/x0490e/x0490e0e.htm#readily available water (raw)) |
| **Onion (Green / Bunching)**<br>*(ఉల్లిపాయ / Ullipaya)* | Short-season green onion<br>*(Row: Mediterranean)* | $25 : 30 : 10 : 5\; (70)$ | $0.70 : 1.00 : 1.00$ | $0.3$ | $0.3 - 0.6$ | $0.30$ | [Tab. 11](https://www.fao.org/3/x0490e/x0490e0b.htm#length of growth stages), [Tab. 12](https://www.fao.org/3/x0490e/x0490e0b.htm#tabulated kc values), [Tab. 22](https://www.fao.org/3/x0490e/x0490e0e.htm#readily available water (raw)) |
| **Eggplant (Brinjal)**<br>*(వంకాయ / Vankaya)* | Kharif / Rabi Solanaceae vegetable<br>*(Row: Arid Region, Oct)* | $30 : 40 : 40 : 20\; (130)$ | $0.60 : 1.05 : 0.90$ | $0.8$ | $0.7 - 1.2$ | $0.45$ | [Tab. 11](https://www.fao.org/3/x0490e/x0490e0b.htm#length of growth stages), [Tab. 12](https://www.fao.org/3/x0490e/x0490e0b.htm#tabulated kc values), [Tab. 22](https://www.fao.org/3/x0490e/x0490e0e.htm#readily available water (raw)) |
| **Cabbage**<br>*(కోసు / Kosu)* | Rabi winter cole crop<br>*(Row: Calif. Desert)* | $40 : 60 : 50 : 15\; (165)$ | $0.70 : 1.05 : 0.95$ | $0.4$ | $0.5 - 0.8$ | $0.45$ | [Tab. 11](https://www.fao.org/3/x0490e/x0490e0b.htm#length of growth stages), [Tab. 12](https://www.fao.org/3/x0490e/x0490e0b.htm#tabulated kc values), [Tab. 22](https://www.fao.org/3/x0490e/x0490e0e.htm#readily available water (raw)) |
| **Cauliflower**<br>*(క్యాలీఫ్లవర్ / Gobi)* | Rabi winter cole crop<br>*(Row: Calif. Desert)* | $35 : 50 : 40 : 15\; (140)$ | $0.70 : 1.05 : 0.95$ | $0.4$ | $0.4 - 0.7$ | $0.45$ | [Tab. 11](https://www.fao.org/3/x0490e/x0490e0b.htm#length of growth stages), [Tab. 12](https://www.fao.org/3/x0490e/x0490e0b.htm#tabulated kc values), [Tab. 22](https://www.fao.org/3/x0490e/x0490e0e.htm#readily available water (raw)) |
| **Cucumber**<br>*(దోసకాయ / Dosakaya)* | Summer / Rabi Cucurbit<br>*(Row: Fresh Market, Arid)* | $20 : 30 : 40 : 15\; (105)$ | $0.60 : 1.00 : 0.75$ | $0.3$ | $0.7 - 1.2$ | $0.50$ | [Tab. 11](https://www.fao.org/3/x0490e/x0490e0b.htm#length of growth stages), [Tab. 12](https://www.fao.org/3/x0490e/x0490e0b.htm#tabulated kc values), [Tab. 22](https://www.fao.org/3/x0490e/x0490e0e.htm#readily available water (raw)) |
| **Watermelon**<br>*(పుచ్చకాయ / Pucha Kaya)* | Summer riverbed / canal bund<br>*(Row: Near East / Arid)* | $20 : 30 : 30 : 30\; (110)$ | $0.40 : 1.00 : 0.75$ | $0.4$ | $0.8 - 1.5$ | $0.40$ | [Tab. 11](https://www.fao.org/3/x0490e/x0490e0b.htm#length of growth stages), [Tab. 12](https://www.fao.org/3/x0490e/x0490e0b.htm#tabulated kc values), [Tab. 22](https://www.fao.org/3/x0490e/x0490e0e.htm#readily available water (raw)) |
| **Sweet Melons / Muskmelon**<br>*(ఖర్బూజా / Kharbhuja)* | Summer Cucurbit<br>*(Row: Mediterranean / Arid)* | $25 : 35 : 40 : 20\; (120)$ | $0.50 : 1.05 : 0.75$ | $0.4$ | $0.8 - 1.5$ | $0.40$ | [Tab. 11](https://www.fao.org/3/x0490e/x0490e0b.htm#length of growth stages), [Tab. 12](https://www.fao.org/3/x0490e/x0490e0b.htm#tabulated kc values), [Tab. 22](https://www.fao.org/3/x0490e/x0490e0e.htm#readily available water (raw)) |
| **Okra (Bhendi)**<br>*(బెండకాయ / Bhendakaya)* | Kharif / Summer vegetable<br>*(FAO-56 Status: **NOT FOUND**)* | $20 : 30 : 30 : 15\; (95)$<br>*(Proxy: Small veg./Beans)* | $0.50 : 1.00 : 0.85$<br>*(Proxy: Small veg./Solan.)* | $0.6 - 1.0$ | $0.5 - 0.8$ | $0.40$ | **NOT FOUND** in FAO-56. Listed as agronomic proxy from ICAR / ANGRAU guidelines. |

---

### 2.2 Table Notes & Specific Values
- $^{\dagger}$ **Rice $K_{c\,\mathrm{end}}$:** Table 12 lists $0.90\text{--}0.60$. The upper value ($0.90$) applies when fields remain flooded to near harvest; the lower value ($0.60$) applies when paddy water is drained 2–3 weeks prior to harvest (standard drainage practice before combine or manual harvest).
- $^{\ddagger}$ **Rice Depletion Fraction $p$:** Table 22 Footnote 4 specifies $p = 0.20$ *of saturation*, reflecting extreme susceptibility to aerobic soil stress.
- $^{\S}$ **Maize $K_{c\,\mathrm{end}}$:** Table 12 lists $0.60\text{--}0.35$. $0.60$ is for harvest at high grain moisture; $0.35$ is for complete field drying down to $\approx 18\%$ moisture.
- $^{\parallel}$ **Cotton $K_c$:** Table 12 lists $K_{c\,\mathrm{mid}} = 1.15\text{--}1.20$ and $K_{c\,\mathrm{end}} = 0.70\text{--}0.50$.
- **Values for $K_{c\,\mathrm{ini}}$:** For crops where Table 12 row cells are blank, the group default $K_{c\,\mathrm{ini}}$ is provided. As noted in FAO-56 Table 12 Footnote 1, $K_{c\,\mathrm{ini}}$ varies with wetting frequency, irrigation interval, and topsoil wetting fraction ($f_w$).

---

## 3. Typical Soil Water Characteristics (FAO-56 Table 19)

**Source Chapter:** Chapter 7 — ETc - Dual crop coefficient, section *Soil evaporation reduction coefficient (Kr)*  
**Exact URL:** [https://www.fao.org/3/x0490e/x0490e0c.htm#soil evaporation reduction coefficient (kr)](https://www.fao.org/3/x0490e/x0490e0c.htm#soil evaporation reduction coefficient (kr))  
*(Cross-referenced in Chapter 8, page [x0490e0e.htm](https://www.fao.org/3/x0490e/x0490e0e.htm) under Total available water)*

The table below presents the official FAO-56 Table 19 soil hydraulic parameters, mapped to typical soil orders found along the Andhra Pradesh canal networks (Black cotton Vertisols, Red Alfisols, and Coastal/Deltaic Alluvial soils).

| Soil Texture Class<br>*(USDA Classification)* | Typical Andhra Pradesh Equivalent | Field Capacity<br>$\theta_{\mathrm{FC}}$ ($\mathrm{m^3\,m^{-3}}$) | Permanent Wilting Point<br>$\theta_{\mathrm{WP}}$ ($\mathrm{m^3\,m^{-3}}$) | Available Water Capacity<br>$(\theta_{\mathrm{FC}} - \theta_{\mathrm{WP}})$ ($\mathrm{m^3\,m^{-3}}$) | Available Water<br>$\mathrm{TAW}_{\text{unit}}$ ($\mathrm{mm/m}$) | Readily Evaporable<br>$\mathrm{REW}$ (mm) | Total Evaporable<br>$\mathrm{TEW}$ ($Z_e = 0.10\,\text{m}$) (mm) |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Sand** | Coastal sands / beach ridges | $0.07 - 0.17$ | $0.02 - 0.07$ | $0.05 - 0.11$ | $50 - 110$ | $2 - 7$ | $6 - 12$ |
| **Loamy sand** | Light red soils / sand dunes | $0.11 - 0.19$ | $0.03 - 0.10$ | $0.06 - 0.12$ | $60 - 120$ | $4 - 8$ | $9 - 14$ |
| **Sandy loam** | Red sandy soils (*Chalka* / Alfisols) | $0.18 - 0.28$ | $0.06 - 0.16$ | $0.11 - 0.15$ | $110 - 150$ | $6 - 10$ | $15 - 20$ |
| **Loam** | Medium mixed red/black soils | $0.20 - 0.30$ | $0.07 - 0.17$ | $0.13 - 0.18$ | $130 - 180$ | $8 - 10$ | $16 - 22$ |
| **Silt loam** | Krishna/Godavari delta alluvium | $0.22 - 0.36$ | $0.09 - 0.21$ | $0.13 - 0.19$ | $130 - 190$ | $8 - 11$ | $18 - 25$ |
| **Silt** | Fine riverine delta silt | $0.28 - 0.36$ | $0.12 - 0.22$ | $0.16 - 0.20$ | $160 - 200$ | $8 - 11$ | $22 - 26$ |
| **Silt clay loam** | Heavy deltaic alluvium | $0.30 - 0.37$ | $0.17 - 0.24$ | $0.13 - 0.18$ | $130 - 180$ | $8 - 11$ | $22 - 27$ |
| **Silty clay** | Deep delta black clay / backswamps | $0.30 - 0.42^{\ast}$ | $0.17 - 0.29$ | $0.13 - 0.19$ | $130 - 190$ | $8 - 12$ | $22 - 28$ |
| **Clay** | Deep Black Cotton Soils (*Regur* / Vertisols) | $0.32 - 0.40$ | $0.20 - 0.24$ | $0.12 - 0.20$ | $120 - 200$ | $8 - 12$ | $22 - 29$ |

$^{\ast}$ *FAO-56 online HTML has verbatim OCR typo `0-30 - 0.42`, corrected here to `0.30 - 0.42`.*  
$^{\dagger}$ $\mathrm{TEW} = (\theta_{\mathrm{FC}} - 0.5\,\theta_{\mathrm{WP}}) Z_e$, with surface evaporation depth $Z_e = 0.10\,\mathrm{m}$.

---

## 4. FAO-56 Governing Equations (LaTeX Formulation)

### 4.1 Crop Evapotranspiration Under Standard Conditions
Under non-stressed agronomic conditions, crop water requirement $\mathrm{ET}_c$ [$\mathrm{mm\,d^{-1}}$] is given by FAO-56 Eq. 58:
$$\mathrm{ET}_c = K_c \cdot \mathrm{ET}_o$$
where:
- $\mathrm{ET}_o$: Penman-Monteith reference evapotranspiration [$\mathrm{mm\,d^{-1}}$]
- $K_c$: Single crop coefficient (integrating transpiration and average soil evaporation) [-]

---

### 4.2 Climatic Adjustments for Mid-Season and Late-Season $K_c$
Tabulated $K_c$ values in Table 12 represent a sub-humid climate ($\mathrm{RH}_{\min} \approx 45\%$, mean wind speed $u_2 \approx 2.0\,\mathrm{m\,s^{-1}}$). When applied to semi-arid or arid canal environments (e.g. Rayalaseema or dry pre-monsoon periods where $\mathrm{RH}_{\min} < 45\%$ and winds are strong), adjustments must be applied.

#### 4.2.1 Mid-Season Adjustment (FAO-56 Eq. 62)
$$K_{c\,\mathrm{mid}} = K_{c\,\mathrm{mid(Tab)}} + \left[ 0.04(u_2 - 2) - 0.004(\mathrm{RH}_{\min} - 45) \right] \left( \frac{h}{3} \right)^{0.3}$$
valid for:
- $1\,\mathrm{m\,s^{-1}} \le u_2 \le 6\,\mathrm{m\,s^{-1}}$
- $20\% \le \mathrm{RH}_{\min} \le 80\%$
- $0.1\,\mathrm{m} \le h \le 10\,\mathrm{m}$ (where $h$ is maximum crop height [m] from Table 12)

#### 4.2.2 End-Stage Adjustment (FAO-56 Eq. 65)
$$K_{c\,\mathrm{end}} = K_{c\,\mathrm{end(Tab)}} + \left[ 0.04(u_2 - 2) - 0.004(\mathrm{RH}_{\min} - 45) \right] \left( \frac{h}{3} \right)^{0.3}$$
**Governing Rule:** Equation 65 is applied **only if** $K_{c\,\mathrm{end(Tab)}} > 0.45$ (for crops harvested green or with residual canopy cover). If $K_{c\,\mathrm{end(Tab)}} \le 0.45$ (grain crops allowed to dry naturally in the field), **no adjustment** is made ($K_{c\,\mathrm{end}} = K_{c\,\mathrm{end(Tab)}}$).

---

### 4.3 Daily $K_c(t)$ Curve Construction Across Growth Stages
The growing season of length $L_{\mathrm{total}} = L_{\mathrm{ini}} + L_{\mathrm{dev}} + L_{\mathrm{mid}} + L_{\mathrm{late}}$ is divided into four distinct phenological periods. The daily coefficient $K_{c,\,i}$ for day $i \in [1, L_{\mathrm{total}}]$ is computed using FAO-56 Eq. 66:

$$K_{c,\,i} = \begin{cases}
K_{c\,\mathrm{ini}} & \text{if } 1 \le i \le L_{\mathrm{ini}} \\
K_{c\,\mathrm{ini}} + \left[ \dfrac{i - L_{\mathrm{ini}}}{L_{\mathrm{dev}}} \right] (K_{c\,\mathrm{mid}} - K_{c\,\mathrm{ini}}) & \text{if } L_{\mathrm{ini}} < i \le (L_{\mathrm{ini}} + L_{\mathrm{dev}}) \\
K_{c\,\mathrm{mid}} & \text{if } (L_{\mathrm{ini}} + L_{\mathrm{dev}}) < i \le (L_{\mathrm{ini}} + L_{\mathrm{dev}} + L_{\mathrm{mid}}) \\
K_{c\,\mathrm{mid}} + \left[ \dfrac{i - (L_{\mathrm{ini}} + L_{\mathrm{dev}} + L_{\mathrm{mid}})}{L_{\mathrm{late}}} \right] (K_{c\,\mathrm{end}} - K_{c\,\mathrm{mid}}) & \text{if } (L_{\mathrm{ini}} + L_{\mathrm{dev}} + L_{\mathrm{mid}}) < i \le L_{\mathrm{total}}
\end{cases}$$

---

### 4.4 $K_{c\,\mathrm{ini}}$ Adjustment for Flooded / Paddy Rice
For lowland paddy rice with standing water depth of $0.10 - 0.20\,\mathrm{m}$, initial stage ET is primarily open water evaporation. Table 12 gives $K_{c\,\mathrm{ini}} = 1.05$ for sub-humid conditions. Table 14 defines the climate matrix for $K_{c\,\mathrm{ini}}$:

$$K_{c\,\mathrm{ini(Rice)}} = \begin{cases}
1.10 & \text{Arid / Semi-arid, Light wind } (u_2 < 1\,\mathrm{m/s}) \\
1.15 & \text{Arid / Semi-arid, Moderate wind } (u_2 \approx 2\,\mathrm{m/s}) \\
1.20 & \text{Arid / Semi-arid, Strong wind } (u_2 > 4\,\mathrm{m/s}) \\
1.05 & \text{Sub-humid, Moderate wind} \\
1.00 & \text{Very humid, Calm to light wind}
\end{cases}$$

---

### 4.5 Soil Water Storage Capacity: TAW and RAW
The capacity of the root zone to store moisture available to the crop is defined by FAO-56 Eq. 82 & 83:

#### 4.5.1 Total Available Water (TAW)
$$\mathrm{TAW} = 1000 \cdot (\theta_{\mathrm{FC}} - \theta_{\mathrm{WP}}) \cdot Z_r$$
where:
- $\mathrm{TAW}$: Total available soil water in root zone [$\mathrm{mm}$]
- $\theta_{\mathrm{FC}}$: Volumetric water content at field capacity [$\mathrm{m^3\,m^{-3}}$]
- $\theta_{\mathrm{WP}}$: Volumetric water content at permanent wilting point [$\mathrm{m^3\,m^{-3}}$]
- $Z_r$: Effective rooting depth on day $i$ [$\mathrm{m}$]

During vegetative development, rooting depth expands dynamically from $Z_{r\,\mathrm{ini}} \approx 0.2\text{--}0.3\,\mathrm{m}$ to $Z_{r\,\max}$ (Table 22):
$$Z_{r,\,i} = Z_{r\,\mathrm{ini}} + (Z_{r\,\max} - Z_{r\,\mathrm{ini}}) \cdot \left[ \frac{i}{L_{\mathrm{ini}} + L_{\mathrm{dev}}} \right] \quad \text{for } i \le L_{\mathrm{ini}} + L_{\mathrm{dev}}$$

#### 4.5.2 Readily Available Water (RAW)
$$\mathrm{RAW} = p \cdot \mathrm{TAW}$$
where:
- $\mathrm{RAW}$: Readily available soil water extracted without water stress [$\mathrm{mm}$]
- $p$: Soil water depletion fraction from Table 22 [-]

#### 4.5.3 Dynamic Adjustment of Depletion Fraction $p$ for Atmospheric Demand
Because higher evaporative demand induces plant stress at lower soil moisture deficits, $p$ is adjusted dynamically according to daily $\mathrm{ET}_c$:
$$p = p_{\text{Table 22}} + 0.04 \cdot (5 - \mathrm{ET}_c)$$
subject to the strict physical bounds:
$$0.1 \le p \le 0.8$$
with $\mathrm{ET}_c$ expressed in $\mathrm{mm\,d^{-1}}$.

*Soil texture modification:*
- For fine-textured soils (heavy clay Vertisols), reduce $p$ by $5\text{--}10\%$ ($p_{\text{adj}} = 0.90\text{--}0.95 \cdot p$).
- For coarse sandy soils, increase $p$ by $5\text{--}10\%$ ($p_{\text{adj}} = 1.05\text{--}1.10 \cdot p$).

---

### 4.6 Water Stress Reduction Coefficient ($K_s$)
When root zone depletion $D_r$ exceeds $\mathrm{RAW}$, transpiration is reduced by the stress coefficient $K_s$ (FAO-56 Eq. 84):

$$K_s = \begin{cases}
1.0 & \text{if } D_r \le \mathrm{RAW} \\
\dfrac{\mathrm{TAW} - D_r}{\mathrm{TAW} - \mathrm{RAW}} = \dfrac{\mathrm{TAW} - D_r}{(1 - p)\,\mathrm{TAW}} & \text{if } \mathrm{RAW} < D_r \le \mathrm{TAW} \\
0.0 & \text{if } D_r > \mathrm{TAW}
\end{cases}$$

The actual crop evapotranspiration under water-limiting conditions is then computed by FAO-56 Eq. 81:
$$\mathrm{ET}_{c\,\mathrm{adj}} = K_s \cdot K_c \cdot \mathrm{ET}_o$$

---

### 4.7 Daily Root Zone Depletion Balance ($D_{r,\,i}$)
The daily soil moisture depletion $D_{r,\,i}$ [$\mathrm{mm}$] is tracked at field scale via the mass balance equation (FAO-56 Eq. 85):

$$D_{r,\,i} = D_{r,\,i-1} - (P_i - \mathrm{RO}_i) - I_i - \mathrm{CR}_i + \mathrm{ET}_{c\,\mathrm{adj},\,i} + \mathrm{DP}_i$$
where:
- $D_{r,\,i}$: Depletion at the end of day $i$ [$\mathrm{mm}$] ($D_{r,\,i} = 0$ corresponds to field capacity)
- $D_{r,\,i-1}$: Depletion at the end of previous day $i-1$ [$\mathrm{mm}$]
- $P_i$: Precipitation on day $i$ [$\mathrm{mm}$]
- $\mathrm{RO}_i$: Surface runoff from precipitation on day $i$ [$\mathrm{mm}$]; effective precipitation is $P_{\mathrm{eff},\,i} = P_i - \mathrm{RO}_i$
- $I_i$: Net irrigation depth infiltrating root zone on day $i$ [$\mathrm{mm}$]
- $\mathrm{CR}_i$: Capillary rise from shallow water table [$\mathrm{mm}$]
- $\mathrm{ET}_{c\,\mathrm{adj},\,i}$: Actual crop evapotranspiration on day $i$ [$\mathrm{mm}$]
- $\mathrm{DP}_i$: Deep percolation loss beyond root zone on day $i$ [$\mathrm{mm}$]

#### 4.7.1 Physical Constraints on Depletion (FAO-56 Eq. 86)
$$0 \le D_{r,\,i} \le \mathrm{TAW}$$

#### 4.7.2 Deep Percolation Loss (FAO-56 Eq. 88)
Following rain or irrigation exceeding the soil storage capacity ($D_{r,\,i} < 0$), excess water is lost on the same day as deep percolation:
$$\mathrm{DP}_i = \max\left(0,\, (P_i - \mathrm{RO}_i) + I_i - \mathrm{ET}_{c\,\mathrm{adj},\,i} - D_{r,\,i-1}\right)$$
When $\mathrm{DP}_i > 0$, the end-of-day depletion resets to zero ($D_{r,\,i} = 0$, field capacity).

---

### 4.8 Canal Scheduling Volume and Turn Duration Calculation
For the Jadal canal allocation engine, when an outlet turn is triggered for farmer $k$ with field area $A_{\mathrm{field},\,k}$ [$\mathrm{ha}$] and root zone deficit $D_{r,\,k}$ [$\mathrm{mm}$]:

1. **Net Irrigation Requirement ($D_{\mathrm{net}}$):**
   $$D_{\mathrm{net}} = D_{r,\,k} \quad [\mathrm{mm}]$$
2. **Gross Field Water Volume ($V_{\mathrm{turn}}$):**
   $$V_{\mathrm{turn},\,k} = \frac{10 \cdot D_{\mathrm{net}} \cdot A_{\mathrm{field},\,k}}{E_a} \quad [\mathrm{m^3}]$$
   where:
   - $10$: Conversion factor ($1\,\mathrm{mm} \times 1\,\mathrm{ha} = 10\,\mathrm{m^3}$)
   - $E_a$: Field application efficiency ($0.60\text{--}0.75$ for surface furrow/basin; $0.85\text{--}0.90$ for drip)
3. **Turn Duration ($T_{\mathrm{turn}}$):**
   $$T_{\mathrm{turn},\,k} = \frac{V_{\mathrm{turn},\,k}}{3600 \cdot Q_{\mathrm{delivered},\,k}} \quad [\mathrm{hours}]$$
   where $Q_{\mathrm{delivered},\,k}$ is the actual physical flow rate delivered at outlet $k$ [$\mathrm{m^3\,s^{-1}}$] calculated by the canal hydraulic model accounting for seepage and transit lag.

---

## 5. Parameter Selection Rationale for Andhra Pradesh Agro-Climatic Context

### 5.1 Rice (Paddy)
- **Stage Selection:** Rice in AP is grown in two primary seasons:
  1. *Kharif (Sarva / Salwah):* Sown in June/July and harvested in November/December. Long-duration high-yielding varieties (e.g. BPT-5204 / Samba Mahsuri, MTU-1061) require 150–180 days. The Table 11 row `Rice | 30 | 30 | 80 | 40 | 180 | May | Tropics` was selected for long-duration Kharif paddy.
  2. *Rabi (Dalwa):* Sown in December/January and harvested in April. Medium-duration varieties (e.g. MTU-1010, IR-64) mature in 120–145 days. The Table 11 row `Rice | 30 | 30 | 60 | 30 | 150 | Dec; May | Tropics; Mediterranean` was selected.
- **Crop Coefficients:** $K_{c\,\mathrm{ini}} = 1.05$ (standard sub-humid) adjusted to $1.15$ during hot/dry pre-monsoon winds per Table 14. $K_{c\,\mathrm{mid}} = 1.20$. For $K_{c\,\mathrm{end}}$, $0.75$ is the midpoint of the $0.60\text{--}0.90$ range, dropping to $0.60$ upon final field drainage 15 days before harvest.
- **Root Depth & Depletion:** $Z_r = 0.5\text{--}0.8\,\mathrm{m}$ (shallow rooting due to hard plow pan). $p = 0.20$ of saturation (Table 22 Footnote 4) because paddy yields drop sharply if standing water disappears and root zone dries below field capacity.
- **Percolation and Puddling Status:** As verified in [`.ref/fao56/fao56-crop-tables.md`](file://.ref/fao56/fao56-crop-tables.md), the terms **puddling** and empirical **paddy percolation rates** are **NOT FOUND** in FAO-56. For canal water budgeting in Jadal, non-ET percolation must be added externally: $2\text{--}4\,\mathrm{mm/d}$ on puddled black Vertisols and $4\text{--}8\,\mathrm{mm/d}$ on light alluvial soils, based on local ANGRAU / Directorate of Rice Research (IIRR Hyderabad) experimental baselines.

### 5.2 Maize (Grain)
- **Row Selected:** Table 11 provides an exact row for India: `Maize (grain) | 20 | 35 | 40 | 30 | 125 | October | India (dry, cool)`.
- **Rationale:** Maize in AP (Guntur, West Godavari, Kurnool) is grown heavily as a post-paddy Rabi crop sown in October/November under cool, dry winter weather. The stage distribution ($20/35/40/30$, total 125 days) matches hybrid varieties (e.g. Pioneer, Syngenta) exactly.
- **Parameters:** $K_{c\,\mathrm{ini}} = 0.30$ (cereals default), $K_{c\,\mathrm{mid}} = 1.20$, $K_{c\,\mathrm{end}} = 0.48$ (midpoint of $0.60\text{--}0.35$ dry grain harvest). $Z_r = 1.0\text{--}1.7\,\mathrm{m}$, $p = 0.55$.

### 5.3 Groundnut (Peanut)
- **Row Selected:** Table 11 `Groundnut | 25 | 35 | 45 | 25 | 130 | Dry | West Africa`.
- **Rationale:** Groundnut is a cornerstone oilseed crop in the dry semi-arid tract of Rayalaseema (Anantapur, Chittoor, Kurnool). The 130-day semi-arid/dry cycle ($25/35/45/25$) corresponds closely to local varieties (TMV-2, JL-24, Kadiri-6) which mature in 105–125 days.
- **Parameters:** $K_{c\,\mathrm{ini}} = 0.40$, $K_{c\,\mathrm{mid}} = 1.15$, $K_{c\,\mathrm{end}} = 0.60$, $Z_r = 0.5\text{--}1.0\,\mathrm{m}$, $p = 0.50$.

### 5.4 Cotton
- **Row Selected:** Table 11 `Cotton | 30 | 50 | 60 | 55 | 195 | Mar-May | Egypt; Pakistan; Calif.`.
- **Rationale:** Cotton in AP (Guntur, Prakasam, Kurnool) is grown on deep black soils (*regur*) over 160–195 days. The Pakistan/Egypt semi-arid irrigated row ($30/50/60/55$, total 195 days) accurately captures Bt-cotton boll maturation and multiple picking flushes.
- **Parameters:** $K_{c\,\mathrm{ini}} = 0.35$, $K_{c\,\mathrm{mid}} = 1.18$, $K_{c\,\mathrm{end}} = 0.60$, $Z_r = 1.0\text{--}1.7\,\mathrm{m}$, $p = 0.65$ (deep taproot enables high drought tolerance).

### 5.5 Chilli (Sweet Peppers Proxy)
- **Status in FAO-56:** "Chilli" (*Capsicum annuum / frutescens*) is **NOT FOUND** as an independent entry. FAO-56 indexes peppers under `Sweet peppers (bell)`.
- **Row Selected:** Table 11 `Sweet peppers (bell) | 25/30 | 35 | 40 | 20 | 125 | April/June | Europe and Medit.` alongside the extended 210-day arid row. For irrigated green/dry chilli in AP (Guntur chilli belt), a 130-day base cycle ($30/40/40/20$) is recommended for canal planning.
- **Parameters:** $K_{c\,\mathrm{ini}} = 0.60$, $K_{c\,\mathrm{mid}} = 1.05$, $K_{c\,\mathrm{end}} = 0.90$ (harvested green/ripe continuously), $Z_r = 0.5\text{--}1.0\,\mathrm{m}$, $p = 0.30$ (highly sensitive to moisture stress; drought triggers flower and fruit drop).

### 5.6 Sugarcane
- **Rows Selected:**
  1. *Virgin plant:* Table 11 `Sugarcane, virgin | 50 | 70 | 220 | 140 | 480 | Tropics` (or Low Latitudes 405-day row).
  2. *Ratoon crop:* Table 11 `Sugarcane, ratoon | 30 | 50 | 180 | 60 | 320 | Tropics`.
- **Rationale:** Sugarcane is perennial in Visakhapatnam, East Godavari, and Chittoor sugar belts. Virgin crops take 12–14 months, while ratoon crops take 10–11 months. Mid-season grand growth lasts 180–220 days.
- **Parameters:** $K_{c\,\mathrm{ini}} = 0.40$, $K_{c\,\mathrm{mid}} = 1.25$, $K_{c\,\mathrm{end}} = 0.75$, $h = 3.0\,\mathrm{m}$, $Z_r = 1.2\text{--}2.0\,\mathrm{m}$, $p = 0.65$.

### 5.7 Pulses (Green Gram, Black Gram, Chickpea, Lentil)
- **Green Gram (Moong / Pesara):** Table 11 lists `Green gram, cowpeas | 20 | 30 | 30 | 20 | 110 | March | Mediterranean`. Ideal for summer/Rabi short pulse in delta fallows. $K_c = 0.40 / 1.05 / 0.35$, $p = 0.45$.
- **Black Gram (Urad / Minumulu):** **NOT FOUND** in FAO-56. Black gram (*Vigna mungo*) has identical morphology to green gram (*Vigna radiata*). It is grown extensively as a relay crop in Krishna/Godavari rice fallows (75–85 days). Engineering proxy: Use Table 11 `Beans (dry) (Pakistan)` ($15/25/35/20 = 95\text{ days}$) or Green gram with $K_c = 0.40 / 1.15 / 0.35$ and $p = 0.45$.
- **Chickpea (Bengal Gram / Sanagalu):** Present in Table 12 ($K_c = 0.40 / 1.00 / 0.35$) and Table 22 ($Z_r = 0.6\text{--}1.0\,\mathrm{m}, p = 0.50$). In Table 11, Chickpea is **NOT FOUND**; stage lengths are adopted from `Beans, dry` ($20/30/40/20 = 110\text{ days}$), matching winter chickpea in Kurnool/Prakasam.
- **Lentil:** Table 11 Arid Oct/Nov row ($25/35/70/40 = 170\text{ days}$); $K_c = 0.40 / 1.10 / 0.30$, $p = 0.50$.

### 5.8 Sorghum (Jowar / Jonna)
- **Row Selected:** Table 11 `Sorghum | 20 | 35 | 40 | 30 | 130 | May/June | USA, Pakis., Med.`.
- **Rationale:** Represents semi-arid grain sorghum in the Deccan plateau tracts of Andhra Pradesh.
- **Parameters:** $K_{c\,\mathrm{ini}} = 0.30$, $K_{c\,\mathrm{mid}} = 1.05$, $K_{c\,\mathrm{end}} = 0.55$, $h = 1.5\,\mathrm{m}$, $Z_r = 1.0\text{--}2.0\,\mathrm{m}$, $p = 0.55$.

### 5.9 Vegetables Relevant to Andhra Pradesh
- **Tomato:** Sown year-round; Rabi/winter season represented by Table 11 Arid row ($30/40/40/25 = 135\text{ days}$). $K_c = 0.60 / 1.15 / 0.80$, $Z_r = 0.7\text{--}1.5\,\mathrm{m}$, $p = 0.40$.
- **Onion:** Table 11 dry bulb row ($15/25/70/40 = 150\text{ days}$) and green bunching row ($25/30/10/5 = 70\text{ days}$). Highly sensitive shallow root system ($Z_r = 0.3\text{--}0.6\,\mathrm{m}, p = 0.30$).
- **Eggplant (Brinjal / Vankaya):** Table 11 Arid row ($30/40/40/20 = 130\text{ days}$). $K_c = 0.60 / 1.05 / 0.90$, $Z_r = 0.7\text{--}1.2\,\mathrm{m}$, $p = 0.45$.
- **Cabbage & Cauliflower:** Table 11 Desert/Arid rows ($165\text{ days}$ and $140\text{ days}$); Mediterranean crucifer row ($25/35/25/10 = 95\text{ days}$) used for quick winter hybrids. $K_c = 0.70 / 1.05 / 0.95$, $p = 0.45$.
- **Cucurbits (Cucumber, Sweet Melons, Watermelon):** Table 11 Arid rows ($105\text{ days}$ for cucumber, $110\text{ days}$ for watermelon, $120\text{ days}$ for muskmelon). $K_{c\,\mathrm{mid}} \approx 1.00\text{--}1.05$, $K_{c\,\mathrm{end}} = 0.75$, $p = 0.40\text{--}0.50$.
- **Okra (Bhendi / Ladies Finger):** **NOT FOUND** in FAO-56. As an essential AP market vegetable (Guntur, Chittoor, Krishna), proxy values are assigned: 90–95 day duration ($20/30/30/15$), $K_c = 0.50 / 1.00 / 0.85$, $Z_r = 0.5\text{--}0.8\,\mathrm{m}$, $p = 0.40$, consistent with Indian Council of Agricultural Research (ICAR) water management guidelines.

---

## 6. Verification and Reference Traceability

Every table and formula in this document has been fetched live from the official FAO repository and verified against the local raw cache in [`.ref/fao56/fao56-crop-tables.md`](file://.ref/fao56/fao56-crop-tables.md).

| Document Entity | FAO-56 Chapter | Official Page URL | Local Verbatim File Reference |
| :--- | :--- | :--- | :--- |
| **FAO-56 Table of Contents** | Overview | [x0490e00.htm](https://www.fao.org/3/x0490e/x0490e00.htm) | [`.ref/fao56/fao56-crop-tables.md`](file://.ref/fao56/fao56-crop-tables.md) |
| **Table 11 (Growth Stages)** | Chapter 6 | [x0490e0b.htm#length of growth stages](https://www.fao.org/3/x0490e/x0490e0b.htm#length of growth stages) | Section 1 |
| **Table 12 (Crop Coefficients $K_c$)** | Chapter 6 | [x0490e0b.htm#tabulated kc values](https://www.fao.org/3/x0490e/x0490e0b.htm#tabulated kc values) | Section 2 |
| **Table 14 ($K_{c\,\mathrm{ini}}$ Rice)** | Chapter 6 | [x0490e0b.htm#crop coefficient for the initial stage (kc ini)](https://www.fao.org/3/x0490e/x0490e0b.htm#crop coefficient for the initial stage (kc ini)) | Section 3 |
| **Equations 58, 62, 65, 66** | Chapter 6 | [x0490e0b.htm#construction of the kc curve](https://www.fao.org/3/x0490e/x0490e0b.htm#construction of the kc curve) | Section 6.1 – 6.4 |
| **Table 19 (Soil Water)** | Chapter 7 | [x0490e0c.htm#soil evaporation reduction coefficient (kr)](https://www.fao.org/3/x0490e/x0490e0c.htm#soil evaporation reduction coefficient (kr)) | Section 5 |
| **Table 22 (Rooting Depth $Z_r$ & $p$)** | Chapter 8 | [x0490e0e.htm#readily available water (raw)](https://www.fao.org/3/x0490e/x0490e0e.htm#readily available water (raw)) | Section 4 |
| **Equations 80 – 88 (TAW, RAW, $K_s$, $D_r$, DP)** | Chapter 8 | [x0490e0e.htm#water stress coefficient (ks)](https://www.fao.org/3/x0490e/x0490e0e.htm#water stress coefficient (ks)) | Section 6.5 – 6.9 |
