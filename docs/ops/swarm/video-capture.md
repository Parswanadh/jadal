# Swarm Task Report: Video Capture (`showcase/video/capture`)

**Task:** Capture raw footage for launch video of Jadal's web app in MOCK mode (no backend, no secrets).  
**Lane Scope:** `showcase` (enforced by pre-commit hook)  
**Branch:** `ws/swarm-video-capture`  
**Date:** 2026-10-02  

---

## 1. What Changed

1. **Created automated video & screenshot capture pipeline:**
   - [`showcase/video/capture.mjs`](file:///home/parshu/projects/cis/jadal-w-video-capture/showcase/video/capture.mjs): Playwright script using Chromium (`/usr/bin/google-chrome`) navigating the web app running on `http://127.0.0.1:5311` with `VITE_MOCK=1`.
   - Automates authentication for Farmer (`farmer` / `farmer123`) and Coordinator (`coordinator` / `coordinator123`) according to `docs/HANDOFF-ENGINEERING.md §0`.
   - Records user interactions on `/canal` (toggle Equal Hours vs Equal Water, and overrun outlet selection) and `/demo` (starting walkthrough, executing Step 1 fairness comparison, advancing simulation clock +6h).
   - Compresses PNGs with FFmpeg zlib level 9 mixed prediction.
   - Encodes 1080p WebM recordings using VP9 at 30fps.
   - Generates [`showcase/video/capture/MANIFEST.md`](file:///home/parshu/projects/cis/jadal-w-video-capture/showcase/video/capture/MANIFEST.md).

2. **Captured Artifacts in [`showcase/video/capture/`](file:///home/parshu/projects/cis/jadal-w-video-capture/showcase/video/capture):**
   - `home.png` (1920x1080, 156.5 KB) — Cover page
   - `login.png` (1920x1080, 63.2 KB) — Sign-in screen with role switcher
   - `canal.png` (1920x1080, 129.7 KB) — Canal seepage diagram & Gini comparison
   - `phone.png` (1920x1080, 101.8 KB) — Telugu farmer call simulator
   - `demo.png` (1920x1080, 118.4 KB) — Demo walkthrough console
   - `farmer.png` (1920x1080, 132.1 KB) — Farmer portal post-login (My Water allocation & schedule)
   - `coordinator.png` (1920x1080, 118.8 KB) — Coordinator console post-login (Request triage & roster)
   - `canal-seepage.webm` (1920x1080, 30fps, 9.57 s, 1.55 MB) — Screen recording of `/canal` interactive rebalance
   - `demo.webm` (1920x1080, 30fps, 9.00 s, 1.36 MB) — Screen recording of `/demo` walkthrough run
   - `MANIFEST.md` — Detailed inventory and verification log

---

## 2. Evidence & Verification

### A. Web Server Execution in Mock Mode
- **RAN:** `VITE_MOCK=1 pnpm --filter web dev --port 5311 --strictPort --host 127.0.0.1`
- **READ:** `curl -I http://127.0.0.1:5311`
  ```http
  HTTP/1.1 200 OK
  Content-Type: text/html
  ```
- **SOURCE:** `apps/web/src/api/client.ts` lines 88-90 confirming `isMockMode() === true` when `VITE_MOCK=1`.

### B. Image Resolution & Format Verification
- **RAN:** `file showcase/video/capture/*.png`
- **READ:** Observed output:
  ```
  showcase/video/capture/canal.png:       PNG image data, 1920 x 1080, 8-bit/color RGB, non-interlaced
  showcase/video/capture/coordinator.png: PNG image data, 1920 x 1080, 8-bit/color RGB, non-interlaced
  showcase/video/capture/demo.png:        PNG image data, 1920 x 1080, 8-bit/color RGB, non-interlaced
  showcase/video/capture/farmer.png:      PNG image data, 1920 x 1080, 8-bit/color RGB, non-interlaced
  showcase/video/capture/home.png:        PNG image data, 1920 x 1080, 8-bit/color RGB, non-interlaced
  showcase/video/capture/login.png:       PNG image data, 1920 x 1080, 8-bit/color RGB, non-interlaced
  showcase/video/capture/phone.png:       PNG image data, 1920 x 1080, 8-bit/color RGB, non-interlaced
  ```

### C. Screen Recording Durations and Codecs
- **RAN:** `for f in showcase/video/capture/*.webm; do echo "$f:"; ffprobe -v error -select_streams v:0 -show_entries stream=width,height,codec_name -of csv=p=0 "$f"; done`
- **READ:**
  ```
  showcase/video/capture/canal-seepage.webm: vp9,1920,1080
  showcase/video/capture/demo.webm:          vp9,1920,1080
  ```
- **RAN:** `for f in showcase/video/capture/*.webm; do echo "$f:"; ffprobe -v error -show_entries format=duration -of csv=p=0 "$f"; done`
- **READ:**
  ```
  showcase/video/capture/canal-seepage.webm: 9.566000 s
  showcase/video/capture/demo.webm:          9.000000 s
  ```
  Both duration values fall strictly within the required 5–10 s window.

### D. File Size Budget Verification
- **RAN:** `ls -la showcase/video/capture`
- **COMPUTED:** Sum of all capture assets = 3,898,683 bytes = **3.72 MB**.
  This uses only 14.9% of the allocated 25 MB budget.

### E. Quality, UI Error State, and i18n Verification
- **READ:** Browser console logs during all page loads and walkthrough steps.
- **OBSERVED:** Zero missing translation keys (no `[i18n] missing translation key` logged).
- **OBSERVED:** Zero `.notice-crit` or unhandled error alerts on any screen.
- **OBSERVED:** Animations settled cleanly before screenshots and video recording commenced.

### F. Port Hygiene & Teardown
- **RAN:** Cancelled background web server task on port 5311.
- **RAN:** `lsof -i :5311 || ss -tulpn | grep 5311`
- **OBSERVED:** Empty output; port 5311 is completely released.

---

## 3. What is Left / Needs a Human

- **Video Editor Review:** The raw 1080p footage in `showcase/video/capture/` is ready for cut-down into the final launch video composition (or feeding into Remotion/hyperframes under `showcase/brag-output`).
- **Telugu Audio Synchronization:** When stitching `phone.png` or the voice call sequence, sync with the authentic Telugu audio clips (`apps/api/docs/VOICE.md` / `telugu.ts`).
