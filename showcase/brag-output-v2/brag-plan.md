# Brag Plan: Jadal (v2 Launch Video)

## 1. Project Overview & Planning Rubric
- **Project Name:** Jadal (జదల్)
- **Tagline:** Canal water shared by volume, not by hours.
- **Problem:** Traditional rotational canal scheduling (*warabandi*) divides turn time equally, ignoring physical conveyance losses. Along unlined earthen canals, seepage decay claims nearly 30% of flow between head and tail outlets. An hour at the tail yields significantly less water than an hour at the head; farmers receive unequal water despite equal time.
- **Solution:** Jadal models canal conveyance using open-channel hydraulics ($Q(x) = Q_0 e^{-kx}$) and FAO-56 crop physics. It replaces fixed-time turns with equal-volume allocations ($T_i = V_i / Q(x_i)$).
- **Core Governance Mandate:** **LLMs propose · Deterministic core computes · Coordinator approves.**
- **Bilingual & Telephony Inclusion:** Full Telugu voice interface and IVR phone alerts for farmers without smartphones; verified 601/601 exact bilingual leaf keys.
- **Double-Entry Conservation:** Immutable ledger accounts for every cubic metre ($\sum \text{Debits} = \sum \text{Credits}$), proving water conservation across the system.

## 2. Creative Angle & Tone
- **Preset:** `polished`
- **Direction:** Quiet, serious civic infrastructure launch film; mathematically rigorous, evidence-based, devoid of startup hype or sarcasm.
- **Visual Palette:**
  - Background: `#FAF9F5` (warm ivory)
  - Surface: `#FFFFFF` (pure white cards)
  - Surface Alt: `#F3F1EA` (light stone)
  - Primary Text: `#1F1E1D` (deep charcoal)
  - Muted Text: `#73716A` (warm slate)
  - Water Blue: `#4E7A96` (canal slate blue)
  - Accent Clay: `#C96442` (warm earthen clay)
  - Ok / Verified Green: `#235817`
- **Fonts:** Source Serif 4, IBM Plex Sans, IBM Plex Mono, Noto Sans Telugu.

## 3. Specifications
- **Format:** Landscape (16:9) — 1920 × 1080
- **Framerate:** 30 fps
- **Total Duration:** 56.0 seconds (within 45–60 s target)
- **Audio Bed:** Procedural ambient music bed (`ambient-bed.ogg`, -18.1 LUFS) with subtle ducking and organic UI sound effects (`tick.wav`, `swell.wav`, `chime.wav`, `dtmf_ack.wav`).
- **Captions:** Burned-in bilingual captions (English primary, Telugu secondary) throughout all 6 scenes.

---

## 4. Evidentiary Standards & Forbidden Claims
- **Strictly Allowed Metrics (from `showcase/video/facts.md`):**
  - Canal: Kondaveedu Minor Canal (demo), 3 km unlined earthen reach, 8 outlets ($o_1$ to $o_8$).
  - Head Outlet 1 (300 m): flow $0.145\text{ m}^3/\text{s}$ ($3.5\%$ seepage loss).
  - Tail Outlet 8 (2900 m): flow $0.106\text{ m}^3/\text{s}$ ($29.4\%$ seepage loss).
  - Turn duration formula: $T_i = V_i / Q(x_i)$.
  - Conservation invariant: $\text{Supply} = \sum \text{Quotas} + \text{Buffer} + \sum \text{Delivered} + \text{Losses}$.
  - i18n parity: 601 / 601 matching keys.
- **Strictly Forbidden (Zero Tolerance):**
  - NO Gini coefficients (e.g. 0.31, 0.05, 0.00).
  - NO mock percentages ("42%", "90%", ">90%").
  - NO claim that SMS or WhatsApp transport is live.
  - NO claim that trial Twilio telephony is production-funded.
  - NO unverified test counts.

---

## 5. Beat-by-Beat Storyboard (56.0s)

### Scene 1: The Hook — "Hours Are Not Water" (0.0s – 8.0s | Duration: 8.0s)
- **Visual:** High-contrast opening title card over earthen canal profile. Kondaveedu Minor context pill. Central hook appears with deliberate weight.
- **Captions:**
  - **EN:** Everyone got their hours. The tail still lost the crop. Hours are not water.
  - **TE:** అందరికీ గంటలు అందాయి. అయినా చివర రైతు పంట ఎండిపోయింది. గంటలు అంటే నీరు కాదు.
- **Audio:** Ambient bed begins at 0.0s (-18.1 LUFS), soft atmospheric entry.

