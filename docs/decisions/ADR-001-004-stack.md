# ADR-001 to ADR-004 — Stack decisions

Date: 2026-10-01 · Status: Accepted · Decider: orchestrator (Claude Code), based on `docs/research/*`.

## ADR-001 Runtime: Cloudflare, one Worker

**Decision.** A single Cloudflare Worker (Hono) serves the API and the static frontend (Workers static assets). Supporting services:
- **D1** for entities, the event log and the ledger. Each double entry is written atomically with `db.batch()`.
- **Workflows** for durable lifecycles: urgent and buffer requests, call campaigns with retries, and `step.sleep` while waiting for acknowledgements.
- **Queues** for outbound calls and messages.
- **Cron Triggers** for the nightly rain re-plan, the weekly roster and pre-release warnings.
- **KV** for the crop-table and weather cache.
- **AI Gateway** in front of every external model call, for logs, caching and cost.

**Why.** One deploy unit, no CORS, every binding in one place, and it all emulates locally with `wrangler dev`. Source: `docs/research/cloudflare-cicd.md`.

**Rejected.**
- Pages: Cloudflare now steers new projects to Workers with static assets.
- A Durable Object per canal: D1 batch transactions are enough for hackathon-scale write volumes. We revisit only if write contention appears.

## ADR-002 Language: TypeScript everywhere

**Decision.** pnpm monorepo, TypeScript strict. The deterministic core (`packages/core`) is pure TS with Vitest tests. The roster solver is a deterministic greedy algorithm with closed-form turn durations; `highs-js` (HiGHS compiled to WASM) is an optional upgrade.

**Why.** Python Workers have slow cold starts and friction with bindings. The equations involved (FAO-56, exponential seepage, Manning) are straightforward to write in TS.

**Rejected.** OR-Tools CP-SAT (Python only), which would need a separate service; it is overkill for one minor canal with roughly 8–20 outlets.

## ADR-003 Voice and messaging

**Decision.**
- Telugu speech uses **Sarvam AI**: `saaras` for speech-to-text and `bulbul` for text-to-speech.
- Dialogue uses an LLM through AI Gateway.
- The **primary demo vehicle is the in-browser simulated phone**, with real Sarvam audio.
- Real PSTN calls go through **Twilio Voice trial** to verified team numbers only, as a stretch goal.
- WhatsApp uses the **Twilio WhatsApp sandbox**. Its fallback is an in-app WhatsApp drawer.

**Why.** Indian carriers need company KYC and DLT registration, which can't be done in 12 hours. A Twilio trial can only call verified numbers. Judges must never see a failed call. Source: `docs/research/voice-and-data.md`.

**Rejected.** Exotel and Plivo (KYC), Vapi and Retell (weak Telugu), self-hosted AI4Bharat (devops risk). Bolna is deferred because it is a Python service; we keep the voice loop inside the Worker.

## ADR-004 Model layering: System 1 + System 2

> Amended by **ADR-006**: System 1 is now a provider chain (`SYSTEM1_PROVIDER`), Laya is the
> preferred primary (local Telugu-capable sidecar), and Jev is reached on OpenRouter's typed
> **Decisions API** with `typesafe/jev-1.13` — `typesafe/jev-router` is a chat-model router, not the
> decision model. See `docs/decisions/ADR-006-system1-providers.md`.

**Decision.**
- **Deterministic core:** all water numbers.
- **System 1** (fast, typed decisions):
  - **Jev** (`typesafe/jev-router` via OpenRouter) for request intent `choice`, urgency `score` and "is this a release-time question" `noul` decisions, called from the Worker over HTTP.
  - **Laya** (open-weight, Apache-2.0, multilingual checkpoint) is the offline fallback, runnable via ONNX.
  - A keyword-rule classifier is the last-resort fallback.
- **System 2** (agents): a frontier LLM via AI Gateway, using a hand-rolled tool loop in the Worker that runs inside Workflows steps. Tools are thin wrappers over `packages/core`.

**Why.** Jev and Laya return schema-bounded enums, scores and booleans that plug straight into the deterministic state machine. That is far cheaper and faster than prompting an LLM for JSON, and the outputs are calibrated. Both were verified to exist on 2026-10-01: HF `convaiinnovations/laya`, PyPI `laya`, GitHub `NandhaKishorM/laya`, OpenRouter `typesafe/jev-router`. Source: `docs/research/deterministic-and-system1.md`.

**Rejected.** LangGraph (Python-first; adds a service), and LLM-only triage (slow, uncalibrated).

**Open.** Laya's Telugu accuracy on agricultural phrasing must be smoke-tested in P1. If it is weak, translate Telugu → English with Sarvam before classifying.

## Manual steps for the user

1. Create a Cloudflare API token in the dashboard (Workers Scripts edit, D1 edit, Workers KV edit, Queues edit, Workflows edit, AI Gateway edit, Account read) and give it to the orchestrator. It is stored with `gh secret set CLOUDFLARE_API_TOKEN`, never committed.
2. Create a Sarvam AI API key, plus Twilio trial credentials if real calls are wanted.
3. Create an OpenRouter API key (for Jev and the System-2 LLM).
