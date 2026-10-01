# Screenshots (C8)

Playwright captures for every showcase screen. Placeholder-first: the script
works against any `BASE_URL` and assumes nothing about C1–C7 markup.

## Routes captured

`/`, `/farmer` (+mobile), `/coordinator`, `/canal`, `/phone` (+mobile),
`/demo` — see `screenshots.config.json`. Desktop 1440x900; mobile 390x844
for the two voice-first screens (`/farmer`, `/phone`).

## Run

```powershell
cd showcase
npm install
npx playwright install chromium
$env:BASE_URL = "http://localhost:5173"
npm run screenshots
```

Output: `showcase/screenshots/out/*.png` (gitignored; not committed).
`--tolerant` keeps going when the preview is down (still reports failures):

```powershell
node ./screenshots/capture.mjs --base-url "https://demo.jadal.example.com" --tolerant
```

Exit 1 on any failure unless `--tolerant` is passed. A common reason for
failure right now is that C1–C7 routes are not implemented yet — that is
expected; keep the failure log and use the pitch fallback order
(live → backup video → stills).
