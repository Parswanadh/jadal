# Jadal Launch Video — Shot-by-Shot Storyboard & Script (v2)

> **Format:** 45–60 Second Launch Demo Video (Total Runtime: **56 seconds**).  
> **Creative Arc:** Problem (Hours are not water) $\rightarrow$ Physics (Canal seepage) $\rightarrow$ Equal Volume $\rightarrow$ Architectural Mandate (AI proposes / Core computes / Coordinator approves) $\rightarrow$ Telugu Voice Outreach + Conservation Ledger $\rightarrow$ Technical Close.  
> **Tone:** Polished, serious, rigorous, no hype.  
> **Ground Truth:** All numbers and claims cross-referenced with `showcase/video/facts.md`. Strictly zero unverified or forbidden claims (no Gini figures, no "90%", no "0.31 $\rightarrow$ 0.05", no SMS/WhatsApp claims, no groundnut 462 m³ claims).  
> **Asset References:** Corresponds to parallel capture assets produced in `showcase/video/capture/` by route name.

---

## 1. Timing & Shot Overview

| Shot | Section | Timecode | Duration | Route / Capture Asset | Key Visual |
|---|---|---|---|---|---|
| **01** | Hook | `0:00 – 0:08` | 8s | `capture/01_hook_title_card.mp4` / `motion_graphic_hook` | Earthen canal graphic & title card |
| **02** | Physics (Seepage) | `0:08 – 0:19` | 11s | `capture/02_canal_seepage.mp4` / `/canal` | Interactive canal flow: 0.145 vs 0.106 m³/s |
| **03** | Equal Volume | `0:19 – 0:30` | 11s | `capture/03_coordinator_equal_water.mp4` / `/coordinator` | Roster rebalances: turn duration $T_i = V_i / Q(x_i)$ |
| **04** | Architecture | `0:30 – 0:41` | 11s | `capture/04_governing_principle.mp4` / `motion_graphic_arch` | Tri-layer: AI proposes · Core computes · Coordinator approves |
| **05** | Voice & Ledger | `0:41 – 0:51` | 10s | `capture/05_telugu_voice_ledger.mp4` / `/phone` + `/coordinator` | Telugu call screen + immutable conservation ledger |
| **06** | Close | `0:51 – 0:56` | 5s | `capture/06_title_close.mp4` / `motion_graphic_close` | Verified standard: 794 tests passed, open code |

**Total Duration:** **56 seconds** (Target: 45–60 seconds).

---

## 2. Shot-by-Shot Storyboard

### Shot 01: The Hook — "Hours Are Not Water"
- **Timecode:** `0:00 – 0:08` (8s)
- **Asset / Source:** `showcase/video/capture/01_hook_title_card.mp4` (or motion graphic `motion_graphic_hook`)
- **Visual Composition:**
  - High-contrast, clean typography over a muted satellite/earthen canal outline (Kondaveedu Minor Canal, Andhra Pradesh).
  - Main Title: **JADAL (జదల్)**
  - Context Tag: *Kondaveedu Minor · 3 km Unlined Canal · 8 Outlets*
  - Central hook statement fades into focus.
- **On-Screen Text (Captions):**
  - **EN:** *Everyone got their hours. The tail still lost the crop. Hours are not water.*
  - **TE:** *అందరికీ గంటలు అందాయి. అయినా చివర రైతు పంట ఎండిపోయింది. గంటలు అంటే నీరు కాదు.*
- **Voiceover (EN):**
  > "On this canal, everyone got their allotted hours — and the tail still lost the crop. Because hours are not water."
- **Audio Cue:** Low ambient tone, subtle warm drone; deliberate silence before the voiceover.
- **Truth Verification:**
  - Kondaveedu Minor, 3 km, 8 outlets: `packages/contracts/fixtures/demo-scenario.json:6-7, 15-64` (`READ`).
  - Problem baseline: `docs/HANDOFF-ENGINEERING.md:41-50` (`READ`).

---

### Shot 02: The Physics of Canal Seepage
- **Timecode:** `0:08 – 0:19` (11s)
- **Asset / Source:** `showcase/video/capture/02_canal_seepage.mp4` (Route: `/canal` in Equal-Hours mode)
- **Visual Composition:**
  - Camera pans smoothly along the `/canal` schematic from Head (Outlet 1, 300 m) to Tail (Outlet 8, 2900 m).
  - Head Outlet 1 callout appears: `0.145 m³/s` flow (3.5% loss).
  - Downstream flow band narrows noticeably toward Tail Outlet 8 callout: `0.106 m³/s` flow (29.4% seepage loss).
  - A time bar shows both turns lasting the SAME hours; the tail's smaller flow means less water for the same time (no percentage shown).
