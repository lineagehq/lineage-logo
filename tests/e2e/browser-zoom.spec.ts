import { chromium, expect, test } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('essential editing controls remain reachable at actual 200 percent browser zoom', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'lineage-browser-zoom-'));
  const extension = path.join(temporary, 'zoom-extension');
  await mkdir(extension);
  // Isolated, test-only extension uses Chromium's actual tab zoom rather than
  // SVG zoom, CSS zoom, device emulation, or pinch magnification.
  await writeFile(path.join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Local zoom acceptance fixture', version: '1.0', permissions: ['tabs'], background: { service_worker: 'zoom.js' } }));
  await writeFile(path.join(extension, 'zoom.js'), "chrome.tabs.onUpdated.addListener((id, change, tab) => { if (change.status === 'complete' && tab.url?.startsWith('http://marquee-qa.localhost:43118')) chrome.tabs.setZoom(id, 2); });");
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), { channel: 'chromium', headless: true, viewport: null, deviceScaleFactor: undefined, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--window-size=1280,800'] });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker", { timeout: 10000 });
    await worker.evaluate(() => true);
    const page = await context.newPage();
    const normal = await page.evaluate(() => ({ width: innerWidth, ratio: devicePixelRatio }));
    await page.goto('http://marquee-qa.localhost:43118');
    await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(normal.ratio * 2);
    expect(await page.evaluate(() => innerWidth)).toBeCloseTo(normal.width / 2, 0);
    await page.getByRole('button', { name: 'Expand workspace panel', exact: true }).click();
    await page.locator('[data-path="concepts/seatify-constellation.svg"]').click();
    await page.getByRole('button', { name: 'Collapse workspace panel', exact: true }).click();
    await page.getByRole('button', { name: 'Expand layers and inspector panel', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Search layers' }).fill('tagline');
    await page.locator('.layer-button').filter({ has: page.locator('.layer-name', { hasText: /^Seatify tagline$/ }) }).click();
    await page.locator('#text-group > summary').click();
    await page.locator('#text-content').fill('EVERY SEAT MATTERS');
    await page.locator('#text-content').press('Enter');
    await expect(page.locator('#artboard #constellation-tagline')).toHaveText('EVERY SEAT MATTERS');
    await page.getByRole('separator', { name: 'Resize layers and inspector panel' }).focus();
    await page.keyboard.press('Home');
    await expect(page.getByRole('separator', { name: 'Resize layers and inspector panel' })).toHaveAttribute('aria-valuenow', '200');
    await page.getByRole('button', { name: 'Collapse layers and inspector panel', exact: true }).click();
    await page.locator('#save-iteration').click();
    await expect(page.locator('#lifecycle-state')).toHaveAttribute('data-state', 'saved');
    await page.getByRole('button', { name: 'Preferences and shortcuts', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Preferences and shortcuts', exact: true })).toBeFocused();
  } finally { await context?.close(); await rm(temporary, { recursive: true, force: true }); }
});
