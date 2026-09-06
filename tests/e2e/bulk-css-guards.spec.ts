import { expect, test } from '@playwright/test';

test('duplication refuses copied stylesheet resources without changing original paint or history', async ({page}) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g id="logo"><defs><linearGradient id="paint"><stop stop-color="red"/></linearGradient></defs><style>.mark{fill:url(#paint)}</style><rect id="box" class="mark" x="10" y="10" width="30" height="30"/></g></svg>';
  await page.route('**/api/svg?*', route => route.fulfill({status:200,contentType:'image/svg+xml',body:svg}));
  await page.goto('/'); await page.locator('[data-path="concepts/ux-wide.svg"]').click();
  await page.locator('.layer-button').filter({has:page.locator('.layer-type + span',{hasText:/^logo$/})}).click();
  const before = await page.locator('#artboard #box').evaluate(node => getComputedStyle(node).fill);
  await page.locator('#duplicate-selection').click();
  const after = await page.locator('#artboard #box').evaluate(node => getComputedStyle(node).fill);
  expect(after).toBe(before);
  await expect(page.locator('#status')).toContainText('copied stylesheet');
  await expect(page.locator('#artboard #logo-copy-1')).toHaveCount(0);
  await expect(page.locator('#undo')).toBeDisabled();
});
test('duplication refuses CSS transforms without changing artwork or history', async ({page}) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect id="box" x="10" y="10" width="30" height="30" style="transform:translate(10px,0px)"/></svg>';
  await page.route('**/api/svg?*', route => route.fulfill({status:200,contentType:'image/svg+xml',body:svg}));
  await page.goto('/'); await page.locator('[data-path="concepts/ux-wide.svg"]').click();
  await page.locator('.layer-button').filter({has:page.locator('.layer-type + span',{hasText:/^box$/})}).click();
  const before = await page.locator('#artboard #box').boundingBox();
  await page.locator('#duplicate-selection').click();
  const after = await page.locator('#artboard #box').boundingBox();
  expect(after).toEqual(before);
  await expect(page.locator('#status')).toContainText('CSS controls');
  await expect(page.locator('#artboard #box-copy-1')).toHaveCount(0);
  await expect(page.locator('#undo')).toBeDisabled();
});
