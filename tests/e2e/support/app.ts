import type { Page } from '@playwright/test';
import { test as base, expect } from '@playwright/test';

/**
 * Shared fixtures for the apps/web end-to-end suite.
 *
 * One stub keeps the browser hermetic (and therefore the "no console errors"
 * assertion meaningful) without touching application code: Google Fonts is
 * requested from index.html. The suite must pass offline, so those requests
 * are answered with an empty 200 body instead of failing.
 *
 * Everything else (canal roster, contacts, demo steps) is served by the app's
 * own contract-validated mock, so no interception happens there.
 */

/** Console errors and uncaught page errors seen while the test ran. */
type ConsoleErrorSink = string[];

export const test = base.extend<{ consoleErrors: ConsoleErrorSink }>({
  consoleErrors: async ({ page }, use) => {
    const errors: ConsoleErrorSink = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => {
      errors.push(`pageerror: ${error.message}`);
    });

    await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, (route) =>
      route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
    );
    await use(errors);
  },
});

/**
 * Let the page finish rendering before the console-error assertion runs.
 *
 * `networkidle` is deliberately not used: mock-mode data arrives as microtasks,
 * but a single request that never settles (a proxy with no backend) would then
 * stall every test for the full timeout instead of failing on the real cause.
 */
export const SETTLE_MS = 500;

export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('load');
  await page.waitForTimeout(SETTLE_MS);
}

export { expect };