# Brag Plan: Jadal

## What is this app?
Jadal is an agentic, physics-based canal-water allocation system for the Kondaveedu Minor canal (3 km, 8 outlets, Andhra Pradesh) that replaces fixed-hour rotations (warabandi) with equal-volume turns derived from FAO-56 crop physics, deterministic hydraulics, and verified double-entry ledgers.

## The angle
"Canal water shared by volume, not by hours."
Traditional warabandi gives each farmer equal time at the canal outlet, but unlined canal seepage and travel lag mean tail-end farmers receive up to 29.4% less water per second. Jadal calculates transit velocity and seepage losses so that tail turns run longer to deliver the true required volume, closing the fairness gap under a strict governance rule: **LLMs propose, the deterministic core computes, the coordinator approves.**

## Hook (first 2-3 seconds)
A quiet, stark truth: "Everyone got their hours. The tail-end still lost her crop. Hours are not water."
Set on Kondaveedu Minor (3 km, 8 outlets), showing outlet 8 receiving 29.4% less flow than outlet 1 and tail farmers meeting only 42% [MODELLED] of crop water need under equal hours.

## Key moments (the middle)
- **The Equal-Water Pivot**: The coordinator toggles `equal_hours` → `equal_water`. Turn times adjust for physical conveyance losses; tail need-met surges from 42% to >90% [MODELLED] while the Gini inequality coefficient collapses from 0.31 to 0.05 [MODELLED].
- **Voice & Ledger Governance**: A farmer calls in Telugu requesting urgent water during rice flowering. The System-1 classifier and System-2 reasoning agent propose a 40 m³ grant deducted from seasonal quota; the coordinator approves with one click, and the double-entry ledger verifies absolute conservation ($180,000\text{ m}^3$ balanced).

## Outro / punchline
"JADAL — Canal water shared by volume, not by hours. LLMs propose · Core computes · Coordinator approves."

## User flow worth showing
1. **The Deficit View**: Visualizing the 3 km canal and 8 outlets where downstream seepage robs tail-end farms under equal-hour rosters.
2. **The Turn Repricing**: Coordinator compares equal-hours vs equal-water; tail turns lengthen to equalize delivered volume.
3. **The Verified Ledger**: Telugu voice request acknowledged, quota deducted, and conservation invariant verified by the ledger audit agent.

## Tone
- **Preset**: `polished`
- **Creative direction**: "A serious, elegant product film for public agricultural infrastructure — quiet confidence and mathematical restraint over tech hype."
- **Interpretation**: Pacing is deliberate with generous reading holds (minimum 1.5s settled per key idea). Visuals use the calm ivory, slate-blue, and clay palette of the production app. Subtle transitions (soft crossfades) with minimal, high-quality audio cues.

## Format: landscape — 1920x1080
## Duration: 20s

## Visual identity (from the project)
- Background: `#faf9f5` (warm ivory, from `apps/web/src/styles.css#L10`)
- Surface: `#ffffff` (`apps/web/src/styles.css#L11`)
- Text: `#1f1e1d` (`apps/web/src/styles.css#L13`)
- Muted Text: `#73716a` (`apps/web/src/styles.css#L14`)
- Accent: `#c96442` (warm clay, `apps/web/src/styles.css#L18`)
- Water Blue: `#4e7a96` (slate-blue canal water, `apps/web/src/styles.css#L23`)
- Success / Green: `#4f7a3a` (`apps/web/src/styles.css#L27`)
- Display font: `Source Serif 4`, serif (`apps/web/src/styles.css#L36`)
- Body font: `IBM Plex Sans`, sans-serif (`apps/web/src/styles.css#L35`)
- Telugu font: `Noto Sans Telugu` (`apps/web/src/styles.css#L35-L36`)
- Monospace font: `IBM Plex Mono` (`apps/web/src/styles.css#L37`)
- Strongest visual element: Canal elevation schematic with 8 outlets and seepage curve, side-by-side with the equal-hours vs equal-water need-met comparison meters.

## Share copy (draft)
"Canal water shared by volume, not by hours. Jadal pairs FAO-56 crop physics with Telugu voice agents and a double-entry ledger so tail-end farmers get fair water."

## Audio direction
- Role: Steady, warm corporate bed with restrained organic UI accents.
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (duration 117.36s, tempo 109.96 BPM, steady and clean).
- Music treatment: Starts at 0.0s at volume 0.32; subtle ducking during key text transitions; gentle 1.5s fade-out at end (18.5s–20.0s).
- Music cue guidance: Preset cues loaded from `happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json`. Key cue locks:
  - Cue 8.74s (strong beat): Scene 2 metric transition and Gini collapse reveal.
  - Cue 13.11s (strong beat): Scene 3 ledger stamp and conservation confirmation.
  - Cue 17.47s (strong beat): Scene 4 final hero brand payoff and title lock.
