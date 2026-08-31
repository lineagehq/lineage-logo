import { expect, test, type Page } from "@playwright/test";

const selectedLabels = ["East north seat", "Ticket accent star", "West north seat"].sort();
const primaryLabel = "Ticket accent star";
const dragSourceLabel = "East north seat";
const anchorLabel = "Venue caption";
const agentToken = "lineage-logo-e2e-agent-token";

type Point = { x: number; y: number };
type Bounds = Point & { bottom: number; height: number; left: number; right: number; top: number; width: number };
type Geometry = Record<string, Bounds>;

declare global {
  interface Window {
    __translationPointer: Point[];
  }
}

async function openFixture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__translationPointer = [];
    for (const type of ["mousedown", "mousemove"] as const) {
      document.addEventListener(type, (event) => {
        window.__translationPointer.push({ x: event.clientX, y: event.clientY });
      }, true);
    }
  });
  await page.goto("/");
  await expect(page).toHaveURL(/^http:\/\/marquee-qa\.localhost:/);
  await page.getByRole("button", { name: "complex-seatify" }).click();
  await expect(page.locator("#artboard svg[aria-label='Complex Seatify venue logo']")).toBeVisible();
  await expect.poll(async () => {
    const response = await page.request.get("/api/agent/document", {
      headers: { Authorization: `Bearer ${agentToken}` },
    });
    return response.ok() ? (await response.json()).sourcePath : undefined;
  }).toBe("concepts/complex-seatify.svg");
}

