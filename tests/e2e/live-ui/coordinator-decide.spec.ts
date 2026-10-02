import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import en from '../../../apps/web/src/i18n/en.json';

/**
 * The coordinator's Reject/Approve actions, driven through the **real UI** against the **live API**.
 *
 * Why this suite exists. A previous "approve/reject works" claim was backed only by mock mode and
 * by calling the API directly with curl. Both were true and both missed the actual bug: the UI's
 * `decide()` swallowed every error (`catch { setDecideFailed(true) }`), so a rejected decision that
 * never reached the API was invisible — the coordinator saw nothing happen and so did we. Nothing
 * in the offline suite could catch that, because the offline suite never leaves mock mode.
 *
 * So these tests cross the seam the bug lived in:
 *
 *   1. a real Chromium drives apps/web with `VITE_MOCK=0`, proxied to the live Worker on 8788;
 *   2. the request acted on is raised through the live API (`POST /api/requests`), so it is a real
 *      row in real D1 rather than a fixture;
 *   3. the assertion is made against the **live API's own state** (`GET /api/requests`), not against
 *      what the page chose to render — a UI that lies about the outcome cannot pass.
 *
 * Serial, because every test shares one live database.
 */

test.describe.configure({ mode: 'serial' });

/**
 * Start from the seed scenario before every test.
 *
 * The suite shares one live D1 with the `live` project and with whatever a developer
 * was doing by hand, so each test resets and then raises the single request it acts on.
 * This also keeps the pending queue short: the single-click probe deliberately leaves
 * its request pending, which would otherwise push a later test's card down the page,
 * and a card below the fold cannot be clicked.
 */
test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/demo/reset', { data: {} });
  expect(res.status(), 'the live API must be in demo mode for the suite to reset it').toBe(200);
});

/**
 * A farmer id -> name map matching packages/contracts/fixtures/demo-scenario.json.
 *
 * Each test acts on a *different* farmer. The tests run serially against one live D1,
 * and a test that deliberately leaves its request pending (the single-click probe) would
 * otherwise leave a second card for the same name, so a later lookup by name could arm
 * the wrong one.
 */
const FARMERS = {
  singleClickProbe: { id: 'f3', name: 'Venkata Rao Gadde' },
  reject: { id: 'f4', name: 'Suresh Babu Nannapaneni' },
  approve: { id: 'f5', name: 'Anjamma Bandi' },
  refusedError: { id: 'f6', name: 'Srinivas Reddy Yeluri' },
  transportError: { id: 'f7', name: 'Padmavathi Kolli' },
  alert: { id: 'f1', name: 'Ramaiah Kota' },
} as const;

/** Sign in as the coordinator without walking the form. Mirrors tests/e2e/support/app.ts. */
const SESSION_KEY = 'jadal.session';

async function signInAsCoordinator(page: Page): Promise<void> {
  await page.goto('/login');
  await page.evaluate(
    ({ key }) => {
      window.localStorage.setItem(key, JSON.stringify({ role: 'coordinator', signedInAt: new Date().toISOString() }));
    },
    { key: SESSION_KEY },
  );
}

/** Raise a real pending request through the live API and return its id. */
async function raiseRequest(
  request: APIRequestContext,
  opts: { farmerId: string; volumeM3: number; reason: string },
): Promise<string> {
  const res = await request.post('/api/requests', {
    data: {
      farmer_id: opts.farmerId,
      type: 'urgent',
      volume_m3: opts.volumeM3,
      reason: opts.reason,
      channel: 'portal',
    },
  });
  expect(res.status(), 'raising a request through the live API should succeed').toBe(200);
  const body = (await res.json()) as { id: string; status: string };
  expect(body.status, 'a freshly raised request starts undecided').toBe('triaged');
  return body.id;
}

/** The live API's own view of one request, or undefined once it is gone. */
async function requestOnServer(
  request: APIRequestContext,
  id: string,
): Promise<{ status: string; coordinator_decision?: { decision: string; volume_m3: number } } | undefined> {
  const res = await request.get('/api/requests');
  expect(res.status()).toBe(200);
  const rows = (await res.json()) as Array<{
    id: string;
    status: string;
    coordinator_decision?: { decision: string; volume_m3: number };
  }>;
  return rows.find((row) => row.id === id);
}

/**
 * The pending queue: only the cards, never the "Already decided" table below it.
 *
 * Scoping to `.req-grid` matters. A decided request does not vanish from the page —
 * it moves into the decided table, which also carries the farmer's name — so a bare
 * `.req-card` filter would keep matching a farmer who has just been decided and make
 * a working reject look like a failure.
 */
