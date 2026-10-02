import { COORDINATOR_PASSWORD, FARMER_PASSWORD, SESSION_KEY, expect, settle, signInAs, test } from './support/app';
import en from '../../apps/web/src/i18n/en.json';

/**
 * The client-side role gate: redirect, wrong password, each role's landing
 * screen, no cross-over, sign-out, session restore.
 */

test('an unauthenticated visit to a protected route redirects to /login', async ({ page, consoleErrors }) => {
  await page.goto('/coordinator?tab=farmers');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.login.title);

  await page.goto('/farmer');
  await expect(page).toHaveURL(/\/login$/);

  await settle(page);
  expect(consoleErrors).toEqual([]);
});

test('a wrong password is rejected without saying which part was wrong', async ({ page, consoleErrors }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: en.login.role.farmer, exact: true }).click();
  await page.getByLabel(en.login.passwordLabel).fill('definitely-not-the-password');
  await page.getByRole('button', { name: en.login.submit, exact: true }).click();

  await expect(page.getByRole('alert')).toHaveText(en.login.error);
  await expect(page).toHaveURL(/\/login$/);

  // Still locked out afterwards.
  await page.goto('/farmer');
  await expect(page).toHaveURL(/\/login$/);

  await settle(page);
  expect(consoleErrors).toEqual([]);
});

test('the coordinator signs in and lands on the console', async ({ page, consoleErrors }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: en.login.role.coordinator, exact: true }).click();
  await page.getByLabel(en.login.passwordLabel).fill(COORDINATOR_PASSWORD);
  await page.getByRole('button', { name: en.login.submit, exact: true }).click();

  await expect(page).toHaveURL(/\/coordinator$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.page.coordinator.title);
  await expect(page.getByRole('button', { name: en.auth.signOut, exact: true })).toBeVisible();

  await settle(page);
  expect(consoleErrors).toEqual([]);
});

test('the farmer signs in and lands on the portal', async ({ page, consoleErrors }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: en.login.role.farmer, exact: true }).click();
  await page.getByLabel(en.login.passwordLabel).fill(FARMER_PASSWORD);
  await page.getByRole('button', { name: en.login.submit, exact: true }).click();

  await expect(page).toHaveURL(/\/farmer$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.page.farmer.title);

  await settle(page);
  expect(consoleErrors).toEqual([]);
});

test('signing in returns to the screen the visitor was headed to', async ({ page, consoleErrors }) => {
  await page.goto('/coordinator?tab=farmers');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByRole('button', { name: en.login.role.coordinator, exact: true }).click();
  await page.getByLabel(en.login.passwordLabel).fill(COORDINATOR_PASSWORD);
  await page.getByRole('button', { name: en.login.submit, exact: true }).click();

  await expect(page).toHaveURL(/\/coordinator\?tab=farmers$/);

  await settle(page);
  expect(consoleErrors).toEqual([]);
});

test('the wrong role cannot reach the other portal', async ({ page, consoleErrors }) => {
  await signInAs(page, 'farmer');
  await page.goto('/coordinator');
  await expect(page).toHaveURL(/\/farmer$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.page.farmer.title);

  await signInAs(page, 'coordinator');
  await page.goto('/farmer');
  await expect(page).toHaveURL(/\/coordinator$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.page.coordinator.title);

  await settle(page);
  expect(consoleErrors).toEqual([]);
});

test('signing out returns to /login and locks the portals again', async ({ page, consoleErrors }) => {
  await signInAs(page, 'coordinator');
  await page.goto('/coordinator');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.page.coordinator.title);

  await page.getByRole('button', { name: en.auth.signOut, exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.login.title);

  await page.goto('/coordinator');
  await expect(page).toHaveURL(/\/login$/);

  await settle(page);
  expect(consoleErrors).toEqual([]);
});

test('the session survives a reload and is stored under one key', async ({ page, consoleErrors }) => {
  await signInAs(page, 'farmer');
  await page.goto('/farmer');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.page.farmer.title);
  await expect(page.getByRole('button', { name: en.auth.signOut, exact: true })).toBeVisible();

  const raw = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_KEY);
  expect(raw).toBeTruthy();
  const parsed = JSON.parse(raw ?? '{}') as { role?: string; signedInAt?: string };
  expect(parsed.role).toBe('farmer');
  expect(typeof parsed.signedInAt).toBe('string');

  await settle(page);
  expect(consoleErrors).toEqual([]);
});