### Scene 2: The Physics of Canal Seepage (8.0s – 19.0s | Duration: 11.0s)
- **Visual:** Smooth physical canal schematic showing gravity conveyance over 3 km. Water stream tapers visibly from Head (Outlet 1, 300 m: $0.145\text{ m}^3/\text{s}$, $3.5\%$ loss) to Tail (Outlet 8, 2900 m: $0.106\text{ m}^3/\text{s}$, $29.4\%$ loss). Seepage droplets illustrate unlined soil infiltration.
- **Captions:**
  - **EN:** Head Outlet 1: 0.145 m³/s (3.5% loss) · Tail Outlet 8: 0.106 m³/s (29.4% loss). Same hours. Not the same water.
  - **TE:** తల వద్ద 0.145 m³/s (3.5% నష్టం) · తోక వద్ద 0.106 m³/s (29.4% నష్టం). అదే గంటలు. అదే నీరు కాదు.
- **Audio:** Rhythmic soft clicks (`tick.wav`) traversing outlets along the canal line.

### Scene 3: Equal Volume by Real Hydraulics (19.0s – 30.0s | Duration: 11.0s)
- **Visual:** Coordinator console view. Schedule toggles from `equal_hours` to `equal_water`. Roster turn duration bars dynamically recalculate: tail turns lengthen to compensate for local conveyance loss. Formula badge: $T_i = V_i / Q(x_i)$.
- **Captions:**
  - **EN:** Equal Volume Allocation: $T_i = V_i / Q(x_i)$. Turn duration scales with local flow and transit lag.
  - **TE:** సమాన పరిమాణ కేటాయింపు: $T_i = V_i / Q(x_i)$. స్థానిక ప్రవాహం ఆధారంగా సమయం నిర్ణయం.
- **Audio:** `swell.wav` at 19.5s on the mode switch; `chime.wav` at 23.0s as turn durations converge.

### Scene 4: The Governing Architecture (30.0s – 41.0s | Duration: 11.0s)
- **Visual:** Three-tier architecture pipeline with glowing active state pulses:
  1. **AI Proposes:** Evapotranspiration, crop growth stage, and soil moisture demand.
  2. **Deterministic Core Computes:** `@jadal/core` pure hydraulics and turn schedules (Zero I/O, zero network, zero LLM guesswork).
  3. **Coordinator Approves:** Human-in-the-loop governance; no unapproved water release.
- **Captions:**
  - **EN:** LLMs propose · Deterministic core computes · Coordinator approves.
  - **TE:** AI సూచిస్తుంది · లెక్కల కోర్ గణిస్తుంది · కోఆర్డినేటర్ ఆమోదిస్తారు.
- **Audio:** Focused harmonic sweep, confirmation snap on coordinator approval.

### Scene 5: Telugu Voice Outreach & Conservation Ledger (41.0s – 51.0s | Duration: 10.0s)
- **Visual:** Split-screen verification:
  - Left: Telugu Phone interface (`/phone`), interactive dialer, Telugu spoken phrase: «నాకు ఈ వారం అత్యవసరంగా నీరు కావాలి.»
  - Right: Double-entry conservation ledger card, verified status `conservation_ok: true`, $\sum \text{Debits} = \sum \text{Credits}$, 601/601 bilingual parity badge.
- **Captions:**
  - **EN:** Telugu Voice Outreach · 601/601 Bilingual Keys · Double-Entry Water Conservation Ledger.
  - **TE:** తెలుగు వాయిస్ సమాచారం · 601/601 సమాన అనువాదాలు · పక్కా నీటి పరిరక్షణ లెడ్జర్.
- **Audio:** `dtmf_ack.wav` (farmer tone confirmation) at 43.0s, `chime.wav` at 47.0s on ledger audit seal.

### Scene 6: Technical Close & Ground Truth Standard (51.0s – 56.0s | Duration: 5.0s)
- **Visual:** Hero brand card **JADAL (జదల్)** with subtitle *Canal water shared by volume, not by hours.* Badges: *Deterministic Open-Source Core · Conservation Invariant Verified · Zero Water Arithmetic in LLMs*.
- **Captions:**
  - **EN:** Jadal · Real physics. Verifiable core. Fair water for the tail.
  - **TE:** జదల్ · నిజమైన భౌతికశాస్త్రం. నిరూపితమైన కోర్. తోక రైతుకు న్యాయమైన నీరు.
- **Audio:** Warm resolving major harmony fading gently to silence.
