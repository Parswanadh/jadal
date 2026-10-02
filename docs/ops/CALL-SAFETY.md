# CALL-SAFETY.md — bounding outbound calls

**Status:** enforced · **Owner:** lane `ws/B-noloop` (atomic counter: `ws/B-noloop-atomic`) · **Code:**
`apps/api/src/noloop.ts`, `apps/api/src/telephony-deps.ts`,
`apps/api/migrations/0003_call_rate_limit.sql`

Jadal placed **36 outbound calls in one session**, all `direction=outbound-api`, four of them inside
40 seconds:

| Cluster | Calls | Window |
|---|---|---|
| 01:45 | **4** | 40 s |
| 01:00 | 3 | 60 s |
| 00:59, 01:02, 01:24, 01:39 | 2 each | — |

This document is the safety case for the change that bounds that. It is written to be read during an
incident: §1 is what to do if calls run away again, §2–3 are the bound and the design, §4 is the
decision that most needs justifying.

---

## 1. If calls run away again, do this

In order, fastest first. **Step 1 stops the dialling outright and needs no deploy.**

1. **Kill switch — switch off real telephony.** Set `REAL_TELEPHONY` to `0` in the orchestrator's
   `.dev.vars` and restart `wrangler dev`. `realCallsEnabled()` in `apps/api/src/telephony/twilio.ts`
   then returns false, `placeCall` returns `{ simulated: true }` **before** any fetch, and *no call
   site anywhere in the API can reach Twilio*. This is the one lever that does not depend on any
   bounded path being correct. (This is the same switch that is already `false` in the demo.)
2. **Tighten the guard without a deploy.** Set `CALL_RATE_MAX_CALLS=1` and
   `CALL_RATE_WINDOW_SECONDS=3600`. The guard reads its config on every call, so the next dial is
   held to one per destination per hour. This is the backstop scaling down to a near-total stop.
3. **Read the refusal log.** Every refusal is one grep-able line:
   `noloop: <label> — rate limited: <number> already has N call(s) in the last 60s (limit M)`. The
   `<label>` names the path (`escalation <contactId>` or `coordinator-alert <purpose>`), which tells
   you *which* caller is looping without reading any code.
4. **Find the unbounded caller.** The two entry points are `POST /api/requests` (raises → coordinator
   call), `POST /api/requests/:id/decide` (approval → farmer call), `POST /api/alerts` (coordinator's
   own button), and the `jadal-outbound` queue consumer. Whichever `<label>` repeats is the culprit.
5. **Check the queue.** The consumer in `apps/api/src/index.ts` already caps redelivery at
   `MAX_QUEUE_ATTEMPTS = 2` (one retry, then drop with a `jadal-outbound: dropping contact …` line).
   If you see that line repeating for many different contacts, the loop is upstream of the queue.
6. **Clear the counters if the guard is over-blocking** during the incident. The counter now lives in
   **D1**, in the `call_rate_hit` table, keyed by the destination's digits and the instant of each
   call — the KV keys this step used to name (`callcap:v1:<digits>`) **no longer exist**. To clear one
   handset:

   ```sh
   npx wrangler d1 execute jadal-db --command \
     "DELETE FROM call_rate_hit WHERE destination = '<digits>'"
   ```

   The digits are the destination with every non-digit stripped (`+91 90000 00001` → `919000000001`),
   the same key `destinationKey()` in `apps/api/src/noloop.ts` produces. Rows are also disposable by
   age — a call more than a window old is never counted again, and `pruneCallRateHits()` deletes them —
   so **doing nothing is always safe**: every row stops mattering one window after it was written.
   (`call_rate_window`, the fixed-window table from `0003`, still exists but is no longer read.)

**What NOT to do:** do not raise `CALL_RATE_MAX_CALLS` to make a call go through during an incident.
If the guard is refusing a call you believe is legitimate, the guard is telling you that path has
already dialled that person more than the budget allows — read the label before overriding.

---

## 2. Every call site, and the bound on each

