import { expect, settle, test } from './support/app';
import { CALLER_ID } from '../../apps/web/src/phone/helpers';

/**
 * Requirement 6: the phone screen accepts the simulated call.
 *
 * Button labels come from the screen's own English string table; the transcript
 * texts are the payloads the app's mock API returns for contacts and replies
 * (see apps/web/src/api/mock.ts).
 */
test('the phone screen accepts the simulated call and answers the farmer', async ({
  page,
  consoleErrors,
}) => {
  await page.goto('/phone');

  const incoming = page.getByRole('dialog');
  await expect(incoming.getByRole('heading', { name: CALLER_ID })).toBeVisible();
  await expect(incoming.getByText('Incoming call')).toBeVisible();

  await page.getByRole('button', { name: 'Accept' }).click();

  // The incoming-call dialog is replaced by the live call.
  await expect(incoming).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Transcript' })).toBeVisible();
  await expect(page.getByText('Acknowledgement: Queued').first()).toBeVisible();
  await expect(page.getByText(/^Water Committee · \d\d:\d\d UTC$/)).toBeVisible();
  await expect(page.getByText('Your water turn time has changed (mock).')).toBeVisible();

  // A reply round-trips through the mock API and the agent answers.
  const reply = page.getByPlaceholder('Type your reply (Telugu or English)…');
  await reply.fill('నీరు కావాలి');
  await page.getByRole('button', { name: 'Send reply' }).click();
  await expect(page.getByText('Jadal agent', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Okay, your turn has been confirmed (mock).')).toBeVisible();
  // The acknowledgement shows in the status badge and in the screen-reader live region.
  await expect(page.getByText('Acknowledgement: Acknowledged').first()).toBeVisible();

  await settle(page);
  expect(consoleErrors).toEqual([]);
});

test('the phone screen can decline the call and ring again', async ({ page }) => {
  await page.goto('/phone');

  await page.getByRole('button', { name: 'Decline' }).click();
  await expect(page.getByRole('paragraph').filter({ hasText: 'Call ended' })).toBeVisible();

  await page.getByRole('button', { name: 'Call back' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: CALLER_ID })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept' })).toBeVisible();
});