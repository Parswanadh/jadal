# swarm: ratelimit-sliding

**Branch:** `ws/swarm-ratelimit-sliding` · **Lane:** `apps/api` + `docs` · **Handoff:** P10 (rate-limit
gaps), `docs/ops/CALL-SAFETY.md` §3/§6.

## What the task was

The call guard in `apps/api/src/noloop.ts` bounded a destination with **fixed** windows
(`floor(now / window)`), so a burst straddling a boundary could reach `2 × maxCalls`; and
`releaseCall` was a decrement of the shared counter, not a rollback of one call. Make the window
slide, keep the consume atomic, make release a true rollback, test both, and update
`CALL-SAFETY.md` §3/§6.

## What changed

| File | Change |
|---|---|
| `apps/api/migrations/0004_call_rate_hit.sql` | New **additive** migration: `call_rate_hit(id AUTOINCREMENT, destination, at)` + indexes. The `0003` `call_rate_window` table is left in place, unread. |
| `apps/api/src/db/schema.sql.ts` | Inlines `CALL_RATE_HIT_SQL` verbatim and adds it to `MIGRATION_SQL`. |
| `apps/api/src/db/store.test.ts` | Adds the byte-identical 0004 assertion and updates the `MIGRATION_SQL` join assertion. |
| `apps/api/src/noloop.ts` | Sliding-window guard. `CALL_RATE_TABLE = "call_rate_hit"`. Consume is one statement: `INSERT … SELECT … WHERE (SELECT COUNT(*) … at > now - windowMs) < max RETURNING id, (same count) AS n`. `CallDecision` gains `token` (the inserted row id). `releaseCall(env, to, token)` is a `DELETE … WHERE id = ? AND destination = ?`; without a token it is a no-op. `windowKeyAt`/`releaseKey` removed; `pruneCallRateWindows` → `pruneCallRateHits` (deletes by `at` age). |
| `apps/api/src/noloop.test.ts` | Rewritten where the old fixed-window semantics were asserted; adds fake-timer boundary tests, per-slot sliding tests, token-scoped rollback tests, and prune tests. |
| `docs/ops/CALL-SAFETY.md` | §1 recovery table/delete, §3 design + known limits, §5 test table, §6 all updated to the sliding/rollback reality. Also corrected the stale §3 claim that the guard keys on `input.to` **before** forwarding — the code keys on `forwardTargetForFarmer` (commit `c29c8c6`), i.e. the number that actually rings. |

### Why it is still atomic

`INSERT INTO call_rate_hit … SELECT … WHERE (SELECT COUNT(*) …) < max` is one SQL statement, so
SQLite executes it inside one write transaction: the count condition and the insert cannot separate.
The permission is *whether `RETURNING` produced a row*. The refusal's `SELECT` remains descriptive
only. This is the same atomicity argument as the fixed-window version, with a per-hit log instead of a
window bucket.

### Why release is now a rollback

The consume returns the `id` of the row it inserted (`CallDecision.token`). `releaseCall` deletes
that row and only that row, so it cannot free a slot another caller is holding. Without a token it
does nothing: there is no longer a shared counter to decrement, and a decrement could not name which
call it was undoing. `AUTOINCREMENT` keeps a pruned id from being reused, so a stale token cannot
alias a newer call.

## Evidence

### RAN — required test command

```
$ pnpm --filter api exec vitest run src/noloop.test.ts src/telephony-deps.test.ts --maxWorkers=1
 ✓ src/telephony-deps.test.ts (13 tests) 145ms
 ✓ src/noloop.test.ts (49 tests) 100ms
 Test Files  2 passed (2)
      Tests  62 passed (62)
EXIT=0
```

### RAN — with the schema-freshness test (I edited `store.test.ts`)

```
$ pnpm --filter api exec vitest run src/noloop.test.ts src/telephony-deps.test.ts src/db/store.test.ts --maxWorkers=1
 Test Files  3 passed (3)
      Tests  91 passed (91)
```

