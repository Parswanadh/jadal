# Jadal — handoff

**Snapshot:** 2026-10-02, about 03:20 IST · **Repo:** `Parswanadh/jadal` · **`main` at:** `1d09943` (merge of #17)

Read this first when you resume. It records the current state, the open work in priority order, how to run everything, and the traps already hit. Ready-to-paste prompts for agents are at the end.

---

## 1. TL;DR

- **All three tasks are merged into `main`, and `main` is green.**
  - typecheck and build pass
  - **396 unit tests**: core 85, web 58, api 253
  - **17 Playwright e2e tests** (mock mode)
- **A real phone call worked end to end.** Twilio (trial) called +91 83417 17162 and played Telugu audio from Sarvam `bulbul:v3` (29 s call, 2026-10-02 02:50).
- **Still open, in priority order:**
  1. **C11 UX cleanup**: draft **#22**, about half done.
  2. **B9 integration**: mount telephony in the API, call `placeCall` from the escalation ladder, and do a live local run with the web app in live mode. Not started.
  3. **Showcase**: demo video, deck, and the brag config, which is still a stub.
  4. **Cloudflare deploy**: never succeeded from this machine because of the network.
- **Nothing is running that you need.** All subagents are stopped. The PR reviewer loop may still be running on the original laptop; see §8.

---

## 2. What Jadal is, in one paragraph

Canal water is usually shared by **equal hours** (warabandi). Seepage means tail-end farms get far less water than head-end farms. Jadal shares water by **equal volume** instead:
1. AI estimates each farm's need (FAO-56 crop model, weather and rain).
2. A coordinator approves.
3. A deterministic physics core turns each volume into a turn time, allowing for seepage and travel lag.
4. A caller agent phones every farmer in **Telugu**.
5. A double-entry **ledger** records every m³ and checks conservation.

On the seed canal (Kondaveedu Minor, 3 km, 8 outlets), tail farms meet about 42% of need under equal hours and over 90% under equal water. Core rule: **LLMs propose, the deterministic core computes, the coordinator approves.** The UI never does water arithmetic.

Key docs (all in the repo):

| Doc | What |
|---|---|
| `AGENTS.md` | Rules for every agent and contributor (scope, contracts, no water math outside core) |
| `docs/problem-statement.md` | The hackathon problem |
| `docs/architecture/overview.md` + `architecture.html` | Architecture, data flow, the ledger movement table (§3) |
| `docs/decisions/ADR-001-004-stack.md`, `ADR-005-telephony.md` | Stack and telephony decisions |
| `docs/research/fao56-*.md` | FAO-56 (2025) crop tables and model, with page refs. Never use `fao56-model.md` §3 numbers. |
| `docs/research/voice-and-data.md` | Sarvam, Twilio, WhatsApp, Open-Meteo endpoints |
| `docs/ops/deploy.md` | Cloudflare resources (Worker `jadal`, D1 `jadal-db`, KV `CACHE`, queue, cron) |
| `docs/presentation/jadal-deck.html` | Current HTML presentation |
| `apps/api/docs/B-SPEC.md`, `INTERFACES.md` | Backend seam documents |
| `showcase/pitch-outline.md`, `backup-video-shot-list.md` | 3-minute pitch and video shot list |

---

## 3. Repo layout and rules

```
packages/contracts   zod schemas + TS types: entities, events, api routes, agents, core interfaces, demo fixture
packages/core        deterministic core: cropEngine, hydraulics, rosterEngine, ledger, policy, cropParams
apps/api             Hono on Cloudflare Workers: D1 event store, routes, System-1/2 agents, voice, campaigns, telephony
apps/web             React + Vite: farmer, coordinator, canal, phone, demo screens; mock or live API client
tests/e2e            Playwright (mock mode); run with `pnpm e2e`
showcase/            pitch, shot list, screenshot capture, brag config (stub)
scripts/agents/      PR reviewer loop and its prompt
```

Non-negotiables:
- **Contracts are immutable.** A change needs the `contracts-ok` label and must be additive.
- **Every water number comes from `@jadal/core`.** No arithmetic in routes, agents, prompts or the UI.
- **The app works with no keys.** System 1 falls back to rules, agents to templates, voice to text, telephony to the simulated phone.
- **Never commit secrets.** `.dev.vars` is gitignored; only `.dev.vars.example`, with names only, is committed (see §7).
- **Workflow:** branch `ws/<task>-<name>`, then a PR labelled `task-A`, `task-B` or `task-C`, then the reviewer merges. Never push to `main` directly except trivial tooling fixes, and never self-merge feature work.

---

## 4. What is merged

| Area | PRs | Notes |
|---|---|---|
| Scaffold, contracts v1, CI, reviewer | initial commits | pnpm 11 monorepo, `allowBuilds` in `pnpm-workspace.yaml` |
| **Task A: core** (#1) | #12 ledger+policy · #13 hydraulics+roster · #14 crop params+engine · #15 exports + README | Crop values verified against FAO-56 2025 Table 6.2. Reproduces the worked examples (groundnut 462.12 m³, rice 643.75 m³). #16 (alternative Task A by kamireddygunapreethika-creator) was closed; its README is in #15 with credit. |
| **Task B: backend** (#2) | #17 | Event store + projections + ledger in one `db.batch`, all contract routes, demo reset/advance, System 1 (Jev + Telugu keyword fallback), System-2 agents, Sarvam/Open-Meteo, escalation ladder, rain re-plan, night release. Uses the real `@jadal/core`. `e2e.test.ts` runs demo steps 1–6 and asserts `conservation_ok: true` and Gini(equal_water) < Gini(equal_hours). |
| **B8: telephony** | #18 | `apps/api/src/telephony/`: Twilio Calls API, TwiML, Sarvam TTS/STT, Deepgram `nova-3` `language=te` fallback, X-Twilio-Signature validation, DTMF 1 = ack and 2 = record a request, status mapping. **Not mounted yet** (see B9). |
| **Task C: web** (#3) | #4 shell · #5 client+mock · #19 screens C3–C7 integrated · #20 design pass · #21 e2e | #6–#10 (by v1r4t) were closed as superseded by #19, with credit. |
| Showcase | #11 | Pitch outline, shot list, screenshot script, **brag stub**. |

---

## 5. Open work, in priority order

### 5.1 C11: user-friendly copy and flows (draft #22, branch `ws/C11-ux`)
**State:** about half done. The agent was stopped. Web typecheck is clean and 80 web unit tests pass. **`pnpm e2e` has not been run**, so expect some selector or text updates in `tests/e2e`.

Punch list (tick off as you verify):
- [ ] Remove developer leakage: API paths ("POST /api/…"), internal IDs (rw1, o7, f1), ISO timestamps, "Seed/Budget/Script estimate", footer "UI displays API values only", lines like "This screen never estimates".
- [ ] One consistent "Demo data" pill (EN/TE) with a tooltip; hidden when live.
- [ ] No mixed-language strings; en/te key parity.
- [ ] Plain language. Explain m³ ("1 m³ = 1,000 litres"). Monospace only for table numbers.
- [ ] Farmer "My water": a "Your next turn" card first. Explain why planned volume differs from entitlement. Sensible empty state instead of "Need met 0%".
- [ ] Coordinator: open on the tab that needs attention, pending-count badges, empty states with next steps.
- [ ] Demo: a guided story; each step has an outcome from the API/mock and a "See it" link; event log behind "Show details"; clock in human time.
- [ ] Layout: use the full width, no lonely narrow column.
- [ ] Keep the existing tokens and fonts (Claude-style palette in `apps/web/src/styles.css`).

Done when: `pnpm -r typecheck && pnpm -r test && pnpm -r build && pnpm e2e` pass, screenshots are refreshed in `apps/web/docs/screenshots/`, and `gh pr ready 22`. Prompt: §11.1.

### 5.2 B9: mount telephony and go live locally (not started)
1. Build `TelephonyDeps` from the env plus the store/repo:
   - `getContact`, `getMessage`, `recordAck`, `updateContactStatus`: append events through `appendEvent`.
   - `classify` = `system1`.
   - `raiseRequest` = the same path as `POST /api/requests`.
   - `cache` = KV `CACHE`.

   Then mount: `app.route("/api/telephony", createTelephonyRoutes(deps))`.
2. In `apps/api/src/campaigns`, call `placeCall`:
   - `{simulated:true}`: keep the simulated phone.
   - `{ok:true}`: mark the contact sent.
   - `{ok:false}`: count a failed attempt, then retry or escalate.
3. Env var names go into `.dev.vars.example` and `env.d.ts`: `TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_FROM_NUMBER PUBLIC_BASE_URL SARVAM_API_KEY DEEPGRAM_API_KEY SARVAM_TTS_SPEAKER REAL_TELEPHONY`.
   - Note: the current `.dev.vars.example` names the number `TWILIO_FROM`, but the telephony module reads `TWILIO_FROM_NUMBER`. Unify on `TWILIO_FROM_NUMBER`.
4. Live local run:
   - `wrangler d1 migrations apply jadal-db --local`
   - `wrangler dev --local --port 8787`
   - `POST /api/demo/reset`
   - web with `VITE_MOCK=0 VITE_API_BASE=http://127.0.0.1:8787`
   - Add a Playwright `live` project and a root script `e2e:live`.
   - If workerd won't run, add `workerd: true` to `allowBuilds`, or fall back to a Node runner using `apps/api/test/d1-shim.ts`.
   - Warning: port 8787 on the original laptop is used by an unrelated `event-manage` wrangler.
5. A real call through the app needs a public URL for Twilio webhooks: deploy, or `cloudflared tunnel --url http://localhost:8787` (see §9 for the DNS trap). Set `PUBLIC_BASE_URL` to it.

Prompt: §11.2.

### 5.3 Showcase: video, deck, brag
- `showcase/brag.config.json` is a **stub** (`_stub: true`). The research doc `docs/research/brag.md` (latent-spaces/brag tooling, planned as ADR for showcase tooling) **never landed**. The research worker was lost.
- Have: `showcase/pitch-outline.md` (3 min), `showcase/backup-video-shot-list.md`, `showcase/screenshots/capture.mjs`, `docs/presentation/jadal-deck.html`, and app screenshots in `apps/web/docs/screenshots/`.
- To do:
  1. Research brag and write `docs/research/brag.md`.
  2. Replace the stub config.
  3. Record a backup demo video, following the shot list. The demo route is `/demo` and runs the 6 steps.
  4. Refresh the deck with the final screenshots and the hero metric. Take numbers **from the app**, not from memory.
  5. Include the real Telugu call audio. A sample is `.ref/call/note-te.wav` on the original laptop; regenerate it with Sarvam if needed.

  Prompt for agy: §11.3.

### 5.4 Deploy to Cloudflare
- Resources are already provisioned; see `docs/ops/deploy.md` and `apps/api/wrangler.jsonc`. The Pages project `jadal-docs` exists for the docs site.
- Earlier deploys failed only because the network blocked Cloudflare/npm.
- From a good network:
  - `pnpm -r build`
  - `wrangler d1 migrations apply jadal-db --remote`
  - `wrangler deploy` (from `apps/api`)
  - `wrangler secret put` for each secret

### 5.5 Housekeeping
- Close issues #1 (Task A, done), #2 (after B9) and #3 (after C11 and the showcase).
- Contract gaps found by Task B, to discuss on #2. Contracts are immutable, so additive changes only, with `contracts-ok`:
  - `Roster` has no `mode` field.
  - The `request.decided` event has no `farmer_id`/`type` (the API uses `entriesForDecision`).
  - `place_call.purpose` is free text, but `Contact.purpose` is a 4-value enum.
  - `Farmer` has no gender field, so Telugu honorifics are inferred heuristically.
- Telugu copy was machine-written. Have a native speaker review `apps/web/src/i18n/te.json` and the voice templates in `apps/api/src/voice/telugu.ts`.
- Twilio is a **trial** account:
  - Verify every number you'll call on stage under Verified Caller IDs.
  - Trial calls start with a Twilio preamble; upgrading removes it.

---

## 6. How to resume on a new machine

```bash
gh repo clone Parswanadh/jadal && cd jadal
pnpm install            # pnpm 11; if it hangs offline, add --config.verify-deps-before-run=false to pnpm commands

# Checks
pnpm -r typecheck && pnpm -r test && pnpm -r build     # expect core 85, web 58, api 253
pnpm exec playwright install chromium && pnpm e2e       # expect 17 passed

# Run the web app in mock mode (no backend needed)
VITE_MOCK=1 pnpm --filter web dev                       # http://localhost:5173

# Continue C11
git checkout ws/C11-ux
```

Mock vs live: `apps/web/src/api/client.ts` has one typed function per route in `packages/contracts/src/api.ts`.
- **Mock** (`VITE_MOCK` unset or `1`, the default): responses are built from `packages/contracts/fixtures/demo-scenario.json`.
- **Live** (`VITE_MOCK=0` + `VITE_API_BASE=…`): the real API is called.
- Both modes are validated against the same zod schemas. Precomputed canal flows (`apps/web/src/canal/seed.json`) came from `@jadal/core` and are marked ASSUMED.

---

## 7. Secrets

- Keep real keys in `apps/api/.dev.vars` (gitignored) locally, and in `wrangler secret put` when deployed. **Never** put them in `.dev.vars.example`, which is tracked.
  - *Incident 2026-10-02:* keys were typed into `.dev.vars.example`. They were moved to `.dev.vars` before any commit, and nothing leaked.
- On the original laptop, `apps/api/.dev.vars` holds: `SARVAM_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`/`TWILIO_FROM_NUMBER`, `REAL_TELEPHONY`, `DEMO_MODE`, `ENVIRONMENT`.
  - Copy it to the new machine by hand, not through git or chat.
  - Not set yet: `OPENROUTER_API_KEY`, `DEEPGRAM_API_KEY`, `META_WHATSAPP_*`, `PUBLIC_BASE_URL`.

---

## 8. Automation: the PR reviewer

- **What it does.** `scripts/agents/review-loop.sh` runs every 120 s:
  1. Picks up open, **non-draft** PRs, oldest first.
  2. Checks out the PR **merged with the latest `main`**.
  3. Runs `pnpm install` plus typecheck, test and build.
  4. Asks a model to review against the task's issue, using `scripts/agents/review-prompt.md`.
  5. Comments with the result.
  6. **Merges (merge commit, not squash)** only if the model approves **and** the checks pass.

  It also auto-resolves lockfile-only conflicts and asks authors to rebase on real conflicts.
- **Model.** opencode `--auto` with `opencode-go/muse-spark-1.3-contributor` (set via `REVIEW_MODEL`; `REVIEW_CLI=agy` switches CLIs).
  - Muse Spark needs "allow training on request data" enabled in the opencode workspace's Privacy settings.
  - The fallback is `opencode/space-bunny-free`.
- **Safety.** The model runs with an empty `GH_CONFIG_DIR` and no token, so it can't push, comment or merge. Only the script, with your `gh` auth, acts on GitHub.
- **Run it on any machine** from the repo root:
  ```bash
  REVIEW_MODEL=opencode-go/muse-spark-1.3-contributor setsid nohup scripts/agents/review-loop.sh 120 >> .ref/review/loop.log 2>&1 < /dev/null &
  tail -f .ref/review/loop.log
  ```
  Stop it with `pkill -f "review-loop[.]sh"`. Write the bracket pattern exactly as shown; a plain pattern also kills the shell running the command.
- On the original laptop it runs from a pinned copy, `.ref/review/bin/`, with `.ref/review/restart.sh` (both gitignored). **If you run the reviewer on another machine, stop it on the old laptop first**, or two loops will review and merge in parallel.
- **Re-review a PR:** delete its line from `.ref/review/reviewed.txt`. Mark a PR draft to keep it out of review.

---

## 9. Traps already hit (save yourself the time)

| Trap | Fix |
|---|---|
| pnpm 11 ignores `onlyBuiltDependencies`, and install fails with `ERR_PNPM_IGNORED_BUILDS` | Use the `allowBuilds:` map in `pnpm-workspace.yaml` (esbuild; add workerd/sharp if needed) |
| pnpm hangs offline on its dependency check | `--config.verify-deps-before-run=false` |
| Squash merges break stacked PRs (16-file conflicts) | Reviewer uses `--merge`. When a base was squashed anyway: `git rebase --onto origin/main <old-base> <branch>` |
| A new dependency added without updating `pnpm-lock.yaml`, so CI `--frozen-lockfile` fails | Run `pnpm install` and commit the lockfile in every PR that changes a `package.json` |
| `opencode run` auto-rejects permission prompts and writes no decision | Use `opencode run --auto` |
| Sarvam `bulbul:v2` is deprecated | Use `bulbul:v3` (the telephony module already does) |
| Twilio trial rejects `Twiml=` and `Method=` (error "trial accounts have limited parameter access") | Send only `To`, `From`, `Url`. The TwiML URL must accept **POST**. |
| A fresh `*.trycloudflare.com` URL doesn't resolve on the local resolver (curl 000), though Twilio can reach it | Test with `curl --resolve host:443:$(dig +short @1.1.1.1 host)` |
| Relative `../../contracts/dist` imports work locally but break clean checkouts | Always import `@jadal/contracts` and declare it as a `workspace:*` dependency |
| The GitHub MCP plugin in Claude Code fails ("Authorization header is badly formatted") | Not needed; the `gh` CLI does everything. Fix its token under `/mcp` if wanted. |

---

## 10. State of the original laptop (`~/projects/cis/jadal`)

- **Main checkout:** branch `docs/handoff`. Switch with `git checkout main && git pull` after #23 merges.
- **Leftover worktrees (safe to remove):**
  - `../jadal-A-crop`, `../jadal-A-hydro`, `../jadal-A-ledger`, `../jadal-A7`, `../jadal-e2e`, `../jadal-preview`
  - `.claude/worktrees/agent-*`: the C11 work in `agent-ab8117f8c6b03a234` is pushed as #22; the others are merged or empty.
  - `.ref/test-wt`, `.ref/review/worktree`
  ```bash
  for w in $(git worktree list --porcelain | awk '/^worktree/{print $2}' | grep -v "^$PWD$"); do git worktree remove --force "$w"; done; git worktree prune
  ```
  Stop the reviewer first, because it uses `.ref/review/worktree`.
- **Processes possibly still running:**
  - the reviewer loop
  - `vite` on :5173 (mock preview from `../jadal-preview`)
  - `python3 -m http.server 8080` serving the docs explainer and deck from `.ref/site`
  - an unrelated `event-manage` wrangler on :8787
- **Useful local-only files under `.ref/`:**
  - `call/`: the Telugu status note text and WAV from the test call
  - `review/runs/`: every review's inputs and decision
  - `fao56-book/`: the FAO-56 2025 text extract
  - `shots/`: screenshots

---

## 11. Ready-to-paste prompts

### 11.1 Finish C11 (any coding agent)
```
Repo Parswanadh/jadal. Continue draft PR #22 on branch ws/C11-ux (apps/web + tests/e2e only).
Read HANDOFF.md §5.1 (punch list), AGENTS.md, gh issue view 3 --comments, apps/web/src.
Run VITE_MOCK=1 pnpm --filter web dev and screenshot every route and sub-tab at 1440x900 first.
Finish every punch-list item. No water arithmetic in the UI; numbers come from the API client/mock.
Keep the design tokens and fonts. Every string goes through i18n, with en/te parity.
Gates: pnpm -r typecheck && pnpm -r test && pnpm -r build && pnpm e2e. Update e2e selectors only where copy changed, keeping their intent.
Refresh apps/web/docs/screenshots/. Commit, push, then `gh pr ready 22`. Never push to main or merge.
```

### 11.2 B9 integration (any coding agent)
```
Repo Parswanadh/jadal. Branch ws/B9-integration from origin/main (apps/api, tests/e2e, root scripts only).
Read HANDOFF.md §5.2, AGENTS.md, gh pr view 17 --comments, docs/decisions/ADR-005-telephony.md,
apps/api/src/{app.ts,index.ts,telephony/*,campaigns/*,db/*,system1.ts}, apps/api/docs/INTERFACES.md.
1) Mount telephony with TelephonyDeps built from the env and the store (events via appendEvent).
2) Call placeCall from the escalation ladder ({simulated} / {ok} / {ok:false} = failed attempt), with stubbed-fetch tests.
3) Put env names only into .dev.vars.example and env.d.ts; unify on TWILIO_FROM_NUMBER.
4) Live local run: apply D1 migrations locally, run wrangler dev, POST /api/demo/reset, web with VITE_MOCK=0,
   add a Playwright "live" project and a root "e2e:live" script, and fix real integration bugs.
Do NOT place real calls. Never read or print apps/api/.dev.vars values.
Gates: pnpm -r typecheck && pnpm -r test && pnpm -r build && pnpm e2e && pnpm e2e:live.
Open a PR labelled task-B with exact run commands. Never push to main or merge.
```

### 11.3 Showcase with agy + brag (run from the repo root)
```bash
agy -p "Repo: Jadal (see HANDOFF.md §2, §5.3, showcase/, docs/presentation/jadal-deck.html, apps/web/docs/screenshots/).
Goal: a winning hackathon showcase.
1) Research the latent-spaces 'brag' tool (what it is, install, config schema, how it builds a showcase page or video)
   and write docs/research/brag.md with sources.
2) Replace the stub showcase/brag.config.json with a real config for Jadal, and delete showcase/brag-note.md.
3) Write showcase/video-script.md: a 3-minute narrated demo following showcase/backup-video-shot-list.md and
   the /demo route's 6 steps, with on-screen captions in English and Telugu and exact timings.
4) Refresh the deck: hero claim 'Canal water shared by volume, not by hours', the head-vs-tail need-met
   comparison, architecture (LLMs propose · core computes · coordinator approves), the Telugu phone call, and the ledger.
   Take every number from the running app (VITE_MOCK=1 pnpm --filter web dev), never invent one.
Only touch showcase/, docs/research/brag.md and docs/presentation/. Do not run git commands." \
  --model gemini-3.8-flash-high --dangerously-skip-permissions
```
Then branch, commit and open a PR labelled `task-C` yourself.

---

## 12. People

- **Parswanadh**: repo owner and orchestrator.
- **v1r4t**: Task C screens (C1–C8; C3–C7 integrated in #19).
- **kamireddygunapreethika-creator**: alternative Task A (#16); the core README is theirs.
