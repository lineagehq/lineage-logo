import { expect, test, type Page } from "@playwright/test";

const selectedLabel = "Venue caption";

async function openSeatify(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page).toHaveURL(/^http:\/\/marquee-qa\.localhost:/);
  await page.getByRole("button", { name: "complex-seatify" }).click();
  await expect(page.locator("#artboard svg[aria-label='Complex Seatify venue logo']")).toBeVisible();
}

function layerButton(page: Page, label: string) {
  const exact = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  return page.locator(".layer-button").filter({ has: page.locator(".layer-type + span", { hasText: exact }) });
}

async function rootBounds(page: Page, objectLabel = selectedLabel): Promise<{ bottom: number; centerX: number; centerY: number; left: number; right: number; top: number; transform: string | null }> {
  return await page.locator("#artboard svg").evaluate((rootNode, label) => {
    const root = rootNode as SVGSVGElement;
    const node = Array.from(root.querySelectorAll<SVGGraphicsElement>("[aria-label]"))
      .find((candidate) => candidate.getAttribute("aria-label") === label);
    const rootMatrix = root.getCTM();
    const nodeMatrix = node?.getCTM();
    if (!node || !rootMatrix || !nodeMatrix) throw new Error("Seatify snap geometry is unavailable.");
    const box = node.getBBox();
    const relative = rootMatrix.inverse().multiply(nodeMatrix);
    const points = [
      new DOMPoint(box.x, box.y), new DOMPoint(box.x + box.width, box.y),
      new DOMPoint(box.x, box.y + box.height), new DOMPoint(box.x + box.width, box.y + box.height),
    ].map((point) => point.matrixTransform(relative));
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    return {
      left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys),
      centerX: (Math.min(...xs) + Math.max(...xs)) / 2, centerY: (Math.min(...ys) + Math.max(...ys)) / 2,
      transform: node.getAttribute("transform"),
    };
  }, objectLabel);
}

test("Seatify smart alignment is zoom-stable, truthful, suspendable, atomic, and transient", async ({ page }) => {
  await openSeatify(page);
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.locator("#zoom-label")).toHaveText("125%");
  await layerButton(page, selectedLabel).click();

  const before = await rootBounds(page);
  const gesture = await page.locator("#artboard svg").evaluate((rootNode, label) => {
    const root = rootNode as SVGSVGElement;
    const node = Array.from(root.querySelectorAll<SVGGraphicsElement>("[aria-label]"))
      .find((candidate) => candidate.getAttribute("aria-label") === label);
    const nodeScreen = node?.getScreenCTM();
    const rootScreen = root.getScreenCTM();
    if (!node || !nodeScreen || !rootScreen) throw new Error("Seatify pointer geometry is unavailable.");
    const box = node.getBBox();
    const start = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(nodeScreen);
    const rootPoint = start.matrixTransform(rootScreen.inverse());
    const view = root.viewBox.baseVal;
    const desiredRoot = new DOMPoint(view.x + view.width / 2, view.y + view.height / 2).matrixTransform(rootScreen);
    return {
      start: { x: start.x, y: start.y },
      end: { x: desiredRoot.x + 2, y: desiredRoot.y + 2 },
      rootPoint: { x: rootPoint.x, y: rootPoint.y },
    };
  }, selectedLabel);

  await page.mouse.move(gesture.start.x, gesture.start.y);
  await page.locator("#artboard svg").evaluate((root, input) => {
    const node = Array.from(root.querySelectorAll<SVGGraphicsElement>("[aria-label]"))
      .find((candidate) => candidate.getAttribute("aria-label") === input.label);
    if (!node) throw new Error("Seatify drag source is unavailable.");
    node.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true, cancelable: true, buttons: 1, button: 0,
      clientX: input.start.x, clientY: input.start.y,
    }));
  }, { label: selectedLabel, start: gesture.start });
  await page.mouse.move(gesture.end.x, gesture.end.y, { steps: 8 });
  const guides = page.locator("[data-lineage-snap-guides] .lineage-snap-guide");
  await expect.poll(() => guides.count()).toBeGreaterThan(0);
  const guideData = await guides.evaluateAll((items) => items.map((item) => ({
    axis: item.getAttribute("data-axis"),
    source: item.getAttribute("data-source-anchor"),
    value: Number(item.getAttribute(item.getAttribute("data-axis") === "x" ? "x1" : "y1")),
  })));
  const live = await rootBounds(page);
  for (const guide of guideData) {
    const applied = guide.axis === "x"
      ? guide.source === "min" ? live.left : guide.source === "max" ? live.right : live.centerX
      : guide.source === "min" ? live.top : guide.source === "max" ? live.bottom : live.centerY;
    expect(Math.abs(applied - guide.value)).toBeLessThan(0.75);
  }

  await page.keyboard.down("AltLeft");
  await page.mouse.move(gesture.end.x + 0.5, gesture.end.y + 0.5);
  await expect(guides).toHaveCount(0);
  await page.keyboard.up("AltLeft");
  await page.mouse.move(gesture.end.x, gesture.end.y);
  await expect.poll(() => guides.count()).toBeGreaterThan(0);
  await page.evaluate((end) => window.dispatchEvent(new MouseEvent("mouseup", {
    bubbles: true, cancelable: true, buttons: 0, button: 0, clientX: end.x, clientY: end.y,
  })), gesture.end);
  await expect(guides).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await page.getByRole("button", { name: "Undo" }).click();
  expect((await rootBounds(page)).transform).toBe(before.transform);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

  const clean = await page.locator("#artboard svg").evaluate((root) => root.outerHTML);
  expect(clean).not.toContain("data-lineage-snap-guides");
});

