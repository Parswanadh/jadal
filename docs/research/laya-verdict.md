# Laya verdict — can the multilingual checkpoint be Jadal's System-1 engine?

**Author:** lane B (laya verdict) · **Branch:** `ws/B-laya-verdict` · **Date:** 2026-10-02
**Checkpoint under test:** `convaiinnovations/laya`, subfolder `multilingual`, local copy at
`/home/parshu/projects/contri/laya-lab/models/multilingual/`
**Hash verified this session:** `sha256 9d628fd971b700382ac6f65920a86f149777b2e748e0c955fb3b19695aa8f204`,
643,835,514 bytes — byte-identical to the pin in `laya-lab/README.md:514-517` and to the checkpoint
laya-lab evaluated. No download was performed.

**Evidence convention.** `[RAN]` = I executed it on this machine and quote the observed output.
`[READ]` = I read it in a file; the file:line is given. Numbers from prose are never presented as
mine.

---

## 1. Verdict

**USE IT WITH LIMITS — as an offline, advisory `intent` (`choice`) classifier for short Telugu
messages only; do not let it own `urgency` (`score`) or `is_release_time` (`noul`), and do not
treat Telugu as validated.**

The limits, each with its basis:

| # | limit | basis |
|---|---|---|
| L1 | **Intent `choice` only.** Do not ship its `score` or `noul` as authoritative. | `[RAN]` n=4 Telugu + 1 English probe: intent 5/5 correct, but the release-time `noul` false-positived on both urgent sentences (0.814 Telugu / 0.778 English) and urgency never left band 2 for a "crop will die today" message. §4. |
| L2 | **Telugu is UNVALIDATED, not supported.** Gate any use behind a labelled Telugu agricultural eval of ≥200 real utterances before trusting it. | `[READ]` laya-lab's controlled harness never tested Telugu: its pools are ar/de/en/es/fr/hi/ja/pt/zh (`laya-lab/experiments/harness/pools/needles-balanced-v1.json`), and `README.md:526` says "Nothing about a language outside the nine in the pools." The only Telugu number on this exact checkpoint is upstream's own 51-language sweep: 0.220 at 20 options vs 0.050 random, rank 42/51 (`laya-lab/fork/BENCHMARKS.md:80`; `laya-lab/fork/research/results/cpu_51_language_sweep.json` → `part_a.by_model.multilingual.per_language.te`). |
| L3 | **Enforce ≤512 input tokens; hard ceiling 888 at the shipped `max_len=1024`.** | `[RAN]` tokenizer-only measurement of the real head layout: the 7-option `intent` question keeps 888 state tokens before right-truncation, the other three keep 894–964. §5. |
| L4 | **Not in a Cloudflare Worker.** Run it as the Python sidecar (`services/laya`) or export ONNX first. | `[READ]` `apps/api/src/system1.ts:7-9,319-322`; ONNX requires an exported `.onnx` file and **none exists locally** (`[RAN] find … -name '*.onnx'` → empty). |
| L5 | **Re-fit temperature/calibration on Jadal's own labels before using any probability as a threshold.** | `[READ]` `laya-lab/fork/BENCHMARKS.md` calibration section: multilingual ships with no fitted temperatures (ECE 0.314 as shipped vs 0.106 after refit). |

The laya-lab negative result is **not** the blocker: it is about long context, and Jadal's messages
are short. Its relevance is the envelope (L3), not the verdict. The blockers are Telugu (L2) and
task fit on `score`/`noul` (L1).

---

## 2. What I actually RAN vs what I only READ

### RAN (this machine, this session)

| # | command | observed |
|---|---|---|
| R1 | `sha256sum models/multilingual/model.safetensors` | `9d628fd9…8f204`, 643,835,514 bytes — matches the pin `[RAN]` |
| R2 | `.ref/laya_telugu_probe.py` (loads the local checkpoint **once**, CPU, then 5 sentences through the exact `JADAL_QUESTIONS` set imported read-only from `jadal-laya/services/laya/jadal_decision.py`) | load 7.66 s; 5 sentences; raw outputs in §4 and `.ref/telugu_probe_output.json` `[RAN]` |
| R3 | `.ref/state_room.py` (tokenizer only, **no model load**) | per-question state room at `max_len=1024`: intent 888, urgency 894, stress 964, release-time 964 `[RAN]` |
| R4 | Telugu script coverage of the local tokenizer | 233 vocab entries contain codepoints in U+0C00–U+0C7F; **0 UNK tokens** on all four Telugu sentences `[RAN]` |
| R5 | `find … -name '*.onnx'` across laya-lab and jadal-laya | empty — no ONNX artifact exists `[RAN]` |
| R6 | `build_decision` called with the `system_one` envelope | raises `DecisionMappingError: model did not answer required question(s): intent, urgency, is_release_time` `[RAN]` — see §6 |

