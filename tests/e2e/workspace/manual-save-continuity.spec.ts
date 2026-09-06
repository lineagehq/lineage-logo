import { expect, test } from "@playwright/test";

test("manual Save advances the baseline while preserving selection and undo across saves", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-path="concepts/seatify-constellation.svg"]').click();
  const original = await (await page.request.get('/api/svg?path=concepts/seatify-constellation.svg')).text();
  await page.locator('.layer-button').filter({ hasText: /^textSeatify tagline$/ }).click();
  await page.locator('#lock-selection').click();
  const title = page.locator('.layer-button').filter({ hasText: /^textSeatify title$/ });
  await title.click();
  await page.locator('#layer-name').fill('First correction');
  await page.locator('#layer-name').press('Enter');
  await page.locator('#zoom-reset').click();
  await page.locator('#zoom-in').click();
  const save = page.locator('#save-iteration');
  const path = (await save.getAttribute('title'))!.replace('Create ', '');
  await save.click();
  await expect(page.locator('#status')).toHaveText(`Saved ${path}`);
  await expect(page.locator('#selection-name')).toHaveText('First correction');
  await expect(page.locator('.layer-button.locked').filter({ hasText: 'Seatify tagline' })).toHaveCount(1);
  await expect(page.locator('#layer-name')).toHaveValue('First correction');
  await expect(page.locator('#zoom-label')).toHaveText('125%');
  await expect(page.locator('#undo')).toBeEnabled();
  await expect(save).toBeDisabled();
  const saved = await (await page.request.get(`/api/svg?path=${encodeURIComponent(path)}`)).text();
  await page.locator('#layer-name').fill('Second correction');
  await page.locator('#layer-name').press('Enter');
  await page.locator('#undo').click();
  await expect(page.locator('#layer-name')).toHaveValue('First correction');
  await expect(save).toBeDisabled();
  await page.locator('#undo').click();
  await expect(page.locator('#layer-name')).toHaveValue('Seatify title');
  await expect(save).toBeEnabled();
  await page.locator('#redo').click();
  await expect(save).toBeDisabled();
  await page.locator('#redo').click();
  await expect(page.locator('#layer-name')).toHaveValue('Second correction');
  await expect(save).toBeEnabled();
  await page.locator('#reset-edits').click();
  await expect(page.locator('#artboard [aria-label="First correction"]')).toHaveCount(1);
  await expect(page.locator('#undo')).toBeDisabled();
  await expect(save).toBeDisabled();
  expect(await (await page.request.get(`/api/svg?path=${encodeURIComponent(path)}`)).text()).toBe(saved);
  expect(await (await page.request.get('/api/svg?path=concepts/seatify-constellation.svg')).text()).toBe(original);
  await page.reload();
  await expect(page.locator('#artboard [aria-label="First correction"]')).toHaveCount(1);
});

test("edits made while Save is in flight remain unsaved against captured bytes", async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-path="concepts/seatify-constellation.svg"]').click();
  await page.locator('.layer-button').filter({ hasText: /^textSeatify title$/ }).click();
  await page.locator('#layer-name').fill('Captured correction');
  await page.locator('#layer-name').press('Enter');
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void;
  const requested = new Promise<void>((resolve) => { started = resolve; });
  await page.route('**/api/iterations', async (route) => {
    started();
    await released;
    await route.continue();
  });
  const path = (await page.locator('#save-iteration').getAttribute('title'))!.replace('Create ', '');
  await page.locator('#save-iteration').click();
  await requested;
  await expect(page.locator('#save-iteration')).toBeDisabled();
  await page.locator('#layer-name').fill('Newer correction');
  await page.locator('#layer-name').press('Enter');
  await expect(page.locator('#save-iteration')).toBeDisabled();
  release();
  await expect(page.locator('.file-button[aria-current="true"]')).toHaveAttribute('data-path', path);
  await expect(page.locator('#status')).toContainText(/unsaved/i);
  await expect(page.locator('#lifecycle-state')).toHaveAttribute('data-state', 'dirty');
  await expect(page.locator('#layer-name')).toHaveValue('Newer correction');
  await expect(page.locator('#save-iteration')).toBeEnabled();
  const saved = await (await page.request.get(`/api/svg?path=${encodeURIComponent(path)}`)).text();
  expect(saved).toContain('aria-label="Captured correction"');
  expect(saved).not.toContain('aria-label="Newer correction"');
  await page.locator('#undo').click();
  await expect(page.locator('#save-iteration')).toBeDisabled();
});

