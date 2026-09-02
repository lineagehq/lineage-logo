import { expect, test } from "@playwright/test";

const apiOrigin = "http://127.0.0.1:43117";
const token = "lineage-logo-e2e-agent-token";

test("agent review exposes escaped computed evidence and keyboard-safe large-proposal disclosure", async ({ page, request }) => {
  await page.goto("/");
  const manifestPublication = page.waitForResponse((response) =>
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/agent/document"
      && response.status() === 200,
  );
  const connectedState = page.evaluate(() => new Promise<string>((resolve) => {
    const status = document.querySelector("#status");
    if (!status) throw new Error("Editor status is unavailable.");
    const inspect = () => {
      if (status.textContent === "Agent connection ready") {
        observer.disconnect();
        resolve(status.textContent);
      }
    };
    const observer = new MutationObserver(inspect);
    observer.observe(status, { childList: true, characterData: true, subtree: true });
    inspect();
  }));
  await page.locator('[data-path="concepts/seatify-constellation.svg"]').click();
  const [publication, connectionStatus] = await Promise.all([manifestPublication, connectedState]);
  expect(publication.status()).toBe(200);
  expect(connectionStatus).toBe("Agent connection ready");
  await expect(page.locator("#artboard svg[aria-label='Seatify constellation logo']")).toBeVisible();
  await page.locator("#layer-search").focus();

  const manifestResponse = await request.get(`${apiOrigin}/api/agent/document`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(manifestResponse.status()).toBe(200);
  const manifest = await manifestResponse.json() as {
    sessionId: string;
    sourcePath: string;
    revision: number;
    layers: Array<{ sessionKey: string; name: string }>;
  };
  expect(manifest.sourcePath).toBe("concepts/seatify-constellation.svg");
  expect(manifest.revision).toBe(0);
  const title = manifest.layers.find((layer) => layer.name === "Seatify title");
  expect(title).toBeTruthy();
  const operations = Array.from({ length: 11 }, (_, index) => ({
    type: "renameLayer",
    operationId: `rename-${index + 1}`,
    target: { sessionKey: title!.sessionKey },
    name: index === 10 ? "<Proposed & safe>" : `Proposed title ${index + 1}`,
  }));
  const transactionId = `semantic-review-${Date.now()}`;
  const submit = await request.post(`${apiOrigin}/api/agent/transactions`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: {
      protocolVersion: 1,
      transactionId,
      producer: { kind: "agent", name: "<img src=x onerror=alert(1)>", version: "2.0" },
      intent: "No visual change <script>alert(1)</script>",
      document: { sessionId: manifest.sessionId, sourcePath: manifest.sourcePath, baseRevision: manifest.revision },
      operations,
    },
  });
  expect(submit.status()).toBe(202);

  const review = page.getByRole("region", { name: "Proposed agent changes" });
  await expect(review).toBeVisible();
  await expect(page.locator("#agent-accept")).toBeFocused();
  await expect(page.locator("#agent-review-summary")).toContainText("11 operations: 11 document changes");
  await expect(page.locator("#agent-review-context")).toContainText("Producer intent (context only): No visual change <script>alert(1)</script>");
  await expect(review.locator("img, script")).toHaveCount(0);
  await expect(review.locator(".agent-operation-group")).toHaveCount(2);
  await expect(review.locator(".agent-operation")).toHaveCount(11);

  const groups = review.locator(".agent-operation-group > summary");
  await groups.first().focus();
  await page.keyboard.press("Enter");
  await expect(review.locator(".agent-operation-group").first()).toHaveAttribute("open", "");
  const firstOperation = review.locator(".agent-operation").first();
  await firstOperation.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(firstOperation).toHaveAttribute("open", "");
  await expect(firstOperation.locator("dt")).toHaveText(["Current", "Proposed", "Context"]);
  await expect(firstOperation.locator("dd").nth(0)).toHaveText("Seatify title");
  await expect(firstOperation.locator("dd").nth(1)).toHaveText("Proposed title 1");

  await page.locator("#agent-revert").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#agent-review-status")).toHaveText("reverted");
  await expect(page.locator("#layer-search")).toBeFocused();
  await expect(page.locator("#artboard svg [aria-label='Seatify title']")).toHaveCount(1);
});
