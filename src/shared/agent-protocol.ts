export const AGENT_PROTOCOL_VERSION = 1 as const;
export { AGENT_MAX_PAYLOAD_BYTES, CLEAN_AGENT_SVG_REJECTION_CORPUS, validateCleanAgentSvg } from "./agent-svg-validator.js";
import { AGENT_MAX_PAYLOAD_BYTES } from "./agent-svg-validator.js";
export const AGENT_MAX_OPERATIONS = 100;
export const AGENT_MAX_SOURCE_PATH_CHARACTERS = 4096;
/**
 * Fixed upper bound for an accepted-decision JSON body. Strict XML permits no
 * literal characters whose JSON escaping expands beyond two bytes per raw SVG
 * byte. The additional 128 KiB conservatively covers the 4096-character path
 * at worst-case JSON escaping, the identifier, revision, keys, and punctuation.
 * The SVG validator separately retains its raw 5 MiB UTF-8 ceiling.
 */
export const AGENT_MAX_ACKNOWLEDGEMENT_BYTES = AGENT_MAX_PAYLOAD_BYTES * 2 + 128 * 1024;

export interface AgentProducer {
  kind: string;
  name: string;
  version?: string;
}

export interface AgentDocumentTarget {
  sessionId: string;
  sourcePath: string;
  baseRevision: number;
}

export type LayerRef = { sessionKey: string } | { operationId: string };
export type AddPlacement = "first" | "last" | { before: LayerRef } | { after: LayerRef };
export type ReorderPlacement = { before: LayerRef } | { after: LayerRef };

interface AgentOperationBase { operationId: string }
export interface AddLayerOperation extends AgentOperationBase {
  type: "addLayer";
  parent: LayerRef | null;
  placement: AddPlacement;
  svg: string;
}
export interface ReplaceLayerOperation extends AgentOperationBase {
  type: "replaceLayer";
  target: LayerRef;
  svg: string;
}
export interface RenameLayerOperation extends AgentOperationBase {
  type: "renameLayer";
  target: LayerRef;
  name: string | null;
}
export interface ReorderLayerOperation extends AgentOperationBase {
  type: "reorderLayer";
  target: LayerRef;
  placement: ReorderPlacement;
}
export interface SetPaintOperation extends AgentOperationBase {
  type: "setPaint";
  target: LayerRef;
  property: "fill" | "stroke";
  value: string | null;
}
export interface SelectFocusOperation extends AgentOperationBase {
  type: "selectFocus";
  targets: LayerRef[];
  primary?: LayerRef;
  scope?: LayerRef | null;
}

export type AgentOperation = AddLayerOperation | ReplaceLayerOperation | RenameLayerOperation
  | ReorderLayerOperation | SetPaintOperation | SelectFocusOperation;

export interface AgentTransactionV1 {
  protocolVersion: typeof AGENT_PROTOCOL_VERSION;
  transactionId: string;
  producer: AgentProducer;
  document: AgentDocumentTarget;
  operations: AgentOperation[];
}

export type AgentErrorCode = "invalid_payload" | "payload_too_large" | "unsupported_version"
  | "unknown_operation" | "unknown_field" | "invalid_reference" | "stale_document"
  | "missing_target" | "ambiguous_target" | "locked_target" | "invalid_svg"
  | "unsafe_svg" | "id_conflict" | "reference_damage" | "invalid_paint" | "no_op" | "pending_transaction";

export const AGENT_ERROR_CODES: ReadonlySet<AgentErrorCode> = new Set([
  "invalid_payload", "payload_too_large", "unsupported_version", "unknown_operation", "unknown_field",
  "invalid_reference", "stale_document", "missing_target", "ambiguous_target", "locked_target", "invalid_svg",
  "unsafe_svg", "id_conflict", "reference_damage", "invalid_paint", "no_op", "pending_transaction",
]);

export function isAgentErrorCode(value: unknown): value is AgentErrorCode {
  return typeof value === "string" && AGENT_ERROR_CODES.has(value as AgentErrorCode);
}

export interface AgentTransactionError {
  code: AgentErrorCode;
  message: string;
  operationId?: string;
  path?: string;
}

export type AgentTransactionResult = {
  transactionId: string;
  status: "rejected";
  error: AgentTransactionError;
} | {
  transactionId: string;
  status: "staged" | "applied";
  impact: Array<{ operationId: string; affectedSessionKeys: string[]; resultSessionKey?: string }>;
};

export interface AgentAcceptedArtifact {
  sourcePath: string;
  revision: number;
  svg: string;
}

export type AgentTerminalDecision = {
  transactionId: string;
  status: "accepted";
  artifact: AgentAcceptedArtifact;
} | {
  transactionId: string;
  status: "reverted";
};

export type AgentAcknowledgement = AgentTransactionResult | AgentTerminalDecision;

export interface AgentDocumentManifest {
  sessionId: string;
  sourcePath: string;
  revision: number;
  layers: Array<{ sessionKey: string; name: string; type: string; locked: boolean }>;
}

