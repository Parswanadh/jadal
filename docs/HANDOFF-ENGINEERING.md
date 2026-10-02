# Jadal — engineering handoff

**Written:** 2026-10-02 · **Live tag:** `live/2026-10-02` · **Branch:** `integration/all`

This document exists so a fresh set of agents can pick this up without re-deriving
context. It records the problem, what is built, what is verified, what is broken, and
what to do next — in that order. Read §1–§3 before touching code.

---

## 0. Start here: bring the system up

```bash
cd /home/parshu/projects/cis/jadal-integration     # branch integration/all
git fetch --tags origin

pnpm install --config.verify-deps-before-run=false
cp /home/parshu/projects/cis/jadal/apps/api/.dev.vars apps/api/.dev.vars   # gitignored, not in git
pnpm --filter api migrate:local                     # REQUIRED in a fresh worktree

# three processes
pnpm --filter api dev:live                          # API   -> http://127.0.0.1:8788
VITE_MOCK=0 pnpm --filter web dev --port 5180 --strictPort --host 127.0.0.1   # web -> :5180
(pnpm --filter laya ... )                           # see services/laya/README.md -> :8099
cloudflared tunnel --url http://127.0.0.1:8788 --no-autoupdate   # public URL for Twilio
```

**Sign in:** `/login`, role Farmer or Coordinator, passwords `farmer123` / `coordinator123`
(overridable via `VITE_FARMER_PASSWORD` / `VITE_COORDINATOR_PASSWORD`). There is no sign-up.

**Three traps that cost real time:**

| Trap | Symptom | Fix |
|---|---|---|
| Migrations not applied | every read route 500s, `D1_ERROR: no such table: farmer` | `pnpm --filter api migrate:local` |
| `PUBLIC_BASE_URL` unset or stale | Twilio plays *"we could not reach your server"* | point it at a live tunnel and verify `curl <url>/api/health` = 200 |
| Two `wrangler dev` on 8788 | one loses the bind and dies; requests flap between 200 and 500 | one server only; lanes use their own ports |

---

## 1. The problem

Canal water in the Kondaveedu Minor command (Andhra Pradesh) is shared by **warabandi** —
every farm gets **equal hours** on a weekly roster. But water seeps through 3 km of unlined
canal, so an hour at the head delivers far more than an hour at the tail. Measured on the seed
scenario: head flow **0.145 m³/s** (3.5% loss) versus tail **0.106 m³/s** (29.4% loss). Tail-end
farms meet roughly **42%** of crop need; head-end farms are near 100%.

The register records *time*, so it calls both turns fair. The tail crop fails.

## 2. What Jadal does about it

Share water by **equal volume** instead of equal hours:

1. **AI estimates each farm's need** — FAO-56 crop model, weather, rain.
2. **A deterministic core** turns each volume into a turn duration, `Tᵢ = Vᵢ / Q(xᵢ)`,
   accounting for seepage and travel lag.
3. **A coordinator approves** — nothing reaches a farmer until a human says so.
4. **A caller agent phones every farmer in Telugu**, with a double-entry
   **ledger** recording every m³ and checking conservation.

**The governing principle, enforced in code rather than documented:**

> **LLMs propose, the deterministic core computes, the coordinator approves.**

Concretely: tools in `packages/contracts/src/agents.ts` carry `gated: true|false`, and
`apps/api/src/agents/loop.ts` returns a **proposal** for a gated tool instead of applying it.
No water arithmetic exists outside `packages/core`.

---

## 3. Architecture

```
packages/contracts   zod schemas + types: entities, events, api routes, agents, core interfaces
packages/core        DETERMINISTIC CORE — cropEngine, hydraulics, rosterEngine, ledger, policy
                     no I/O, no LLM, no network. Every water number originates here.
apps/api             Hono on Cloudflare Workers; D1 event store, routes, System-1/2 agents,
                     telephony, campaigns, voice
apps/web             React + Vite; farmer, coordinator, canal, phone, demo screens; mock|live client
services/laya        local Laya System-1 service (Python sidecar, :8099)
tests/e2e            Playwright (mock mode)
showcase/            pitch, shot list, brag launch video
```

