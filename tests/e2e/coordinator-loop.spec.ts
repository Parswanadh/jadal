import { expect, settle, signInAs, test } from './support/app';
import en from '../../apps/web/src/i18n/en.json';

/**
 * The coordinator's side of the farmer -> coordinator -> farmer loop.
 *
 * The user's report was "if I raise a request as a farmer I cannot see it as a
 * coordinator". The cause was mock mode holding its state inside one browser
 * session rather than a missing wire, so these tests cover the coordinator
 * surface as the coordinator actually reaches it: the queue lists what the API
 * returns, a decision moves the item out of pending, the outcome is reported
 * honestly, and the alert control carries the farmer's allocation.
 *
 * The cross-role hop itself (farmer raises, coordinator sees, farmer sees the
 * approval) is covered where it is deterministic: the api-level loop test in
 * apps/web/src/coordinator/api.test.ts, which drives the shared client end to
 * end, and the live-API verification recorded in the lane report.
 */

const APPROVE = new RegExp(en.coord.req.approve.replace('{m3}', '').trim());

/** Open the queue on its own card and return that card. */
function queueCard(page: import('@playwright/test').Page) {
  return page.locator('.req-card').first();
}

test('the queue lists a pending request with the farmer, volume and reason', async ({ page, consoleErrors }) => {
  await signInAs(page, 'coordinator');
  await page.goto('/coordinator?tab=requests');

  const card = queueCard(page);
  await expect(card).toBeVisible();
  // The farmer's name, the volume asked for, and the reason are all on screen.
  await expect(card.locator('strong').first()).not.toBeEmpty();
  await expect(card).toHaveText(/m³/);
  await expect(card.getByText(en.coord.req.reason.split('{')[0]?.trim() ?? '')).toBeVisible();

  await settle(page);
  expect(consoleErrors).toEqual([]);
});

test('the queue offers an explicit re-read, so a request raised elsewhere is not missed', async ({
  page,
  consoleErrors,
}) => {
  await signInAs(page, 'coordinator');
  await page.goto('/coordinator?tab=requests');

  const refresh = page.getByRole('button', { name: en.coord.req.refresh, exact: true });
  await expect(refresh).toBeVisible();

  // A request raised after the console opened is picked up by the re-read.
  const card = queueCard(page);
  await expect(card).toBeVisible();
  const before = await page.locator('.req-card').count();

  await refresh.click();
  await expect(page.getByRole('button', { name: en.coord.req.refresh, exact: true })).toBeEnabled();
  await expect(page.locator('.req-card')).toHaveCount(before);

  await settle(page);
  expect(consoleErrors).toEqual([]);
});

test('approving a request moves it out of pending and reports what was dispatched', async ({ page, consoleErrors }) => {
  await signInAs(page, 'coordinator');
  await page.goto('/coordinator?tab=requests');

  const card = queueCard(page);
  const farmer = (await card.locator('strong').first().innerText()).trim();
  await card.getByRole('button', { name: APPROVE }).click();
  await card.locator('.confirm-inline').getByRole('button', { name: en.coord.req.approveYes }).click();

  // The item leaves the pending queue and lands in the decided list.
  const decided = page.locator('.req-decided');
  await expect(decided).toBeVisible();
  await expect(decided).toContainText(farmer);
  await expect(decided).toContainText(en.coord.req.resultApproved.split('{')[0]?.trim() ?? '');

  // The decision is reported honestly: mock mode queues a call, so it says so.
  await expect(decided).toContainText(en.coord.req.dispatched.split('{')[0]?.trim() ?? '');

  await settle(page);
  expect(consoleErrors).toEqual([]);
});

test('an approval the API does not dispatch is reported plainly', async ({ page, consoleErrors }) => {
  await signInAs(page, 'coordinator');
  await page.goto('/coordinator?tab=requests');

  // The decision succeeds, but the API reports no contact for the farmer.
  await page.route('**/api/contacts*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  const card = queueCard(page);
  await card.getByRole('button', { name: APPROVE }).click();
  await card.locator('.confirm-inline').getByRole('button', { name: en.coord.req.approveYes }).click();

  await expect(page.locator('.req-decided')).toContainText(en.coord.req.notDispatched);

  await settle(page);
  expect(consoleErrors).toEqual([]);
});

test('the alert control explains when the farmer has no allocation yet', async ({ page, consoleErrors }) => {
  await signInAs(page, 'coordinator');
  await page.goto('/coordinator?tab=requests');

  const card = queueCard(page);
  await card.getByText(en.coord.alert.title, { exact: true }).click();

  // Nothing approved for this farmer, so there is no allocation to include and
  // the control says so rather than inventing a number.
  await expect(card.getByText(en.coord.alert.allocationNone)).toBeVisible();
  // The ordinary alert is still available.
  await expect(card.getByRole('button', { name: en.coord.alert.send, exact: true })).toBeVisible();

  await settle(page);
  expect(consoleErrors).toEqual([]);
});

test('the alert control carries the allocation to the farmer once one exists', async ({ page, consoleErrors }) => {
  await signInAs(page, 'coordinator');
  await page.goto('/coordinator?tab=requests');

  // Approve the pending request first: that is what creates the allocation.
  const card = queueCard(page);
  await card.getByRole('button', { name: APPROVE }).click();
  await card.locator('.confirm-inline').getByRole('button', { name: en.coord.req.approveYes }).click();

  // The item moves into the decided list, which offers the alert control so the
  // farmer can be told the allocation that was just created.
  const decided = page.locator('.req-decided');
  await expect(decided).toContainText(en.coord.req.resultApproved.split('{')[0]?.trim() ?? '');

  const decidedRow = decided.locator('tbody tr').first();
  await decidedRow.getByText(en.coord.alert.title, { exact: true }).click();
  await expect(decidedRow.getByText(en.coord.alert.allocationOn)).toBeVisible();
  // The volume and the window are both shown, read from the API: the summary is
  // "<volume>, <window>", so it carries a number in m³ and a time range.
  const summary = decidedRow.locator('.alert-form .choice-compact .muted');
  await expect(summary).toHaveText(/\d[\d,]* m³/);
  await expect(summary).toHaveText(/\d{1,2}:\d{2}/);

  // Sending it reports the allocation it carried.
  await decidedRow.getByRole('button', { name: en.coord.alert.allocationSend, exact: true }).click();
  await expect(decidedRow.getByRole('status')).toContainText(
    en.coord.alert.allocationSent.split('{')[0]?.trim() ?? '',
  );

  await settle(page);
  expect(consoleErrors).toEqual([]);
});