Run environment `[RAN]`: `laya 0.3.23` (PyPI, in
`jadal-laya/services/laya/.venv`), torch 2.7.1+cu118, transformers 5.13.1, **CPU fp32**,
`torch.set_num_threads(4)`. Peak memory stayed inside the 15 GB box (`free -m` checked before load:
2582 MB free / 4179 MB available).

### READ only (not reproduced here)

- All laya-lab accuracy, CI, p-value and latency figures. laya-lab's committed baseline ran
  `laya 0.3.20` on CUDA bf16 (`experiments/baseline-power-n200/manifest.json` →
  `model.backend.laya_version = "0.3.20"`, `device = "cuda"`, `parameters = 321908995`). **I did not
  reproduce any laya-lab number**; my probe is a different package version on a different device.
- The upstream 51-language sweep and the upstream latency tables (`fork/BENCHMARKS.md`). These are
  upstream's measurements, committed in the fork; laya-lab's controlled harness did not run them.

---

## 3. Exact loading / calling signature

Taken from the working code, not from prose.

**Load** — `laya-lab/experiments/harness/backends.py:47`:
```python
self.agent = laya.load(checkpoint, device=device, subfolder=subfolder)
```
Public definition `laya-lab/fork/laya/agent.py:921`:
```python
def load(model_id_or_path="convaiinnovations/laya", device=None, token=None,
         subfolder=None, fast=False, lang_temperatures=None, hooks=None, ...) -> Agent
```
For the local copy, pass the **directory** and **no subfolder**:
`laya.load("/home/parshu/projects/contri/laya-lab/models/multilingual", device="cpu")`.
`Agent.__init__` (`agent.py:252-277`) uses the path directly when it exists and only calls
`snapshot_download` otherwise, so a local path never touches the network. `subfolder` is only for
selecting `multilingual/` inside the multi-checkpoint HF repo.

**Call** — `laya-lab/experiments/harness/backends.py:59`:
```python
r = self.agent.predict(state, questions, max_len=max_len, head_max_len=head_max_len)
```
`predict` is an alias of `system_one` (`agent.py:915`); definition at `agent.py:851-855`. The
installed `laya 0.3.23` is called identically (`jadal-laya/services/laya/laya_service.py:113`):
```python
answers = self.agent.system_one({"text": text}, questions, max_len=...)
```

**Question schema** — `agent.py:861-865` (docstring) and `agent.py:487-535` (validation):
```python
{"type": "choice", "instructions": "...", "criteria": {"optA": "desc", ...}}   # -> label
{"type": "score",  "instructions": "...", "criteria": ["lvl0", "lvl1", ...]}   # -> expected level index
{"type": "noul",   "instructions": "...",
 "criteria": {"false": "...", "true": "..."},
 "labels":   {"false": "B", "true": "A"}}                                      # -> P(true)
```

**What the decision head returns** — `agent.py:681-710` (`_decode_answers`):
- `choice` → `{"type","choice": <label>, "probabilities": {label: p}, "confidence", "answer_confidence", "action"}`
- `score`  → `{"type","score": <expected level index>, "legend": {idx: text}, "probabilities": {idx: p}, ...}`
  — note the raw `score` is a **0-based level index**, not 0..1; Jadal divides by `levels-1`.
- `noul`   → `{"type","noul": P(true), "confidence", ...}`

The top-level return is an **envelope**: `{"model": "laya-rl-agent", "answers": {qid: {...}},
"usage": {...}}` (`agent.py:820-824`). Consumers must read `result["answers"]`, not `result`.

**Input format** — `laya-lab/fork/laya/common.py:88`:
```
[CLS] <type> question: <instructions> [SEP] [MASK] opt0 [MASK] opt1 ... [SEP] state [SEP]
```
The head is at the front and the state at the **end**; the decision is read from the `[MASK]` marker
positions (`common.py:117-121`). A dict state is JSON-serialised (`common.py:17-20`), which is why
Jadal passes `{"text": text}` and the instructions backtick `text`.

---

## 4. Telugu: the crux

### 4.1 laya-lab never tested it — stated plainly