- Audio-reactive treatment: Subtle RMS modulation on hero accent card glow and water flow line shimmer (no equalizer bars or pulsing text).
- SFX posture: Minimal and restrained (low high-frequency risk).
  - Scene 1 (0.2s): `impactSoft_medium_001.ogg` (subtle warm opening impact).
  - Scene 2 (5.3s): `switch_007.ogg` (crisp UI mode toggle equal_hours → equal_water).
  - Scene 3 (10.9s): `impactSoft_medium_004.ogg` (ledger approval double-entry seal).
  - Scene 4 (15.8s): `bong_001.ogg` (warm resonant chime on Jadal closing emblem).
- Restraint rule: No cartoon whooshes, no aggressive impacts, no voice synthesizers. Audio supports the gravity of agricultural water rights.

---

## Storyboard

### Scene 1 — The Warabandi Deficit (0.0s – 4.8s, 4.8s)
- **Visual**: Warm ivory screen (`#faf9f5`). A stylized schematic of Kondaveedu Minor canal stretches across 3 km with 8 outlet markers (`o1` to `o8`). At Outlet 1 (300 m), flow is 0.145 m³/s (3.5% loss); at Outlet 8 (2900 m), flow drops to 0.106 m³/s (29.4% seepage loss).
- **Text**:
  - Eyebrow: `KONDAVEEDU MINOR CANAL · 3 KM · 8 OUTLETS`
  - Headline: "Everyone got their hours. The tail-end still lost her crop."
  - Subhead: "Under traditional warabandi, one hour at the head is not one hour at the tail. Equal hours deliver 29.4% less water to outlet 8."
  - Metric callout: Tail Need Met: **42%** [MODELLED].
- **Sequential / interaction**: Canal path draws from left to right; outlet loss tags populate head-to-tail.
- **Audio intent**: Serious, reflective setup.
- **Audio-coupled idea**: `impactSoft_medium_001.ogg` at 0.2s as the canal diagram anchors.
- **Music**: Track 12 plays quietly (vol 0.32).
- **Transition mood**: Soft crossfade (0.5s) → Scene 2.

### Scene 2 — Equal Water, Not Equal Hours (4.8s – 10.2s, 5.4s)
- **Visual**: The Coordinator view reveals the Roster Engine comparison toggle switching from `equal_hours` to `equal_water`.
- **Motion**: Turn duration bars recompute. Tail turns lengthen to compensate for conveyance loss.
- **Text**:
  - Eyebrow: `DETERMINISTIC PHYSICS · FAO-56 CROP NEED`
  - Headline: "Canal water shared by volume, not by hours."
  - Data Card:
    - Mode: `equal_water`
    - Tail Need Met: **42% → >90%** [MODELLED]
    - Inequality (Gini): **0.31 → 0.05** [MODELLED]
  - Principle: "The core converts required crop volume into exact turn duration based on local flow."
- **Sequential / interaction**: Mode toggle animates at 5.34s; comparison meters animate and turn green (`#4f7a3a`).
- **Audio intent**: Decisive resolution and mathematical clarity.
- **Audio-coupled idea**: `switch_007.ogg` at 5.34s (toggle switch); beat-locked reveal of green Gini collapse at 8.74s (`// beat-locked: 8.74s`).
- **Transition mood**: Soft slide and crossfade (0.5s) → Scene 3.

### Scene 3 — Voice, Agency & The Conservation Ledger (10.2s – 15.6s, 5.4s)
- **Visual**: Split presentation:
  - Left: Telugu Voice Agent card with authentic audio waveform and quote:
    «నాకు ఈ వారం అత్యవసరంగా నీరు కావాలి.»
    *"Urgent request: 40 m³ granted during rice flowering — deducted from seasonal quota."*
    Farmers without smartphones (f5, f8) receive automated voice phone calls; night release warnings fire 1 hr before gate open.
  - Right: Double-Entry Ledger Card:
    $$\text{Supply } (180,000\text{ m}^3) = \sum \text{Quotas} + \text{Buffer} + \sum \text{Delivered} + \text{Losses}$$
    Status badge: `conservation_ok: true` (verified across all 6 demo steps).
