import { expect, test } from '@playwright/test';

test('snapshot refuses provisional geometry and captures only completed or canceled gesture state', async ({ page }) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect id="mark" aria-label="Mark" x="30" y="20" width="60" height="40" fill="red"/><rect id="other" aria-label="Other" x="100" y="20" width="20" height="30" fill="blue"/></svg>';
  await page.route('**/api/svg?*', route => route.fulfill({ contentType: 'image/svg+xml', body: svg }));
  await page.goto('/');
  await page.locator('[data-path="concepts/ux-wide.svg"]').click();
  const named = (name: string) => page.locator('.layer-button').filter({ has: page.locator('.layer-type + span', { hasText: new RegExp(`^${name}$`) }) });
  await named('Mark').click();
  await named('Other').click({ modifiers: ['Shift'] });
  const capture = () => page.request.post('/api/agent/snapshots', { headers: { Authorization: 'Bearer lineage-logo-e2e-agent-token' }, data: { schemaVersion: 1 } });
  let initial: { svg: string; baseRevision: number };
  await expect.poll(async () => { const r = await capture(); if (r.ok()) initial = await r.json(); return r.status(); }).toBe(200);
  for (const finish of ['cancel', 'commit']) {
    const handle = page.locator('[data-lineage-collective-handle="rb"]');
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 40, y + 20, { steps: 5 });
    await expect(page.locator('#artboard #mark')).toHaveAttribute('transform', /matrix/);
    const refused = await capture();
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toEqual({ error: 'snapshot_busy' });
    if (finish === 'cancel') await page.keyboard.press('Escape');
    await page.mouse.up();
    let completed: { svg: string; baseRevision: number };
    await expect.poll(async () => { const r = await capture(); if (r.ok()) completed = await r.json(); return r.status(); }).toBe(200);
    if (finish === 'cancel') {
      expect(await page.evaluate(([left, right]) => new DOMParser().parseFromString(left, "image/svg+xml").documentElement.isEqualNode(new DOMParser().parseFromString(right, "image/svg+xml").documentElement), [completed!.svg, initial!.svg])).toBe(true);
      await expect(page.locator('#undo')).toBeDisabled();
    } else {
      expect(completed!.svg).toContain('transform="matrix(');
      expect(completed!.svg).not.toBe(initial!.svg);
      expect(completed!.baseRevision).toBeGreaterThan(initial!.baseRevision);
      await expect(page.locator('#undo')).toBeEnabled();
    }
  }
});
