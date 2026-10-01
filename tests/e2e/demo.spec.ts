import { expect, settle, test } from './support/app';
import en from '../../apps/web/src/i18n/en.json';

/**
 * Requirement 5: the demo walkthrough can be stepped through all 6 steps.
 *
 * The step copy and order come from the language files and
 * `apps/web/src/demo/demoScript.ts` (mirroring the fixture's `demo_script`).
 * Each click runs against the app's mock API, so the outcome sentences prove
 * the round trip, not just a counter bump.
 */
const STEP_COUNT = 6;

test('the demo walkthrough can be stepped through all 6 steps', async ({ page, consoleErrors }) => {
  await page.goto('/demo');
  await expect(page.getByRole('heading', { level: 1, name: en.page.demo.title })).toBeVisible();

  const progress = page.getByLabel(en.demo.progressLabel);
  await expect(progress).toHaveAttribute('value', '0');

  await page.getByRole('button', { name: en.demo.start }).click();
  await expect(page.getByText('Ready. Step 1 is next.')).toBeVisible();
  await expect(page.getByRole('button', { name: en.demo.runStep })).toHaveCount(1);
  await expect(progress).toHaveAttribute('value', '0');

  for (let step = 1; step <= STEP_COUNT; step += 1) {
    // Only the current step offers "Run this step".
    await page.getByRole('button', { name: en.demo.runStep }).click();
    await expect(progress).toHaveAttribute('value', String(step));
  }

  // Every step shows its visible outcome, built from the mock API response.
  await expect(page.locator('.demo__result')).toHaveCount(STEP_COUNT);
  await expect(page.getByText(/^Tail farms now get \d+% of their need instead of \d+%\./)).toBeVisible();
  await expect(page.getByText(/^Ramaiah Kota asked for [\d,]+ m³\. The coordinator approved [\d,]+ m³/)).toBeVisible();
  await expect(page.getByText(/Anjamma Bandi and Narasimha Chinta have no smartphone/)).toBeVisible();
  // The step outcome, not the audit summary card that also opens with "The books balance.".
  await expect(page.locator('.demo__result').filter({ hasText: /^The books balance\. The fairness gap/ })).toBeVisible();
  await expect(page.getByText(/All steps are done in \d{1,2}:\d\d\./)).toBeVisible();

  // Each step links to the screen where the result can be seen.
  await expect(page.getByRole('link', { name: en.demo.seeIt })).toHaveCount(STEP_COUNT);

  // The last step pulls in the audit summary; the event log sits behind "Show details".
  await expect(page.getByRole('heading', { name: en.demo.auditTitle })).toBeVisible();
  await page.getByText(en.demo.details, { exact: true }).click();
  await expect(page.getByRole('heading', { name: /Everything that happened \(\d+\)/ })).toBeVisible();

  // No developer text on screen: no API paths and no internal ids.
  const text = await page.locator('main').innerText();
  expect(text).not.toMatch(/\/api\/|\bPOST\b|\bGET\b|\brw\d\b|\bf\d\b|\bo\d\b/);

  await settle(page);
  expect(consoleErrors).toEqual([]);
});

test('"See it" opens the screen where the step shows up', async ({ page }) => {
  await page.goto('/demo');
  await page.getByRole('link', { name: en.demo.seeIt }).nth(1).click();
  await expect(page.getByRole('heading', { level: 1, name: en.page.coordinator.title })).toBeVisible();
  await expect(page.getByRole('tab', { name: new RegExp(en.coord.tabs.requests) })).toHaveAttribute('aria-selected', 'true');
});

test('the demo reset button returns the walkthrough to step 0', async ({ page }) => {
  await page.goto('/demo');
  const progress = page.getByLabel(en.demo.progressLabel);

  await page.getByRole('button', { name: en.demo.start }).click();
  await page.getByRole('button', { name: en.demo.runStep }).click();
  await expect(progress).toHaveAttribute('value', '1');

  await page.getByRole('button', { name: en.demo.reset }).click();
  // Reset is destructive, so it asks first: confirm before the walkthrough clears.
  await page.locator('.confirm-inline').getByRole('button', { name: en.demo.reset }).click();
  await expect(progress).toHaveAttribute('value', '0');
  await expect(page.getByRole('button', { name: en.demo.start })).toBeVisible();
});
