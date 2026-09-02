import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { evaluateAgentTransaction } from "../src/client/agent/transaction";
import { parseAgentTransaction, type AgentOperation } from "../src/shared/agent-protocol";

const context = { sessionId: "session-1", sourcePath: "concept.svg", revision: 4 };

function document(source = `
  <svg xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="paint"><stop offset="0" /></linearGradient></defs>
    <g id="group" data-lineage-key="group"><path id="a" data-lineage-key="a" fill="url(#paint)" /></g>
    <path id="b" data-lineage-key="b" />
  </svg>`): SVGSVGElement {
  const window = new Window();
  window.document.body.innerHTML = source;
  return window.document.querySelector("svg") as unknown as SVGSVGElement;
}

function transaction(operations: AgentOperation[], overrides: Partial<typeof context> = {}) {
  const target = { ...context, ...overrides };
  return parseAgentTransaction({
    protocolVersion: 1,
    transactionId: "tx-1",
    producer: { kind: "agent", name: "test" },
    document: { sessionId: target.sessionId, sourcePath: target.sourcePath, baseRevision: target.revision },
    operations,
  });
}

function rejectedCode(root: SVGSVGElement, operations: AgentOperation[], locked = new Set<string>()) {
  const staged = evaluateAgentTransaction(root, transaction(operations), context, locked);
  return staged.result.status === "rejected" ? staged.result.error.code : undefined;
}

