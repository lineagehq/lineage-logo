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

import { headers, layer, openSeatify, proposeTitle } from "./journey-helpers";

test("critical pointer geometry, text and paint survive save and reopen", async ({ page }) => {
  await openSeatify(page);
  const original = await (await page.request.get("/api/svg?path=concepts/seatify-constellation.svg")).text();
  await layer(page, "North seat back").click();
  const artwork = page.locator('#artboard [aria-label="North seat back"]');
  const initial = await artwork.getAttribute("transform");
  const box = await artwork.boundingBox();
  if (!box) throw new Error("Selected artwork is missing");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 25, box.y + box.height / 2 + 12, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => artwork.getAttribute("transform")).not.toBe(initial);
  await layer(page, "Seatify title").click();
  await layer(page, "Seatify tagline").click({ modifiers: ["Shift"] });
  await expect(page.locator(".layer-button[aria-pressed='true']")).toHaveCount(2);
  const transforms = () => page.locator('#artboard [aria-label="Seatify title"]').getAttribute("transform");
  const beforeResize = await transforms();
  const handle = page.locator('[data-lineage-collective-handle="rb"]');
  const resize = await handle.boundingBox();
  if (!resize) throw new Error("Resize handle is missing");
  await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2);
  await page.mouse.down(); await page.mouse.move(resize.x + resize.width / 2 + 20, resize.y + resize.height / 2 + 8, { steps: 8 }); await page.mouse.up();
  await expect.poll(transforms).not.toBe(beforeResize);
  const beforeRotation = await transforms();
  const rotation = await page.locator('[data-lineage-collective-handle="rotation"]').boundingBox();
  const outline = await page.locator(".lineage-collective-outline").boundingBox();
  if (!rotation || !outline) throw new Error("Rotation geometry is missing");
  const start = { x: rotation.x + rotation.width / 2, y: rotation.y + rotation.height / 2 };
  const pivot = { x: outline.x + outline.width / 2, y: outline.y + outline.height / 2 };
  const angle = Math.PI / 9;
  const dx = start.x - pivot.x, dy = start.y - pivot.y;
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(pivot.x + Math.cos(angle) * dx - Math.sin(angle) * dy, pivot.y + Math.sin(angle) * dx + Math.cos(angle) * dy, { steps: 8 }); await page.mouse.up();
  await expect.poll(transforms).not.toBe(beforeRotation);
  await layer(page, "Seatify title").click();
  await page.locator("#fill").fill("#a43366"); await page.locator("#fill").press("Enter");
  await page.locator("#text-content").fill("Seatify accessible"); await page.locator("#text-content").press("Enter");
  const committedTransform = await transforms();
  await page.locator("#save-iteration").click();
  const selectedFile = page.locator(".file-button[aria-current='true']");
  await expect(selectedFile).toHaveAttribute("data-path", /^iterations\//);
  const savedPath = await selectedFile.getAttribute("data-path");
  await page.reload();
  await expect(selectedFile).toHaveAttribute("data-path", savedPath!);
  await expect(page.locator('#artboard [aria-label="Seatify title"]')).toHaveText("Seatify accessible");
  await expect(page.locator('#artboard [aria-label="Seatify title"]')).toHaveAttribute("fill", "#a43366");
  await expect.poll(transforms).toBe(committedTransform);
  expect(await (await page.request.get("/api/svg?path=concepts/seatify-constellation.svg")).text()).toBe(original);
});

test("critical comparison rejects exactly, reconnects and accepts a saved proposal", async ({ page, context }) => {
  await openSeatify(page);
  const before = await page.locator("#artboard svg").first().innerHTML();
  const rejected = await proposeTitle(page, "reject");
  await expect.poll(() => page.locator(".agent-visual-review img").evaluateAll(images => images.length === 8 && images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.getByLabel("Revision request", { exact: true }).fill("Keep the existing words");
  await page.getByRole("button", { name: "Reject and request revision", exact: true }).click();
  await expect.poll(async () => (await (await page.request.get(`/api/agent/transactions/${rejected}`, { headers })).json()).status).toBe("reverted");
  expect(await page.locator("#artboard svg").first().innerHTML()).toBe(before);
  await context.setOffline(true);
  await page.reload().catch(() => {});
  await context.setOffline(false);
  await page.goto("/");
  await expect(page.locator("#artboard svg")).toBeVisible();
  const accepted = await proposeTitle(page, "accept");
  await page.locator("#agent-accept").click();
  await expect.poll(async () => (await (await page.request.get(`/api/agent/transactions/${accepted}`, { headers })).json()).status).toBe("accepted");
  await expect(page.locator(".file-button[aria-current='true']")).toHaveAttribute("data-path", /^iterations\//);
  await page.reload();
  await expect(page.locator('#artboard [aria-label="Seatify title"]')).toHaveText("Seatify proposed");
});