**Request lifecycle.** `POST /api/requests` → `raiseRequest()` (`apps/api/src/requests.ts`)
appends `request.raised` + `request.triaged` atomically → System-1 classifies → coordinator
`POST /api/requests/:id/decide` → ledger entries → alerts/calls via the telephony module.

**System 1** (`apps/api/src/system1.ts`) is a provider chain: **laya → jev → rules**, selected by
`SYSTEM1_PROVIDER` (default `auto`). Every result carries `source`, so a fallback can never be
reported as if the model ran.

**Call sites.** Exactly two paths place outbound calls:
`apps/api/src/coordinator-alert.ts` (coordinator alert / allocation) and
`apps/api/src/campaigns/escalation.ts` (the ladder). Both go through `placeCallIfAllowed` in
`apps/api/src/telephony-deps.ts`, which is the only route to `placeCall`.

---

## 4. Verified working at `live/2026-10-02`

Measured, not assumed.

| Check | Result |
|---|---|
| `pnpm -r typecheck` | clean (contracts, core, web, api) |
| `pnpm -r test` | **794 passed** — core 152, web 111, api 531 |
| All 9 GET routes | 200 |
| Farmer → coordinator → farmer | verified live: raise → visible → approve → ledger records |
| Coordinator turn-time editor | `PATCH /api/rosters/:id/turns/:turnId` saves; backwards interval → 400 |
| Coordinator reject | API verified; UI fixed and covered by live e2e |
| Real Twilio calls | **connect and are answered** (3s, 13s, 20s `completed`) |
| Call audio | TwiML 200, audio 200 (`audio/wav`, ~351 KB) via public tunnel |
| Per-farmer number mapping | verified: Twilio dialled the mapped handset |
| Rate limit | **atomic**, 3 calls / 60 s per dialled handset; 12 simultaneous → exactly 3 |
| Laya service | 200, classifies short Telugu in ~30–220 ms |
| `/api/alerts` | live, with severity + optional allocation |
| Inbound path | code complete, `resolveCaller` wired, proven by signed webhook replay |

### Call routing (as configured)

```
COORDINATOR_PHONE   = +918341717162                 coordinator alerts
FARMER_DEMO_NUMBERS = +917207997965, +918610071143  farmers, mapped f1→965, f2→143, f3→965, …
REAL_TELEPHONY      = true
TWILIO_TRIAL        = 1     trial accounts reject extra call params (Method, status callbacks)
```

---

## 5. What still needs patching

Ordered by value. Each is concrete and independently actionable.

### P1 — Twilio balance is $0.00 (blocks any live demo)

`GET /Accounts/{sid}/Balance.json` → `0.00 USD`, account type **Trial**. Calls connect today,
but the trial quota already cut out once mid-session with *"Voice calling isn't available for
this trial account."* **Not fixable in code.** Add funds or upgrade before presenting.

*Also:* a Trial account plays a preamble and can only dial **verified** recipients.

### P2 — `triage_score` is a constant, not a computation

Every raised request scores **0.15**. Root cause: `URGENCY_BASE = 0.15` in
`apps/api/src/system1.rules.ts:345`; `scoreUrgency` (:364) *starts* there and only ADDS on
keyword hits, and the demo reasons are short English phrases that match none of the
(predominantly Telugu) term tables. A key would not fix it — the rules tier returns 0.15 *with*
a key too.

The coordinator is shown an "urgency score" that measures nothing.

**Fix options:** (a) emit a distinct low-confidence state instead of a floor as a "score";
(b) cover the English reasons the demo seeds; (c) wire Laya's intent (see P3) and stop showing
urgency as a number until it is trustworthy.

### P3 — Laya is running but not wired

`LAYA_ENDPOINT` is unset, so the System-1 chain skips Laya and lands on keyword rules every time.
Setting `LAYA_ENDPOINT=http://127.0.0.1:8099/decide` enables it.

**Before you do, read `docs/research/laya-verdict.md`.** Laya is trustworthy for `intent` (4/4 on
short Telugu) and `mentions_crop_stress` (5/5), but **not** for `urgency` (rated "the crop will
die today" at band 2) or `is_release_time` (false-positived 0.814 on Telugu, **0.778 on an English
control**). Those two return `null` by design and the rules handle them. Keep it that way.

