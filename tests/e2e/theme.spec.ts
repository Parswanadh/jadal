import { expect, settle, test } from './support/app';
import en from '../../apps/web/src/i18n/en.json';

/** Requirement 3: the theme toggle switches the app to dark (and back). */
test('the theme toggle switches to dark and back to light', async ({ page, consoleErrors }) => {
  await page.goto('/');
  const html = page.locator('html');
  const toggle = page.getByRole('button', { name: en.a11y.toggleTheme });

  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await toggle.click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  // The dark palette is a real restyle, not only a data attribute flip.
  expect(darkBg).not.toBe(lightBg);

  await toggle.click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(lightBg);

  expect(consoleErrors).toEqual([]);
});

test('the dark theme survives a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: en.a11y.toggleTheme }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});