# Jadal — Pending Features

**Generated:** 2026-10-03 · **Repo:** `Parswanadh/jadal` · **Main:** `e46a290`

This document tracks every pending/unfinished feature found by systematic analysis of the codebase, docs, tests, config, and GitHub state.

---

## Priority Legend

- **HIGH** — Blocks core functionality, safety, or deploy
- **MEDIUM** — Important but not blocking
- **LOW** — Nice to have, non-code, or housekeeping

---

## 1. Code Features (Buildable)

### 1.1 Harvest Exit Route — `crop.harvested` Producer
- **Priority:** HIGH
- **Source:** `apps/api/src/e2e.test.ts:29-33,220-257`, `apps/api/src/core-adapters.ts:169-170`
- **Problem:** No HTTP route appends `crop.harvested`. The event is fully defined in contracts, handled by core ledger and projections, but no route/agent/campaign emits it. Demo step 5 ("harvest frees water for others") is not implemented end-to-end.
- **Impact:** Quota→buffer movement never happens. Buffer stays 0 m³. f7's buffer grant is always `policy_refused`.
- **Fix:** Add a `POST /api/canal/harvest` route that appends `crop.harvested` for a farmer. Wire it into the demo step 5 flow.

### 1.2 Ungated `place_call` — Governance Gap
- **Priority:** HIGH
- **Source:** `apps/api/src/observability/urgent-water-flow.trace.test.ts:26-30,357-375`, `packages/contracts/src/agents.ts:25`
- **Problem:** `place_call` is `gated: false`, so an urgent request that was never approved is still dispatched. This contradicts the core rule "LLMs propose, the coordinator approves."
- **Impact:** Safety/governance invariant violated.
- **Fix:** Change `gated: true` in contracts (needs `contracts-ok` label). Add a guard in the escalation ladder that checks for coordinator approval before placing a call.

### 1.3 Failproof Observability Middleware Wiring
- **Priority:** HIGH
- **Source:** `apps/api/src/observability/hono-middleware.ts:4-6`, `apps/api/src/app.ts:26-70`, `docs/ops/failproof.md:289-311`
- **Problem:** Middleware is fully implemented but never registered. `FAILPROOF_API_KEY` and `FAILPROOF_TRACE` env vars are undeclared.
- **Impact:** Production request tracing is unavailable.
- **Fix:** Add 2 lines in `app.ts` (import + `app.use`), declare env vars in `env.ts` and `.dev.vars.example`.

### 1.4 Durable Workflow Triggering
- **Priority:** HIGH
- **Source:** `apps/api/wrangler.jsonc:44-55`, `apps/api/src/campaigns/workflows.ts:90,153`, `apps/api/src/index.ts:37,95`
- **Problem:** `UrgentRequestWorkflow` and `CallCampaignWorkflow` are bound in wrangler but never triggered. No `.create()` call exists anywhere.
- **Impact:** The entire B7 durable-campaign layer is dead code in production.
- **Fix:** Start `UrgentRequestWorkflow` on urgent-request raise. Start `CallCampaignWorkflow` on campaign dispatch. Add workflow bindings to `Env`.

### 1.5 Meta WhatsApp Cloud API Integration
- **Priority:** HIGH
- **Source:** `apps/api/src/env.ts:59-60`, `apps/api/src/agents/tools/registry.ts:385-420`
- **Problem:** `META_WHATSAPP_TOKEN` and `META_PHONE_NUMBER_ID` are declared but never used. `send_whatsapp` only appends an event and enqueues a message — no Meta Graph API call.
- **Impact:** WhatsApp "messages" never leave the system.
- **Fix:** Implement the actual WhatsApp send path (Meta Cloud API `POST /messages`).

### 1.6 `triage_score` Constant 0.15 (F-16)
- **Priority:** HIGH
- **Source:** `apps/api/src/system1.rules.ts:345`, `docs/research/model-audit.md:47,551`
- **Problem:** `triage_score = 0.15` is the floor value, not a computation. Rules tier returns 0.15 for any English reason with no keyword matches. Coordinator shown a meaningless urgency number.
- **Impact:** Misleading coordinator; correctness bug.
- **Fix:** Treat "no signal" as distinct low-confidence state. Extend rule tables. Or supply `OPENROUTER_API_KEY`.

