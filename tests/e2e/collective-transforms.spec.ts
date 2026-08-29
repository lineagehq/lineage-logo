import { expect, test, type Page } from "@playwright/test";

const labels = ["West north seat", "East north seat", "Ticket accent star"];
const agentToken = "lineage-logo-e2e-agent-token";

type Point = { x: number; y: number };
type Shape = { bottom: number; height: number; left: number; points: Point[]; right: number; top: number; width: number };
type Geometry = Record<string, Shape>;

async function openFixture(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page).toHaveURL(/^http:\/\/marquee-qa\.localhost:/);
  await page.getByRole("button", { name: "complex-seatify" }).click();
  await expect(page.locator("#artboard svg[aria-label='Complex Seatify venue logo']")).toBeVisible();
  await expect.poll(async () => {
    const response = await page.request.get("/api/agent/document", { headers: { Authorization: `Bearer ${agentToken}` } });
    return response.ok() ? (await response.json()).sourcePath : undefined;
  }).toBe("concepts/complex-seatify.svg");
}

function labeled(page: Page, label: string) {
  return page.locator(`#artboard svg [aria-label=${JSON.stringify(label)}]`);
}

function layerButton(page: Page, label: string) {
  const exact = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  return page.locator(".layer-button").filter({ has: page.locator(".layer-type + span", { hasText: exact }) });
}

async function marquee(page: Page, label: string, additive: boolean): Promise<void> {
  const target = labeled(page, label);
  await target.scrollIntoViewIfNeeded();
  const [box, stage] = await Promise.all([target.boundingBox(), page.locator("#stage").boundingBox()]);
  if (!box || !stage) throw new Error(`Live marquee geometry is unavailable for ${label}.`);
  const padding = Math.min(box.width, box.height) * 0.08;
  const start = { x: box.x - padding, y: box.y - padding };
  const end = { x: box.x + box.width + padding, y: box.y + box.height + padding };
  await page.mouse.move(start.x, start.y);
  await page.keyboard.down("ControlLeft");
  if (additive) await page.keyboard.down("ShiftLeft");
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  if (additive) await page.keyboard.up("ShiftLeft");
  await page.keyboard.up("ControlLeft");
}

async function selectLayers(page: Page, ordered: string[], expectOverlay = true): Promise<void> {
  await marquee(page, ordered[0], false);
  for (const label of ordered.slice(1)) await marquee(page, label, true);
  await expect.poll(async () => await page.locator(".layer-button[aria-pressed='true'] .layer-type + span").allTextContents())
    .toEqual(expect.arrayContaining(labels));
  await expect(page.locator("[data-lineage-collective-transform]")).toHaveCount(expectOverlay ? 1 : 0);
  if (expectOverlay) await expect(page.locator("[data-lineage-collective-handle]:not([data-lineage-collective-handle='rotation'])")).toHaveCount(8);
}

async function selectionIdentity(page: Page): Promise<unknown> {
  return {
    labels: (await page.locator(".layer-button[aria-pressed='true'] .layer-type + span").allTextContents()).sort(),
    primary: await page.locator(".layer-button.selected .layer-type + span").textContent(),
    summary: await page.locator("#selection-name").textContent(),
  };
}

async function geometry(page: Page): Promise<Geometry> {
  return await page.locator("#artboard svg").evaluate((rootNode, targetLabels) => {
    const root = rootNode as SVGSVGElement;
    const rootMatrix = root.getCTM();
    if (!rootMatrix) throw new Error("Root matrix is unavailable.");
    const rootInverse = rootMatrix.inverse();
    return Object.fromEntries(targetLabels.map((label) => {
      const node = Array.from(root.querySelectorAll<SVGGraphicsElement>("[aria-label]"))
        .find((candidate) => candidate.getAttribute("aria-label") === label);
      const matrix = node?.getCTM();
      if (!node || !matrix) throw new Error(`Geometry is unavailable for ${label}.`);
      const box = node.getBBox();
      const relative = rootInverse.multiply(matrix);
      const points = [
        new DOMPoint(box.x, box.y), new DOMPoint(box.x + box.width, box.y),
        new DOMPoint(box.x, box.y + box.height), new DOMPoint(box.x + box.width, box.y + box.height),
      ].map((point) => point.matrixTransform(relative)).map(({ x, y }) => ({ x, y }));
      const xs = points.map(({ x }) => x);
      const ys = points.map(({ y }) => y);
      const left = Math.min(...xs); const right = Math.max(...xs);
      const top = Math.min(...ys); const bottom = Math.max(...ys);
      return [label, { points, left, right, top, bottom, width: right - left, height: bottom - top }];
    }));
  }, labels);
}

