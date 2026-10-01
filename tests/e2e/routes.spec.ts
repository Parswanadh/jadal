import { expect, settle, test } from './support/app';
import en from '../../apps/web/src/i18n/en.json';

/**
 * Requirement 1: every route renders its page header and logs no console
 * errors. Expected headings come from the app's own dictionaries, so a broken
 * route or a missing string fails the test instead of being duplicated here.
 *
 * `/` uses the landing hero; every other screen uses the shared `PageHeader`.
 */
const ROUTES: {
  path: string;
  navLabel: string;
  heading: string;
  eyebrow: string;
  headerSelector: '.hero' | '.page-header';
}[] = [
  {
    path: '/',
    navLabel: en.nav.home,
    heading: en.home.title,
    eyebrow: en.home.eyebrow,
    headerSelector: '.hero',
  },
  {
    path: '/farmer',
    navLabel: en.nav.farmer,
    heading: en.page.farmer.title,
    eyebrow: en.page.farmer.eyebrow,
    headerSelector: '.page-header',
  },
  {
    path: '/coordinator',
    navLabel: en.nav.coordinator,
    heading: en.page.coordinator.title,
    eyebrow: en.page.coordinator.eyebrow,
    headerSelector: '.page-header',
  },
  {
    path: '/canal',
    navLabel: en.nav.canal,
    heading: en.page.canal.title,
    eyebrow: en.page.canal.eyebrow,
    headerSelector: '.page-header',
  },
  {
    path: '/phone',
    navLabel: en.nav.phone,
    heading: en.page.phone.title,
    eyebrow: en.page.phone.eyebrow,
    headerSelector: '.page-header',
  },
  {
    path: '/demo',
    navLabel: en.nav.demo,
    heading: en.page.demo.title,
    eyebrow: en.page.demo.eyebrow,
    headerSelector: '.page-header',
  },
];

for (const route of ROUTES) {
  test(`${route.path} renders its page header with no console errors`, async ({ page, consoleErrors }) => {
    await page.goto(route.path);

    const header = page.locator(route.headerSelector);
    await expect(header.getByRole('heading', { level: 1 })).toHaveText(route.heading);
    // The canal screen appends the canal name to its eyebrow, so match on the label.
    await expect(header.locator('.eyebrow').first()).toContainText(route.eyebrow);

    await settle(page);
    expect(consoleErrors).toEqual([]);
  });
}

test('the primary navigation reaches every screen', async ({ page, consoleErrors }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: en.a11y.mainNav });
  await expect(nav.getByRole('link')).toHaveCount(ROUTES.length);

  for (const route of ROUTES) {
    await nav.getByRole('link', { name: route.navLabel, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(route.path);
  }

  await settle(page);
  expect(consoleErrors).toEqual([]);
});