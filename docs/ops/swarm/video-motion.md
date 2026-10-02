# Swarm Lane Report: video-motion

**Lane:** `video-motion`  
**Branch:** `ws/swarm-video-motion`  
**Date:** 2026-10-02  
**Status:** COMPLETE & VERIFIED  

---

## 1. Summary of Changes

Built a standalone 1920×1080 animated motion-graphic scene demonstrating the physical canal seepage and rotational turn allocation contrast for Jadal:
- **File:** `showcase/video/motion/canal.html`
- **QA Snapshots:** `showcase/video/motion/qa/frame_01_1_0s.png` through `frame_05_12_5s.png`
- **Duration:** 14.0 seconds (seekable, deterministic GSAP timeline bound to `window.__timeline`).
- **Beat 1 (0.0s – 7.5s): Physical Canal & Seepage Loss**
  - Schematic of the 3 km Kondaveedu Minor canal with 8 outlets (`Outlet 1` through `Outlet 8`) drawn head to tail.
  - Tapering canal flow stream from `0.145 m³/s` (`3.5% loss`) at the Head to `0.106 m³/s` (`29.4% loss`) at the Tail.
  - 14 deterministic seepage droplets leaking down beneath the unlined earthen canal bed into the soil stratum.
  - Distance ruler indicating `0 km (Head)` to `3 km (Tail)`.
- **Beat 2 (7.5s – 14.0s): Turn Allocation Contrast**
  - **Equal Hours (Warabandi):** 8 equal turn bars (duration equalized on clock), but flow rate starvation at `Outlet 8` (`0.106 m³/s`, deficit highlighted in clay `#c96442`).
  - **Equal Volume (Jadal):** Dynamic transition where turn durations adapt—head turns remain base, while tail turns progressively lengthen, with `Outlet 8` turn bar extending to 125px (compensated for seepage and travel lag).
  - Explicit compliance: Strict restriction to only approved numbers (`3 km`, `8 outlets`, `0.145 m³/s`, `3.5%`, `0.106 m³/s`, `29.4%`). Zero Gini coefficients and no extraneous percentages.
  - Palette conforming to `apps/web/src/styles.css`: Ivory `#faf9f5`, Clay `#c96442`, Water Blue `#4e7a96`, Text `#1f1e1d`.

---

## 2. Verification & Evidence Log

### Check 1: Playwright Test & Screenshot Capture
- **[RAN]** `node /home/parshu/.gemini/antigravity-cli/brain/765c864c-7d07-41cb-81c9-83b1f12044e6/scratch/capture_qa.js`
- **[OBSERVED]**
  ```
  Navigating to file:///home/parshu/projects/cis/jadal-w-video-motion/showcase/video/motion/canal.html
  Saved screenshot at 1s to /home/parshu/projects/cis/jadal-w-video-motion/showcase/video/motion/qa/frame_01_1_0s.png
  Saved screenshot at 3.5s to /home/parshu/projects/cis/jadal-w-video-motion/showcase/video/motion/qa/frame_02_3_5s.png
  Saved screenshot at 5.5s to /home/parshu/projects/cis/jadal-w-video-motion/showcase/video/motion/qa/frame_03_5_5s.png
  Saved screenshot at 9s to /home/parshu/projects/cis/jadal-w-video-motion/showcase/video/motion/qa/frame_04_9_0s.png
  Saved screenshot at 12.5s to /home/parshu/projects/cis/jadal-w-video-motion/showcase/video/motion/qa/frame_05_12_5s.png
  Capture complete!
  ```

### Check 2: Visual Inspection & Iterative Refinement
- **[READ]** Initial inspection of QA frames via `view_file`:
  - `frame_02_3_5s.png` showed floating metric badges overlapping canal title text and covering `Outlet 1` / `Outlet 8` labels.
  - `frame_03_5_5s.png` revealed GSAP overriding SVG `transform="translate()"` on `<g>` elements, causing droplets to render above the canal.
  - `frame_05_12_5s.png` showed header text relying on an unfired JS `onUpdate` tween rather than deterministic GSAP DOM state.
- **[COMPUTED]** Redesigned layout and DOM structure:
  - Repositioned Head and Tail metric cards to dedicated non-overlapping slots on the top row of the canal panel.
  - Nested droplet groups (`.drop-slot` holding base translate, inner `.seepage-drop` animating `y` offset) ensuring downward seepage into the soil stratum.
  - Added discrete `#header-hours` and `#header-volume` DOM elements with GSAP cross-fade tweens for 100% deterministic timeline seeking to any millisecond.
  - Re-captured and re-inspected all 5 frames; confirmed zero overlaps, crisp typography, and clear contrast.

### Check 3: Number & Invariant Audit
- **[RAN]** `grep -E "([0-9]+\.?[0-9]*%)|([0-9]+\.[0-9]+)" showcase/video/motion/canal.html`
- **[OBSERVED / SOURCE]**
  - Canal length: `3 km` (matches seed scenario and contracts)
  - Number of outlets: `8` (`Outlet 1` to `Outlet 8`)
  - Head flow: `0.145 m³/s` with `3.5% loss`
  - Tail flow: `0.106 m³/s` with `29.4% loss`
  - No Gini coefficients, no extraneous percentages.

---

## 3. What is Left / Needs a Human

- **Video Assembly Integration:** The HTML scene is ready for headless scrubbing or frame extraction (e.g., via Hyperframes CLI, Puppeteer, or ffmpeg) to be spliced into Shot 02 of the launch video.
- **Telugu Subtitles (Optional):** If rendering the Telugu audio/video track variant, Telugu labels for outlets (`ఔట్‌లెట్ 1` .. `ఔట్‌లెట్ 8`) from `apps/web/src/canal/seed.json` can be toggled via an optional query parameter.
