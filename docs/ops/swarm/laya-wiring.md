# Swarm report — laya-wiring (P3)

**Branch:** `ws/swarm-laya-wiring` · **Lane scope:** `apps/api|docs` · **Date:** 2026-10-02
**Task:** Handoff P3 — make `LAYA_ENDPOINT=http://127.0.0.1:8099/decide` wire the Laya tier, and
enforce in code that Laya owns `intent` + `mentions_crop_stress` only (`urgency` and
`is_release_time` stay out of the result; rules handle them).

No previous checkpoint existed for this task. The session harness auto-committed intermediate
states as `chore(laya-wiring): checkpoint`; those were rewritten into the two conventional
commits in §6 (the branch was reset with `--soft` to the handoff commit and the same files were
staged in two groups, so no content changed).

---

## 1. What changed

| File | Change |
|---|---|
| `apps/api/src/system1.ts` | `parseLayaDecision` **no longer reads** `urgency` or `is_release_time`. It returns `urgency: null` and the new exported `LayaDecision` type pins that (`readonly urgency: null`). `finishProviderCall` now takes `text` and fills a null urgency from `classifyByRules(text).urgency`. `callLaya`/`providerConfigured` use `layaEndpoint()` from `env.ts`. |
| `apps/api/src/env.ts` | New `layaEndpoint(env)` reader: trims, rejects blank/unparseable/non-`http(s)` values (=> `undefined`, i.e. `not_configured`, never a fetch), and strips a trailing slash. |
| `apps/api/src/system1.test.ts` | Updated the Laya parse/chain expectations (urgency now from rules); added a dedicated discard test; added success + HTTP 502 + timeout + malformed-body fall-through tests with an honest `source` assertion each. |
| `apps/api/src/env.test.ts` | Added `layaEndpoint` parsing cases (blank, documented URL, trailing slash, non-http/unparseable). |
| `apps/api/.dev.vars.example` | Documented `LAYA_ENDPOINT` with the local placeholder and the trust boundary. **Names/placeholder only; no secret.** |
| `apps/api/docs/LIVE.md` | New §4 "System-1 / Laya": how to enable it, how the URL is parsed, what Laya may decide, the failure taxonomy. |

`packages/contracts` was **not touched** (it is immutable). No water arithmetic was added. No
user-visible strings were added (docs/tests only).

---

## 2. The enforcement, in code

The handoff (`docs/HANDOFF-ENGINEERING.md` P3) and `docs/research/laya-verdict.md` L1 say Laya's
`urgency` score never left band 2 for a "crop will die today" message and its `is_release_time`
noul false-positived on Telugu (0.814) and an English control (0.778). Before this change
`parseLayaDecision` read Laya's `urgency` into the result.

Now:

- `parseLayaDecision` never mentions `is_release_time`, and never reads a payload urgency field.
  The returned `LayaDecision` type declares `urgency: null`, so a caller cannot ship a Laya score
  even by mistake.
- `finishProviderCall` computes the contract's required `urgency` as
  `decision.urgency ?? classifyByRules(text).urgency`. Jev supplies a number; Laya supplies `null`
  and therefore always gets the rules' urgency.
- `mentions_crop_stress` still uses Laya's answer when present, else the deterministic rules.
- `source` stays `"laya"` when Laya answered for intent/crop stress (honest: the model did run).

---

## 3. Evidence — commands and observed output

### RAN — the requested test command

```
$ pnpm --filter api exec vitest run src/system1.test.ts src/env.test.ts --maxWorkers=1
 RUN  v3.2.7 /home/parshu/projects/cis/jadal-w-laya-wiring/apps/api
 ✓ src/system1.test.ts (60 tests) 145ms
 ✓ src/env.test.ts (14 tests) 14ms
 Test Files  2 passed (2)
      Tests  74 passed (74)
```

### RAN — typecheck

```
$ pnpm --filter api typecheck
$ tsc --noEmit
(no output; exit 0)
```

### READ — where the trust boundary is implemented

- R1 `apps/api/src/system1.ts:549` `parseLayaDecision` returns
  `{ intent, intentConfidence, urgency: null, stressProbability: stress }`.
- R2 `apps/api/src/system1.ts:387` `export interface LayaDecision extends JevDecision { readonly urgency: null }`.
- R3 `apps/api/src/system1.ts` `finishProviderCall`: `const urgency = decision.urgency ?? classifyByRules(text).urgency;`.
- R4 `apps/api/src/env.ts:101` `export function layaEndpoint(...)`.
- R5 `apps/api/src/system1.ts:781` `callLaya`: `const endpoint = layaEndpoint(env); if (!endpoint) return { ok: false, reason: "not_configured" };`.

### COMPUTED — discard proof

The new test `discards Laya's urgency and is_release_time; the rules own both` feeds
`{ intent: "other", urgency: 0.99, is_release_time: true, ... }` and asserts
`decision.urgency === null` and `stressProbability === 0` (rules for `"hi"`, not the noul). A
companion chain test asserts `outcome.result.urgency === classifyByRules(text).urgency` and
`!== LAYA_OK.urgency` (0.9), for a Laya payload that reports urgency 0.9.

### RAN — stubbed fetch only

Every test in `system1.test.ts` routes through the injected `env.fetch` stub
(`apps/api/src/system1.test.ts:99`); no test opens a socket. `REAL_TELEPHONY` is untouched.
No external service, Twilio or Laya process was started.

---

## 4. What is NOT done / needs a human

1. **The Laya sidecar itself was not run or fixed.** `docs/research/laya-verdict.md` §6.1 records
   two sidecar defects in `services/laya` (wrong object passed to `build_decision`; `DEFAULT_MODEL`
   points at a different HF repo id). That is lane L's scope and this lane did not touch it (hard
   rule: lane scope `apps/api|docs`). If those defects are still present, `/decide` answers 502
   `laya_answer_not_mapable`; this lane's wiring correctly reports that as `http_error 502` and
   falls through, but end-to-end Laya use needs the sidecar fixed first.
2. **Telugu accuracy remains UNVALIDATED** (`laya-verdict.md` L2). No accuracy claim is made here.
3. **`is_release_time` has no `System1Result` field**, so "stay null" for it means "never read,
   never mapped"; it is not represented anywhere in the result. If the product later wants a
   release-time signal it needs a contract change (owner decision, not made here).
4. **`LAYA_ENDPOINT` is not declared in `wrangler.jsonc` `vars`**; locally `wrangler dev` reads
   `.dev.vars`. A deployed Worker needs the variable supplied by the deployment (a product/ops
   decision about which origin; not made here).

---

## 5. Reproduce

```bash
pnpm --filter api exec vitest run src/system1.test.ts src/env.test.ts --maxWorkers=1
pnpm --filter api typecheck
```

## 6. Commits

- `fix(system1): discard Laya urgency/is_release_time; trust intent+crop stress only` — code + tests.
- `docs(laya): document LAYA_ENDPOINT wiring and the trust boundary` — `.dev.vars.example`,
  `LIVE.md`, this report.

Every path was staged explicitly (never `git add -A`); all paths are inside the lane scope
`apps/api|docs`. The harness's intermediate `chore(laya-wiring): checkpoint` commits were rewritten
into these two (see the note at the top). Verify with `git log --oneline ws/swarm-laya-wiring`.
