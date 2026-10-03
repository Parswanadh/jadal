# services/laya — local Laya System-1 decision service

A small local HTTP service that the Jadal Worker calls for a System-1 decision when it has no Jev
key or wants an offline tier. It wraps the open-weight
[`convaiinnovations/laya`](https://huggingface.co/convaiinnovations/laya) multilingual checkpoint
(mmBERT-base, Apache-2.0) with the Jadal decision shape from
[`apps/api/src/system1.ts`](../../apps/api/src/system1.ts) and
[`packages/contracts/src/agents.ts`](../../packages/contracts/src/agents.ts).

Read [`docs/research/laya.md`](../../docs/research/laya.md) before trusting any number this service
returns. The short version is in [Trust](#trust--read-this-before-using-the-numbers) below.

## Install

The service reuses the host interpreter's `torch`/`transformers` rather than downloading a second
copy, and installs only `laya` itself:

```bash
cd services/laya
python -m venv --system-site-packages .venv
.venv/bin/pip install --no-deps -r requirements.txt   # requirements.txt pins the full set
```

`requirements.txt` pins `laya==0.3.23`, `torch==2.7.1`, `transformers==5.13.1`,
`safetensors==0.8.0`, `huggingface_hub==1.18.0`, `numpy==2.4.4`. For a clean-room install drop
`--no-deps` and the whole pinned set is fetched.

## Run

```bash
cd services/laya
.venv/bin/python laya_service.py
# [laya] listening on http://127.0.0.1:8099
# [laya] loading convaiinnovations/laya::multilingual (device=auto) ...
# [laya] ready: device=cuda load=8.3s
```

The model is loaded **once**, at startup. Nothing is loaded per request.

## Interface

### `GET /health`

```json
{
  "ok": true,
  "model": "convaiinnovations/laya",
  "subfolder": "multilingual",
  "device": "cuda",
  "state": "ready",
  "error": null,
  "load_seconds": 8.332,
  "inferences": 0,
  "max_state_tokens": 512,
  "service_version": "0.2.0"
}
```

`200` when `ok` is true, `503` when it is false. When the checkpoint could not load, `state` is
`"failed"` and `error` carries the exact exception text. While it is still loading, `state` is
`"loading"`.

### `POST /decide`

```json
{ "text": "<farmer's message, may be Telugu>",
  "questions": { "intent": {...}, "urgency": {...},
                 "mentions_crop_stress": {...}, "is_release_time": {...} } }
```

`questions` is optional; omit it for the built-in Jadal set. When supplied it must contain
`intent` — the one field this service needs. The Worker's frozen four ids (`intent`, `urgency`,
`mentions_crop_stress`, `is_release_time`) are all accepted and none is renamed.

`200` response:

```json
{
  "intent": "urgent_request",
  "urgency": null,
  "is_release_time": null,
  "source": "laya",
  "latency_ms": 29,
  "model": "convaiinnovations/laya",
  "device": "cuda",
  "intent_confidence": 0.6479,
  "mentions_crop_stress": true,
  "mentions_crop_stress_probability": 0.8824,
  "urgency_band": null,
  "urgency_band_probabilities": null,
  "intent_probabilities": { "urgent_request": 0.6479, "harvested": 0.3013, "...": 0.0 },
  "unvalidated": {
    "urgency": 0.4259, "urgency_band": "visible_wilting_or_cracking_soil",
    "is_release_time": true, "is_release_time_probability": 0.8146, "trusted": false
  },
  "field_trust": { "...": { "trusted": true, "basis": "..." } },
  "trusted_fields": ["intent", "mentions_crop_stress"],
  "untrusted_fields": ["urgency", "is_release_time"],
  "warnings": ["urgency: not validated on this checkpoint (...) - returned as null ..."],
  "state_tokens": 47,
  "max_state_tokens": 512,
  "truncated": false,
  "answers": { "...": "raw per-question model output, keyed by question id" }
}
```

`latency_ms` is the model call only. `state_tokens` is the tokenized input length. `truncated` is
Laya's own `usage.truncated`.

### Errors never contain a decision

Every non-200 body carries `error` and **no** `intent` / `urgency` / `is_release_time` key, so the
Worker can always tell that Laya did not run and fall back to rules:

| status | `error` | when |
|---|---|---|
| `400` | `bad_request` | not JSON, no `text`, empty `text`, or `questions` without `intent` |
| `422` | `input_too_long` | state above the 512-token validated window |
| `500` | `laya_inference_failed` | the model raised |
| `502` | `laya_answer_not_mapable` | the model answered, but `intent` was missing or outside the contract |
| `503` | `laya_unavailable` | the checkpoint is still loading or failed to load |

## Trust — read this before using the numbers

The independent evaluation in
[`docs/research/laya-verdict.md`](../../docs/research/laya-verdict.md) measured this exact
checkpoint on short Telugu:

| field | primitive | trustworthy? |
|---|---|---|
| `intent` | `choice` | **yes** — 4/4 short Telugu |
| `mentions_crop_stress` | `noul` | **yes, small n** — 5/5 short Telugu |
| `urgency` | `score` | **no** — never left band 2 even for "the crop will die today" |
| `is_release_time` | `noul` | **no** — false-positived 0.814 on a Telugu urgent sentence and 0.778 on an English control |

So this service **returns `urgency` and `is_release_time` as `null`** and keeps them out of the
decision path. `null` is the agreed "not reported" signal: the Worker falls back to its Telugu
rules for those two fields. The model's raw values are never hidden — they are under
`unvalidated`, alongside a machine-readable `field_trust` table and `warnings`.

`LAYA_TRUST_UNVALIDATED_FIELDS=1` emits them in the decision path instead. Use it only when a
*different*, validated checkpoint is configured.

### Input length

The state must be **≤ 512 tokens** (`max_state_tokens`); the checkpoint's hard ceiling at the
shipped `max_len=1024` is 888, above which the tail of the message — the actual ask — is truncated
away. Over-long inputs get `422 input_too_long`, never a silent truncation, and inputs are never
padded. Farmer messages are one or two sentences, so this is not a practical limit.

## Configuration

| env | default | meaning |
|---|---|---|
| `LAYA_MODEL` | `convaiinnovations/laya` | checkpoint dir or hub id |
| `LAYA_SUBFOLDER` | `multilingual` | subfolder inside a hub repo |
| `LAYA_DEVICE` | `auto` | `auto` / `cpu` / `cuda` |
| `LAYA_HOST` | `127.0.0.1` | bind address |
| `LAYA_PORT` | `8099` | port |
| `LAYA_MAX_LEN` | checkpoint config (1024) | token budget per request |
| `LAYA_LANG` | unset | language hint, e.g. `te` |
| `LAYA_TRUST_UNVALIDATED_FIELDS` | `0` | `1` to emit untrusted urgency/release-time |
| `LAYA_TORCH_THREADS` | `4` | CPU thread cap, keeps the laptop usable |
| `LAYA_SKIP_LOAD` | unset | `1` to serve with no model (exercises the refusal path) |

## Test

```bash
cd services/laya
.venv/bin/python -m unittest test_jadal_decision test_service_http   # 38 tests, no model needed
.venv/bin/python smoke_test.py                                      # needs a running service
```

`test_service_http.py` drives the real HTTP handler against a stubbed Laya agent that returns the
real `{"model","answers","usage"}` envelope, so the regression where the envelope was passed to
`build_decision` (every `/decide` answered `502`) is pinned without loading a model.
