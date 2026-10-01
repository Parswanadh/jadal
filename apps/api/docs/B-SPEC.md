# Task B — backend fan-out spec (authoritative for all agents)

Repo: `/home/parshu/projects/cis/jadal` · Issue: #2 · You own `apps/api/**` ONLY.
Never edit `packages/*` or `apps/web`. If a contract looks wrong, note it in your final report.

## Hard environment constraints (already discovered — do not re-litigate)

1. **NO NETWORK.** `npm`/`gh`/registry are unreachable. Do not try to install anything.
2. Available deps: `hono`, `zod`, `vitest`, `typescript`. **No** `@cloudflare/vitest-pool-workers`,
   no `miniflare`, no `wrangler`. Testing is via `vitest` + the SQLite D1 shim in `apps/api/test/`.
3. **`packages/core` is NOT implemented** (only `mmHaToCubicMeters`). The full deterministic core
   is being written into `apps/api/src/core/*` behind `apps/api/src/core-shim.ts`.
   Import core functions **only** via relative paths into `src/core/`. Never import `@jadal/core`.
4. No API keys exist. Every external call must work with fallbacks and be testable by injecting
   `env.fetch`. Tests must never touch the network.
5. `pnpm` auto-runs a deps check that hangs offline. Always use:
   `pnpm --config.verify-deps-before-run=false -r typecheck`

## Verifying your work

```bash
cd /home/parshu/projects/cis/jadal
pnpm --config.verify-deps-before-run=false --filter api test 2>&1 | tail -30
pnpm --config.verify-deps-before-run=false --filter api typecheck 2>&1 | tail -30
```

Both MUST be green before you report. Tests are the deliverable, not an afterthought.

## Non-negotiable engineering rules

- **`noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `strict`** are on. Array
  indexing yields `T | undefined` — handle it.
- **Never invent agronomic constants.** Take crop parameters from `src/core/crop-params.ts`
  (FAO-56, sourced from `docs/research/fao56-crop-tables.md`). Anything else gets
  `// ASSUMED: <reason>` inline.
- **Never do water arithmetic outside `src/core/`.** Routes and agents call core functions.
  If you need a number core doesn't provide, add it to `src/core/` and tell me in your report.
- **Validate every request body and every response against the zod schemas in
  `@jadal/contracts`** (`api.ts` → `routes.*.body` / `routes.*.response`). Tests must assert
  `routes.X.response.parse(body)` succeeds.
- **All state changes go through `appendEvent()`**, which writes the event, its projections and
  its ledger entries in ONE `db.batch()`. Never write to a projection table directly from a route.
- Telugu user-facing strings must be natural Telugu, not transliteration.
- No `any`. No non-null `!` assertions unless genuinely unavoidable (comment why).
- No console.log in library code (tests may use it).

## Writing tests

`apps/api/test/harness.ts` gives you:

```ts
import { createEnv, call, expectOk } from "../../test/harness";
const env = createEnv({ "api.open-meteo.com": { /* canned JSON */ } });
const res = await call(app, "POST", "/api/requests", { body: {...}, env });
```

- `createEnv(routes)` → `{ DB, CACHE, OUTBOUND, calls, fetch }`. Unmocked outbound fetch **throws**,
  which is how you prove a code path makes no network call without keys.
- `call(app, method, path, { body, env })` → `{ status, body, headers }`. `app` comes from the
  app factory (see below).
- Response-shape assertion: `expect(routes.health.response.parse(body)).toBeTruthy()`.

The app factory is `src/app.ts` → `export function createApp(): Hono<{ Bindings: Env }>`.
`src/index.ts` is the Worker entrypoint that wires it up. **Do not edit either** unless your
task list says you own them.

## Definition of done (every agent)

1. Own files created, full implementation, no TODOs, no placeholder returns.
2. Vitest tests covering the happy path, at least one failure path, and every fallback path.
3. `typecheck` green, `test` green.
4. Final report: files written, key decisions, anything you could not do and why.