### 1.7 Live Gini/Need-Met Returns 0/100 (P4)
- **Priority:** HIGH
- **Source:** `packages/core/src/roster.ts:281`
- **Problem:** Gini fairness comparison returns 0 in live path (`needMet` clamps at 100, `delivered` 0). Core fairness claim invisible in live path.
- **Impact:** The head-vs-tail fairness comparison is invisible in production.
- **Fix:** Fix the live path to compute real Gini and need-met values.

### 1.8 System 1 Provenance Persistence
- **Priority:** MEDIUM
- **Source:** `apps/api/src/system1.ts:25-32`, `docs/decisions/ADR-006-system1-providers.md:42-47`
- **Problem:** `request.triaged` has no `source` field. Production callers read only `intent`/`urgency`. Audit trail cannot distinguish rules fallback from real laya/jev decision.
- **Fix:** Add `source` field to `request.triaged` event (needs `contracts-ok`).

### 1.9 Roster Mode Persistence
- **Priority:** MEDIUM
- **Source:** `apps/api/migrations/0002_jadal.sql:123-126`, `HANDOFF.md:152-156`
- **Problem:** `equal_water`/`equal_hours` mode is not stored. Read-back loses the mode.
- **Fix:** Add `mode` field to `Roster` contract (needs `contracts-ok`).

### 1.10 Contact Detail/Via Persistence
- **Priority:** MEDIUM
- **Source:** `apps/api/src/telephony-deps.ts:18-22`
- **Problem:** Twilio `CallSid`, call duration, and ack channel are accepted but not persisted.
- **Fix:** Add fields to `Contact` or `contact.updated` event (needs `contracts-ok`).

### 1.11 `OPENROUTER_MODEL` Env Var
- **Priority:** MEDIUM
- **Source:** `apps/api/src/agents/llm.ts:40,71,218`
- **Problem:** `OPENROUTER_MODEL` is read by code but absent from canonical `Env` and `.dev.vars.example`.
- **Fix:** Declare `OPENROUTER_MODEL?: string` on Worker `Env` and document it.

### 1.12 Queue Consumer Retry/DLQ Config
- **Priority:** MEDIUM
- **Source:** `apps/api/wrangler.jsonc:37-41`
- **Problem:** No `max_batch_size`, `max_batch_timeout`, `max_retries`, `max_concurrency`, or `dead_letter_queue`.
- **Fix:** Add retry/DLQ config to wrangler.jsonc.

### 1.13 CI Missing Lint + E2E
- **Priority:** MEDIUM
- **Source:** `.github/workflows/ci.yml:31-38`
- **Problem:** CI only runs typecheck, test, build. No lint or e2e.
- **Fix:** Add `pnpm lint` and `pnpm e2e` steps to CI.

### 1.14 Schema Version Stale
- **Priority:** MEDIUM
- **Source:** `apps/api/migrations/0001_init.sql:7`, `0002_jadal.sql`
- **Problem:** `0002_jadal.sql` never inserts a `schema_version` row, so version stays at 1.
- **Fix:** Add schema_version tracking to migrations.

### 1.15 Web Form GPS/Efficiency Hardcoded
- **Priority:** MEDIUM
- **Source:** `apps/web/src/farmer/RegistrationForm.tsx:59,64`
- **Problem:** `lat: 0, lon: 0` and `application_efficiency: 0.65` hardcoded as ASSUMED.
- **Fix:** Add GPS capture or make configurable.

### 1.16 Mock Uses ASSUMED Numbers
- **Priority:** MEDIUM
- **Source:** `apps/web/src/api/mock.ts:19-24,254,317-327`
- **Problem:** Mock uses illustrative ASSUMED numbers instead of real core/backend values.
- **Fix:** Wire mock to use real `@jadal/core` computations.

### 1.17 `week.released_to_buffer` Event Dead
- **Priority:** MEDIUM
- **Source:** `packages/contracts/src/events.ts:49`, `packages/core/src/ledger.ts:69,224`
- **Problem:** Event is defined and handled but no producer exists.
- **Fix:** Add a route or campaign that emits this event.

### 1.18 `ASSETS` Binding Unused
- **Priority:** LOW
- **Source:** `apps/api/wrangler.jsonc:10-19`, `apps/api/src/env.ts:19`
- **Problem:** `ASSETS` binding declared but never used in Worker code.
- **Fix:** Remove from env or use it.

