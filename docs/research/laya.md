# Laya — what it is, how it was installed, and what was actually verified

**Author:** lane L (local Laya service) · **Branch:** `ws/B-laya` · **Date:** 2026-10-02
**Artifact:** `services/laya/` — a local HTTP System-1 decision service for the Jadal Worker.

Evidence convention, as in `docs/research/laya-verdict.md`: **`[RAN]`** = executed on this machine
in this session, output quoted; **`[READ]`** = read in a file or on the web, with the location;
**`[CITED]`** = another lane's measurement, reported as theirs and not reproduced here.

---

## 1. What Laya actually is

| fact | value | source |
|---|---|---|
| Package | `laya` on PyPI, **v0.3.23** | <https://pypi.org/project/laya/> `[READ]` |
| Summary | "Fast, non-autoregressive System 1 decision engine with calibrated probabilities" | PyPI metadata `[READ]` |
| License | Apache-2.0 | PyPI metadata `[READ]` |
| Model repo | `convaiinnovations/laya` (4,862 likes) | <https://huggingface.co/convaiinnovations/laya> `[READ]` |
| Multilingual checkpoint | `convaiinnovations/laya` → `multilingual/` subfolder (also published standalone as `convaiinnovations/laya-multilingual`, 350 likes) | HF model card `[READ]` |
| Encoder | `jhu-clsp/mmBERT-base` — `model_type: modernbert`, 22 layers, hidden 768, `max_position_embeddings=8192`, `local_attention=128` | `encoder/config.json`, `rl_agent_config.json` `[READ]` |
| Params | 322M (the 256k-token multilingual vocab dominates the embedding matrix) | HF model card `[READ]` |
| Runtime deps | `torch>=2.0.0`, `transformers>=4.48.0`, `safetensors`, `huggingface_hub`, `numpy` | PyPI `requires_dist` `[READ]` |
| Telugu | explicitly listed (`te`) in the model card's `language:` field | HF model card `[READ]` |

### Decision primitives

Confirmed in the installed source (`laya/agent.py`, `_decode_answers`) `[RAN]`:

| primitive | question shape | returned answer |
|---|---|---|
| `choice` | `{"type":"choice","instructions":"...","criteria":{"label":"description",...}}` | `{"choice": <label>, "probabilities": {label: p}, "confidence", "answer_confidence"}` |
| `score` | `{"type":"score","instructions":"...","criteria":["level 0", ...]}` | `{"score": <expected level index>, "legend": {idx: text}, "probabilities": {idx: p}}` |
| `noul` | `{"type":"noul","instructions":"...","criteria":{"false":"...","true":"..."}}` | `{"noul": P(true), "confidence"}` |

`score` is a **0-based expected level index**, not a 0..1 value. Jadal divides by `levels - 1` to
land on the urgency scale in `apps/api/src/system1.ts`.

---

## 2. Install — exact commands

```bash
cd /home/parshu/projects/cis/jadal-laya/services/laya
python -m venv --system-site-packages .venv          # reuse the host's torch/transformers
.venv/bin/pip install --no-deps "laya==0.3.23"
```

`[RAN]` — installed `laya-0.3.23-py3-none-any.whl` (286 kB) into a venv built from
`/home/parshu/miniconda3/envs/autogit/bin/python` (Python 3.12.13), which already had
`torch 2.7.1+cu118`, `transformers 5.13.1`, `safetensors 0.8.0`, `huggingface_hub 1.18.0`,
`numpy 2.4.4`, `tokenizers 0.22.2`. Reusing them avoided a second multi-GB torch install on a
laptop that had ~3 GB of RAM available and three other lanes running.

`requirements.txt` pins the full set for a clean-room install.

> **The research doc's caveat is wrong.** `docs/research/deterministic-and-system1.md` §3.2 says
> *"PyPI package namespace conflict exists; requires installing via
> `git+https://github.com/NandhaKishorM/laya.git` and downloading a 1.6 GB checkpoint."*
> `[RAN]` `pip install laya==0.3.23` installs the real Convai package — the wheel's
> `project_urls.Homepage` is `https://huggingface.co/convaiinnovations/laya`, its license is
> Apache-2.0, and `import laya; laya.__version__` reports `0.3.23`. There is no namespace conflict
> and no git install needed. The "1.6 GB" figure is also wrong (see §3).

---

## 3. The checkpoint that was actually used

```
/home/parshu/projects/contri/laya-lab/models/multilingual/
```