laya-lab's controlled evaluation is nine languages: **ar, de, en, es, fr, hi, ja, pt, zh**
(`[RAN]` grep of `"lang"` fields in `experiments/harness/pools/needles-balanced-v1.json`).
`README.md:526` is explicit: *"Nothing about a language outside the nine in the pools."* Hindi is
the only Indic language in the pool. **There is no laya-lab evidence about Telugu at all**, and
mmBERT's 1833-language training does not imply the decision head works on Telugu.

The project does know non-Latin scripts are the weak axis for the *English* checkpoint
(`[READ]` `fork/laya/lang.py:4-6`: "the English checkpoint collapsing to near-random on non-Latin
scripts (Hindi 0.100 … Tamil 0.113 at 20 options, where random is 0.050)").

### 4.2 The only Telugu number on this checkpoint is upstream's, and it is weak

`[READ]` `fork/BENCHMARKS.md:80`, from `fork/research/results/cpu_51_language_sweep.json`:

| lang | `laya` (English) | `laya-multilingual` | random (20 options) | multilingual ECE |
|---|---:|---:|---:|---:|
| `te` | 0.090 | **0.220** | 0.050 | 0.370 |

`[RAN]` re-read of the committed JSON (`part_a.by_model.multilingual.per_language.te`): `accuracy
0.22`, `macro_f1 0.1973`, `ece 0.3705`, `mean_confidence 0.5905`, `n=100`, `n_options=20`, `seed=13`.
Telugu ranks **42 of 51** languages; macro accuracy is 0.3661 and 45/51 languages clear 3× random
(`BENCHMARKS.md:46-48`). This is upstream's own benchmark, not laya-lab's and not mine — **reported,
not independently reproduced here**.

### 4.3 My probe: 4 real Telugu sentences + 1 English control `[RAN]`

Raw output in `.ref/telugu_probe_output.json`. Random for the 7-option choice is 0.143.

| sentence (my gold) | intent predicted (p) | urgency unit | `is_release_time` | `mentions_crop_stress` |
|---|---|---|---|---|
| te_urgent_crop_stress → urgent_request | **urgent_request (0.640)** | 0.427 | **0.814 ✗** | 0.885 ✓ |
| te_schedule_question → schedule_question | **schedule_question (0.713)** | 0.407 | 0.803 ✓ | 0.195 ✓ |
| te_not_needed → not_needed_this_week | **not_needed_this_week (0.601)** | 0.313 | 0.008 ✓ | 0.102 ✓ |
| te_buffer_request → buffer_request | **buffer_request (0.559)** | 0.390 | 0.080 ✓ | 0.033 ✓ |
| en_urgent_control → urgent_request | **urgent_request (0.869)** | 0.461 | **0.778 ✗** | 0.846 ✓ |

**Reading, with the sample size stated.** This is **n=4 Telugu, hand-authored by me, no gold set,
one pass, no seed**. It is a smoke probe, not an accuracy measurement — do not quote it as one.
What it does establish:

1. **The multilingual checkpoint reads Telugu script.** 0 UNK tokens; 233 Telugu vocab entries;
   sensible, differentiated answers. This is the one solid positive.
2. **Intent `choice` is promising**: 4/4 Telugu correct with probabilities above the 0.143 random
   floor, and it separated four different intents cleanly.
3. **The `is_release_time` `noul` is not usable as-is.** It fires at **0.814** on "my crop is
   drying, send water immediately" — a false positive — and does the same on the **English**
   control (0.778), so this is a question-design/calibration failure, not a Telugu failure.
4. **The `urgency` `score` does not track Jadal's rubric.** The most urgent Telugu message
   ("crop will die, send water immediately") lands at **0.427**, i.e. Jadal band 2
   ("visible wilting"), where the rubric expects 0.86–1.00. Across all five sentences the score
   never leaves 0.31–0.46 — the head barely differentiates urgency on this task. The 5 band texts
   are Jadal's own rubric, and the checkpoint was never trained on them.

### 4.4 Conclusion on Telugu

**UNVALIDATED.** The checkpoint can *read* Telugu; whether it *classifies agricultural Telugu*
well enough for Jadal is unknown, and the two independent weak signals (upstream 0.220/20-option;
my `noul`/`score` misfires) do not justify assuming it does. This is exactly the open question
Jadal's own ADR already names: `docs/decisions/ADR-001-004-stack.md:56` — *"Laya's Telugu accuracy
on agricultural phrasing must be smoke-tested in P1. If it is weak, translate Telugu → English with
Sarvam before classifying."* My probe answers "it can read Telugu"; it does not answer "it is
accurate enough".

---

## 5. Operating envelope — the input-length limit

Two different limits, and they must not be conflated.

### 5.1 Hard truncation ceiling — measured `[RAN]`

At the shipped `max_len=1024`, `head_max_len=256`, the state room per Jadal question, measured with
the real `build_sequence` (`common.py:78-128`) over a 4001-token state:

| question | type | options | tokens kept for state |
|---|---|---:|---:|
| `intent` | choice | 7 | **888** |
| `urgency` | score | 5 | 894 |
| `mentions_crop_stress` | noul | 2 | 964 |
| `is_release_time` | noul | 2 | 964 |

**The binding limit is 888 tokens** (the 7-option intent question). Above it the state is
**right-truncated** (`truncate_left=False` for a dict state, `common.py:126`), so the *tail* of the
message — usually the ask — is silently dropped. laya-lab measured what truncation does to
accuracy: at `max_len=1024`, every pad ≥ 1000 collapses to **0.325** with
`request_tokens_kept = 0.00` (`README.md:92-96`, `BASELINE.md:29`). Do not cross this line.

Note this differs from laya-lab's stated 978-token window (`README.md:94-95`): that is for their
single 4-option question with short instructions (head 45 tokens). Jadal's 7-option intent question
has a 136-token head-plus-separators (`[RAN]`), leaving 888.

### 5.2 Quality envelope — recommended cap 512 tokens

laya-lab's only short-context accuracy is **pad = 0 → 0.840** (`README.md:29,78`;
`BASELINE.md:29`), on a **3-class synthetic needle pool, nine languages, not Telugu, not Jadal's
taxonomy** — reported by laya-lab, not reproduced here. Accuracy then falls with padding at
`max_len=8192`: 0.705 (pad 1000), 0.670 (2000), 0.495 (4000), 0.420 (7000) (`README.md:78-82`).
**There is no laya-lab measurement for a message-only state between ~47 tokens and ~1000 tokens**,
so the quality limit is interpolated, not measured.

