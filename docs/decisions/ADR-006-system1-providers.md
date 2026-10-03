# ADR-006 System-1 provider abstraction: Laya first, Jev second, rules as the floor

Status: accepted. Amends ADR-004. Code: `apps/api/src/system1.ts`, `apps/api/src/system1.rules.ts`.

## Context

ADR-004 chose **Jev (`typesafe/jev-router` via OpenRouter)** as System 1 and **Laya** as an ONNX
fallback that a Workers isolate cannot host. Two facts were verified on 2026-10-02, and both change
that choice.

1. **`typesafe/jev-router` is the wrong Jev surface.** It is an OpenRouter *router*: you call it on
   `/api/v1/chat/completions`, it picks a chat model and reasoning effort, and it returns generated
   text. It does not return typed `choice` / `score` / `noul` answers. The typed-decision surfaces
   are the **Decisions API** (`POST https://openrouter.ai/api/alpha/decisions`) and the
   TypeSafe-SDK-compatible System One API (`POST https://openrouter.ai/api/v1/systemone`), both with
   a Jev model such as `typesafe/jev-1.13`. Sources:
   <https://openrouter.ai/docs/guides/community/jev>,
   <https://openrouter.ai/docs/guides/community/jev-tutorial>,
   <https://openrouter.ai/docs/guides/routing/routers/jev-router>,
   <https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request>.

2. **Laya can serve Telugu, and it can run locally.** `convaiinnovations/laya` is Apache-2.0 and its
   multilingual checkpoint is mmBERT-based, covering 100+ languages including Telugu. A local Python
   sidecar (lane L, `services/laya`) can expose it to the Worker over HTTP. For Jadal's Telugu
   farmers, a Telugu-native local model is a better primary than an English-first remote router.

## Decision

- **One System-1 entry point** — `classify(env, text)` / `classifyDetailed(env, text)` — served by a
  provider chain, never a hardwired vendor.
- **Selection** by `SYSTEM1_PROVIDER`:
  - `laya`  → `laya`, `jev`, `rules`
  - `jev`   → `jev`, `laya`, `rules`
  - `auto`  → `laya`, `jev`, `rules` (the default when the variable is unset or blank)
  - `rules` → `rules` only: an explicit offline deployment must never touch the network
  - an unrecognised spelling degrades to `rules`, matching `isDemo`'s "a typo takes the safe path"
    rule rather than silently spending OpenRouter credit.
- **Provenance is available on every result, but it is not yet persisted.** Every result carries
  `source: "laya" | "jev" | "rules"`, and `classifyDetailed` additionally returns an `attempts` trail
  (`provider`, `ok`, `reason`, `status`) plus a `fallback` summary when the rules answered, so a
  fallback is never silent to a `classifyDetailed` caller and never reported as if the model ran.
  **Limitation (2026-10-03):** the production callers (`apps/api/src/requests.ts`,
  `apps/api/src/routes/voice.ts`, `apps/api/src/agents/caller.ts`, `apps/api/src/telephony-deps.ts`)
  call `classify` and read only `intent`/`urgency`, and the `request.triaged` event in
  `packages/contracts/src/events.ts` has no `source` field. The *stored* audit trail therefore cannot
  yet distinguish a `source: "rules"` fallback from a real `laya`/`jev` decision. Persisting `source`
  in `request.triaged` is planned; because it changes the contract it needs the `contracts-ok` label.
- **Every provider failure moves to the next link**: unreachable, non-200, rate limit, timeout,
  malformed JSON, or an out-of-schema value.
- **Jev** is called on the Decisions API with `model` defaulting to `typesafe/jev-1.13`
  (`JEV_MODEL` overrides it). The OpenRouter URL goes through Cloudflare AI Gateway when
  `AI_GATEWAY_URL` is set.
- **Laya** is called at `POST $LAYA_ENDPOINT` (`LAYA_ENDPOINT`, e.g.
  `http://127.0.0.1:8099/decide`), locally, and is never gateway-prefixed.
- **No contracts change was needed for the result.** `System1Result.source` is already
  `z.enum(["jev", "laya", "rules"])` in `packages/contracts/src/agents.ts`, so the provenance field on
  the returned result needed no `contracts-ok`. The event log was *not* changed, which is why the
  provenance limitation above still stands.

## Verified wire contracts

**Jev — OpenRouter Decisions API** (verified from the docs above on 2026-10-02):

```jsonc
// POST https://openrouter.ai/api/alpha/decisions
{
  "model": "typesafe/jev-1.13",
  "state": "నీళ్లు లేవు",                       // string | object | array, required
  "questions": {                                // required
    "intent":       { "type": "choice", "instructions": "...", "criteria": { "urgent_request": "...", "...": "..." } },
    "urgency":      { "type": "score",  "instructions": "...", "criteria": ["level 0", "...", "level 4"] },
    "crop_stress":  { "type": "noul",   "instructions": "...", "criteria": { "true": "...", "false": "..." } }
  }
}
// 200
{
  "id": "gen-dec-...", "model": "typesafe/jev-1.13-20260917", "provider": "TypeSafe",
  "answers": {
    "intent":      { "type": "choice", "choice": "urgent_request", "confidence": 0.67, "probabilities": { "...": 0.78 } },
    "urgency":     { "type": "score",  "score": 1.99, "confidence": 0.99, "probabilities": { "0": 0, "1": 0.01, "2": 0.99 }, "legend": { "0": "..." } },
    "crop_stress": { "type": "noul",   "noul": 0.96 }
  },
  "usage": { "input_tokens": 476, "output_tokens": 70, "cost": 0.000019992 }
}
```