A pre-existing local copy, pointed at with `LAYA_MODEL` so the service never touches the network.

| fact | value | how |
|---|---|---|
| `model.safetensors` sha256 | `9d628fd971b700382ac6f65920a86f149777b2e748e0c955fb3b19695aa8f204` | `[RAN]` `sha256sum` |
| `model.safetensors` size | **643,835,514 bytes (643.84 MB)** | `[RAN]` `stat` |
| Whole checkpoint dir | **647 MB** (weights 643.84 MB + `tokenizer.json` 34.36 MB) | `[RAN]` `du -sh` |
| Precision | fp16 weights (322M × 2 bytes); `encoder/config.json` declares `dtype: float32`, so the loader upcasts to fp32 on CPU | `[RAN]`/`[READ]` |
| Load time, CUDA | **8.33 s** | `[RAN]` `/health` `load_seconds` |
| Load time, CPU (other lane) | 7.66 s | `[CITED]` `docs/research/laya-verdict.md` §2 R2 |
| Host RSS, **peak during load** | **2,673 MB** (`VmHWM` 2,737,520 kB) | `[RAN]` `/proc/<pid>/status` |
| Host RSS, steady state after load | **122 MB** (`VmRSS` 125,076 kB) | `[RAN]` `/proc/<pid>/status` |
| VRAM after load, CUDA | **~1,693 MiB** (1,257 → 2,950 MiB used) | `[RAN]` `nvidia-smi` |

The peak-vs-steady gap is real and was worth respecting: `model.to(cuda)` releases the CPU-side
fp32 copy, so the resident set collapses once loading finishes — but the load itself transiently
holds the fp32 model, the fp16 source tensors and the CUDA staging buffers at once. **The brief's
"roughly 2 GB of RAM to load" was right about the peak even though its 1.7 GB on-disk figure was
not.** The 2 GB available-RAM floor was checked before loading, and when available RAM fell to
1,524 MB the load was deferred rather than forced `[RAN]`.

The hash is byte-identical to the pin in `docs/research/laya-verdict.md` and in
`laya-lab/README.md:514-517` `[RAN]`.

> **The brief's size estimate was wrong in the safe direction.** The brief warned of a
> "~1.7 GB on disk / ~2 GB RAM" ModernBERT-large checkpoint. Measured: the **English** checkpoint's
> `model.safetensors` is 842.6 MB and the **multilingual** one is 643.8 MB (HF blob API) `[READ]`.
> Nothing here is 1.7 GB. The 2 GB RAM floor was still respected before loading, because the
> upcast to fp32 on the CPU path would peak near 1.3 GB for the model alone plus 0.64 GB for the
> fp16 source tensors.

### Which checkpoint, and why

The brief says "prefer the smallest checkpoint that still supports Telugu." The multilingual
checkpoint is **both** smaller (322M / 644 MB) and the only Telugu-capable one (the English
checkpoint is ModernBERT-large, 421M / 843 MB, and Laya's own `lang.py` documents it collapsing to
near-random on non-Latin scripts) `[READ]`. So the multilingual checkpoint is the only sane choice,
and it is the one configured.

The service defaults to the **local verified directory**, not a hub id. If that directory is
absent it falls back to `convaiinnovations/laya` with `subfolder="multilingual"` — the repo and
subfolder the evaluation lane validated — rather than the separately published
`convaiinnovations/laya-multilingual` repo, so a cold start cannot silently fetch a different
artifact.

---

## 4. The packaged API does not quite match its documentation

Reported plainly, as the brief asks. These are real mismatches found by running the code.

### 4.1 `system_one` returns an envelope, and the docstring does not say so

`Agent.system_one(state, questions)` documents its return as *"Dictionary with answers,
probabilities, calibrated confidence, and token usage."* The actual return is a **three-key
envelope**:

```python
{"model": "laya-rl-agent", "answers": {qid: {...}}, "usage": {...}}   # laya/agent.py:1697
```

`[RAN]` read directly from the installed wheel. The answers are nested one level down under
`"answers"`. `predict_batch`'s docstring compounds this by saying its elements are *"identical in
shape to `system_one`'s output"* — true, but it never names the nesting either.

**This cost a real bug.** The first version of `services/laya/laya_service.py` passed the return
value straight to `build_decision`, which looked for `answers["intent"]`, found nothing on the
envelope, and raised. Every `/decide` answered `502 laya_answer_not_mapable` — the model was
answering fine and the service was throwing the answer away. Fixed in `unwrap_answers()`
(`jadal_decision.py`), with the regression pinned at the HTTP level in
`test_service_http.py::test_decide_returns_200_not_502`. The same failure is recorded independently
as R6 in `docs/research/laya-verdict.md` §2.