test('failed Save preserves the source, edits and history for retry', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-path="concepts/seatify-constellation.svg"]').click();
  const original = await (await page.request.get('/api/svg?path=concepts/seatify-constellation.svg')).text();
  await page.locator('.layer-button').filter({ hasText: /^textSeatify title$/ }).click();
  await page.locator('#layer-name').fill('Retry correction');
  await page.locator('#layer-name').press('Enter');
  await page.route('**/api/iterations', (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture save conflict' }) }));
  await page.locator('#save-iteration').click();
  await expect(page.locator('#status')).toHaveText('Fixture save conflict');
  await expect(page.locator('#layer-name')).toHaveValue('Retry correction');
  await expect(page.locator('#save-iteration')).toBeEnabled();
  await expect(page.locator('#undo')).toBeEnabled();
  await expect(page.locator('.file-button[aria-current="true"]')).toHaveAttribute('data-path', 'concepts/seatify-constellation.svg');
  expect(await (await page.request.get('/api/svg?path=concepts/seatify-constellation.svg')).text()).toBe(original);
  await page.unroute('**/api/iterations');
  const path = (await page.locator('#save-iteration').getAttribute('title'))!.replace('Create ', '');
  await page.locator('#save-iteration').click();
  await expect(page.locator('#status')).toHaveText(`Saved ${path}`);
  await expect(page.locator('#save-iteration')).toBeDisabled();
  await expect(page.locator('#layer-name')).toHaveValue('Retry correction');
});

test('pending review preempts a late save response even after Revert', async ({ page, request }) => {
  await page.goto('/');
  await page.locator('[data-path="concepts/seatify-constellation.svg"]').click();
  await page.locator('.layer-button').filter({ hasText: /^textSeatify title$/ }).click();
  await page.locator('#layer-name').fill('Manual correction');
  await page.locator('#layer-name').press('Enter');
  const api = 'http://127.0.0.1:43117';
  const headers = { Authorization: 'Bearer lineage-logo-e2e-agent-token' };
  let manifest: { sessionId: string; sourcePath: string; revision: number; layers: Array<{ sessionKey: string; name: string }> };
  await expect.poll(async () => {
    const response = await request.get(`${api}/api/agent/document`, { headers });
    if (!response.ok()) return false;
    manifest = await response.json();
    return manifest.sourcePath === 'concepts/seatify-constellation.svg' && manifest.layers.some((layer) => layer.name === 'Manual correction');
  }).toBe(true);
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void;
  const requested = new Promise<void>((resolve) => { started = resolve; });
  await page.route('**/api/iterations', async (route) => { started(); await released; await route.continue(); });
  await page.locator('#save-iteration').click();
  await requested;
  const response = await request.post(`${api}/api/agent/transactions`, { headers, data: {
    protocolVersion: 1, transactionId: `save-preemption-${Date.now()}`, producer: { kind: 'agent' },
    document: { sessionId: manifest!.sessionId, sourcePath: manifest!.sourcePath, baseRevision: manifest!.revision },
    operations: [{ type: 'renameLayer', operationId: 'rename', target: { sessionKey: manifest!.layers.find((layer) => layer.name === 'Manual correction')!.sessionKey }, name: 'Proposed correction' }],
  } });
  expect(response.status()).toBe(202);
  await expect(page.locator('#agent-review-status')).toHaveText('pending');
  await page.locator('#agent-revert').click();
  await expect(page.locator('#agent-review-status')).not.toHaveText('pending');
  const saveResponse = page.waitForResponse((result) => new URL(result.url()).pathname === '/api/iterations');
  release();
  await saveResponse;
  await expect(page.locator('#save-iteration')).toBeEnabled();
  await expect(page.locator('.file-button[aria-current="true"]')).toHaveAttribute('data-path', 'concepts/seatify-constellation.svg');
  await expect(page.locator('#layer-name')).toHaveValue('Manual correction');
  await expect(page.locator('#undo')).toBeEnabled();
  await expect(page.locator('#lifecycle-state')).toHaveAttribute('data-state', 'dirty');
});