async function transforms(page: Page): Promise<Record<string, string | null>> {
  return await page.locator("#artboard svg").evaluate((root, targetLabels) => Object.fromEntries(targetLabels.map((label) => {
    const node = Array.from(root.querySelectorAll<SVGGraphicsElement>("[aria-label]"))
      .find((candidate) => candidate.getAttribute("aria-label") === label);
    return [label, node?.getAttribute("transform") ?? null];
  })), labels);
}

function bounds(points: Point[]): Omit<Shape, "points"> {
  const xs = points.map(({ x }) => x); const ys = points.map(({ y }) => y);
  const left = Math.min(...xs); const right = Math.max(...xs);
  const top = Math.min(...ys); const bottom = Math.max(...ys);
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

function expectGeometry(actual: Geometry, expected: Geometry): void {
  for (const label of labels) {
    for (const key of ["left", "right", "top", "bottom", "width", "height"] as const) {
      expect(actual[label][key], `${label} ${key}`).toBeCloseTo(expected[label][key], 3);
    }
  }
}

async function rootPoint(page: Page, point: Point): Promise<Point> {
  return await page.locator("#artboard svg").evaluate((root, screen) => {
    const matrix = (root as SVGSVGElement).getScreenCTM();
    if (!matrix) throw new Error("Root screen matrix is unavailable.");
    return new DOMPoint(screen.x, screen.y).matrixTransform(matrix.inverse());
  }, point);
}

test.beforeEach(async ({ page }) => openFixture(page));

test("collective transform shared resize is exact, atomic, cancellable, and clean", async ({ page }) => {
  await selectLayers(page, labels);
  await expect(page.locator(".layer-button.selected .layer-type + span")).toHaveText("Ticket accent star");
  const before = await geometry(page);
  const beforeIdentity = await selectionIdentity(page);
  const union = bounds(Object.values(before).flatMap(({ points }) => points));
  const handle = page.locator('[data-lineage-collective-handle="rb"]');
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error("Collective resize handle is unavailable.");
  const start = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 };

  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 2, start.y + 1); await page.mouse.up();
  expectGeometry(await geometry(page), before);
  expect(await selectionIdentity(page)).toEqual(beforeIdentity);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 25, start.y + 20, { steps: 4 });
  await page.keyboard.press("Escape"); await page.mouse.up();
  expectGeometry(await geometry(page), before);
  expect(await selectionIdentity(page)).toEqual(beforeIdentity);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 25, start.y + 20, { steps: 4 });
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 })));
  await page.mouse.up();
  expectGeometry(await geometry(page), before);
  expect(await selectionIdentity(page)).toEqual(beforeIdentity);

  const end = { x: start.x + 42, y: start.y + 30 };
  const endRoot = await rootPoint(page, end);
  const factor = Math.max((Math.round(endRoot.x) - union.left) / union.width, (Math.round(endRoot.y) - union.top) / union.height);
  const expected = Object.fromEntries(labels.map((label) => {
    const points = before[label].points.map(({ x, y }) => ({ x: union.left + (x - union.left) * factor, y: union.top + (y - union.top) * factor }));
    return [label, { points, ...bounds(points) }];
  }));
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 8 }); await page.mouse.up();
  const after = await geometry(page);
  expectGeometry(after, expected);
  expect(await selectionIdentity(page)).toEqual(beforeIdentity);
  await page.getByRole("button", { name: "Undo" }).click(); expectGeometry(await geometry(page), before);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await page.getByRole("button", { name: "Redo" }).click(); expectGeometry(await geometry(page), after);
  expect(await selectionIdentity(page)).toEqual(beforeIdentity);
});

