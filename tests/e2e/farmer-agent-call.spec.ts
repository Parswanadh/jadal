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

/**
 * Raising a request must not make noise.
 *
 * The browser voice used to fire by itself the moment the agent's reply
 * arrived, which hijacked the screen. Speech is now user-initiated only, so
 * this records every call to speechSynthesis.speak before the app boots and
 * asserts the count stays at zero through the whole raise-a-request flow —
 * including the call panel and the phone screen it links to.
 */
test('raising a request never starts speech on its own', async ({ page, consoleErrors }) => {
  await page.addInitScript(() => {
    interface SpeechWindow extends Window {
      __spoken?: string[];
    }
    const w = window as SpeechWindow;
    w.__spoken = [];
    const record = (text: string): void => {
      w.__spoken?.push(text);
    };
    // Stub the API wherever the browser offers it (Chromium headless has it).
    const stub = {
      speak: (utterance: { text?: string }) => record(utterance?.text ?? ''),
      cancel: () => {},
      pause: () => {},
      resume: () => {},
      getVoices: () => [],
      speaking: false,
      pending: false,
      paused: false,
    };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, writable: true, value: stub });
    class StubUtterance {
      text: string;
      lang = '';
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text = '') {
        this.text = text;
      }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      writable: true,
      value: StubUtterance,
    });
  });

  await signInAs(page, 'farmer');
  await page.goto('/farmer?tab=ask');

  await page.getByLabel(en.ask.volume).fill('200');
  await page.getByLabel(en.ask.reason).fill('My maize is wilting in the heat.');
  await page.getByRole('button', { name: en.ask.submit, exact: true }).click();

  // The call panel arrives with the agent's reply on screen...
  const call = page.locator('.agent-call');
  await expect(call).toBeVisible();
  await expect(call.locator('.jadal-phone__transcript')).toContainText(/[ఀ-౿]/);
  // ...and the play control is offered, not already used.
  await expect(call.getByRole('button', { name: en.phone.agentCallPlay, exact: true })).toBeVisible();

  // Open the phone screen the panel links to: nothing there should speak either.
  await call.getByRole('link', { name: en.phone.agentCallOpen, exact: true }).click();
  await expect(page.getByTestId('simulated-phone')).toBeVisible();
  await settle(page);

  expect(await page.evaluate(() => (window as unknown as { __spoken?: string[] }).__spoken ?? [])).toEqual([]);

  // Asking for speech does speak, so the guard is about consent, not a broken control.
  await signInAs(page, 'farmer');
  await page.goto('/farmer?tab=ask');
  await page.getByLabel(en.ask.volume).fill('200');
  await page.getByLabel(en.ask.reason).fill('My maize is still wilting.');
  await page.getByRole('button', { name: en.ask.submit, exact: true }).click();
  const again = page.locator('.agent-call');
  await expect(again).toBeVisible();
  // Nothing has spoken up to the moment of the click.
  expect(await page.evaluate(() => (window as unknown as { __spoken?: string[] }).__spoken ?? [])).toEqual([]);
  await again.getByRole('button', { name: en.phone.agentCallPlay, exact: true }).click();
  await expect
    .poll(async () => (await page.evaluate(() => (window as unknown as { __spoken?: string[] }).__spoken ?? [])).length)
    .toBeGreaterThan(0);

  expect(consoleErrors).toEqual([]);
});
