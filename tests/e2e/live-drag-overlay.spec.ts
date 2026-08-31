import { expect, test, type Page } from "@playwright/test";

const singleLabel = "Seatify title";
const multiLabels = ["Seatify title", "Seatify tagline"];

type Point = { x: number; y: number };
type MatrixProbe = { a: number; b: number; c: number; d: number; e: number; f: number };
type OverlayProbe = {
  artwork: Point;
  handles: Point[];
  outline: Point[];
  probeIds: string[];
  rootMatrix: MatrixProbe;
};

async function openConstellation(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page).toHaveURL(/^http:\/\/marquee-qa\.localhost:/);
  await page.getByRole("button", { name: "seatify-constellation" }).click();
  await expect(page.locator("#artboard svg[aria-label='Seatify constellation logo']")).toBeVisible();
  await expect(page.locator(".layer-button")).toHaveCount(44);
}

function labeled(page: Page, label: string) {
  return page.locator(`#artboard svg [aria-label=${JSON.stringify(label)}]`);
}

function layerButton(page: Page, label: string) {
  return page.locator(".layer-button").filter({
    has: page.locator(".layer-type + span", { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }),
  });
}

async function selectLayers(page: Page, labels: string[]): Promise<void> {
  await layerButton(page, labels[0]).click();
  for (const label of labels.slice(1)) await layerButton(page, label).click({ modifiers: ["Shift"] });
  await expect(page.locator(".layer-button[aria-pressed='true']")).toHaveCount(labels.length);
}

async function configureViewport(page: Page, zoom: 100 | 125, collapsed: boolean): Promise<void> {
  if (zoom === 125) {
    await page.locator("#zoom-in").click();
    await expect(page.locator("#zoom-label")).toHaveText("125%");
  }
  if (collapsed) {
    await page.locator("#toggle-left-sidebar").click();
    await page.locator("#toggle-right-sidebar").click();
    await expect(page.locator("#toggle-left-sidebar")).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#toggle-right-sidebar")).toHaveAttribute("aria-expanded", "false");
  }
}

async function settleRootTransform(page: Page): Promise<MatrixProbe> {
  return await page.locator("#artboard svg").evaluate(async (rootNode) => {
    const root = rootNode as SVGSVGElement;
    const shell = document.querySelector<HTMLElement>("#canvas-shell");
    if (!shell || !shell.contains(root)) throw new Error("The Seatify canvas shell is unavailable.");
    const active = shell.getAnimations({ subtree: true })
      .filter((animation) => animation.playState === "running" || animation.pending);
    await Promise.all(active.map((animation) => animation.finished));
    await new Promise<void>((resolve) => requestAnimationFrame(() => {
      shell.getBoundingClientRect();
      getComputedStyle(shell).transform;
      resolve();
    }));
    const remaining = shell.getAnimations({ subtree: true })
      .filter((animation) => animation.playState === "running" || animation.pending);
    if (remaining.length > 0) throw new Error("A Seatify viewport animation remained active after the lifecycle barrier.");
    const matrix = root.getScreenCTM();
    if (!matrix) throw new Error("The Seatify root screen transform is unavailable.");
    return { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f };
  });
}