export type AgentTransportStatus = "queued" | "delivered" | "pending_review" | "accepted"
  | "reverted" | "rejected" | "stale" | "disconnected";

export interface AgentTransactionStatus {
  transactionId: string;
  status: AgentTransportStatus;
  result?: AgentTransactionResult;
  artifact?: AgentAcceptedArtifact;
}

export class AgentProtocolError extends Error {
  readonly detail: AgentTransactionError;
  constructor(detail: AgentTransactionError) {
    super(detail.message);
    this.name = "AgentProtocolError";
    this.detail = detail;
  }
}

const textEncoder = new TextEncoder();
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function fail(code: AgentErrorCode, message: string, path?: string): never {
  throw new AgentProtocolError({ code, message, path });
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid_payload", `${path} must be an object`, path);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, allowed: string[], required: string[], path: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail("unknown_field", `Unknown field ${path}.${key}`, `${path}.${key}`);
  for (const key of required) if (!(key in value)) fail("invalid_payload", `Missing field ${path}.${key}`, `${path}.${key}`);
}

function identifier(value: unknown, path: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) fail("invalid_payload", `${path} must be a 1-128 character identifier`, path);
  return value;
}

function boundedText(value: unknown, path: string, max = 1024): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) fail("invalid_payload", `${path} must be a non-empty string of at most ${max} characters`, path);
  return value;
}

function layerRef(value: unknown, path: string): LayerRef {
  const input = record(value, path);
  const keys = Object.keys(input);
  if (keys.length !== 1 || (keys[0] !== "sessionKey" && keys[0] !== "operationId")) {
    fail("invalid_reference", `${path} must contain exactly one sessionKey or operationId`, path);
  }
  return keys[0] === "sessionKey"
    ? { sessionKey: identifier(input.sessionKey, `${path}.sessionKey`) }
    : { operationId: identifier(input.operationId, `${path}.operationId`) };
}

function placement(value: unknown, path: string, allowEdges: boolean): AddPlacement | ReorderPlacement {
  if (allowEdges && (value === "first" || value === "last")) return value;
  const input = record(value, path);
  const keys = Object.keys(input);
  if (keys.length !== 1 || (keys[0] !== "before" && keys[0] !== "after")) {
    fail("invalid_payload", `${path} must identify a before/after sibling${allowEdges ? " or be first/last" : ""}`, path);
  }
  return keys[0] === "before" ? { before: layerRef(input.before, `${path}.before`) } : { after: layerRef(input.after, `${path}.after`) };
}

function parseOperation(value: unknown, index: number, earlierIds: Set<string>): AgentOperation {
  const path = `operations[${index}]`;
  const input = record(value, path);
  const operationId = identifier(input.operationId, `${path}.operationId`);
  if (earlierIds.has(operationId)) fail("invalid_payload", `Duplicate operationId ${operationId}`, `${path}.operationId`);
  const type = input.type;
  const definitions: Record<string, { allowed: string[]; required: string[] }> = {
    addLayer: { allowed: ["type", "operationId", "parent", "placement", "svg"], required: ["type", "operationId", "parent", "placement", "svg"] },
    replaceLayer: { allowed: ["type", "operationId", "target", "svg"], required: ["type", "operationId", "target", "svg"] },
    renameLayer: { allowed: ["type", "operationId", "target", "name"], required: ["type", "operationId", "target", "name"] },
    reorderLayer: { allowed: ["type", "operationId", "target", "placement"], required: ["type", "operationId", "target", "placement"] },
    setPaint: { allowed: ["type", "operationId", "target", "property", "value"], required: ["type", "operationId", "target", "property", "value"] },
    selectFocus: { allowed: ["type", "operationId", "targets", "primary", "scope"], required: ["type", "operationId", "targets"] },
  };
  if (typeof type !== "string" || !definitions[type]) fail("unknown_operation", `Unknown operation ${String(type)}`, `${path}.type`);
  exact(input, definitions[type].allowed, definitions[type].required, path);
  const ref = (candidate: unknown, refPath: string): LayerRef => {
    const parsed = layerRef(candidate, refPath);
    if ("operationId" in parsed && !earlierIds.has(parsed.operationId)) fail("invalid_reference", `${refPath} must reference an earlier operation`, refPath);
    return parsed;
  };
  const checkedPlacement = (candidate: unknown, placementPath: string, allowEdges: boolean): AddPlacement | ReorderPlacement => {
    const parsed = placement(candidate, placementPath, allowEdges);
    if (typeof parsed === "string") return parsed;
    if ("before" in parsed) return { before: ref(parsed.before, `${placementPath}.before`) };
    return { after: ref(parsed.after, `${placementPath}.after`) };
  };
  let result: AgentOperation;
  if (type === "addLayer") {
    result = { type, operationId, parent: input.parent === null ? null : ref(input.parent, `${path}.parent`), placement: checkedPlacement(input.placement, `${path}.placement`, true), svg: boundedText(input.svg, `${path}.svg`, AGENT_MAX_PAYLOAD_BYTES) } as AddLayerOperation;
  } else if (type === "replaceLayer") {
    result = { type, operationId, target: ref(input.target, `${path}.target`), svg: boundedText(input.svg, `${path}.svg`, AGENT_MAX_PAYLOAD_BYTES) };
  } else if (type === "renameLayer") {
    if (input.name !== null && (typeof input.name !== "string" || input.name.length > 512)) fail("invalid_payload", `${path}.name must be null or at most 512 characters`, `${path}.name`);
    result = { type, operationId, target: ref(input.target, `${path}.target`), name: input.name as string | null };
  } else if (type === "reorderLayer") {
    result = { type, operationId, target: ref(input.target, `${path}.target`), placement: checkedPlacement(input.placement, `${path}.placement`, false) as ReorderPlacement };
  } else if (type === "setPaint") {
    if (input.property !== "fill" && input.property !== "stroke") fail("invalid_payload", `${path}.property must be fill or stroke`, `${path}.property`);
    if (input.value !== null && (typeof input.value !== "string" || input.value.length > 512)) fail("invalid_payload", `${path}.value must be null or at most 512 characters`, `${path}.value`);
    result = { type, operationId, target: ref(input.target, `${path}.target`), property: input.property, value: input.value as string | null };
  } else {
    if (!Array.isArray(input.targets) || input.targets.length === 0 || input.targets.length > 100) fail("invalid_payload", `${path}.targets must contain 1-100 references`, `${path}.targets`);
    result = { type: "selectFocus", operationId, targets: input.targets.map((item, targetIndex) => ref(item, `${path}.targets[${targetIndex}]`)) };
    if ("primary" in input) result.primary = ref(input.primary, `${path}.primary`);
    if ("scope" in input) result.scope = input.scope === null ? null : ref(input.scope, `${path}.scope`);
  }
  earlierIds.add(operationId);
  return result;
}