test("smart-alignment preferences are discoverable, bounded, and applied immediately", async ({ page }) => {
  await openSeatify(page);
  await page.getByRole("button", { name: "Preferences and shortcuts" }).click();
  const dialog = page.locator("#shortcut-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#preference-alignment-snapping")).toBeChecked();
  await expect(dialog.locator("#preference-snap-canvas")).toBeChecked();
  await expect(dialog.locator("#preference-snap-objects")).toBeChecked();
  await expect(dialog.locator("#preference-snap-tolerance")).toHaveValue("6");
  await dialog.locator("#preference-alignment-snapping").uncheck();
  await expect(dialog.locator("#preference-snap-tolerance")).toBeDisabled();
});

test("Seatify object snapping uses projected nested geometry, truthful guides, and one atomic history entry", async ({ page }) => {
  await openSeatify(page);
  await layerButton(page, selectedLabel).click();
  const before = await rootBounds(page);
  const target = await rootBounds(page, "Venue mark");
  const pointer = await page.locator("#artboard svg").evaluate((rootNode, input) => {
    const root = rootNode as SVGSVGElement;
    const rootScreen = root.getScreenCTM();
    const node = Array.from(root.querySelectorAll<SVGGraphicsElement>("[aria-label]"))
      .find((candidate) => candidate.getAttribute("aria-label") === input.label);
    const nodeScreen = node?.getScreenCTM();
    if (!node || !nodeScreen || !rootScreen) throw new Error("The nested object snap geometry is unavailable.");
    const box = node.getBBox();
    const start = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(nodeScreen);
    const end = new DOMPoint(input.targetX, input.targetY).matrixTransform(rootScreen);
    return { start: { x: start.x, y: start.y }, end: { x: end.x + 2, y: end.y + 2 } };
  }, { label: selectedLabel, targetX: target.centerX, targetY: target.centerY });
  await page.locator("#artboard svg").evaluate((root, input) => {
    const node = Array.from(root.querySelectorAll<SVGGraphicsElement>("[aria-label]"))
      .find((candidate) => candidate.getAttribute("aria-label") === input.label);
    if (!node) throw new Error("The nested Seatify drag source is unavailable.");
    node.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true, cancelable: true, buttons: 1, button: 0,
      clientX: input.start.x, clientY: input.start.y,
    }));
  }, { label: selectedLabel, start: pointer.start });
  await page.mouse.move(pointer.end.x, pointer.end.y, { steps: 8 });
  const objectGuides = page.locator('[data-lineage-snap-guides] .lineage-snap-guide[data-target-family="object"]');
  await expect.poll(() => objectGuides.count()).toBeGreaterThan(0);
  const live = await rootBounds(page);
  const guide = objectGuides.first();
  const axis = await guide.getAttribute("data-axis");
  const source = await guide.getAttribute("data-source-anchor");
  const value = Number(await guide.getAttribute(axis === "x" ? "x1" : "y1"));
  const applied = axis === "x"
    ? source === "min" ? live.left : source === "max" ? live.right : live.centerX
    : source === "min" ? live.top : source === "max" ? live.bottom : live.centerY;
  expect(Math.abs(applied - value)).toBeLessThan(0.75);
  await page.mouse.up();
  await expect(objectGuides).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  expect((await rootBounds(page)).transform).toBe(before.transform);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
});