**Laya runs on CPU**, not GPU. Load is 8.3 s, inference 27–43 ms.

### P4 — The Gini fairness comparison returns 0 in the live path

`POST /api/rosters/propose` returns `equal_hours_gini: 0` and `equal_water_gini: 0`, with
`need_met.pct` = 100 for every farmer. `rosterEngine.needMet` (`packages/core/src/roster.ts:281`)
clamps at 100 and `delivered` is 0 before delivery, so the head-vs-tail gap is invisible.

A sibling bug was already fixed on the roster side (`equal_hours` was delivering 5,997 m³ against
2,400 m³ demanded while reporting 100% need met), but this path still reads all-100s.

**Do not put the Gini on screen as-is.** Use the `/canal` seepage diagram (0.145 → 0.106 m³/s) as
the visible fairness evidence until this is fixed. Suggested fix: un-clamp, and separate *planned*
from *delivered* need-met — the comparison is meaningful on planned allocation at proposal time.

### P5 — The groundnut worked example does not reproduce

`packages/core/README.md` claims **462.12 m³**. The shipped `crop-params.json` has
`kc_mid: 1.05`, `root_depth_m.max: 1.0`, which give **417.69 m³** — 10.6% low. `crop.test.ts`
passes a **hand-typed inline `CropParams`** (`kc_mid: 1.1325`, `Zr {0.5, 0.8}`) that exists in no
data file, inside a ±0.5 m³ window, so CI stayed green.

The document and the shipped behaviour have diverged and the test masks it. Pinned by a test;
**an owner must decide whether the doc or the table value is right.** See
`docs/research/model-audit.md`.

### P6 — `crop-params.json` is partly unsourced

Verified against the unabridged FAO-56 Rev.1 (2025) text:

- The 2025 edition **abolished static calendar stage lengths** (replaced by GDD), so **all 44
  `stage_days` values are unsourced**.
- **No paddy percolation rate exists in FAO-56**; `percolation_mm_day` 3.5/2.0 is a project value.
- Rice has no numeric depletion fraction in Table 8.2; `depletion_p: 0.20` is unsourced.
- The `redgram` row cites **"p. 410" of a document that ends at p. 401**.
- 8 of 9 `t_base_c`/`t_upper_c` pairs mismatch Table 6.10.

Kc / max_height / root_depth / depletion_p **do** match Table 6.2 and 8.2 for groundnut, cotton,
sugarcane, maize, greengram, blackgram, chickpea. Every field is now tagged MEASURED/ASSUMED in
a `constant_status` object — tagged, not deleted.

### P7 — FAO-56 climate adjustment is implemented but cannot fire

Eq. 6.18/6.21 (`adjustKcForClimate`) had **no implementation at all**; it now exists with the
source's validity domain, but it is **opt-in** because `WeatherDay` carries no humidity or wind
field. Making it live in production needs an additive contract change.

### P8 — `place_call` is declared `gated: false`

`packages/contracts/src/agents.ts:25`. The real dispatch path **is** approval-gated (contacts are
only created inside `approveRoster`), so this is a declaration inaccuracy rather than a live hole
— but it contradicts the product's central claim. Needs a `contracts-ok` correction.

### P9 — SMS / WhatsApp accepted but never sent

`POST /api/alerts` accepts both, audits them as a `queued` contact, and returns
`simulated: true` with a detail saying nothing was sent. **No transport exists.** Do not describe
these as working. (Twilio also blocks SMS to India on a trial account: error 572006.)

### P10 — Smaller items

- **Inbound calling requires buying a number.** The account owns **zero** `IncomingPhoneNumbers`,
  so there is no endpoint for a farmer to dial — not a code gap. Steps in `apps/api/docs/INBOUND.md`.
- **`nextTurnFor` / `onSpeechPath` unwired** (both optional, both degrade honestly: a spoken
  schedule question gets `schedule_hold` rather than an invented time).
- **Rate limit gaps** (`docs/ops/CALL-SAFETY.md` §3/§6): windows are fixed not sliding, so a
  boundary-straddling burst can reach `2 × maxCalls`; the limit is per-dialled-number, so a
  roster walk still places one call per farmer; `releaseCall` is a decrement, not a rollback.
