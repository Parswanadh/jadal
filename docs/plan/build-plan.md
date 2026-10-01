# Jadal — 12-Hour Build Plan

Status: DRAFT v0.1 (2026-10-01). Orchestrator: Claude Code. Workers: agy (Gemini 3.8 Flash) for research and setup; opencode `space-bunny-free` agents (10–20 in parallel) for implementation.

## Rules for every agent

1. Read `AGENTS.md`, `docs/problem-statement.md` and `docs/architecture/overview.md` before starting.
2. Work only inside your workstream's folder. Change `packages/contracts` only through the orchestrator.
3. One git worktree and branch per workstream: `ws/<id>-<slug>`. Small conventional commits. Open a PR to `main`; CI must pass.
4. The deterministic core has unit tests with worked numeric examples. No LLM calls inside `packages/core`.
5. Never invent agronomic or hydraulic constants. Use `docs/research/fao56-crop-tables.md` or mark them `ASSUMED` in code comments.

## Phase gates

| Phase | Hours | Exit gate |
| --- | --- | --- |
| P0 Contracts | 0:00–1:00 | `packages/contracts` merged: zod schemas for every entity, event and tool I/O; seed scenario JSON |
| P1 Parallel build | 1:00–6:00 | Each workstream merged with tests; deterministic core passes the worked examples |
| P2 Integration | 6:00–8:30 | End-to-end demo scenario runs on the deployed preview |
| P3 Showcase | 8:30–10:30 | Demo script, brag page, pitch deck, backup video recorded |
| P4 Freeze | 10:30–12:00 | Bug fixes only; rehearse twice |

## Workstreams (parallel after P0)

| ID | Workstream | Folder | Depends on | Agents |
| --- | --- | --- | --- | --- |
| W0 | Contracts + seed scenario | `packages/contracts` | — | Orchestrator + 1 |
| W1 | Crop-need engine (FAO-56) | `packages/core/crop` | W0, FAO-56 research | 1 |
| W2 | Canal hydraulics | `packages/core/hydraulics` | W0 | 1 |
| W3 | Roster optimizer + overrun impact | `packages/core/roster` | W0, W2 | 1 |
| W4 | Ledger, event log, policy rules | `packages/core/ledger` | W0 | 1 |
| W5 | API + persistence (D1) | `apps/api` | W0 | 2 |
| W6 | Agent layer: orchestrator, tools, prompts | `apps/api/agents` | W0, W5 | 2 |
| W7 | Voice caller (telephony + Telugu STT/TTS) + simulated phone | `apps/api/voice`, `apps/web/phone` | W6, voice research | 1–2 |
| W8 | WhatsApp notifier + acknowledgement | `apps/api/notify` | W6 | 1 |
| W9 | Farmer portal: registration, requests, buffer board | `apps/web/farmer` | W0, W5 | 1–2 |
| W10 | Coordinator console: approvals, roster, ledger | `apps/web/coordinator` | W0, W5 | 1–2 |
| W11 | Canal map + equal-hours vs equal-water visuals | `apps/web/viz` | W2, W3 | 1 |
| W12 | Demo mode: scenario runner + event replay | `apps/web/demo`, `scripts/` | W4, W5 | 1 |
| W13 | CI/CD + Cloudflare deploy | `.github/`, `wrangler.jsonc` | Cloudflare research | agy |
| W14 | Showcase: brag, pitch deck, video script | `showcase/` | brag research | 1 |
| W15 | QA: end-to-end tests, demo rehearsal checklist | `tests/e2e` | P2 | 1 |

## Critical path

W0 → W2 → W3 → W11, and W0 → W5 → W6 → W7. Voice is the riskiest piece, so the simulated phone (W7) is built first and real telephony is added only if time allows.

## Cut list (drop in this order if behind)

1. Real telephony (keep the simulated phone with real Telugu STT/TTS)
2. LP optimizer (keep greedy)
3. WhatsApp API (show the message in the simulated phone)
4. Penman-Monteith fallback (Open-Meteo ET₀ only)
5. Multi-canal support

## Open decisions

- ADR-001 Runtime stack (Cloudflare Workers + D1 + Durable Objects vs alternatives) — awaiting `docs/research/cloudflare-cicd.md`
- ADR-002 Language for the core (TypeScript vs Python) — tied to ADR-001
- ADR-003 Voice provider — awaiting `docs/research/voice-and-data.md`
- ADR-004 Agent framework (Cloudflare Agents SDK vs LangGraph vs hand-rolled tool loop) — awaiting `docs/research/deterministic-and-system1.md`
- ADR-005 Showcase tooling — awaiting `docs/research/brag.md`