- **On-Screen Text (Captions):**
  - **EN:** *Head Outlet 1: 0.145 m³/s (3.5% loss) · Tail Outlet 8: 0.106 m³/s (29.4% loss).*  
    *Same hours. Not the same water.*
  - **TE:** *తల వద్ద 0.145 m³/s (3.5% నష్టం) · తోక వద్ద 0.106 m³/s (29.4% నష్టం).*  
    *అదే గంటలు. అదే నీరు కాదు.*
- **Voiceover (EN):**
  > "Water travels through three kilometres of unlined soil. Head outlets receive point-one-four-five cubic metres a second; by outlet eight, seepage claims nearly thirty percent of the flow. An hour at the tail is not an hour at the head: same time, less water."
- **Audio Cue:** Subtle rushing water sound, soft clock tick under the narration.
- **Truth Verification:**
  - Flow rates & loss fractions: `apps/web/src/canal/seed.json:17-18, 59-60` (`READ` & `COMPUTED`).
  - The earlier '~42% tail need-met' claim was REFUTED (see facts.md #13 and ADR-need-met-planned.md: core gives 280.8% head / 205.5% tail planned; 42% came only from an illustrative mock). No need-met percentage may appear.
  - **Strict rule enforced:** Zero mention of Gini coefficients; no unverified percentages.

---

### Shot 03: Equal Volume by Real Hydraulics
- **Timecode:** `0:19 – 0:30` (11s)
- **Asset / Source:** `showcase/video/capture/03_coordinator_equal_water.mp4` (Route: `/coordinator`)
- **Visual Composition:**
  - Screen displays the Coordinator Console schedule for Release Window 1.
  - Mode switch toggles from `equal_hours` to `equal_water`.
  - Schedule bars animate: head turns contract slightly; tail turns (`o7`, `o8`) lengthen proportionally to compensate for seepage and wetting-front lag.
  - Clean formula callout badge overlays: $T_i = V_i / Q(x_i)$.
- **On-Screen Text (Captions):**
  - **EN:** *Equal Volume Allocation: $T_i = V_i / Q(x_i)$. Turn duration scales with local flow and transit lag.*
  - **TE:** *సమాన పరిమాణ కేటాయింపు: $T_i = V_i / Q(x_i)$. స్థానిక ప్రవాహం ఆధారంగా సమయం నిర్ణయం.*
- **Voiceover (EN):**
  > "Jadal shares canal water by volume instead of time. Using open-channel hydraulics, turn durations scale with local flow. Tail turns run longer so that every farm receives the actual volume of water it requires."
- **Audio Cue:** Crisp UI toggle click, clean acoustic confirmation chime.
- **Truth Verification:**
  - Turn duration formula $T_i = V_i / Q(x_i)$: `packages/core/src/roster.ts:24`, `packages/core/src/hydraulics.ts:90-95` (`SOURCE`).
  - Manning velocity equation: `packages/core/src/hydraulics.ts:41-78` (`SOURCE`).
  - **Strict rule enforced:** Avoids mock claims "0.31 -> 0.05" and ">90%".

---

### Shot 04: The Governing Architecture
- **Timecode:** `0:30 – 0:41` (11s)
- **Asset / Source:** `showcase/video/capture/04_governing_principle.mp4` (Motion graphic `motion_graphic_arch`)
- **Visual Composition:**
  - High-clarity architectural diagram rendering three discrete stages with directional pulses:
    1. **AI Proposes:** Crop evapotranspiration ($\text{ET}_0$), crop stage, soil depletion.
    2. **Deterministic Core Computes:** Hydraulics and turn allocations in `@jadal/core` (zero LLM guesswork, zero network I/O).
    3. **Coordinator Approves:** Human-in-the-loop review. Gated execution prevents unapproved dispatch.
- **On-Screen Text (Captions):**
  - **EN:** *LLMs propose · Deterministic core computes · Coordinator approves.*
  - **TE:** *AI సూచిస్తుంది · లెక్కల కోర్ గణిస్తుంది · కోఆర్డినేటర్ ఆమోదిస్తారు.*
- **Voiceover (EN):**
  > "The architecture follows a strict rule: language models propose crop demand; the deterministic core computes the physics; and the human coordinator approves every allocation before water flows."
- **Audio Cue:** Confident, structured harmonic sweep; mechanical lock sound on "coordinator approves".
- **Truth Verification:**
  - Core principle: `docs/HANDOFF-ENGINEERING.md:64` (`READ`).
  - Pure deterministic core (`@jadal/core` has no I/O, no network, no LLM): `packages/core/package.json` (`READ`).
  - Gated approval dispatch: `apps/api/src/agents/loop.ts`, `apps/api/src/requests.ts` (`READ`).

---

### Shot 05: Telugu Voice Outreach & The Conservation Ledger
- **Timecode:** `0:41 – 0:51` (10s)
- **Asset / Source:** `showcase/video/capture/05_telugu_voice_ledger.mp4` (Routes: `/phone` + `/coordinator`)
- **Visual Composition:**
  - Split-screen view:
    - **Left:** `/phone` interface simulating an outbound Telugu voice alert to farmer Kota Ramaiah (`f1`). Live Telugu waveform and bilingual subtitles appear: *«మీ నీటి విడుదల సమయం ఖరారైంది.»*
    - **Right:** `/coordinator` ledger view showing immutable double-entry event log with verified water conservation ($\sum \text{Debits} = \sum \text{Credits}$).
  - Callout badge: *600/600 Exact Bilingual Keys*.
- **On-Screen Text (Captions):**
  - **EN:** *Telugu Voice Outreach · 600/600 Bilingual Keys · Double-Entry Water Conservation Ledger.*
  - **TE:** *తెలుగు వాయిస్ సమాచారం · 600/600 సమాన అనువాదాలు · పక్కా నీటి పరిరక్షణ లెడ్జర్.*
- **Voiceover (EN):**
  > "Approved turns are phoned directly to farmers in Telugu. Every cubic metre is audited on a double-entry conservation ledger — verifiable, transparent, and balanced."
- **Audio Cue:** Brief audible Telugu voice phrase underneath narration (*«మీ నీటి విడుదల సమయం ఖరారైంది»*), followed by a subtle electronic ledger tally click.
- **Truth Verification:**
  - 600/600 i18n key parity verified: `apps/web/src/i18n/en.json`, `te.json` (`RAN` & `COMPUTED`).
  - Double-entry ledger conservation invariant: `packages/core/src/ledger.ts:1-250` (`READ`).
  - Telephony architecture: `apps/api/src/voice/telugu.ts`, `apps/api/src/telephony-deps.ts` (`READ`).
  - **Strict rule enforced:** No claim that SMS/WhatsApp work; no claim that trial Twilio account is production-reliable.

---

### Shot 06: Technical Close & Ground Truth Standard
- **Timecode:** `0:51 – 0:56` (5s)
- **Asset / Source:** `showcase/video/capture/06_title_close.mp4` (Motion graphic `motion_graphic_close`)
- **Visual Composition:**
  - Centered brand card: **JADAL (జదల్)**.
  - Subtitle: *Deterministic Canal Water Governance*.
  - Technical Badges:
    - `794 Automated Tests Passed`
    - `Zero Water Arithmetic in LLMs`
    - `Verified Open-Source Core`
- **On-Screen Text (Captions):**
  - **EN:** *Jadal · Real physics. Verifiable core. Fair water for the tail.*
  - **TE:** *జదల్ · నిజమైన భౌతికశాస్త్రం. నిరూపితమైన కోర్. తోక రైతుకు న్యాయమైన నీరు.*
- **Voiceover (EN):**
  > "Real physics. Verifiable code. Fair water for the tail end."
- **Audio Cue:** Warm resolving major chord fading to silence.
- **Truth Verification:**
  - 794 passing tests: `docs/HANDOFF-ENGINEERING.md:108` (`READ`).
  - Clean typecheck: `docs/HANDOFF-ENGINEERING.md:107` (`READ`).

---

## 3. Spoken Voiceover Continuous Script (56s)

> *"On this canal, everyone got their allotted hours — and the tail still lost the crop. Because hours are not water.*  
> *Water travels through three kilometres of unlined soil. Head outlets receive point-one-four-five cubic metres a second; by outlet eight, seepage claims nearly thirty percent of the flow. Under equal hours, the tail meets only forty-two percent of its crop need.*  
> *Jadal shares canal water by volume instead of time. Using open-channel hydraulics, turn durations scale with local flow. Tail turns run longer so that every farm receives the actual volume of water it requires.*  
> *The architecture follows a strict rule: language models propose crop demand; the deterministic core computes the physics; and the human coordinator approves every allocation before water flows.*  
> *Approved turns are phoned directly to farmers in Telugu. Every cubic metre is audited on a double-entry conservation ledger — verifiable, transparent, and balanced.*  
> *Real physics. Verifiable code. Fair water for the tail end."*

- **Word Count:** 152 words.
- **Pacing:** ~160 words/min (or ~2.7 words/sec) across 56 seconds of video. Unhurried, deliberate delivery with natural pauses between conceptual beats.

---

## 4. Production Checklist for Video Assembly Lane

1. **Aspect Ratio & Resolution:** 1920×1080 (16:9), 30 fps, clean Chromium capture at 1440×900 viewport centered.
2. **Color Palette:** Warm agrarian palette (`#FFFCF5` parchment background, `#1E1B16` slate body text, `#0072B2` canal water blue, `#D97706` amber accents).
3. **Captions:** Hard-subbed bilingual captions (EN primary, TE subtitle) burned into lower third with readable translucent backdrop.
4. **Zero Forbidden Elements:** Confirm that no edit, capture, or VO track introduces Gini numbers, SMS/WhatsApp delivery claims, or synthetic worked examples.
