import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Capture console messages and page errors for debugging
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[browser console error] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    console.log(`[page error] ${err.message}`);
  });

  await page.goto('/');
  await page.waitForFunction(() => (window as any).ffwebReady === true);
});

test('page is cross-origin isolated (threads available)', async ({ page }) => {
  expect(await page.evaluate(() => (window as any).ffwebTest.isolated())).toBe(true);
});

test('transcodes VP8/webm in-browser', async ({ page }) => {
  const r = await page.evaluate(() => (window as any).ffwebTest.transcode());
  expect(r.ret).toBe(0);
  expect(r.size).toBeGreaterThan(1000);
});

test('WORKERFS mount → mp3 encode', async ({ page }) => {
  const r = await page.evaluate(() => (window as any).ffwebTest.mountFile());
  expect(r.ret).toBe(0);
  expect(r.size).toBeGreaterThan(500);
});

test('progress events stream', async ({ page }) => {
  const r = await page.evaluate(() => (window as any).ffwebTest.progress());
  expect(r.ret).toBe(0);
  expect(r.count).toBeGreaterThanOrEqual(1);
  expect(r.lastDone).toBe(true);
});