There are **two** call sites, and both now pass through the shared guard. This was verified by
grepping for the dial primitive across `apps/api/src` — `placeCallIfAllowed` in
`apps/api/src/telephony-deps.ts` is the only way either reaches `placeCall`:

| # | Call site | Path it is reached from | Bound **before** this change | Bound **now** |
|---|---|---|---|---|
| 1 | `campaigns/escalation.ts` → `runEscalation` (voice rung) | `jadal-outbound` queue consumer | Per **contact id**: `nextEscalation` caps at 4 rungs (voice → 15-min voice retry → message → escalate), and `deterministicId("contact", id, attempt)` makes a re-run idempotent. The queue caps redelivery at 2. | Ladder bounds **plus** per-destination: ≤ `CALL_RATE_MAX_CALLS` (3) dials per `CALL_RATE_WINDOW_SECONDS` (60 s) to that handset, across *all* contacts naming it. |
| 2 | `coordinator-alert.ts` → `dispatch` (coordinator alert, farmer allocation, allocation alert) | `POST /api/requests`, `POST /api/requests/:id/decide`, `POST /api/alerts` | **None.** Each HTTP request placed one call; N requests placed N calls. Nothing correlated them. | Same shared per-destination budget. |

### What stops each one repeating (task 1, answered directly)

**Call site 1 — the escalation ladder.** Three independent bounds, and they compose:

* **Attempt count** — `nextEscalation` returns `escalate` (a portal flag, no dial) once
  `priorAttempts >= 3`, and `runEscalation` returns `null` for a contact already `acknowledged` or
  `escalated`. A single chain therefore places **one** voice call, not a loop.
* **Idempotency** — the next contact's id is `deterministicId("contact", current.id, nextAttempt)`, so
  a Workflow retry or two racing workers derive the *same* id and the duplicate `contact.updated`
  append is caught and treated as already done. Re-running the same rung returns the existing contact.
* **Queue redelivery** — `MAX_QUEUE_ATTEMPTS = 2` in `index.ts`: one retry, then the message is
  dropped and logged. *(Fixed before this lane; not redone.)*

**The hole that the ladder's own bounds cannot see:** they are all keyed on a *contact id*. Two queue
messages naming **different** contacts for the **same farmer** — or the same request submitted twice,
or a Workflow retry that derives a fresh chain — each satisfy every rule above while ringing one
handset repeatedly. That is precisely the 01:45 burst: four calls that are each, individually, a
legitimate first rung. Bounding the ladder harder does not close it; bounding the **destination** does.

**Call site 2 — the coordinator alert.** Nothing bounded it at all: `POST /api/alerts` called
`notifyFarmerOfAlert` once per HTTP request, and `dispatch` dialled every time. A double-clicked
button, a retried fetch, or two coordinators acting on one request produced N calls in N × latency.
This is the likeliest single source of the 01:45 burst (four calls in 40 s is well within the latency
of four queued HTTP requests, and far below the ladder's 15-minute minimum gap).

> **Conclusion for task 1: the escalation ladder was already bounded and is *not* the source of the
> burst.** The unbounded path was the coordinator-alert direction — most plausibly a repeated
> `POST /api/alerts` / `/decide` — and the ladder's per-contact bounds were structurally blind to it.
> Both are now bounded by one shared, destination-keyed budget.

---

## 3. The rate-limit design

`apps/api/src/noloop.ts`. One guard, beneath every path.

### Rule

> No destination is dialled more than **`CALL_RATE_MAX_CALLS`** times within
> **`CALL_RATE_WINDOW_SECONDS`** — regardless of which path asks.

### Configuration

| Env var | Default | Meaning |
|---|---|---|
| `CALL_RATE_MAX_CALLS` | **3** | Dials allowed per destination per window. |
| `CALL_RATE_WINDOW_SECONDS` | **60** | The window, in seconds. |

Read at call time, not at module load, so an operator can tighten the limit during an incident
without a deploy (§1 step 2). Unset or blank falls back to the default. A **non-numeric, zero or
negative** value also falls back to the default *and* is reported in the decision's `detail`
(`ignoring unusable CALL_RATE_MAX_CALLS; using defaults`) — a typo that silently disabled the
backstop is the exact failure this file exists to prevent, so it must not be silent.

**Why 3 per 60 s.** Not a round number chosen for looks:

* The ladder's *designed* worst case for one contact is **three** voice-capable dials (initial, the
  15-minute retry, and the last-resort voice rung before the coordinator flag). Those are ≥ 15
  minutes apart, so they never contend for one 60-second window — a limit of 3 can never refuse a
  legitimate designed sequence.
