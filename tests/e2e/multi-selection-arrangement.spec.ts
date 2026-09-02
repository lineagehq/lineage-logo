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
  await page.locator('[data-path="concepts/complex-seatify.svg"]').click();
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

async function transformAttributes(page: Page, labels: string[]): Promise<Record<string, string | null>> {
  return await page.locator("#artboard svg").evaluate((root, targetLabels) => Object.fromEntries(targetLabels.map((label) => {
    const node = Array.from(root.querySelectorAll<SVGGraphicsElement>("[aria-label]"))
      .find((candidate) => candidate.getAttribute("aria-label") === label);
    if (!node) throw new Error(`Transform target is unavailable for ${label}.`);
    return [label, node.getAttribute("transform")];
  })), labels);
}

async function authoredGeometryFingerprint(
  page: Page,
  targetLabels = [...alignmentLabels, unrelatedLabel, "Seatify wordmark"],
): Promise<unknown> {
  return await page.locator("#artboard svg").evaluate((root, labels) => Object.fromEntries(labels.map((label) => {
    const node = Array.from(root.querySelectorAll<SVGGraphicsElement>("[aria-label]"))
      .find((candidate) => candidate.getAttribute("aria-label") === label);
    if (!node) throw new Error(`Authored geometry target is unavailable for ${label}.`);
    const attributes = (element: Element) => Array.from(element.attributes)
      .filter((attribute) => !attribute.name.startsWith("data-lineage-"))
      .map((attribute) => [attribute.name, attribute.value] as const)
      .sort(([left], [right]) => left.localeCompare(right));
    const ancestorTransforms: Array<{ attributes: readonly (readonly [string, string])[]; localName: string }> = [];
    for (let ancestor = node.parentElement; ancestor && ancestor !== root; ancestor = ancestor.parentElement) {
      if (ancestor.hasAttribute("transform")) ancestorTransforms.push({ attributes: attributes(ancestor), localName: ancestor.localName });
    }
    return [label, {
      ancestorTransforms,
      attributes: attributes(node),
      localName: node.localName,
      text: node.textContent,
    }];
  })), targetLabels);
}

async function numericValues(page: Page): Promise<Record<string, number>> {
  const ids = ["position-x", "position-y", "position-width", "position-height", "rotation"];
  return Object.fromEntries(await Promise.all(ids.map(async (id) => [id, Number(await page.locator(`#${id}`).inputValue())])));
}

