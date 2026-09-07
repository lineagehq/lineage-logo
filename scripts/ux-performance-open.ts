import type { Page } from '@playwright/test';

/** Only use on the harness's isolated public-fixture origin. Runs before app startup. */
export async function disablePerformanceRestoration(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

export async function prepareEmptyPerformanceOpen(page: Page, count: number): Promise<void> {
  await page.reload();
  await page.locator(`[data-path="concepts/layers-${count}.svg"]`).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('#artboard svg').length === 0 && document.querySelector<HTMLInputElement>('#layer-search')?.disabled === true);
}

export async function measurePerformanceOpen(page: Page, count: number): Promise<number> {
  return page.evaluate(async (count) => {
    const search = document.querySelector<HTMLInputElement>('#layer-search');
    if (document.querySelector('#artboard svg') || !search?.disabled) throw new Error('Timed open must start with a confirmed empty editor.');
    const file = document.querySelector<HTMLButtonElement>(`[data-path="concepts/layers-${count}.svg"]`);
    if (!file) throw new Error('Performance fixture missing.');
    const start = performance.now();
    file.click();
    while (document.querySelectorAll('#artboard svg rect').length !== count || search.disabled) {
      if (performance.now()-start > 15000) throw new Error('Open did not become interactive');
      await new Promise(requestAnimationFrame);
    }
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    return performance.now()-start;
  }, count);
}