* The measured worst burst was **four** calls in 40 seconds. A limit of 3 cuts that burst at exactly
  the fourth call, which is the call the incident brief asks to be blocked.
* Defaults are therefore the *tightest value that admits every designed behaviour*, which is the
  right bias for a limit that costs money and rings a person when it is wrong.

### Destination identity

The counter key is the destination's **digits** (`destinationKey`): `+919000000001`,
`+91 90000 00001` and `tel:+919000000001` are one handset and share one budget. Without this, a caller
could spend the budget three times over by formatting one number three ways. It mirrors
`phoneKey` in `telephony-deps.ts` for the same reason.

### Where the counter lives, and why it is atomic

The counter is the `call_rate_hit` table in **D1** (`env.DB`), created by migration
`0004_call_rate_hit.sql`. **One row per counted call**, with an autoincrement `id` (the rollback
token), the destination's digits, and the instant of the call:

| Column | Meaning |
|---|---|
| `id` | The rollback token. `releaseCall` deletes exactly this row. `AUTOINCREMENT` so a pruned id is never reused and a stale token cannot alias a later call. |
| `destination` | The dialled destination's digits — the budget key. |
| `at` | The call's instant, epoch milliseconds. The budget is the count of rows with `at > now − windowMs`. |

**The budget is consumed by one statement, and that statement is the whole guarantee:**

```sql
INSERT INTO call_rate_hit (destination, at)
SELECT ?1, ?2
 WHERE (SELECT COUNT(*) FROM call_rate_hit
         WHERE destination = ?1 AND at > ?2 - ?3) < ?4
RETURNING id, (SELECT COUNT(*) FROM call_rate_hit
                WHERE destination = ?1 AND at > ?2 - ?3) AS n
```

It is one SQL statement, so SQLite runs it inside a single write transaction: another request's
`INSERT` for the same destination cannot interleave between the `COUNT(*) < ?4` test and the insert.
There is no instant at which two callers both observe room. D1 serialises writes to a database through
one instance, which is the premise this design shares with the fixed-window version.

The guard's permission is *whether that row came back*. `first()` returning `null` means refused;
returning a row means the slot was spent. Nothing re-reads the count to decide — a read-back is
exactly the race this replaced. The refusal path's single `SELECT` is descriptive only (it supplies
`priorCalls` and `retryAfterAt` for the message) and cannot turn a refusal into an allow.

### The window slides

`at > now − windowMs` is measured backwards from *each* attempt, so the window is a trailing span, not
a bucket with a wall-clock boundary. A spent slot frees exactly one window after the call that spent
it, so a burst that straddles a boundary gets **one** budget, not two: the `2 × maxCalls` hole the
fixed-window design had is closed. Slots free **one at a time**, and `retryAfterAt` is the moment the
oldest counted call ages out.

**Why this replaced fixed windows.** The previous D1 guard counted `floor(now / window)` in one row
per `(destination, window)` and consumed it with `INSERT … ON CONFLICT … WHERE n < ?`. That was atomic
and correct for a burst inside one window, but it reset the whole budget at each boundary (up to
`2 × maxCalls`), and its `releaseCall` decremented a shared counter, which could hand back a slot
another caller had just taken. D1 is SQLite, so per-hit rows and a `COUNT(*)` condition cost one
indexed range scan and keep the single-statement guarantee. The `0003` table `call_rate_window` is
left in place but is no longer read.