async function producerManifest(page: Page): Promise<{
  layers: Array<{ name: string; sessionKey: string }>;
  revision: number;
  sessionId: string;
  sourcePath: string;
}> {
  const response = await page.request.get("/api/agent/document", {
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  expect(response.ok()).toBe(true);
  return await response.json();
}

function labeled(page: Page, label: string) {
  return page.locator(`#artboard svg [aria-label=${JSON.stringify(label)}]`);
}

function layerButton(page: Page, label: string) {
  return page.locator(".layer-button").filter({ has: page.locator(".layer-type + span", { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }) });
}

async function chosenLabels(page: Page): Promise<string[]> {
  return await page.locator(".layer-button[aria-pressed='true']").evaluateAll((buttons) => buttons
    .map((button) => button.querySelector(".layer-type + span")?.textContent?.trim() ?? "")
    .filter(Boolean)
    .sort());
}

async function primaryLayerLabel(page: Page): Promise<string> {
  return await page.locator(".layer-button.selected").evaluate((button) =>
    button.querySelector(".layer-type + span")?.textContent?.trim() ?? "");
}

async function inspector(page: Page): Promise<unknown> {
  return await page.locator("#inspector-panel").evaluate((panel) => ({
    breadcrumb: panel.querySelector("#selection-breadcrumb")?.textContent,
    count: panel.querySelector("#selection-count-badge")?.textContent,
    name: panel.querySelector("#selection-name")?.textContent,
    positionX: (panel.querySelector("#position-x") as HTMLInputElement | null)?.value,
    positionY: (panel.querySelector("#position-y") as HTMLInputElement | null)?.value,
    summaries: Array.from(panel.querySelectorAll(".group-summary")).map((summary) => summary.textContent),
  }));
}

async function identity(page: Page): Promise<unknown> {
  return {
    inspector: await inspector(page),
    layers: await chosenLabels(page),
    primary: await primaryLayerLabel(page),
  };
}

async function controls(page: Page): Promise<Record<string, boolean>> {
  return await page.locator("#undo, #redo, #reset-edits, #save-iteration").evaluateAll((items) =>
    Object.fromEntries(items.map((item) => [item.id, (item as HTMLButtonElement).disabled])));
}

async function rootGeometry(page: Page, labels = [...selectedLabels, anchorLabel]): Promise<Geometry> {
  return await page.locator("#artboard svg").evaluate((rootNode, targetLabels) => {
    const root = rootNode as SVGSVGElement;
    const rootMatrix = root.getCTM();
    if (!rootMatrix) throw new Error("Root CTM is unavailable.");
    const rootInverse = rootMatrix.inverse();
    return Object.fromEntries(targetLabels.map((label) => {
      const node = Array.from(root.querySelectorAll<SVGGraphicsElement>("[aria-label]"))
        .find((candidate) => candidate.getAttribute("aria-label") === label);
      const ctm = node?.getCTM();
      if (!node || !ctm) throw new Error(`Root geometry is unavailable for ${label}.`);
      const box = node.getBBox();
      const matrix = rootInverse.multiply(ctm);
      const points = [
        new DOMPoint(box.x, box.y),
        new DOMPoint(box.x + box.width, box.y),
        new DOMPoint(box.x, box.y + box.height),
        new DOMPoint(box.x + box.width, box.y + box.height),
      ].map((point) => point.matrixTransform(matrix));
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const left = Math.min(...xs);
      const right = Math.max(...xs);
      const top = Math.min(...ys);
      const bottom = Math.max(...ys);
      return [label, { x: left, y: top, left, right, top, bottom, width: right - left, height: bottom - top }];
    }));
  }, labels);
}

async function marquee(page: Page, label: string, additive: boolean): Promise<void> {
  const target = labeled(page, label);
  await expect(target).toBeVisible();
  await target.scrollIntoViewIfNeeded();
  const [box, stage] = await Promise.all([target.boundingBox(), page.locator("#stage").boundingBox()]);
  if (!box || !stage) throw new Error(`Live marquee geometry is unavailable for ${label}.`);
  const padding = Math.min(box.width, box.height) * 0.08;
  const start = { x: box.x - padding, y: box.y - padding };
  const end = { x: box.x + box.width + padding, y: box.y + box.height + padding };
  for (const point of [start, end]) {
    expect(point.x).toBeGreaterThan(stage.x);
    expect(point.x).toBeLessThan(stage.x + stage.width);
    expect(point.y).toBeGreaterThan(stage.y);
    expect(point.y).toBeLessThan(stage.y + stage.height);
  }
  await page.mouse.move(start.x, start.y);
  await page.keyboard.down("ControlLeft");
  if (additive) await page.keyboard.down("ShiftLeft");
  await expect(page.locator("#stage")).toHaveClass(/marquee-ready/);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await expect(page.locator("#stage")).toHaveClass(/marquee-active/);
  await page.mouse.up();
  if (additive) await page.keyboard.up("ShiftLeft");
  await page.keyboard.up("ControlLeft");
}

async function selectTranslationTargets(page: Page): Promise<void> {
  await marquee(page, "West north seat", false);
  await expect.poll(() => chosenLabels(page)).toEqual(["West north seat"]);
  await marquee(page, "East north seat", true);
  await expect.poll(() => chosenLabels(page)).toEqual(["East north seat", "West north seat"].sort());
  await marquee(page, primaryLabel, true);
  await expect.poll(() => chosenLabels(page)).toEqual(selectedLabels);
  await expect(page.locator("#selection-name")).toHaveText("3 layers");
  await expect(page.locator("#selection-count-badge")).toHaveText("3 objects selected");
  expect(await primaryLayerLabel(page)).toBe(primaryLabel);
}

async function selectionDrag(page: Page): Promise<{ delta: Point; end: Point; start: Point }> {
  const points = await page.locator("#artboard svg").evaluate((rootNode, sourceLabel) => {
    const root = rootNode as SVGSVGElement;
    const source = Array.from(root.querySelectorAll<SVGGraphicsElement>("[aria-label]"))
      .find((candidate) => candidate.getAttribute("aria-label") === sourceLabel);
    const sourceScreen = source?.getScreenCTM();
    const rootScreen = root.getScreenCTM();
    if (!source || !sourceScreen || !rootScreen) throw new Error("Live drag transforms are unavailable.");
    const box = source.getBBox();
    const localCenter = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2);
    const start = localCenter.matrixTransform(sourceScreen);
    const startRoot = start.matrixTransform(rootScreen.inverse());
    const sourceRootMatrix = root.getCTM()!.inverse().multiply(source.getCTM()!);
    const sourceRootPoints = [new DOMPoint(box.x, box.y), new DOMPoint(box.x + box.width, box.y + box.height)]
      .map((point) => point.matrixTransform(sourceRootMatrix));
    const delta = {
      x: Math.abs(sourceRootPoints[1].x - sourceRootPoints[0].x) * 0.4,
      y: Math.abs(sourceRootPoints[1].y - sourceRootPoints[0].y) * 0.3,
    };
    const end = new DOMPoint(startRoot.x + delta.x, startRoot.y + delta.y).matrixTransform(rootScreen);
    return { delta, end: { x: end.x, y: end.y }, start: { x: start.x, y: start.y } };
  }, dragSourceLabel);
  await page.evaluate(() => { window.__translationPointer = []; });
  await page.mouse.move(points.start.x, points.start.y);
  await page.mouse.down();
  await page.mouse.move(points.end.x, points.end.y, { steps: 8 });
  const observedDelta = await page.locator("#artboard svg").evaluate((rootNode) => {
    const events = window.__translationPointer;
    const start = events[0];
    const end = events.at(-1);
    const screen = (rootNode as SVGSVGElement).getScreenCTM();
    if (!start || !end || !screen) throw new Error("Observed drag input cannot be mapped to root space.");
    const inverse = screen.inverse();
    const origin = new DOMPoint(0, 0).matrixTransform(inverse);
    const vector = new DOMPoint(end.x - start.x, end.y - start.y).matrixTransform(inverse);
    return { x: vector.x - origin.x, y: vector.y - origin.y };
  });
  return { ...points, delta: observedDelta };
}

async function withIgnoredSuccessorClick(page: Page, gesture: () => Promise<void>): Promise<void> {
  const modifier = await page.evaluate(() => /^(?:Mac|iPhone|iPad|iPod)/.test(navigator.platform))
    ? "ControlRight"
    : "MetaLeft";
  await page.keyboard.down(modifier);
  try {
    await gesture();
  } finally {
    await page.keyboard.up(modifier);
  }
}

function expectSameGeometry(actual: Geometry, expected: Geometry): void {
  for (const label of Object.keys(expected)) {
    for (const property of ["left", "right", "top", "bottom", "width", "height"] as const) {
      expect(actual[label][property], `${label} ${property}`).toBeCloseTo(expected[label][property], 5);
    }
  }
}

function expectTranslation(before: Geometry, after: Geometry, expected: Point): void {
  for (const label of selectedLabels) {
    expect(after[label].left - before[label].left, `${label} dx`).toBeCloseTo(expected.x, 5);
    expect(after[label].top - before[label].top, `${label} dy`).toBeCloseTo(expected.y, 5);
    expect(after[label].width, `${label} width`).toBeCloseTo(before[label].width, 5);
    expect(after[label].height, `${label} height`).toBeCloseTo(before[label].height, 5);
  }
  expectSameGeometry({ [anchorLabel]: after[anchorLabel] }, { [anchorLabel]: before[anchorLabel] });
}

function expectPointerTranslation(before: Geometry, after: Geometry, expected: Point): void {
  const deltas = selectedLabels.map((label) => ({
    label,
    x: after[label].left - before[label].left,
    y: after[label].top - before[label].top,
  }));
  for (const delta of deltas) {
    expect(Math.abs(delta.x - expected.x), `${delta.label} pointer dx error`).toBeLessThanOrEqual(1e-4);
    expect(Math.abs(delta.y - expected.y), `${delta.label} pointer dy error`).toBeLessThanOrEqual(1e-4);
    expect(after[delta.label].width, `${delta.label} width`).toBeCloseTo(before[delta.label].width, 5);
    expect(after[delta.label].height, `${delta.label} height`).toBeCloseTo(before[delta.label].height, 5);
  }
  const reference = deltas[0];
  for (const delta of deltas.slice(1)) {
    expect(Math.abs(delta.x - reference.x), `${delta.label} shared pointer dx error`).toBeLessThanOrEqual(1e-5);
    expect(Math.abs(delta.y - reference.y), `${delta.label} shared pointer dy error`).toBeLessThanOrEqual(1e-5);
  }
  expectSameGeometry({ [anchorLabel]: after[anchorLabel] }, { [anchorLabel]: before[anchorLabel] });
}

test.beforeEach(async ({ page }) => openFixture(page));

test("collective translation drag from a non-primary layer is one exact Undo/Redo checkpoint", async ({ page }) => {
  await selectTranslationTargets(page);
  const before = await rootGeometry(page);
  const beforeIdentity = await identity(page);
  expect(await controls(page)).toEqual({ redo: true, "reset-edits": true, "save-iteration": true, undo: true });

  await page.keyboard.down("AltLeft");
  const drag = await selectionDrag(page);
  await page.mouse.up();
  await page.keyboard.up("AltLeft");
  await expect.poll(async () => (await controls(page)).undo).toBe(false);
  const moved = await rootGeometry(page);
  expectPointerTranslation(before, moved, drag.delta);
  const movedIdentity = await identity(page);
  expect(movedIdentity).toMatchObject({ layers: selectedLabels, primary: primaryLabel });
  expect(await controls(page)).toEqual({ redo: true, "reset-edits": false, "save-iteration": false, undo: false });

  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await controls(page)).redo).toBe(false);
  expectSameGeometry(await rootGeometry(page), before);
  expect(await identity(page)).toEqual(beforeIdentity);
  expect(await controls(page)).toEqual({ redo: false, "reset-edits": true, "save-iteration": true, undo: true });

  await page.getByRole("button", { name: "Redo" }).click();
  await expect.poll(async () => (await controls(page)).undo).toBe(false);
  expectSameGeometry(await rootGeometry(page), moved);
  expect(await identity(page)).toEqual(movedIdentity);
  expect(await controls(page)).toEqual({ redo: true, "reset-edits": false, "save-iteration": false, undo: false });
});