export function parseAgentTransaction(payload: unknown): AgentTransactionV1 {
  let value = payload;
  let encoded: string;
  if (typeof payload === "string") {
    encoded = payload;
    if (textEncoder.encode(encoded).byteLength > AGENT_MAX_PAYLOAD_BYTES) fail("payload_too_large", "Transaction exceeds the 5 MiB encoded payload limit");
    try { value = JSON.parse(payload) as unknown; } catch { fail("invalid_payload", "Transaction body is not valid JSON"); }
  } else {
    try { encoded = JSON.stringify(payload); } catch { fail("invalid_payload", "Transaction is not JSON-serializable"); }
    if (encoded === undefined) fail("invalid_payload", "Transaction is not JSON-serializable");
    if (textEncoder.encode(encoded).byteLength > AGENT_MAX_PAYLOAD_BYTES) fail("payload_too_large", "Transaction exceeds the 5 MiB encoded payload limit");
  }
  const input = record(value, "transaction");
  exact(input, ["protocolVersion", "transactionId", "producer", "document", "operations"], ["protocolVersion", "transactionId", "producer", "document", "operations"], "transaction");
  if (input.protocolVersion !== AGENT_PROTOCOL_VERSION) fail("unsupported_version", `Unsupported protocol version ${String(input.protocolVersion)}`, "transaction.protocolVersion");
  const producer = record(input.producer, "transaction.producer");
  exact(producer, ["kind", "name", "version"], ["kind", "name"], "transaction.producer");
  const document = record(input.document, "transaction.document");
  exact(document, ["sessionId", "sourcePath", "baseRevision"], ["sessionId", "sourcePath", "baseRevision"], "transaction.document");
  if (!Number.isSafeInteger(document.baseRevision) || Number(document.baseRevision) < 0) fail("invalid_payload", "baseRevision must be a non-negative safe integer", "transaction.document.baseRevision");
  if (!Array.isArray(input.operations) || input.operations.length < 1 || input.operations.length > AGENT_MAX_OPERATIONS) fail("invalid_payload", `operations must contain 1-${AGENT_MAX_OPERATIONS} items`, "transaction.operations");
  const earlierIds = new Set<string>();
  return {
    protocolVersion: AGENT_PROTOCOL_VERSION,
    transactionId: identifier(input.transactionId, "transaction.transactionId"),
    producer: {
      kind: boundedText(producer.kind, "transaction.producer.kind", 128),
      name: boundedText(producer.name, "transaction.producer.name", 128),
      ...(producer.version === undefined ? {} : { version: boundedText(producer.version, "transaction.producer.version", 128) }),
    },
    document: {
      sessionId: identifier(document.sessionId, "transaction.document.sessionId"),
      sourcePath: boundedText(document.sourcePath, "transaction.document.sourcePath", AGENT_MAX_SOURCE_PATH_CHARACTERS),
      baseRevision: Number(document.baseRevision),
    },
    operations: input.operations.map((operation, index) => parseOperation(operation, index, earlierIds)),
  };
}