**The KV story still matters.** The guard originally stored its counter in KV, which has **no atomic
increment**. Two callers reading the same counter in the same instant both wrote `1` and both were
allowed; measured against that guard, **12 simultaneous calls to one handset were all allowed**.
Against this one, exactly 3 are. See §5 for the tests.

### Where it is enforced

`placeCallIfAllowed()` in `telephony-deps.ts` is the single seam. It:

1. resolves the number that will **actually ring** (`forwardTargetForFarmer`) and keys the budget on
   that, so a demo forward target shared by several farmers also shares one budget;
2. calls `checkOutboundCall(env, destination)`;
3. logs the decision (`noloop: <label> — <detail>`, `console.warn` on refusal);
4. returns `{ allowed: false, refusal }` **without calling `placeCall`** when refused, or
   `{ allowed: true, decision, placed }` otherwise.

The caller cannot reach a `PlaceCallResult` without branching on `allowed` — the type is a
discriminated union, so the guard cannot be made cosmetic by accident.

The counter is **consumed by the guard itself**, not by the caller, so no path can opt out of the
budget. `releaseCall(env, destination, decision.token)` deletes **exactly the row that call inserted**
— a true rollback. Without the token it is a no-op: there is no longer a shared counter to decrement,
and a decrement was never a rollback. *(No production path calls `releaseCall` today; it is used when
a caller gets permission and then finds a reason not to dial.)*

### Bound on the table

Per-call rows grow with traffic (one row per counted call), so unlike the fixed-window table this one
is **not** self-limiting. `pruneCallRateHits()` deletes rows older than `keepWindows × windowMs` (two
windows by default), which can no longer affect a decision, and is deliberately **not** called from
the guard: that would put a table-wide `DELETE` inside the request-critical path. The limit stays
correct without it — the table is just larger.

### Refusal is visible, never silent

A rate limit that silently drops a call is worse than the burst it prevents: the coordinator's phone
never rings, nothing says why, and the request looks handled. So a refusal is a value:

| Where | How the refusal surfaces |
|---|---|
| The decision | `CallDecision { allowed: false, reason: "rate_limited", priorCalls, maxCalls, windowSeconds, retryAfterAt, detail }` |
| The log | `noloop: escalation <id> → +91… — rate limited: +91… already has 3 call(s) in the last 60s (limit 3)` |
| The ladder | The rung's contact is written back as **`failed`** — not `queued`/`sent` — so the coordinator's contact list shows the farmer was **not** reached. The rung still progresses and is still handed to `OUTBOUND`; the guard bounds the *dial*, it does not redesign the ladder. |
| The coordinator alert | The outcome returns `skipped: "refused by the call rate limit — …"`, `alerted: false`, `placed: null`, and **no audit `Contact` row** — so nothing in the trail claims a call that never happened. |

### Known limits (reported, not papered over)

* **The hit log grows with traffic.** One row per counted call. `pruneCallRateHits()` must be run
  periodically on a busy deployment to reclaim space; until it is, the table is larger but every
  decision is still correct (old rows simply stop counting).
* **The limit is per D1 database.** Atomicity is SQLite's, and it holds because every request for a
  deployment reaches the same D1 instance. A future move to read replicas *for the counter* would
  reintroduce the race; the counter must be read and written on the primary.
* **It bounds calls, not spend.** Two *different* destinations each get a full budget, so the guard
  caps calls per person, not the total number of calls. A loop that iterates the whole roster is not
  stopped by this guard.

---

## 4. The fail-open / fail-closed decision

**Decision: the guard FAILS OPEN.** If the counter store cannot be used, the call is **allowed** and
the exception is reported (`reason: "counter_unavailable"`, `checked: false`, logged as a warning).

`RATE_LIMIT_FAILURE_MODE` in `apps/api/src/noloop.ts` is the single constant; change it there.
`"closed"` is implemented and returns `allowed: false` with the same reporting shape.

### This was re-examined when the counter moved to D1

