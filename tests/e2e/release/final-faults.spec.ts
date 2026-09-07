import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { headers, layer, openSeatify, proposeTitle } from "./journey-helpers";

const sourcePath = "concepts/seatify-constellation.svg";
const title = (page: Page) => page.locator('#artboard [aria-label="Seatify title"]');
const source = async (page: Page, file = sourcePath) => (await page.request.get(`/api/svg?path=${encodeURIComponent(file)}`)).text();
const files = async (page: Page): Promise<string[]> => {
  const workspace = await (await page.request.get("/api/workspace")).json();
  return workspace.files.map((file: { path: string }) => file.path).sort();
};
type Manifest = { sessionId: string; sourcePath: string; revision: number; layers: Array<{ name: string; sessionKey: string }> };
async function trackDocument(page: Page) {
  let posted: Manifest | undefined;
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/agent/document" && request.method() === "POST") posted = request.postDataJSON();
  });
  await openSeatify(page);
  return async () => {
    let manifest: Manifest | undefined;
    await expect.poll(async () => {
      const response = await page.request.get("/api/agent/document", { headers });
      if (!response.ok() || !posted) return false;
      manifest = await response.json();
      return manifest!.sessionId === posted.sessionId && manifest!.revision === posted.revision && manifest!.sourcePath === sourcePath;
    }).toBe(true);
    return manifest!;
  };
}
const state = async (page: Page, id: string) => (await page.request.get(`/api/agent/transactions/${id}`, { headers })).json();
async function submit(page: Page, manifest: Manifest, suffix: string) {
  const transactionId = `final-fault-${suffix}-${Date.now()}`;
  const response = await page.request.post("http://127.0.0.1:43117/api/agent/transactions", { headers, data: {
    protocolVersion: 1, transactionId, producer: { kind: "test" },
    document: { sessionId: manifest.sessionId, sourcePath: manifest.sourcePath, baseRevision: manifest.revision },
    operations: [{ type: "setText", operationVersion: 1, operationId: "words", target: { sessionKey: manifest.layers.find(item => item.name === "Seatify title")!.sessionKey }, value: "Must not apply" }],
  } });
  expect(response.status()).toBe(202);
  return transactionId;
}

test("stale and locked agent targets preserve manual artwork, source bytes and Undo history", async ({ page }) => {
  const current = await trackDocument(page), initial = await current();
  const original = await source(page), beforeFiles = await files(page);
  await layer(page, "Seatify title").click();
  await page.locator("#fill").fill("#a43366"); await page.locator("#fill").press("Enter");
  await expect(title(page)).toHaveAttribute("fill", "#a43366");
  await expect.poll(async () => (await current()).revision).toBeGreaterThan(initial.revision);
  const stale = await submit(page, initial, "stale");
  await expect.poll(async () => (await state(page, stale)).status).toBe("stale");
  expect((await state(page, stale)).result.error.code).toBe("stale_document");
  await expect(title(page)).toHaveText("seatify"); await expect(title(page)).toHaveAttribute("fill", "#a43366");
  await expect(page.locator("#agent-accept")).not.toBeVisible();
  expect(await files(page)).toEqual(beforeFiles); expect(await source(page)).toBe(original);
  await page.locator("#lock-selection").click(); await expect(page.locator("#lock-selection")).toHaveText("Unlock");
  const locked = await submit(page, await current(), "locked");
  await expect.poll(async () => (await state(page, locked)).status).toBe("rejected");
  expect((await state(page, locked)).result.error.code).toBe("locked_target");
  await expect(title(page)).toHaveText("seatify"); await expect(title(page)).toHaveAttribute("fill", "#a43366");
  await expect(page.locator("#agent-accept")).not.toBeVisible();
  await page.locator("#lock-selection").click();
  await page.locator("#undo").click(); await expect(title(page)).not.toHaveAttribute("fill", "#a43366");
  await page.locator("#redo").click(); await expect(title(page)).toHaveAttribute("fill", "#a43366");
  expect(await files(page)).toEqual(beforeFiles); expect(await source(page)).toBe(original);
});

