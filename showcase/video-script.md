# Jadal — 3-Minute Video Showcase Script

> Companion to `showcase/backup-video-shot-list.md` and `apps/web/src/demo/demoScript.ts`.  
> Total duration: **180 seconds (03:00)** hard cap.  
> Seed scenario: Kondaveedu Minor (`packages/contracts/fixtures/demo-scenario.json`).  
> Visual standard: 1440×900 desktop viewport, `prefers-reduced-motion: reduce`, clean UI capture.  
> Evidence rule: All numbers cited directly from repo contracts, seed fixtures, and `@jadal/core`. Modelled/mock values marked as `[ASSUMED]`.

---

## Shot Overview & Timing Sheet

| Shot | Route / Context | Timecode | Duration | Key Focus / Step |
|---|---|---|---|---|
| **01** | Title Card | 0:00 – 0:08 | 8s | Hook: "Hours are not water" |
| **02** | `/canal` (Equal-Hours Mode) | 0:08 – 0:28 | 20s | Warabandi failure: Seepage & tail deficit |
| **03** | `/coordinator` (Roster Comparison) | 0:28 – 0:53 | 25s | Demo Step 1: Equal-water jump (>90% tail need met) |
| **04** | `/farmer` (Registration & Entitlement) | 0:53 – 1:08 | 15s | FAO-56 crop physics converted to volume |
| **05** | `/phone` (Simulated Telugu Call) | 1:08 – 1:33 | 25s | Demo Step 2: Telugu voice urgent request & triage |
| **06** | `/coordinator` (Approval & Deduction) | 1:33 – 1:48 | 15s | Quota deduction: no more free overruns |
| **07** | `/coordinator` + `/phone` (Notifications) | 1:48 – 2:08 | 20s | Demo Steps 3 & 4: Voice-first calls, night warning, DTMF ack |
| **08** | `/demo` (Harvest & Buffer Pool) | 2:08 – 2:23 | 15s | Demo Step 5: Post-harvest remainder pooled to buffer |
| **09** | `/demo` (Ledger & Audit Proof) | 2:23 – 2:48 | 25s | Demo Step 6: Conservation invariant & bilingual audit |
| **10** | End Card | 2:48 – 3:00 | 12s | Architecture principle & closing call |

---

## Detailed Shot-by-Shot Script

### Shot 01: Title Card
- **Timecode:** `0:00 – 0:08` (Duration: 8s)
- **Visual:** Minimalist amber-tinted title card (`#FFFCF5` background, `#1E1B16` typography, `#E8A100` sun emblem).
  - Title: **JADAL (జదల్)**
  - Subtitle: *Whose Turn Is It to Irrigate? · కాలువ నీటి పంపిణీ వ్యవస్థ*
  - Context Pill: *Kondaveedu Minor Canal · 3 km · 8 Outlets*
- **Voiceover (EN):**
  > "On this canal, every farmer received their allotted hours — and the tail-end farmer still lost her crop. Because hours are not water."
- **On-Screen Captions:**
  - **EN:** *Everyone received their hours. The tail-end still lost her crop. Hours are not water.*
  - **TE:** *అందరికీ కేటాయించిన గంటలు వచ్చాయి. అయినా చివర ఉన్న రైతు పంట ఎండిపోయింది. గంటలు అంటే నీరు కాదు.*
- **Audio Cue:** Low ambient tone, subtle warm chord entry.
- **Evidence / Source:**
  - Kondaveedu Minor, 3 km, 8 outlets: `demo-scenario.json#/canal`, `HANDOFF.md §2`.
  - Case problem statement: `docs/problem-statement.md §1`.

---