- **Telugu copy is machine-written** — needs a native speaker for `apps/web/src/i18n/te.json`
  and `apps/api/src/voice/telugu.ts`.
- **`campaigns/workflows.ts` scheduling was never audited** — flagged unverified, not claimed safe.

---

## 6. Rules that must not be broken

1. **`packages/contracts` is immutable** without the `contracts-ok` label, and changes must be
   **additive**. Three-way parallel work depends on this.
2. **Every water number comes from `@jadal/core`.** No arithmetic in routes, agents, prompts or UI.
3. **Every user-visible string goes through i18n** with exact en/te parity (currently 600/600).
4. **Never commit secrets.** `.dev.vars` is gitignored; only `.dev.vars.example` (names only) is
   tracked. Verified: no `.dev.vars` in git history.
5. **Never report a simulated dispatch as real,** or a rules fallback as a model call. Every
   result carries `source`; every call result carries `simulated`.
6. **Branch, then PR.** `ws/<area>-<name>`, label `task-A|B|C`. Never push to `main`.

---

## 7. Working with agents on this repo

Learned the hard way this session:

- **One writer per worktree.** Several agents editing one worktree caused a `git add -A` to sweep
  12 files from one lane into another lane's commit. A `pre-commit` hook now refuses staging
  outside `LANE_SCOPE`; **stage explicit paths, never `git add -A`.**
- **One server per port.** Two `wrangler dev` on 8788 fight and die; requests flap 200/500. Give
  each lane its own port.
- **Do not restart the API while calls are in flight** — it invalidates TwiML URLs Twilio is
  still fetching (now a graceful spoken message rather than a 404, but the caller still loses
  their alert).
- **Do not run `demo/reset` during a call** for the same reason.
- **Stub the network in every test.** The harness fetch throws on unrouted URLs, so an accidental
  real call fails loudly instead of ringing.
- **`REAL_TELEPHONY=false` is the emergency stop.** It kills all dialling with no deploy.

### Evidence standard

Claims need the command and its observed output. This session repeatedly found verified-looking
work that was not: a Laya service that 502'd on every call, a login screen rendering raw i18n
keys, a Gini that returned 0, a groundnut figure that did not reproduce, tests that passed by
asserting a hand-typed value rather than the shipped one. **Prefer a refuted claim to a
plausible one.** Label each statement RAN / READ / COMPUTED / SOURCE.

---

## 8. Reference documents

| Doc | Contents |
|---|---|
| `docs/ops/FROZEN-BASELINE.md` | the earlier freeze, plus its two recorded corrections |
| `docs/architecture/models.md` | every model: equation, units, FAO-56 page, validity domain |
| `docs/research/model-audit.md` | the audit, with RAN/READ/COMPUTED labels |
| `docs/research/laya-verdict.md` | why Laya is trusted for intent only |
| `docs/ops/CALL-SAFETY.md` | every call site, its bound, the rate limit, recovery steps |
| `apps/api/docs/INBOUND.md` | how to enable inbound calling |
| `apps/api/docs/VOICE.md` | the Telugu call script and phrases |
| `apps/api/docs/LIVE.md` | running the API locally |
| `docs/decisions/ADR-00*.md` | stack and telephony decisions |
| `HANDOFF.md` | the original handoff (older; §5 priorities are largely superseded by §5 above) |

---

## 9. Open PRs

Ten branches were merged into `integration/all` this session. Several PRs against `main` remain
open and were never merged — `#22, #24, #25, #26, #27, #28, #29, #30, #31, #32`. Treat
`integration/all` at `live/2026-10-02` as the source of truth; the PRs are superseded by it.

---

## 10. If something breaks

```bash
# 1. Stop all dialling immediately
#    edit apps/api/.dev.vars -> REAL_TELEPHONY=false   (no deploy needed)

# 2. Restore the known-good live state
cd /home/parshu/projects/cis/jadal-integration
git checkout -B integration/all live/2026-10-02
pnpm install --config.verify-deps-before-run=false
pnpm --filter api migrate:local

# 3. If calls run away, see docs/ops/CALL-SAFETY.md §1
#    grep "noloop:" in the API log names the offending path
```