describe("detached agent transaction evaluator", () => {
  it("computes semantic current and proposed evidence without mutating the canonical SVG", () => {
    const root = document('<svg><g data-lineage-key="group"><path aria-label="Old &amp; safe" fill="#111" data-lineage-key="a"/><path data-lineage-key="b"/></g></svg>');
    const staged = evaluateAgentTransaction(root, transaction([
      { type: "renameLayer", operationId: "rename", target: { sessionKey: "a" }, name: "<New>" },
      { type: "setPaint", operationId: "paint", target: { sessionKey: "a" }, property: "fill", value: "#fff" },
      { type: "reorderLayer", operationId: "move", target: { sessionKey: "a" }, placement: { after: { sessionKey: "b" } } },
    ]), context);
    expect(staged.evidence).toEqual([
      expect.objectContaining({ operationId: "rename", current: "Old & safe", proposed: "<New>" }),
      expect.objectContaining({ operationId: "paint", current: "#111", proposed: "#fff" }),
      expect.objectContaining({ operationId: "move", current: "Position 1 of 2", proposed: "Position 2 of 2" }),
    ]);
    expect(root.querySelector('[data-lineage-key="a"]')?.getAttribute("aria-label")).toBe("Old & safe");
    expect(root.querySelector('[data-lineage-key="a"]')?.getAttribute("fill")).toBe("#111");
  });

  it("does not confuse hexadecimal paints with local resource references", () => {
    const root = document('<svg xmlns="http://www.w3.org/2000/svg"><g data-lineage-key="logo"><path fill="#000" stroke="#12345678" /></g></svg>');
    const staged = evaluateAgentTransaction(root, transaction([{
      type: "replaceLayer", operationId: "replace", target: { sessionKey: "logo" },
      svg: '<g><path fill="#fff" stroke="#12345678" /></g>',
    }]), context);
    expect(staged.result.status).toBe("staged");
  });
  it("applies every operation sequentially with operation-result references and selection intent", () => {
    const root = document();
    const before = root.outerHTML;
    const staged = evaluateAgentTransaction(root, transaction([
      { type: "addLayer", operationId: "add", parent: { sessionKey: "group" }, placement: "last", svg: '<g id="new"><circle id="dot" /></g>' },
      { type: "replaceLayer", operationId: "replace", target: { operationId: "add" }, svg: '<rect id="replacement" width="4" />' },
      { type: "renameLayer", operationId: "rename", target: { operationId: "replace" }, name: " Replacement " },
      { type: "setPaint", operationId: "paint", target: { operationId: "replace" }, property: "fill", value: "url(#paint)" },
      { type: "reorderLayer", operationId: "reorder", target: { operationId: "replace" }, placement: { before: { sessionKey: "a" } } },
      { type: "selectFocus", operationId: "focus", targets: [{ operationId: "replace" }, { sessionKey: "a" }], primary: { operationId: "replace" }, scope: { sessionKey: "group" } },
    ]), context);

    expect(staged.result.status).toBe("staged");
    expect(root.outerHTML).toBe(before);
    expect(staged.candidate?.querySelector("#group")?.firstElementChild?.id).toBe("replacement");
    expect(staged.candidate?.querySelector("#replacement")?.getAttribute("aria-label")).toBe("Replacement");
    expect(staged.candidate?.querySelector("#replacement")?.getAttribute("fill")).toBe("url(#paint)");
    expect(staged.selection?.targetSessionKeys).toHaveLength(2);
    expect(staged.result.status === "staged" && staged.result.impact).toHaveLength(6);
  });

  it("supports root first/last placement, sibling placement, inherited paint, and navigation-only application", () => {
    const root = document();
    const staged = evaluateAgentTransaction(root, transaction([
      { type: "addLayer", operationId: "first", parent: null, placement: "first", svg: '<path id="first" />' },
      { type: "addLayer", operationId: "after", parent: null, placement: { after: { sessionKey: "b" } }, svg: '<path id="after" />' },
      { type: "setPaint", operationId: "inherit", target: { operationId: "after" }, property: "stroke", value: null },
    ]), context);
    expect(staged.candidate?.firstElementChild?.id).toBe("first");
    expect(staged.candidate?.lastElementChild?.id).toBe("after");
    const navigation = evaluateAgentTransaction(root, transaction([
      { type: "selectFocus", operationId: "focus", targets: [{ sessionKey: "a" }] },
    ]), context);
    expect(navigation.result.status).toBe("applied");
    expect(navigation.candidate?.outerHTML).toBe(root.outerHTML);
  });

  it("rejects stale, missing, ambiguous, locked, invalid placement, and invalid paint targets", () => {
    const root = document();
    const rename: AgentOperation = { type: "renameLayer", operationId: "rename", target: { sessionKey: "a" }, name: "x" };
    const stale = evaluateAgentTransaction(root, transaction([rename], { revision: 3 }), context);
    expect(stale.result.status === "rejected" && stale.result.error.code).toBe("stale_document");
    expect(rejectedCode(root, [{ ...rename, target: { sessionKey: "missing" } }])).toBe("missing_target");
    const duplicate = document('<svg xmlns="http://www.w3.org/2000/svg"><path data-lineage-key="same"/><path data-lineage-key="same"/></svg>');
    expect(rejectedCode(duplicate, [{ ...rename, target: { sessionKey: "same" } }])).toBe("ambiguous_target");
    expect(rejectedCode(root, [rename], new Set(["group"]))).toBe("locked_target");
    expect(rejectedCode(root, [{ type: "reorderLayer", operationId: "move", target: { sessionKey: "a" }, placement: { before: { sessionKey: "b" } } }])).toBe("invalid_reference");
    expect(rejectedCode(root, [{ type: "setPaint", operationId: "paint", target: { sessionKey: "a" }, property: "fill", value: "red; stroke: blue" }])).toBe("invalid_paint");
  });

  it.each([
    '<path><script /></path>',
    '<g><foreignObject /></g>',
    '<g><animate attributeName="x" /></g>',
    '<path onclick="alert(1)" />',
    '<path style="fill:red" />',
    '<path data-lineage-key="spoofed" />',
    '<g><use href="https://example.com/a.svg#x" /></g>',
    '<path fill="url(https://example.com/paint)" />',
  ])("rejects active or external fragment %s", (svg) => {
    const root = document();
    expect(rejectedCode(root, [{ type: "addLayer", operationId: "add", parent: null, placement: "last", svg }])).toBe("unsafe_svg");
  });

  it("rejects invalid/multiple roots, ID collisions, unresolved new references, and broken existing references", () => {
    const root = document();
    expect(rejectedCode(root, [{ type: "addLayer", operationId: "add", parent: null, placement: "last", svg: "<path>" }])).toBe("invalid_svg");
    expect(rejectedCode(root, [{ type: "addLayer", operationId: "add", parent: null, placement: "last", svg: "<path/><path/>" }])).toBe("invalid_svg");
    expect(rejectedCode(root, [{ type: "addLayer", operationId: "add", parent: null, placement: "last", svg: '<path id="a" />' }])).toBe("id_conflict");
    expect(rejectedCode(root, [{ type: "addLayer", operationId: "add", parent: null, placement: "last", svg: '<path fill="url(#missing)" />' }])).toBe("reference_damage");
    const externallyReferenced = document('<svg xmlns="http://www.w3.org/2000/svg"><g id="group" data-lineage-key="group"><path id="a"/></g><use href="#a"/></svg>');
    expect(rejectedCode(externallyReferenced, [{ type: "replaceLayer", operationId: "replace", target: { sessionKey: "group" }, svg: '<g id="other" />' }])).toBe("reference_damage");
  });

  it("permits self-contained resource replacement only inside the explicit replacement boundary", () => {
    const internal = document('<svg xmlns="http://www.w3.org/2000/svg"><g data-lineage-key="logo"><defs><linearGradient id="old-gradient"><stop/></linearGradient></defs><path fill="url(#old-gradient)"/></g></svg>');
    const staged = evaluateAgentTransaction(internal, transaction([{
      type: "replaceLayer", operationId: "replace", target: { sessionKey: "logo" },
      svg: '<g><defs><linearGradient id="new-gradient"><stop/></linearGradient></defs><path fill="url(#new-gradient)"/></g>',
    }]), context);
    expect(staged.result.status).toBe("staged");
    expect(staged.candidate?.querySelector("#old-gradient")).toBeNull();
    expect(staged.candidate?.querySelector("#new-gradient")).not.toBeNull();

    const externalUrl = document('<svg xmlns="http://www.w3.org/2000/svg"><g data-lineage-key="logo"><defs><linearGradient id="old-gradient"><stop/></linearGradient></defs><path fill="url(#old-gradient)"/></g><path fill="url(#old-gradient)"/></svg>');
    expect(rejectedCode(externalUrl, [{ type: "replaceLayer", operationId: "replace", target: { sessionKey: "logo" }, svg: '<g><path/></g>' }])).toBe("reference_damage");
  });

  it("rejects an all-no-op mutation and rolls back a late failure", () => {
    const root = document();
    const before = root.outerHTML;
    expect(rejectedCode(root, [{ type: "renameLayer", operationId: "same", target: { sessionKey: "a" }, name: null }])).toBe("no_op");
    const result = evaluateAgentTransaction(root, transaction([
      { type: "renameLayer", operationId: "rename", target: { sessionKey: "a" }, name: "Changed" },
      { type: "setPaint", operationId: "bad", target: { sessionKey: "b" }, property: "fill", value: "red; stroke: blue" },
    ]), context);
    expect(result.result.status).toBe("rejected");
    expect(root.outerHTML).toBe(before);
  });

  it("preserves untouched unsupported safe content and pre-existing ambiguous references", () => {
    const root = document('<svg xmlns="http://www.w3.org/2000/svg"><defs><symbol id="dup"><path/></symbol><symbol id="dup"><circle/></symbol></defs><use href="#dup"/><path data-lineage-key="target" vector-effect="non-scaling-stroke" data-custom="keep"/><title>Keep me</title></svg>');
    const staged = evaluateAgentTransaction(root, transaction([
      { type: "renameLayer", operationId: "rename", target: { sessionKey: "target" }, name: "Named" },
    ]), context);
    expect(staged.result.status).toBe("staged");
    expect(staged.candidate?.querySelectorAll("#dup")).toHaveLength(2);
    expect(staged.candidate?.querySelector("title")?.textContent).toBe("Keep me");
    expect(staged.candidate?.querySelector("[data-custom]")?.getAttribute("vector-effect")).toBe("non-scaling-stroke");
  });
});