`store.test.ts` is the byte-identical check between `migrations/0004_call_rate_hit.sql` and the
inlined `CALL_RATE_HIT_SQL`; it passing is what proves the shipped SQL is the file on disk.

### RAN — typecheck

```
$ pnpm --filter api typecheck
$ tsc --noEmit
EXIT=0
```

### RAN — SQL shape verified directly in `node:sqlite` before writing the guard

```
$ node /tmp/sqlite-test.mjs
t= 0 rows= [{"id":1}]
t= 12000 rows= [{"id":2}]
t= 25000 rows= [{"id":3}]
t= 40000 rows= []            # 4th call in the trailing 60 s refused
DELETE … by id keeps the other rows
```

Confirms `INSERT … SELECT … WHERE (COUNT) < ? RETURNING id, (subquery) AS n` is accepted and that the
subquery in `RETURNING` is allowed. (Throwaway script in `/tmp`, not committed.)

### READ — the boundary arithmetic

Old fixed window, calls at `B−1s`, `B−1s`, `B−1s`, `B+1s`, `B+1s`, `B+1s`: the third pair lands in the
next bucket and the old statement's `n < 3` test is fresh, so **6** are allowed. New sliding count at
`B+1s` sees all three `B−1s` calls inside `now − 60 s`, so the fourth attempt is refused: **3**
allowed. The fake-timer test `does not reset the budget at a fixed boundary…` asserts exactly
`[true,true,true,false,false,false]`.

### COMPUTED — no behavior change under the limit

For any sequence with no call inside the trailing window, `COUNT(*) = 0 < max` and the insert
succeeds, exactly as before. `retryAfterAt` is now `oldest + windowMs` (the oldest counted call's
expiry) rather than the fixed window's end; the measured 01:45 burst `[0,12,25,40]s` still returns
`[true,true,true,false]` and its refusal still names `T0+60s`, because the oldest call was at `T0`.

## Safety

* No network is touched by the tests: the harness `fetch` throws on any unrouted URL, and the two
  call-path suites assert `env.calls` did not grow. `REAL_TELEPHONY` is false in this environment.
* No water arithmetic (none involved); no contract changes (`packages/contracts` untouched); no new
  user-visible strings (so no i18n keys).
* Only `apps/api/**` and `docs/**` were staged/committed, matching `LANE_SCOPE`.

## Left / needs a human

1. **Apply migration `0004` to a real DB.** Not run here (it would touch the live database):
   `pnpm --filter api migrate:local` (and the remote migrate step on deploy). Until it is applied,
   the guard's consume fails and — under the shipped fail-open default — calls are allowed. That is
   the documented failure mode, not a crash, but the limit is not in force.
2. **Schedule `pruneCallRateHits()`.** The hit log now grows one row per counted call. The prune is
   implemented and tested but no cron/operator command calls it. On a busy deployment a human should
   wire a scheduled prune (or run it periodically); until then the limit is correct but the table
   grows. This is an infra/owner call, not decided here.
3. **`releaseCall` is wired to nothing.** No production call site passes a token yet, so the rollback
   is available but unused; today a transport-refused call still spends its slot (the pre-existing,
   documented behaviour). Deciding *when* to release — e.g. after `placeCall` returns `{ok:false}` in
   the escalation ladder or coordinator alert — changes counting semantics and is left to an owner.
4. **Drop `call_rate_window`?** `0003`'s table is left in place and unread; removing it is a
   non-additive migration and an owner decision, so it was not done.
5. **Pre-existing, unrelated:** `REAL_TELEPHONY` / trial-account items in the handoff (P1) are untouched.

## Commits

The harness checkpointed intermediate states (`chore(ratelimit-sliding): checkpoint` × 4) while this
lane worked; all of them touch only the five files above. The final conventional commit is
`feat(api): sliding-window call limit with true slot rollback`. Nothing was pushed; the branch is
`ws/swarm-ratelimit-sliding`.
