import { expect, test, type Page } from "@playwright/test";

const alignmentLabels = ["West north seat", "West east seat", "West south seat"];
const distributionLabels = ["West north seat", "East north seat", "Ticket accent star"];
const unrelatedLabel = "Venue caption";
const agentToken = "lineage-logo-e2e-agent-token";
const arrangementIds = [
  "align-left", "align-center", "align-right", "align-top", "align-middle", "align-bottom",
  "distribute-horizontal", "distribute-vertical", "space-horizontal", "space-vertical",
] as const;

type Bounds = { bottom: number; height: number; left: number; right: number; top: number; width: number };
type Geometry = Record<string, Bounds>;
type Axis = "horizontal" | "vertical";

async function openFixture(page: Page): Promise<void> {
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

function labeled(page: Page, label: string) {
  return page.locator(`#artboard svg [aria-label=${JSON.stringify(label)}]`);
}

function layerButton(page: Page, label: string) {
  const exact = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  return page.locator(".layer-button").filter({ has: page.locator(".layer-type + span", { hasText: exact }) });
}

async function selectLayers(page: Page, labels: string[]): Promise<void> {
  await layerButton(page, labels[0]).click();
  for (const label of labels.slice(1)) await layerButton(page, label).click({ modifiers: ["Shift"] });
  await expect.poll(() => selectedLabels(page)).toEqual([...labels].sort());
}

async function selectedLabels(page: Page): Promise<string[]> {
  return await page.locator(".layer-button[aria-pressed='true']").evaluateAll((buttons) => buttons
    .map((button) => button.querySelector(".layer-type + span")?.textContent?.trim() ?? "")
    .filter(Boolean)
    .sort());
}

async function primaryLabel(page: Page): Promise<string> {
  return await page.locator(".layer-button.selected").evaluate((button) =>
    button.querySelector(".layer-type + span")?.textContent?.trim() ?? "");
}

async function identity(page: Page): Promise<unknown> {
  return {
    inspector: await page.locator("#inspector-panel").evaluate((panel) => ({
      breadcrumb: panel.querySelector("#selection-breadcrumb")?.textContent,
      count: panel.querySelector("#selection-count-badge")?.textContent,
      name: panel.querySelector("#selection-name")?.textContent,
      positionX: (panel.querySelector("#position-x") as HTMLInputElement | null)?.value,
      positionY: (panel.querySelector("#position-y") as HTMLInputElement | null)?.value,
      summaries: Array.from(panel.querySelectorAll(".group-summary")).map((summary) => summary.textContent),
    })),
    layers: await selectedLabels(page),
    primary: await primaryLabel(page),
  };
}

async function selectionContext(page: Page): Promise<unknown> {
  const count = await page.locator("#selection-count-badge").textContent();
  return {
    inspector: await page.locator("#inspector-panel").evaluate((panel, countText) => ({
      breadcrumb: panel.querySelector("#selection-breadcrumb")?.textContent,
      count: countText,
      name: panel.querySelector("#selection-name")?.textContent,
      summaries: Array.from(panel.querySelectorAll(".group-summary")).map((summary) => summary.textContent),
    }), count),
    layers: await selectedLabels(page),
    primary: await primaryLabel(page),
  };
}

async function controls(page: Page): Promise<Record<string, boolean>> {
  return await page.locator("#undo, #redo, #reset-edits, #save-iteration").evaluateAll((items) =>
    Object.fromEntries(items.map((item) => [item.id, (item as HTMLButtonElement).disabled])));
}

async function openAlignmentGroup(page: Page): Promise<void> {
  const group = page.locator("#alignment-group");
  if (await group.getAttribute("open") === null) await group.locator(":scope > summary").click();
  await expect(group).toHaveAttribute("open", "");
}

async function geometry(page: Page, labels: string[], space: "root" | "parent" = "root"): Promise<Geometry> {
  return await page.locator("#artboard svg").evaluate((rootNode, input) => {
    const root = rootNode as SVGSVGElement;
    const nodes = input.labels.map((label) => Array.from(root.querySelectorAll<SVGGraphicsElement>("[aria-label]"))
      .find((candidate) => candidate.getAttribute("aria-label") === label));
    if (nodes.some((node) => !node)) throw new Error("Selected arrangement geometry is unavailable.");
    const parent = nodes[0]!.parentElement as unknown as SVGGraphicsElement | SVGSVGElement;
    if (input.space === "parent" && nodes.some((node) => node!.parentElement as unknown !== parent)) {
      throw new Error("Parent-space geometry requires direct siblings.");
    }
    const coordinateNode = input.space === "root" ? root : parent;
    const coordinateMatrix = coordinateNode.getCTM();
    if (!coordinateMatrix) throw new Error("Arrangement coordinate matrix is unavailable.");
    const inverse = coordinateMatrix.inverse();
    return Object.fromEntries(nodes.map((node, index) => {
      const matrix = node!.getCTM();
      if (!matrix) throw new Error(`Geometry matrix is unavailable for ${input.labels[index]}.`);
      const box = node!.getBBox();
      const relative = inverse.multiply(matrix);
      const points = [
        new DOMPoint(box.x, box.y), new DOMPoint(box.x + box.width, box.y),
        new DOMPoint(box.x, box.y + box.height), new DOMPoint(box.x + box.width, box.y + box.height),
      ].map((point) => point.matrixTransform(relative));
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      const left = Math.min(...xs);
      const right = Math.max(...xs);
      const top = Math.min(...ys);
      const bottom = Math.max(...ys);
      return [input.labels[index], { left, right, top, bottom, width: right - left, height: bottom - top }];
    }));
  }, { labels, space });
}

function expectGeometry(actual: Geometry, expected: Geometry, precision = 5): void {
  for (const label of Object.keys(expected)) {
    for (const property of ["left", "right", "top", "bottom", "width", "height"] as const) {
      expect(actual[label][property], `${label} ${property}`).toBeCloseTo(expected[label][property], precision);
    }
  }
}

async function marqueeDistributionTargets(page: Page): Promise<void> {
  for (const label of distributionLabels) {
    const target = labeled(page, label);
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
    if (label !== distributionLabels[0]) await page.keyboard.down("ShiftLeft");
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
    if (label !== distributionLabels[0]) await page.keyboard.up("ShiftLeft");
    await page.keyboard.up("ControlLeft");
  }
  await expect.poll(() => selectedLabels(page)).toEqual([...distributionLabels].sort());
  expect(await primaryLabel(page)).toBe(distributionLabels.at(-1));
}

async function selectDistributionTargets(page: Page): Promise<void> {
  await layerButton(page, "Venue logo").click();
  await marqueeDistributionTargets(page);
}

async function exactOneCheckpoint(
  page: Page,
  before: Geometry,
  after: Geometry,
  beforeIdentity: unknown,
  afterIdentity: unknown,
  readGeometry: () => Promise<Geometry>,
): Promise<void> {
  expect(await controls(page)).toEqual({ redo: true, "reset-edits": false, "save-iteration": false, undo: false });
  await page.getByRole("button", { name: "Undo" }).click();
  expectGeometry(await readGeometry(), before);
  expect(await identity(page)).toEqual(beforeIdentity);
  expect(await controls(page)).toEqual({ redo: false, "reset-edits": true, "save-iteration": true, undo: true });
  await page.getByRole("button", { name: "Redo" }).click();
  expectGeometry(await readGeometry(), after);
  expect(await identity(page)).toEqual(afterIdentity);
  expect(await controls(page)).toEqual({ redo: true, "reset-edits": false, "save-iteration": false, undo: false });
}

test.beforeEach(async ({ page }) => openFixture(page));

const alignments = [
  { id: "align-left", direction: "left" },
  { id: "align-center", direction: "center" },
  { id: "align-right", direction: "right" },
  { id: "align-top", direction: "top" },
  { id: "align-middle", direction: "middle" },
  { id: "align-bottom", direction: "bottom" },
] as const;

for (const action of alignments) {
  test(`multi-selection arrangement ${action.direction} alignment is exact and atomic`, async ({ page }) => {
    await selectLayers(page, alignmentLabels);
    await openAlignmentGroup(page);
    const labels = [...alignmentLabels, unrelatedLabel];
    const beforeParent = await geometry(page, alignmentLabels, "parent");
    const beforeRoot = await geometry(page, labels);
    const unrelatedBefore = await geometry(page, [unrelatedLabel]);
    const beforeIdentity = await identity(page);
    const beforeContext = await selectionContext(page);
    const left = Math.min(...alignmentLabels.map((label) => beforeParent[label].left));
    const right = Math.max(...alignmentLabels.map((label) => beforeParent[label].right));
    const top = Math.min(...alignmentLabels.map((label) => beforeParent[label].top));
    const bottom = Math.max(...alignmentLabels.map((label) => beforeParent[label].bottom));
    await expect(page.locator(`#${action.id}`)).toBeEnabled();
    await page.locator(`#${action.id}`).click();
    const afterParent = await geometry(page, alignmentLabels, "parent");
    for (const label of alignmentLabels) {
      const box = afterParent[label];
      if (action.direction === "left") expect(box.left).toBeCloseTo(left, 5);
      if (action.direction === "center") expect((box.left + box.right) / 2).toBeCloseTo((left + right) / 2, 5);
      if (action.direction === "right") expect(box.right).toBeCloseTo(right, 5);
      if (action.direction === "top") expect(box.top).toBeCloseTo(top, 5);
      if (action.direction === "middle") expect((box.top + box.bottom) / 2).toBeCloseTo((top + bottom) / 2, 5);
      if (action.direction === "bottom") expect(box.bottom).toBeCloseTo(bottom, 5);
    }
    expectGeometry(await geometry(page, [unrelatedLabel]), unrelatedBefore);
    const afterIdentity = await identity(page);
    expect(await selectionContext(page)).toEqual(beforeContext);
    const afterRoot = await geometry(page, labels);
    await exactOneCheckpoint(page, beforeRoot, afterRoot, beforeIdentity, afterIdentity, () => geometry(page, labels));
  });
}

const distributions = [
  { axis: "horizontal", gaps: false, id: "distribute-horizontal" },
  { axis: "vertical", gaps: false, id: "distribute-vertical" },
  { axis: "horizontal", gaps: true, id: "space-horizontal" },
  { axis: "vertical", gaps: true, id: "space-vertical" },
] as const;

for (const action of distributions) {
  test(`multi-selection arrangement ${action.id} keeps deterministic outer anchors and one checkpoint`, async ({ page }) => {
    await selectDistributionTargets(page);
    await openAlignmentGroup(page);
    const labels = [...distributionLabels, unrelatedLabel];
    const before = await geometry(page, labels);
    const beforeIdentity = await identity(page);
    const beforeContext = await selectionContext(page);
    const start = (box: Bounds, axis: Axis) => axis === "horizontal" ? box.left : box.top;
    const end = (box: Bounds, axis: Axis) => axis === "horizontal" ? box.right : box.bottom;
    const center = (box: Bounds, axis: Axis) => (start(box, axis) + end(box, axis)) / 2;
    const ordered = distributionLabels.map((label, index) => ({ box: before[label], index, label }))
      .sort((left, right) => (action.gaps
        ? start(left.box, action.axis) - start(right.box, action.axis)
        : center(left.box, action.axis) - center(right.box, action.axis)) || left.index - right.index);
    await expect(page.locator(`#${action.id}`)).toBeEnabled();
    await page.locator(`#${action.id}`).click();
    const after = await geometry(page, labels);
    expectGeometry({ [ordered[0].label]: after[ordered[0].label] }, { [ordered[0].label]: before[ordered[0].label] });
    expectGeometry({ [ordered[2].label]: after[ordered[2].label] }, { [ordered[2].label]: before[ordered[2].label] });
    expectGeometry({ [unrelatedLabel]: after[unrelatedLabel] }, { [unrelatedLabel]: before[unrelatedLabel] });
    if (action.gaps) {
      const firstGap = start(after[ordered[1].label], action.axis) - end(after[ordered[0].label], action.axis);
      const secondGap = start(after[ordered[2].label], action.axis) - end(after[ordered[1].label], action.axis);
      expect(Math.abs(firstGap - secondGap)).toBeLessThanOrEqual(1e-4);
    } else {
      const firstStep = center(after[ordered[1].label], action.axis) - center(after[ordered[0].label], action.axis);
      const secondStep = center(after[ordered[2].label], action.axis) - center(after[ordered[1].label], action.axis);
      expect(Math.abs(firstStep - secondStep)).toBeLessThanOrEqual(1e-4);
    }
    const afterIdentity = await identity(page);
    expect(await selectionContext(page)).toEqual(beforeContext);
    await exactOneCheckpoint(page, before, after, beforeIdentity, afterIdentity, () => geometry(page, labels));
  });
}

test("multi-selection arrangement already-even distribution is an exact transform-syntax no-op", async ({ page }) => {
  const labels = ["West north seat", "West table", "West south seat"];
  await selectLayers(page, labels);
  await openAlignmentGroup(page);
  const before = await geometry(page, labels, "parent");
  const beforeIdentity = await identity(page);
  const transforms = async () => page.locator("#artboard svg").evaluate((root, targetLabels) => Object.fromEntries(targetLabels.map((label) => {
    const node = Array.from(root.querySelectorAll("[aria-label]")).find((candidate) => candidate.getAttribute("aria-label") === label);
    return [label, node?.getAttribute("transform") ?? null];
  })), labels);
  const beforeTransforms = await transforms();
  const beforeControls = await controls(page);
  await page.locator("#distribute-horizontal").click();
  await expect(page.locator("#status")).toHaveText("The selected centers are already distributed");
  expectGeometry(await geometry(page, labels, "parent"), before);
  expect(await transforms()).toEqual(beforeTransforms);
  expect(await identity(page)).toEqual(beforeIdentity);
  expect(await controls(page)).toEqual(beforeControls);
});

test("multi-selection arrangement rejects mixed-parent alignment without partial mutation", async ({ page }) => {
  await selectDistributionTargets(page);
  const before = await geometry(page, distributionLabels);
  const beforeIdentity = await identity(page);
  const beforeControls = await controls(page);
  for (const id of arrangementIds.slice(0, 6)) {
    await expect(page.locator(`#${id}`)).toBeDisabled();
    await expect(page.locator(`#${id}`)).toHaveAttribute("title", /same parent/i);
  }
  expectGeometry(await geometry(page, distributionLabels), before);
  expect(await identity(page)).toEqual(beforeIdentity);
  expect(await controls(page)).toEqual(beforeControls);
});

test("multi-selection arrangement rejects locked and hidden members all-or-nothing", async ({ page }) => {
  await layerButton(page, "East north seat").click();
  await page.locator("#lock-selection").click();
  await selectDistributionTargets(page);
  let before = await geometry(page, distributionLabels);
  let beforeIdentity = await identity(page);
  for (const id of arrangementIds.slice(0, 6)) {
    await expect(page.locator(`#${id}`)).toBeDisabled();
    await expect(page.locator(`#${id}`)).toHaveAttribute("title", /same parent/i);
  }
  for (const id of arrangementIds.slice(6)) {
    await expect(page.locator(`#${id}`)).toBeDisabled();
    await expect(page.locator(`#${id}`)).toHaveAttribute("title", /unlock/i);
  }
  expectGeometry(await geometry(page, distributionLabels), before);
  expect(await identity(page)).toEqual(beforeIdentity);
  expect(await controls(page)).toEqual({ redo: true, "reset-edits": false, "save-iteration": true, undo: true });

  await page.getByRole("button", { name: "Reset edits" }).click();
  await selectDistributionTargets(page);
  await page.getByRole("button", { exact: true, name: "Hide East north seat" }).click();
  before = await geometry(page, distributionLabels);
  beforeIdentity = await identity(page);
  for (const id of arrangementIds.slice(0, 6)) {
    await expect(page.locator(`#${id}`)).toBeDisabled();
    await expect(page.locator(`#${id}`)).toHaveAttribute("title", /same parent/i);
  }
  for (const id of arrangementIds.slice(6)) {
    await expect(page.locator(`#${id}`)).toBeDisabled();
    await expect(page.locator(`#${id}`)).toHaveAttribute("title", /show every selected layer/i);
  }
  expectGeometry(await geometry(page, distributionLabels), before);
  expect(await identity(page)).toEqual(beforeIdentity);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { exact: true, name: "Hide East north seat" })).toBeVisible();
  expect(await controls(page)).toEqual({ redo: false, "reset-edits": true, "save-iteration": true, undo: true });
});

