import { afterEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { AgentVisualReview, comparisonSources } from "../src/client/agent/visual-review";
import { parseRevisionRequest } from "../src/shared/agent-protocol";

const accepted = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"><rect width="20" height="20"/><text x="10" y="40">Before</text></svg>';
const proposed = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 0 150 100"><rect x="30" width="40" height="20"/><text x="10" y="40">After</text></svg>';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function dom() { const window = new Window(); vi.stubGlobal("DOMParser", window.DOMParser); vi.stubGlobal("document", window.document); return window; }

describe("visual agent comparison", () => {
  it("preserves actual geometry/text differences while giving both images one frame", () => {
    dom();
    const result = comparisonSources({ transactionId: "one", acceptedSvg: accepted, proposedSvg: proposed });
    expect(result.accepted).toContain('viewBox="-20 0 150 100"');
    expect(result.proposed).toContain('viewBox="-20 0 150 100"');
    expect(result.accepted).toContain('width="20"'); expect(result.accepted).toContain("Before");
    expect(result.proposed).toContain('x="30"'); expect(result.proposed).toContain("After");
    expect(() => comparisonSources({ transactionId: "one", acceptedSvg: accepted, proposedSvg: '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>' })).toThrow();
  });
  it("keeps rejected reason as text, preserves retry input, and resets only for fresh identity", async () => {
    const window = dom(); const host = window.document.createElement("section"); window.document.body.append(host);
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const reject = vi.fn().mockRejectedValue(new Error("Connection interrupted; retry."));
    const review = new AgentVisualReview(host as unknown as HTMLElement, reject);
    const input = { transactionId: "one", acceptedSvg: accepted, proposedSvg: proposed };
    review.update(input);
    expect(host.querySelectorAll("img")).toHaveLength(8);
    const initialUrls = [...new Set(Array.from(host.querySelectorAll("img"), (image) => image.src))];
    expect(initialUrls).toHaveLength(2);
    expect(initialUrls.every((url) => url.startsWith("blob:"))).toBe(true);
    const textarea = host.querySelector("textarea")!;
    const reason = '<script>alert(1)</script> Keep words'; textarea.value = reason;
    host.querySelector("button")!.click();
    await vi.waitFor(() => expect(reject).toHaveBeenCalledWith(reason));
    await vi.waitFor(() => expect(host.textContent).toContain("Connection interrupted"));
    review.update(input); expect(revoke).not.toHaveBeenCalled(); expect(textarea.value).toBe(reason); expect(host.querySelector("script")).toBeNull();
    review.update({ ...input, transactionId: "two" }); expect(textarea.value).toBe("");
    for (const url of initialUrls) expect(revoke).toHaveBeenCalledWith(url);
    const replacementUrls = [...new Set(Array.from(host.querySelectorAll("img"), (image) => image.src))];
    review.update(undefined);
    for (const url of replacementUrls) expect(revoke).toHaveBeenCalledWith(url);
    expect(host.querySelectorAll("img")).toHaveLength(0);
  });
  it("bounds feedback without treating markup as instructions", () => {
    expect(parseRevisionRequest('<b>Move left</b>')).toBe('<b>Move left</b>');
    for (const value of ["", " ", "x".repeat(1001), "x\u0000", {}]) expect(() => parseRevisionRequest(value)).toThrow();
  });
});