test("collective translation ArrowRight and Shift+ArrowDown keep exact shared root deltas and history", async ({ page }) => {
  await selectTranslationTargets(page);
  const baseline = await rootGeometry(page);
  const baselineIdentity = await identity(page);
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await rootGeometry(page))[primaryLabel].left).not.toBeCloseTo(baseline[primaryLabel].left, 5);
  const right = await rootGeometry(page);
  expectTranslation(baseline, right, { x: 1, y: 0 });
  const rightIdentity = await identity(page);

  await page.keyboard.press("Shift+ArrowDown");
  const down = await rootGeometry(page);
  expectTranslation(right, down, { x: 0, y: 10 });
  const downIdentity = await identity(page);
  expect(downIdentity).toMatchObject({ layers: selectedLabels, primary: primaryLabel });

  await page.getByRole("button", { name: "Undo" }).click();
  expectSameGeometry(await rootGeometry(page), right);
  expect(await identity(page)).toEqual(rightIdentity);
  await page.getByRole("button", { name: "Undo" }).click();
  expectSameGeometry(await rootGeometry(page), baseline);
  expect(await identity(page)).toEqual(baselineIdentity);
  expect(await controls(page)).toEqual({ redo: false, "reset-edits": true, "save-iteration": true, undo: true });

  await page.getByRole("button", { name: "Redo" }).click();
  expectSameGeometry(await rootGeometry(page), right);
  expect(await identity(page)).toEqual(rightIdentity);
  await page.getByRole("button", { name: "Redo" }).click();
  expectSameGeometry(await rootGeometry(page), down);
  expect(await identity(page)).toEqual(downIdentity);
  expect(await controls(page)).toEqual({ redo: true, "reset-edits": false, "save-iteration": false, undo: false });
});