test("failed agent save exposes retry and commits exactly one undoable saved artifact", async ({ page }) => {
  await openSeatify(page);
  const original = await source(page), beforeFiles = await files(page);
  await layer(page, "Seatify title").click();
  await page.locator("#fill").fill("#a43366"); await page.locator("#fill").press("Enter");
  const transaction = await proposeTitle(page, "save-failure");
  let failedRequests = 0;
  // Refuse the save request before it reaches the server, including automatic retries.
  const acknowledgement = `**/api/agent/transactions/${transaction}/ack`;
  await page.route(acknowledgement, async route => {
    if (route.request().postDataJSON().status === "accepted") {
      failedRequests++;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Injected save service unavailable" }) });
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Accept and save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry save", exact: true })).toBeEnabled();
  await expect(page.locator("#agent-review-status")).toHaveText("Applied—not saved");
  expect(failedRequests).toBe(3);
  await expect(title(page)).toHaveText("Seatify proposed"); await expect(title(page)).toHaveAttribute("fill", "#a43366");
  await expect(page.locator("#save-iteration")).toBeDisabled();
  expect((await state(page, transaction)).status).toBe("pending_review");
  expect(await files(page)).toEqual(beforeFiles); expect(await source(page)).toBe(original);
  await page.unroute(acknowledgement);
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect.poll(async () => (await state(page, transaction)).status).toBe("accepted");
  const accepted = await state(page, transaction), savedPath: string = accepted.artifact.durablePath;
  await expect(page.locator('.file-button[aria-current="true"]')).toHaveAttribute("data-path", savedPath);
  const saved = await source(page, savedPath);
  expect(createHash("sha256").update(saved).digest("hex")).toBe(accepted.artifact.digest);
  expect(saved).toContain("Seatify proposed"); expect(saved).toContain("#a43366");
  expect((await files(page)).filter(file => !beforeFiles.includes(file))).toEqual([savedPath]);
  await page.locator("#undo").click(); await expect(title(page)).toHaveText("seatify"); await expect(title(page)).toHaveAttribute("fill", "#a43366");
  await page.locator("#undo").click(); await expect(title(page)).not.toHaveAttribute("fill", "#a43366");
  await page.locator("#redo").click(); await expect(title(page)).toHaveAttribute("fill", "#a43366");
  await page.locator("#redo").click(); await expect(title(page)).toHaveText("Seatify proposed");
  expect(await source(page, savedPath)).toBe(saved); expect(await source(page)).toBe(original);
  expect((await files(page)).filter(file => !beforeFiles.includes(file))).toEqual([savedPath]);
});

test("disconnect and reload during pending review preserves the base and permits explicit rejection", async ({ page, context }) => {
  await openSeatify(page);
  const original = await source(page), beforeFiles = await files(page);
  await layer(page, "Seatify title").click();
  await page.locator("#fill").fill("#a43366"); await page.locator("#fill").press("Enter");
  const transaction = await proposeTitle(page, "review-disconnect");
  await expect(title(page)).toHaveText("seatify");
  await context.setOffline(true);
  await page.reload().catch(() => {});
  await context.setOffline(false);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Accept and save", exact: true })).toBeVisible();
  expect((await state(page, transaction)).status).toBe("pending_review");
  await expect(title(page)).toHaveText("seatify"); await expect(title(page)).toHaveAttribute("fill", "#a43366");
  await page.getByLabel("Revision request", { exact: true }).fill("Preserve manual color; keep the current words.");
  await page.getByRole("button", { name: "Reject and request revision", exact: true }).click();
  await expect.poll(async () => (await state(page, transaction)).status).toBe("reverted");
  expect((await state(page, transaction)).revisionRequest).toBe("Preserve manual color; keep the current words.");
  await expect(title(page)).toHaveText("seatify"); await expect(title(page)).toHaveAttribute("fill", "#a43366");
  await expect(page.locator("#save-iteration")).toBeEnabled();
  expect(await files(page)).toEqual(beforeFiles); expect(await source(page)).toBe(original);
});
