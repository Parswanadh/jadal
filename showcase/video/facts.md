# Jadal Launch Video — Verified Facts & Ground Truth Table

> **Context:** Truth-checking and evidentiary baseline for the 45–60 s launch video.  
> **Standard:** Every claim and number is labelled with its exact source and evidentiary standard (**RAN**, **READ**, **COMPUTED**, **SOURCE**).  
> **Rule:** No unverified, simulated, or refuted metric may be spoken in voiceover or rendered on screen.

---

## 1. Allowed Metrics & Claims Table

| # | Claim / Parameter | Value | Unit | Source (`file:line` or command) | Label | Verified | Usage in Script |
|---|---|---|---|---|---|---|---|
| **01** | Canal Name | Kondaveedu Minor (demo) | — | `packages/contracts/fixtures/demo-scenario.json:6` | `READ` | **YES** | Shot 1 & 2 subtitle / context pill |
| **02** | Canal Length | 3 | km (3000 m) | `packages/contracts/fixtures/demo-scenario.json:7` | `READ` | **YES** | Shot 1 & 2 narration / on-screen graphic |
| **03** | Total Outlets | 8 | outlets (`o1`–`o8`) | `packages/contracts/fixtures/demo-scenario.json:15-64` | `READ` | **YES** | Shot 2 schematic & voiceover |
| **04** | Canal Lining | Unlined (earthen) | boolean (`lined: false`) | `packages/contracts/fixtures/demo-scenario.json:13` | `READ` | **YES** | Shot 2 voiceover on seepage |
| **05** | Head Discharge ($Q_0$) | 0.15 | m³/s | `packages/contracts/fixtures/demo-scenario.json:8` | `READ` | **YES** | Technical reference / graphics |
| **06** | Seepage Decay Constant ($k$) | 0.00012 | m⁻¹ | `packages/contracts/fixtures/demo-scenario.json:9` | `READ` | **YES** | Model documentation / graphics |
| **07** | Outlet 1 Chainage | 300 | m | `packages/contracts/fixtures/demo-scenario.json:20` | `READ` | **YES** | Shot 2 on-screen marker |
| **08** | Outlet 1 Delivered Flow | 0.145 (exact: 0.1447) | m³/s | `apps/web/src/canal/seed.json:17`, `packages/core/src/hydraulics.ts:92` ($0.15 \times e^{-0.00012 \times 300}$) | `COMPUTED` & `READ` | **YES** | Shot 2 on-screen comparison |
| **09** | Outlet 1 Conveyance Loss | 3.5 | % (`0.035`) | `apps/web/src/canal/seed.json:18`, $1 - e^{-0.00012 \times 300} = 0.03536$ | `COMPUTED` & `READ` | **YES** | Shot 2 on-screen comparison |
| **10** | Outlet 8 Chainage (Tail) | 2900 | m | `packages/contracts/fixtures/demo-scenario.json:62` | `READ` | **YES** | Shot 2 on-screen marker |
| **11** | Outlet 8 Delivered Flow | 0.106 (exact: 0.1059) | m³/s | `apps/web/src/canal/seed.json:59`, `packages/core/src/hydraulics.ts:92` ($0.15 \times e^{-0.00012 \times 2900}$) | `COMPUTED` & `READ` | **YES** | Shot 2 on-screen comparison & voiceover |
| **12** | Outlet 8 Conveyance Loss | 29.4 | % (`0.294`) | `apps/web/src/canal/seed.json:60`, $1 - e^{-0.00012 \times 2900} = 0.29390$ | `COMPUTED` & `READ` | **YES** | Shot 2 voiceover ("29% loss per second") |
| **13** | Tail Need Met (Equal Hours) | ~42 | % | `apps/web/src/api/mock.ts:322` ($98 - 7 \times 8 = 42$), `docs/HANDOFF-ENGINEERING.md:46-47` | `READ` & `COMPUTED` | **YES** | Shot 2 problem statement ("tail meets ~42% of need") |
| **14** | Automated Tests Passing | 794 | passed tests (152 core, 111 web, 531 api) | `docs/HANDOFF-ENGINEERING.md:108`, `git log` live tag audit | `READ` | **YES** | Shot 6 technical proof card |
| **15** | TypeScript Typecheck | Clean across all 4 packages | contracts, core, web, api | `docs/HANDOFF-ENGINEERING.md:107` | `READ` | **YES** | Shot 6 technical proof card |
| **16** | i18n Bilingual Parity | 600 / 600 leaf keys | English & Telugu exact match | `apps/web/src/i18n/en.json`, `apps/web/src/i18n/te.json`, verified via script | `RAN` & `COMPUTED` | **YES** | Shot 5 on-screen badge / bilingual support |
| **17** | Core Architectural Mandate | "LLMs propose, deterministic core computes, coordinator approves" | Principle | `docs/HANDOFF-ENGINEERING.md:64`, `apps/api/src/agents/loop.ts`, `packages/contracts/src/agents.ts` | `READ` | **YES** | Shot 4 central transition & on-screen lower third |
| **18** | Turn Duration Formula | $T_i = V_i / Q(x_i)$ | seconds or hours | `packages/core/src/roster.ts:24`, `packages/core/src/hydraulics.ts:90-95` | `SOURCE` & `READ` | **YES** | Shot 3 on-screen equation card |
| **19** | Velocity Formula | $v = \frac{1}{n} R^{2/3} S^{1/2}$ (Manning open channel) | m/s | `packages/core/src/hydraulics.ts:41-78` | `SOURCE` & `READ` | **YES** | Shot 3 physics foundation callout |
| **20** | Double-Entry Conservation | $\sum \text{Debits} = \sum \text{Credits}$ across all transfers | m³ conservation invariant | `packages/core/src/ledger.ts:1-250`, `packages/core/src/ledger.test.ts` | `READ` | **YES** | Shot 5 ledger callout |
| **21** | Outbound Call Rate Limit | 3 calls / 60 s per dialed handset | rate limit bound | `apps/api/src/campaigns/rate-limit.ts`, `docs/HANDOFF-ENGINEERING.md:116` | `READ` | **YES** | Architecture / safety notes |
| **22** | Core Package Boundary | Zero I/O, zero network, zero LLM calls | architectural boundary | `packages/core/package.json`, `docs/HANDOFF-ENGINEERING.md:76` | `READ` | **YES** | Shot 4 deterministic core badge |

