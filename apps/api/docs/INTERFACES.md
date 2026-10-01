# apps/api module map — authoritative seams (all agents)

Every agent owns specific files. Do not edit files you do not own. Imports resolve at integration.

## Already implemented and green (reuse, do not reimplement)

- `src/core/index.ts` → re-exports `cropEngine`, `hydraulics`, `rosterEngine`, `ledger`, `policy`,
  plus the interfaces. Also exports all of `src/core/{crop-params,soil,crop-engine,hydraulics,roster,ledger,policy,units}.ts`.
- `cropEngine`: `kcOnDay(params, das)`, `weeklyNeed({plan,plot,params,weather,weekStart})`, `seasonNeed({plan,plot,params,weather})`.
  Also `effectiveRain_mm(rain)`, `daysBetween(a,b)` from `core/crop-engine`.
- `hydraulics`: `velocity_ms(canal)`, `atOutlets(canal, outlets, q)`, `overrunImpact({canal,outlets,overrunOutletId,overrun_h,headDischarge_m3s})`.
- `rosterEngine`: `build(input: RosterInput, rosterId)`, `needMet(input, roster)`.
- `ledger`: `entriesFor(event)`, `entriesForDecision({event, farmer_id, request_type})`, `balances(entries)`,
  `checkConservation(entries, supply, tolerance?)`, `gini(values)`, `quotaAccount(id)`, `deliveredAccount(id)`.
  **Note:** `entriesFor` returns `[]` for `request.decided` because the event lacks `farmer_id`/`type`.
  When applying a decision, call `entriesForDecision`.
- `policy`: `canGrantUrgent(balances, farmerId, m3)`, `canGrantBuffer(balances, farmerId, m3, weeklyEnt, alreadyThisWeek)`,
  `BUFFER_WEEKLY_CAP_FRACTION = 0.25`.
- `src/system1.ts`: `classify(env, text, opts?)`, `gatewayUrl(env, url)`, `ProviderEnv`. Re-exports
  `classifyByRules`, `extractVolumeM3`, `extractRequestedHours`, `normalizeText`.
- `src/agents/llm.ts`: `chat(env, {system,messages,tools?,maxTokens?}) → {content, toolCalls, source, model?}`,
  `rewrite(env, system, prompt, maxTokens?)`, types `AgentEnv`, `AgentFetch`, `ChatMessage`, `ChatRequest`.
- `src/voice/sarvam.ts`: `stt(env, base64, mime?) → string|null`, `tts(env, text) → string|null` (base64).
- `src/voice/openmeteo.ts`: `getForecast(env, lat, lon, days=7)`, `loadDemoWeather()`, re-exports `effectiveRain_mm`,
  `rainTriggerMm = 15`, `buildForecastUrl`, `clampForecastDays`.
- `src/voice/telugu.ts`: paired Te/En builders (`rosterChange`, `nightReleaseWarning`, `rainPostponed`,
  `requestUpdate`, `reminder`, `ackRecorded`), `farmerGreeting`, `formatIstTime`, `formatIstDate`,
  `formatVolumeM3`, `templateForPurpose`.
- `src/db/store.ts`: `appendEvent(env, event) → {event_id, seq, ledger_entry_ids}`, `readEvents(env, opts?)`,
  `getEventCount(env)`, `assertAppendOnly`, `guardAppendOnly`, `StoreError`. Types `DbEnv`, `Db`.
- `src/db/projections.ts`: `projectionsFor(event)`, `DEFAULT_TOLERANCE_M3`.
- `src/db/clock.ts`: `now(env)`, `advanceHours(env, h)`, `setNow(env, iso)`, `toIST(iso)`, `isNightRelease(iso)`,
  `NIGHT_RELEASE_START_MINUTE`, `NIGHT_RELEASE_END_MINUTE`.
- `src/db/id.ts`: `newId(prefix)`, `deterministicId(ns, ...parts)`.
- `src/db/repo.ts`: read helpers returning contract-shaped objects. `listFarmers`, `getFarmer`, `getCanal`,
  `listOutlets`, `listEntitlements`, `getEntitlementsForWeek`, `listReleaseWindows`, `getReleaseWindow`,
  `listRosters`, `getRoster`, `listRequests`, `getRequest`, `listContacts`, `getContact`,
  `getLedgerEntries`, `getSeason`, `listVerifiedCropPlans`, `getWeather`, `getClockNow`.
  `RosterRecord` = `Roster & { created_at }`.
- `test/harness.ts`: `createEnv(routes?)`, `call(app, method, path, {body,env})`, `expectOk`, `expectStatus`,
  `readMigrations`, `createTestDb`, `ShimDatabase`, `ShimKV`, `ShimQueue`, `TestEnv`.
- `test/fixtures.ts`: `demoScenario()`, `demoWeather()`, `seedScenario(db, scenario)`.

## Ownership map for this wave

| Agent | Owns |
| --- | --- |
| B5-agents | `src/agents/{loop,tools,need,scheduler,request-assessor,caller,auditor}.ts`, `src/agents/{loop,tools,auditor}.test.ts` |
| db-tests | `src/db/{store,repo}.test.ts`, `test/fixtures.ts` |
| demo | `src/demo.ts`, `src/demo.test.ts` |
| campaigns | `src/campaigns/{escalation,rain,night-release,workflows}.ts`, `src/campaigns/*.test.ts` |
| worker-entry | `src/env.ts`, `src/env.d.ts`, `src/index.ts`, `.dev.vars.example`, `wrangler.jsonc` |
| routes | `src/app.ts`, `src/http.ts`, `src/routes/*.ts`, `src/routes/*.test.ts` |

### Exports the routes/demo/campaigns agents may assume (to be delivered by B5-agents)
```ts
// need.ts
suggestEntitlements(env, weekStart?: string): Promise<{ entitlements: Entitlement[]; season_total_m3: number; explanation: string }>
// scheduler.ts
proposeRoster(env, releaseWindowId: string, mode: "equal_water"|"equal_hours"): Promise<{ roster: Roster; need_met: {farmer_id,outlet_id,pct}[]; comparison: {equal_hours_gini:number; equal_water_gini:number} }>
// request-assessor.ts
assessRequest(env, requestId: string): Promise<{ decision: "approve"|"reject"|"partial"; volume_m3: number; rationale: string }>
// caller.ts
callerTurn(env, contactId: string, reply: { text?: string; audio_base64?: string; mime?: string }): Promise<{ contact: Contact; agent_reply_te: string; agent_reply_en: string; audio_base64?: string }>
// auditor.ts
audit(env): Promise<{ balances: BalancesView; findings: {severity:"info"|"warn"|"critical"; text:string}[]; summary_en: string; summary_te: string }>
```
### Exports the routes agent may assume from demo.ts
```ts
resetDemo(env): Promise<{ ok: boolean }>
advanceDemo(env, hours: number): Promise<{ now: string }>
seedWeather(env, canalId: string): Promise<void>
```

## Contract response types
Always parse responses with `routes.<name>.response` from `@jadal/contracts`. Import via the package root
only (`@jadal/contracts`); subpath exports (`@jadal/contracts/entities`) do **not** resolve.