test("collective translation zero-distance, below-threshold, and Escape drags are exact no-ops", async ({ page }) => {
  await selectTranslationTargets(page);
  const baseline = await rootGeometry(page);
  const baselineIdentity = await identity(page);
  const initialControls = await controls(page);

  await withIgnoredSuccessorClick(page, async () => {
    const zero = await selectionDrag(page);
    await page.mouse.move(zero.start.x, zero.start.y);
    await page.mouse.up();
  });
  expectSameGeometry(await rootGeometry(page), baseline);
  expect(await identity(page)).toEqual(baselineIdentity);
  expect(await controls(page)).toEqual(initialControls);

  const sourceBox = await labeled(page, dragSourceLabel).boundingBox();
  if (!sourceBox) throw new Error("Below-threshold source geometry is unavailable.");
  const below = Math.min(sourceBox.width, sourceBox.height) * 0.005;
  await withIgnoredSuccessorClick(page, async () => {
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(sourceBox.x + sourceBox.width / 2 + below, sourceBox.y + sourceBox.height / 2 + below);
    await page.mouse.up();
  });
  expectSameGeometry(await rootGeometry(page), baseline);
  expect(await identity(page)).toEqual(baselineIdentity);
  expect(await controls(page)).toEqual(initialControls);

  await withIgnoredSuccessorClick(page, async () => {
    await selectionDrag(page);
    await page.keyboard.press("Escape");
    await page.mouse.up();
  });
  expectSameGeometry(await rootGeometry(page), baseline);
  expect(await identity(page)).toEqual(baselineIdentity);
  expect(await controls(page)).toEqual(initialControls);
});