async function expectNumericAvailability(page: Page, enabled: boolean, reason?: RegExp): Promise<void> {
  for (const id of ["position-x", "position-y", "position-width", "position-height", "rotation", "aspect-lock"]) {
    if (enabled) await expect(page.locator(`#${id}`)).toBeEnabled();
    else await expect(page.locator(`#${id}`)).toBeDisabled();
  }
  if (reason) await expect(page.locator("#geometry-mode")).toHaveText(reason);
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

test("Seatify numeric oriented-frame edits are aggregate, validated, and atomic", async ({ page }) => {
  await selectLayers(page, alignmentLabels);
  const geometryGroup = page.locator("#geometry-group");
  await geometryGroup.locator(":scope > summary").click();
  await expect(geometryGroup).toHaveAttribute("open", "");
  await expect(page.locator("#geometry-mode")).toContainText("Aggregate oriented frame");
  await expect(page.locator("#geometry-mode")).toContainText("Mixed member values");
  await expect(page.locator("#aspect-lock")).toBeChecked();
  for (const id of ["position-x", "position-y", "position-width", "position-height", "rotation"]) {
    await expect(page.locator(`#${id}`)).toBeEnabled();
  }

  const before = await geometry(page, alignmentLabels);
  const unrelatedBefore = await geometry(page, [unrelatedLabel]);
  const width = Number(await page.locator("#position-width").inputValue());
  await page.locator("#position-width").fill(String(width * 1.1));
  await page.locator("#position-width").press("Enter");
  const after = await geometry(page, alignmentLabels);
  for (const label of alignmentLabels) {
    expect(after[label].width).toBeCloseTo(before[label].width * 1.1, 4);
    expect(after[label].height).toBeCloseTo(before[label].height * 1.1, 4);
  }
  expectGeometry(await geometry(page, [unrelatedLabel]), unrelatedBefore);
  await page.getByRole("button", { name: "Undo" }).click();
  expectGeometry(await geometry(page, alignmentLabels), before);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

  const unchanged = await page.locator("#position-height").inputValue();
  await page.locator("#position-height").fill(Number(unchanged).toFixed(6));
  await page.locator("#position-height").press("Enter");
  expectGeometry(await geometry(page, alignmentLabels), before);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

  await page.locator("#position-height").fill("1e2");
  await page.locator("#position-height").press("Enter");
  await expect(page.locator("#position-height")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#geometry-error")).toContainText("finite decimal");
  expectGeometry(await geometry(page, alignmentLabels), before);

  // Recover inline without leaving a partial mutation, then cancel a changed value.
  await page.locator("#position-height").press("Escape");
  await expect(page.locator("#position-height")).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#geometry-error")).toBeEmpty();
  const beforeEscape = await geometry(page, [...alignmentLabels, unrelatedLabel]);
  const beforeEscapeTransforms = await transformAttributes(page, alignmentLabels);
  await page.locator("#position-x").fill(String(Number(await page.locator("#position-x").inputValue()) + 41.25));
  await page.locator("#position-x").press("Escape");
  expectGeometry(await geometry(page, [...alignmentLabels, unrelatedLabel]), beforeEscape);
  expect(await transformAttributes(page, alignmentLabels)).toEqual(beforeEscapeTransforms);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await expect(page.locator("#status")).toHaveText("Canceled the numeric geometry edit");

  // Rotation normalization is a semantic no-op, including transform syntax and history.
  await page.locator("#rotation").fill("360");
  await page.locator("#rotation").press("Enter");
  expectGeometry(await geometry(page, [...alignmentLabels, unrelatedLabel]), beforeEscape);
  expect(await transformAttributes(page, alignmentLabels)).toEqual(beforeEscapeTransforms);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

  // X and Y commits move every selected member by the exact root-space delta.
  const xBefore = await geometry(page, [...alignmentLabels, unrelatedLabel]);
  const xIdentity = await identity(page);
  const x = Number(await page.locator("#position-x").inputValue());
  await page.locator("#position-x").fill(String(x + 17.25));
  await page.locator("#position-x").press("Enter");
  const xAfter = await geometry(page, [...alignmentLabels, unrelatedLabel]);
  for (const label of alignmentLabels) {
    expect(Math.abs(xAfter[label].left - xBefore[label].left - 17.25)).toBeLessThanOrEqual(1e-4);
    expect(xAfter[label].top - xBefore[label].top).toBeCloseTo(0, 5);
  }
  expectGeometry({ [unrelatedLabel]: xAfter[unrelatedLabel] }, { [unrelatedLabel]: xBefore[unrelatedLabel] });
  const xAfterIdentity = await identity(page);
  await exactOneCheckpoint(page, xBefore, xAfter, xIdentity, xAfterIdentity, () => geometry(page, [...alignmentLabels, unrelatedLabel]));
  await page.getByRole("button", { name: "Undo" }).click();
  expectGeometry(await geometry(page, [...alignmentLabels, unrelatedLabel]), xBefore);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

  const yBefore = await geometry(page, [...alignmentLabels, unrelatedLabel]);
  const y = Number(await page.locator("#position-y").inputValue());
  await page.locator("#position-y").fill(String(y - 12.5));
  await page.locator("#position-y").press("Enter");
  const yAfter = await geometry(page, [...alignmentLabels, unrelatedLabel]);
  for (const label of alignmentLabels) {
    expect(yAfter[label].left - yBefore[label].left).toBeCloseTo(0, 5);
    expect(Math.abs(yAfter[label].top - yBefore[label].top + 12.5)).toBeLessThanOrEqual(1e-4);
  }
  expectGeometry({ [unrelatedLabel]: yAfter[unrelatedLabel] }, { [unrelatedLabel]: yBefore[unrelatedLabel] });
  await page.getByRole("button", { name: "Undo" }).click();
  expectGeometry(await geometry(page, [...alignmentLabels, unrelatedLabel]), yBefore);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await page.getByRole("button", { name: "Redo" }).click();
  expectGeometry(await geometry(page, [...alignmentLabels, unrelatedLabel]), yAfter);
  await page.getByRole("button", { name: "Undo" }).click();

  // A changed-value blur commits one locked-aspect height checkpoint.
  const blurBefore = await geometry(page, [...alignmentLabels, unrelatedLabel]);
  const height = Number(await page.locator("#position-height").inputValue());
  await page.locator("#position-height").fill(String(height * 1.125));
  await page.locator("#position-height").blur();
  const blurAfter = await geometry(page, [...alignmentLabels, unrelatedLabel]);
  for (const label of alignmentLabels) {
    expect(blurAfter[label].width).toBeCloseTo(blurBefore[label].width * 1.125, 4);
    expect(blurAfter[label].height).toBeCloseTo(blurBefore[label].height * 1.125, 4);
  }
  expectGeometry({ [unrelatedLabel]: blurAfter[unrelatedLabel] }, { [unrelatedLabel]: blurBefore[unrelatedLabel] });
  await page.getByRole("button", { name: "Undo" }).click();
  expectGeometry(await geometry(page, [...alignmentLabels, unrelatedLabel]), blurBefore);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

  // Absolute rotation uses the aggregate frame rather than a relative delta.
  const rotationBefore = await geometry(page, [...alignmentLabels, unrelatedLabel]);
  await page.locator("#rotation").fill("90");
  await page.locator("#rotation").press("Enter");
  await expect(page.locator("#rotation")).toHaveValue("90");
  const rotationAfter = await geometry(page, [...alignmentLabels, unrelatedLabel]);
  for (const label of alignmentLabels) {
    expect(rotationAfter[label].width).toBeCloseTo(rotationBefore[label].height, 4);
    expect(rotationAfter[label].height).toBeCloseTo(rotationBefore[label].width, 4);
  }
  expectGeometry({ [unrelatedLabel]: rotationAfter[unrelatedLabel] }, { [unrelatedLabel]: rotationBefore[unrelatedLabel] });
  await page.getByRole("button", { name: "Undo" }).click();
  expectGeometry(await geometry(page, [...alignmentLabels, unrelatedLabel]), rotationBefore);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await page.getByRole("button", { name: "Redo" }).click();
  expectGeometry(await geometry(page, [...alignmentLabels, unrelatedLabel]), rotationAfter);
  await page.getByRole("button", { name: "Undo" }).click();

  // Two unlocked dimension commits are independent, exact nonuniform checkpoints.
  await page.locator("#aspect-lock").uncheck();
  const nonuniformBefore = await geometry(page, [...alignmentLabels, unrelatedLabel]);
  const frameBefore = await numericValues(page);
  await page.locator("#position-width").fill(String(frameBefore["position-width"] * 1.2));
  await page.locator("#position-width").press("Enter");
  const widthAfter = await geometry(page, [...alignmentLabels, unrelatedLabel]);
  for (const label of alignmentLabels) {
    expect(widthAfter[label].width).toBeCloseTo(nonuniformBefore[label].width * 1.2, 4);
    expect(widthAfter[label].height).toBeCloseTo(nonuniformBefore[label].height, 4);
  }
  const widthFrame = await numericValues(page);
  expect(widthFrame["position-width"]).toBeCloseTo(frameBefore["position-width"] * 1.2, 4);
  expect(widthFrame["position-height"]).toBeCloseTo(frameBefore["position-height"], 4);
  await page.locator("#position-height").fill(String(widthFrame["position-height"] * 0.8));
  await page.locator("#position-height").press("Enter");
  const nonuniformAfter = await geometry(page, [...alignmentLabels, unrelatedLabel]);
  for (const label of alignmentLabels) {
    expect(nonuniformAfter[label].width).toBeCloseTo(nonuniformBefore[label].width * 1.2, 4);
    expect(nonuniformAfter[label].height).toBeCloseTo(nonuniformBefore[label].height * 0.8, 4);
  }
  expectGeometry({ [unrelatedLabel]: nonuniformAfter[unrelatedLabel] }, { [unrelatedLabel]: nonuniformBefore[unrelatedLabel] });
  await page.getByRole("button", { name: "Undo" }).click();
  expectGeometry(await geometry(page, [...alignmentLabels, unrelatedLabel]), widthAfter);
  await page.getByRole("button", { name: "Undo" }).click();
  expectGeometry(await geometry(page, [...alignmentLabels, unrelatedLabel]), nonuniformBefore);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await page.getByRole("button", { name: "Redo" }).click();
  expectGeometry(await geometry(page, [...alignmentLabels, unrelatedLabel]), widthAfter);
  await page.getByRole("button", { name: "Redo" }).click();
  expectGeometry(await geometry(page, [...alignmentLabels, unrelatedLabel]), nonuniformAfter);
  await expect(page.getByRole("button", { name: "Redo" })).toBeDisabled();

  await page.getByRole("button", { name: "Reset edits" }).click();
  expectGeometry(await geometry(page, [...alignmentLabels, unrelatedLabel]), beforeEscape);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Redo" })).toBeDisabled();

  // Locked and hidden members disable every numeric control without partial mutation.
  await layerButton(page, alignmentLabels[0]).click();
  await page.locator("#lock-selection").click();
  await selectLayers(page, alignmentLabels);
  const lockedBefore = await geometry(page, [...alignmentLabels, unrelatedLabel]);
  await expectNumericAvailability(page, false, /Unlock every selected layer/i);
  expectGeometry(await geometry(page, [...alignmentLabels, unrelatedLabel]), lockedBefore);
  await page.getByRole("button", { name: "Reset edits" }).click();
  await selectLayers(page, alignmentLabels);
  await page.getByRole("button", { exact: true, name: `Hide ${alignmentLabels[1]}` }).click();
  const hiddenBefore = await geometry(page, [...alignmentLabels, unrelatedLabel]);
  await expectNumericAvailability(page, false, /Show every selected layer/i);
  expectGeometry(await geometry(page, [...alignmentLabels, unrelatedLabel]), hiddenBefore);
  await page.getByRole("button", { name: "Undo" }).click();

  // An accepted public agent focus proves the incompatible ancestor/descendant state.
  const manifest = await page.request.get("/api/agent/document", { headers: { Authorization: `Bearer ${agentToken}` } }).then((response) => response.json());
  const ancestor = manifest.layers.find((layer: { name: string; sessionKey: string }) => layer.name === "West table cluster");
  const descendant = manifest.layers.find((layer: { name: string; sessionKey: string }) => layer.name === alignmentLabels[0]);
  if (!ancestor || !descendant) throw new Error("The incompatible Seatify focus targets are unavailable.");
  const focusId = `numeric-incompatible-${Date.now()}`;
  const focused = await page.request.post("/api/agent/transactions", {
    data: {
      protocolVersion: 1,
      transactionId: focusId,
      producer: { kind: "test", name: "Numeric precision QA" },
      document: { sessionId: manifest.sessionId, sourcePath: manifest.sourcePath, baseRevision: manifest.revision },
      operations: [{
        type: "selectFocus", operationId: "nested-focus",
        targets: [{ sessionKey: ancestor.sessionKey }, { sessionKey: descendant.sessionKey }],
        primary: { sessionKey: descendant.sessionKey },
      }],
    },
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  expect(focused.status()).toBe(202);
  await expect(page.locator("#agent-review-status")).toHaveAttribute("data-status", "accepted");
  await expect.poll(() => selectedLabels(page)).toEqual([alignmentLabels[0], "West table cluster"].sort());
  const incompatibleBefore = await geometry(page, [alignmentLabels[0], unrelatedLabel]);
  await expectNumericAvailability(page, false, /either a group or its nested layers/i);
  expectGeometry(await geometry(page, [alignmentLabels[0], unrelatedLabel]), incompatibleBefore);

  // Reload the clean source before exercising pending-Agent and saved-file phases.
  await openFixture(page);
  await selectLayers(page, alignmentLabels);
  await page.locator("#geometry-group").locator(":scope > summary").click();
  const pendingBefore = await geometry(page, [...alignmentLabels, unrelatedLabel]);
  const pendingManifest = await page.request.get("/api/agent/document", { headers: { Authorization: `Bearer ${agentToken}` } }).then((response) => response.json());
  const pendingTarget = pendingManifest.layers.find((layer: { name: string; sessionKey: string }) => layer.name === unrelatedLabel);
  if (!pendingTarget) throw new Error("The pending-Agent Seatify target is unavailable.");
  const pendingId = `numeric-pending-${Date.now()}`;
  const queued = await page.request.post("/api/agent/transactions", {
    data: {
      protocolVersion: 1,
      transactionId: pendingId,
      producer: { kind: "test", name: "Numeric precision QA" },
      document: { sessionId: pendingManifest.sessionId, sourcePath: pendingManifest.sourcePath, baseRevision: pendingManifest.revision },
      operations: [{ type: "renameLayer", operationId: "rename-venue", target: { sessionKey: pendingTarget.sessionKey }, name: "Numeric proposal" }],
    },
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  expect(queued.status()).toBe(202);
  await expect(page.locator("#agent-review-status")).toHaveAttribute("data-status", "pending");
  await expectNumericAvailability(page, false, /pending Agent review/i);
  expectGeometry(await geometry(page, [...alignmentLabels, unrelatedLabel]), pendingBefore);
  await page.getByRole("button", { name: "Revert" }).click();
  await expect(page.locator("#agent-review-status")).toHaveAttribute("data-status", "reverted");
  expectGeometry(await geometry(page, [...alignmentLabels, unrelatedLabel]), pendingBefore);

  // Zoom and collapsed sidebars do not alter the selection frame; the reopened
  // inspector commits at that same zoom, then a clean named save is reloaded.
  const authoredBeforeReflow = await authoredGeometryFingerprint(page);
  const unrelatedAuthoredBeforeReflow = await authoredGeometryFingerprint(page, [unrelatedLabel, "Seatify wordmark"]);
  const numericBeforeReflow = await numericValues(page);
  await page.locator("#zoom-in").click();
  await expect(page.locator("#zoom-label")).toHaveText("125%");
  const zoomBefore = await geometry(page, [...alignmentLabels, unrelatedLabel]);
  await page.locator("#toggle-left-sidebar").click();
  await page.locator("#toggle-right-sidebar").click();
  await expect(page.locator("#toggle-left-sidebar")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#toggle-right-sidebar")).toHaveAttribute("aria-expanded", "false");
  expect(await authoredGeometryFingerprint(page)).toEqual(authoredBeforeReflow);
  expect(await selectedLabels(page)).toEqual([...alignmentLabels].sort());
  await page.locator("#toggle-right-sidebar").click();
  await expect(page.locator("#toggle-right-sidebar")).toHaveAttribute("aria-expanded", "true");
  await expectNumericAvailability(page, true);
  expect(await numericValues(page)).toEqual(numericBeforeReflow);
  expect(await selectedLabels(page)).toEqual([...alignmentLabels].sort());
  const savedX = Number(await page.locator("#position-x").inputValue());
  await page.locator("#position-x").fill(String(savedX + 9.5));
  await page.locator("#position-x").blur();
  const savedGeometry = await geometry(page, [...alignmentLabels, unrelatedLabel]);
  const savedSelectedGeometry = Object.fromEntries(alignmentLabels.map((label) => [label, savedGeometry[label]]));
  for (const label of alignmentLabels) {
    expect(Math.abs(savedGeometry[label].left - zoomBefore[label].left - 9.5)).toBeLessThanOrEqual(1e-4);
  }
  expect(await authoredGeometryFingerprint(page, [unrelatedLabel, "Seatify wordmark"]))
    .toEqual(unrelatedAuthoredBeforeReflow);
  const savedCaptionWordmarkFingerprint = await authoredGeometryFingerprint(page, [unrelatedLabel, "Seatify wordmark"]);
  const savedTransforms = await transformAttributes(page, alignmentLabels);

  let savedSvg = "";
  const savedPath = "iterations/seatify-numeric-precision-e2e.svg";
  await page.route("**/api/iterations", async (route) => {
    savedSvg = (JSON.parse(route.request().postData() ?? "{}") as { svg?: string }).svg ?? "";
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({
      file: { collection: "iterations", name: "seatify-numeric-precision-e2e.svg", path: savedPath },
      nextIterationPath: "iterations/iteration-1.svg",
    }) });
  });
  await page.route("**/api/workspace", async (route) => {
    const response = await route.fetch();
    const workspace = await response.json() as { files: Array<{ collection: string; name: string; path: string }> };
    if (!workspace.files.some((file) => file.path === savedPath)) {
      workspace.files.push({ collection: "iterations", name: "seatify-numeric-precision-e2e.svg", path: savedPath });
    }
    await route.fulfill({ response, json: workspace });
  });
  await page.route(`**/api/svg?path=${encodeURIComponent(savedPath)}`, async (route) => {
    await route.fulfill({ status: 200, contentType: "image/svg+xml", body: savedSvg });
  });
  const numericSave = page.locator("#save-iteration");
  await expect(numericSave).toHaveText(/^Save complex-seatify-iteration-\d+$/);
  await expect(numericSave).toHaveAttribute("title", /^Create iterations\/complex-seatify-iteration-\d+\.svg$/);
  await numericSave.click();
  await expect(page.locator("#status")).toHaveText(`Saved ${savedPath}`);
  await expect(page.locator(".file-button[aria-current='true']")).toHaveAttribute("data-path", savedPath);
  expect(savedSvg).not.toMatch(/data-(?:lineage|agent|review|transport)-|lineage-(?:collective|numeric)|svg_select|selection-halo|transactionId|agent-token/i);

  await page.locator("#toggle-left-sidebar").click();
  await expect(page.locator("#toggle-left-sidebar")).toHaveAttribute("aria-expanded", "true");
  await page.locator('[data-path="concepts/complex-seatify.svg"]').click();
  await expect(page.locator(".file-button[aria-current='true']")).toHaveAttribute("data-path", "concepts/complex-seatify.svg");
  await page.locator(`.file-button[data-path=${JSON.stringify(savedPath)}]`).click();
  await expect(page.locator(".file-button[aria-current='true']")).toHaveAttribute("data-path", savedPath);
  await expect(page.locator("#artboard svg[aria-label='Complex Seatify venue logo']")).toBeVisible();
  expectGeometry(await geometry(page, alignmentLabels), savedSelectedGeometry);
  expect(await transformAttributes(page, alignmentLabels)).toEqual(savedTransforms);
  expect(await authoredGeometryFingerprint(page, [unrelatedLabel, "Seatify wordmark"]))
    .toEqual(savedCaptionWordmarkFingerprint);
});

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
  const save = page.locator("#save-iteration");
  await expect(save).toHaveText(/^Save complex-seatify-iteration-\d+$/);
  const saveTitle = await save.getAttribute("title");
  expect(saveTitle).toMatch(/^Create iterations\/complex-seatify-iteration-\d+\.svg$/);
  const savedPath = saveTitle!.replace(/^Create /, "");
  await save.click();
  await expect(page.locator("#status")).toHaveText(`Saved ${savedPath}`);
  const savedResponse = await page.request.get(`/api/svg?path=${encodeURIComponent(savedPath)}`);
  expect(savedResponse.ok()).toBe(true);
  const saved = await savedResponse.text();
  expect(await (await page.request.get("/api/svg?path=concepts%2Fcomplex-seatify.svg")).text()).toBe(source);
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