### Shot 02: Canal Hero View — The Warabandi Deficit
- **Route:** `/canal` (Equal-Hours Mode)
- **Timecode:** `0:08 – 0:28` (Duration: 20s)
- **Visual Action:**
  - Display the interactive schematic of Kondaveedu Minor from Head (Outlet 1, 300 m) to Tail (Outlet 8, 2900 m).
  - Mode toggle is set to **Equal Hours**.
  - Camera/cursor slowly pans downstream along the canal.
  - Callout highlights: Head outlet `o1` delivers `0.145 m³/s` (3.5% loss); Tail outlet `o8` thins down to `0.106 m³/s` (29.4% seepage loss).
  - Bar chart zooms on `o7` and `o8` showing need met stagnating at only **40%–42%**, despite having an equal 1-hour turn.
- **Voiceover (EN):**
  > "Under traditional warabandi, turns are measured in hours. But as water travels through three kilometres of unlined soil, seepage and evaporation eat the flow. Outlet one gets strong flow, while outlet eight receives twenty-nine percent less water per second. The old paper register records both as fair."
- **On-Screen Captions:**
  - **EN:** *Outlet 8 loses 29.4% of flow to seepage over 3 km. Equal hours meet only 42% of tail crop need.*
  - **TE:** *3 కి.మీ ప్రయాణంలో ఔట్‌లెట్ 8 వద్ద 29.4% నీరు ఇంకిపోతుంది. సమాన గంటల్లో తోక రైతుకు 42% నీరే అందుతుంది.*
- **Audio Cue:** Soft flowing water SFX, subtle mechanical clock ticking.
- **Evidence / Source:**
  - Head discharge `0.15 m³/s`, seepage $k = 0.00012\text{ m}^{-1}$: `demo-scenario.json#/canal`.
  - `o1` flow `0.1447 m³/s` (3.5% loss), `o8` flow `0.1059 m³/s` (29.4% loss): `apps/web/src/canal/seed.json` (derived by `@jadal/core/hydraulics`).
  - Tail need-met 40%–42%: `apps/web/src/api/mock.ts#L190`, `HANDOFF.md §2`.

---

### Shot 03: Coordinator Console — Equal Water Roster
- **Route:** `/coordinator` (Roster Tab)
- **Timecode:** `0:28 – 0:53` (Duration: 25s) — **Demo Step 1**
- **Visual Action:**
  - Open Coordinator Console on Release Window 1 (`rw1`: 24-hour delivery, `0.15 m³/s`).
  - Click comparison toggle: `equal_hours` $\rightarrow$ `equal_water`.
  - Animation activates: Turn duration bars adjust dynamically. Head turns shorten slightly; tail turns (`o7`, `o8`) lengthen to compensate for travel lag and local seepage.
  - Need-met meters for `o7` and `o8` surge from **42% to over 90%** (100% in re-priced schedule).
  - Fairness card updates: Gini coefficient drops from **0.31 (severe inequality)** to **0.05 (near-perfect equality)**.
  - Coordinator clicks the amber **"Approve Roster"** button.
- **Voiceover (EN):**
  > "Jadal shares canal water by volume, not by time. The deterministic core calculates the exact transit velocity and seepage rate for every outlet. When the coordinator switches to equal-water, tail turns run longer to deliver the true volume required. Need met at the tail jumps from forty-two percent to over ninety percent, and the Gini inequality coefficient collapses from zero-point-three-one to zero-point-zero-five."
- **On-Screen Captions:**
  - **EN:** *Step 1: Equal water allocates time by local flow. Tail need-met jumps from 42% to >90%; Gini drops 0.31 → 0.05.*
  - **TE:** *దశ 1: సమాన నీరు స్థానిక ప్రవాహాన్ని బట్టి సమయం ఇస్తుంది. తోక రైతులకు అవసరం 42% నుండి >90%కి పెరుగుతుంది (గిని: 0.31 → 0.05).*
- **Audio Cue:** Crisp UI toggle click, ascending harmonic chime as metrics turn green.
- **Evidence / Source:**
  - Gini coefficients `0.31` vs `0.05` are **modelled** values from `apps/web/src/api/mock.ts#L195`. `apps/api/src/e2e.test.ts#L121-130` verifies only the *ordering* (`equal_water_gini < equal_hours_gini`) against the real core — it does not assert these exact numbers.
  - `rw1` window specifications: `demo-scenario.json#/release_windows[0]`.
  - Roster engine formula $T_i = V_i / Q(x_i)$: `packages/core/README.md §8`.