test("collective transform shared rotation uses the frozen union pivot with a different primary", async ({ page }) => {
  await selectLayers(page, ["Ticket accent star", "East north seat", "West north seat"]);
  await expect(page.locator(".layer-button.selected .layer-type + span")).toHaveText("West north seat");
  const before = await geometry(page);
  const union = bounds(Object.values(before).flatMap(({ points }) => points));
  const pivot = { x: (union.left + union.right) / 2, y: (union.top + union.bottom) / 2 };
  const handle = page.locator('[data-lineage-collective-handle="rotation"]');
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error("Collective rotation handle is unavailable.");
  const start = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 };
  const pivotScreen = await page.locator("#artboard svg").evaluate((root, rootPivot) => {
    const matrix = (root as SVGSVGElement).getScreenCTM();
    if (!matrix) throw new Error("Root screen matrix is unavailable.");
    return new DOMPoint(rootPivot.x, rootPivot.y).matrixTransform(matrix);
  }, pivot);
  const end = { x: pivotScreen.x + (start.y - pivotScreen.y), y: pivotScreen.y - (start.x - pivotScreen.x) };
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 10 }); await page.mouse.up();
  const radians = -Math.PI / 2;
  const expected = Object.fromEntries(labels.map((label) => {
    const points = before[label].points.map(({ x, y }) => ({
      x: pivot.x + Math.cos(radians) * (x - pivot.x) - Math.sin(radians) * (y - pivot.y),
      y: pivot.y + Math.sin(radians) * (x - pivot.x) + Math.cos(radians) * (y - pivot.y),
    }));
    return [label, { points, ...bounds(points) }];
  }));
  const after = await geometry(page);
  expectGeometry(after, expected);
  await page.getByRole("button", { name: "Undo" }).click(); expectGeometry(await geometry(page), before);
  await page.getByRole("button", { name: "Redo" }).click(); expectGeometry(await geometry(page), after);
});

test("collective transform remains operable at 125% with both sidebars collapsed and reloads a clean named save", async ({ page }) => {
  await page.locator("#zoom-in").click();
  await expect(page.locator("#zoom-label")).toHaveText("125%");
  await page.locator("#toggle-left-sidebar").click();
  await page.locator("#toggle-right-sidebar").click();
  await expect(page.locator("#toggle-left-sidebar")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#toggle-right-sidebar")).toHaveAttribute("aria-expanded", "false");
  await selectLayers(page, labels);
  const identity = await selectionIdentity(page);
  const before = await geometry(page);
  const handle = page.locator('[data-lineage-collective-handle="rb"]');
  const box = await handle.boundingBox();
  if (!box) throw new Error("Zoomed collective resize handle is unavailable.");
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 36, start.y + 24, { steps: 8 }); await page.mouse.up();
  const resized = await geometry(page);
  expect(resized).not.toEqual(before);
  expect(await selectionIdentity(page)).toEqual(identity);

  const rotation = page.locator('[data-lineage-collective-handle="rotation"]');
  const rotationBox = await rotation.boundingBox();
  if (!rotationBox) throw new Error("Zoomed collective rotation handle is unavailable.");
  const rotationStart = { x: rotationBox.x + rotationBox.width / 2, y: rotationBox.y + rotationBox.height / 2 };
  const resizedUnion = bounds(Object.values(resized).flatMap(({ points }) => points));
  const pivot = { x: (resizedUnion.left + resizedUnion.right) / 2, y: (resizedUnion.top + resizedUnion.bottom) / 2 };
  const pivotScreen = await page.locator("#artboard svg").evaluate((root, rootPivot) => {
    const matrix = (root as SVGSVGElement).getScreenCTM();
    if (!matrix) throw new Error("Zoomed root screen matrix is unavailable.");
    return new DOMPoint(rootPivot.x, rootPivot.y).matrixTransform(matrix);
  }, pivot);
  const rotationEnd = { x: pivotScreen.x + (rotationStart.y - pivotScreen.y), y: pivotScreen.y - (rotationStart.x - pivotScreen.x) };
  await page.mouse.move(rotationStart.x, rotationStart.y); await page.mouse.down(); await page.mouse.move(rotationEnd.x, rotationEnd.y, { steps: 8 }); await page.mouse.up();
  const after = await geometry(page);
  expect(after).not.toEqual(resized);
  expect(await selectionIdentity(page)).toEqual(identity);

  let savedSvg = "";
  const savedPath = "iterations/collective-transform-e2e.svg";
  await page.route("**/api/iterations", async (route) => {
    savedSvg = (JSON.parse(route.request().postData() ?? "{}") as { svg?: string }).svg ?? "";
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({
      file: { collection: "iterations", name: "collective-transform-e2e.svg", path: savedPath },
      nextIterationPath: "iterations/iteration-1.svg",
    }) });
  });
  await page.route("**/api/workspace", async (route) => {
    const response = await route.fetch();
    const workspace = await response.json() as { files: Array<{ collection: string; name: string; path: string }> };
    workspace.files.push({ collection: "iterations", name: "collective-transform-e2e.svg", path: savedPath });
    await route.fulfill({ response, json: workspace });
  });
  await page.route(`**/api/svg?path=${encodeURIComponent(savedPath)}`, async (route) => {
    await route.fulfill({ status: 200, contentType: "image/svg+xml", body: savedSvg });
  });
  await page.getByRole("button", { name: "Save iteration" }).click();
  await expect(page.locator("#status")).toHaveText(`Saved ${savedPath}`);
  expect(savedSvg).not.toMatch(/data-(?:lineage|agent|review|transport)-|lineage-collective|svg_select|selection-halo/i);
  expect(savedSvg).toContain("Ticket accent star");
  expectGeometry(await geometry(page), after);
});

