import { expect, test } from '@playwright/test';
import { capturePublicSurface } from './public-fixture-diagnostics';

test('public fixture exposes the complete editing surface', async ({page}) => {
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('/');
  await page.locator('[data-path="concepts/ux-wide.svg"]').click();
  await expect(page.locator('#artboard svg')).toHaveAttribute('viewBox','0 0 600 100');
  await expect(page.locator('#layer-list')).toBeVisible();
  await expect(page.locator('#favicon-preview img')).toHaveCount(3);
  await page.locator('.layer-button').filter({hasText:'mark'}).click();
  await expect(page.locator('#fill')).toBeVisible();
  await expect(page.locator('#fill')).toHaveValue('#122238');
  await expect(page.locator('#save-iteration')).toBeVisible();
  await page.locator('#favicon-preview img').evaluateAll(async images => {
    await Promise.all(images.map(image => (image as HTMLImageElement).decode()));
  });
  // Full-surface geometry is an observable layout oracle without platform-specific fonts.
  for (const selector of ['#artboard', '#layer-list', '#fill', '#save-iteration', '#favicon-preview']) {
    const bounds = await page.locator(selector).boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeGreaterThan(0);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1440);
  }
  await capturePublicSurface(page);
  if (process.env.LINEAGE_LOGO_QA_FORCE_FAILURE === '1') throw new Error('QA_TOKEN_CANARY /private/QA_PATH_CANARY <svg>QA_CONTENT_CANARY</svg>');
});