---

### Shot 04: Farmer Portal — Needs Built from Crop Physics
- **Route:** `/farmer` (My Water & Registration)
- **Timecode:** `0:53 – 1:08` (Duration: 15s)
- **Visual Action:**
  - Screen displays Farmer Portal for farmer `f1` (Ramaiah Kota).
  - Card details: 2.0 hectares of lowland paddy rice in flowering stage, Vertisol clay-loam soil.
  - Callout on the calculation badge: **FAO-56 Dual Crop Model** integrates daily reference evapotranspiration ($\text{ET}_0$), crop stage coefficient ($K_c = 1.20$), and soil water depletion.
  - Weekly approved volume displays clearly: `1,300 m³` (with explainer: `1 m³ = 1,000 litres`).
- **Voiceover (EN):**
  > "Entitlements are not arbitrary. At season start, farmers register crop type, planting date, and soil. Jadal's core engine uses the standard FAO-56 model and local weather data to compute actual evapotranspiration and percolation. The coordinator reviews and locks the weekly entitlement."
- **On-Screen Captions:**
  - **EN:** *FAO-56 agronomic model calculates field-gate volume from crop stage, soil percolation, and weather.*
  - **TE:** *FAO-56 శాస్త్రీయ పద్ధతి: పంట దశ, నేల రకం, వాతావరణం ఆధారంగా నీటి పరిమాణం నిర్ధారణ.*
- **Audio Cue:** Soft page slide transition.
- **Evidence / Source:**
  - Farmer `f1` Ramaiah Kota, 2.0 ha rice clay loam: `demo-scenario.json#/plots[0]`, `demo-scenario.json#/crop_plans[0]`.
  - Weekly approved entitlement `1,300 m³`: `apps/api/src/e2e.test.ts#L49`.
  - FAO-56 crop engine and percolation: `packages/core/README.md §1-§6`.

---

### Shot 05: Simulated Phone — Urgent Request in Telugu
- **Route:** `/phone` (Voice Call Simulation)
- **Timecode:** `1:08 – 1:33` (Duration: 25s) — **Demo Step 2**
- **Visual Action:**
  - Mobile frame displays the incoming simulated call interface with real-time waveform animation.
  - Spoken audio plays aloud in natural Telugu.
  - Live Telugu transcription appears in real-time on screen, paired with instant English translation.
  - System 1 (fast classifier) badges: Intent: `urgent_request`, Urgency Score: `0.85` `[ASSUMED / modelled]`.
  - System 2 (Reasoning Agent) recommendation card generates: *"Rice crop at flowering is highly vulnerable to moisture stress. Recommend granting 40 m³, deducted from future quota."*
- **Telugu Spoken Audio (Play audio or voice talent):**
  > «నాకు ఈ వారం అత్యవసరంగా నీరు కావాలి. వరి పొలం ఎండిపోతోంది.»
- **Voiceover (EN):**
  > "When drought threatens a sensitive flowering stage, the farmer doesn't fight at the gate. Ramaiah calls the automated voice line in Telugu. Sarvam speech-to-text transcribes his request, our fast model scores the urgency, and a reasoning agent proposes a forty cubic metre grant deducted from future quota."
- **On-Screen Captions:**
  - **TE Spoken:** «నాకు ఈ వారం అత్యవసరంగా నీరు కావాలి.»
  - **EN Translation:** *"I urgently need water this week. The paddy is drying out."*
  - **Agent Callout:** *Urgency: 0.85 · Recommends 40 m³ partial grant from seasonal quota.*
- **Audio Cue:** Phone ringing tone, authentic Telugu speech audio, subtle processing pulse.
- **Evidence / Source:**
  - Real Telugu speech pipeline: Sarvam `bulbul:v3` / Deepgram `nova-3`: `HANDOFF.md §1`, `docs/decisions/ADR-005-telephony.md`.
  - Spoken phrase: `showcase/pitch-outline.md#L69`, `apps/api/src/e2e.test.ts#L53`.
  - Urgency volume 40 m³: `apps/api/src/e2e.test.ts#L55`.

