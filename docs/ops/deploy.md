# Jadal Deployment & Operations Runbook

**Service Name:** Jadal  
**Runtime:** Cloudflare Workers (Single Worker Architecture + Static Assets)  
**Compatibility Date:** 2026-10-01  

---

## 0. Deployment Status (verified 2026-10-03)

**Live Worker:** https://jadal.balchaparshu.workers.dev

| Check | Result |
| :--- | :--- |
| `GET /api/health` | `200` `{"ok":true,"version":"0.1.0"}` — Worker up |
| `GET /api/canal` | `404` `{"error":{"code":"canal_not_found","message":"no canal c1"}}` — route reachable, remote D1 has no seeded canal |
| `GET /api/farmers` | `200` `[]` — route reachable, remote D1 has no seeded farmers |

`wrangler deployments list` (run from `apps/api`) shows two deployments on 2026-10-03:

| Created (UTC) | Version |
| :--- | :--- |
| `2026-10-03T15:16:08Z` | `41ad0ddf-43bc-43b6-a9b4-e27f9cd29263` |
| `2026-10-03T15:19:57Z` | `c86228d5-d627-4420-9d8d-8bd98c23e27f` (current) |

The Worker is serving traffic and every probed route responds with the contract's `ApiError`/JSON
shape. The empty `/api/canal` and `/api/farmers` bodies are the expected consequence of the remote D1
migration/seed step never having run (PENDING-FEATURES §2.5): the routes work, the database has no
rows. Populate it with:

```bash
wrangler d1 migrations apply jadal-db --remote --config apps/api/wrangler.jsonc
```

---

## 1. Cloudflare Resources & Identifiers

All production resources have been provisioned in the Cloudflare APAC region. These identifiers are non-secret and committed in `apps/api/wrangler.jsonc`:

| Resource Type | Resource Name / Title | Binding | Identifier / Details |
| :--- | :--- | :--- | :--- |
| **Cloudflare Account** | `Balchaparshu@gmail.com's Account` | — | `b1e1983c78c805e6003f18ee813b2dbd` |
| **Worker Script** | `jadal` | — | Deployed to `workers.dev` |
| **D1 Database** | `jadal-db` | `DB` | `2d6a9557-c9f8-4536-b723-26a64380078c` |
| **KV Namespace** | `CACHE` | `CACHE` | `7db113dec0114f389553f674580a79a5` |
| **Message Queue** | `jadal-outbound` | `OUTBOUND` | Producer & Consumer enabled |
| **Cron Trigger** | Nightly Re-plan | — | `30 0 * * *` (06:00 IST / 00:30 UTC daily) |
| **Static Assets** | Vite + React SPA | `ASSETS` | Source: `apps/web/dist`, SPA fallback |

---

## 2. CI/CD Architecture

Jadal uses GitHub Actions with two automated pipelines:

1. **Pull Request & Branch CI (`.github/workflows/ci.yml`)**:
   - Triggers on pull requests and pushes to `main`.
   - Sets up Node 24 and `pnpm`.
   - Runs `pnpm typecheck`, `pnpm test` (including Vitest unit tests in `packages/core`), and `pnpm build`.

2. **Continuous Deployment (`.github/workflows/deploy.yml`)**:
   - Triggers on push to `main`.
   - Executes verification gates (`typecheck`, `test`, `build`).
   - Checks for the presence of `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
   - **Graceful Skip:** If secrets are not configured in GitHub repository settings, the deploy job is cleanly skipped without failing the pipeline.
   - When secrets are present, runs the same single deploy entry point used locally: `pnpm run deploy`
     (which applies remote D1 migrations via `pnpm --filter api run migrate:remote` and then runs
     `wrangler deploy` in `apps/api`).

---

## 3. Manual Steps for the User

Follow these exact steps to activate automated GitHub Actions deployments:

### Step 1: Create Custom Cloudflare API Token
1. Open the [Cloudflare Dashboard API Tokens Page](https://dash.cloudflare.com/profile/api-tokens).
2. Click **Create Token** &rarr; **Create Custom Token**.
3. Name: `jadal-github-actions`.
4. Grant the following permissions:
   - `Account` &bull; `Workers Scripts` &bull; `Edit`
   - `Account` &bull; `D1` &bull; `Edit`
   - `Account` &bull; `Workers KV Storage` &bull; `Edit`
   - `Account` &bull; `Workers Queues` &bull; `Edit`
   - `Account` &bull; `Account Settings` &bull; `Read`
   - `User` &bull; `User Details` &bull; `Read`
5. Under **Account Resources**, select: `Include` &rarr; `Balchaparshu@gmail.com's Account`.
6. Click **Continue to summary** &rarr; **Create Token**.
7. Copy the generated token string.

### Step 2: Configure GitHub Repository Secrets
Run the following commands using the GitHub CLI (`gh`):

```bash
# 1. Set the Cloudflare Account ID
gh secret set CLOUDFLARE_ACCOUNT_ID --body b1e1983c78c805e6003f18ee813b2dbd

# 2. Set the Cloudflare API Token (paste token when prompted or pass via stdin)
gh secret set CLOUDFLARE_API_TOKEN
```

---

## 4. Local Development & Emulation

```bash
# Install workspace dependencies
pnpm install

# Run the full local gate (typecheck + test + build)
pnpm verify

# Apply D1 migrations locally
pnpm --filter api migrate:local

# Deploy to Cloudflare (applies remote migrations, then deploys)
pnpm run deploy

# Run local development server (serves API and local static assets)
pnpm --filter api dev
```

---

## 5. Laya Sidecar (Local Python Service)

The Laya sidecar is a local HTTP service that provides System-1 decisions for the Jadal Worker.
It is **not** part of the pnpm workspace — it is a standalone Python service with its own
virtual environment and dependencies.

### Why it's not in the pnpm workspace

The pnpm workspace (`pnpm-workspace.yaml`) only includes `packages/*` and `apps/*`, which are
Node.js packages. `services/laya` is a Python service with no `package.json`, so it cannot be
added to the pnpm workspace. It is managed independently with its own `requirements.txt` and
virtual environment.

### Local Setup

```bash
cd services/laya

# Create a virtual environment that reuses the host interpreter's torch/transformers
python -m venv --system-site-packages .venv

# Install only laya (torch/transformers already present in host interpreter)
.venv/bin/pip install --no-deps -r requirements.txt

# Or for a clean-room install (downloads all dependencies):
# .venv/bin/pip install -r requirements.txt
```

### Running the Service

```bash
cd services/laya
.venv/bin/python laya_service.py
# [laya] listening on http://127.0.0.1:8099
```

The service loads the model once at startup. It is called by the Jadal Worker when it has no
Jev key or wants an offline tier.

### Running Tests

```bash
cd services/laya
.venv/bin/python -m unittest test_jadal_decision test_service_http
```

The unit tests do not require a running model — they use a stubbed Laya agent.

### CI Integration

The Laya sidecar has its own CI jobs in `.github/workflows/ci.yml`:

| Job | What it does |
| :--- | :--- |
| `laya-tests` | Runs `python -m unittest test_jadal_decision test_service_http` |
| `laya-syntax` | Runs `python -m py_compile services/laya/*.py` |

These jobs use Python 3.12 and do not require any Node.js or pnpm setup.
