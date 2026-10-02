# CALL-SAFETY.md — bounding outbound calls

**Status:** enforced · **Owner:** lane `ws/B-noloop` · **Code:** `apps/api/src/noloop.ts`,
`apps/api/src/telephony-deps.ts`

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
6. **Clear the counters if the guard is over-blocking** during the incident. The keys are
   `callcap:v1:<digits>` in the `CACHE` KV namespace
   (`npx wrangler kv key delete --binding CACHE "callcap:v1:<digits>"`). The key name is produced by
   `rateLimitKey()` in `apps/api/src/noloop.ts`; they also expire on their own after
   `window + 60 s`, so doing nothing is always safe.

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

The guard counts the number **after** `TWILIO_FORWARD_TO` is applied? **No — before.** The guard is
called with the farmer's registered number (`input.to`), while `placeCall` applies the forward
override internally. During a demo with one forward target this means several *farmers* can share one
physical handset while each keeps a full budget. That is deliberate: the demo mapping is a
presentation device, and per-farmer budgets are what the production rule means. It is called out here
so it is not mistaken for a gap — see §5.

### Where it is enforced

`placeCallIfAllowed()` in `telephony-deps.ts` is the single seam. It:

1. calls `checkOutboundCall(env, input.to)`;
2. logs the decision (`noloop: <label> — <detail>`, `console.warn` on refusal);
3. returns `{ allowed: false, refusal }` **without calling `placeCall`** when refused, or
   `{ allowed: true, decision, placed }` otherwise.

The caller cannot reach a `PlaceCallResult` without branching on `allowed` — the type is a
discriminated union, so the guard cannot be made cosmetic by accident.

The counter is **consumed by the guard itself**, not by the caller, so no path can opt out of the
budget. `releaseCall()` exists to give a slot back for a call that was counted but never dialled.

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

* **KV is eventually consistent and has no atomic increment.** Two genuinely simultaneous callers can
  both read the same counter and both be allowed. The guard is *exact* for the sequential bursts that
  actually occurred (calls seconds apart) and *best-effort* for a simultaneous race. It is a backstop,
  not a mutex; the ladder's attempt bounds remain the primary control. Making it atomic needs a
  Durable Object — a binding change owned by another lane.
* **A cold read under-counts.** A TTL-expired key is indistinguishable from a fresh destination, so
  the first call after a quiet spell always succeeds. That is the intended reading of "N per window".
* **It bounds calls, not spend.** Two *different* destinations each get a full budget, so the guard
  caps calls per person, not the total number of calls. A loop that iterates the whole roster is not
  stopped by this guard.

---

## 4. The fail-open / fail-closed decision

**Decision: the guard FAILS OPEN.** If the counter store cannot be read, the call is **allowed** and
the exception is reported (`reason: "counter_unavailable"`, `checked: false`, logged as a warning).

`RATE_LIMIT_FAILURE_MODE` in `apps/api/src/noloop.ts` is the single constant; change it there.
`"closed"` is implemented and returns `allowed: false` with the same reporting shape.

### Why, for a product where every call costs money and rings a real person

The question is not "which is safer in general" — it is **which failure can we afford to be wrong
about**, and the answer follows from what this product does with a call.

**Failing closed turns an infrastructure blip into a silently dropped emergency call.** Jadal's calls
are not marketing: they are night-release warnings ("water is coming at 23:00, be ready"), approval
prompts to the coordinator, and allocation notices. A refused call here is a farmer who does not
learn the canal is releasing, or a coordinator who does not learn a request is waiting. That harm is
**invisible and unbounded** — nothing retries it, nobody is paged, and the failure looks like success
in the audit trail (the contact is simply `failed`, indistinguishable from a bad number).

