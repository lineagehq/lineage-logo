import { expect, test, type Page } from "@playwright/test";
const sourcePath = "concepts/ux-wide.svg";
type Manifest = { sessionId: string; sourcePath: string; revision: number; layers: Array<{ name: string; sessionKey: string }> };
function trackEditedPublication(page: Page) {
  let published: Manifest | undefined;
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/agent/document' && request.method() === 'POST') published = request.postDataJSON() as Manifest;
  });
  return async () => {
    let manifest: Manifest | undefined;
    await expect.poll(async () => {
      const response = await page.request.get('/api/agent/document', { headers: { Authorization: 'Bearer lineage-logo-e2e-agent-token' } });
      if (!response.ok() || !published || published.sourcePath !== sourcePath || published.revision <= 0) return false;
      manifest = await response.json();
      return manifest!.sessionId === published.sessionId && manifest!.sourcePath === published.sourcePath && manifest!.revision === published.revision;
    }).toBe(true);
    return manifest!;
  };
}

async function open(page: Page) {
  await page.goto("/");
  await page.locator(`[data-path="${sourcePath}"]`).click();
  await expect(page.locator("#artboard #mark")).toBeVisible();
  await page.locator(".layer-button").filter({ hasText: "mark" }).click();
}
const source = async (page: Page) => await (await page.request.get(`/api/svg?path=${encodeURIComponent(sourcePath)}`)).text();
async function recolor(page: Page, value: string) { await page.locator("#fill").fill(value); await expect(page.locator("#artboard #mark")).toHaveAttribute("fill", value); }

test("the last committed manual edit survives immediate reload with explicit restore and fresh Undo history", async ({ page }) => {
  await open(page); const before = await source(page);
  await page.locator(".background-button[data-background='dark']").click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  const savedZoom = await page.locator("#zoom-label").textContent();
  await recolor(page, "#ee5500");
  // No debounce wait: the final commit itself must synchronously persist recovery.
  await page.reload();
  await expect(page.locator("#manual-draft-dialog")).toBeVisible();
  await expect(page.locator("#manual-draft-message")).toContainText("fresh Undo history");
  await expect(page.locator("#artboard #mark")).toHaveAttribute("fill", "#122238");
  await page.locator("#manual-draft-restore").click();
  await expect(page.locator("#artboard #mark")).toHaveAttribute("fill", "#ee5500");
  await expect(page.locator("#fill")).toHaveValue("#ee5500");
  await expect(page.locator("#zoom-label")).toHaveText(savedZoom!);
  await expect(page.locator(".background-button[data-background='dark']")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#undo")).toBeDisabled();
  await expect(page.locator("#save-iteration")).toBeEnabled();
  expect(await source(page)).toBe(before);
  await page.getByRole("button", {name:"Reset edits",exact:true}).click();
  await expect(page.locator("#artboard #mark")).toHaveAttribute("fill", "#122238");
  await page.reload(); await expect(page.locator("#artboard #mark")).toBeVisible();
  await expect(page.locator("#manual-draft-dialog")).not.toBeVisible();
});

test("Discard keeps the source unchanged and does not reoffer a retired draft", async ({ page }) => {
  await open(page); const before = await source(page); await recolor(page,"#ee5500"); await page.reload();
  await expect(page.locator("#manual-draft-dialog")).toBeVisible(); await page.locator("#manual-draft-discard").click();
  await expect(page.locator("#artboard #mark")).toHaveAttribute("fill","#122238");
  await page.reload(); await expect(page.locator("#artboard #mark")).toBeVisible(); await expect(page.locator("#manual-draft-dialog")).not.toBeVisible();
  expect(await source(page)).toBe(before);
});

test("recovery storage failure is visible while normal saving stays available", async ({ page }) => {
  await open(page); const before = await source(page);
  await page.evaluate(() => {
    const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value) { if(key.startsWith("lineage.manual-draft.")) throw new DOMException("fixture quota", "QuotaExceededError"); return original.call(this,key,value); };
  });
  await recolor(page,"#ee5500");
  await expect(page.locator("#manual-draft-status")).toContainText("could not be stored");
  await expect(page.locator("#save-iteration")).toBeEnabled(); await page.locator("#save-iteration").click();
  await expect(page.locator("#lifecycle-state")).toHaveAttribute("data-state","saved");
  expect(await source(page)).toBe(before);
});