### 1.19 Laya Sidecar Not in Workspace/CI
- **Priority:** LOW
- **Source:** `services/laya/`, `pnpm-workspace.yaml`
- **Problem:** Python service exists but not in workspace or CI.
- **Fix:** Add to workspace or document manual setup.

### 1.20 No Linter/Formatter Config
- **Priority:** LOW
- **Source:** All packages
- **Problem:** No ESLint/Prettier/Biome config. `lint` script is just `tsc --noEmit`.
- **Fix:** Add ESLint or Biome config.

### 1.21 Missing Node Version Pin
- **Priority:** LOW
- **Source:** `package.json:6-8`
- **Problem:** No `.nvmrc` or `.node-version`.
- **Fix:** Add `.nvmrc` with `24`.

### 1.22 Divergent Deploy Entry Points
- **Priority:** LOW
- **Source:** `package.json:17`, `.github/workflows/deploy.yml:85-91`
- **Problem:** Root `deploy` script vs wrangler-action in CI.
- **Fix:** Standardize on one deploy path.

---

## 2. Infrastructure & Deploy

### 2.1 CI/CD Broken by Committed `node_modules` Symlinks
- **Priority:** HIGH
- **Source:** `node_modules`, `apps/api/node_modules`, `apps/web/node_modules`, `packages/contracts/node_modules`, `packages/core/node_modules`
- **Problem:** Commit `4519045` added symlinks to git. CI fails with `ENOTDIR`.
- **Fix:** `git rm --cached` all node_modules symlinks and commit.

### 2.2 Deploy Job Never Executed
- **Priority:** HIGH
- **Source:** `.github/workflows/deploy.yml`
- **Problem:** Deploy job gated on secrets. All "successful" runs were skips.
- **Fix:** Set GitHub secrets (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN).

### 2.3 GitHub Secrets Not Configured
- **Priority:** HIGH
- **Source:** `docs/ops/deploy.md` §3
- **Problem:** CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN not set.
- **Fix:** `gh secret set` for both.

### 2.4 Cloudflare App Secrets Not Pushed
- **Priority:** HIGH
- **Source:** `apps/api/wrangler.jsonc`, `apps/api/.dev.vars.example`
- **Problem:** `wrangler secret put` not done for SARVAM_API_KEY, TWILIO_*, etc.
- **Fix:** Push all secrets.

### 2.5 Remote D1 Migration Never Run
- **Priority:** HIGH
- **Source:** `.github/workflows/deploy.yml`
- **Problem:** `wrangler d1 migrations apply --remote` never executed.
- **Fix:** Run after secrets are set.

---

## 3. Showcase

### 3.1 Backup Demo Video Not Produced
- **Priority:** HIGH
- **Source:** `showcase/video-script.md`, `showcase/backup-video-shot-list.md`
- **Problem:** Scripts complete but no 3-minute recording exists.
- **Fix:** Record video following shot list.

### 3.2 Screenshot Capture Never Run
- **Priority:** HIGH
- **Source:** `showcase/screenshots/capture.mjs`, `screenshots.config.json`
- **Problem:** `showcase/screenshots/out/` does not exist. 8 captures expected.
- **Fix:** Run `pnpm --filter jadal-showcase screenshots`.

### 3.3 App Screenshots Incomplete
- **Priority:** MEDIUM
- **Source:** `apps/web/docs/screenshots/`
- **Problem:** Only 4 of 8 expected screenshots exist.
- **Fix:** Capture missing routes.

### 3.4 Composition Music Asset Missing
- **Priority:** MEDIUM
- **Source:** `showcase/brag-output/composition/index.html:719`
- **Problem:** Third-party MP3 is gitignored. Fresh checkout 404s.
- **Fix:** Supply licensed track or remove reference.

### 3.5 Real Telugu Call Audio Not in Repo
- **Priority:** MEDIUM
- **Source:** `.ref/call/note-te.wav`
- **Problem:** Audio exists only on original machine.
- **Fix:** Regenerate with Sarvam or re-record.

### 3.6 Placeholder URLs Throughout Showcase
- **Priority:** MEDIUM
- **Source:** `showcase/brag.config.json`, `screenshots.config.json`, etc.
- **Problem:** All URLs are `demo.jadal.example.com`.
- **Fix:** Replace after deploy.

