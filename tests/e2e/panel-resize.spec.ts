import { expect, test } from '@playwright/test';

for (const width of [1280, 1024, 760]) {
  test(`panel resizing is bounded, keyboard accessible and leaves artwork unchanged at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    await page.goto('/');
    const leftToggle = page.locator('#toggle-left-sidebar');
    if (await leftToggle.getAttribute('aria-expanded') === 'false') await leftToggle.click();
    await page.locator('[data-path="concepts/ux-wide.svg"]').click();
    const rightToggle = page.locator('#toggle-right-sidebar');
    if (await rightToggle.getAttribute('aria-expanded') === 'false') await rightToggle.click();
    const layer = page.locator('.layer-button').first();
    await layer.click();
    await expect(layer).toHaveAttribute('aria-pressed', 'true');
    const selected = await layer.getAttribute('data-key');
    const svg = await page.locator('#artboard > svg').getAttribute('viewBox');
    const handle = page.getByRole('separator', { name: 'Resize layers and inspector panel' });
    await handle.focus();
    await page.keyboard.press('Home');
    await expect(handle).toHaveAttribute('aria-valuenow', '200');
    await page.keyboard.press('ArrowLeft');
    await expect(handle).toHaveAttribute('aria-valuenow', '210');
    await page.keyboard.press('End');
    const maximum = Number(await handle.getAttribute('aria-valuemax'));
    await expect(handle).toHaveAttribute('aria-valuenow', String(maximum));
    await page.keyboard.press('ArrowLeft');
    await expect(handle).toHaveAttribute('aria-valuenow', String(maximum));
    await expect.poll(async () => {
      const box = await page.locator('.review-sidebar .sidebar-content').boundingBox();
      return box ? box.x >= 0 && box.x + box.width <= width : false;
    }).toBe(true);
    await expect(page.locator(`.layer-button[data-key="${selected}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#artboard > svg')).toHaveAttribute('viewBox', svg!);
    await expect(page.locator('#undo')).toBeDisabled();
    await rightToggle.click();
    await expect(handle).toBeHidden();
    await rightToggle.click();
    await expect(handle).toHaveAttribute('aria-valuenow', String(maximum));
    await expect(page.locator(`.layer-button[data-key="${selected}"]`)).toHaveAttribute('aria-pressed', 'true');
  });
}

test('pointer resize Escape restores width and preserves selection; completed width persists', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.locator('[data-path="concepts/ux-wide.svg"]').click();
  const layer = page.locator('.layer-button').first();
  await layer.click();
  const key = await layer.getAttribute('data-key');
  const handle = page.getByRole('separator', { name: 'Resize layers and inspector panel' });
  const initial = await handle.getAttribute('aria-valuenow');
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x - 57, box.y + 80);
  await expect(handle).toHaveAttribute('aria-valuenow', String(Number(initial) + 60));
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(handle).toHaveAttribute('aria-valuenow', initial!);
  await expect(page.locator(`.layer-button[data-key="${key}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#undo')).toBeDisabled();
  await handle.focus();
  await page.keyboard.press('Home');
  await page.reload();
  await expect(handle).toHaveAttribute('aria-valuenow', '200');
});

test('canvas mode and snap controls reflect preferences and appearance stays out of geometry', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-path="concepts/ux-wide.svg"]').click();
  await page.locator('.layer-button').first().click();
  const mode = page.locator('#canvas-selection-mode');
  const snap = page.locator('#canvas-snapping');
  const previousMode = await mode.textContent();
  const previousSnap = await snap.getAttribute('aria-pressed');
  await mode.click();
  await expect(mode).not.toHaveText(previousMode!);
  await snap.click();
  await expect(snap).toHaveAttribute('aria-pressed', String(previousSnap !== 'true'));
  await page.getByRole('button', { name: 'Preferences and shortcuts', exact: true }).click();
  await expect(page.locator('#preference-click-depth')).toHaveValue(previousMode?.includes('groups') ? 'exact' : 'logical');
  if (previousSnap === 'true') await expect(page.locator('#preference-alignment-snapping')).not.toBeChecked();
  else await expect(page.locator('#preference-alignment-snapping')).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Preferences and shortcuts', exact: true })).toBeFocused();
  await expect(page.locator('#paint-group #stroke-width')).toBeVisible();
  await expect(page.locator('#paint-group #opacity')).toBeVisible();
  await page.locator('#geometry-group > summary').click();
  for (const name of ['X', 'Y', 'Width', 'Height', 'Rotation °']) await expect(page.getByLabel(name, { exact: true })).toBeVisible();
  await expect(page.locator('.geometry-help')).toContainText('document units');
  await expect(page.locator('#undo')).toBeDisabled();
});

test('long layer names remain available on keyboard focus without changing selection', async ({ page }) => {
  const name = 'North seat with a deliberately long descriptive layer name for finding the correct object';
  await page.route('**/api/svg?*', route => route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect id="seat" aria-label="${name}" width="30" height="30"/></svg>` }));
  await page.goto('/');
  await page.locator('[data-path="concepts/ux-wide.svg"]').click();
  const layer = page.locator('.layer-button').first();
  await expect(layer).toHaveAttribute('title', name);
  await layer.focus();
  await expect(layer).toContainText(name);
  const label = page.locator('.layer-name-tooltip').first();
  await expect(label).toBeVisible();
  await expect(label).toHaveText(name);
  expect(await label.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.keyboard.press('Enter');
  await expect(layer).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#undo')).toBeDisabled();
});
