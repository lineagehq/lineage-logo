import { expect, test, type Locator, type Page } from '@playwright/test';

const layer = (page: Page, name: string) => page.locator('.layer-button').filter({ has: page.locator('.layer-name', { hasText: new RegExp(`^${name}$`) }) });
const bytes = async (page: Page, path: string) => {
  const response = await page.request.get(`/api/svg?path=${encodeURIComponent(path)}`);
  expect(response.ok()).toBe(true);
  return response.text();
};
async function panel(page: Page, side: 'left' | 'right', open: boolean) {
  const toggle = page.locator(`#toggle-${side}-sidebar`);
  if ((await toggle.getAttribute('aria-expanded') === 'true') !== open) await toggle.click();
  if (page.viewportSize()!.width > 800) {
    const width = await page.locator('#canvas-shell').evaluate((node, side) => parseFloat((node as HTMLElement).style.getPropertyValue(`--${side}-preferred-width`)), side);
    await expect.poll(async () => Math.round((await page.locator(side === 'left' ? '.file-sidebar' : '.review-sidebar').boundingBox())!.width)).toBe(open ? width : 40);
  }
}
async function assertReferences(page: Page, svg: string) {
  const proof = await page.evaluate(svg => {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const ids = [...doc.querySelectorAll('[id]')].map(node => node.id);
    const refs = [...svg.matchAll(/url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g)].map(match => match[1]);
    for (const node of doc.querySelectorAll('*')) for (const attribute of node.attributes) {
      if (attribute.localName === 'href' && attribute.value.startsWith('#')) refs.push(attribute.value.slice(1));
    }
    return { parsed: doc.querySelector('parsererror') === null, unique: new Set(ids).size === ids.length, refs: refs.length, resolved: refs.every(id => ids.includes(id)) };
  }, svg);
  expect(proof).toMatchObject({ parsed: true, unique: true, resolved: true });
  expect(proof.refs).toBeGreaterThan(0);
  expect(svg).not.toMatch(/data-(?:lineage|agent|review|transport)-|svg_select|lineage-selection-halo/);
}
async function saveReopen(page: Page, sourcePath: string, original: string) {
  await page.locator('#save-iteration').click();
  await expect(page.locator('#lifecycle-state')).toHaveAttribute('data-state', 'saved');
  const savedPath = (await page.locator('.file-button[aria-current="true"]').getAttribute('data-path'))!;
  expect(savedPath).toMatch(/^iterations\//);
  const saved = await bytes(page, savedPath);
  await assertReferences(page, saved);
  await page.reload();
  await expect(page.locator('.file-button[aria-current="true"]')).toHaveAttribute('data-path', savedPath);
  await expect(page.locator('#manual-draft-dialog')).not.toBeVisible();
  expect(await bytes(page, sourcePath)).toBe(original);
  expect(await bytes(page, savedPath)).toBe(saved);
  return saved;
}

test('G2 combines cross-parent bulk actions, locks, precise correction and draft restoration', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  const sourcePath = 'concepts/complex-seatify.svg';
  await page.locator(`[data-path="${sourcePath}"]`).click();
  const original = await bytes(page, sourcePath);
  const names = ['West north seat', 'Ticket accent star'];
  const node = (name: string) => page.locator(`#artboard [aria-label=${JSON.stringify(name)}]`);
  await layer(page, 'Venue logo').click();
  await panel(page, 'left', false); await panel(page, 'right', false);
  await page.locator('#zoom-fit').click();
  for (const [index, name] of names.entries()) {
    const box = (await node(name).boundingBox())!;
    const pad = Math.min(box.width, box.height) * .08;
    await page.mouse.move(box.x - pad, box.y - pad);
    await page.keyboard.down('ControlLeft');
    if (index) await page.keyboard.down('ShiftLeft');
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + pad, box.y + box.height + pad, { steps: 8 });
    await page.mouse.up();
    if (index) await page.keyboard.up('ShiftLeft');
    await page.keyboard.up('ControlLeft');
  }
  await panel(page, 'right', true);
  await expect(page.locator('.layer-button[aria-pressed="true"]')).toHaveCount(2);
  const initial = await Promise.all(names.map(name => node(name).getAttribute('fill')));
  await page.locator('#fill').fill('#d14468'); await page.locator('#fill').press('Enter');
  for (const name of names) await expect(node(name)).toHaveAttribute('fill', '#d14468');
  await page.locator('#undo').click(); await expect(page.locator('#undo')).toBeDisabled();
  expect(await Promise.all(names.map(name => node(name).getAttribute('fill')))).toEqual(initial);
  await page.locator('#redo').click();
  await page.locator('#duplicate-selection').click();
  for (const name of names) await expect(node(`${name} copy`)).toHaveCount(1);
  await page.locator('#hide-selection').click();
  for (const name of names) await expect(node(`${name} copy`)).toHaveAttribute('display', 'none');
  await page.locator('#undo').click();
  for (const name of names) await expect(node(`${name} copy`)).not.toHaveAttribute('display', 'none');
  await page.locator('#delete-selection').click();
  for (const name of names) await expect(node(`${name} copy`)).toHaveCount(0);
  await page.locator('#undo').click();
  for (const name of names) await expect(node(`${name} copy`)).toHaveCount(1);
  await page.locator('#undo').click(); // Undo duplication as one action; keep only intended paint.
  for (const name of names) await expect(node(`${name} copy`)).toHaveCount(0);

  await layer(page, 'West north seat').click(); await page.locator('#lock-selection').click();
  await layer(page, 'West table cluster').click();
  await layer(page, 'East table cluster').click({ modifiers: ['Shift'] });
  const groups = ['West table cluster', 'East table cluster'];
  const lockedBefore = await Promise.all(groups.map(name => node(name).evaluate(element => element.outerHTML)));
  for (const id of ['fill', 'duplicate-selection', 'hide-selection', 'delete-selection']) await expect(page.locator(`#${id}`)).toBeDisabled();
  await page.keyboard.press('Delete');
  expect(await Promise.all(groups.map(name => node(name).evaluate(element => element.outerHTML)))).toEqual(lockedBefore);
  for (const name of ['West table cluster', 'East table cluster']) await expect(node(name)).toHaveCount(1);
  for (const name of names) await expect(node(name)).toHaveAttribute('fill', '#d14468');
  await layer(page, 'West north seat').click(); await page.locator('#lock-selection').click();
  if (await page.locator('#geometry-group').getAttribute('open') === null) await page.locator('#geometry-group > summary').click();
  const oldX = Number(await page.locator('#position-x').inputValue());
  await page.locator('#position-x').fill(String(oldX + 7.25)); await page.locator('#position-x').press('Enter');
  await expect(page.locator('#position-x')).toHaveValue(String(oldX + 7.25));
  const transform = await node('West north seat').getAttribute('transform');
  const zoom = await page.locator('#zoom-label').textContent();
  await page.reload();
  await expect(page.locator('#manual-draft-dialog')).toBeVisible();
  await page.locator('#manual-draft-restore').click();
  await expect(page.locator('#undo')).toBeDisabled();
  await expect(layer(page, 'West north seat')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#zoom-label')).toHaveText(zoom!);
  for (const name of names) await expect(node(name)).toHaveAttribute('fill', '#d14468');
  expect(await node('West north seat').getAttribute('transform')).toBe(transform);
  const saved = await saveReopen(page, sourcePath, original);
  expect(saved).toContain('#d14468');
  expect(await node('West north seat').getAttribute('transform')).toBe(transform);
});

