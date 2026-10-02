import { expect, settle, signInAs, test } from './support/app';
import en from '../../apps/web/src/i18n/en.json';
import te from '../../apps/web/src/i18n/te.json';

/** Requirement 2: the EN / Telugu toggle switches the home hero both ways. */
test('the language toggle switches the home hero to Telugu and back', async ({ page, consoleErrors }) => {
  await page.goto('/');
  const html = page.locator('html');
  const heroTitle = page.locator('.hero').getByRole('heading', { level: 1 });

  await expect(html).toHaveAttribute('lang', 'en');
  await expect(heroTitle).toHaveText(en.home.title);

  const teluguButton = page.getByRole('button', { name: te.controls.langOptionTe, exact: true });
  const englishButton = page.getByRole('button', { name: en.controls.langOptionEn, exact: true });

  await teluguButton.click();
  await expect(html).toHaveAttribute('lang', 'te');
  await expect(heroTitle).toHaveText(te.home.title);
  // The Telugu hero is a real translation, not the English string left in place.
  expect(te.home.title).not.toBe(en.home.title);
  expect(te.home.title).toMatch(/[ఀ-౿]/);

  await englishButton.click();
  await expect(html).toHaveAttribute('lang', 'en');
  await expect(heroTitle).toHaveText(en.home.title);

  await settle(page);
  expect(consoleErrors).toEqual([]);
});

test('the language choice survives a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: te.controls.langOptionTe, exact: true }).click();
  await expect(page.locator('.hero').getByRole('heading', { level: 1 })).toHaveText(te.home.title);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'te');
  await expect(page.locator('.hero').getByRole('heading', { level: 1 })).toHaveText(te.home.title);
});

test('a fixture request reason follows the active language', async ({ page, consoleErrors }) => {
  // The seeded pool request carries the mock's own prose and a decision note.
  await signInAs(page, 'farmer');
  await page.goto('/farmer?tab=pool');
  await expect(page.getByText(en.fixture.reasonTailShortTurn)).toBeVisible();
  await expect(page.getByText(en.fixture.noteTailShort)).toBeVisible();

  await page.getByRole('button', { name: te.controls.langOptionTe, exact: true }).click();
  await expect(page.getByText(te.fixture.reasonTailShortTurn)).toBeVisible();
  await expect(page.getByText(te.fixture.noteTailShort)).toBeVisible();
  // The English fixture prose is gone, not left in place on the Telugu screen.
  await expect(page.getByText(en.fixture.reasonTailShortTurn)).toHaveCount(0);

  await settle(page);
  expect(consoleErrors).toEqual([]);
});
