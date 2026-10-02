import { expect, settle, signInAs, test } from './support/app';
import en from '../../apps/web/src/i18n/en.json';

/** The two coordinator tools: turn-time editing and manual alerts. */

/** The edit button is labelled per turn, e.g. "Change the time for Outlet 1". */
const CHANGE_TIME = new RegExp(en.coord.roster.edit.forTurn.replace('{outlet}', '.*'));

test('the coordinator changes a turn time and the change is recorded', async ({ page, consoleErrors }) => {
  await signInAs(page, 'coordinator');
  await page.goto('/coordinator?tab=roster');

  const plan = page.locator('.roster-option').first();
  const row = plan.locator('tbody tr').first();
  await row.getByRole('button', { name: CHANGE_TIME }).click();

  const endInput = row.locator('input[type="datetime-local"]').nth(1);
  const endValue = await endInput.inputValue();
  // Move the end half an hour later, in the browser's own zone.
  const later = await page.evaluate((value) => {
    const date = new Date(value);
    date.setMinutes(date.getMinutes() + 30);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }, endValue);
  await endInput.fill(later);
  await row.getByRole('button', { name: en.coord.roster.edit.save, exact: true }).click();

  await expect(plan.getByText(en.coord.roster.edit.saved)).toBeVisible();
  await expect(row.getByText(en.coord.roster.edit.changed)).toBeVisible();

  // The schedule change is visible in the audit.
  await page.getByRole('tab', { name: en.coord.tabs.accounts, exact: true }).click();
  await page.getByText(en.coord.acc.findings, { exact: true }).click();
  await expect(page.getByText(/changed by the coordinator/i)).toBeVisible();

  await settle(page);
  expect(consoleErrors).toEqual([]);
});

test('a backwards turn time is refused before it is sent', async ({ page, consoleErrors }) => {
  await signInAs(page, 'coordinator');
  await page.goto('/coordinator?tab=roster');

  const plan = page.locator('.roster-option').first();
  const row = plan.locator('tbody tr').first();
  await row.getByRole('button', { name: CHANGE_TIME }).click();

  const startInput = row.locator('input[type="datetime-local"]').first();
  const endInput = row.locator('input[type="datetime-local"]').nth(1);
  const startValue = await startInput.inputValue();
  // Push the end before the start.
  const earlier = await page.evaluate((value) => {
    const date = new Date(value);
    date.setHours(date.getHours() - 1);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }, startValue);
  await endInput.fill(earlier);
  await row.getByRole('button', { name: en.coord.roster.edit.save, exact: true }).click();

  await expect(plan.getByRole('alert')).toHaveText(en.coord.roster.edit.backwards);
  await expect(row.getByText(en.coord.roster.edit.changed)).toHaveCount(0);

  await settle(page);
  expect(consoleErrors).toEqual([]);
});

test('the alert control reports simulated dispatch', async ({ page, consoleErrors }) => {
  await signInAs(page, 'coordinator');
  await page.goto('/coordinator?tab=farmers');

  const card = page.locator('.req-card').first();
  await card.getByText(en.coord.alert.title, { exact: true }).click();
  await card.getByRole('button', { name: en.coord.alert.channel.whatsapp, exact: true }).click();
  await card.getByRole('button', { name: en.coord.alert.send, exact: true }).click();

  const result = card.getByRole('status');
  await expect(result).toContainText(en.coord.alert.simulated.split('{')[0]?.trim() ?? '');
  await expect(result).toContainText(en.coord.alert.channel.whatsapp);

  await settle(page);
  expect(consoleErrors).toEqual([]);
});

test('a request card also offers the alert control', async ({ page, consoleErrors }) => {
  await signInAs(page, 'coordinator');
  await page.goto('/coordinator?tab=requests');

  const card = page.locator('.req-card').first();
  await expect(card.getByText(en.coord.alert.title, { exact: true })).toBeVisible();

  await settle(page);
  expect(consoleErrors).toEqual([]);
});