async function overlayProbe(page: Page, labels: string[], collective: boolean, mark = false): Promise<OverlayProbe> {
  return await page.locator("#artboard svg").evaluate((rootNode, input) => {
    const root = rootNode as SVGSVGElement;
    const nodes = input.labels.map((label) => Array.from(root.querySelectorAll<SVGGraphicsElement>("[aria-label]"))
      .find((candidate) => candidate.getAttribute("aria-label") === label));
    if (nodes.some((node) => !node)) throw new Error("Selected Seatify artwork is unavailable.");
    const artworkPoints = nodes.flatMap((node) => {
      const box = node!.getBBox();
      const matrix = node!.getScreenCTM();
      if (!matrix) throw new Error("Selected Seatify artwork screen geometry is unavailable.");
      return [
        new DOMPoint(box.x, box.y),
        new DOMPoint(box.x + box.width, box.y),
        new DOMPoint(box.x + box.width, box.y + box.height),
        new DOMPoint(box.x, box.y + box.height),
      ].map((point) => point.matrixTransform(matrix));
    });
    const left = Math.min(...artworkPoints.map((point) => point.x));
    const right = Math.max(...artworkPoints.map((point) => point.x));
    const top = Math.min(...artworkPoints.map((point) => point.y));
    const bottom = Math.max(...artworkPoints.map((point) => point.y));
    const outline = root.querySelector<SVGGraphicsElement>(input.collective
      ? ".lineage-collective-outline"
      : ".svg_select_shape:not(.lineage-collective-outline)");
    const overlay = input.collective
      ? root.querySelector<SVGGElement>("[data-lineage-collective-transform]")
      : outline?.parentElement;
    if (!outline || !overlay) throw new Error("The live selection overlay is unavailable.");
    const handles = Array.from(overlay.querySelectorAll<SVGGraphicsElement>(input.collective
      ? "[data-lineage-collective-handle]"
      : ".svg_select_handle, .svg_select_handle_rot"))
      .filter((handle) => {
        const style = getComputedStyle(handle);
        return style.display !== "none" && style.visibility !== "hidden";
      });
    if (handles.length !== 9) throw new Error(`Expected every selection handle, received ${handles.length}.`);
    const probeNodes = [outline, ...handles];
    if (input.mark) probeNodes.forEach((node, index) => node.setAttribute("data-live-overlay-probe", String(index)));
    const center = (node: Element): Point => {
      const rect = node.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    const outlineMatrix = outline.getScreenCTM();
    const rootMatrix = root.getScreenCTM();
    if (!outlineMatrix || !rootMatrix) throw new Error("The live overlay screen transform is unavailable.");
    const localOutline = outline instanceof SVGPolygonElement
      ? Array.from(outline.points).map((point) => ({ x: point.x, y: point.y }))
      : (() => {
        const rect = outline as SVGRectElement;
        const x = Number(rect.getAttribute("x"));
        const y = Number(rect.getAttribute("y"));
        const width = Number(rect.getAttribute("width"));
        const height = Number(rect.getAttribute("height"));
        return [
          { x, y }, { x: x + width, y },
          { x: x + width, y: y + height }, { x, y: y + height },
        ];
      })();
    return {
      artwork: { x: (left + right) / 2, y: (top + bottom) / 2 },
      handles: handles.map(center),
      outline: localOutline.map((point) => {
        const screen = new DOMPoint(point.x, point.y).matrixTransform(outlineMatrix);
        return { x: screen.x, y: screen.y };
      }),
      probeIds: probeNodes.map((node) => node.getAttribute("data-live-overlay-probe") ?? ""),
      rootMatrix: {
        a: rootMatrix.a, b: rootMatrix.b, c: rootMatrix.c,
        d: rootMatrix.d, e: rootMatrix.e, f: rootMatrix.f,
      },
    };
  }, { labels, collective, mark });
}

async function transforms(page: Page, labels: string[]): Promise<Array<string | null>> {
  return await page.locator("#artboard svg").evaluate((root, targetLabels) => targetLabels.map((label) =>
    Array.from(root.querySelectorAll<SVGGraphicsElement>("[aria-label]"))
      .find((candidate) => candidate.getAttribute("aria-label") === label)
      ?.getAttribute("transform") ?? null), labels);
}

function expectTracked(before: OverlayProbe, live: OverlayProbe): void {
  const artworkDelta = {
    x: live.artwork.x - before.artwork.x,
    y: live.artwork.y - before.artwork.y,
  };
  expect(Math.hypot(artworkDelta.x, artworkDelta.y)).toBeGreaterThan(5);
  for (const coefficient of ["a", "b", "c", "d", "e", "f"] as const) {
    expect(live.rootMatrix[coefficient], `root matrix ${coefficient}`).toBeCloseTo(before.rootMatrix[coefficient], 6);
  }
  expect(live.outline).toHaveLength(before.outline.length);
  live.outline.forEach((point, index) => {
    expect(Math.abs(point.x - before.outline[index].x - artworkDelta.x), `outline point ${index} x`).toBeLessThan(0.05);
    expect(Math.abs(point.y - before.outline[index].y - artworkDelta.y), `outline point ${index} y`).toBeLessThan(0.05);
  });
  expect(live.handles).toHaveLength(before.handles.length);
  live.handles.forEach((handle, index) => {
    expect(Math.abs(handle.x - before.handles[index].x - artworkDelta.x), `handle ${index} x`).toBeLessThan(0.05);
    expect(Math.abs(handle.y - before.handles[index].y - artworkDelta.y), `handle ${index} y`).toBeLessThan(0.05);
  });
  expect(live.probeIds).toEqual(before.probeIds);
}

for (const scenario of [
  { collapsed: false, labels: [singleLabel], name: "single selection", zoom: 100 as const },
  { collapsed: true, labels: [singleLabel], name: "single selection", zoom: 125 as const },
  { collapsed: false, labels: multiLabels, name: "multi-selection", zoom: 100 as const },
  { collapsed: true, labels: multiLabels, name: "multi-selection", zoom: 125 as const },
]) {
  test(`${scenario.name} overlay tracks a live Seatify drag at ${scenario.zoom}% zoom${scenario.collapsed ? " with collapsed sidebars" : ""}`, async ({ page }) => {
    await openConstellation(page);
    await selectLayers(page, scenario.labels);
    await configureViewport(page, scenario.zoom, scenario.collapsed);
    const settled = await settleRootTransform(page);
    const collective = scenario.labels.length > 1;
    const beforeTransforms = await transforms(page, scenario.labels);
    const before = await overlayProbe(page, scenario.labels, collective, true);
    expect(before.rootMatrix).toEqual(settled);
    const source = await labeled(page, scenario.labels[0]).boundingBox();
    if (!source) throw new Error("The selected Seatify drag source is unavailable.");
    const start = { x: source.x + source.width / 2, y: source.y + source.height / 2 };

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 28, start.y + 19, { steps: 8 });
    const live = await overlayProbe(page, scenario.labels, collective);
    expectTracked(before, live);
    await page.mouse.up();

    await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
    await page.getByRole("button", { name: "Undo" }).click();
    expect(await transforms(page, scenario.labels)).toEqual(beforeTransforms);
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  });
}
