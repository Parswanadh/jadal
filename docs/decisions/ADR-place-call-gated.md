# ADR: `place_call` is approval-gated (`gated: true`)

Status: **proposed — needs `contracts-ok`**. This ADR is a proposal only; nothing in
`packages/contracts` was edited. The unapplied patch is
[`docs/decisions/patches/place-call-gated.patch`](patches/place-call-gated.patch).

Relates to handoff P8 (`docs/HANDOFF-ENGINEERING.md` §5). Static guard:
`apps/api/src/placecall-guard.test.ts`.

## Context

`packages/contracts/src/agents.ts:25` declares:

```ts
place_call: { agent: ["caller"], gated: false, input: z.object({ farmer_id: ..., purpose: ..., message_te: ..., message_en: ... }) },
```

`gated: true` is the contract's marker for "this tool creates a proposal that waits for coordinator
approval instead of committing" (see the header comment in `agents.ts`). The product's central claim
is that **nobody is called and no water moves without a human coordinator approving the roster**.

The real dispatch path is already approval-gated, but the gate lives *upstream of the tool* rather
than in the tool's own declaration:

- `place_call` is never wired to an LLM tool dispatcher. The only agent-facing tool list is the
  `toolSpecs` map itself; no runtime handler for `place_call` exists in `apps/api/src/agents/`.
- The contact that a call needs is only created inside `approveRoster` — i.e. after a coordinator
  approval event. Both real voice call sites are therefore downstream of approval:
  - `apps/api/src/coordinator-alert.ts` (coordinator prompt / farmer allocation, called from the
    approval flow), and
  - `apps/api/src/campaigns/escalation.ts` (escalation ladder for an already-approved roster).
- Both reach the wire only through `placeCallIfAllowed` in `apps/api/src/telephony-deps.ts`, which
  applies the `REAL_TELEPHONY` kill switch and the outbound rate limit (`src/noloop.ts`).

So `gated: false` is a **declaration inaccuracy, not a live hole** (handoff P8 says exactly this).
But it is the machine-readable statement of the product's core guarantee, and a future tool
dispatcher that trusts `gated` would expose an ungated `place_call` even though today's paths are
safe. The declaration should match the claim.

## Decision

Change line 25 of `packages/contracts/src/agents.ts` from `gated: false` to `gated: true`, via the
single-line patch under `docs/decisions/patches/`. No other contract change; the change is
**additive in behaviour and semantics** (it tightens a declaration, it does not change a schema
shape).

Rationale for `gated: true` over leaving it `false`:

1. It is the accurate description of the system: an outbound call cannot happen without a prior
   coordinator approval that creates the contact.
2. It is the safe default for any future dispatcher: a dispatcher that honours `gated` will hold
   `place_call` for approval even if a raw handler is added later, so the guarantee is enforced at
   the seam a new caller would actually use.
3. It costs nothing at runtime today, because there is no generic dispatcher that reads the flag.

## Options considered

- **A. Patch `gated: false` → `gated: true` (recommended).** One-line, semantic-only, matches the
  product claim and the actual approval ordering.
- **B. Also add an explicit gated wrapper/handler.** Larger change, and it belongs in the contracts
  lane plus the agent runtime; it is not needed while no dispatcher reads `gated`. Documented here
  rather than proposed as a patch.
- **C. Leave `gated: false` and rely on a prose disclaimer.** Rejected: the contract is the
  integration agreement, and the flag is what a future tool consumer will read. A disclaimer in
  docs does not travel with the type.
- **D. Gate `place_call` inside the `caller` agent instead.** Rejected for this patch: the caller
  agent is not the enforcement point; contacts (the prerequisite for a call) are created only by
  `approveRoster`. Gating in the agent would be a second, weaker gate and would not fix the
  declaration.

## Owner decision required

Applying the patch requires the `contracts-ok` label (task rule: `packages/contracts` is immutable
without it). This ADR records the recommendation; it does **not** apply it. If the owner prefers
option B or C, no patch is applied and this ADR is superseded.

## Consequences

- `toolSpecs.place_call.gated` becomes `true`; type inference over `toolSpecs` is unchanged (the
  field is already `boolean` literal per key).
- Any test or UI that asserts `place_call.gated === false` will need to be updated by the contracts
  owner when the patch is applied. A repository search for such an assertion is part of applying
  the patch.
- Water arithmetic and i18n are not touched; no numeric water value and no user-visible string is
  involved in this change.

## Evidence

- RAN: `grep -rn "gated" packages/contracts/src/agents.ts` → `place_call` is `gated: false` at
  line 25.
- RAN: `grep -rn "placeCall(" apps/api/src --include=*.ts` → the only direct invocation is
  `apps/api/src/telephony-deps.ts:154`; the only `placeCallIfAllowed(` calls are
  `coordinator-alert.ts:208` and `campaigns/escalation.ts:319`.
- READ: `apps/api/src/coordinator-alert.ts` and `apps/api/src/campaigns/escalation.ts` route every
  dial through `placeCallIfAllowed`.
- Static guard: `apps/api/src/placecall-guard.test.ts` fails if a direct `placeCall(` call appears
  outside `telephony-deps.ts`, or if any file other than the two above calls `placeCallIfAllowed`.
