# Jadal showcase (C8)

Placeholder-first demo assets. Independent of C1–C7 implementation: every URL
is a placeholder until the frontend + backend preview deploys land.

## Contents

| File | What |
| ---- | ---- |
| `pitch-outline.md` | 3-minute pitch outline with timed beats + speaker notes |
| `backup-video-shot-list.md` | Backup-video shot list (shots, narration, capture notes) |
| `video-script.md` | 3-minute narrated demo script (bilingual captions + timings) |
| `screenshots/capture.mjs` | Playwright screenshot script for every screen |
| `screenshots/screenshots.config.json` | Routes + viewports (placeholder URLs) |
| `brag.config.json` | latent-spaces/brag config for Jadal (see `docs/research/brag.md`) |

## Placeholder URLs

- Production demo (placeholder): `https://demo.jadal.example.com`
- Local dev (Vite default): `http://localhost:5173`

Override at runtime — never hardcode a real deploy URL here:

```powershell
$env:BASE_URL = "http://localhost:5173"
node ./showcase/screenshots/capture.mjs
```

## Screenshots

Requires Node 24+ and Playwright browsers (tooling only, no app changes):

```powershell
cd showcase
npm install        # installs @playwright/test (screenshots only)
npx playwright install chromium
npm run screenshots
# output -> showcase/screenshots/out/*.png (gitignored)
```

Captures (desktop 1440x900): `/farmer`, `/coordinator`, `/canal`, `/phone`,
`/demo` (+ `/` as cover). Also captures mobile 390x844 for `/farmer` and
`/phone` (voice-first users). See `screenshots/README.md`.

## Brag status

`docs/research/brag.md` has landed (latent-spaces/brag research, upstream
sources verified) so `brag.config.json` is the real Jadal config matching the
documented showcase intent (architecture overview §8: seeded 8-farm scenario,
equal-hours vs equal-water hero, Telugu voice live moment). No secrets are
stored here.

## Live-demo fallback order

1. Live preview (`BASE_URL`).
2. Backup video (see `backup-video-shot-list.md`).
3. Screenshots (`screenshots/out/`) + `pitch-outline.md` talk track.
