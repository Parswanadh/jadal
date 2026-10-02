# Jadal Launch Video (v3) — Production Plan & Storyboard

## 1. Project Context & Objectives
- **Product:** Jadal — Open-channel hydraulics and equal-volume turn distribution for gravity irrigation canals.
- **Problem Statement:** "Everyone got their hours. The tail still lost the crop. Hours are not water."
- **Solution:** Deterministic open-channel Manning hydraulics ($T_i = V_i / Q(x_i)$), qualitative double-entry conservation ledger ($\sum \text{Debits} = \sum \text{Credits}$), accessible spoken Telugu telephony, and strict human coordinator approval gating.
- **Duration:** 54.0 seconds (1620 frames at 30 fps, 1920 × 1080 landscape).
- **Evidentiary Standard:** Strict ground-truth compliance with `showcase/video/facts.md`. Every number is tagged RAN, READ, or COMPUTED. All invented numbers, unverified Gini figures, mock need-met percentages, and SMS claims are completely purged.
- **Language Note:** Spoken and burned-in Telugu captions are machine-written and unreviewed by a native speaker (`docs/review/telugu-native-review.md`). They are presented honestly as assistive machine translation; native speaker review is flagged as a documented pending item.

---

## 2. Creative Angle & Tone
- **Tone:** `polished` — Serious, elegant, evidence-based civic engineering launch film. No sarcastic or generic SaaS tropes.
- **Core Governance Mandate:** "LLMs propose · Deterministic core computes · Coordinator approves."
- **Visual Design System:**
  - Background: Warm ivory (`#FAF9F5`)
  - Cards: High-contrast white (`#FFFFFF`) with warm stone borders (`#DEDAD0`)
  - Accent / Headings: Deep charcoal ink (`#1F1E1D`), warm earthen clay (`#C96442`), and canal water blue (`#245373`)
  - Typography: Headlines $\ge$ 64 px (`Source Serif 4`), Body $\ge$ 36 px (`IBM Plex Sans`), Captions 38 px / 32 px (`IBM Plex Sans` + `Noto Sans Telugu`), Badges 28 px (`IBM Plex Mono`).

---

## 3. Beat-by-Beat Storyboard

| Scene | Timecode | Duration | Visual Elements | Real Footage / Assets | Audio / SFX | Caption (EN / TE) |
|---|---|---|---|---|---|---|
| **Scene 1: The Hook** | 0.0s – 8.0s | 8.0s | Large title: "Everyone got their hours. The tail still lost the crop." Perspective hero preview with slow push-in. | `home.png` hero interface | `ambient-bed.ogg` (starts at 0.0s) | **EN:** Everyone got their hours. The tail still lost the crop. Hours are not water.<br>**TE:** అందరికీ గంటలు అందాయి. అయినా చివర రైతు పంట ఎండిపోయింది. గంటలు అంటే నీరు కాదు. |
| **Scene 2: Canal Seepage Physics** | 8.0s – 18.0s | 10.0s | Real canal ribbon video (strictly cropped to top card to exclude need-met bars). Outlet 1 (0.145 m³/s, 3.5% loss) vs Outlet 8 (0.106 m³/s, 29.4% loss). | `canal-seepage.webm` (cropped top ribbon) | `tick.wav` at 9.5s, 12.0s, 14.5s | **EN:** Outlet 1 receives 0.145 m³/s (3.5% loss). Outlet 8 receives 0.106 m³/s (29.4% loss).<br>**TE:** తల వద్ద 0.145 m³/s (3.5% నష్టం) · తోక వద్ద 0.106 m³/s (29.4% నష్టం). |
| **Scene 3: Equal Hours vs Equal Volume** | 18.0s – 28.0s | 10.0s | Turn-BAR comparison: Equal Hours (same time) vs Equal Volume (tail turn bar smoothly lengthens to deliver equal water). Governing law: $T_i = V_i / Q(x_i)$. Zero invented hour/volume numbers. | Vector dynamic turn-bars | `swell.wav` at 18.5s, `chime.wav` at 23.5s | **EN:** Equal Volume: Tᵢ = Vᵢ / Q(xᵢ). Tail turn runs longer to deliver equal water.<br>**TE:** సమాన పరిమాణ కేటాయింపు: Tᵢ = Vᵢ / Q(xᵢ). తోక మలుపు ఎక్కువ సమయం నడుస్తుంది. |
| **Scene 4: The Triad & Coordinator Gate** | 28.0s – 38.0s | 10.0s | Real coordinator UI with slow zoom into "Nothing reaches a farmer until you do" and Approve button. Architecture pillars 01/02/03. | `coordinator.png` | `tick.wav` at 30.5s | **EN:** Deterministic core computes hydraulics. Nothing reaches a farmer without approval.<br>**TE:** భౌతిక శాస్త్రాన్ని కోర్ లెక్కిస్తుంది. కోఆర్డినేటర్ ఆమోదం లేకుండా ఏదీ పంపబడదు. |
| **Scene 5: Telugu Voice & Conservation Ledger** | 38.0s – 48.0s | 10.0s | Real phone simulator UI + Qualitative Conservation Ledger ($\sum \text{Debits} = \sum \text{Credits}$, Conservation Verified). Rate limit: 3 calls / 60 s. | `phone.png` | `dtmf_ack.wav` at 41.0s, `chime.wav` at 44.5s | **EN:** Spoken Telugu voice alerts. Double-entry ledger: Debits equal Credits.<br>**TE:** స్పష్టమైన తెలుగు వాయిస్ కాల్స్. డబుల్ ఎంట్రీ లెడ్జర్: పరిరక్షణ నిరూపితం. |
| **Scene 6: Outro & Verification Proof** | 48.0s – 54.0s | 6.0s | Brand lockup JADAL (జదల్) with verification badges: Open-Channel Hydraulics, Deterministic Core, Human Gated. | Brand typographic lockup | Fade out to black at 53.4s | **EN:** Jadal: Real physics. Deterministic core. Fair water for the tail end.<br>**TE:** జదల్: నిజమైన భౌతికశాస్త్రం. నిరూపితమైన కోర్. తోక రైతుకు సమాన న్యాయం. |

---

## 4. Verification Check against Hard Rules
1. **Facts Compliance:**
   - Outlet 1: 0.145 m³/s (3.5% conveyance loss) [`READ` & `COMPUTED`]
   - Outlet 8: 0.106 m³/s (29.4% conveyance loss) [`READ` & `COMPUTED`]
   - Zero invented ledger numbers (124,500 / 36,500 / 19,000 completely removed).
   - Zero mock need-met percentages ("42%", "90%") and zero mock Gini metrics ("0.31 -> 0.05").
   - Turn bars labeled only as "same time" vs "tail turn runs longer" without invented hours or cubic meters.
2. **Real Footage Verification:**
   - `canal-seepage.webm` cropped strictly to the top ribbon card; per-farmer need-met bars are completely hidden.
   - `coordinator.png` features genuine "Nothing reaches a farmer until you do" gate.
   - `phone.png` showcases authentic Telugu phone simulator.
3. **Typography & Readability:**
   - Headlines: 64 px to 110 px.
   - Body & Subtitles: 36 px to 46 px.
   - Captions: 38 px (EN) / 32 px (TE).
   - Badges & Footers: 28 px.
   - Max 12 words per caption line.
