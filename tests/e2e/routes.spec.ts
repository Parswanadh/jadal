import { expect, settle, signInAs, test } from './support/app';
import type { E2ERole } from './support/app';
import en from '../../apps/web/src/i18n/en.json';

/**
 * Requirement 1: every route renders its page header and logs no console
 * errors. Expected headings come from the app's own dictionaries, so a broken
 * route or a missing string fails the test instead of being duplicated here.
 *
 * `/` uses the landing hero; every other screen uses the shared `PageHeader`.
 * `/farmer` and `/coordinator` need a session, so those cases sign in first.
 */
interface RouteCase {
  path: string;
  navLabel: string;
  heading: string;
  eyebrow: string;
  headerSelector: '.hero' | '.page-header';
}

const PUBLIC_ROUTES: RouteCase[] = [
  {
    path: '/',
    navLabel: en.nav.home,
    heading: en.home.title,
    eyebrow: en.home.eyebrow,
    headerSelector: '.hero',
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

const PROTECTED_ROUTES: (RouteCase & { role: E2ERole })[] = [
  {
    path: '/farmer',
    role: 'farmer',
    navLabel: en.nav.farmer,
    heading: en.page.farmer.title,
    eyebrow: en.page.farmer.eyebrow,
    headerSelector: '.page-header',
  },
  {
    path: '/coordinator',
    role: 'coordinator',
    navLabel: en.nav.coordinator,
    heading: en.page.coordinator.title,
    eyebrow: en.page.coordinator.eyebrow,
    headerSelector: '.page-header',
  },
];

for (const route of PUBLIC_ROUTES) {
  test(`${route.path} renders its page header with no console errors`, async ({ page, consoleErrors }) => {
    await page.goto(route.path);

    const header = page.locator(route.headerSelector);
    await expect(header.getByRole('heading', { level: 1 })).toHaveText(route.heading);
    // The eyebrow is a short label; match on it rather than the whole header text.
    await expect(header.locator('.eyebrow').first()).toContainText(route.eyebrow);

    // No developer text on screen: no API paths, HTTP verbs, internal ids or raw ISO times.
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/\/api\/|\bPOST\b|\bGET\b|\brw\d\b|\bf\d\b|\bo\d\b/);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);

    await settle(page);
    expect(consoleErrors).toEqual([]);
  });
}

for (const route of PROTECTED_ROUTES) {
  test(`${route.path} renders its page header for the ${route.role} role`, async ({ page, consoleErrors }) => {
    await signInAs(page, route.role);
    await page.goto(route.path);

    const header = page.locator(route.headerSelector);
    await expect(header.getByRole('heading', { level: 1 })).toHaveText(route.heading);
    await expect(header.locator('.eyebrow').first()).toContainText(route.eyebrow);

    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/\/api\/|\bPOST\b|\bGET\b|\brw\d\b|\bf\d\b|\bo\d\b/);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);

    await settle(page);
    expect(consoleErrors).toEqual([]);
  });
}

/** Sub-tabs of the farmer and coordinator screens, where most of the copy lives. */
const SUB_TABS: { path: string; role: E2ERole }[] = [
  { path: '/farmer?tab=ask', role: 'farmer' },
  { path: '/farmer?tab=pool', role: 'farmer' },
  { path: '/farmer?tab=register', role: 'farmer' },
  { path: '/coordinator?tab=requests', role: 'coordinator' },
  { path: '/coordinator?tab=farmers', role: 'coordinator' },
  { path: '/coordinator?tab=entitlements', role: 'coordinator' },
  { path: '/coordinator?tab=roster', role: 'coordinator' },
  { path: '/coordinator?tab=accounts', role: 'coordinator' },
];

test('every sub-tab keeps developer text off the screen', async ({ page, consoleErrors }) => {
  for (const entry of SUB_TABS) {
    await signInAs(page, entry.role);
    await page.goto(entry.path);
    await settle(page);
    const text = await page.locator('main').innerText();
    expect(text, entry.path).not.toMatch(/\/api\/|\bPOST\b|\bGET\b|\brw\d\b|\bf\d\b|\bo\d\b/);
    expect(text, entry.path).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  }
  expect(consoleErrors).toEqual([]);
});

test('the primary navigation reaches the public screens and follows the role', async ({ page, consoleErrors }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: en.a11y.mainNav });

  // Signed out: public links only, no portal the visitor cannot reach.
  await expect(nav.getByRole('link')).toHaveCount(PUBLIC_ROUTES.length);
  await expect(nav.getByRole('link', { name: en.nav.farmer, exact: true })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: en.nav.coordinator, exact: true })).toHaveCount(0);

  for (const route of PUBLIC_ROUTES) {
    await nav.getByRole('link', { name: route.navLabel, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(route.path);
  }

  // Signed in as a farmer: the farmer portal, never the coordinator console.
  await signInAs(page, 'farmer');
  await page.goto('/');
  await expect(nav.getByRole('link')).toHaveCount(PUBLIC_ROUTES.length + 1);
  await expect(nav.getByRole('link', { name: en.nav.farmer, exact: true })).toHaveCount(1);
  await expect(nav.getByRole('link', { name: en.nav.coordinator, exact: true })).toHaveCount(0);
  await nav.getByRole('link', { name: en.nav.farmer, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: en.page.farmer.title })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/farmer');

  // Signed in as a coordinator: the coordinator console, never the farmer portal.
  await signInAs(page, 'coordinator');
  await page.goto('/');
  await expect(nav.getByRole('link')).toHaveCount(PUBLIC_ROUTES.length + 1);
  await expect(nav.getByRole('link', { name: en.nav.coordinator, exact: true })).toHaveCount(1);
  await expect(nav.getByRole('link', { name: en.nav.farmer, exact: true })).toHaveCount(0);
  await nav.getByRole('link', { name: en.nav.coordinator, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: en.page.coordinator.title })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/coordinator');

  await settle(page);
  expect(consoleErrors).toEqual([]);
});
