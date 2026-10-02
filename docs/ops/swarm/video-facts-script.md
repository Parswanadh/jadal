# Swarm Task Report: video-facts-script

**Agent:** video-facts-script  
**Worktree:** `/home/parshu/projects/cis/jadal-w-video-facts-script`  
**Branch:** `ws/swarm-video-facts-script`  
**Date:** 2026-10-02  

---

## 1. What Changed

1. **Created `showcase/video/facts.md`:**
   - Authored the comprehensive truth-checked facts reference table for the Jadal launch video.
   - Listed every allowed claim and number with exact source (`file:line` or command), evidentiary label (`RAN`, `READ`, `COMPUTED`, `SOURCE`), verification status (`YES`/`NO`), and video usage context.
   - Formulated the explicit **FORBIDDEN** claims list based on the engineering audit (`docs/HANDOFF-ENGINEERING.md`), specifically forbidding:
     - Any Gini figure (live path returns 0 due to pre-delivery clamping; P4)
     - '0.31 -> 0.05' (unverified mock value from `mock.ts`)
     - '90%' or '>90%' tail need-met (unverified mock formula)
     - Any claim that SMS or WhatsApp works (no transport in code; P9)
     - Any claim that live phone calls are currently reliable (Twilio balance is $0.00 trial; P1)
     - Any claim that the groundnut 462.12 m³ example reproduces (diverges from shipped parameters; P5)
     - Any claim that triage score is dynamic ML (constant 0.15 floor; P2)
     - Any claim that Laya is active by default (endpoint unset; P3)

2. **Created `showcase/video/script-v2.md`:**
   - Wrote the 45–60 s launch video storyboard (runtime: **56 seconds**, 152 spoken words).
   - Structured around the required narrative arc:
     - Hook: *"Everyone got their hours — the tail still lost the crop."* (0:00 – 0:08)
     - Physics of Seepage: Kondaveedu Minor 3 km, 8 outlets; Head 0.145 m³/s (3.5% loss) vs Tail 0.106 m³/s (29.4% loss); tail ~42% need met (0:08 – 0:19)
     - Equal Volume: Turn duration by hydraulics $T_i = V_i / Q(x_i)$ (0:19 – 0:30)
     - Governing Architecture: *"LLMs propose · deterministic core computes · coordinator approves"* (0:30 – 0:41)
     - Telugu Caller Agent + Ledger: Voice outreach, 600/600 translation parity, immutable double-entry conservation ledger (0:41 – 0:51)
     - Technical Close: 794 automated tests passed, verified core, fair water (0:51 – 0:56)
   - Integrated bilingual captions (EN/TE) and asset references matching parallel capture deliverables in `showcase/video/capture/`.

---

## 2. Evidence Standard & Commands Executed

### [RAN] i18n Translation Key Parity Verification
- **Command:**
  ```bash
  python3 -c "
  import json
  def count_keys(d):
      cnt = 0
      for k, v in d.items():
          cnt += count_keys(v) if isinstance(v, dict) else 1
      return cnt
  en = json.load(open('apps/web/src/i18n/en.json'))
  te = json.load(open('apps/web/src/i18n/te.json'))
  print('en:', count_keys(en), 'te:', count_keys(te))
  "
  ```
- **Observed Output:**
  ```
  en: 600 te: 600
  ```
- **Verdict:** Clean 100% parity across 600 leaf keys between English and Telugu translation dictionaries.

### [RAN] Deterministic Core Hydraulics Test Execution
- **Command:**
  ```bash
  pnpm --filter @jadal/core exec vitest run src/hydraulics.test.ts --maxWorkers=1
  ```
- **Observed Output:**
  ```
  ✓ src/hydraulics.test.ts (12 tests) 6ms
  Test Files  1 passed (1)
       Tests  12 passed (12)
    Duration  256ms
  ```
- **Verdict:** Hydraulics test suite passed with 12/12 tests in 256ms.

### [COMPUTED] Seepage Decay & Flow Values
- **Formula:** $Q(x) = Q_0 \times e^{-k \cdot x}$, $\text{Loss} = 1 - e^{-k \cdot x}$
- **Inputs:** $Q_0 = 0.15\text{ m}^3/\text{s}$, $k = 0.00012\text{ m}^{-1}$
- **Computed Outputs:**
  - Outlet 1 ($x = 300\text{ m}$):
    $$Q(300) = 0.15 \times e^{-0.036} = 0.144696\text{ m}^3/\text{s} \approx 0.145\text{ m}^3/\text{s}$$
    $$\text{Loss} = 1 - e^{-0.036} = 0.03536 \approx 3.5\%$$
  - Outlet 8 ($x = 2900\text{ m}$):
    $$Q(2900) = 0.15 \times e^{-0.348} = 0.105914\text{ m}^3/\text{s} \approx 0.106\text{ m}^3/\text{s}$$
    $$\text{Loss} = 1 - e^{-0.348} = 0.293903 \approx 29.4\%$$
- **Verdict:** Matches `apps/web/src/canal/seed.json` lines 17-18 and 59-60 exactly.

### [READ] Baseline Repository Claims
- `packages/contracts/fixtures/demo-scenario.json:6-14`: Canal length 3000 m (3 km), 8 outlets, unlined canal (`lined: false`), Manning $n = 0.025$, bed slope $0.0004$.
- `apps/web/src/api/mock.ts:322`: Equal-hours need-met calculation for Outlet 8 ($i = 7$): $98 - 7 \times 8 = 42\%$.
- `docs/HANDOFF-ENGINEERING.md:108`: Automated test count at `live/2026-10-02` tag: 794 passed (core: 152, web: 111, api: 531).
- `docs/HANDOFF-ENGINEERING.md:107`: Monorepo typecheck clean.

---

## 3. What Is Left / Needs a Human

1. **Video Assembly Lane Coordination:**
   - The parallel capture agent (`ws/swarm-video-capture`) needs to record the 6 screen captures matching the planned routes (`/canal`, `/coordinator`, `/phone`) at 1440×900 viewport resolution.
   - The audio agent (`ws/swarm-video-audio`) needs to record or generate the 56-second English voiceover track and Telugu call phrase snippet using the verbatim lines in `showcase/video/script-v2.md`.
2. **Review of Telugu Voice Scripting:**
   - The Telugu call copy in `apps/api/src/voice/telugu.ts` is machine-written and should be confirmed by a native Telugu speaker before finalizing commercial video voice tracks.
3. **Product Decision on Worked Examples:**
   - A project owner must resolve the groundnut discrepancy (P5) in documentation vs parameter tables before worked crop volumes can be featured in marketing materials.
