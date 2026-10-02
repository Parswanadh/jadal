# Jadal web app

The React front end for Jadal: a public home, canal and phone walkthrough, plus
two sign-in-gated portals.

## Running

```bash
pnpm --filter web dev        # http://localhost:5173
pnpm --filter web test       # unit tests (vitest)
pnpm --filter web build      # typecheck + production build
```

The app runs with **zero configuration**. By default it serves its own
contract-validated data (`VITE_MOCK=1`), so no backend is needed.

## Signing in

The home, canal, phone and demo screens are public. `/farmer` and
`/coordinator` require a session; visiting one without it redirects to `/login`,
and signing in returns you to the screen you asked for.

The gate is client-side by decision (see
`.ref/session/spec-auth-data-video.md`): there is no user table and no
server-side auth. Passwords come from Vite env vars, with non-secret defaults so
the app works out of the box.

| Role | Environment variable | Default |
| --- | --- | --- |
| Farmer | `VITE_FARMER_PASSWORD` | `farmer123` |
| Coordinator | `VITE_COORDINATOR_PASSWORD` | `coordinator123` |

Copy `.env.example` to `.env.local` to override them. Set both to real values
before sharing a build; the defaults are documented here and are not secret.

The session is stored under one `localStorage` key, `jadal.session`, holding
`{ role, signedInAt }`, and is restored on reload. Sign out clears it.

## Coordinator tools

- **Turn schedule** — each turn's start and end time can be edited inline.
  The change is sent to `PATCH /api/rosters/:id/turns/:turnId` and shown in the
  audit.
- **Alerts** — alert a single farmer by **Call**, **SMS** or **WhatsApp** from
  the farmers list or a request card. The result is reported exactly as the API
  returns it; while `simulated` is true the UI says the alert was dispatched in
  simulated mode and never implies a real call or message went out.

Both endpoints are called through `src/api/client.ts`. In mock mode the
matching implementations live in `src/api/mock.ts`.
