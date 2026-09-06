import { expect, test } from '@playwright/test';

const token = 'lineage-logo-e2e-agent-token';

test('closing a tab before its event stream opens releases document ownership for the next tab', async ({ browser, page }) => {
  const firstContext = await browser.newContext();
  const first = await firstContext.newPage();
  // Force the real boundary: the manifest reaches the server but SSE never opens.
  await first.route('**/api/agent/events', (route) => route.abort());
  await first.goto('http://marquee-qa.localhost:43118/');
  await first.locator('[data-path="concepts/seatify-constellation.svg"]').click();
  await expect.poll(async () => {
    const response = await first.request.get('http://marquee-qa.localhost:43118/api/agent/document', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.ok() ? (await response.json()).sourcePath : undefined;
  }).toBe('concepts/seatify-constellation.svg');
  await firstContext.close();

  await page.goto('/');
  await page.locator('[data-path="concepts/complex-seatify.svg"]').click();
  await expect.poll(async () => {
    const response = await page.request.get('/api/agent/document', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.ok() ? (await response.json()).sourcePath : undefined;
  }).toBe('concepts/complex-seatify.svg');
  await page.locator('.layer-button').filter({ hasText: /^textVenue caption$/ }).click();
  await page.locator('#layer-name').fill('Recovered connection');
  await page.locator('#layer-name').press('Enter');
  const save = page.locator('#save-iteration');
  const savedPath = (await save.getAttribute('title'))!.replace('Create ', '');
  await save.click();
  await expect(page.locator('#status')).toHaveText(`Saved ${savedPath}`);
  const saved = await page.request.get(`/api/svg?path=${encodeURIComponent(savedPath)}`);
  expect(await saved.text()).toContain('aria-label="Recovered connection"');
});

test('a delayed event stream republishes the current unsaved document after ownership expires', async ({ page }) => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/agent/events', async (route) => {
    await ready;
    await route.continue();
  });
  try {
    await page.goto('/');
    await page.locator('[data-path="concepts/seatify-constellation.svg"]').click();
    await page.locator('.layer-button').filter({ hasText: /^textSeatify title$/ }).click();
    const published = page.waitForResponse((response) => response.url().endsWith('/api/agent/document')
      && response.request().method() === 'POST'
      && response.request().postData()?.includes('Delayed connection correction') === true
      && response.ok(), { timeout: 5_000 });
    await page.locator('#layer-name').fill('Delayed connection correction');
    await page.locator('#layer-name').press('Enter');
    expect((await published).ok()).toBe(true);
    const document = async () => page.request.get('/api/agent/document', {
      headers: { Authorization: `Bearer ${token}` },
    });
    await expect.poll(async () => (await document()).status()).toBe(404);
    release();
    await expect.poll(async () => {
      const response = await document();
      return response.ok() ? (await response.json()).revision : -1;
    }).toBeGreaterThan(0);
    expect((await (await document()).json()).layers).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Delayed connection correction' }),
    ]));
    await expect(page.locator('#layer-name')).toHaveValue('Delayed connection correction');
    await expect(page.locator('#save-iteration')).toBeEnabled();
    await expect(page.locator('#undo')).toBeEnabled();
    const source = await page.request.get('/api/svg?path=concepts/seatify-constellation.svg');
    expect(await source.text()).not.toContain('Delayed connection correction');
  } finally {
    release();
  }
});
