# alerts-honesty — P9: SMS / WhatsApp must never read as working

**Branch:** `ws/swarm-alerts-honesty` · **Lane:** apps/api + apps/web · **Budget:** 28 min

Handoff §5 P9: `POST /api/alerts` accepts `sms`/`whatsapp`, audits a `queued` contact and
returns `simulated: true` with a detail saying nothing was sent. No transport exists. The
follow-up was to make sure no API text or web UI describes those channels as working.

## What changed

### API — `apps/api/src/alerts.ts`

`describeAlertOutcome()` now returns a blunt, unmissable non-call detail (same fields, no
contract change):

```
<channel> alert NOT SENT: no <channel> transport exists in this app; the alert is
recorded as a queued contact only, and nothing reached the farmer
```

`simulated` stays `true` (it already did) and the response shape is unchanged:
`{ ok, contact_id, simulated, detail }` (READ, `apps/api/src/alerts.ts:82-88`).

### Web — coordinator alert result

- New pure module `apps/web/src/coordinator/alertDelivery.ts`:
  `alertDeliveryState(channel, simulated)` returns `'not-sent'` for **any** non-`call`
  channel, regardless of the API's `simulated` flag; only `'call'` can be `'sent'` or
  `'simulated'`. Key map `ALERT_DELIVERY_KEY` points each state at its i18n string.
- `apps/web/src/coordinator/AlertControl.tsx`: the result notice now keys off that state.
  `sms`/`whatsapp` always render the new `coord.alert.notSent` notice. The old
  `dialled` / `dialledNone` line is now shown only for a `call` — a `sent` call shows the
  handset only when the API actually returned one (the live frozen shape does not), a
  simulated call shows `dialledNone`, and a not-sent message shows neither, so it cannot
  imply a number was rung.
- i18n: added `coord.alert.notSent` to `en.json` and `te.json`. Key counts 601 / 601
  (COMPUTED, flattened dictionaries) — the pre-change count was 600 / 600.

## Evidence

All commands run from the worktree root.

**RAN** `pnpm --filter api exec vitest run src/alerts.test.ts --maxWorkers=1`

```
✓ src/alerts.test.ts (11 tests) 259ms
Test Files  1 passed (1)
Tests       11 passed (11)
```

The two new API tests pin: (a) `sms` and `whatsapp` details contain `NOT SENT`,
`no <channel> transport exists in this app` and `nothing reached the farmer`, match
`/placed|delivered|sent to/i` nowhere, make **zero** Twilio fetches, and audit the contact as
`queued`; (b) a real `call`'s detail does not contain `NOT SENT` and says `call placed to`.

**RAN** `pnpm --filter web exec vitest run src/coordinator/alertDelivery.test.ts src/i18n/i18n.test.ts --maxWorkers=1`

```
✓ src/i18n/i18n.test.ts (9 tests) 140ms
✓ src/coordinator/alertDelivery.test.ts (3 tests) 3ms
Test Files  2 passed (2)
Tests       12 passed (12)
```

New web tests pin that `sms`/`whatsapp` map to `not-sent` even when `simulated:false`, that
`call` still distinguishes sent from simulated, and that `coord.alert.notSent` resolves in
both dictionaries (EN contains "Not sent"/"nothing was sent"; TE contains Telugu script).
The i18n suite re-confirms en/te key parity, placeholder parity and the banned-word scan.

**RAN** `pnpm --filter web typecheck` → `tsc --noEmit`, exit 0.
**RAN** `pnpm --filter api typecheck` → `tsc --noEmit`, exit 0.

**READ** `apps/api/src/coordinator-alert.ts:505-521` — the non-call branch appends a
`queued` contact and returns `simulated: true`; no `placeCall`, so no fetch. The API change
only affects the returned prose, not the audit behaviour.

## What is left / needs a human

1. **Other web copy still narrates WhatsApp as a delivered channel.** These are the phone
   demo and the walkthrough, not the alert dispatch path, and changing the story is a
   product/owner call (handoff §6 rule 5 territory), so I did not touch them. Exact keys:
   `phone.reachSub` ("…also get WhatsApp"), `phone.try3`, `demo.steps.4.what`,
   `demo.outcome.3`, `demo.outcome.3all`, `demo.outcome.4` (`apps/web/src/i18n/en.json`).
   The phone screen is labelled simulated (`page.phone.title`, `phone.agentCallSimulated`,
   `phone.demoSound`), but the strings above read as live. Owner: product/demo copy.
2. **Campaigns can still queue WhatsApp/SMS.** `apps/api/src/campaigns/night-release.ts:92`
   and `apps/api/src/campaigns/escalation.ts:365` append `whatsapp`/`sms` contacts and hand
   `kind: "whatsapp" | "sms"` to the `OUTBOUND` queue. There is no real Meta/Twilio messaging
   client anywhere in `apps/api` (grep), and the handoff already flags
   `campaigns/workflows.ts` scheduling as unaudited (§5 P10). Whether those contacts should
   be labelled `queued`/`failed`/`simulated` is the same honesty question as P9 but in a
   different module; I left it alone and flag it here rather than silently expanding scope.
3. **`dialled` is a web-only field.** `apps/web/src/api/extra.ts` accepts an optional
   `dialled`, but the live `/api/alerts` frozen shape returns only
   `{ok, contact_id, simulated, detail}`. The UI now guards `undefined` and simply omits the
   destination line when the field is absent. Adding `dialled` to the response is a shape
   change (the route is lane-local, not in `packages/contracts`), so it is left to whoever
   owns that agreement.
4. **Telugu machine-written.** The new Telugu string follows the existing machine copy;
   handoff §5 P10 still needs a native speaker pass.

## Guardrails honoured

- `packages/contracts` untouched (no contract edit, no proposal needed).
- No water arithmetic added.
- All new user-visible web strings via i18n with en/te parity.
- No `.dev.vars` read/printed; `REAL_TELEPHONY` not touched; no network in tests (harness
  fetch throws on unrouted URLs, Twilio is a canned response).
- Explicit `git add` paths only; lane scope `apps/api|apps/web`.