**Recommendation: enforce ≤512 tokens on the serialised `{"text": ...}` state**, which is
comfortably inside the 888 hard ceiling and far above real usage (my four full Telugu sentences were
30–47 serialised `{"text": ...}` state tokens `[RAN]`, `usage.state_tokens` in
`.ref/telugu_probe_output.json`). Reject or fall back to rules above the cap. Treat any accuracy claim at
512 tokens for Jadal's taxonomy as **UNVERIFIED** — it needs a labelled Jadal eval.

---

## 6. Licensing and practical constraints

| constraint | finding |
|---|---|
| **License** | Apache-2.0 `[READ]` `laya-lab/fork/LICENSE:1-4`; consistent with `ADR-001-004-stack.md:48`. |
| **Size** | 643,835,514 bytes (~614 MiB) `[RAN]`. Not the "1.6 GB" the research doc claims (`docs/research/deterministic-and-system1.md:151`) — that figure is wrong for the multilingual subfolder. |
| **CPU load** | **7.66 s** `[RAN]` (warm cache, 4 threads). laya-lab reports 7.222 s on GPU (`manifest.json`); upstream reports 2.5 s cold load on a 4-core EPYC (`BENCHMARKS.md:256`). |
| **CPU latency** | **653–1108 ms per message for all 4 questions** `[RAN]` (this laptop, 4 threads, fp32). That is a *sidecar* number, not the ~33 ms T4 figure in the research doc. laya-lab measured p50 0.0366 s on GPU at pad=1000 (`README.md:314-317`). |
| **GPU memory** | laya-lab reports peak 2.07 GiB allocated / 2.12 GiB reserved for the n=200 baseline (`README.md:250-252`) `[READ]`. |
| **Parameters** | 321,908,995 `[READ]` `manifest.json`. Encoder `jhu-clsp/mmBERT-base`, 22 layers, `max_position_embeddings=8192` `[RAN]` read of `models/multilingual/encoder/config.json` + `rl_agent_config.json`. |
| **Dependencies** | `torch`, `transformers`, `safetensors`, `numpy`, `huggingface_hub` `[READ]` `jadal-laya/services/laya/requirements.txt`. No exotic deps. |
| **Deployment** | Cannot run in a Worker. `apps/api/src/system1.ts:7-9` says so and `:319-322` reports `source: "rules"` rather than pretending. The ONNX route named in `ADR-001-004-stack.md:48` is **not ready**: `ONNXAgent` needs an exported `.onnx` (`fork/laya/onnx_agent.py:104`, "run export_onnx.py first") and **no `.onnx` file exists** `[RAN]`. Until one is exported, Laya requires the Python sidecar. |