// Every interaction in this narrow task is a real keyboard event. Locator reads
// only identify whether Tab has reached the intended semantic control.
async function tabTo(page: Page, target: Locator) {
  for (let count = 0; count < 250; count++) {
    if (await target.evaluate(node => node === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('G2 keyboard task could not reach its control within 250 Tab presses');
}
async function enter(page: Page, target: Locator) { await tabTo(page, target); await page.keyboard.press('Enter'); }
async function type(page: Page, target: Locator, value: string) {
  await tabTo(page, target); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type(value); await page.keyboard.press('Enter');
}

test('G2 narrow 44-layer keyboard task preserves correction through recovery and save', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 760, height: 720 });
  await page.goto('/');
  if (await page.locator('#toggle-left-sidebar').getAttribute('aria-expanded') !== 'true') await enter(page, page.locator('#toggle-left-sidebar'));
  const sourcePath = 'concepts/seatify-constellation.svg';
  await enter(page, page.locator(`[data-path="${sourcePath}"]`));
  const original = await bytes(page, sourcePath);
  await expect(page.locator('.layer-button')).toHaveCount(44);
  await enter(page, page.locator('#toggle-left-sidebar'));
  if (await page.locator('#toggle-right-sidebar').getAttribute('aria-expanded') !== 'true') await enter(page, page.locator('#toggle-right-sidebar'));
  const search = page.getByRole('searchbox', { name: 'Search layers' });
  await type(page, search, 'North seat back');
  await enter(page, layer(page, 'North seat back'));
  await enter(page, page.getByRole('button', { name: 'Clear layer search', exact: true }));
  await expect(layer(page, 'North seat back')).toHaveAttribute('aria-pressed', 'true');
  await type(page, page.locator('#fill'), '#d14468');
  await expect(page.locator('#artboard #seat-north-back')).toHaveAttribute('fill', '#d14468');
  await enter(page, page.locator('#undo'));
  await expect(page.locator('#artboard #seat-north-back')).toHaveAttribute('fill', '#111A33');
  await enter(page, page.locator('#redo'));
  await tabTo(page, page.getByRole('separator', { name: 'Resize layers and inspector panel' }));
  await page.keyboard.press('Home');
  await expect(layer(page, 'North seat back')).toHaveAttribute('aria-pressed', 'true');
  await type(page, search, 'Seatify tagline');
  await enter(page, layer(page, 'Seatify tagline'));
  if (await page.locator('#text-group').getAttribute('open') === null) await enter(page, page.locator('#text-group > summary'));
  await type(page, page.locator('#text-content'), 'ROOM FOR EVERYONE');
  await page.reload();
  await expect(page.locator('#manual-draft-dialog')).toBeVisible();
  await enter(page, page.locator('#manual-draft-restore'));
  await expect(page.locator('#undo')).toBeDisabled();
  await expect(page.locator('#artboard #constellation-tagline')).toHaveText('ROOM FOR EVERYONE');
  await expect(page.locator('#artboard #seat-north-back')).toHaveAttribute('fill', '#d14468');
  await enter(page, page.locator('#save-iteration'));
  await expect(page.locator('#lifecycle-state')).toHaveAttribute('data-state', 'saved');
  const savedPath = (await page.locator('.file-button[aria-current="true"]').getAttribute('data-path'))!;
  const saved = await bytes(page, savedPath);
  await assertReferences(page, saved);
  await page.reload();
  await expect(page.locator('.file-button[aria-current="true"]')).toHaveAttribute('data-path', savedPath);
  await expect(page.locator('#manual-draft-dialog')).not.toBeVisible();
  await expect(page.locator('#artboard #constellation-tagline')).toHaveText('ROOM FOR EVERYONE');
  expect(await bytes(page, sourcePath)).toBe(original);
  expect(await bytes(page, savedPath)).toBe(saved);
});