---

### Shot 06: Coordinator Approval & Ledger Quota Deduction
- **Route:** `/coordinator` (Requests Tab)
- **Timecode:** `1:33 – 1:48` (Duration: 15s) — **Demo Step 2 (Outcome)**
- **Visual Action:**
  - Coordinator view shows Ramaiah's pending request flagged with high urgency.
  - Coordinator reviews agent recommendation and clicks **"Approve (40 m³)"**.
  - Split view animates the volume ledger:
    - `farmer:f1:quota` decreases by `40 m³` (`12,000 → 11,960 m³` seasonal balance).
    - `farmer:f1:delivered` increases by `40 m³`.
  - Banner notification: *"Overruns stop being free. Water is borrowed, never stolen."*
- **Voiceover (EN):**
  > "The coordinator approves with one click. Immediately, the double-entry ledger records the transfer: forty cubic metres are granted today and deducted from Ramaiah's seasonal quota. Upstream overruns stop being free."
- **On-Screen Captions:**
  - **EN:** *Step 2: Coordinator approves 40 m³. Future quota drops 40 m³; ledger records double entry.*
  - **TE:** *దశ 2: సమన్వయకర్త 40 క్యూబిక్ మీటర్లు ఆమోదించారు. భవిష్యత్ కోటా నుండి 40 మీ³ తగ్గింపు.*
- **Audio Cue:** Definite ledger confirmation stamp sound effect.
- **Evidence / Source:**
  - Ledger movement: `future quota → this week's turn`: `docs/architecture/overview.md §3`.
  - Exact assertion `quota_m3 - 40` and `delivered_m3 + 40`: `apps/api/src/e2e.test.ts#L169-170`.

---

### Shot 07: Notifications, Night Protocol & Acknowledgement
- **Route:** `/coordinator` (Contacts Queue) $\rightarrow$ `/phone`
- **Timecode:** `1:48 – 2:08` (Duration: 20s) — **Demo Steps 3 & 4**
- **Visual Action:**
  - Roster re-plans automatically. Outbound contacts queue fans out across eight farmers:
    - Farmers `f5` (Anjamma) and `f8` (Narasimha) are badged **Voice-Only (No Smartphone)**.
    - Other six farmers receive Voice + WhatsApp.
  - Release Window 2 (`rw2`) night banner flashes: *Start time 19:00 IST $\rightarrow$ Night Release Protocol active*.
  - Warning call scheduled automatically 1 hour prior (18:00 IST).
  - Cut to `/phone`: Inbound automated voice call states the new turn time.
  - User presses DTMF key `1` or speaks «సరే» ("Understood").
  - Status updates in real-time to **Acknowledged**.
- **Voiceover (EN):**
  > "A schedule change is valid only after acknowledgement. Farmers without smartphones receive automated voice phone calls, not WhatsApp messages they cannot read. When release window two begins after dark at seven PM, the night protocol automatically fires a warning call one hour before water reaches the field gate."
- **On-Screen Captions:**
  - **EN:** *Steps 3 & 4: Voice-only calls for farmers without smartphones. Night release fires warning call 1 hr before.*
  - **TE:** *దశలు 3 & 4: స్మార్ట్‌ఫోన్ లేని రైతులకు వాయిస్ కాల్స్. రాత్రి విడుదలకు గంట ముందే హెచ్చరిక కాల్.*
- **Audio Cue:** Telephone keypad DTMF beep (`1`), voice prompt confirmation.
- **Evidence / Source:**
  - Farmers `f5` and `f8` `has_smartphone: false`, voice-only: `demo-scenario.json#/farmers[4,7]`.
  - Night release protocol (18:00–06:00 window, warning 1 hr prior): `docs/architecture/overview.md §6`, `apps/web/src/demo/demoScript.ts#L104-107`.
  - Ack text «సరే»: `apps/api/src/e2e.test.ts#L57`.

