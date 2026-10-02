import { chromium } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:5311';

async function main() {
  const browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.text().includes('[i18n]')) {
      console.log(`[PAGE CONSOLE ${msg.type()}]`, msg.text());
    }
  });

  page.on('pageerror', (err) => {
    console.error('[PAGE ERROR]', err);
  });

  console.log('Testing /');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  console.log('Testing /login');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  console.log('Testing /canal');
  await page.goto(`${BASE_URL}/canal`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  console.log('Testing /phone');
  await page.goto(`${BASE_URL}/phone`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  console.log('Testing /demo');
  await page.goto(`${BASE_URL}/demo`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  console.log('Testing login as farmer');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('#login-password', 'farmer123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/farmer', { timeout: 5000 });
  await page.waitForTimeout(1500);
  console.log('Farmer URL reached:', page.url());

  console.log('Testing login as coordinator');
  // clear session
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  // click coordinator role segment
  const coordBtn = page.locator('button.segment', { hasText: /Coordinator/i });
  await coordBtn.click();
  await page.fill('#login-password', 'coordinator123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/coordinator', { timeout: 5000 });
  await page.waitForTimeout(1500);
  console.log('Coordinator URL reached:', page.url());

  await browser.close();
  console.log('All test routes verified!');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
