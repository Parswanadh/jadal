import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

/**
 * End-to-end suites for apps/web and the live API.
 *
 * There are two projects and they need *different* servers, so which `webServer` entries start is
 * chosen by `E2E_LIVE`:
 *
 *  - default (`pnpm e2e`): the `chromium` project drives apps/web in mock mode
 *    (`VITE_MOCK=1 pnpm --filter web dev`). `live/**` is ignored here.
 *  - `E2E_LIVE=1` (`pnpm e2e:live`): the `live` project talks to the real Hono Worker on
 *    `127.0.0.1:8788` — real workerd, real local D1 — started by `pnpm --filter api dev:live`.
 *    The web dev server is not started, because the live suite is an API suite and `apps/web` is
 *    owned by another lane.
 *
 * Chromium only, desktop 1440x900.
 */
export const E2E_PORT = 5177;
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
export const E2E_VIEWPORT = { width: 1440, height: 900 } as const;

/** The live Worker. Port 8788, not 8787: an unrelated `event-manage` wrangler holds 8787. */
export const E2E_LIVE_PORT = 8788;
export const E2E_LIVE_BASE_URL = `http://127.0.0.1:${E2E_LIVE_PORT}`;

/** The web dev server the `live-ui` project drives: real API, no mock. */
export const E2E_LIVE_UI_PORT = 5178;
export const E2E_LIVE_UI_BASE_URL = `http://127.0.0.1:${E2E_LIVE_UI_PORT}`;

const LIVE = process.env.E2E_LIVE === '1';

const webServers = LIVE
  ? [
      {
        // `dev:live` runs `wrangler dev --local` with the local-only overrides the live suite needs:
        // demo mode on (so `POST /api/demo/reset` is allowed), `SKIP_TWILIO_SIGNATURE=1` (so the
        // Twilio webhooks can be replayed from the suite; local only, never deployed), and a
        // compatibility date the installed workerd binary accepts.
        command: 'pnpm --filter api dev:live',
        cwd: path.resolve(__dirname, '../..'),
        url: `${E2E_LIVE_BASE_URL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'pipe' as const,
        stderr: 'pipe' as const,
      },
      {
        // The `live-ui` project drives the real coordinator console against the live Worker:
        // VITE_MOCK=0 with no VITE_API_BASE, so the app calls same-origin `/api/*` and Vite's
        // dev proxy forwards to 8788. This is what proves the *UI* reaches the live API — the
        // `live` project exercises the API with no browser at all.
        command: `VITE_MOCK=0 pnpm --filter web dev --port ${E2E_LIVE_UI_PORT} --strictPort`,
        cwd: path.resolve(__dirname, '../..'),
        url: E2E_LIVE_UI_BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'pipe' as const,
        stderr: 'pipe' as const,
      },
    ]
  : [
      {
        command: `VITE_MOCK=1 pnpm --filter web dev --port ${E2E_PORT} --strictPort`,
        cwd: path.resolve(__dirname, '../..'),
        url: E2E_BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'pipe' as const,
        stderr: 'pipe' as const,
      },
    ];

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: E2E_BASE_URL,
    viewport: E2E_VIEWPORT,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // `live/**` and `live-ui/**` belong to the live projects; without this they
      // would be collected here too and run against the wrong server.
      testIgnore: ['live/**', 'live-ui/**'],
      use: { ...devices['Desktop Chrome'], viewport: E2E_VIEWPORT },
    },
    // Declared only under `E2E_LIVE=1`, so a plain `pnpm e2e` runs the UI suite and nothing else —
    // no `--project` flag needed on the existing script.
    ...(LIVE
      ? [
          {
            // API-only: no browser is launched, so this project runs light next to the UI suite.
            name: 'live',
            testMatch: 'live/**/*.spec.ts',
            use: { baseURL: E2E_LIVE_BASE_URL },
          },
          {
            // The real console in a real browser against the live Worker. Serial: every test
            // shares one live D1, and each one resets and reseeds the request it acts on.
            name: 'live-ui',
            testMatch: 'live-ui/**/*.spec.ts',
            fullyParallel: false,
            use: { ...devices['Desktop Chrome'], baseURL: E2E_LIVE_UI_BASE_URL, viewport: E2E_VIEWPORT },
          },
        ]
      : []),
  ],
  webServer: webServers,
});