test("Seatify single rotation snaps the absolute root frame and responds live to Shift plus Alt", async ({ page }) => {
  await openSeatify(page);
  await layerButton(page, selectedLabel).click();
  const before = await rootBounds(page);
  const handle = page.locator(".svg_select_handle_rot");
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error("The single rotation handle is unavailable.");
  const geometry = await page.locator("#artboard svg").evaluate((rootNode, label) => {
    const root = rootNode as SVGSVGElement;
    const node = Array.from(root.querySelectorAll<SVGGraphicsElement>("[aria-label]"))
      .find((candidate) => candidate.getAttribute("aria-label") === label);
    const rootScreen = root.getScreenCTM();
    const nodeScreen = node?.getScreenCTM();
    if (!node || !rootScreen || !nodeScreen) throw new Error("The single rotation geometry is unavailable.");
    const relative = rootScreen.inverse().multiply(nodeScreen);
    const box = node.getBBox();
    const pivot = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(nodeScreen);
    return { base: Math.atan2(relative.b, relative.a) * 180 / Math.PI, pivot: { x: pivot.x, y: pivot.y } };
  }, selectedLabel);
  const start = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 };
  const delta = 11 * Math.PI / 180;
  const vector = { x: start.x - geometry.pivot.x, y: start.y - geometry.pivot.y };
  const end = {
    x: geometry.pivot.x + Math.cos(delta) * vector.x - Math.sin(delta) * vector.y,
    y: geometry.pivot.y + Math.sin(delta) * vector.x + Math.cos(delta) * vector.y,
  };
  const visibleAngle = () => page.locator("#artboard svg").evaluate((rootNode, label) => {
    const root = rootNode as SVGSVGElement;
    const node = Array.from(root.querySelectorAll<SVGGraphicsElement>("[aria-label]"))
      .find((candidate) => candidate.getAttribute("aria-label") === label);
    const rootScreen = root.getScreenCTM();
    const nodeScreen = node?.getScreenCTM();
    if (!rootScreen || !nodeScreen) throw new Error("The live rotation geometry is unavailable.");
    const relative = rootScreen.inverse().multiply(nodeScreen);
    return Math.atan2(relative.b, relative.a) * 180 / Math.PI;
  }, selectedLabel);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.keyboard.down("ShiftLeft");
  await page.mouse.move(end.x, end.y, { steps: 6 });
  expect(Math.abs((await visibleAngle()) / 15 - Math.round((await visibleAngle()) / 15))).toBeLessThan(0.02);
  await page.keyboard.down("AltLeft");
  await page.mouse.move(end.x + 0.01, end.y + 0.01);
  const free = await visibleAngle();
  expect(Math.abs(free / 15 - Math.round(free / 15))).toBeGreaterThan(0.1);
  await page.keyboard.up("AltLeft");
  await page.mouse.move(end.x, end.y);
  const resumed = await visibleAngle();
  expect(Math.abs(resumed / 15 - Math.round(resumed / 15))).toBeLessThan(0.02);
  await page.keyboard.up("ShiftLeft");
  await page.mouse.up();
  await page.getByRole("button", { name: "Undo" }).click();
  expect((await rootBounds(page)).transform).toBe(before.transform);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
});
