import { expect, test, type Page } from "@playwright/test";
import { publicFixtureNames } from "../../../scripts/qa-fixtures";

const representative = ["wide.svg", "transparent-white.svg", "inherited-paint.svg", "resources.svg", "text-heavy.svg", "seatify-transformed.svg", "empty.svg"];
const fixtures = process.env.LINEAGE_LOGO_FULL_CORPUS === "1" ? [...publicFixtureNames] : representative;

async function pixels(page: Page, svg: string): Promise<number[]> {
  return page.evaluate(async source => {
    const document = new DOMParser().parseFromString(source, "image/svg+xml");
    if (document.querySelector("parsererror")) throw new Error("Invalid SVG corpus output");
    const root = document.documentElement;
    root.setAttribute("width", "256"); root.setAttribute("height", "256");
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: "image/svg+xml" }));
    try {
      const image = new Image(); image.src = url; await image.decode();
      const canvas = window.document.createElement("canvas"); canvas.width = 256; canvas.height = 256;
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
    await expect(page.locator("#save-iteration")).toBeDisabled();
    await expect(page.locator(".layer-button")).toHaveCount(0);
    await page.reload();
    await expect(page.locator("#artboard svg")).toBeVisible();
    await expect(page.locator(".layer-button")).toHaveCount(0);
    expect(await (await page.request.get(`/api/svg?path=${encodeURIComponent(sourcePath)}`)).text()).toBe(original);
    return;
  } else {
    expect(originalPixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
    if (fixture === "resources.svg") {
      await expect(page.locator(".layer-button")).toHaveCount(0);
      await page.locator("#save-version-export").click();
      const dialog = page.getByRole("dialog", { name: "Save a named version or export" });
      await dialog.getByRole("textbox", { name: "Version name" }).fill("Corpus resources");
      await dialog.getByRole("button", { name: "Save named version", exact: true }).click();
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await page.locator('.file-button[data-path^="iterations/"]').filter({hasText:"Corpus resources"}).click();
    } else {
    await page.locator(".layer-button").first().click();
    await page.locator("#layer-name").fill("Corpus preserved artwork");
    await page.locator("#layer-name").press("Enter");
    await expect(page.locator("#undo")).toBeEnabled();
    }
  }
  if (fixture !== "resources.svg") await page.locator("#save-iteration").click();
  const selected = page.locator(".file-button[aria-current='true']");
  await expect(selected).toHaveAttribute("data-path", /^iterations\//);
  const savedPath = await selected.getAttribute("data-path");
  const saved = await (await page.request.get(`/api/svg?path=${encodeURIComponent(savedPath!)}`)).text();
  expect((await pixels(page, saved)).filter((value, index) => value !== originalPixels[index]).length).toBe(0);
  await page.reload(); await expect(selected).toHaveAttribute("data-path", savedPath!);
  await page.keyboard.press("Escape");
  const rendered = await page.locator("#artboard svg").evaluate(root => {
    const clean = root.cloneNode(true) as SVGSVGElement;
    clean.querySelectorAll(".svg_select_shape, .svg_select_shape_pointSelect, .svg_select_handle, .svg_select_handle_rot, [data-lineage-collective-transform], [data-lineage-selection-halos], [data-lineage-snap-guides]").forEach(node => node.remove());
    return new XMLSerializer().serializeToString(clean);
  });
  expect((await pixels(page, rendered)).filter((value, index) => value !== originalPixels[index]).length).toBe(0);
  expect(await (await page.request.get(`/api/svg?path=${encodeURIComponent(sourcePath)}`)).text()).toBe(original);
});
