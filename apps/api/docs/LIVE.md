# Running Jadal live, locally (B9)

The offline demo path needs nothing but `pnpm --filter api test`. This page is for the other mode: the
**real** Hono app on workerd, against a real local D1, with the telephony module mounted.

Nothing here places a phone call. `REAL_TELEPHONY` stays `false` and no Twilio credentials are needed;
`placeCall` then takes its `{ simulated: true }` branch and the browser phone remains the demo vehicle
(ADR-003). Real calls need a public HTTPS origin for Twilio's webhooks — see ADR-005 §"Webhooks in
local development".

## 0. Prerequisite: wrangler

Every command below shells out to the `wrangler` CLI (`pnpm migrate:local`, `pnpm dev:live`,
`pnpm deploy`). It is declared as a devDependency of `apps/api`, so `pnpm install` from the repo root
puts it on the workspace path — no global install is required. If you prefer a global CLI, install a
v4 release (`npm i -g wrangler@^4`) and make sure it is the same major version the lockfile pins;
mixing a global v3 with this project's config will fail. This page was written against wrangler
4.114.0.

## 1. API

```bash
cd apps/api
pnpm migrate:local          # wrangler d1 migrations apply jadal-db --local
pnpm dev:live               # wrangler dev --local on http://127.0.0.1:8788
```

`dev:live` is the plain `wrangler dev` plus four local-only overrides, each of which has a reason:

| Override | Why |
| --- | --- |
| `--port 8788` | Port 8787 is held by an unrelated `event-manage` wrangler. |
| `--assets ./test/live-assets` | `wrangler.jsonc` serves `../web/dist`, which only exists after a web build. The live suite is an API suite, so it points the `ASSETS` binding at a placeholder instead of depending on `apps/web`. |
| `--var DEMO_MODE:1 --var ENVIRONMENT:development` | `wrangler.jsonc` declares `ENVIRONMENT: "production"`, and `demoEnabled` always refuses to wipe a production database. Without this, `POST /api/demo/reset` correctly answers `{ "ok": false }`. |
| `--var SKIP_TWILIO_SIGNATURE:1` | Lets the Twilio webhooks be replayed from curl or Playwright without a signature. **Local only** — ADR-005 forbids it on a deployed Worker. |
| `--compatibility-date 2026-07-29` | `wrangler.jsonc` declares `2026-10-01`, which is newer than the workerd binary bundled with the wrangler installed on the build laptop (4.114.0) accepts. The override is a local workaround for an old toolchain, not a config change; a newer wrangler runs the declared date as-is. |

Then:

```bash
curl -X POST http://127.0.0.1:8788/api/demo/reset -H 'content-type: application/json' -d '{}'
curl http://127.0.0.1:8788/api/farmers
```

## 2. Web, against the live API

`apps/web` is owned by another lane; this is the command to run it against the live API, not a change
to it:

```bash
VITE_MOCK=0 VITE_API_BASE=http://127.0.0.1:8788 pnpm --filter web dev
```

## 3. The live suite

```bash
pnpm e2e:live
```

Starts the API itself (`pnpm --filter api dev:live`) and runs `tests/e2e/live/**` against it. The
suite is API-only — no browser is launched — and serial, because every test shares one live database.
It resets the demo, walks the read surface, approves a roster, then drives the mounted telephony
webhooks (`twiml` → `gather` with DTMF `1`) so the acknowledgement is written through the real store.
Its last test asserts that no contact was ever marked `sent` or `failed`, i.e. that nothing dialled.

`pnpm e2e` (the UI suite) is unaffected: it ignores `live/**` and starts only the web dev server.

## 4. `TWILIO_FORWARD_TO` (real calls only)

The seeded farmers carry placeholder Mobiles (`+9190000000xx`) that cannot receive a real call, so a
live demo that dials a farmer would ring a dead number. `TWILIO_FORWARD_TO` overrides the destination:
set it to one or more real E.164 numbers, comma-separated, and outbound calls are routed to one of
them. With more than one target the same recipient always maps to the same handset (a stable hash of
the original number), so a demo is repeatable. Entries that are not `+` followed by 8–15 digits are
ignored.

Only *who is dialled* changes: the TwiML, the spoken message and the contact the call is attributed
to still belong to the original farmer. Unset (the default) keeps normal production behaviour and
dials the farmer's own number. It has no effect unless `REAL_TELEPHONY=true` with a full Twilio
credential set, so leave it empty for the offline and simulated-phone paths. See
`apps/api/.dev.vars.example` for the variable itself.
