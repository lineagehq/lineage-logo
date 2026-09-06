import { expect, test } from "@playwright/test";
import { validateLocalProposal } from "../../../src/cli/proposal-validation";

const apiOrigin = "http://127.0.0.1:43117";
const headers = { Authorization: "Bearer lineage-logo-e2e-agent-token" };

test("local validation agrees with real browser fragment namespace rejection without staging", async ({ page, request }) => {
  await page.goto("/");
  const publication = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/agent/document" && response.status() === 200);
  await page.locator('[data-path="concepts/seatify-constellation.svg"]').click();
  await publication;
  const artboard = page.locator("#artboard svg[aria-label='Seatify constellation logo']");
  await expect(artboard).toBeVisible();
  const before = await artboard.evaluate((svg) => svg.outerHTML);
  const manifest = await (await request.get(`${apiOrigin}/api/agent/document`, { headers })).json();
  for (const [index, svg] of [
    '<text xml:space="preserve">a  b</text>',
    '<g><text xml:lang="en">wordmark</text></g>',
    '<g xmlns:x="urn:foreign" x:label="a"/>',
  ].entries()) {
    const proposal = { protocolVersion: 1, transactionId: `namespace-${index}-${Date.now()}`, producer: { kind: "test" }, document: { sessionId: manifest.sessionId, baseRevision: manifest.revision }, operations: [{ type: "addLayer", operationId: "add", parent: null, placement: "last", svg }] };
    expect(() => validateLocalProposal(JSON.stringify(proposal))).toThrow();
    // Exercise the public transaction API directly to verify the independent DOM
    // evaluator's actual result, rather than trusting local parser agreement.
    expect((await request.post(`${apiOrigin}/api/agent/transactions`, { headers, data: { ...proposal, document: { ...proposal.document, sourcePath: manifest.sourcePath } } })).status()).toBe(202);
    await expect.poll(async () => (await (await request.get(`${apiOrigin}/api/agent/transactions/${proposal.transactionId}`, { headers })).json()).status).toBe("rejected");
    const status = await (await request.get(`${apiOrigin}/api/agent/transactions/${proposal.transactionId}`, { headers })).json();
    expect(status.result.error).toMatchObject({ code: "unsafe_svg", operationId: "add" });
    await expect(page.locator("#agent-review-status")).toHaveText("failed");
    await expect(page.locator("#agent-accept")).toBeHidden();
    await expect(page.locator("#agent-review-lock")).toBeHidden();
    expect(await artboard.evaluate((element) => element.outerHTML)).toBe(before);
    expect((await (await request.get(`${apiOrigin}/api/agent/document`, { headers })).json()).revision).toBe(manifest.revision);
  }
});
