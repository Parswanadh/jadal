import { expect, settle, signInAs, test } from './support/app';
import en from '../../apps/web/src/i18n/en.json';

/**
 * Requirement 3: an urgent request from the farmer triggers the agent's call,
 * and the phone surface shows the agent speaking the Telugu reply.
 */

test('an urgent request triggers the agent call and its spoken reply', async ({ page, consoleErrors }) => {
  await signInAs(page, 'farmer');
  await page.goto('/farmer?tab=ask');

  // The urgent option says the agent will call.
  await expect(page.getByText(en.ask.urgentCallNote)).toBeVisible();

  await page.getByLabel(en.ask.volume).fill('200');
  await page.getByLabel(en.ask.reason).fill('My maize is wilting in the heat.');
  await page.getByRole('button', { name: en.ask.submit, exact: true }).click();

  const call = page.locator('.agent-call');
  await expect(call).toBeVisible();
  await expect(call.getByText(en.phone.agentCallTitle)).toBeVisible();
  await expect(call.getByText(en.phone.agentCallSimulated)).toBeVisible();
  await expect(call.getByRole('button', { name: en.phone.agentCallPlay, exact: true })).toBeVisible();

  // The agent speaks Telugu: the transcript carries Telugu script.
  const transcript = await call.locator('.jadal-phone__transcript').innerText();
  expect(transcript).toMatch(/[ఀ-౿]/);

  await settle(page);
  expect(consoleErrors).toEqual([]);
});

test('the agent call can be opened on the phone screen', async ({ page, consoleErrors }) => {
  await signInAs(page, 'farmer');
  await page.goto('/farmer?tab=ask');

  await page.getByLabel(en.ask.volume).fill('150');
  await page.getByLabel(en.ask.reason).fill('The tail end got a short turn.');
  await page.getByRole('button', { name: en.ask.submit, exact: true }).click();

  const call = page.locator('.agent-call');
  await expect(call).toBeVisible();
  await call.getByRole('link', { name: en.phone.agentCallOpen, exact: true }).click();

  await expect(page).toHaveURL(/\/phone\?contact=/);
  await expect(page.getByTestId('simulated-phone')).toBeVisible();

  await settle(page);
  expect(consoleErrors).toEqual([]);
});