test("collective controls reject locked, hidden, and pending-Agent selections without partial geometry", async ({ page }) => {
  await layerButton(page, labels[0]).click();
  await page.locator("#lock-selection").click();
  await layerButton(page, "Venue logo").click();
  await selectLayers(page, labels, false);
  const locked = await geometry(page);
  await expect(page.locator("#inspector-panel")).toContainText(/Unlock every selected layer/);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

  await layerButton(page, labels[0]).click();
  await page.locator("#lock-selection").click();
  await layerButton(page, "Venue logo").click();
  await selectLayers(page, labels);
  const authoredTransforms = await transforms(page);
  await page.getByRole("button", { exact: true, name: `Hide ${labels[2]}` }).click();
  await expect(page.locator("[data-lineage-collective-transform]")).toHaveCount(0);
  expect(await transforms(page)).toEqual(authoredTransforms);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator("[data-lineage-collective-transform]")).toHaveCount(1);

  const manifestResponse = await page.request.get("/api/agent/document", { headers: { Authorization: `Bearer ${agentToken}` } });
  const manifest = await manifestResponse.json() as { layers: Array<{ name: string; sessionKey: string }>; revision: number; sessionId: string; sourcePath: string };
  const target = manifest.layers.find((layer) => layer.name === labels[2]);
  if (!target) throw new Error("Agent rejection target is unavailable.");
  const transactionId = `collective-transform-${Date.now()}`;
  const queued = await page.request.post("/api/agent/transactions", {
    headers: { Authorization: `Bearer ${agentToken}` },
    data: {
      protocolVersion: 1, transactionId,
      producer: { kind: "test", name: "Collective transform QA" },
      document: { sessionId: manifest.sessionId, sourcePath: manifest.sourcePath, baseRevision: manifest.revision },
      operations: [{ type: "renameLayer", operationId: "rename", target: { sessionKey: target.sessionKey }, name: "Pending transform target" }],
    },
  });
  expect(queued.status()).toBe(202);
  await expect(page.locator("#agent-review-status")).toHaveAttribute("data-status", "pending");
  await expect(page.locator("[data-lineage-collective-transform]")).toHaveCount(0);
  expect(await transforms(page)).toEqual(authoredTransforms);
  await page.getByRole("button", { name: "Revert" }).click();
  await expect(page.locator("#agent-review-status")).toHaveAttribute("data-status", "reverted");
  await expect(page.locator("[data-lineage-collective-transform]")).toHaveCount(1);
});
