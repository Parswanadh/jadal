# Swarm run — 2026-10-02

Parallel build of the HANDOFF-ENGINEERING.md §5 items plus a launch video. Branch `integration/swarm-2026-10-02`
(forked from `integration/all` @ `live/2026-10-02`; the live tag and `integration/all` are untouched).

| Lane | Runner | Handoff item |
|---|---|---|
| triage-urgency | dsh · DeepSeek V4.1 Flash (opencode-go) | P2 constant triage score |
| laya-wiring | dsh | P3 Laya intent-only wiring |
| gini-planned | dsh | P4 planned vs delivered need-met / Gini |
| crop-reproduce | dsh | P5 groundnut example (ADR, no value changes) |
| cropparams-provenance | dsh | P6 crop-params provenance |
| climate-adjust | dsh | P7 climate adjustment (proposal patch, no contract edit) |
| placecall-guard | dsh | P8 place_call gating (static guard + proposal) |
| alerts-honesty | dsh | P9 SMS/WhatsApp not-sent labelling |
| ratelimit-sliding | dsh | P10 sliding-window rate limit |
| workflows-audit | dsh | P10 campaigns/workflows.ts audit |
| telugu-review-pack | dsh | P10 native-speaker review pack |
| video-capture / video-facts-script / video-motion / video-audio | agy · Gemini 3.8 Flash | video inputs (parallel) |
| video-final-brag → video-qa | agy (brag skill) | final video, then independent QA |

Not automatable (human): P1 Twilio balance, inbound number purchase, native Telugu review, contracts-ok decisions (P7/P8), P5 owner decision.

Rules: one writer per worktree (`jadal-w-<lane>`), explicit-path commits only, lanes merge only after typecheck + tests pass.
Orchestrator state is `.ref/orch/state.json` (gitignored); re-run `python3 .ref/orch/orch.py` to resume.
