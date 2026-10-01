import type { Locator } from '@playwright/test';
import { expect, settle, test } from './support/app';
import en from '../../apps/web/src/i18n/en.json';

const t = en.canal;

/** Read the need-met percentage of every outlet row from its accessible label (`Name, Outlet 7: 42% of need met`). */
async function needMetPercentages(bars: Locator): Promise<number[]> {
  const labels = await bars.getByRole('listitem').evaluateAll((items) =>
    items.map((item) => item.getAttribute('aria-label') ?? ''),
  );
  return labels.map((label, i) => {
    const match = /(\d+)%/.exec(label);
    if (!match?.[1]) throw new Error(`no percentage in need-met label ${i}: ${label}`);
    return Number(match[1]);
  });
}

test('the canal screen lists all 8 outlets', async ({ page, consoleErrors }) => {
  await page.goto('/canal');
  const bars = page.getByRole('list', { name: t.needMetList });
  await expect(bars).toBeVisible();

  const rows = bars.getByRole('listitem');
  await expect(rows).toHaveCount(8);
  // One tagged row per outlet, head (Outlet 1) to tail (Outlet 8).
  await expect(bars.getByText(/^Outlet [1-8]$/)).toHaveCount(8);
  await expect(bars.getByText('Outlet 1', { exact: true })).toBeVisible();
  await expect(bars.getByText('Outlet 8', { exact: true })).toBeVisible();

  const percentages = await needMetPercentages(bars);
  expect(percentages).toHaveLength(8);
  for (const pct of percentages) {
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThanOrEqual(100);
  }

  await settle(page);
  expect(consoleErrors).toEqual([]);
});

test('switching between equal hours and equal water changes the need-met values', async ({
  page,
  consoleErrors,
}) => {
  await page.goto('/canal');
  const group = page.getByRole('radiogroup', { name: t.modeLabel });
  const hours = group.getByRole('radio', { name: new RegExp(t.equalHours) });
  const water = group.getByRole('radio', { name: new RegExp(t.equalWater) });
  const bars = page.getByRole('list', { name: t.needMetList });

  await expect(hours).toHaveAttribute('aria-checked', 'true');
  await expect(water).toHaveAttribute('aria-checked', 'false');
  const equalHours = await needMetPercentages(bars);

  await water.click();
  await expect(water).toHaveAttribute('aria-checked', 'true');
  await expect(hours).toHaveAttribute('aria-checked', 'false');
  const equalWater = await needMetPercentages(bars);

  expect(equalWater).not.toEqual(equalHours);
  // The fairness claim of the screen: equal water lifts the tail outlets that
  // equal hours leaves short.
  const tailHours = equalHours[equalHours.length - 1] as number;
  const tailWater = equalWater[equalWater.length - 1] as number;
  expect(tailWater).toBeGreaterThan(tailHours);

  await hours.click();
  await expect(hours).toHaveAttribute('aria-checked', 'true');
  expect(await needMetPercentages(bars)).toEqual(equalHours);

  expect(consoleErrors).toEqual([]);
});