### 4.2 `score` is a level index, not a 0..1 score

`system_one`'s docstring lists a `score` question type without stating the returned scale. The
answer's `"score"` is the **expected 0-based level index** over `criteria`
(`_decode_answers`: `exp_score = (np.arange(k) * p).sum()`). A caller who assumes 0..1 and passes
five rubric levels gets 0..4. The `_decode_answers` code comments do document this; the public
docstring does not. `jadal_decision._read_score` divides by `levels - 1`.

### 4.3 What *does* match

Everything else checked out: the `choice`/`score`/`noul` shapes above, the
`laya.load(model, device=, subfolder=)` signature, `predict` as an alias of `system_one`, the
`allow_patterns` restricted download, `_fix_tokenizer_config`'s mmBERT `extra_special_tokens`
patch, and the local-path fast route that skips the Hub entirely. The package is genuinely
well-engineered — the envelope nesting is the one sharp edge.

---

## 5. Verified vs UNVERIFIED

### VERIFIED by me, this session `[RAN]`

| # | claim | evidence |
|---|---|---|
| V1 | `pip install laya==0.3.23` works and imports | `.venv/bin/python -c "import laya; print(laya.__version__)"` → `0.3.23` |
| V2 | The local checkpoint loads on CUDA | `/health` → `{"ok":true,"device":"cuda","load_seconds":8.332}` |
| V3 | The checkpoint hash/size match the evaluation lane's pin | `sha256sum` → `9d628fd9…8f204`, 643,835,514 bytes |
| V4 | A real Telugu urgent-request sentence returns a decision | `POST /decide` → `200`, `intent:"urgent_request"`, `mentions_crop_stress:true` (body in §6) |
| V5 | Latency is far inside the Worker's 4 s timeout | 5 consecutive calls: `latency_ms` 43/28/30/36/27, wall 45/29/32/37/28 ms |
| V6 | The model loads exactly once | `/health` `inferences` counts up across 9 calls with no reload |
| V7 | A second Telugu sentence differentiates | schedule question → `intent:"schedule_question"`, `mentions_crop_stress:false` |
| V8 | Over-long input is refused, not truncated | 4804-token input → `422 input_too_long`, no decision keys |
| V9 | Unloaded service refuses honestly | `LAYA_SKIP_LOAD=1` → `/health` 503 `ok:false`, `/decide` 503 `laya_unavailable`, no decision keys |
| V10 | `GET /health` is cheap | 0.7–1.2 ms over three calls |
| V11 | Mapping and HTTP behaviour are unit-tested | 38 tests pass, no model needed |
| V12 | The raw model output for `is_release_time` is a false positive on this sentence | `noul = 0.8146` on an urgent "send water immediately" message |
| V13 | The raw `urgency` score does not track the Jadal rubric | raw index 1.7035/4 → 0.426, i.e. band 2, for "the crop will die" |

### VERIFIED by another lane, cited not reproduced `[CITED]`

From `docs/research/laya-verdict.md` (lane B, `ws/B-laya-verdict`), which used this same local
checkpoint:

* `intent` `choice` was 4/4 correct on short Telugu; `mentions_crop_stress` 5/5.
* `urgency` never left band 2 (0.31–0.46) across five sentences, including "the crop will die
  today".
* `is_release_time` false-positived at **0.814** (Telugu urgent) and **0.778** (English control).
* Per-question state room at the shipped `max_len=1024`: `intent` 888 tokens, `urgency` 894,
  `mentions_crop_stress` 964, `is_release_time` 964 — so 888 is the binding hard ceiling.
* The local tokenizer has 233 Telugu vocab entries and produced **0 UNK tokens** on four Telugu
  sentences.

From `laya-lab` (independent evaluation repo, `[CITED]` via the verdict doc): the multilingual
checkpoint ships **no fitted temperatures** (ECE 0.314 as shipped vs 0.106 after refit), and
upstream's own 51-language sweep puts Telugu at **0.220 at 20 options (random 0.050), rank 42/51**.

### UNVERIFIED — do not claim these