test("successful Save retires the exact manual draft before reopening the original", async ({ page }) => {
  await open(page); const before=await source(page);await recolor(page,"#ee5500");await page.locator("#save-iteration").click();
  await expect(page.locator("#lifecycle-state")).toHaveAttribute("data-state","saved");
  await page.locator(`[data-path="${sourcePath}"]`).click(); await expect(page.locator("#artboard #mark")).toHaveAttribute("fill","#122238");
  await expect(page.locator("#manual-draft-dialog")).not.toBeVisible();expect(await source(page)).toBe(before);
});

test("an edit made during Save migrates into recovery for the saved continuation", async ({ page }) => {
  await open(page);const before=await source(page);await recolor(page,"#ee5500");
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let started!:()=>void;const waiting=new Promise<void>(resolve=>{started=resolve;});
  await page.route("**/api/iterations",async route=>{const response=await route.fetch();started();await gate;await route.fulfill({response});});
  await page.locator("#save-iteration").click();await waiting;await recolor(page,"#22aa55");release();
  await expect(page.locator(".file-button[aria-current='true']")).toHaveAttribute("data-path",/^iterations\//);
  await expect(page.locator("#lifecycle-state")).toHaveAttribute("data-state", "dirty");
  await expect(page.locator("#save-iteration")).toBeEnabled();
  const continuation=await page.locator(".file-button[aria-current='true']").getAttribute("data-path");
  const saved=await (await page.request.get(`/api/svg?path=${encodeURIComponent(continuation!)}`)).text();expect(saved).toContain("#ee5500");expect(saved).not.toContain("#22aa55");
  await page.reload();await expect(page.locator("#manual-draft-dialog")).toBeVisible();await page.locator("#manual-draft-restore").click();
  await expect(page.locator("#artboard #mark")).toHaveAttribute("fill","#22aa55");expect(await source(page)).toBe(before);
});

test("pending agent review retains authority over manual recovery after reload", async ({ page }) => {
  page.on('dialog', async dialog => {
    expect(dialog.type()).toBe('beforeunload');
    await dialog.accept();
  });
  const publication = trackEditedPublication(page);
  await open(page);const before=await source(page);await recolor(page,"#ee5500");
  const headers={Authorization:"Bearer lineage-logo-e2e-agent-token"};
  const manifest = await publication();
  const proposal={protocolVersion:1,transactionId:`manual-precedence-${Date.now()}`,producer:{kind:"fixture"},document:{sessionId:manifest.sessionId,sourcePath:manifest.sourcePath,baseRevision:manifest.revision},operations:[{type:"renameLayer",operationId:"rename",target:{sessionKey:manifest.layers.find((layer:{name:string})=>layer.name==="mark")!.sessionKey},name:"Pending mark"}]};
  expect((await page.request.post("http://127.0.0.1:43117/api/agent/transactions",{headers,data:proposal})).status()).toBe(202);
  await expect(page.locator("#agent-review-status")).toBeVisible();
  await expect(page.locator("#agent-review-status")).toHaveText(/^pending$/i);
  const recoveryStatuses: number[] = [];
  page.on('response', response => {
    if (new URL(response.url()).pathname === '/api/agent/recovery') recoveryStatuses.push(response.status());
  });
  const beforeReload = await page.evaluate(() => performance.timeOrigin);
  await page.reload();
  await expect.poll(() => page.evaluate(() => performance.timeOrigin)).not.toBe(beforeReload);
  await expect.poll(() => recoveryStatuses).toContain(200);
  await expect(page.locator("#agent-review")).toBeVisible();
  await expect(page.locator("#agent-review-status")).toBeVisible();
  await expect(page.locator("#agent-review-status")).toHaveText(/^pending$/i);
  await expect(page.locator("#manual-draft-dialog")).not.toBeVisible();
  await expect(page.locator("#agent-revert")).toBeEnabled();
  await expect(page.locator("#save-iteration")).toBeDisabled();expect(await source(page)).toBe(before);
  await page.locator("#agent-revert").click();
  await expect(page.locator("#agent-review-status")).not.toHaveText(/^pending$/i);
  await expect(page.locator("#artboard #mark")).toHaveAttribute("fill", "#ee5500");
  await expect(page.locator("#save-iteration")).toBeEnabled();
  expect(await source(page)).toBe(before);
});

for (const labels of [["North seat back"], ["North seat back", "North seat base"]]) {
  test(`manual recovery restores nested selection: ${labels.join(" and ")}`, async ({ page }) => {
    await page.goto("/");
    await page.locator('[data-path="concepts/seatify-constellation.svg"]').click();
    const button = (label: string) => page.locator(".layer-button").filter({has:page.locator(".layer-type + span",{hasText:new RegExp(`^${label}$`)})});
    await button(labels[0]).click();
    await page.locator("#fill").fill("#ee5500");
    for (const label of labels.slice(1)) await button(label).click({modifiers:["Shift"]});
    const selected = async () => await page.locator(".layer-button[aria-pressed='true'] .layer-type + span").allTextContents();
    await expect.poll(selected).toEqual(labels);
    await page.reload();await expect(page.locator("#manual-draft-dialog")).toBeVisible();
    await page.locator("#manual-draft-restore").click();
    await expect.poll(selected).toEqual(labels);
    await expect(page.locator("#artboard #seat-north-back")).toHaveAttribute("fill","#ee5500");
    await expect(page.locator("#undo")).toBeDisabled();
    await expect(page.locator("#save-iteration")).toBeEnabled();
  });
}

test("file-switch Discard retires the locally restored draft instead of offering discarded edits again", async ({ page }) => {
  await open(page);const before=await source(page);await recolor(page,"#ee5500");await page.reload();
  await expect(page.locator("#manual-draft-dialog")).toBeVisible();await page.locator("#manual-draft-restore").click();
  await page.locator('[data-path="concepts/ux-tall.svg"]').click();await expect(page.locator("#unsaved-dialog")).toBeVisible();
  await page.locator("#unsaved-discard").click();await expect(page.locator("#artboard svg")).toHaveAttribute("viewBox","0 0 100 600");
  await page.locator(`[data-path="${sourcePath}"]`).click();await expect(page.locator("#artboard #mark")).toHaveAttribute("fill","#122238");
  await expect(page.locator("#manual-draft-dialog")).not.toBeVisible();expect(await source(page)).toBe(before);
});

for (const failure of ["throw", "noop"] as const) {
  test(`Save-and-switch reports failed draft retirement: ${failure}`, async ({ page }) => {
    await open(page);
    const before = await source(page);
    await recolor(page, "#ee5500");
    await page.evaluate(mode => {
      const remove = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function(key) {
        if (key.startsWith("lineage.manual-draft.") && key.includes(".record.")) {
          if (mode === "throw") throw new DOMException("fixture removal denial", "SecurityError");
          return;
        }
        return remove.call(this, key);
      };
    }, failure);
    await page.locator('[data-path="concepts/ux-tall.svg"]').click();
    const savedResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/iterations" && response.request().method() === "POST");
    await page.locator("#unsaved-save").click();
    const saved = await (await savedResponse).json();
    await expect(page.locator(".file-button[aria-current='true']")).toHaveAttribute("data-path", "concepts/ux-tall.svg");
    await expect(page.locator("#manual-draft-status")).toContainText("previous recovery draft could not be removed");
    expect(await source(page)).toBe(before);
    const bytes = await (await page.request.get(`/api/svg?path=${encodeURIComponent(saved.file.path)}`)).text();
    expect(bytes).toContain("#ee5500");
    await page.locator(`[data-path="${sourcePath}"]`).click();
    await expect(page.locator("#manual-draft-dialog")).toBeVisible();
  });
}

test("failed deletion of an expired draft permits keyboard exit and normal saving", async ({ page }) => {
  await open(page);
  const before = await source(page);
  await recolor(page, "#ee5500");
  await page.addInitScript(() => {
    const now = Date.now;
    Date.now = () => now() + 8 * 24 * 60 * 60 * 1000;
    const remove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function(key) {
      if (key.startsWith("lineage.manual-draft.") && key.includes(".record.")) throw new DOMException("fixture removal denial", "SecurityError");
      return remove.call(this, key);
    };
  });
  await page.reload();
  await expect(page.locator("#manual-draft-message")).toContainText("expired");
  await expect(page.locator("#manual-draft-restore")).toBeDisabled();
  await page.locator("#manual-draft-discard").click();
  await expect(page.locator("#manual-draft-continue")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#manual-draft-dialog")).not.toBeVisible();
  await expect(page.locator("#artboard #mark")).toHaveAttribute("fill", "#122238");
  await page.locator(".layer-button").filter({ hasText: "mark" }).click();
  await recolor(page, "#22aa55");
  await page.locator("#save-iteration").click();
  await expect(page.locator("#lifecycle-state")).toHaveAttribute("data-state", "saved");
  expect(await source(page)).toBe(before);
});

test('agent acceptance preserves a different recovery record written by another tab', async ({ page, context }) => {
  // Bind to this page while the preceding tab's editor lease is released.
  const publication = trackEditedPublication(page);
  await open(page);
  const before = await source(page);
  await recolor(page, '#ee5500');
  const headers = { Authorization: 'Bearer lineage-logo-e2e-agent-token' };
  const manifest = await publication();
  const proposal = { protocolVersion: 1, transactionId: `draft-other-tab-${Date.now()}`, producer: { kind: 'fixture' },
    document: { sessionId: manifest!.sessionId, sourcePath: manifest!.sourcePath, baseRevision: manifest!.revision },
    operations: [{ type: 'renameLayer', operationId: 'rename', target: { sessionKey: manifest!.layers.find(layer => layer.name === 'mark')!.sessionKey }, name: 'Accepted mark' }] };
  expect((await page.request.post('/api/agent/transactions', { headers, data: proposal })).status()).toBe(202);
  await expect(page.locator('#agent-review-status')).toBeVisible();
  await expect(page.locator('#agent-review-status')).toHaveText(/^pending$/i);
  // A storage-only second tab models another editor's completed write without
  // competing for this editor's live agent connection. Use the real draft store.
  const other = await context.newPage();
  await other.route('**/draft-writer', route => route.fulfill({ contentType: 'text/html', body: '<title>Draft storage fixture</title>' }));
  await other.goto('/draft-writer');
  await other.evaluate(async sourceSvg => {
    const modulePath = '/manual-draft-store.ts';
    const { writeManualDraft } = await import(modulePath);
    const key = Object.keys(localStorage).find(key => key.startsWith('lineage.manual-draft.') && key.includes('.record.'))!;
    const draft = JSON.parse(localStorage.getItem(key)!);
    const canonicalSource = new XMLSerializer().serializeToString(new DOMParser().parseFromString(sourceSvg, 'image/svg+xml').documentElement);
    const result = writeManualDraft(localStorage, { workspaceId: draft.workspaceId, sourcePath: draft.sourcePath,
      sourceSvg: canonicalSource, svg: draft.svg.replaceAll('#ee5500', '#22aa55'), revision: draft.revision + 1, context: draft.context });
    if (result.status !== 'saved') throw new Error(`Fixture draft refused: ${result.status}`);
  }, before);
  await other.close();
  await page.locator('#agent-accept').click();
  await expect(page.locator('#lifecycle-state')).toHaveAttribute('data-state', 'saved');
  await expect(page.locator('.file-button[aria-current="true"]')).toHaveAttribute('data-path', /^iterations\//);
  const continuation = await page.locator('.file-button[aria-current="true"]').getAttribute('data-path');
  const saved = await (await page.request.get(`/api/svg?path=${encodeURIComponent(continuation!)}`)).text();
  expect(saved).toContain('#ee5500'); expect(saved).not.toContain('#22aa55');
  await page.locator(`[data-path="${sourcePath}"]`).click();
  await expect(page.locator('.file-button[aria-current="true"]')).toHaveAttribute('data-path', sourcePath);
  await expect(page.locator('#manual-draft-dialog')).toBeVisible();
  await page.locator('#manual-draft-restore').click();
  await expect(page.locator('#artboard #mark')).toHaveAttribute('fill', '#22aa55');
  expect(await source(page)).toBe(before);
});


test('Discard retires the restored draft even when replacement writes fail', async ({ page }) => {
  await open(page); const before = await source(page); await recolor(page, '#ee5500');
  await page.reload(); await expect(page.locator('#manual-draft-dialog')).toBeVisible();
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('lineage.manual-draft.')) throw new DOMException('fixture quota', 'QuotaExceededError');
      return set.call(this, key, value);
    };
  });
  await page.locator('#manual-draft-restore').click();
  await expect(page.locator('#artboard #mark')).toHaveAttribute('fill', '#ee5500');
  await expect(page.locator('#manual-draft-status')).toContainText('could not be stored');
  await page.locator('[data-path="concepts/ux-tall.svg"]').click();
  await page.locator('#unsaved-discard').click();
  await expect(page.locator('.file-button[aria-current="true"]')).toHaveAttribute('data-path', 'concepts/ux-tall.svg');
  await page.locator(`[data-path="${sourcePath}"]`).click();
  await expect(page.locator('#artboard #mark')).toHaveAttribute('fill', '#122238');
  await expect(page.locator('#manual-draft-dialog')).not.toBeVisible();
  expect(await source(page)).toBe(before);
});
