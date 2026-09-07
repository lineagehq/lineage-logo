import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { layer, openSeatify, proposeTitle } from "./journey-helpers";

async function audit(page: Page, state: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const failures = result.violations.filter(item => item.impact === "serious" || item.impact === "critical");
  expect(failures.map(item => ({ rule: item.id, impact: item.impact, targets: item.nodes.map(node => node.target) })), `Axe serious/critical findings in ${state}`).toEqual([]);
}

test("empty, editing, multi-selection and recovery expose accessible controls", async ({ page }) => {
  await page.goto("/");
  await audit(page, "empty editor");
  const create = page.getByRole("button", { name: "Create a logo", exact: true });
  await create.focus(); await create.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await audit(page, "creation dialog");
  await page.keyboard.press("Escape"); await expect(create).toBeFocused();
  await page.locator('[data-path="concepts/seatify-constellation.svg"]').click();
  await layer(page, "Seatify title").focus(); await page.keyboard.press("Enter");
  await audit(page, "editing");
  await layer(page, "Seatify tagline").click({ modifiers: ["Shift"] });
  await expect(page.locator(".layer-button[aria-pressed='true']")).toHaveCount(2);
  await audit(page, "multi-selection");
  await layer(page, "Seatify title").click();
  await page.locator("#fill").fill("#b43355"); await page.locator("#fill").press("Enter");
  await page.reload(); await expect(page.locator("#manual-draft-dialog")).toBeVisible();
  await audit(page, "manual recovery");
  await expect(page.locator("#manual-draft-dialog")).toContainText("Restore");
  await page.locator("#manual-draft-restore").focus(); await page.keyboard.press("Enter");
  await expect(page.locator("#manual-draft-dialog")).not.toBeVisible();
  await expect(page.locator('#artboard [aria-label="Seatify title"]')).toHaveAttribute("fill", "#b43355");
});

test("agent comparison and export dialog pass accessibility checks with keyboard return", async ({ page }) => {
  await openSeatify(page); await proposeTitle(page, "accessibility");
  await expect(page.locator("#agent-review")).toBeFocused();
  await audit(page, "agent review");
  await page.getByLabel("Revision request", { exact: true }).fill("Keep original");
  await page.getByRole("button", { name: "Reject and request revision", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".agent-visual-review")).not.toBeVisible();
  const exportButton = page.locator("#save-version-export");
  await exportButton.focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Save a named version or export" });
  await expect(dialog).toBeVisible(); await audit(page, "export");
  await dialog.getByRole("combobox", { name: "Format", exact: true }).selectOption("png");
  await audit(page, "PNG export");
  await page.keyboard.press("Escape"); await expect(exportButton).toBeFocused();
});
