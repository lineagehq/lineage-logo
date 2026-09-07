import { expect, test, type Page } from "@playwright/test";
import { publicFixtureNames } from "../../../scripts/qa-fixtures";

const representative = ["wide.svg", "transparent-white.svg", "inherited-paint.svg", "resources.svg", "text-heavy.svg", "seatify-transformed.svg", "empty.svg"];
const fixtures = process.env.LINEAGE_LOGO_FULL_CORPUS === "1" ? [...publicFixtureNames] : representative;

async function pixels(page: Page, svg: string): Promise<number[]> {
  return page.evaluate(async source => {
    const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
    try {
      const image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256;
      const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0, 256, 256);
      return [...context.getImageData(0, 0, 256, 256).data];
    } finally { URL.revokeObjectURL(url); }
  }, svg);
}

for (const fixture of fixtures) test(`curated SVG render and saved continuation preserve ${fixture}`, async ({ page }) => {
  const sourcePath = `concepts/ux-${fixture}`;
  await page.goto("/"); await page.locator(`[data-path="${sourcePath}"]`).click();
  await expect(page.locator("#artboard svg")).toBeVisible();
  const original = await (await page.request.get(`/api/svg?path=${encodeURIComponent(sourcePath)}`)).text();
  const originalPixels = await pixels(page, original);
  if (fixture === "empty.svg") {
    expect(originalPixels.every(value => value === 0)).toBe(true);
    await expect(page.locator("#save-iteration")).toBeEnabled();
  } else {
    expect(originalPixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
    await page.locator(".layer-button").first().click();
    await page.locator("#layer-name").fill("Corpus preserved artwork");
    await page.locator("#layer-name").press("Enter");
    await expect(page.locator("#undo")).toBeEnabled();
  }
  await page.locator("#save-iteration").click();
  const selected = page.locator(".file-button[aria-current='true']");
  await expect(selected).toHaveAttribute("data-path", /^iterations\//);
  const savedPath = await selected.getAttribute("data-path");
  const saved = await (await page.request.get(`/api/svg?path=${encodeURIComponent(savedPath!)}`)).text();
  expect(await pixels(page, saved)).toEqual(originalPixels);
  await page.reload(); await expect(selected).toHaveAttribute("data-path", savedPath!);
  const rendered = await page.locator("#artboard svg").evaluate(root => {
    const clean = root.cloneNode(true) as SVGSVGElement;
    clean.querySelectorAll(".svg_select_shape, .svg_select_handle, .svg_select_handle_rot, [data-lineage-collective-transform]").forEach(node => node.remove());
    return new XMLSerializer().serializeToString(clean);
  });
  expect(await pixels(page, rendered)).toEqual(originalPixels);
  expect(await (await page.request.get(`/api/svg?path=${encodeURIComponent(sourcePath)}`)).text()).toBe(original);
});
