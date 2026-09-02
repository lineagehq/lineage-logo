import { expect, test } from "@playwright/test";

test("critical Seatify semantic-control and keyboard smoke path", async ({ page }) => {
  await page.goto("/");
  const canonical = page.locator('[data-path="concepts/seatify-constellation.svg"]');
  await canonical.focus();
  await expect(canonical).toBeFocused();
  await canonical.press("Enter");
  await expect(page.locator("#artboard svg[aria-label='Seatify constellation logo']")).toBeVisible();
  await expect(page.locator("#preview-target")).toHaveValue("#constellation-mark");

  const semanticControlFailures = await page.evaluate(() => {
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
    };
    const name = (element: Element) => element.getAttribute("aria-label")
      || element.getAttribute("title")
      || element.querySelector("[aria-label]:not([aria-hidden='true'])")?.getAttribute("aria-label")
      || element.querySelector("img[alt]")?.getAttribute("alt")
      || element.textContent?.trim()
      || "";
    const failures: string[] = [];
    const ids = Array.from(document.querySelectorAll<HTMLElement>("[id]")).map((element) => element.id);
    if (new Set(ids).size !== ids.length) failures.push("duplicate-id");
    for (const element of document.querySelectorAll("button, [role='button'], a[href]")) {
      if (visible(element) && element.getAttribute("aria-hidden") !== "true" && !name(element)) failures.push("unnamed-control");
    }
    for (const input of document.querySelectorAll<HTMLInputElement>("input, select, textarea")) {
      if (!visible(input)) continue;
      const labelled = input.labels?.length || input.getAttribute("aria-label") || input.getAttribute("aria-labelledby");
      if (!labelled) failures.push("unlabelled-field");
    }
    for (const image of document.querySelectorAll("img")) {
      if (visible(image) && !image.hasAttribute("alt")) failures.push("image-alt");
    }
    if (!document.querySelector("main") || !document.querySelector("[role='status'][aria-live]")) failures.push("landmark-status");
    return failures;
  });
  expect(semanticControlFailures, "bounded semantic-control audit detects no failures").toEqual([]);

  const titleLayer = page.locator(".layer-button").filter({
    has: page.locator(".layer-type + span", { hasText: /^Seatify title$/ }),
  });
  await titleLayer.focus();
  await titleLayer.press("Enter");
  const name = page.locator("#layer-name");
  await name.focus();
  await name.fill("Accessible Seatify title");
  await name.press("Enter");
  await expect(page.locator("#lifecycle-state")).toHaveAttribute("data-state", "dirty");
  await expect(page.locator("#lifecycle-state")).toContainText("Unsaved changes");
  await page.locator("#undo").focus();
  await page.locator("#undo").press("Enter");
  await expect(page.locator("#artboard svg [aria-label='Seatify title']")).toHaveCount(1);
});