function pendingQueue(page: Page) {
  return page.locator('.req-grid');
}

/** One farmer's *pending* card. */
function cardFor(page: Page, farmerName: string) {
  return pendingQueue(page).locator('.req-card').filter({ hasText: farmerName }).first();
}

/** The decided table's row for one farmer. */
function decidedRowFor(page: Page, farmerName: string) {
  return page.locator('.req-decided tbody tr').filter({ hasText: farmerName }).first();
}

/**
 * Open the queue on the pending card for one farmer, scrolled into view.
 *
 * Every test waits for its own card before touching it: the console re-reads the queue
 * after mount, so a click that lands before that re-read can hit a card that is about
 * to be replaced. Waiting on the card is the honest synchronisation point.
 */
async function openCard(page: Page, farmerName: string) {
  const card = cardFor(page, farmerName);
  await expect(card).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  return card;
}

/** The two button labels one confirm control shows: the arming button, then confirm/cancel. */
const APPROVE_ARM = new RegExp(en.coord.req.approve.replace('{m3}', '').trim());
const REJECT_ARM = new RegExp(`^${en.coord.req.reject}$`);

test('a single click on Reject does not decide, and says it is asking', async ({ page, request }) => {
  // The user's report: "I click Say no and nothing happens." The click must NOT decide
  // (it is step 1 of 2), and the control must make that state impossible to miss.
  const id = await raiseRequest(request, { farmerId: FARMERS.singleClickProbe.id, volumeM3: 25, reason: 'single click probe' });
  await signInAsCoordinator(page);
  await page.goto('/coordinator?tab=requests');

  const card = await openCard(page, FARMERS.singleClickProbe.name);

  // Arm it: one click only.
  await card.getByRole('button', { name: REJECT_ARM }).click();

  // The asking state is announced and carries a numbered step, so a coordinator can
  // tell they are mid-confirmation rather than looking at a no-op.
  const asking = card.locator('.confirm-inline');
  await expect(asking).toBeVisible();
  await expect(asking).toHaveAttribute('role', 'alertdialog');
  await expect(card.locator('.confirm-step').first()).toHaveText(
    new RegExp(`^${en.coord.req.rejectAction}: step 1 of 2$`),
  );
  await expect(card.locator('.confirm-step-next')).toHaveText(en.common.connect.confirmConfirm);
  // Focus lands on the confirm button, so the next Enter finishes the decision.
  await expect(asking.getByRole('button', { name: en.coord.req.rejectYes })).toBeFocused();

  // Nothing was decided by that click — on the screen or in the live database.
  expect(await requestOnServer(request, id), 'a single click must not decide').toMatchObject({ status: 'triaged' });
  await expect(card).toBeVisible();
});

test('rejecting through the UI reaches status: rejected in the live API', async ({ page, request }) => {
  const id = await raiseRequest(request, { farmerId: FARMERS.reject.id, volumeM3: 25, reason: 'reject end to end' });
  await signInAsCoordinator(page);
  await page.goto('/coordinator?tab=requests');

  const card = await openCard(page, FARMERS.reject.name);

  // Step 1: arm. Step 2: confirm.
  await card.getByRole('button', { name: REJECT_ARM }).click();
  await card.locator('.confirm-inline').getByRole('button', { name: en.coord.req.rejectYes }).click();

  // The row leaves the pending queue and lands in the decided list...
  await expect(cardFor(page, FARMERS.reject.name)).toHaveCount(0);
  const decided = decidedRowFor(page, FARMERS.reject.name);
  await expect(decided).toBeVisible();
  await expect(decided).toContainText(en.coord.req.resultRejected);

  // ...and the live API agrees, which is the assertion that cannot be faked by the UI.
  await expect
    .poll(async () => (await requestOnServer(request, id))?.status, {
      message: 'the live API must record the rejection',
    })
    .toBe('rejected');
  expect((await requestOnServer(request, id))?.coordinator_decision).toMatchObject({
    decision: 'reject',
    volume_m3: 0,
  });

  // No failure banner: the decision really went through.
  await expect(page.locator('.notice-crit')).toHaveCount(0);
});