test("multi-selection arrangement is disabled during pending review and Revert is exact", async ({ page }) => {
  await selectDistributionTargets(page);
  const before = await geometry(page, distributionLabels);
  const beforeIdentity = await identity(page);
  const manifest = await page.request.get("/api/agent/document", { headers: { Authorization: `Bearer ${agentToken}` } }).then((response) => response.json());
  const venue = manifest.layers.find((layer: { name: string; sessionKey: string }) => layer.name === unrelatedLabel);
  if (!venue) throw new Error("Venue caption is absent from the producer manifest.");
  const transactionId = `arrangement-${Date.now()}`;
  const queued = await page.request.post("/api/agent/transactions", {
    data: {
      protocolVersion: 1,
      transactionId,
      producer: { kind: "test", name: "Arrangement QA" },
      document: { sessionId: manifest.sessionId, sourcePath: manifest.sourcePath, baseRevision: manifest.revision },
      operations: [{ type: "renameLayer", operationId: "rename-venue", target: { sessionKey: venue.sessionKey }, name: "Arrangement proposal" }],
    },
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  expect(queued.status()).toBe(202);
  await expect(page.locator("#agent-review-status")).toHaveAttribute("data-status", "pending");
  for (const id of arrangementIds) await expect(page.locator(`#${id}`)).toBeDisabled();
  await expect(page.locator("#alignment-reason")).toContainText("pending agent transaction");
  expectGeometry(await geometry(page, distributionLabels), before);
  expect(await identity(page)).toEqual(beforeIdentity);
  expect(await controls(page)).toEqual({ redo: true, "reset-edits": true, "save-iteration": true, undo: true });
  await page.getByRole("button", { name: "Revert" }).click();
  await expect(page.locator("#agent-review-status")).toHaveAttribute("data-status", "reverted");
  expectGeometry(await geometry(page, distributionLabels), before);
  expect(await identity(page)).toEqual(beforeIdentity);
  expect(await controls(page)).toEqual({ redo: true, "reset-edits": true, "save-iteration": true, undo: true });
});

test("multi-selection arrangement works at 125% zoom with both sidebars collapsed", async ({ page }) => {
  await page.locator("#zoom-in").click();
  await expect(page.locator("#zoom-label")).toHaveText("125%");
  await page.locator("#toggle-left-sidebar").click();
  await page.locator("#toggle-right-sidebar").click();
  await expect(page.locator("#toggle-left-sidebar")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#toggle-right-sidebar")).toHaveAttribute("aria-expanded", "false");
  await marqueeDistributionTargets(page);
  const beforeContext = await selectionContext(page);
  expect(beforeContext).toMatchObject({
    inspector: { count: "3 objects selected", name: "3 layers" },
    layers: [...distributionLabels].sort(),
    primary: distributionLabels.at(-1),
  });
  const before = await geometry(page, distributionLabels);
  await page.keyboard.press("ArrowRight");
  const moved = await geometry(page, distributionLabels);
  for (const label of distributionLabels) {
    expect(moved[label].left - before[label].left).toBeCloseTo(1, 5);
    expect(moved[label].top - before[label].top).toBeCloseTo(0, 5);
  }
  expect(await selectionContext(page)).toEqual(beforeContext);
  await page.locator("#toggle-right-sidebar").click();
  await expect(page.locator("#toggle-right-sidebar")).toHaveAttribute("aria-expanded", "true");
  expect(await selectedLabels(page)).toEqual([...distributionLabels].sort());
  await openAlignmentGroup(page);
  const beforeArrange = await geometry(page, distributionLabels);
  await page.locator("#distribute-horizontal").click();
  const arranged = await geometry(page, distributionLabels);
  expect(await selectionContext(page)).toEqual(beforeContext);
  await page.getByRole("button", { name: "Undo" }).click();
  expectGeometry(await geometry(page, distributionLabels), beforeArrange);
  expect(arranged).not.toEqual(beforeArrange);
  expect(await selectedLabels(page)).toEqual([...distributionLabels].sort());
  expect(await selectionContext(page)).toEqual(beforeContext);
});

test("multi-selection arrangement named Save preserves exact authored structure outside target transforms", async ({ page }) => {
  const sourceResponse = await page.request.get("/api/svg?path=concepts%2Fcomplex-seatify.svg");
  expect(sourceResponse.ok()).toBe(true);
  const source = await sourceResponse.text();
  await selectDistributionTargets(page);
  await openAlignmentGroup(page);
  await page.locator("#distribute-horizontal").click();
  const liveTransforms = await page.locator("#artboard svg").evaluate((root, targetLabels) => Object.fromEntries(targetLabels.map((label) => {
    const node = Array.from(root.querySelectorAll<SVGGraphicsElement>("[aria-label]"))
      .find((candidate) => candidate.getAttribute("aria-label") === label);
    if (!node?.id) throw new Error(`Live transform target is unavailable for ${label}.`);
    return [node.id, node.getAttribute("transform")];
  })), distributionLabels);
  await page.getByRole("button", { name: "Save iteration" }).click();
  await expect(page.locator("#status")).toHaveText(/^Saved iterations\/iteration-\d+\.svg$/);
  const savedPath = (await page.locator("#status").textContent())?.replace(/^Saved /, "");
  if (!savedPath) throw new Error("The named Save result path is unavailable.");
  const savedResponse = await page.request.get(`/api/svg?path=${encodeURIComponent(savedPath)}`);
  expect(savedResponse.ok()).toBe(true);
  const saved = await savedResponse.text();
  const comparison = await page.evaluate(({ sourceSvg, savedSvg, targetLabels }) => {
    const parse = (markup: string) => new DOMParser().parseFromString(markup, "image/svg+xml");
    const sourceDocument = parse(sourceSvg);
    const savedDocument = parse(savedSvg);
    if (sourceDocument.querySelector("parsererror") || savedDocument.querySelector("parsererror")) throw new Error("Saved SVG parsing failed.");
    const targetIds = new Set(Array.from(sourceDocument.querySelectorAll("[aria-label]"))
      .filter((node) => targetLabels.includes(node.getAttribute("aria-label") ?? ""))
      .map((node) => node.id));
    const authoredRootAttributes = new Set(Array.from(sourceDocument.documentElement.attributes).map((attribute) => attribute.name));
    const snapshot = (documentNode: Document) => [documentNode.documentElement, ...Array.from(documentNode.documentElement.querySelectorAll("*"))]
      .map((node) => ({
        attributes: Array.from(node.attributes)
          .filter((attribute) => !(targetIds.has(node.id) && attribute.name === "transform"))
          .filter((attribute) => node !== documentNode.documentElement || authoredRootAttributes.has(attribute.name))
          .map((attribute) => [attribute.name, attribute.value]),
        childElements: Array.from(node.children).map((child) => child.localName),
        localName: node.localName,
        text: Array.from(node.childNodes).filter((child) => child.nodeType === Node.TEXT_NODE).map((child) => child.textContent).join(""),
      }));
    const transforms = (documentNode: Document) => Object.fromEntries(Array.from(targetIds).map((id) => [id, documentNode.getElementById(id)?.getAttribute("transform") ?? null]));
    const savedRootAdditions = Array.from(savedDocument.documentElement.attributes)
      .filter((attribute) => !authoredRootAttributes.has(attribute.name))
      .map((attribute) => [attribute.name, attribute.value]);
    return { savedRootAdditions, savedSnapshot: snapshot(savedDocument), savedTransforms: transforms(savedDocument), sourceSnapshot: snapshot(sourceDocument), sourceTransforms: transforms(sourceDocument), targetIds: Array.from(targetIds) };
  }, { sourceSvg: source, savedSvg: saved, targetLabels: distributionLabels });
  expect(comparison.targetIds).toHaveLength(distributionLabels.length);
  expect(comparison.savedRootAdditions).toEqual([
    ["xmlns:xlink", "http://www.w3.org/1999/xlink"],
    ["version", "1.1"],
  ]);
  expect(comparison.savedSnapshot).toEqual(comparison.sourceSnapshot);
  expect(comparison.savedTransforms).toEqual(liveTransforms);
  expect(Object.entries(comparison.savedTransforms).some(([id, value]) => value !== comparison.sourceTransforms[id])).toBe(true);
  expect(saved).not.toMatch(/data-(?:lineage|agent|review|transport)-|lineage-logo-edit|transactionId|agent-token/i);
});
