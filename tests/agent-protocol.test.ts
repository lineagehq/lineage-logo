import { describe, expect, it } from "vitest";
import {
  AGENT_MAX_PAYLOAD_BYTES, AgentProtocolError, CLEAN_AGENT_SVG_REJECTION_CORPUS, isAgentErrorCode, parseAgentTransaction, validateCleanAgentSvg,
} from "../src/shared/agent-protocol";

function envelope(operations: unknown[] = [{ type: "renameLayer", operationId: "rename", target: { sessionKey: "element-1" }, name: "Mark" }]) {
  return {
    protocolVersion: 1,
    transactionId: "tx-1",
    producer: { kind: "logo-agent", name: "Logo Designer", version: "1.2.3" },
    document: { sessionId: "session-1", sourcePath: "concepts/one.svg", baseRevision: 3 },
    operations,
  };
}

function codeFor(value: unknown): string | undefined {
  try { parseAgentTransaction(value); } catch (error) { return (error as AgentProtocolError).detail.code; }
  return undefined;
}

describe("agent protocol v1", () => {
  it("validates clean standalone SVG without repairing malformed or metadata-bearing artifacts", () => {
    expect(() => validateCleanAgentSvg('<svg xmlns="http://www.w3.org/2000/svg"><g id="logo"><path d="M0 0h1" /></g></svg>')).not.toThrow();
    for (const entry of CLEAN_AGENT_SVG_REJECTION_CORPUS) expect(() => validateCleanAgentSvg(entry.svg), entry.name).toThrow();
    for (const malformed of ["<!DOCTYPE svg><svg></svg>", '<svg><path data-agent-review="accepted" /></svg>']) {
      expect(() => validateCleanAgentSvg(malformed)).toThrow();
    }
  });

  it("keeps the protocol error-code vocabulary closed", () => {
    expect(isAgentErrorCode("stale_document")).toBe(true);
    expect(isAgentErrorCode("invented_error")).toBe(false);
  });

  it("parses all operation forms and earlier operation-result references", () => {
    const parsed = parseAgentTransaction(envelope([
      { type: "addLayer", operationId: "add", parent: null, placement: "last", svg: '<g id="new"><path /></g>' },
      { type: "replaceLayer", operationId: "replace", target: { operationId: "add" }, svg: '<path id="replacement" />' },
      { type: "renameLayer", operationId: "rename", target: { operationId: "replace" }, name: null },
      { type: "reorderLayer", operationId: "reorder", target: { operationId: "replace" }, placement: { before: { sessionKey: "element-1" } } },
      { type: "setPaint", operationId: "paint", target: { operationId: "replace" }, property: "fill", value: "url(#paint)" },
      { type: "selectFocus", operationId: "focus", targets: [{ operationId: "replace" }], primary: { operationId: "replace" }, scope: null },
    ]));
    expect(parsed.operations.map((operation) => operation.type)).toEqual(["addLayer", "replaceLayer", "renameLayer", "reorderLayer", "setPaint", "selectFocus"]);
  });

  it.each([
    ["unsupported_version", { ...envelope(), protocolVersion: 2 }],
    ["unknown_operation", envelope([{ type: "deleteEverything", operationId: "bad" }])],
    ["unknown_field", { ...envelope(), extra: true }],
    ["unknown_field", envelope([{ type: "renameLayer", operationId: "rename", target: { sessionKey: "element-1" }, name: "x", surprise: true }])],
    ["invalid_reference", envelope([{ type: "replaceLayer", operationId: "replace", target: { operationId: "later" }, svg: "<path />" }])],
    ["invalid_reference", envelope([{ type: "addLayer", operationId: "add", parent: null, placement: { before: { operationId: "later" } }, svg: "<path />" }])],
    ["invalid_payload", envelope([])],
    ["invalid_payload", envelope([{ type: "renameLayer", operationId: "same", target: { sessionKey: "element-1" }, name: "x" }, { type: "renameLayer", operationId: "same", target: { sessionKey: "element-1" }, name: "y" }])],
  ])("rejects %s", (expected, payload) => expect(codeFor(payload)).toBe(expected));

  it("rejects malformed JSON and encoded payloads larger than 5 MiB", () => {
    expect(codeFor("{")) .toBe("invalid_payload");
    expect(codeFor("x".repeat(AGENT_MAX_PAYLOAD_BYTES + 1))).toBe("payload_too_large");
  });
});