The decision was made for a **KV** counter and has been re-argued for **D1**, because one premise
genuinely changed and it would be dishonest to carry the old justification over unexamined.

**What changed: D1 is not a peripheral cache, it is the store the app already needs to function.**
Under KV, a counter-store outage was an isolated event: the ladder could still read its contact, the
alert could still read the farmer, and an emergency call could still go out correctly. So "a store
outage is uncorrelated with a call loop" was true, and it was load-bearing. Under D1 that argument
**weakens**: if D1 is unreachable then `appendEvent` is failing too, the ladder cannot read the
contact it is escalating, and the alert cannot read the farmer. The outage and a burst can now share a
cause, because the same failing database is what an app-level retry storm would be retrying against.
Anyone relying on the old correlation argument should stop: it no longer holds in the form it was
written.

**The conclusion is nevertheless unchanged, for a reason that does not depend on correlation.**
Failing open and failing closed are not symmetric costs, and that asymmetry survives the move:

* **Failing closed turns a database blip into a silently dropped emergency call.** A night-release
  warning nobody receives, in a state where the audit trail records the contact as merely `failed` —
  indistinguishable from a bad number. Nothing retries it and nobody is paged.
* **Failing open degrades to exactly the pre-guard behaviour** for the duration of the outage, and the
  pre-guard state still has the ladder's attempt cap, its per-contact idempotency, and the queue's
  `MAX_QUEUE_ATTEMPTS = 2` redelivery cap. The realistic downside is a burst of the same magnitude as
  the one already had, not an infinite loop.

Failing open loses a backstop; failing closed loses the emergency. A burst is bounded and visible; a
dropped emergency call is neither.

**D1 actually narrows the residual risk, which is the second reason not to flip.** With the migration
applied, a guard failure means D1 itself is unreachable — and in that state the request that would
place the call is failing on its own next step anyway (it cannot write the contact, the ledger or the
audit row). The guard is not the only line of defence and usually not the first to break, so the
window in which the guard is open *and* the app is otherwise healthy is small. Under KV, by contrast,
the guard could be the only thing broken.

**Money is the smaller consideration, and it still points the same way.** Every call costs money, so a
burst is a real cost — but a burst is bounded by the pre-existing caps and is *visible* (Twilio's log,
the `noloop:` lines), whereas a dropped emergency call is neither bounded nor visible. When a spent
rupee and an unreached farmer are both possible, this product should spend the rupee.

**A note on the asymmetry being deliberate, not lazy:** the guard is *strict* where it can see state
and *permissive* where it cannot. That is the correct direction for a backstop whose primary control
(the ladder) is still in force underneath it.

### When to revisit

Flip to `"closed"` if **any** of these becomes true:

