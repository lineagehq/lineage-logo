import { expect, test, type Page } from '@playwright/test';

const named = (page: Page, name: string) => page.locator('.layer-button').filter({ has: page.locator('.layer-name', { hasText: new RegExp(`^${name}$`) }) });
async function reveal(page: Page, side: 'left' | 'right', expanded: boolean) {
  const toggle = page.locator(`#toggle-${side}-sidebar`);
  if ((await toggle.getAttribute('aria-expanded') === 'true') !== expanded) await toggle.click();
  if ((page.viewportSize()?.width ?? 0) > 800) {
    const preferred = await page.locator('#canvas-shell').evaluate((shell, side) => parseFloat((shell as HTMLElement).style.getPropertyValue(`--${side}-preferred-width`)), side);
    await expect.poll(async () => Math.round((await page.locator(side === 'left' ? '.file-sidebar' : '.review-sidebar').boundingBox())!.width)).toBe(expanded ? preferred : 40);
  }
}

for (const width of [1280, 760]) {
  test(`44-layer correction journey finds, recolors, aligns, edits text and saves at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    await page.goto('/');
    await reveal(page, 'left', true);
    await page.locator('[data-path="concepts/seatify-constellation.svg"]').click();
    await reveal(page, 'left', false);
    await reveal(page, 'right', true);
    const sourceUrl = '/api/svg?path=concepts%2Fseatify-constellation.svg';
    const source = await (await page.request.get(sourceUrl)).text();
    await expect(page.locator('.layer-button')).toHaveCount(44);
    await page.getByRole('searchbox', { name: 'Search layers' }).fill('North seat');
    await named(page, 'North seat').focus();
    await page.keyboard.press('Enter');
    await expect(named(page, 'North seat')).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Clear layer search', exact: true }).click();
    await expect(named(page, 'North seat')).toHaveAttribute('aria-pressed', 'true');

    // Seats own their child paint. Select actual seat bases, not their parent
    // groups, to prove that the requested color is visible on the artwork.
    await named(page, 'Seatify constellation combination mark').click();
    await reveal(page, 'right', false);
    await page.locator('#zoom-fit').click();
    for (const [index, id] of ['seat-north-base', 'seat-northeast-base', 'seat-southeast-base'].entries()) {
      const box = (await page.locator(`#artboard #${id}`).boundingBox())!;
      const pad = 2;
      await page.mouse.move(box.x - pad, box.y - pad);
      await page.keyboard.down('ControlLeft');
      if (index) await page.keyboard.down('ShiftLeft');
      await page.mouse.down();
      await page.mouse.move(box.x + box.width + pad, box.y + box.height + pad, { steps: 6 });
      await page.mouse.up();
      if (index) await page.keyboard.up('ShiftLeft');
      await page.keyboard.up('ControlLeft');
    }
    await reveal(page, 'right', true);
    await expect(page.locator('.layer-button[aria-pressed="true"]')).toHaveCount(3);
    await page.locator('#fill').fill('#d14468');
    await page.locator('#fill').press('Enter');
    for (const id of ['seat-north-base', 'seat-northeast-base', 'seat-southeast-base']) {
      await expect(page.locator(`#artboard #${id}`)).toHaveAttribute('fill', '#d14468');
      expect(await page.locator(`#artboard #${id}`).evaluate(node => getComputedStyle(node).fill)).toBe('rgb(209, 68, 104)');
    }
    await named(page, 'North seat').click();
    await named(page, 'Northeast seat').click({ modifiers: ['Shift'] });
    await named(page, 'Southeast seat').click({ modifiers: ['Shift'] });
    await expect(page.locator('.layer-button[aria-pressed="true"]')).toHaveCount(3);
    await page.locator('#alignment-group > summary').click();
    await page.locator('#align-left').click();
    const lefts = await page.locator('#artboard #seat-north, #artboard #seat-northeast, #artboard #seat-southeast').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().left));
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThan(0.5);
    const zoom = await page.locator('#zoom-label').textContent();
    await page.getByRole('separator', { name: 'Resize layers and inspector panel' }).focus();
    await page.keyboard.press('Home');
    await expect(page.locator('.layer-button[aria-pressed="true"]')).toHaveCount(3);
    await expect(page.locator('#zoom-label')).toHaveText(zoom!);
    await named(page, 'Seatify tagline').click();
    await page.locator('#text-group > summary').click();
    await page.locator('#text-content').fill('ROOM FOR EVERYONE');
    await page.locator('#text-content').press('Enter');
    await expect(page.locator('#artboard #constellation-tagline')).toHaveText('ROOM FOR EVERYONE');
    const small = page.locator('#favicon-preview img[width="16"]');
    await expect(small).toHaveCount(1);
    await expect.poll(() => small.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await page.locator('#save-iteration').click();
    await expect(page.locator('#status')).toContainText('Saved');
    const savedPath = await page.locator('.file-button[aria-current="true"]').getAttribute('data-path');
    expect(savedPath).toMatch(/^iterations\//);
    const saved = await (await page.request.get(`/api/svg?path=${encodeURIComponent(savedPath!)}`)).text();
    expect(saved).toContain('ROOM FOR EVERYONE');
    expect(saved).toContain('#d14468');
    expect(await (await page.request.get(sourceUrl)).text()).toBe(source);
    await expect(named(page, 'Seatify tagline')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#text-content').fill('ONE MORE SEAT');
    await page.locator('#text-content').press('Enter');
    await expect(page.locator('#artboard #constellation-tagline')).toHaveText('ONE MORE SEAT');
    expect(await (await page.request.get(`/api/svg?path=${encodeURIComponent(savedPath!)}`)).text()).toBe(saved);
  });
}
