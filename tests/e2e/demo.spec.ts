import { expect, settle, test } from './support/app';
import en from '../../apps/web/src/i18n/en.json';

/**
 * Requirement 5: the demo walkthrough can be stepped through all 6 steps.
 *
 * The step copy and order come from `apps/web/src/demo/demoScript.ts` (mirroring
 * the fixture's `demo_script`). Each click runs against the app's mock API, so
 * the step result lines prove the round trip, not just a counter bump.
 */
const STEP_COUNT = 6;

test('the demo walkthrough can be stepped through all 6 steps', async ({ page, consoleErrors }) => {
  await page.goto('/demo');
  await expect(page.getByRole('heading', { level: 1, name: en.page.demo.title })).toBeVisible();

  const progress = page.getByLabel('Steps completed');
  await expect(progress).toHaveAttribute('value', '0');

  await page.getByRole('button', { name: 'Start demo' }).click();
  await expect(page.getByText(/Demo reset\. Step 1 of 6 ready/)).toBeVisible();
  await expect(page.getByRole('button', { name: /\(1\/6\)/ })).toBeVisible();
  await expect(progress).toHaveAttribute('value', '0');

  for (let step = 1; step <= STEP_COUNT; step += 1) {
    // The run control is labelled with the step it will run, e.g. "Next: Compare rosters (2/6)".
    await page.getByRole('button', { name: new RegExp(`\\(${step}/${STEP_COUNT}\\)`) }).click();
    await expect(progress).toHaveAttribute('value', String(step));
  }

  // Every step produced a result line from the mock API.
  await expect(page.getByText(/^Gini .+ → .+; tail o7\/o8 \d+% → \d+% need met\./)).toBeVisible();
  await expect(page.locator('.demo__result')).toHaveCount(STEP_COUNT);
  await expect(page.getByText(/Demo finished in \d{1,2}:\d\d\./)).toBeVisible();

  // The last step pulls in the audit summary and the replayed timeline.
  await expect(page.getByRole('heading', { name: 'Audit summary' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Event timeline \(\d+\)/ })).toBeVisible();

  await settle(page);
  expect(consoleErrors).toEqual([]);
});

test('the demo reset button returns the walkthrough to step 0', async ({ page }) => {
  await page.goto('/demo');
  const progress = page.getByLabel('Steps completed');

  await page.getByRole('button', { name: 'Start demo' }).click();
  await page.getByRole('button', { name: /\(1\/6\)/ }).click();
  await expect(progress).toHaveAttribute('value', '1');

  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(progress).toHaveAttribute('value', '0');
  await expect(page.getByRole('button', { name: 'Start demo' })).toBeVisible();
});