| # | open question | why it matters |
|---|---|---|
| U1 | **Telugu agricultural accuracy at scale.** No evaluation with ≥200 real farmer utterances exists. The 4/4 intent result is a hand-authored smoke probe, not an accuracy measurement. | This is the whole reason Jadal wants Laya. It is still the open question `ADR-004` names. |
| U2 | The Worker's actual call path through `LAYA_ENDPOINT`. | Owned by the System-1 provider lane (Lane K); this service is only one side of it. |
| U3 | Behaviour under concurrent load. | Inference is serialised behind a lock; throughput was never measured. |
| U4 | ONNX export. | No `.onnx` artifact exists locally `[CITED]`; the Worker cannot host this in-process. |
| U5 | Any accuracy number from `laya-lab`'s baseline. | Their run was `laya 0.3.20`, CUDA bf16, nine languages, **no Telugu**. Not reproduced here. |
| U6 | Whether re-fitting the temperature on Jadal's own labels makes `urgency` usable. | Plausible, unmeasured. The failure looks like task/calibration fit, not a Telugu failure. |

---

## 6. The verified response

`[RAN]` — `POST /decide`, the Telugu sentence *"నా వరి పంట ఎండిపోతుంది, కాలువలో నీళ్లు లేవు.
వెంటనే నీరు పంపండి, పంట చనిపోతుంది."* ("My paddy crop is drying up, there is no water in the
channel. Send water immediately, the crop will die.") — 47 state tokens, HTTP 200, wall 73 ms:

```json
{
  "intent": "urgent_request",
  "urgency": null,
  "is_release_time": null,
  "source": "laya",
  "latency_ms": 71,
  "intent_confidence": 0.6479,
  "mentions_crop_stress": true,
  "mentions_crop_stress_probability": 0.8824,
  "intent_probabilities": {
    "urgent_request": 0.6479, "buffer_request": 0.0036, "not_needed_this_week": 0.0125,
    "harvested": 0.3013, "schedule_question": 0.0028, "acknowledge": 0.0041, "other": 0.0278
  },
  "unvalidated": {
    "urgency": 0.4259, "urgency_band": "visible_wilting_or_cracking_soil",
    "is_release_time": true, "is_release_time_probability": 0.8146, "trusted": false
  },
  "trusted_fields": ["intent", "mentions_crop_stress"],
  "untrusted_fields": ["urgency", "is_release_time"],
  "state_tokens": 47,
  "max_state_tokens": 512,
  "truncated": false
}
```

Note `urgency: null` and `is_release_time: null` with the raw values under `unvalidated` — see
`services/laya/README.md` §Trust. The `0.8146` and the band-2 urgency are exactly the failures the
evaluation lane found, reproduced here on the same sentence.

---

## 7. Operating envelope

* **Input ≤ 512 tokens** (`max_state_tokens`), enforced with `422 input_too_long`. The checkpoint's
  hard ceiling at the shipped `max_len=1024` is 888 tokens for the `intent` question; past it the
  state is right-truncated and the tail — where the ask sits — is dropped. Inputs are never padded.
* **Model loaded once**, at startup, before serving. `/decide` during load returns `503`.
* **Inference serialised** behind a lock: a torch module is not reliably re-entrant, and this also
  bounds peak VRAM.
* **Resources**: peak 2,673 MB host RSS during load, 122 MB steady state, ~1,693 MiB VRAM,
  8.33 s load. The 2 GB available-RAM floor was checked before loading; when available RAM fell
  to 1,524 MB the load was deferred rather than forced.

---

## 8. Sources

* Laya on PyPI — <https://pypi.org/project/laya/> (v0.3.23, Apache-2.0, deps)
* Laya on Hugging Face — <https://huggingface.co/convaiinnovations/laya> (bundle: English root,
  `multilingual/`, `typed-decisions/`)
* Multilingual checkpoint — <https://huggingface.co/convaiinnovations/laya-multilingual>
* Laya source — <https://github.com/NandhaKishorM/laya>
* Laya docs — <https://nandhakishorm.github.io/laya/>
* mmBERT encoder — <https://huggingface.co/jhu-clsp/mmBERT-base>
* Local evaluation of this checkpoint — `docs/research/laya-verdict.md` (lane B, `ws/B-laya-verdict`)
* Independent evaluation repo — `/home/parshu/projects/contri/laya-lab/` (`BASELINE.md`, `README.md`,
  `experiments/harness/backends.py`)
* Jadal contract — `packages/contracts/src/agents.ts:33` (`System1Intent`)
* Jadal System-1 layer — `apps/api/src/system1.ts`, `apps/api/src/system1.rules.ts`
* Architecture decision — `docs/decisions/ADR-001-004-stack.md` (ADR-004)
