# Cloudflare Deployment & CI/CD Research: Project Jadal

**Project:** Jadal (Warabandi-style Canal Irrigation Management & Agentic AI, IEEE-CIS Hackathon)  
**Author:** AI Pair Programmer  
**Date:** October 2026  
**Status:** Recommended & Decision-Oriented Research Document  

---

## 1. Executive Summary & Recommendations (Decisions First)

For a fast-paced 12-hour hackathon building an agentic canal irrigation system with Telugu farmer notifications, canal physics, and a volume ledger, speed of iteration, zero-headache local emulation, and deterministic deployments are paramount.

### Core Architecture & CI/CD Decisions

| Decision Area | Recommendation | Primary Rationale |
| :--- | :--- | :--- |
| **CI/CD Pipeline** | **GitHub Actions** (`cloudflare/wrangler-action@v4`) | Workers Builds requires dashboard clicking and lacks pre-deploy migration hooks. GitHub Actions is 100% automated via `gh` CLI once an API token is created. |
| **Frontend & API Layer** | **Unified Cloudflare Worker (Hono) + Static Assets** | Avoids legacy Cloudflare Pages split. Zero CORS issues, shared bindings (`c.env.DB`, `c.env.AI`, `c.env.WORKFLOWS`), and instant static asset delivery via `"assets": { "directory": "./public" }`. |
| **Ledger (Source of Truth)** | **Cloudflare D1** (`@cloudflare/d1`) | Edge SQLite database providing ACID transactions for water entitlement credits/debits, farmer registrations, and audit logs. |
| **Caching & Reference Data**| **Cloudflare KV** | Sub-15ms edge lookups for FAO-56 crop coefficients ($K_c$), weather forecast cache, and farmer call idempotency locks. |
| **Agent Orchestration** | **Cloudflare Workflows (`cloudflare:workflows`) + Queues** | Native durable execution with `step.sleep()` for waiting on Telugu voice call acknowledgements and handling multi-step retries without burning CPU time. |
| **Scheduled Tasks** | **Cron Triggers (`triggers.crons`)** | Scheduled worker triggers for nightly weather/rain re-planning and Sunday Warabandi weekly roster publishing. |
| **AI Inference & Routing** | **Workers AI + Cloudflare AI Gateway** | Run `@cf/meta/llama-3.3-70b-instruct` and Whisper directly on Cloudflare edge GPUs for zero latency; route external LLM/TTS calls through AI Gateway for caching and cost control. |
| **Physics & FAO-56 Engine** | **Pure TypeScript (in Worker)** | Implement canal seepage, lag equations, and FAO-56 formulas in TypeScript. Python Workers incur severe cold starts (Pyodide Wasm memory initialization) and FFI friction with Cloudflare bindings. |

---

## 2. CI/CD & Deployment Options Comparison