- **Text**:
  - Eyebrow: `SYSTEM-1/2 AGENTS · DOUBLE-ENTRY LEDGER`
  - Headline: "LLMs propose. The core computes. The coordinator approves."
  - Ledger rule: "Overruns are borrowed, never stolen. Every cubic metre is conserved."
- **Sequential / interaction**: Voice card slides in at 10.4s; ledger stamp locks in at 13.11s (`// beat-locked: 13.11s`).
- **Audio intent**: Grounded, verifiable institutional trust.
- **Audio-coupled idea**: `impactSoft_medium_004.ogg` at 13.11s for the ledger audit confirmation.
- **Transition mood**: Soft crossfade (0.5s) → Scene 4.

### Scene 4 — Outro / Title Payoff (15.6s – 20.0s, 4.4s)
- **Visual**: Centerpiece brand card in warm ivory with clay accent border and glowing water emblem.
- **Text**:
  - Logo: **JADAL (జదల్)**
  - Hero Tagline: "Canal water shared by volume, not by hours."
  - Architecture Trifecta: `LLMs propose · Core computes · Coordinator approves`
  - Context: `Kondaveedu Minor Canal · IEEE-CIS Hackathon`
- **Sequential / interaction**: Jadal brand mark settles at 16.0s; tagline and badges hold steadily until 20.0s (full 4.0s readable hold).
- **Audio intent**: Quiet, elegant resolution.
- **Audio-coupled idea**: `bong_001.ogg` chime at 15.84s; music fades out gently between 18.5s and 20.0s.

---

## Evidence & Repo Citations

Every number published in this plan, the video composition, and the accompanying presentation comes directly from the repository source code and contract fixtures:

| Number / Claim | Value | Label / Status | Exact Repo Source & Line Reference |
|---|---|---|---|
| Canal name | Kondaveedu Minor (demo) | Documented | `packages/contracts/fixtures/demo-scenario.json#L6` |
| Canal length | 3,000 m (3 km) | Documented | `packages/contracts/fixtures/demo-scenario.json#L7` |
| Outlets count | 8 outlets | Documented | `packages/contracts/fixtures/demo-scenario.json#L15-64` |
| Head discharge | 0.15 m³/s | Documented | `packages/contracts/fixtures/demo-scenario.json#L8` |
| Seepage loss coefficient | $k = 0.00012\text{ m}^{-1}$ | ASSUMED (illustrative for Guntur soil) | `packages/contracts/fixtures/demo-scenario.json#L2,L9` |
| Head flow at Outlet 1 (300 m) | 0.1447 m³/s (3.5% conveyance loss) | Computed by core hydraulics | `apps/web/src/canal/seed.json`, `packages/core/README.md §7` |
| Tail flow at Outlet 8 (2900 m) | 0.1059 m³/s (29.4% conveyance loss) | Computed by core hydraulics | `apps/web/src/canal/seed.json`, `showcase/video-script.md#L64-66` |
| Tail need-met under equal hours | 42% (Outlet 8) | **MODELLED** (illustrative mock) | `apps/web/src/api/mock.ts#L185-191`, `HANDOFF.md §2` |
| Tail need-met under equal water | >90% (92%–95% in mock, 100% after re-pricing) | **MODELLED** (illustrative mock) | `apps/web/src/api/mock.ts#L190`, `apps/api/src/e2e.test.ts#L131` |
| Equal-hours Gini coefficient | 0.31 | **MODELLED** (illustrative mock) | `apps/web/src/api/mock.ts#L195` |
| Equal-water Gini coefficient | 0.05 | **MODELLED** (illustrative mock) | `apps/web/src/api/mock.ts#L195` (`apps/api/src/e2e.test.ts#L121` asserts `equal_water < equal_hours`) |
| Seasonal canal water supply | 180,000 m³ | Documented | `packages/contracts/fixtures/demo-scenario.json#L326`, `packages/core/README.md §9` |
| Urgent request volume | 40 m³ | Documented | `apps/api/src/e2e.test.ts#L55,L169`, `showcase/video-script.md#L135` |
| Farmers without smartphones | 2 of 8 (f5 Anjamma, f8 Narasimha) | Documented | `packages/contracts/fixtures/demo-scenario.json#L118,L150` |
| Night release window start | 19:00 IST (rw2, warning call at 18:00 IST) | Documented | `packages/contracts/fixtures/demo-scenario.json#L321`, `docs/architecture/overview.md §6` |
| Conservation invariant | `conservation_ok: true` | Verified by core ledger test | `apps/api/src/e2e.test.ts#L262-269`, `packages/core/README.md §9` |
