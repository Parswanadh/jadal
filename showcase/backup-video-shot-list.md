# Jadal — backup-video shot list

> Companion to `pitch-outline.md`. Same seed
> (`packages/contracts/fixtures/demo-scenario.json`), same placeholder routes.
> Total target **≤ 3:00** so it can substitute the live demo 1:1.
>
> Capture with `showcase/screenshots/capture.mjs` stills first (framing
> check), then screen-record at 1440x900, 30fps, system audio on for the
> Telugu line. Datasheet numbers below are the *demo_script* expectations,
> not measured claims — read them as "seed shows …".

## Global capture notes

- Base URL: `$env:BASE_URL` (default `https://demo.jadal.example.com`,
  placeholder; local `http://localhost:5173`). Same value for every shot.
- Browser: Chromium 1440x900, `prefers-reduced-motion: reduce`, hide cursor
  unless pointing. Full-page OFF for app screens (viewport only) so the
  recording matches what judges saw live.
- Before roll: `POST /api/demo/reset` (seed now =
  `2026-09-14T06:00:00+05:30`); confirm rw1 starts on screen.
- No secrets on screen: fictional names/phones (`+91900000000x`) only.
- If a screen from C1–C7 is not implemented yet, record the *route loading
  against the placeholder* and title the shot "STANDBY" — do not mock data
  that contradicts the contracts fixtures.

| # | Shot (route) | Dur. | Visual action | Narration (EN; TE where noted) |
| - | ------------ | ---- | ------------- | ------------------------------ |
| 1 | Title card (edit, not a route) | 8s | "JADAL — Whose turn is it to irrigate?" + Kondaveedu Minor, 8 farms, canal schematic | "Everyone got their hours — and the tail still lost her crop. Hours are not water." |
| 2 | `/canal` equal-HOURS | 20s | Hero canal map, equal-hours mode; slow pan head→tail o1→o8; hold on o7/o8 bar (~42% need met) | "One hour at the head is not one hour at the tail. Seepage and lag eat it. The old register still calls this fair." |
| 3 | `/coordinator` roster compare | 25s | Toggle equal_hours → equal_water for rw1; Gini + need-met bars animate; tail rises to >90% | "Same water, converted to time with the flow that actually reaches each outlet. Tail turns run longer — because physics, not favouritism." |
| 4 | `/farmer` registration + entitlement | 15s | Farmer card (f1, rice, flowering), plot area/soil, weekly entitlement m³; coordinator approve tick | "Need starts at registration: crop, stage, soil. The FAO-56 engine proposes volumes — the coordinator approves them." |
| 5 | `/phone` Telugu urgent request | 25s | Simulated phone: Telugu transcript appears, then agent triage + recommendation EN+TE; keep audio waveform visible | TE audio: «నాకు ఈ వారం అత్యవసరంగా నీరు కావాలి.» EN VO: "An urgent request by voice. The agent recommends a partial grant — deducted from future quota, never free." |
| 6 | `/coordinator` approve + deduct | 15s | Approve request; ledger line "future quota → this week's turn"; quota bar for f1 drops | "Granted — and subtracted. Overruns stop being free." |
| 7 | `/coordinator` contacts + `/phone` acks | 20s | Contacts queue fans out (voice+WhatsApp; f5/f8 voice-only); cut to `/phone` acks ticking in; night-release rw2 banner (19:00 IST → WhatsApp + warning call 1 h before) | "A change is valid only after acknowledgement. No smartphone? A voice call still reaches you. Night release? You get warned." |
| 8 | `/demo` buffer + harvest | 15s | f3 harvest declared → remainder → buffer; f7 buffer request → public board → approve | "Unused and post-harvest water pools into a public buffer — requested in the open, approved in the open." |
| 9 | `/demo` ledger + audit close | 15s | Event replay scrub, conservation line, Gini before/after, TE+EN summary card; end on `/canal` equal-water | "Supply equals quotas plus buffer plus delivered plus losses — always. The register shows volumes now, so disputes can be settled." |
| 10 | End card (edit) | 8s | Title, placeholder URL, "LLMs propose · core decides · coordinator approves" | "Fair water, acknowledged by every farmer. Thank you." |

Total ≈ 186s @ narration pace above; trim shots 4 and 8 first to hit 180s.

## VO script (continuous, ~180s read)

> [1] Everyone got their hours — and the tail still lost her crop. Hours are
> not water. [2] On this canal, one hour at the head delivers far more than
> one hour at the tail, but the old register calls both fair. [3] Jadal
> converts volume into time with the flow that actually reaches each outlet —
> tail turns run longer, and the fairness gap closes. [4] It starts with need:
> crop, stage and soil propose a weekly volume; the coordinator approves it.
> [5] When a crop needs water now, a farmer just speaks in Telugu, and the
> agent recommends a fair grant. [6] Granted — and deducted from future
> quota. [7] Then every affected farmer is contacted and must acknowledge —
> by voice call if there is no smartphone, with a warning call before any
> night release. [8] Leftover water pools into a public buffer anyone can
> request. [9] And the ledger always balances, in Telugu and English. Fair
> water, acknowledged by all. Thank you.

## Edit checklist

- [ ] Burn in route label (`/canal`, `/coordinator`, …) lower-third per shot.
- [ ] Subtitle the Telugu line (TE + EN) — do not rely on audio.
- [ ] Blur nothing (all data fictional); still, never show a real phone/token.
- [ ] Export 1080p MP4 + muted captioned copy; filename
  `jadal-backup-YYYYMMDD.mp4`.
- [ ] If any route 404s (C1–C7 pending), keep its still from
  `screenshots/out/` with a "STANDBY — route placeholder" lower-third
  rather than faking the UI.
