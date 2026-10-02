# Running Jadal live, locally (B9)

The offline demo path needs nothing but `pnpm --filter api test`. This page is for the other mode: the
**real** Hono app on workerd, against a real local D1, with the telephony module mounted.

Nothing here places a phone call. `REAL_TELEPHONY` stays `false` and no Twilio credentials are needed;
`placeCall` then takes its `{ simulated: true }` branch and the browser phone remains the demo vehicle
(ADR-003). Real calls need a public HTTPS origin for Twilio's webhooks — see ADR-005 §"Webhooks in
local development".

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

## 4. System-1 / Laya

`SYSTEM1_PROVIDER` (unset => `auto`) selects the classifier chain: `laya -> jev -> rules` for
`auto` and for an explicit `laya`, `jev -> laya -> rules` for `jev`, and `rules` alone for `rules`.
`rules` never touches the network. Whatever answers, the decision carries `source=laya|jev|rules`,
so a fallback is never reported as a model call.

Laya is a **local sidecar** (`services/laya`, `POST /decide`), so it is not reachable through the
Cloudflare AI Gateway and is never gateway-prefixed. With `LAYA_ENDPOINT` unset the chain records
`not_configured` for Laya and lands on Jev/rules every time. To enable it, put the sidecar URL in
`apps/api/.dev.vars` (gitignored) — `wrangler dev` reads that file automatically, so `pnpm dev:live`
needs no extra flag:

```dotenv
# a name and a local placeholder, never a secret
LAYA_ENDPOINT=http://127.0.0.1:8099/decide
# optional; unset => 4000 ms, clamped to 100..15000
LAYA_TIMEOUT_MS=
```

`LAYA_ENDPOINT` is parsed by `layaEndpoint()` in `src/env.ts`: blank, unparseable or non-`http(s)`
values are treated as **unset** (reason `not_configured`) rather than attempted, so a typo cannot
hide behind a network-sounding `transport_error`. A trailing slash is trimmed, so
`http://127.0.0.1:8099/decide/` and `http://127.0.0.1:8099/decide` are equivalent.

Confirm the sidecar itself is up before wiring the API (`GET /health` is the sidecar's, not the
API's):

```bash
curl -s http://127.0.0.1:8099/health   # { "ok": true, "model": "...", "device": "cpu|cuda" }
```

### What Laya is allowed to decide

Laya is trusted for `intent` and `mentions_crop_stress` **only** (`docs/research/laya-verdict.md`).
Its `urgency` score never left band 2 for a "crop will die today" message, and its
`is_release_time` noul false-positived on both Telugu (0.814) and an English control (0.778). Both
fields are therefore **discarded in code**, not just in prose: `parseLayaDecision` in
`src/system1.ts` never reads them and returns `urgency: null`, and `finishProviderCall` fills the
contract's required urgency from `classifyByRules`. A change to the sidecar's calibration cannot
leak into a farmer's result. If Laya answers, `source=laya` and the intent/crop-stress come from the
model while urgency comes from the rules.

The failure taxonomy is the same for every provider, and each case falls through to the next with
an honest `source` and a recorded reason: unreachable/refused => `transport_error`, deadline =>
`timeout`, non-2xx => `http_error` (429 => `rate_limited`), non-JSON => `malformed_json`, JSON
outside the schema => `out_of_schema`.

Laya runs on **CPU** (load ~8 s, inference tens of ms); it cannot run inside a Worker, so the
sidecar process must be started separately. That is lane L's scope — see `services/laya/README.md`.
