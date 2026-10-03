import { expect, settle, signInAs, test } from './support/app';
import en from '../../apps/web/src/i18n/en.json';

/**
 * The m³ explanation must stay on a screen for as long as that screen shows m³.
 * Regression guard for the requests tab: once the last request is decided, the
 * decided table still shows m³, so the hint must remain.
 */
test('the m³ hint stays after the last request is decided', async ({ page, consoleErrors }) => {
  await signInAs(page, 'coordinator');
  await page.goto('/coordinator?tab=requests');

  // Decide the only pending request.
  await page.getByRole('button', { name: en.coord.req.reject }).first().click();
  await page.locator('.confirm-inline').getByRole('button', { name: en.coord.req.rejectYes }).click();

  // Nothing pending now, but the decided table (with m³ values) is still on screen.
  await expect(page.getByRole('button', { name: en.coord.req.reject })).toHaveCount(0);
  await expect(page.getByText(en.common.m3Help)).toBeVisible();

  await settle(page);
  expect(consoleErrors).toEqual([]);
});