test('Save keeps drilled scope, geometry and scrolled viewport intact', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-path="concepts/seatify-constellation.svg"]').click();
  await page.locator('.layer-button').filter({ hasText: /^gOptimized seating constellation$/ }).click();
  await page.locator('#edit-inside').click();
  await page.locator('.layer-button').filter({ hasText: /^circleAlignment halo$/ }).click();
  await page.locator('#geometry-group > summary').click();
  const x = page.locator('#position-x');
  const originalX = Number(await x.inputValue());
  await x.fill(String(originalX + 17.25));
  await x.press('Enter');
  const adjustedX = await x.inputValue();
  const adjustedTransform = await page.locator('#artboard #alignment-halo').getAttribute('transform');
  await page.locator('#zoom-reset').click();
  for (let i = 0; i < 8; i++) await page.locator('#zoom-in').click();
  const stage = page.locator('#stage');
  await stage.hover();
  const scrollStart = await stage.evaluate(el => ({
    x: el.scrollLeft, y: el.scrollTop,
    maxX: el.scrollWidth - el.clientWidth, maxY: el.scrollHeight - el.clientHeight,
  }));
  const viewport = {
    x: Math.min(scrollStart.maxX, scrollStart.x + 100),
    y: Math.min(scrollStart.maxY, scrollStart.y + 100),
  };
  expect(viewport).not.toEqual({ x: scrollStart.x, y: scrollStart.y });
  await page.mouse.wheel(100, 100);
  // Wheel dispatch finishes before scrolling; an already positive offset does
  // not prove this gesture reached its destination.
  await expect.poll(async () => stage.evaluate(el => ({ x: el.scrollLeft, y: el.scrollTop }))).toEqual(viewport);
  const zoom = await page.locator('#zoom-label').textContent();
  const breadcrumb = await page.locator('#selection-breadcrumb').textContent();
  const path = (await page.locator('#save-iteration').getAttribute('title'))!.replace('Create ', '');
  await page.locator('#save-iteration').click();
  await expect(page.locator('#status')).toHaveText(`Saved ${path}`);
  await expect(page.locator('#back-to-group')).toBeEnabled();
  await expect(page.locator('#selection-breadcrumb')).toHaveText(breadcrumb!);
  await expect(page.locator('#selection-name')).toHaveText('Alignment halo');
  await expect(x).toHaveValue(adjustedX);
  await expect(page.locator('#zoom-label')).toHaveText(zoom!);
  expect(await stage.evaluate(el => ({ x: el.scrollLeft, y: el.scrollTop }))).toEqual(viewport);
  await page.locator('#undo').click();
  await expect(x).toHaveValue(String(originalX));
  await expect(page.locator('#save-iteration')).toBeEnabled();
  await page.locator('#redo').click();
  await expect(page.locator('#artboard #alignment-halo')).toHaveAttribute('transform', adjustedTransform!);
  await expect(page.locator('#save-iteration')).toBeDisabled();
});

test('ordinary pending review reconnect clears a stale disconnected banner', async ({ page, request }) => {
  // Fault only the real event-stream network boundary; keep protocol data and UI real.
  await page.addInitScript(() => {
    const networkFetch = window.fetch.bind(window);
    let streamAbort: AbortController | undefined;
    let unavailable = false;
    window.addEventListener('qa-agent-network-offline', () => { unavailable = true; streamAbort?.abort(); });
    window.addEventListener('qa-agent-network-online', () => { unavailable = false; });
    window.fetch = (input, options) => {
      if (String(input) !== '/api/agent/events') return networkFetch(input, options);
      if (unavailable) return Promise.reject(new TypeError('Fixture network unavailable'));
      streamAbort = new AbortController();
      const signal = options?.signal ? AbortSignal.any([options.signal, streamAbort.signal]) : streamAbort.signal;
      return networkFetch(input, { ...options, signal });
    };
  });
  await page.goto('/');
  await page.locator('[data-path="concepts/seatify-constellation.svg"]').click();
  const api = 'http://127.0.0.1:43117';
  const headers = { Authorization: 'Bearer lineage-logo-e2e-agent-token' };
  let manifest: { sessionId: string; sourcePath: string; revision: number; layers: Array<{ sessionKey: string; name: string }> };
  await expect.poll(async () => {
    const response = await request.get(`${api}/api/agent/document`, { headers });
    if (!response.ok()) return false;
    manifest = await response.json();
    return manifest.sourcePath === 'concepts/seatify-constellation.svg';
  }).toBe(true);
  const response = await request.post(`${api}/api/agent/transactions`, { headers, data: {
    protocolVersion: 1, transactionId: `pending-reconnect-${Date.now()}`, producer: { kind: 'agent' },
    document: { sessionId: manifest!.sessionId, sourcePath: manifest!.sourcePath, baseRevision: manifest!.revision },
    operations: [{ type: 'renameLayer', operationId: 'rename', target: { sessionKey: manifest!.layers.find((layer) => layer.name === 'Seatify title')!.sessionKey }, name: 'Pending reconnect title' }],
  } });
  expect(response.status()).toBe(202);
  await expect(page.locator('#agent-review-status')).toHaveText('pending');
  try {
    await page.evaluate(() => window.dispatchEvent(new Event('qa-agent-network-offline')));
    await expect(page.locator('#lifecycle-state')).toHaveAttribute('data-state', 'disconnected');
  } finally {
    await page.evaluate(() => window.dispatchEvent(new Event('qa-agent-network-online')));
  }
  await expect(page.locator('#agent-review-status')).toHaveText('pending');
  await expect(page.locator('#lifecycle-state')).not.toHaveAttribute('data-state', 'disconnected');
  await expect(page.locator('#agent-accept')).toBeEnabled();
  await expect(page.locator('#save-iteration')).toBeDisabled();
  await expect(page.locator('#artboard [aria-label="Seatify title"]')).toHaveCount(1);
  await expect(page.locator('#artboard [aria-label="Pending reconnect title"]')).toHaveCount(0);
  await page.locator('#agent-revert').click();
});