* the guard becomes the *primary* control (e.g. the ladder's attempt cap is removed or loosened);
* a D1 outage is demonstrated to coincide with a call loop, or the guard is found to be routinely
  unavailable in practice;
* the calls become non-urgent (marketing, surveys) where a dropped call costs nothing but money — then
  the calculus inverts and failing closed is right.

---

## 5. Tests

`apps/api/src/noloop.test.ts` (49 tests, up from 23). Every test stubs the network: the harness's
injected `fetch` **throws** on any unrouted URL, and the only Twilio URL ever reached is served a
canned `Response`. Refusal tests additionally assert `env.calls` did **not** grow, so "the guard
blocked the call" is proven by the absence of a request, not by a returned flag. The counter store is
the in-memory D1 shim with the real migrations applied, so the atomic statement is executed by SQLite
itself rather than by a mock of it. **No real call can be placed by the test suite.**

| Requirement | Test |
|---|---|
| **Simultaneous calls are bounded** (the reported defect) | `allows EXACTLY max calls when N are fired simultaneously at one destination`, `allows exactly N when N simultaneous calls are fired with max N`, `bounds repeated rapid presses: 30 simultaneous requests…`, `keeps separate destinations independent under simultaneous load`, `still refuses sequentially after a simultaneous burst` |
| **The consume is genuinely atomic** | `consumes the budget with a single conditional INSERT ... SELECT ... WHERE (COUNT) < ?`, `has no read-then-write anywhere on the guard's path`, `doesn't condition the insert on a value read in JavaScript`, `inserts exactly max rows under a burst, and the count refuses the rest` |
| **The window slides, so a boundary cannot double the budget** | `does not reset the budget at a fixed boundary: a straddling burst cannot reach 2 x maxCalls` and `frees a slot exactly one window after the oldest call, under the real clock path` (both fake-timer, through the production `new Date()` path), `frees slots one at a time…`, `counts against the trailing window only…` |
| The same bound holds at both call sites, simultaneously | `path 1: simultaneous rungs to one handset are bounded too`, `path 2: three simultaneous alerts dial once and make one Twilio request` |
| Guard blocks the 4th call in a burst | `blocks the 4th call in a burst, and the first three are allowed` (the measured 01:45 shape) |
| The budget ages out a window after each call | `is completely fresh once every call has aged out, a window after the last one` |
| **releaseCall is a true rollback, not a decrement** | `rolls back exactly the slot the call consumed…`, `deletes only the token's row, so a stale release cannot free another caller's slot`, `is a no-op without a token, and never throws on an unknown one` |
| Both call paths go through it | `path 1 (escalation ladder)…`, `path 2 (coordinator alert)…`, `the two paths share one budget for one handset` |
| A refused call is reported, not swallowed | `path 1` (contact recorded `failed`), `path 2` (`skipped` set, `alerted: false`, no audit row) |
| The 15-minute retry still works | `does not break the designed 15-minute voice retry` |
| One handset, three spellings, one budget | `spends the budget once per spelling of one number` |
| Configurable N and window | `makes N and the window configurable by env`, `honours a tighter limit…`, `honours a longer window…` |
| The hit log can be pruned | `pruneCallRateHits` — `deletes hits that can no longer count, and keeps the ones inside the trailing window` |
| Failure mode, both ways | `fails open and SAYS so when the counter cannot be written`, `fails open when the binding throws synchronously…`, `fails open when there is no DB binding at all`, `still refuses correctly when only the descriptive read-back fails` |

**The concurrency tests were shown to fail against the old KV guard.** Running the identical
assertion (12 calls fired through one `Promise.all`, max 3) against the pre-change guard in
`git show 50d7e90:apps/api/src/noloop.ts` allowed **all 12**; the same burst against this guard allows
**exactly 3**. The old guard was correct for a *sequential* burst — `[0, 12, 25, 40]s` still returns
`[true, true, true, false]` — which is why the defect was invisible until the calls were placed
concurrently. The fixed-window D1 guard fixed that race but still reset at a wall-clock boundary; the
fake-timer boundary tests pin the sliding behaviour that replaced it. The KV demonstration was
throwaway (deleted, not committed); the D1 tests are permanent.

---

## 6. Anything that could not be bounded

* **Hit-log growth** — the sliding window stores one row per counted call rather than one per
  destination per window, so a busy deployment accumulates rows. The limit is always correct (old rows
  stop counting once they are a window old); `pruneCallRateHits()` reclaims the space and is
  deliberately off the guard's path. See §3 "Bound on the table".
* **Total spend across many destinations** — the guard is per-destination. A loop that walks the
  roster one farmer at a time would place one legitimate-looking call per person. The natural next
  bound is a *canal-wide* budget (a second row per window, keyed by the canal instead of the handset),
  which this design supports by adding a second `checkOutboundCall` call; it was not added because no
  evidence in the incident points at a roster-walking loop and an unmeasured second limit is a limit
  that refuses good calls.
* **Workflow-level re-entry** — `apps/api/src/campaigns/workflows.ts` schedules work by contact, and
  its bounds were not in this lane's exclusive scope (`apps/api/src/campaigns/**` is shared with the
  re-plan path). The destination guard sits underneath it regardless, so a workflow re-entry that
  reaches a dial is bounded even though the scheduling itself was not audited here. **Flagged as
  unverified rather than claimed bounded.**
