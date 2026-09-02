import { expect, test } from "@playwright/test";

test("Seatify workspace chooses a useful preview and saves a concept-aware continuation responsively", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 720 });
  await page.goto("/");
  const workspaceToggle = page.getByRole("button", { name: "Expand workspace panel" });
  await expect(workspaceToggle).toHaveAttribute("aria-expanded", "false");
  await workspaceToggle.click();
  await expect(page.getByRole("button", { name: "Collapse workspace panel" })).toHaveAttribute("aria-expanded", "true");
  await page.locator('[data-path="concepts/seatify-constellation.svg"]').click();
  await expect(page.locator("#artboard svg[aria-label='Seatify constellation logo']")).toBeVisible();
  await page.getByRole("button", { name: "Collapse workspace panel" }).click();
  await expect(page.getByRole("button", { name: "Expand workspace panel" })).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#preview-target")).toHaveValue("#constellation-mark");
  await expect(page.locator("#preview-status")).toContainText("Automatic target from accessible SVG structure.");

  const sourceResponse = await page.request.get("/api/svg?path=concepts%2Fseatify-constellation.svg");
  expect(sourceResponse.ok()).toBe(true);
  const sourceBefore = await sourceResponse.text();
  const workspaceBefore = await (await page.request.get("/api/workspace")).json() as { files: Array<{ path: string }> };
  const pathsBefore = workspaceBefore.files.map((file) => file.path);

  await page.getByRole("button", { name: "Expand layers and inspector panel" }).click();
  await page.locator("#artboard svg [aria-label='Seatify title']").click();
  await page.locator("#layer-name").fill("Seatify preview title");
  await page.locator("#layer-name").press("Enter");
  const lifecycle = page.locator("#lifecycle-state");
  await expect(lifecycle).toHaveAttribute("data-state", "dirty");
  await expect(lifecycle).toContainText("Unsaved changes");
  await expect(lifecycle).toContainText("Save iterations/seatify-constellation-iteration-");
  const dirtyBounds = await lifecycle.boundingBox();
  expect(dirtyBounds).not.toBeNull();
  expect(dirtyBounds!.x + dirtyBounds!.width).toBeLessThanOrEqual(760);

  const save = page.locator("#save-iteration");
  await expect(save).toHaveText(/^Save seatify-constellation-iteration-\d+$/);
  const title = await save.getAttribute("title");
  expect(title).toMatch(/^Create iterations\/seatify-constellation-iteration-\d+\.svg$/);
  const savedPath = title!.replace(/^Create /, "");
  await save.click();
  await expect(page.locator("#status")).toHaveText(`Saved ${savedPath}`);
  await expect(lifecycle).toHaveAttribute("data-state", "saved");
  await expect(lifecycle).toContainText(`Created ${savedPath}`);
  await expect(page.locator(".file-button[aria-current='true']")).toHaveAttribute("data-path", savedPath);

  const workspaceAfter = await (await page.request.get("/api/workspace")).json() as { files: Array<{ path: string }> };
  expect(workspaceAfter.files.map((file) => file.path).filter((path) => !pathsBefore.includes(path))).toEqual([savedPath]);
  expect(await (await page.request.get("/api/svg?path=concepts%2Fseatify-constellation.svg")).text()).toBe(sourceBefore);
  const savedResponse = await page.request.get(`/api/svg?path=${encodeURIComponent(savedPath)}`);
  expect(savedResponse.ok()).toBe(true);
  expect(await savedResponse.text()).toContain('aria-label="Seatify preview title"');
});