### 6.1 Two integration defects found in the sidecar — fixed in ws/B-laya (PR #29)

Both defects below were identified during this evaluation and have been fixed in the sidecar
branch (`ws/B-laya`, PR #29). Recorded here for traceability.

1. **The sidecar passed the wrong object to `build_decision`.** `laya_service.py:113` returned the
   full `system_one` envelope and `laya_service.py:241` passed it straight to `build_decision`,
   which expects the inner `answers` map (`jadal_decision.py:212-214`). Every `/decide` call would
   have returned HTTP 502 `laya_answer_not_mapable`. Fixed by unwrapping the envelope before
   calling `build_decision`.
2. **`DEFAULT_MODEL` was a different HF repo id.** `laya_service.py:48` used
   `convaiinnovations/laya-multilingual`, whereas the checkpoint the brief and laya-lab pin is
   `convaiinnovations/laya` subfolder `multilingual`. Fixed: the service now defaults to
   `convaiinnovations/laya` with `subfolder="multilingual"`, with `LAYA_MODEL` env override.

---

## 7. Recommendation

**USE IT WITH LIMITS.**

- **Do** use the multilingual checkpoint for the `intent` `choice`, offline/via sidecar, on short
  Telugu messages, as an advisory signal behind a confidence gate.
- **Do** enforce **≤512 input tokens** (hard ceiling 888) and fall back to rules above it.
- **Do** run a labelled Telugu agricultural eval (≥200 real utterances, Jadal's 7 intents) before
  any claim that Telugu intent accuracy is adequate. Until then, treat Telugu as UNVALIDATED and
  keep the Sarvam translate-to-English path from `ADR-001-004-stack.md:56` available.
- **Do not** ship its `urgency` `score` or `is_release_time` `noul` as authoritative. On my probe
  the score never left band 2 for a "crop will die today" message, and the release-time `noul`
  false-positived on both urgent sentences (including the English control). Either re-fit the
  decision head on Jadal's labels (`arm2` in laya-lab — fine-tuning the shipped head, encoder
  frozen — is the only intervention laya-lab found that moved accuracy; `README.md:174-212`) or keep
  those two decisions on Jev/rules.
- **Do not** assume the long-context negative result disqualifies Laya for Jadal. It does not —
  Jadal's inputs are short. It bounds the input length, which is L3.

---

## 8. Source index

| claim | file:line |
|---|---|
| load signature | `laya-lab/experiments/harness/backends.py:47`; `laya-lab/fork/laya/agent.py:921` |
| call signature | `backends.py:59`; `agent.py:851-855,915` |
| question schema | `agent.py:861-865`, `agent.py:487-535` |
| return shapes | `agent.py:681-710`, `agent.py:820-824` |
| input sequence format | `laya-lab/fork/laya/common.py:88`, `:117-128` |
| 9 pool languages, no Telugu | `experiments/harness/pools/needles-balanced-v1.json`; `README.md:309-310,526` |
| short-context 0.840 / long collapse | `README.md:29,78-82,92-96`; `BASELINE.md:29` |
| head 45 tok → 978 window | `README.md:94-95,506` |
| GPU VRAM 2.07 GiB | `README.md:250-252` |
| baseline ran laya 0.3.20 / CUDA | `experiments/baseline-power-n200/manifest.json` |
| Telugu 0.220 @ 20 options | `fork/BENCHMARKS.md:80`; `fork/research/results/cpu_51_language_sweep.json` |
| macro 0.3661, 45/51 | `fork/BENCHMARKS.md:46-48` |
| non-Latin collapse, English ckpt | `fork/laya/lang.py:4-6`; Telugu script range `lang.py:30` |
| CPU latency 193 ms / load 2.5 s | `fork/BENCHMARKS.md:253-256` |
| calibration 0.314 → 0.106 | `fork/BENCHMARKS.md` calibration section |
| Apache-2.0 | `fork/LICENSE:1-4` |
| Jadal needs / open Telugu question | `docs/decisions/ADR-001-004-stack.md:47-56`; `docs/research/deterministic-and-system1.md:77,151` |
| Jadal System-1 tiering | `apps/api/src/system1.ts:5-17,306-323` |
| Jadal question set | `jadal-laya/services/laya/jadal_decision.py:76-116` |
| sidecar call sites | `jadal-laya/services/laya/laya_service.py:48,113,241` |

Raw probe output: `.ref/telugu_probe_output.json`. Scripts: `.ref/laya_telugu_probe.py`,
`.ref/state_room.py`.
