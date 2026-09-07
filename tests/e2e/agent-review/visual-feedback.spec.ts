import { expect, test } from "@playwright/test";

const api = "http://127.0.0.1:43117";
const headers = { Authorization: "Bearer lineage-logo-e2e-agent-token" };

for (const width of [1280, 760]) test(`geometry and text comparison returns revision feedback at ${width}px`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: 800 });
  await page.goto("/");
  if (await page.locator("#toggle-left-sidebar").getAttribute("aria-expanded") === "false") await page.locator("#toggle-left-sidebar").click();
  const publication = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/agent/document" && response.ok());
  await page.locator('[data-path="concepts/seatify-constellation.svg"]').click();
  await publication;
  const manifest = await (await request.get(`${api}/api/agent/document`, { headers })).json();
  const title = manifest.layers.find((layer: { name: string }) => layer.name === "Seatify title");
  expect(title).toBeTruthy();
  const before = await page.locator("#artboard svg").first().innerHTML();
  const transactionId = `visual-feedback-${width}-${Date.now()}`;
  const operations = [
    { type: "translateLayer", operationVersion: 1, operationId: "move", target: { sessionKey: title.sessionKey }, dx: 20, dy: 0 },
    { type: "setText", operationVersion: 1, operationId: "words", target: { sessionKey: title.sessionKey }, value: "Seatify revised" },
  ];
  const transaction = { protocolVersion: 1, transactionId, producer: { kind: "test" }, document: { sessionId: manifest.sessionId, sourcePath: manifest.sourcePath, baseRevision: manifest.revision }, operations };
  expect((await request.post(`${api}/api/agent/transactions`, { headers, data: transaction })).status()).toBe(202);
  const comparison = page.locator(".agent-visual-review");
  await expect(comparison).toBeVisible();
  await expect(page.locator("#agent-review")).toBeFocused();
  await expect(comparison.locator("img").first()).toBeInViewport();
  await expect(comparison.locator("img")).toHaveCount(8);
  await expect.poll(() => comparison.locator("img").evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  const sources = await comparison.locator("img").evaluateAll(async (images) => Promise.all([0, 4].map(async (index) => (await fetch((images[index] as HTMLImageElement).src)).text())));
  expect(sources[0]).not.toContain("Seatify revised"); expect(sources[1]).toContain("Seatify revised");
  expect(sources[0].match(/viewBox="([^"]+)"/)?.[1]).toBe(sources[1].match(/viewBox="([^"]+)"/)?.[1]);
  await comparison.getByLabel("Comparison background").selectOption("#1f2937");
  const reason = '<img src=x onerror=alert(1)> Keep the original wording; move only 10 units.';
  await comparison.getByLabel("Revision request").fill(reason);
  await comparison.getByRole("button", { name: "Reject and request revision" }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await (await request.get(`${api}/api/agent/transactions/${transactionId}`, { headers })).json()).status).toBe("reverted");
  const outcome = await (await request.get(`${api}/api/agent/transactions/${transactionId}`, { headers })).json();
  expect(outcome.revisionRequest).toBe(reason);
  expect(await page.locator("#artboard svg").first().innerHTML()).toBe(before);
  expect((await request.post(`${api}/api/agent/transactions`, { headers, data: { ...transaction, operations: [operations[0]] } })).status()).toBe(409);
  const fresh = await (await request.get(`${api}/api/agent/document`, { headers })).json();
  expect((await request.post(`${api}/api/agent/transactions`, { headers, data: { ...transaction, transactionId: `${transactionId}-revised`, document: { sessionId: fresh.sessionId, sourcePath: fresh.sourcePath, baseRevision: fresh.revision }, operations: [{ ...operations[0], dx: 10 }] } })).status()).toBe(202);
  await expect(comparison).toBeVisible();
  await expect(comparison.getByLabel("Revision request")).toHaveValue("");
  await page.locator("#agent-accept").click();
  await expect.poll(async () => (await (await request.get(`${api}/api/agent/transactions/${transactionId}-revised`, { headers })).json()).status).toBe("accepted");
});