### 3.7 Deck Refresh with Final Screenshots
- **Priority:** MEDIUM
- **Source:** `docs/presentation/jadal-deck.html`
- **Problem:** Deck references stale screenshots.
- **Fix:** Refresh after screenshot capture.

---

## 4. Contract Gaps (Need `contracts-ok` Label)

### 4.1 `Roster` Has No `mode` Field
- **Priority:** MEDIUM
- **Source:** `HANDOFF.md:152-156`

### 4.2 `request.decided` Lacks `farmer_id`/`type`
- **Priority:** MEDIUM
- **Source:** `HANDOFF.md:152-156`

### 4.3 `place_call.purpose` Free Text vs `Contact.purpose` Enum
- **Priority:** MEDIUM
- **Source:** `HANDOFF.md:152-156`

### 4.4 `Farmer` Has No Gender Field
- **Priority:** MEDIUM
- **Source:** `HANDOFF.md:152-156`

### 4.5 `Contact` Cannot Record `simulated`/`CallSid`
- **Priority:** MEDIUM
- **Source:** `HANDOFF.md:152-156`

### 4.6 `POST /api/alerts` Not in Contract
- **Priority:** MEDIUM
- **Source:** `packages/contracts/src/api.ts`

### 4.7 `WeatherDay` Has No Humidity/Wind Fields
- **Priority:** MEDIUM
- **Source:** `docs/research/model-audit.md:35,548`

---

## 5. Model Audit Findings

### 5.1 F-01: Groundnut Parameter Divergence
- **Priority:** MEDIUM
- **Source:** `docs/research/model-audit.md:32,545`
- **Problem:** Documented example (462.12 m³) ≠ shipped table (417.69 m³).

### 5.2 F-02: Seepage Formula Divergence
- **Priority:** MEDIUM
- **Source:** `docs/research/model-audit.md:33,546`

### 5.3 F-03: Overrun Losses Not Sequential
- **Priority:** MEDIUM
- **Source:** `docs/research/model-audit.md:34,547`

### 5.4 F-04: Kc Climate Adjustment Partial
- **Priority:** MEDIUM
- **Source:** `docs/research/model-audit.md:35,548`

### 5.5 F-05: Paddy Peff No Weir-Crest Cap
- **Priority:** LOW
- **Source:** `docs/research/model-audit.md:36,549`

### 5.6 F-06: Upland Peff No Dr Cap
- **Priority:** LOW
- **Source:** `docs/research/model-audit.md:37,549`

### 5.7 F-08: Rain Re-plan Reconciliation
- **Priority:** MEDIUM
- **Source:** `docs/research/model-audit.md:39,550`

### 5.8 F-16: Triage Score = 0.15
- **Priority:** HIGH
- **Source:** `docs/research/model-audit.md:47,551`

---

## 6. Housekeeping

### 6.1 Close Issues #1, #2, #3
- **Priority:** LOW
- **Source:** `HANDOFF.md:151`

### 6.2 Telugu Copy Native Review
- **Priority:** LOW
- **Source:** `HANDOFF.md:157`

### 6.3 Twilio Trial Limits
- **Priority:** LOW
- **Source:** `HANDOFF.md:158-160`

### 6.4 Unmerged Remote Branches
- **Priority:** MEDIUM
- **Source:** `integration/all`, `integration/swarm-2026-10-02`, `ws/B-inbound`, `ws/B-noloop*`, `ws/swarm-*`
- **Problem:** Large body of finished work not on main, no PRs.

---

## Summary

| Priority | Count | Categories |
|----------|-------|------------|
| HIGH | 8 | Code features (5), Infrastructure (3) |
| MEDIUM | 17 | Code features (8), Showcase (5), Contracts (4) |
| LOW | 10 | Code features (4), Housekeeping (3), Model findings (3) |

**Total: 35 pending features**

---

## Recommended Build Order

1. **CI/CD fix** (2.1) — unblocks everything
2. **Harvest exit route** (1.1) — core demo gap
3. **Ungated place_call** (1.2) — safety
4. **Failproof wiring** (1.3) — observability
5. **Workflow triggering** (1.4) — campaigns
6. **WhatsApp integration** (1.5) — messaging
7. **triage_score fix** (1.6) — correctness
8. **Live Gini fix** (1.7) — fairness
9. **Contract gaps** (4.1-4.7) — needs `contracts-ok`
10. **Screenshot capture** (3.2) — showcase
11. **Deploy** (2.2-2.5) — production
