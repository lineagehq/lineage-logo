import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { buildPendingReview, outcomeReview } from "../src/client/agent/review";
import type { StagedAgentTransaction } from "../src/client/agent/transaction";
import { serializeSvg } from "../src/client/canvas/editor";
import { parseAgentTransaction } from "../src/shared/agent-protocol";

function svg(source: string): SVGSVGElement {
  const window = new Window();
  window.document.body.innerHTML = source;
  return window.document.querySelector("svg") as unknown as SVGSVGElement;
}

describe("agent pending review", () => {
  it("describes nested, hidden, locked, and multi-selected impacted layers accurately", () => {
    const transaction = parseAgentTransaction({
      protocolVersion: 1, transactionId: "review-1", producer: { kind: "agent", name: "Logo Designer" },
      document: { sessionId: "session", sourcePath: "concept.svg", baseRevision: 0 },
      operations: [
        { type: "renameLayer", operationId: "rename", target: { sessionKey: "nested" }, name: "Nested mark" },
        { type: "setPaint", operationId: "paint", target: { sessionKey: "hidden" }, property: "fill", value: "#f00" },
        { type: "selectFocus", operationId: "focus", targets: [{ sessionKey: "nested" }, { sessionKey: "hidden" }], primary: { sessionKey: "hidden" }, scope: { sessionKey: "group" } },
      ],
    });
    const candidate = svg('<svg><g id="group" display="none" data-lineage-key="group"><path aria-label="Nested mark" data-lineage-key="nested"/><path id="hidden-mark" display="none" data-lineage-key="hidden"/></g></svg>');
    const staged: StagedAgentTransaction = {
      candidate,
      selection: { targetSessionKeys: ["nested", "hidden"], primarySessionKey: "hidden", scopeSessionKey: "group" },
      result: { transactionId: "review-1", status: "staged", impact: [
        { operationId: "rename", affectedSessionKeys: ["nested"] },
        { operationId: "paint", affectedSessionKeys: ["hidden"] },
        { operationId: "focus", affectedSessionKeys: ["nested", "hidden"] },
      ] },
    };
    const review = buildPendingReview(transaction, staged, new Set(["nested"]));
    expect(review.status).toBe("pending");
    expect(review.summary).toContain("2 changes affecting 2 layers");
    expect(review.summary).toContain("Accept or revert before editing.");
    expect(review.layers).toEqual([
      expect.objectContaining({ sessionKey: "nested", name: "Nested mark", type: "path", hidden: true, locked: true, operationIds: ["rename", "focus"] }),
      expect.objectContaining({ sessionKey: "hidden", name: "hidden-mark", hidden: true, locked: false, operationIds: ["paint", "focus"] }),
    ]);
  });

  it.each(["accepted", "reverted", "failed", "stale", "disconnected"] as const)("represents the %s outcome", (status) => {
    const review = outcomeReview(status, "tx");
    expect(review.status).toBe(status);
    expect(review.summary.length).toBeGreaterThan(20);
  });

  it("keeps isolated preview content and review markers out of canonical export", () => {
    const canonical = svg('<svg><path id="accepted" data-lineage-key="accepted" data-lineage-review-highlight="true"/></svg>');
    const candidate = svg('<svg><path id="accepted" data-lineage-key="accepted"/><path id="preview-only" data-lineage-key="new"/></svg>');
    const before = serializeSvg(canonical, true);
    expect(candidate.querySelector("#preview-only")).not.toBeNull();
    expect(before).toContain('id="accepted"');
    expect(before).not.toContain("preview-only");
    expect(before).not.toContain("review-highlight");
    expect(serializeSvg(canonical, true)).toBe(before);
  });
});
