import { expect, test } from "@playwright/test";

const apiOrigin = "http://127.0.0.1:43117";
const token = "lineage-logo-e2e-agent-token";

test("agent Apply-and-save creates one durable continuation while preserving source and undo", async ({ page, request }) => {
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
  const sourceBefore = await (await request.get(`${apiOrigin}/api/svg?path=concepts%2Fseatify-constellation.svg`)).text();
  const manifestResponse = await request.get(`${apiOrigin}/api/agent/document`, { headers: { Authorization: `Bearer ${token}` } });
  expect(manifestResponse.status()).toBe(200);
  const manifest = await manifestResponse.json() as {
    sessionId: string; sourcePath: string; revision: number; layers: Array<{ sessionKey: string; name: string }>;
  };
  expect(manifest.sourcePath).toBe("concepts/seatify-constellation.svg");
  expect(manifest.revision).toBe(0);
  const title = manifest.layers.find((layer) => layer.name === "Seatify title")!;
  const transactionId = `durable-e2e-${Date.now()}`;
  const proposal = {
    protocolVersion: 1, transactionId, producer: { kind: "agent", name: "Durability test" },
    document: { sessionId: manifest.sessionId, sourcePath: manifest.sourcePath, baseRevision: manifest.revision },
    operations: [{ type: "renameLayer", operationId: "rename", target: { sessionKey: title.sessionKey }, name: "Durably saved title" }],
  };
  expect((await request.post(`${apiOrigin}/api/agent/transactions`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, data: proposal,
  })).status()).toBe(202);
  await expect(page.locator("#agent-review-status")).toHaveText("pending");
  await page.locator("#agent-accept").click();
  await expect(page.locator("#agent-review-status")).toHaveText("Saved");
  await expect(page.locator("#agent-review-summary")).toContainText(/^Applied and saved iterations\/.+\.svg as one undoable continuation\.$/);
  await expect(page.locator("#save-iteration")).toBeDisabled();

  const status = await request.get(`${apiOrigin}/api/agent/transactions/${transactionId}`, { headers: { Authorization: `Bearer ${token}` } });
  const receipt = await status.json() as { artifact: { durablePath: string; digest: string } };
  expect(receipt.artifact.durablePath).toMatch(/^iterations\/[A-Za-z0-9._-]+\.svg$/);
  expect(receipt.artifact.digest).toMatch(/^[a-f0-9]{64}$/);
  const workspace = await (await request.get(`${apiOrigin}/api/workspace`)).json() as { files: Array<{ path: string }> };
  expect(workspace.files.filter((file) => file.path === receipt.artifact.durablePath)).toHaveLength(1);
  expect(await (await request.get(`${apiOrigin}/api/svg?path=concepts%2Fseatify-constellation.svg`)).text()).toBe(sourceBefore);

  await page.locator("#undo").click();
  await expect(page.locator("#artboard svg [aria-label='Seatify title']")).toHaveCount(1);
  await expect(page.locator("#save-iteration")).toBeEnabled();
});