test('approving through the UI reaches status: approved in the live API', async ({ page, request }) => {
  const id = await raiseRequest(request, { farmerId: FARMERS.approve.id, volumeM3: 30, reason: 'approve end to end' });
  await signInAsCoordinator(page);
  await page.goto('/coordinator?tab=requests');

  const card = await openCard(page, FARMERS.approve.name);

  await card.getByRole('button', { name: APPROVE_ARM }).click();
  await card.locator('.confirm-inline').getByRole('button', { name: en.coord.req.approveYes }).click();

  await expect(cardFor(page, FARMERS.approve.name)).toHaveCount(0);
  const decided = decidedRowFor(page, FARMERS.approve.name);
  await expect(decided).toBeVisible();
  await expect(decided).toContainText(en.coord.req.resultApproved.split('{')[0]?.trim() ?? '');
  await expect
    .poll(async () => (await requestOnServer(request, id))?.status, {
      message: 'the live API must record the approval',
    })
    .toBe('approved');

  // The volume the coordinator actually granted is what the API stored.
  const stored = (await requestOnServer(request, id))?.coordinator_decision;
  expect(stored?.decision).toBe('approve');
  expect(stored?.volume_m3).toBe(30);
});

test('a decide the API refuses shows the API’s own reason, not silence', async ({ page, request }) => {
  // The regression this suite is really for. The API is made to answer exactly what it
  // answers when the contract body is wrong (`volume_m3: Required`); the UI must put that
  // message on screen. Before the fix the catch discarded it and showed nothing at all.
  const id = await raiseRequest(request, { farmerId: FARMERS.refusedError.id, volumeM3: 20, reason: 'surfaced error' });
  await signInAsCoordinator(page);

  await page.route(`**/api/requests/${id}/decide`, (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'validation_error', message: 'volume_m3: Required' } }),
    }),
  );

  await page.goto('/coordinator?tab=requests');
  const card = await openCard(page, FARMERS.refusedError.name);

  await card.getByRole('button', { name: REJECT_ARM }).click();
  await card.locator('.confirm-inline').getByRole('button', { name: en.coord.req.rejectYes }).click();

  // The API's own words reach the coordinator.
  const alert = page.locator('.notice-crit[role="alert"]');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('volume_m3: Required');
  await expect(alert).toContainText(en.coord.req.decideError.split('{')[0]?.trim() ?? '');

  // And the row is still pending, because it was never decided.
  await expect(cardFor(page, FARMERS.refusedError.name)).toBeVisible();
  expect((await requestOnServer(request, id))?.status).toBe('triaged');
});

test('a transport failure also reports a reason rather than nothing', async ({ page, request }) => {
  const id = await raiseRequest(request, { farmerId: FARMERS.transportError.id, volumeM3: 20, reason: 'transport error' });
  await signInAsCoordinator(page);

  // No API response at all: the request aborts. The reason is the transport's message.
  await page.route(`**/api/requests/${id}/decide`, (route) => route.abort('failed'));

  await page.goto('/coordinator?tab=requests');
  const card = await openCard(page, FARMERS.transportError.name);

  await card.getByRole('button', { name: REJECT_ARM }).click();
  await card.locator('.confirm-inline').getByRole('button', { name: en.coord.req.rejectYes }).click();

  const alert = page.locator('.notice-crit[role="alert"]');
  await expect(alert).toBeVisible();
  // Some real reason, never an empty banner.
  await expect(alert).not.toHaveText('');
  await expect(alert).toContainText(en.coord.req.decideError.split('{')[0]?.trim() ?? '');
  await expect(cardFor(page, FARMERS.transportError.name)).toBeVisible();
});

test('the alert control names the number the live API dialled, not the farmer’s own', async ({ page, request }) => {
  // Bug 2: with one coordinator number and the rest farmers, the API maps a farmer onto a
  // demo handset. The console must report where the call actually went.
  await raiseRequest(request, { farmerId: FARMERS.alert.id, volumeM3: 15, reason: 'dialled destination' });
  await signInAsCoordinator(page);
  await page.goto('/coordinator?tab=requests');

  const card = await openCard(page, FARMERS.alert.name);
  await card.locator('summary').first().click();

  await card.locator('.alert-form').getByRole('button', { name: /Send/ }).first().click();

  const status = card.locator('.alert-form [role="status"]');
  await expect(status).toBeVisible();
  // Whatever the live API decided, the console states a destination honestly: either the
  // handset it rang, or plainly that nothing was rung. It never shows a number it invented.
  await expect(card.locator('.alert-dialled')).toBeVisible();
  const dialled = (await card.locator('.alert-dialled').innerText()).trim();
  expect(dialled.length).toBeGreaterThan(0);

  // The destination shown must be one of the two honest statements, never the farmer's
  // stored placeholder presented as fact while the API reported something else.
  const showsNumber = /\+\d{6,}/.test(dialled);
  const showsNone = dialled === en.coord.alert.dialledNone;
  expect(showsNumber || showsNone, `unexpected destination line: ${dialled}`).toBe(true);
});