test("collective translation rejects a locked member without partial movement or history", async ({ page }) => {
  await layerButton(page, dragSourceLabel).click();
  await page.locator("#lock-selection").click();
  await expect(page.locator("#inspector-panel")).toContainText("Locked");
  await layerButton(page, "Venue logo").click();
  await selectTranslationTargets(page);
  await expect(layerButton(page, dragSourceLabel)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#inspector-panel")).toContainText(/Unlock every selected layer/);
  const baseline = await rootGeometry(page);
  const baselineIdentity = await identity(page);
  const initialControls = await controls(page);

  await page.keyboard.press("ArrowRight");
  expectSameGeometry(await rootGeometry(page), baseline);
  expect(await identity(page)).toEqual(baselineIdentity);
  let drag: Awaited<ReturnType<typeof selectionDrag>> | undefined;
  await withIgnoredSuccessorClick(page, async () => {
    drag = await selectionDrag(page);
    await page.mouse.up();
  });
  if (!drag) throw new Error("Rejected drag input was not observed.");
  expect(drag.delta.x).toBeGreaterThan(0);
  expectSameGeometry(await rootGeometry(page), baseline);
  expect(await identity(page)).toEqual(baselineIdentity);
  expect(await controls(page)).toEqual(initialControls);
  await expect(page.locator("#status")).toContainText(/unlock|locked/i);
});

test("collective translation rejects a hidden member without adding a history checkpoint", async ({ page }) => {
  await selectTranslationTargets(page);
  const visibleBaseline = await rootGeometry(page);
  await page.getByRole("button", { exact: true, name: `Hide ${dragSourceLabel}` }).click();
  await expect(page.getByRole("button", { name: `Show ${dragSourceLabel}` })).toBeVisible();
  await expect.poll(() => chosenLabels(page)).toEqual(selectedLabels);
  const baseline = await rootGeometry(page);
  const baselineIdentity = await identity(page);

  await page.keyboard.press("Shift+ArrowDown");
  expectSameGeometry(await rootGeometry(page), baseline);
  expect(await identity(page)).toEqual(baselineIdentity);
  await expect(page.locator("#status")).toContainText(/hidden|show/i);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { name: `Hide ${dragSourceLabel}` })).toBeVisible();
  expectSameGeometry(await rootGeometry(page), visibleBaseline);
  expect(await controls(page)).toEqual({ redo: false, "reset-edits": true, "save-iteration": true, undo: true });
});

test("collective translation is publicly agent-blocked, Revert is clean, and named Save writes clean SVG", async ({ page }) => {
  await selectTranslationTargets(page);
  const baseline = await rootGeometry(page);
  const baselineIdentity = await identity(page);
  const manifest = await producerManifest(page);
  const venue = manifest.layers.find((layer) => layer.name === anchorLabel);
  if (!venue) throw new Error("Venue caption is absent from the public producer manifest.");
  const transactionId = `collective-translation-${Date.now()}`;
  const queued = await page.request.post("/api/agent/transactions", {
    data: {
      protocolVersion: 1,
      transactionId,
      producer: { kind: "test", name: "Collective translation QA" },
      document: { sessionId: manifest.sessionId, sourcePath: manifest.sourcePath, baseRevision: manifest.revision },
      operations: [{ type: "renameLayer", operationId: "rename-venue", target: { sessionKey: venue.sessionKey }, name: "Venue caption proposal" }],
    },
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  expect(queued.status()).toBe(202);
  await expect(page.locator("#agent-review")).toBeVisible();
  await expect(page.locator("#agent-review-status")).toHaveAttribute("data-status", "pending");

  await page.keyboard.press("ArrowRight");
  expectSameGeometry(await rootGeometry(page), baseline);
  expect(await identity(page)).toEqual(baselineIdentity);
  expect(await controls(page)).toEqual({ redo: true, "reset-edits": true, "save-iteration": true, undo: true });
  await expect(page.locator("#status")).toContainText("Finish the pending Agent review before moving layers.");

  await page.getByRole("button", { name: "Revert" }).click();
  await expect(page.locator("#agent-review-status")).toHaveAttribute("data-status", "reverted");
  expectSameGeometry(await rootGeometry(page), baseline);
  expect(await identity(page)).toEqual(baselineIdentity);
  expect(await controls(page)).toEqual({ redo: true, "reset-edits": true, "save-iteration": true, undo: true });
  const outcome = await page.request.get(`/api/agent/transactions/${transactionId}`, {
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  expect(await outcome.json()).toMatchObject({ status: "reverted", transactionId });

  await page.keyboard.press("ArrowRight");
  const savedGeometry = await rootGeometry(page);
  expectTranslation(baseline, savedGeometry, { x: 1, y: 0 });
  await page.getByRole("button", { name: "Save iteration" }).click();
  await expect(page.locator("#status")).toHaveText("Saved iterations/iteration-1.svg");
  await expect(page.locator(".file-button[aria-current='true']")).toHaveAttribute("data-path", "iterations/iteration-1.svg");
  expectSameGeometry(await rootGeometry(page), savedGeometry);
  expect(await controls(page)).toEqual({ redo: true, "reset-edits": true, "save-iteration": true, undo: true });

  const savedResponse = await page.request.get("/api/svg?path=iterations%2Fiteration-1.svg");
  expect(savedResponse.ok()).toBe(true);
  const saved = await savedResponse.text();
  expect(saved).toContain("Ticket accent star");
  expect(saved).not.toMatch(/data-(?:lineage|agent|review|transport)-|lineage-logo-edit|transactionId|agent-token/i);
});
