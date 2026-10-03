# Hyperframes Composition Brief: Jadal

## Objective
Create a short, polished launch video for Jadal, demonstrating how physics-based volume allocation and verified double-entry ledgers solve canal water inequality for tail-end farmers.

## Output
- Composition directory: `showcase/brag-output/composition/`
- Rendered video: `showcase/brag-output/brag.mp4`
- Best-frame poster: `showcase/brag-output/brag.jpg`
- Format: landscape — 1920x1080 (30 fps)
- Duration: 20 seconds (15–25s window strictly maintained)

## Source Material
- Repository root: all paths in this brief are repo-root-relative.
- Primary files read: `README.md`, `HANDOFF.md`, `docs/presentation/jadal-deck.html`, `apps/web/src/styles.css`, `apps/web/src/api/mock.ts`, `packages/contracts/fixtures/demo-scenario.json`
- Product name: Jadal (జదల్)
- Tagline / strongest claim: "Canal water shared by volume, not by hours."
- Core governance principle: "LLMs propose · Core computes · Coordinator approves."
- Key UI and visual moments:
  - Canal elevation schematic with 8 outlets along 3 km, showing seepage deficit at Outlet 8 (29.4% conveyance loss).
  - Coordinator console roster comparison toggle switching `equal_hours` → `equal_water`.
  - Tail need-met surge (42% → >90% [MODELLED]) and Gini collapse (0.31 → 0.05 [MODELLED]).
  - Telugu voice urgent request card and double-entry conservation ledger badge (`conservation_ok: true`, 180,000 m³ balanced).

## Creative Direction
- Tone preset: `polished`
- Creative direction: "A serious, elegant product film for public agricultural infrastructure — quiet confidence and mathematical restraint over tech hype."
- Interpretation: Generous reading holds, clean typographic contrast, warm ivory background with clay accent and slate-blue water lines. No flashing text, no cartoon graphics.
- Angle: Traditional warabandi irrigation shares hours instead of water. Because unlined canals suffer heavy seepage and transit lag, tail farmers receive far less water per minute. Jadal computes the actual volume delivered and extends tail turns accordingly.
- Hook: "Everyone got their hours. The tail-end still lost her crop. Hours are not water."
- Outro / punchline: "Canal water shared by volume, not by hours. LLMs propose · Core computes · Coordinator approves."
- Avoid:
  - Generic SaaS buzzwords ("revolutionize", "streamline your workflow").
  - Decorative fluff or unrelated vector graphics.
  - Invented numbers (all figures must carry their documented or [MODELLED] citations).

## Visual Identity
- Background: `#faf9f5` (warm ivory)
- Surface: `#ffffff` (pure white cards)
- Surface Alt: `#f3f1ea` (warm light grey)
- Border / Rule: `#e3e0d6`
- Primary Text: `#1f1e1d` (deep charcoal)
- Muted Text: `#73716a` (warm stone)
- Accent: `#c96442` (warm clay)
- Water: `#4e7a96` (canal slate blue)
- Ok / Success: `#4f7a3a` (agricultural green)
- Display font: `Source Serif 4`, serif
- Body font: `IBM Plex Sans`, sans-serif
- Telugu font: `Noto Sans Telugu`, sans-serif
- Monospace font: `IBM Plex Mono`, monospace

## Storyboard
Contracted from `showcase/brag-output/brag-plan.md`:
1. **Scene 1 — The Warabandi Deficit (0.0s – 4.8s, 4.8s)**
   - Canal schematic (Kondaveedu Minor, 3 km, 8 outlets).
   - Outlet 1 flow: 0.145 m³/s (3.5% loss); Outlet 8 flow: 0.106 m³/s (29.4% loss).
   - "Everyone got their hours. The tail-end still lost her crop."
   - Tail Need Met: 42% [MODELLED].
2. **Scene 2 — Equal Water, Not Equal Hours (4.8s – 10.2s, 5.4s)**
   - Roster toggle switch to `equal_water`.
   - Physics core extends tail turns to compensate for seepage.
   - Tail Need Met surges: 42% → >90% [MODELLED].
   - Gini inequality coefficient collapses: 0.31 → 0.05 [MODELLED].
3. **Scene 3 — Voice, Agency & The Conservation Ledger (10.2s – 15.6s, 5.4s)**
   - Telugu voice urgent request card: «నాకు ఈ వారం అత్యవసరంగా నీరు కావాలి.»
   - 40 m³ grant deducted from future quota (no free overruns).
   - Voice calls for non-smartphone farmers (f5, f8) and night release warnings 1 hr prior.
   - Double-entry ledger invariant: $\text{Supply } (180,000\text{ m}^3) = \sum \text{Quotas} + \text{Buffer} + \sum \text{Delivered} + \text{Losses}$.
   - Badge: `conservation_ok: true`.
4. **Scene 4 — Outro / Title Payoff (15.6s – 20.0s, 4.4s)**
   - Hero brand card: **JADAL (జదల్)**.
   - Tagline: "Canal water shared by volume, not by hours."
   - Principle: `LLMs propose · Core computes · Coordinator approves`.

## Audio
- Audio role: Steady, warm corporate bed with restrained organic UI accents.
- Audio arc: Quiet contemplative opening; crisp resolution on toggle; authoritative confirmation on ledger seal; warm fade to silence on closing emblem.
- Music: `showcase/brag-output/composition/assets/music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (117.36s, 109.96 BPM, volume 0.32, fade out 18.5s–20.0s). Third-party track — gitignored; replace with a licensed file of the same name (or update the `bg-music` src in `showcase/brag-output/composition/index.html`) before publishing.
- Music cue guidance: Preset loaded from `showcase/brag-output/composition/assets/music/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json`.
  - Strong cue at 8.74s: lock green metric reveal (`// beat-locked: 8.74s`).
  - Strong cue at 13.11s: lock ledger audit stamp (`// beat-locked: 13.11s`).
  - Strong cue at 17.47s: lock hero brand payoff (`// beat-locked: 17.47s`).
- SFX files (copied to `showcase/brag-output/composition/assets/sfx/`):
  - `showcase/brag-output/composition/assets/sfx/impact/impactSoft_medium_001.ogg` at 0.2s (opening anchor)
  - `showcase/brag-output/composition/assets/sfx/interface/switch_007.ogg` at 5.34s (mode toggle)
  - `showcase/brag-output/composition/assets/sfx/impact/impactSoft_medium_004.ogg` at 13.11s (ledger seal)
  - `showcase/brag-output/composition/assets/sfx/interface/bong_001.ogg` at 15.84s (brand chime)
- Audio-reactive treatment: Subtle RMS shimmer on canal water path and accent badge card. No equalizers or waveform graphics.
- Restraint rule: Audio serves the seriousness of water equity in agricultural communities.