We evaluated the three deployment methods supported by Cloudflare:
1. **Cloudflare Workers Builds (Native Git Integration)** ([Docs: Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/))
2. **GitHub Actions with `cloudflare/wrangler-action@v4`** ([GitHub: wrangler-action](https://github.com/cloudflare/wrangler-action))
3. **Cloudflare Pages (Git Integration vs Direct Upload)** ([Docs: Pages Deployment Methods](https://developers.cloudflare.com/pages/get-started/direct-upload/))

### Side-by-Side Comparison Matrix

| Dimension | (a) Workers Builds | (b) GitHub Actions + `wrangler-action` *(Recommended)* | (c) Cloudflare Pages |
| :--- | :--- | :--- | :--- |
| **CLI Setup vs Dashboard** | **Dashboard Only** (OAuth/GitHub App linking required in UI) | **CLI-driven** via `gh secret set` (Single 60s Dashboard token creation) | **Dashboard** for Git; **CLI** for Direct Upload (`wrangler pages deploy`) |
| **Pre-deploy Migrations** | ❌ Hard (No native pre-deploy hook for `wrangler d1 migrations apply`) | ✅ Native (Run migration step before `wrangler deploy` in YAML) | ⚠️ Clunky (Pages Functions require separate D1 binding configuration) |
| **Typecheck & Tests** | Optional in build script, but failures abort without rich GH PR annotations | ✅ Native (`npm run test`, `tsc --noEmit` run before deploy) | Similar to Workers Builds |
| **Bindings Support** | Supports all bindings defined in `wrangler.jsonc` | Supports all bindings defined in `wrangler.jsonc` | Pages Functions lag behind Workers (e.g. Workflows need Service Bindings) |
| **Private Repo Support** | Supported via Cloudflare GitHub App | Native via repository secrets | Supported via Cloudflare GitHub App |
| **Suitability for 12h Hackathon** | Medium (GUI configuration takes time, lacks pipeline control) | **Highest** (Full control, test gates, automated migration + deploy) | Low (Legacy architecture; unified Workers Assets is preferred) |

### Why GitHub Actions Wins for Jadal
1. **D1 Migration Automation:** Jadal requires relational schema setup (farmers, crops, turns, ledger transactions). GitHub Actions can run `wrangler d1 migrations apply jadal-db --remote` immediately before deploying code. Workers Builds cannot cleanly orchestrate database migrations against remote D1 before script activation.
2. **Deterministic Quality Gate:** You can enforce Vitest tests on the canal physics model and FAO-56 formulas before code hits production.
3. **CLI Ergonomics:** The user already has `gh CLI` authenticated to `Parswanadh/jadal`. Once a Cloudflare token is created, secrets can be injected directly from the terminal without touching the GitHub Web UI.

---

## 3. CLI vs Dashboard Setup & Token Scope Breakdown

### What Can Be Done From the CLI
- ✅ Setting GitHub repository secrets via `gh secret set`.
- ✅ Creating local D1 databases and generating migration files (`wrangler d1 create`, `wrangler d1 migrations create`).
- ✅ Creating KV namespaces (`wrangler kv namespace create`).
- ✅ Creating Queues (`wrangler queues create`).
- ✅ Deploying manually during rapid prototyping (`wrangler deploy`).
- ✅ Running end-to-end local emulation (`wrangler dev`).

### What MUST Be Done Manually in the Cloudflare Dashboard
- ❌ **Creating the Cloudflare API Token:** Cloudflare does **not** provide a CLI command or public endpoint to generate user API tokens without pre-existing admin authorization. Tokens must be created in the [Cloudflare Dashboard API Tokens section](https://dash.cloudflare.com/profile/api-tokens).
- ❌ **AI Gateway Creation (Optional GUI Step):** While default AI Gateway instances can auto-initialize, customizing guardrails or viewing visual logs is easiest via **AI > AI Gateway** in the dashboard.
- *(Note on Workers Builds / Pages Git):* If either option (a) or (c-Git) were chosen, authorizing the Cloudflare GitHub App and selecting the repository **must** be done via the Cloudflare Dashboard UI ([Source: Workers Builds Configuration](https://developers.cloudflare.com/workers/ci-cd/builds/)).

### Required Cloudflare API Token Scopes
When creating the API Token under **My Profile > API Tokens > Create Custom Token**, grant the following permissions:

| Permission Group | Scope Level | Access Level | Purpose |
| :--- | :--- | :--- | :--- |
| **Account > Workers Scripts** | Account | **Edit** | Upload and deploy Worker code |
| **Account > D1** | Account | **Edit** | Apply D1 schema migrations & query ledger |
| **Account > Workers KV Storage** | Account | **Edit** | Provision and read/write KV caches |
| **Account > Workers Queues** | Account | **Edit** | Create & configure message queues |
| **Account > Workers AI** | Account | **Edit** / **Run** | Execute local inference (Llama, Whisper) |
| **Account > Account Settings** | Account | **Read** | Validate Account ID and settings |
| **User > User Details** | User | **Read** | Authenticate token ownership |

> [!TIP]
> In the dashboard, you can start from the **"Edit Cloudflare Workers"** template, which includes Workers Scripts and KV permissions, and add **D1 (Edit)**, **Workers Queues (Edit)**, and **Workers AI (Edit/Run)**.

---

## 4. Recommended Cloudflare-Native Stack for Jadal

```
                  ┌──────────────────────────────────────────────┐
                  │           Farmer / Coordinator UI            │
                  │   (HTML/Tailwind/React in Workers Assets)    │
                  └──────────────────────┬───────────────────────┘
                                         │ HTTPS Fetch
                                         ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   Unified Cloudflare Worker (Hono)                     │
│                                                                        │
│   ├── /api/farmers, /api/entitlements, /api/urgent, /api/buffer        │
│   ├── Canal Physics Engine (Manning's equation + seepage lag in TS)   │
│   └── FAO-56 Crop Evapotranspiration Calculator (in TS)                │
└───┬─────────────┬──────────────┬─────────────┬─────────────┬───────────┘
    │             │              │             │             │
    ▼             ▼              ▼             ▼             ▼
┌───────┐     ┌───────┐     ┌───────────┐ ┌─────────┐   ┌─────────────┐
│  D1   │     │  KV   │     │ Workflows │ │ Queues  │   │ Workers AI  │
│ Ledger│     │ Cache │     │ Orchestr. │ │ Callers │   │ & Gateway   │
└───────┘     └───────┘     └─────┬─────┘ └────┬────┘   └──────┬──────┘
                                  │            │               │
                                  └────────────┼───────────────┘
                                               ▼
                                  ┌─────────────────────────┐
                                  │ External Voice/SMS APIs │
                                  │ (Twilio / Sarvam AI)    │
                                  └─────────────────────────┘
```

### 1. Frontend & API Layer: Hono on Workers with Static Assets
- **Technology:** [Hono](https://hono.dev/) running in a standard Cloudflare Worker, paired with Workers Static Assets (`"assets": { "directory": "./public" }`).
- **Why Not Pages?** Cloudflare has unified Pages into Workers ([Docs: Static Assets](https://developers.cloudflare.com/workers/static-assets/)). Workers Static Assets allows serving SPA/static assets and backend API endpoints from a single `wrangler.jsonc`. This eliminates CORS issues and lets frontend API calls use relative paths (`/api/...`).

### 2. Ledger & Source of Truth: Cloudflare D1
- **Technology:** [Cloudflare D1](https://developers.cloudflare.com/d1/) (Serverless relational SQLite).
- **Role in Jadal:**
  - `farmers`: Registration data (name, phone, village, outlet ID, canal chainage $km$, soil type).
  - `crops`: Sowing dates, crop type, acreage per farmer.
  - `weekly_roster`: Scheduled Warabandi turns (start timestamp, end timestamp, flow rate $Q$, planned volume $m^3$).
  - `volume_ledger`: Double-entry audit ledger tracking entitlements, urgent quota draws, buffer additions, and actual delivered water volume.
- **Why D1?** ACID compliance prevents double-allocation of water turns. SQLite support allows immediate local testing via `wrangler d1 execute --local`.

### 3. Caching & Fast Lookup: Cloudflare KV
- **Technology:** [Cloudflare Workers KV](https://developers.cloudflare.com/kv/).
- **Role in Jadal:**
  - Static lookup tables: FAO-56 reference parameters ($K_{c\text{ ini}}$, $K_{c\text{ mid}}$, $K_{c\text{ end}}$ for paddy, cotton, maize, groundnut, chillies).
  - Weather API response cache (e.g. Open-Meteo rainfall forecasts) to avoid third-party rate limits.
  - Call acknowledgement idempotency tokens.

### 4. Agent Orchestration: Cloudflare Workflows + Queues + Cron Triggers
- **Cloudflare Workflows (`cloudflare:workflows`):**
  - Durable, multi-step execution engine ([Docs: Workflows](https://developers.cloudflare.com/workflows/)).
  - **Jadal Agentic Flow:**
    1. `step.do("fetch-turn-details")`: Get farmers scheduled for upcoming night irrigation.
    2. `step.do("generate-telugu-script")`: Call Workers AI to tailor the Telugu voice alert.
    3. `step.do("dispatch-voice-call")`: Trigger outbound phone call or WhatsApp message.
    4. `step.sleep("wait-for-ack", "15 minutes")`: **Durable sleep** without holding CPU or server connections.
    5. `step.do("check-acknowledgement")`: Verify if farmer pressed '1' or replied on WhatsApp. If unacknowledged, escalate with backup warning call.
    6. `step.do("record-ledger-audit")`: Commit delivery receipt to D1 ledger.
- **Cloudflare Queues (`queues`):**
  - Smooth out spikes in outbound phone calls so telephony rate limits are not exceeded ([Docs: Queues](https://developers.cloudflare.com/queues/)).
- **Cron Triggers (`triggers.crons`):**
  - `0 18 * * 0` (Sunday 18:00): Triggers weekly Warabandi roster generation.
  - `0 4 * * *` (Daily 04:00): Checks rain gauges/forecasts for schedule re-planning and buffer recalculation.

### 5. AI Layer: Workers AI & Cloudflare AI Gateway
- **Workers AI (`env.AI`):**
  - Run `@cf/meta/llama-3.3-70b-instruct` or `@cf/meta/llama-3.1-8b-instruct` for fast prompt-based extraction of unformatted farmer voice notes into structured JSON requests ([Docs: Workers AI Models](https://developers.cloudflare.com/workers-ai/models/)).
  - Run `@cf/openai/whisper` for transcribing farmer voice messages.
- **AI Gateway:**
  - Routes external LLMs (e.g. Gemini 1.5 Flash, Anthropic Claude) and specialized Indian voice APIs (e.g., Sarvam AI or Bhashini for Telugu text-to-speech) ([Docs: AI Gateway](https://developers.cloudflare.com/ai-gateway/)).
  - Provides request caching, automatic retries, and real-time observability logs to present to hackathon judges.

---

## 5. Python Workers vs TypeScript for Physics & FAO-56

A critical architecture question for Jadal is where to execute the canal hydraulics model (Manning's open-channel flow, seepage attenuation, and travel lag) and the FAO-56 crop water requirement calculations.

### Technical Comparison

| Factor | Cloudflare Python Workers | Pure TypeScript in Worker *(Recommended)* |
| :--- | :--- | :--- |
| **Runtime Architecture** | Pyodide compiled to WebAssembly inside V8 isolate ([Docs: Python Workers](https://developers.cloudflare.com/workers/languages/python/)) | Native V8 isolate execution |
| **Cold Start Latency** | **High** (~1.5s to 3s snapshot decompression) | **Near zero** (<5ms) |
| **Binding Ergonomics** | Clunky Foreign Function Interface (FFI) (`from js import env`) | Native type-safe access (`c.env.DB`, `c.env.AI`) |
| **Workflow Support** | Python Workflows SDK is experimental / limited | Fully native (`WorkflowEntrypoint` class) |
| **Package Constraints** | Requires pure Python or Pyodide Wasm wheels via `micropip` | Standard NPM packages or pure mathematical functions |
| **Bundle Size** | Multi-megabyte wasm bundle upload | Few kilobytes |
| **Hackathon Risk** | High risk of debugging Pyodide FFI/Wasm binding errors | Zero runtime surprises; instant unit testing with Vitest |

### Mathematical Feasibility in TypeScript
The canal physics required for a Warabandi prototype does **not** require heavy 3D hydrodynamics or SciPy solvers. It consists of closed-form empirical hydraulic equations:
1. **Canal Travel Lag:** $t_{\text{lag}} = \frac{L}{v}$, where velocity $v$ is obtained from Manning's formula:
   $$v = \frac{1}{n} R^{2/3} S^{1/2}$$
2. **Seepage Loss:** Moritz empirical loss formula:
   $$S = C \cdot \sqrt{Q} \cdot L$$
   Delivered flow at tail outlet: $Q_{\text{tail}} = Q_{\text{head}} - S$.
3. **Turn Duration Conversion:**
   $$\text{Duration (seconds)} = \frac{\text{Field Volume Entitlement } (m^3)}{Q_{\text{tail}} (m^3/s)}$$
4. **FAO-56 Evapotranspiration:**
   $$ET_c = K_c \times ET_0, \quad I_{\text{net}} = \max(0, ET_c - P_{\text{effective}})$$

These equations take under **150 lines of clean, testable TypeScript**. Writing them in TypeScript eliminates cold starts, simplifies bindings, and allows running calculations inline inside Hono request handlers or Workflows.

---

## 6. Sample Configuration Files

### Sample `wrangler.jsonc`

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "jadal-backend",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],

  // Static Assets for Frontend Portal (Farmer Registration & Coordinator UI)
  "assets": {
    "directory": "./public",
    "binding": "ASSETS"
  },

  // D1 Database Binding for the Warabandi Volume Ledger
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "jadal-db",
      "database_id": "REPLACE_WITH_D1_DATABASE_ID",
      "migrations_dir": "migrations"
    }
  ],

  // KV Namespace Binding for Weather Cache & FAO-56 Reference Data
  "kv_namespaces": [
    {
      "binding": "CACHE_KV",
      "id": "REPLACE_WITH_KV_NAMESPACE_ID"
    }
  ],

  // Durable Workflows for Multi-Step AI Phone Calls & Acknowledgements
  "workflows": [
    {
      "name": "farmer-notifier-workflow",
      "binding": "NOTIFIER_WORKFLOW",
      "class_name": "FarmerNotifierWorkflow"
    }
  ],

  // Cloudflare Queues for Asynchronous Telephony Dispatch
  "queues": {
    "producers": [
      {
        "binding": "CALL_QUEUE",
        "queue": "jadal-call-dispatch"
      }
    ],
    "consumers": [
      {
        "queue": "jadal-call-dispatch",
        "max_batch_size": 5,
        "max_batch_timeout": 10
      }
    ]
  },

  // Workers AI Binding for Local Llama 3.3 & Whisper Inference
  "ai": {
    "binding": "AI"
  },

  // Cron Triggers for Nightly Rain Re-Planning & Weekly Roster Recalculation
  "triggers": {
    "crons": [
      "0 4 * * *",  // Daily 04:00 UTC: Weather sync & rain re-planning
      "0 18 * * 0"  // Sunday 18:00 UTC: Warabandi weekly schedule publication
    ]
  },

  // Observability & Real-Time Logs for Hackathon Demos
  "observability": {
    "enabled": true
  }
}
```

---

### Sample GitHub Actions Workflow (`.github/workflows/deploy.yml`)

```yaml
name: Deploy Jadal to Cloudflare

on:
  push:
    branches:
      - main
  pull_request:
    branches:
      - main
  workflow_dispatch:

jobs:
  test-and-deploy:
    runs-on: ubuntu-latest
    name: Build, Verify & Deploy
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'

      - name: Install Dependencies
        run: npm ci

      - name: Typecheck TypeScript
        run: npx tsc --noEmit

      - name: Run Unit Tests (Canal Physics & FAO-56)
        run: npm run test --if-present

      - name: Build Frontend Static Assets
        run: npm run build --if-present

      # Apply D1 migrations before deploying application code
      - name: Apply D1 Database Migrations
        if: github.ref == 'refs/heads/main'
        uses: cloudflare/wrangler-action@v4
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: d1 migrations apply jadal-db --remote

      # Deploy Worker, Workflows, Queues, and Static Assets
      - name: Deploy Worker to Cloudflare
        if: github.ref == 'refs/heads/main'
        uses: cloudflare/wrangler-action@v4
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy
```

---

## 7. Step-by-Step CLI Runbook

Use these exact commands in your terminal. **No dashboard needed for repository secrets.**

### Step 1: Provision Cloudflare Resources via Wrangler CLI
Your account ID is `b1e1983c78c805e6003f18ee813b2dbd`.

```bash
# 1. Create D1 database for the volume ledger
npx wrangler d1 create jadal-db
# Copy the returned `database_id` into wrangler.jsonc

# 2. Create initial D1 migration file
npx wrangler d1 migrations create jadal-db init_ledger_schema

# 3. Create KV namespace for FAO-56 crop tables & weather cache
npx wrangler kv namespace create CACHE_KV
# Copy the returned `id` into wrangler.jsonc

# 4. Create Queue for telephony call buffering
npx wrangler queues create jadal-call-dispatch
```

### Step 2: Configure GitHub Repository Secrets via `gh` CLI
Since `gh` is authenticated to `Parswanadh/jadal`:

```bash
# Set Cloudflare Account ID
gh secret set CLOUDFLARE_ACCOUNT_ID --body "b1e1983c78c805e6003f18ee813b2dbd"

# Set Cloudflare API Token (generated in Step 8 below)
gh secret set CLOUDFLARE_API_TOKEN --body "YOUR_CLOUDFLARE_API_TOKEN"
```

### Step 3: Local Development & Testing
```bash
# Generate types for all bindings (D1, KV, AI, Workflows, Queues)
npx wrangler types

# Run local development with simulated D1 and KV
npx wrangler dev
```

---

## 8. What the User Must Do Manually (Dashboard Checklist)

This takes less than 2 minutes in the browser:

1. **Create the Cloudflare API Token (One-time, 60 seconds):**
   - Go to [Cloudflare Dashboard > My Profile > API Tokens](https://dash.cloudflare.com/profile/api-tokens).
   - Click **Create Token** > **Create Custom Token**.
   - Name: `jadal-ci-cd-token`.
   - Permissions:
     - `Account` | `Workers Scripts` | `Edit`
     - `Account` | `D1` | `Edit`
     - `Account` | `Workers KV Storage` | `Edit`
     - `Account` | `Workers Queues` | `Edit`
     - `Account` | `Workers AI` | `Edit` (or `Run`)
     - `Account` | `Account Settings` | `Read`
     - `User` | `User Details` | `Read`
   - Account Resources: Include `Balchaparshu@gmail.com's Account`.
   - Click **Continue to summary** > **Create Token**.
   - Copy the token string and run:
     ```bash
     gh secret set CLOUDFLARE_API_TOKEN --body "<PASTE_TOKEN_HERE>"
     ```

2. **(Optional) Enable AI Gateway in Dashboard:**
   - Go to **AI > AI Gateway** in the dashboard.
   - Click **Create Gateway** and name it `jadal-gateway`.
   - This provides real-time latency, request count, and token cost graphs for the hackathon presentation.

---

## 9. Verification & Reference Citations

All architectural recommendations and configuration keys in this document were verified against live Cloudflare developer specifications:
- [Cloudflare Workers Configuration Schema](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare Workers Static Assets Documentation](https://developers.cloudflare.com/workers/static-assets/)
- [Cloudflare Workflows Documentation & Binding API](https://developers.cloudflare.com/workflows/)
- [Cloudflare D1 Reference & Migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Cloudflare Queues Configuration](https://developers.cloudflare.com/queues/)
- [Cloudflare Workers AI Documentation](https://developers.cloudflare.com/workers-ai/)
- [Cloudflare AI Gateway Setup](https://developers.cloudflare.com/ai-gateway/)
- [Cloudflare Python Workers Constraints & Pyodide Model](https://developers.cloudflare.com/workers/languages/python/)
- [Cloudflare Wrangler Action v4 on GitHub](https://github.com/cloudflare/wrangler-action)
