import { AGENT_MAX_OPERATIONS, AGENT_MAX_PAYLOAD_BYTES, type AgentOperation, type PublicAgentProposalV1 } from "../shared/agent-protocol.js";

const identifier = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$", minLength: 1, maxLength: 128 };
// JSON Schema maxLength counts Unicode code points; v1 string bounds count UTF-16
// code units. Consumers must implement this annotation or use `validate` as well.
const text = (maxLength: number, minLength = 1) => ({
  type: "string", minLength, maxLength, "x-maxUtf16CodeUnits": maxLength,
  description: `v1 additionally limits this string to ${maxLength} UTF-16 code units. Run lineage-logo validate or enforce x-maxUtf16CodeUnits; standard maxLength alone is insufficient for astral characters.`,
});
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const nullable = (schema: unknown) => ({ anyOf: [schema, { type: "null" }] });
const ref = { oneOf: [object({ sessionKey: identifier }), object({ operationId: identifier })] };
const sibling = { oneOf: [object({ before: ref }), object({ after: ref })] };
const operation = (type: string, properties: Record<string, unknown>, required = Object.keys(properties)) => object({ type: { const: type }, operationId: identifier, ...properties }, ["type", "operationId", ...required]);
const target = { sessionKey: "layer-1" };
export const PROPOSAL_EXAMPLES: PublicAgentProposalV1[] = ([
  { type: "addLayer", operationId: "add", parent: null, placement: "last", svg: '<g id="new-mark"><circle cx="32" cy="32" r="24" fill="#2255aa"/></g>' },
  { type: "replaceLayer", operationId: "replace", target, svg: '<g id="new-mark"><rect width="48" height="48" fill="#2255aa"/></g>' },
  { type: "renameLayer", operationId: "rename", target, name: "Brand mark" },
  { type: "reorderLayer", operationId: "reorder", target, placement: { after: { sessionKey: "layer-2" } } },
  { type: "setPaint", operationId: "paint", target, property: "fill", value: "#2255aa" },
  { type: "selectFocus", operationId: "focus", targets: [target], primary: target, scope: null },
] satisfies AgentOperation[]).map((op) => ({ protocolVersion: 1, transactionId: `example-${op.type}`, producer: { kind: "local-producer" }, document: { sessionId: "replace-with-context-session", baseRevision: 0 }, operations: [op] }));

/** JSON Schema covers structure; the local runtime validator additionally checks UTF-16 text bounds, ordered references, UTF-8 bytes and SVG safety. */
export const PUBLIC_PROPOSAL_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:lineage-logo:public-proposal:v1",
  title: "Lineage Logo public proposal v1",
  description: "Run lineage-logo validate for UTF-16 text bounds (x-maxUtf16CodeUnits), ordered-reference, encoded-byte and SVG/paint policy checks. Standard maxLength measures Unicode code points and is only a necessary bound, not full v1 text conformance. Live target, lock, conflict and no-op checks require the selected editor. Existing v1 producers remain supported.",
  "x-maxEncodedBytes": AGENT_MAX_PAYLOAD_BYTES,
  ...object({
    protocolVersion: { const: 1 }, transactionId: identifier,
    producer: object({ kind: text(128), name: text(128), version: text(128) }, ["kind"]),
    intent: text(1024),
    document: object({ sessionId: identifier, baseRevision: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER } }),
    operations: { type: "array", minItems: 1, maxItems: AGENT_MAX_OPERATIONS, items: { oneOf: [
      operation("addLayer", { parent: nullable(ref), placement: { anyOf: [{ enum: ["first", "last"] }, sibling] }, svg: text(AGENT_MAX_PAYLOAD_BYTES) }),
      operation("replaceLayer", { target: ref, svg: text(AGENT_MAX_PAYLOAD_BYTES) }),
      operation("renameLayer", { target: ref, name: nullable(text(512, 0)) }),
      operation("reorderLayer", { target: ref, placement: sibling }),
      operation("setPaint", { target: ref, property: { enum: ["fill", "stroke"] }, value: nullable(text(512, 0)) }),
      operation("selectFocus", { targets: { type: "array", minItems: 1, maxItems: 100, items: ref }, primary: ref, scope: nullable(ref) }, ["targets"]),
    ] } },
  }, ["protocolVersion", "transactionId", "producer", "document", "operations"]),
  examples: PROPOSAL_EXAMPLES,
};