- `choice` requires an object `criteria`; `score` requires an array `criteria`; `noul` requires only
  `type` + `instructions`.
- **`score` is on the index scale `0..criteria.length-1`, not `0..1`.** Jadal sends five urgency
  levels and divides by `4` to satisfy the contract's `urgency ∈ [0,1]`.
- Documented error statuses: 400, 401, 402, 403, 404, 413, 429, 500, 502, 503, 524, 529.

**Laya — local sidecar** (the shape `services/laya` in lane L implements, read 2026-10-02):

```jsonc
// POST $LAYA_ENDPOINT
{ "text": "నీళ్లు లేవు",
  "questions": { "intent": {...}, "urgency": {...},
                 "mentions_crop_stress": {...}, "is_release_time": {...} } }   // ids are load-bearing
// 200 (build_decision output; abbreviated)
{ "intent": "urgent_request", "urgency": 0.9, "is_release_time": false, "source": "laya",
  "latency_ms": 118, "model": "convaiinnovations/laya-multilingual", "device": "cpu",
  "intent_confidence": 0.83, "mentions_crop_stress": true,
  "mentions_crop_stress_probability": 0.94, "urgency_band": "needs_water_immediately",
  "answers": { "intent": {...}, "urgency": {...}, "is_release_time": {...},
               "mentions_crop_stress": {...} } }
// GET /health -> { "ok": true, "model": "<checkpoint>", "device": "cpu|cuda" }
```

`intent_confidence` and `mentions_crop_stress` are `null` when the model did not answer that
question, and `/decide` answers 503 (model not loaded), 500 (inference failed) or 502 (answer not
mapable) with no decision keys at all — which is exactly how the Worker tells "Laya did not run"
apart from a real decision. The Worker also accepts a Decisions-shaped response under `answers`
(`answers.intent.choice`, `answers.urgency.score`, `answers.mentions_crop_stress.noul`), so the
sidecar can change shape without a Worker change.

## The Laya crop-stress signal (read this before trusting `source: "laya"`)

`services/laya/jadal_decision.py`'s `build_decision` emits `mentions_crop_stress` and
`mentions_crop_stress_probability` alongside `intent`, `urgency` and `is_release_time`, and echoes
the raw per-question output under `answers`. `System1Result` requires
`mentions_crop_stress: boolean`, so:

1. if the sidecar reports `mentions_crop_stress` (boolean, probability, or a `{ noul }` answer),
   `crop_stress` (probability or `{ noul }`), or a `*_probability` field, that value is used — this
   is the normal path, and the value is Laya's own;
2. only when the sidecar reports **none** of them — it emits `mentions_crop_stress: null` when the
   model did not answer that question — is the boolean taken from
   `classifyByRules(text).mentions_crop_stress`.

So the deterministic rules are the *fallback* for one boolean, not the normal source of it. A JSON
`null` means "the model did not answer", never "invalid", and is never treated as `false`. The same
applies to `intent_confidence: null`, which falls back to the raw `answers.intent.confidence` and
then to a neutral 0.5. `is_release_time` is never mapped onto `mentions_crop_stress` — they are
different questions.

The sidecar's mapper also **requires** the caller's `questions` to carry `is_release_time` (it
answers 400 otherwise, and 502 when a required answer is missing), so the Worker's Laya question set
is `{ intent, urgency, mentions_crop_stress, is_release_time }` with exactly those ids.

## Failure taxonomy

| Failure | `reason` | `status` |
| --- | --- | --- |
| Provider not configured (no endpoint / no key) | `not_configured` | — |
| Fetch throws (refused, DNS, TLS) | `transport_error` | — |
| Hard deadline, or an aborted fetch | `timeout` | — |
| HTTP 429 | `rate_limited` | 429 |
| Any other non-2xx (401/402/5xx included) | `http_error` | the status |
| Body is not JSON | `malformed_json` | — |
| JSON outside the schema (unknown intent, `noul` outside `0..1`, score off-scale, invalid confidence) | `out_of_schema` | — |

On every one of them the chain advances; the rules are always the last link, so `classify` always
resolves with a schema-valid result.

## Timeouts

`JEV_TIMEOUT_MS` (default 4000, clamped to 250..15000) and `LAYA_TIMEOUT_MS` (default 4000, clamped
to 100..15000); `opts.timeoutMs` overrides both verbatim. Each call races an `AbortController`
deadline, so a slow model can never stall a farmer's call.

## Consequences

- The old OpenAI chat-completions body (`messages`, `temperature`, `response_format`) is gone; it
  could never have produced a typed Jev answer.
- `classify`'s signature is unchanged, so `routes/`, `telephony/` and `campaigns/` keep compiling;
  they should switch to `classifyDetailed` (or read `source`) if they want the fallback reason at all,
  and persisting that provenance in `request.triaged` remains a planned `contracts-ok` change.
- `SYSTEM1_PROVIDER=rules` preserves the offline demo guarantee: zero network calls.
- **UNVERIFIED.** No live Jev call was made from this worktree (no `OPENROUTER_API_KEY` was present
  anywhere in the workspace), so the Jev request shape is verified against OpenRouter's published
  reference but not against a live 200. The Laya sidecar was read at the source level (its request
  and response shapes are pinned by tests) but no model was loaded and no live `/decide` call was
  made, so its runtime behaviour on Telugu input is still unproven. Both are recorded as UNVERIFIED
  rather than asserted.
