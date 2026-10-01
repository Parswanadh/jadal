import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

/**
 * End-to-end suite for apps/web in mock mode (VITE_MOCK=1).
 *
 * The suite talks to the real dev server, so the app boots exactly as a
 * presenter would run it: `pnpm --filter web dev --port <PORT> --strictPort`.
 * Chromium only, desktop 1440x900.
 */
export const E2E_PORT = 5177;
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
export const E2E_VIEWPORT = { width: 1440, height: 900 } as const;

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
      use: { ...devices['Desktop Chrome'], viewport: E2E_VIEWPORT },
    },
  ],
  webServer: {
    command: `VITE_MOCK=1 pnpm --filter web dev --port ${E2E_PORT} --strictPort`,
    cwd: path.resolve(__dirname, '../..'),
    url: E2E_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});