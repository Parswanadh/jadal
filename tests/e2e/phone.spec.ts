import { expect, settle, test } from './support/app';
import en from '../../apps/web/src/i18n/en.json';
import { CALLER_ID } from '../../apps/web/src/phone/helpers';

/**
 * Requirement 6: the phone screen accepts the simulated call.
 *
 * Button labels come from the app's English language file; the transcript
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
  await expect(incoming.getByText(en.phone.incoming)).toBeVisible();

  await page.getByRole('button', { name: en.phone.accept }).click();

  // The incoming-call dialog is replaced by the live call.
  await expect(incoming).toHaveCount(0);
  await expect(page.getByRole('heading', { name: en.phone.transcript })).toBeVisible();
  await expect(page.getByText(`${en.phone.ackState}: Waiting`).first()).toBeVisible();
  // Times read like "Mon 14 Sep, 6:00 am", never as UTC or ISO.
  await expect(page.getByText(/^Water Committee · \w{3} \d{1,2} \w{3}, \d{1,2}:\d\d (am|pm)$/)).toBeVisible();
  await expect(page.getByText('Your next water turn is Tue 15 Sep, 6:00–9:00 am at Outlet 1.')).toBeVisible();

  // A reply round-trips through the mock API and the assistant answers.
  const reply = page.getByPlaceholder(en.phone.replyPlaceholder);
  await reply.fill('నీరు కావాలి');
  await page.getByRole('button', { name: en.phone.send }).click();
  await expect(page.getByText(en.phone.agent, { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Thank you. Your turn is confirmed.')).toBeVisible();
  // The acknowledgement shows in the status badge and in the screen-reader live region.
  await expect(page.getByText(`${en.phone.ackState}: Confirmed`).first()).toBeVisible();

  await settle(page);
  expect(consoleErrors).toEqual([]);
});

test('the phone screen can decline the call and ring again', async ({ page }) => {
  await page.goto('/phone');

  await page.getByRole('button', { name: en.phone.decline }).click();
  await expect(page.getByRole('paragraph').filter({ hasText: en.phone.callEnded })).toBeVisible();

  await page.getByRole('button', { name: en.phone.callBack }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: CALLER_ID })).toBeVisible();
  await expect(page.getByRole('button', { name: en.phone.accept })).toBeVisible();
});