---

### Shot 08: Public Buffer Board & Harvest Sharing
- **Route:** `/demo` (Step 5: Buffer Panel)
- **Timecode:** `2:08 – 2:23` (Duration: 15s) — **Demo Step 5**
- **Visual Action:**
  - Step 5 active: Farmer `f3` (Venkata Rao) completes cotton harvesting early and declares `harvest_exit`.
  - Unused seasonal quota transfers into the public canal buffer pool.
  - Downstream tail farmer `f7` (Padmavathi) submits a request for `5 m³` buffer water on the portal.
  - Public buffer transparency board updates openly for all water-user association members to inspect.
- **Voiceover (EN):**
  > "When Venkata Rao harvests his cotton early, his remaining quota doesn't vanish into private hands. It pools into a public buffer. When a downstream farmer needs extra water, she requests it on an open board. Shared openly, approved openly."
- **On-Screen Captions:**
  - **EN:** *Step 5: Early harvest quota transfers to common buffer. Buffer requests are public and transparent.*
  - **TE:** *దశ 5: కోత పూర్తయిన మిగులు కోటా బఫర్‌కు చేరుతుంది. బఫర్ నీటి అభ్యర్థనలు అందరికీ బహిరంగంగా కనిపిస్తాయి.*
- **Audio Cue:** Gentle chime, ledger counter tick.
- **Evidence / Source:**
  - Farmer `f3` cotton harvest exit, `f7` buffer request: `demo-scenario.json#/demo_script[4]`, `apps/api/src/e2e.test.ts#L224-258`.
  - Buffer policy rule (capped at 25% weekly, transparent board): `packages/core/README.md §10`.

---

### Shot 09: Double-Entry Ledger & Bilingual Audit Invariant
- **Route:** `/demo` (Step 6: Ledger Audit Panel)
- **Timecode:** `2:23 – 2:48` (Duration: 25s) — **Demo Step 6**
- **Visual Action:**
  - Display the comprehensive Ledger Audit verification card.
  - Equation highlighted in bold monospace gold:  
    $$\text{Supply } (180,000\text{ m}^3) = \sum \text{Quotas} + \text{Buffer} + \sum \text{Delivered} + \text{Losses}$$
  - Green audit badge: **`conservation_ok: true`** (verified across all 6 demo steps).
  - Bilingual summary card rendered:
    - **English:** *"Conservation OK: All accounts balance with zero leakage across 8 outlets."*
    - **Telugu:** *«లెక్కలు సరిపోయాయి: పరిరక్షణ నియమం ఖరారైంది; చివరి రైతులకు సమాన నీరు అందింది.»*
- **Voiceover (EN):**
  > "At all times, across every transaction, the double-entry ledger enforces absolute physical conservation: canal supply equals quotas plus buffer plus delivered water plus conveyance losses. Disputes are settled by audited data, not political influence or force."
- **On-Screen Captions:**
  - **EN:** *Step 6: Conservation holds: Supply = Quotas + Buffer + Delivered + Losses. Invariant verified by Auditor Agent.*
  - **TE:** *దశ 6: పరిరక్షణ నియమం స్థిరం: మొత్తం సరఫరా = కోటాలు + బఫర్ + పంపిణీ + నష్టాలు. ఆడిట్ పూర్తి.*
- **Audio Cue:** Affirmative double-entry balance sound, musical progression resolving to tonic.
- **Evidence / Source:**
  - Conservation invariant equation: `packages/core/README.md §9`, `docs/architecture/overview.md §3`.
  - Season supply `180,000 m³`: `demo-scenario.json#/season_supply_m3`.
  - `conservation_ok: true` test verification: `apps/api/src/e2e.test.ts#L262-269`.

---