---

## 2. Forbidden Claims List (DO NOT USE)

The following claims are strictly **FORBIDDEN** from appearing on screen, in voiceover, or in supporting text:

| Forbidden Claim / Metric | Why It Is Forbidden | Evidence / Finding Source |
|---|---|---|
| **Any Gini figure (e.g., 0.31, 0.05, 0.00)** | In the live deployment path (`POST /api/rosters/propose`), `equal_hours_gini` and `equal_water_gini` both return `0` because `rosterEngine.needMet` clamps at 100 before delivery and delivered water is 0. Gini is uncalibrated in production. | `docs/HANDOFF-ENGINEERING.md:171-182` (P4), `packages/core/src/roster.ts:281` |
| **"0.31 -> 0.05" Gini drop** | This specific transition exists only as a hardcoded static mock object in `apps/web/src/api/mock.ts:327`. It is not computed by the deterministic core or verified in live tests. | `apps/web/src/api/mock.ts:327`, `docs/HANDOFF-ENGINEERING.md:171-182` |
| **"90%" or ">90%" tail need-met** | The claim that equal-water delivers >90% need-met at the tail comes from mock formula `92 + (i % 4)` in `apps/web/src/api/mock.ts:322`. The live path clamps to 100% or requires unperformed delivery verification. Do not cite a specific post-allocation percentage. | `apps/web/src/api/mock.ts:322`, `docs/HANDOFF-ENGINEERING.md:171-182` |
| **Any claim that SMS or WhatsApp works** | `POST /api/alerts` accepts SMS and WhatsApp but returns `simulated: true`. No transport or gateway integration exists in code; Twilio trial accounts reject Indian destination SMS (error 572006). | `docs/HANDOFF-ENGINEERING.md:221-226` (P9), `apps/api/src/routes/alerts.ts` |
| **Any claim that live phone calls are currently reliable** | The live Twilio account balance is `$0.00 USD` (Trial account). Calls cut out when trial quota exhausts. The system supports telephony via TwiML, but calling cannot be claimed as production-reliable without funding. | `docs/HANDOFF-ENGINEERING.md:136-143` (P1) |
| **Groundnut 462.12 m³ worked example** | `packages/core/README.md` claimed 462.12 m³ for groundnut, but the shipped `crop-params.json` yields 417.69 m³ (a 10.6% discrepancy). CI tests masked this by injecting hand-typed ad-hoc parameters. Rice example (643.75 m³) reproduces, but groundnut does not. | `docs/HANDOFF-ENGINEERING.md:183-193` (P5), `docs/research/model-audit.md:32,53-56` |
| **Dynamic ML Triage Urgency Score** | `triage_score` returns a constant floor of `0.15` (`URGENCY_BASE`) for short demo requests because keyword tables do not match English inputs and ML classification is not wired into the numeric score. | `docs/HANDOFF-ENGINEERING.md:144-156` (P2), `apps/api/src/system1.rules.ts:345` |
| **Laya Model Active in Live API** | `LAYA_ENDPOINT` is unset in standard environment configurations, defaulting System-1 classification directly to keyword rules. | `docs/HANDOFF-ENGINEERING.md:158-169` (P3) |

---

## 3. Verification Commands & Outputs

Below is the verified evidence collected directly in the workspace during truth checking:

### 3.1 i18n Key Parity Check
- **Command executed:**
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
- **Observed output:** `en: 600 te: 600` (`diff: 0`)
- **Status:** `RAN` — Verified exact parity across 600 translation keys.

### 3.2 Hydraulics Core Test Check
- **Command executed:**
  ```bash
  pnpm --filter @jadal/core exec vitest run src/hydraulics.test.ts --maxWorkers=1
  ```
- **Observed output:**
  ```
  ✓ src/hydraulics.test.ts (12 tests) 6ms
  Test Files  1 passed (1)
       Tests  12 passed (12)
    Duration  256ms
  ```
- **Status:** `RAN` — Verified core open-channel and seepage computations.

### 3.3 Flow Decay Recomputation (Manning & Exponential Seepage)
- **Input Parameters:**
  $Q_0 = 0.15\text{ m}^3/\text{s}$, $k = 0.00012\text{ m}^{-1}$.
- **Recomputed Values:**
  - Outlet 1 ($x = 300\text{ m}$):
    $$Q(300) = 0.15 \times e^{-0.00012 \times 300} = 0.144696\text{ m}^3/\text{s} \approx 0.145\text{ m}^3/\text{s}$$
    $$\text{Loss} = 1 - e^{-0.036} = 0.03536 \approx 3.5\%$$
  - Outlet 8 ($x = 2900\text{ m}$):
    $$Q(2900) = 0.15 \times e^{-0.00012 \times 2900} = 0.105914\text{ m}^3/\text{s} \approx 0.106\text{ m}^3/\text{s}$$
    $$\text{Loss} = 1 - e^{-0.348} = 0.293903 \approx 29.4\%$$
- **Status:** `COMPUTED` — Matches `apps/web/src/canal/seed.json` lines 17-18 and 59-60 exactly.