**Failing open degrades to exactly the behaviour that already shipped.** With the counter unreadable,
the system reverts to the pre-guard state — and the pre-guard state still has the ladder's attempt
cap, its per-contact idempotency, and the queue's `MAX_QUEUE_ATTEMPTS = 2` redelivery cap. Failing
open is therefore not "unbounded"; it is "bounded by everything except the new backstop", for the
duration of a KV outage. **The realistic downside is a burst of the same magnitude as the one we just
had, not an infinite loop.**

**The two risks are not symmetric.** Failing closed risks *losing the calls that matter most* on any
KV hiccup. Failing open risks *repeating a burst* during a KV hiccup — and a KV hiccup is not
correlated with a call loop. A loop is caused by a duplicate request or a retry storm; those are
application bugs and they do not wait for KV to be down. So the failure that failing-closed protects
against is a coincidence, while the failure it causes is certain on every store blip.

**Money is the smaller consideration, and it still points the same way.** Every call costs money, so
a burst is a real cost — but a burst is bounded by the pre-existing caps and is *visible* (it shows up
in Twilio's log and in the `noloop:` lines), whereas a dropped emergency call is neither bounded nor
visible. When a spent rupee and an unreached farmer are both possible, this product should spend the
rupee.

**A note on the asymmetry being deliberate, not lazy:** the guard is *strict* where it can see state
and *permissive* where it cannot. That is the correct direction for a backstop whose primary control
(the ladder) is still in force underneath it.

### When to revisit

Flip to `"closed"` if **any** of these becomes true:

* the guard becomes the *primary* control (e.g. the ladder's attempt cap is removed or loosened);
* a KV outage is demonstrated to coincide with a call loop, or the guard is found to be routinely
  unavailable in practice;
* the calls become non-urgent (marketing, surveys) where a dropped call costs nothing but money — then
  the calculus inverts and failing closed is right.

---

## 5. Tests

`apps/api/src/noloop.test.ts` (23 tests). Every test stubs the network: the harness's injected `fetch`
**throws** on any unrouted URL, and the only Twilio URL ever reached is served a canned `Response`.
Refusal tests additionally assert `env.calls` did **not** grow, so "the guard blocked the call" is
proven by the absence of a request, not by a returned flag. **No real call can be placed by the test
suite.**

| Requirement | Test |
|---|---|
| Guard blocks the 4th call in a burst | `blocks the 4th call in a burst, and the first three are allowed` (the measured 01:45 shape) |
| Resets after the window | `resets after the window` |
| Both call paths go through it | `path 1 (escalation ladder)…`, `path 2 (coordinator alert)…`, `the two paths share one budget for one handset` |
| A refused call is reported, not swallowed | `path 1` (contact recorded `failed`), `path 2` (`skipped` set, `alerted: false`, no audit row) |
| The 15-minute retry still works | `does not break the designed 15-minute voice retry` |
| Configurable N and window | `makes N and the window configurable by env`, `honours a tighter limit…`, `honours a longer window…` |
| Failure mode, both ways | `fails open and SAYS so…`, `fails open when there is no CACHE binding`, `fails open when the counter cannot be written` |

---

## 6. Anything that could not be bounded

* **Simultaneous races** — see §3 "Known limits". Needs a Durable Object; out of this lane's scope.
* **Total spend across many destinations** — the guard is per-destination. A loop that walks the
  roster one farmer at a time would place one legitimate-looking call per person. The natural next
  bound is a *canal-wide* budget (`callcap:v1:canal:<id>`), which this design supports by adding a
  second `checkOutboundCall` call; it was not added because no evidence in the incident points at a
  roster-walking loop and an unmeasured second limit is a limit that refuses good calls.
* **Workflow-level re-entry** — `apps/api/src/campaigns/workflows.ts` schedules work by contact, and
  its bounds were not in this lane's exclusive scope (`apps/api/src/campaigns/**` is shared with the
  re-plan path). The destination guard sits underneath it regardless, so a workflow re-entry that
  reaches a dial is bounded even though the scheduling itself was not audited here. **Flagged as
  unverified rather than claimed bounded.**
