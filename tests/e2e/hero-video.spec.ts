import { expect, settle, test } from './support/app';

/** The launch film in the home hero, and its reduced-motion fallback. */

test('the home hero carries the launch video with a poster and inline playback', async ({ page, consoleErrors }) => {
  await page.goto('/');

  const video = page.locator('.hero video');
  await expect(video).toHaveCount(1);
  await expect(video).toHaveAttribute('src', /jadal-launch\.mp4$/);
  await expect(video).toHaveAttribute('poster', /jadal-launch-poster\.jpg$/);
  await expect(video).toHaveAttribute('preload', 'metadata');

  const flags = await video.evaluate((element: HTMLVideoElement) => ({
    muted: element.muted,
    loop: element.loop,
    playsInline: element.playsInline,
  }));
  expect(flags).toEqual({ muted: true, loop: true, playsInline: true });

  await settle(page);
  expect(consoleErrors).toEqual([]);
});

test('reduced motion shows the poster with a play control instead of autoplaying', async ({ page, consoleErrors }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  const video = page.locator('.hero video');
  await expect(video).toHaveCount(1);
  expect(await video.evaluate((element: HTMLVideoElement) => element.autoplay)).toBe(false);
  await expect(page.locator('.hero-video-play')).toBeVisible();

  await settle(page);
  expect(consoleErrors).toEqual([]);
});