### Shot 10: Closing Card & Call to Action
- **Timecode:** `2:48 – 3:00` (Duration: 12s)
- **Visual Action:**
  - Clean closing graphic featuring the core architecture trifecta:
    - **LLMs propose · Core computes · Coordinator approves**
    - *ఎల్ఎల్ఎమ్ ప్రతిపాదన · భౌతిక లెక్కింపు · సమన్వయకర్త ఆమోదం*
  - Repository & Demo links: `github.com/Parswanadh/jadal` · `demo.jadal.example.com` `[ASSUMED / placeholder URL]`.
  - IEEE-CIS Hackathon badge.
- **Voiceover (EN):**
  > "Jadal proves that AI in public infrastructure works best when boundaries are clear: LLMs propose, deterministic physics compute, and human coordinators approve. Fair water, verified by code. Thank you."
- **On-Screen Captions:**
  - **EN:** *LLMs propose · Core computes · Coordinator approves. Fair canal water for every farmer.*
  - **TE:** *ఎల్ఎల్ఎమ్ ప్రతిపాదన · భౌతిక లెక్కింపు · సమన్వయకర్త ఆమోదం. రైతులకు న్యాయమైన నీరు.*
- **Audio Cue:** Warm closing swell, gentle fade out.
- **Evidence / Source:**
  - Architecture principle: `docs/architecture/overview.md §1`, `docs/presentation/jadal-deck.html#L364`.

---

## Continuous Voiceover Script (~295 words, calibrated for 180 seconds)

> [0:00] On this canal, every farmer received their allotted hours — and the tail-end farmer still lost her crop. Because hours are not water.  
> [0:08] Under traditional warabandi, turns are measured in hours. But as water travels through three kilometres of unlined soil, seepage eats the flow. Outlet one receives strong flow, while outlet eight gets nearly thirty percent less water per second. The old paper register calls both fair.  
> [0:28] Jadal shares canal water by volume, not by time. When the coordinator switches to equal-water, tail turns run longer to deliver the true volume required. Need met at the tail jumps from forty-two percent to over ninety percent, and the Gini inequality coefficient collapses from zero-point-three-one to zero-point-zero-five.  
> [0:53] Entitlements start with crop physics. Jadal's core engine uses the standard FAO-56 model and local weather to compute true crop evapotranspiration, which the coordinator reviews and approves.  
> [1:08] When drought threatens, a farmer calls in Telugu: «నాకు ఈ వారం అత్యవసరంగా నీరు కావాలి.» The agent triages urgency and recommends a forty cubic metre grant.  
> [1:33] The coordinator approves, and forty cubic metres are deducted from future seasonal quota. Upstream overruns stop being free.  
> [1:48] Every affected farmer is notified. Farmers without smartphones receive automated voice phone calls, with a mandatory warning call before any night release.  
> [2:08] When crops are harvested early, leftover quota pools into a public buffer shared transparently on the portal.  
> [2:23] And the double-entry ledger always balances: canal supply equals quotas plus buffer plus delivered water plus conveyance losses. Disputes are settled by audited evidence.  
> [2:48] LLMs propose, deterministic physics compute, and human coordinators approve. Fair water, verified by code. Thank you.

---

## Technical Screen-Recording & Production Checklist

- [ ] **Reset Fixture State:** Run `curl -X POST http://localhost:5173/api/demo/reset` or click **Reset Demo** in `/demo`.
- [ ] **Viewport Settings:** Chromium browser window sized to exactly `1440×900` at 100% scale (no zoom).
- [ ] **Motion & Cursor:** Set `prefers-reduced-motion: reduce`; hide software cursor or enable smooth click animation.
- [ ] **Audio Capture:** Ensure system audio captures the real Telugu audio snippet during Shot 05 (`.ref/call/note-te.wav` or Sarvam `bulbul:v3`).
- [ ] **Subtitles:** Hard-code / burn in bilingual subtitles (EN lower line, TE upper line) matching exact timecodes above.
- [ ] **Export Specifications:** Video format `1080p` (`1920×1080`), 30 fps, H.264 video codec, AAC stereo audio, target file `showcase/jadal-backup-demo.mp4`.
