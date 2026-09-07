import { expect, type Page } from "@playwright/test";
export const headers = { Authorization: "Bearer lineage-logo-e2e-agent-token" };
export const layer = (page: Page, name: string) => page.locator(".layer-button").filter({ has: page.locator(".layer-type + span", { hasText: new RegExp(`^${name}$`) }) });
export async function openSeatify(page: Page) {
  await page.goto("/");
  await page.locator('[data-path="concepts/seatify-constellation.svg"]').click();
  await expect(page.locator(".layer-button")).toHaveCount(44);
}
export async function proposeTitle(page: Page, suffix: string) {
  let publication: { sessionId: string; sourcePath: string; revision: number; layers: Array<{name: string;sessionKey: string}> } | undefined;
  await expect.poll(async () => {
    const response = await page.request.get("/api/agent/document", { headers });
    if (!response.ok()) return false;
    publication = await response.json();
    return publication?.sourcePath === await page.locator(".file-button[aria-current='true']").getAttribute("data-path") && publication.layers.some(item => item.name === "Seatify title");
  }).toBe(true);
  const manifest = publication!;
  const transactionId = `quality-${suffix}-${Date.now()}`;
  const response = await page.request.post("http://127.0.0.1:43117/api/agent/transactions", { headers, data: {
    protocolVersion: 1, transactionId, producer: { kind: "test" },
    document: { sessionId: manifest.sessionId, sourcePath: manifest.sourcePath, baseRevision: manifest.revision },
    operations: [{ type: "setText", operationVersion: 1, operationId: "words", target: { sessionKey: manifest.layers.find(item => item.name === "Seatify title")!.sessionKey }, value: "Seatify proposed" }],
  } });
  expect(response.status()).toBe(202);
  await expect(page.locator(".agent-visual-review")).toBeVisible();
  return transactionId;
}
