import { expect, test, type Page } from "@playwright/test";

const constellationLabels = [
  "North seat back",
  "Northeast seat back",
  "Southeast seat back",
  "South seat back",
  "Southwest seat back",
  "Northwest seat back",
  "Optimized center point",
];

async function openConstellation(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page).toHaveURL(/^http:\/\/marquee-qa\.localhost:/);
  await page.getByRole("button", { name: "seatify-constellation" }).click();
  await expect(page.locator("#artboard svg[aria-label='Seatify constellation logo']")).toBeVisible();
}

function labeled(page: Page, label: string) {
  return page.locator(`#artboard svg [aria-label=${JSON.stringify(label)}]`);
}

async function selectConstellationObjects(page: Page): Promise<void> {
  for (const [index, label] of constellationLabels.entries()) {
    const target = labeled(page, label);
    const [box, stage] = await Promise.all([target.boundingBox(), page.locator("#stage").boundingBox()]);
    if (!box || !stage) throw new Error(`The Seatify selection geometry is unavailable for ${label}.`);
    const padding = Math.min(box.width, box.height) * 0.08;
    const start = { x: box.x - padding, y: box.y - padding };
    const end = { x: box.x + box.width + padding, y: box.y + box.height + padding };
    await page.mouse.move(start.x, start.y);
    await page.keyboard.down("ControlLeft");
    if (index > 0) await page.keyboard.down("ShiftLeft");
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
    if (index > 0) await page.keyboard.up("ShiftLeft");
    await page.keyboard.up("ControlLeft");
  }
  await expect(page.locator(".layer-button[aria-pressed='true']")).toHaveCount(constellationLabels.length);
  await expect(page.locator("#selection-count-badge")).toHaveText(`${constellationLabels.length} objects selected`);
}

async function transforms(page: Page): Promise<Record<string, string | null>> {
  return await page.locator("#artboard svg").evaluate((root, labels) => Object.fromEntries(labels.map((label) => {
    const node = Array.from(root.querySelectorAll<SVGGraphicsElement>("[aria-label]"))
      .find((candidate) => candidate.getAttribute("aria-label") === label);
    return [label, node?.getAttribute("transform") ?? null];
  })), constellationLabels);
}

async function collectiveTopEdge(page: Page): Promise<{ start: { x: number; y: number }; end: { x: number; y: number } }> {
  return await page.locator(".lineage-collective-outline").evaluate((outline) => {
    const rect = outline as SVGRectElement;
    const matrix = rect.getScreenCTM();
    if (!matrix) throw new Error("The collective selection frame is unavailable.");
    const x = Number(rect.getAttribute("x"));
    const y = Number(rect.getAttribute("y"));
    const width = Number(rect.getAttribute("width"));
    const start = new DOMPoint(x, y).matrixTransform(matrix);
    const end = new DOMPoint(x + width, y).matrixTransform(matrix);
    return { start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y } };
  });
}

test("Seatify constellation shows and preserves an arbitrary collective rotation angle", async ({ page }) => {
  await openConstellation(page);
  await selectConstellationObjects(page);
  const before = await transforms(page);
  const handle = page.locator('[data-lineage-collective-handle="rotation"]');
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error("The Seatify collective rotation handle is unavailable.");
  const start = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 };
  const pivot = await page.locator("#artboard svg").evaluate((root) => {
    const outline = root.querySelector<SVGRectElement>(".lineage-collective-outline");
    const matrix = (root as SVGSVGElement).getScreenCTM();
    if (!outline || !matrix) throw new Error("The Seatify collective rotation pivot is unavailable.");
    const x = Number(outline.getAttribute("x")) + Number(outline.getAttribute("width")) / 2;
    const y = Number(outline.getAttribute("y")) + Number(outline.getAttribute("height")) / 2;
    return new DOMPoint(x, y).matrixTransform(matrix);
  });
  const radians = 27 * Math.PI / 180;
  const vector = { x: start.x - pivot.x, y: start.y - pivot.y };
  const end = {
    x: pivot.x + Math.cos(radians) * vector.x - Math.sin(radians) * vector.y,
    y: pivot.y + Math.sin(radians) * vector.x + Math.cos(radians) * vector.y,
  };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await expect(page.locator("[data-lineage-collective-angle]")).toHaveAttribute("data-lineage-collective-angle", "27");
  await expect(page.locator("[data-lineage-collective-angle] text")).toHaveText("Δ +27°");
  await expect(page.locator("#status")).toHaveText(`Rotation 27° for ${constellationLabels.length} selected layers`);
  await page.mouse.up();

  const after = await transforms(page);
  expect(after).not.toEqual(before);
  expect([0, 90, -90, 180, -180]).not.toContain(
    Number(await page.locator("[data-lineage-collective-angle]").getAttribute("data-lineage-collective-angle")),
  );
  await expect(page.locator('[data-lineage-collective-handle="rotation"]'))
    .toHaveAttribute("aria-label", "Rotate selected layers. Current adjustment 27°");
  const committedEdge = await collectiveTopEdge(page);
  expect(Math.abs(committedEdge.end.y - committedEdge.start.y)).toBeGreaterThan(5);

  await page.getByRole("button", { name: "Undo" }).click();
  expect(await transforms(page)).toEqual(before);
  await expect(page.locator("[data-lineage-collective-angle]")).toHaveAttribute("visibility", "hidden");
  await page.getByRole("button", { name: "Redo" }).click();
  expect(await transforms(page)).toEqual(after);
  await expect(page.locator("[data-lineage-collective-angle]")).toHaveAttribute("data-lineage-collective-angle", "27");
  const restoredEdge = await collectiveTopEdge(page);
  expect(Math.abs(restoredEdge.end.y - restoredEdge.start.y)).toBeGreaterThan(5);

  await page.locator('[data-lineage-collective-handle="rb"]').press("Enter");
  const resized = await transforms(page);
  expect(resized).not.toEqual(after);
  const resizedEdge = await collectiveTopEdge(page);
  expect(Math.abs(resizedEdge.end.y - resizedEdge.start.y)).toBeGreaterThan(5);
  await page.getByRole("button", { name: "Undo" }).click();
  expect(await transforms(page)).toEqual(after);
  const resizeUndoneEdge = await collectiveTopEdge(page);
  expect(Math.abs(resizeUndoneEdge.end.y - resizeUndoneEdge.start.y)).toBeGreaterThan(5);
});
