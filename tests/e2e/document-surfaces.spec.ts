import { expect, test, type Page } from "@playwright/test";

async function openFixture(page: Page, name: string) {
  await page.goto("/");
  const expand = page.getByRole("button", { name: "Expand workspace panel" });
  if (await expand.isVisible()) await expand.click();
  await page.locator(`[data-path="concepts/ux-${name}.svg"]`).click();
  await expect(page.locator("#artboard > svg")).toBeVisible();
  const collapse = page.getByRole("button", { name: "Collapse workspace panel" });
  if (await collapse.isVisible()) await collapse.click();
}

async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  const png = await page.screenshot();
  return page.evaluate(async ({ data, x, y }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    return Array.from(context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data);
  }, { data: png.toString("base64"), x, y });
}

for (const width of [1280, 760]) {
  test(`document proportions, native zoom and nonmutating preview controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    for (const [name, ratio] of [["wide", 6], ["tall", 1 / 6]] as const) {
      await openFixture(page, name);
      await page.locator("#zoom-fit").click();
      await page.waitForTimeout(220);
      const board = await page.locator("#artboard").boundingBox();
      const root = await page.locator("#artboard > svg").boundingBox();
      expect(board!.width / board!.height).toBeCloseTo(ratio, 2);
      expect(root!.width).toBeCloseTo(board!.width, 0);
      expect(root!.height).toBeCloseTo(board!.height, 0);
      await page.locator("#artboard #mark").click();
      const selectedName = await page.locator("#selection-name").textContent();
      await page.locator("#zoom-reset").click();
      await page.waitForTimeout(220);
      const native = await page.locator("#artboard > svg").evaluate((svg: SVGSVGElement) => ({ width: svg.getBoundingClientRect().width, expected: svg.viewBox.baseVal.width }));
      expect(native.width).toBeCloseTo(native.expected, 0);
      await page.locator("#zoom-fit").click();
      const documentZoom = await page.locator("#zoom-label").innerText();
      await page.locator("#zoom-artwork").click();
      expect(await page.locator("#zoom-label").innerText()).not.toEqual(documentZoom);
      await expect(page.locator("#save-iteration")).toBeDisabled();
      await expect(page.locator("#undo")).toBeDisabled();
      expect(await page.locator("#selection-name").textContent()).toBe(selectedName);
    }
  });

  test(`actual transparent and authored surfaces at ${width}px`, async ({ page }, testInfo) => {
    testInfo.snapshotSuffix = "";
    await page.setViewportSize({ width, height: 720 });
    for (const name of ["transparent-white", "transparent-dark", "authored-background"]) {
      await openFixture(page, name);
      const before = await (await page.request.get(`/api/svg?path=concepts/ux-${name}.svg`)).text();
      await page.locator("#zoom-fit").click();
      for (const background of ["dark", "light", "checker"]) {
        await page.locator(`[data-background="${background}"].background-button`).click();
        await page.waitForTimeout(220);
        const svg = page.locator("#artboard > svg");
        const box = await svg.boundingBox();
        const center = await pixel(page, box!.x + box!.width / 2, box!.y + box!.height / 2);
        expect(center.slice(0, 3)).toEqual(name === "transparent-white" ? [255, 255, 255] : [18, 34, 56]);
        const edge = await pixel(page, box!.x + box!.width * 0.03, box!.y + box!.height * 0.03);
        if (name === "authored-background" || background === "light") expect(edge.slice(0, 3)).toEqual([255, 255, 255]);
        else if (background === "dark") expect(edge.slice(0, 3)).toEqual([39, 39, 38]);
        if (name === "transparent-white" && background === "dark") {
          await expect(page.locator("#stage")).toHaveScreenshot(`transparent-white-dark-${width}.png`);
        }
        const inspector = page.getByRole("button", { name: "Expand layers and inspector panel" });
        if (await inspector.isVisible()) await inspector.click();
        await expect(page.locator("#favicon-preview")).toHaveAttribute("data-background", background);
        const images = page.locator("#favicon-preview img");
        await expect(images).toHaveCount(3);
        for (const image of await images.all()) {
          const color = await image.evaluate((img) => getComputedStyle(img).backgroundColor);
          expect(color).toBe(background === "dark" ? "rgb(39, 39, 38)" : "rgb(255, 255, 255)");
          await image.scrollIntoViewIfNeeded();
          const previewBox = await image.boundingBox();
          const previewCenter = await pixel(page, previewBox!.x + previewBox!.width / 2, previewBox!.y + previewBox!.height / 2);
          expect(previewCenter.slice(0, 3)).toEqual(name === "transparent-white" ? [255, 255, 255] : [18, 34, 56]);
        }
        const collapseInspector = page.getByRole("button", { name: "Collapse layers and inspector panel" });
        if (width === 760 && await collapseInspector.isVisible()) await collapseInspector.click();
      }
      expect(await (await page.request.get(`/api/svg?path=concepts/ux-${name}.svg`)).text()).toBe(before);
      await expect(page.locator("#save-iteration")).toBeDisabled();
    }
  });
}

test("Fit artwork includes a manual edit outside document bounds and remains undoable", async ({ page }) => {
  await openFixture(page, "wide");
  await page.locator("#artboard #mark").click();
  const expand = page.getByRole("button", { name: "Expand layers and inspector panel" });
  if (await expand.isVisible()) await expand.click();
  await page.locator("#geometry-group summary").click();
  await page.locator("#position-x").fill("-500");
  await page.locator("#position-x").press("Enter");
  await page.locator("#zoom-artwork").click();
  await page.waitForTimeout(220);
  const mark = await page.locator("#artboard #mark").boundingBox();
  const stage = await page.locator("#stage").boundingBox();
  expect(mark!.x).toBeGreaterThanOrEqual(stage!.x);
  expect(mark!.x + mark!.width).toBeLessThanOrEqual(stage!.x + stage!.width);
  await page.locator("#undo").click();
  await page.locator("#zoom-fit").click();
  await expect(page.locator("#save-iteration")).toBeDisabled();
});
