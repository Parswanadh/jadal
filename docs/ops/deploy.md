# Jadal Deployment & Operations Runbook

**Service Name:** Jadal  
**Runtime:** Cloudflare Workers (Single Worker Architecture + Static Assets)  
**Compatibility Date:** 2026-10-01  

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
   - When secrets are present:
     1. Runs remote D1 database migrations: `wrangler d1 migrations apply jadal-db --remote`.
     2. Deploys Worker and static SPA bundle via `cloudflare/wrangler-action@v4`.

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

# Run unit tests across packages
pnpm test

# Build all packages and static assets
pnpm build

# Apply D1 migrations locally
wrangler d1 migrations apply jadal-db --local --config apps/api/wrangler.jsonc

# Run local development server (serves API and local static assets)
pnpm --filter api dev
```
