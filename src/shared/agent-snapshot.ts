import { SaxesParser } from "saxes";
import { AGENT_MAX_PAYLOAD_BYTES } from "./agent-protocol.js";

export const SNAPSHOT_MAX_BYTES = 12 * 1024 * 1024;
export const SNAPSHOT_MAX_LAYERS = 5000;
export const SNAPSHOT_TIMEOUT_MS = 5000;
export type SnapshotErrorCode = "invalid_snapshot" | "snapshot_too_large" | "stale_snapshot" | "pending_review" | "snapshot_unavailable" | "snapshot_timeout" | "snapshot_busy" | "unsupported_snapshot";
export class SnapshotError extends Error {
  constructor(readonly code: SnapshotErrorCode) { super(code); }
}
export const SNAPSHOT_ERROR_CODES = new Set<SnapshotErrorCode>(["invalid_snapshot", "snapshot_too_large", "stale_snapshot", "pending_review", "snapshot_unavailable", "snapshot_timeout", "snapshot_busy", "unsupported_snapshot"]);
export interface AgentSnapshotRequest { schemaVersion: 1; requestId: string; serverInstanceId: string; editorId: string; sessionId: string; baseRevision: number }
export type SnapshotBounds = { status: "available"; x: number; y: number; width: number; height: number } | { status: "unsupported"; reason: "unavailable" | "hidden" | "no-viewbox" };
export interface SnapshotPaint { explicit: string | null; computed: string | null }
export interface SnapshotLayer {
  layerId: string;
  svgId: string | null;
  /** Element-child indexes from the clean SVG root; stable even for id-less nodes. */
  svgPath: number[];
  parentLayerId: string | null;
  type: string;
  name: string;
  hidden: boolean;
  locked: boolean;
  transform: string | null;
  matrix: number[] | null;
  bounds: SnapshotBounds;
  paint: { fill: SnapshotPaint; stroke: SnapshotPaint; strokeWidth: SnapshotPaint; opacity: SnapshotPaint };
}
export interface AgentSnapshotProjection {
  schemaVersion: 1;
  sessionId: string;
  baseRevision: number;
  svg: string;
  documentBounds: SnapshotBounds;
  selectedLayerIds: string[];
  primaryLayerId: string | null;
  layers: SnapshotLayer[];
}
export interface AgentSnapshot extends AgentSnapshotProjection { requestId: string; instanceId: string; workspaceId: string; editorId: string; serverInstanceId: string; digest: string }
export type AgentSnapshotReply = { request: AgentSnapshotRequest; projection: AgentSnapshotProjection } | { request: AgentSnapshotRequest; error: SnapshotErrorCode };
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function bad(): never { throw new SnapshotError("invalid_snapshot"); }
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) bad();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key))) bad();
  return record;
}
function string(value: unknown, max = 512): string { if (typeof value !== "string" || value.length > max) bad(); return value; }
function id(value: unknown): string { const result = string(value, 128); if (!ID.test(result)) bad(); return result; }
function uuid(value: unknown): string { const result = string(value, 36); if (!UUID.test(result)) bad(); return result; }
function number(value: unknown): number { if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e12) bad(); return value; }
function revision(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0) bad(); return Number(value); }
function nullableText(value: unknown, max = 512): string | null { return value === null ? null : string(value, max); }
export function snapshotPayloadSize(value: unknown): void {
  let encoded: string | undefined;
  try { encoded = JSON.stringify(value); } catch { bad(); }
  if (encoded === undefined) bad();
  if (new TextEncoder().encode(encoded).byteLength > SNAPSHOT_MAX_BYTES) throw new SnapshotError("snapshot_too_large");
}
export function parseSnapshotRequest(value: unknown): AgentSnapshotRequest {
  const input = exact(value, ["schemaVersion", "requestId", "serverInstanceId", "editorId", "sessionId", "baseRevision"]);
  if (input.schemaVersion !== 1) bad();
  return { schemaVersion: 1, requestId: uuid(input.requestId), serverInstanceId: uuid(input.serverInstanceId), editorId: uuid(input.editorId), sessionId: id(input.sessionId), baseRevision: revision(input.baseRevision) };
}
function bounds(value: unknown): SnapshotBounds {
  if ((value as { status?: unknown })?.status === "unsupported") {
    const input = exact(value, ["status", "reason"]);
    if (!["unavailable", "hidden", "no-viewbox"].includes(String(input.reason))) bad();
    return input as unknown as SnapshotBounds;
  }
  const input = exact(value, ["status", "x", "y", "width", "height"]);
  if (input.status !== "available" || number(input.width) < 0 || number(input.height) < 0) bad();
  return { status: "available", x: number(input.x), y: number(input.y), width: number(input.width), height: number(input.height) };
}
/** Snapshot export accepts passive styling while preserving exact input bytes.
 * CSS escapes, at-rules and external resources are deliberately unsupported.
 * This validates an export; it never inserts the supplied SVG into a page.
 */
export function validateSnapshotSvg(svg: string): void {
  const parser = new SaxesParser({ xmlns: true, defaultXMLVersion: "1.0", forceXMLVersion: true });
  let depth = 0, rootSeen = false, inStyle = false, css = "";
  const reject = (): never => { throw new SnapshotError("unsupported_snapshot"); };
  const passive = (value: string, cssText = false) => {
    const clean = cssText ? value.replace(/\/\*[\s\S]*?\*\//g, "") : value;
    if (clean.includes("\\") || (cssText && /@|expression\s*\(|-moz-binding|behavior\s*:/i.test(clean))) reject();
    for (const match of clean.matchAll(/url\(\s*([^)]*)\)/gi)) {
      if (!/^(["']?)#[^\s"'()]+\1$/.test(match[1].trim())) reject();
    }
    if (/(?:^|[\s('"=])(?:https?|file|data|javascript):|^\/\//i.test(clean)) reject();
  };
  parser.on("error", reject);
  parser.on("doctype", reject);
  parser.on("processinginstruction", reject);
  parser.on("xmldecl", value => { if (value.version !== "1.0" || (value.encoding && value.encoding.toLowerCase() !== "utf-8")) reject(); });
  parser.on("opentag", tag => {
    if (inStyle || tag.prefix || tag.uri !== "http://www.w3.org/2000/svg") reject();
    if (depth === 0) { if (tag.local !== "svg" || rootSeen) reject(); rootSeen = true; }
    if (/^(?:a|animate.*|discard|foreignObject|handler|iframe|link|listener|object|script|set)$/.test(tag.local)) reject();
    for (const attr of Object.values(tag.attributes)) {
      if (/^on/i.test(attr.local) || /^data-(?:lineage|agent|review|transport)-/i.test(attr.name)) reject();
      if (attr.uri === "http://www.w3.org/2000/xmlns/") {
        if (!(attr.name === "xmlns" && attr.value === "http://www.w3.org/2000/svg") && !(attr.name === "xmlns:xlink" && attr.value === "http://www.w3.org/1999/xlink")) reject();
        continue;
      }
      if (attr.uri && !(attr.uri === "http://www.w3.org/1999/xlink" && attr.local === "href") && !(attr.uri === "http://www.w3.org/XML/1998/namespace" && ["lang", "space"].includes(attr.local))) reject();
      if (["href", "src"].includes(attr.local) && !/^#[^\s]+$/.test(attr.value)) reject();
      if (attr.local === "class" && /(?:^|\s)svg_select(?:_|\s|$)/.test(attr.value)) reject();
      if (tag.local === "metadata" && attr.name === "id" && attr.value === "lineage-logo-edit") reject();
      passive(attr.value, attr.name === "style");
    }
    inStyle = tag.local === "style"; css = ""; depth++;
  });
  parser.on("text", value => { if (inStyle) css += value; });
  parser.on("cdata", value => { if (inStyle) css += value; });
  parser.on("closetag", () => { if (inStyle) passive(css, true); inStyle = false; depth--; });
  parser.write(svg).close();
  if (!rootSeen || depth !== 0) reject();
}
const projectionKeys = ["schemaVersion", "sessionId", "baseRevision", "svg", "documentBounds", "selectedLayerIds", "primaryLayerId", "layers"];
export function parseSnapshotProjection(value: unknown): AgentSnapshotProjection {
  snapshotPayloadSize(value);
  const input = exact(value, projectionKeys);
  if (input.schemaVersion !== 1) bad();
  const svg = string(input.svg, AGENT_MAX_PAYLOAD_BYTES);
  if (new TextEncoder().encode(svg).byteLength > AGENT_MAX_PAYLOAD_BYTES) throw new SnapshotError("snapshot_too_large");
  try { validateSnapshotSvg(svg); } catch { throw new SnapshotError("unsupported_snapshot"); }
  if (!Array.isArray(input.layers) || input.layers.length > SNAPSHOT_MAX_LAYERS) throw new SnapshotError("snapshot_too_large");
  const seen = new Set<string>();
  const paths = new Set<string>();
  const layers = input.layers.map(raw => {
    const layer = exact(raw, ["layerId", "svgId", "svgPath", "parentLayerId", "type", "name", "hidden", "locked", "transform", "matrix", "bounds", "paint"]);
    const layerId = id(layer.layerId);
    if (seen.has(layerId)) bad();
    const parentLayerId = layer.parentLayerId === null ? null : id(layer.parentLayerId);
    if (parentLayerId !== null && !seen.has(parentLayerId)) bad();
    seen.add(layerId);
    if (!Array.isArray(layer.svgPath) || !layer.svgPath.length || layer.svgPath.length > 128 || layer.svgPath.some(n => !Number.isSafeInteger(n) || n < 0 || n > 100000)) bad();
    const svgPath = layer.svgPath as number[];
    if (paths.has(svgPath.join("/"))) bad(); paths.add(svgPath.join("/"));
    if (typeof layer.hidden !== "boolean" || typeof layer.locked !== "boolean") bad();
    if (layer.matrix !== null && (!Array.isArray(layer.matrix) || layer.matrix.length !== 6)) bad();
    const paintInput = exact(layer.paint, ["fill", "stroke", "strokeWidth", "opacity"]);
    const paint = Object.fromEntries(Object.entries(paintInput).map(([key, raw]) => {
      const item = exact(raw, ["explicit", "computed"]);
      return [key, { explicit: nullableText(item.explicit), computed: nullableText(item.computed) }];
    })) as SnapshotLayer["paint"];
    const type = string(layer.type, 20);
    if (!["g", "path", "rect", "circle", "ellipse", "polygon", "polyline", "line", "text"].includes(type)) bad();
    return { layerId, svgId: nullableText(layer.svgId), svgPath, parentLayerId, type, name: string(layer.name), hidden: layer.hidden, locked: layer.locked, transform: nullableText(layer.transform, 4096), matrix: layer.matrix === null ? null : (layer.matrix as unknown[]).map(number), bounds: bounds(layer.bounds), paint };
  });
  // Verify every stable key points to its declared element in the exact clean SVG.
  const elements = new Map<string, { type: string; svgId: string | null }>();
  const stack: Array<{ path: number[]; next: number }> = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", tag => {
    const parent = stack.at(-1);
    const path = parent ? [...parent.path, parent.next++] : [];
    elements.set(path.join("/"), { type: tag.local, svgId: tag.attributes.id?.value ?? null });
    stack.push({ path, next: 0 });
  });
  parser.on("closetag", () => { stack.pop(); });
  try { parser.write(svg).close(); } catch { bad(); }
  const layersById = new Map(layers.map(layer => [layer.layerId, layer]));
  for (const layer of layers) {
    const element = elements.get(layer.svgPath.join("/"));
    if (!element || element.type !== layer.type || element.svgId !== layer.svgId) bad();
    if (layer.parentLayerId !== null) {
      const parent = layersById.get(layer.parentLayerId)!;
      if (parent.svgPath.length >= layer.svgPath.length || parent.svgPath.some((n, i) => layer.svgPath[i] !== n)) bad();
    }
  }
  if (!Array.isArray(input.selectedLayerIds) || input.selectedLayerIds.length > SNAPSHOT_MAX_LAYERS) bad();
  const selectedLayerIds = input.selectedLayerIds.map(id);
  if (new Set(selectedLayerIds).size !== selectedLayerIds.length || selectedLayerIds.some(key => !seen.has(key))) bad();
  const primaryLayerId = input.primaryLayerId === null ? null : id(input.primaryLayerId);
  if (primaryLayerId !== null && !selectedLayerIds.includes(primaryLayerId)) bad();
  return { schemaVersion: 1, sessionId: id(input.sessionId), baseRevision: revision(input.baseRevision), svg, documentBounds: bounds(input.documentBounds), selectedLayerIds, primaryLayerId, layers };
}
export function parseSnapshotReply(value: unknown): AgentSnapshotReply {
  const error = (value as { error?: unknown })?.error;
  const input = exact(value, error === undefined ? ["request", "projection"] : ["request", "error"]);
  const request = parseSnapshotRequest(input.request);
  if (error !== undefined) { if (!SNAPSHOT_ERROR_CODES.has(error as SnapshotErrorCode)) bad(); return { request, error: error as SnapshotErrorCode }; }
  return { request, projection: parseSnapshotProjection(input.projection) };
}
export function parseAgentSnapshot(value: unknown): AgentSnapshot {
  snapshotPayloadSize(value);
  const input = exact(value, [...projectionKeys, "requestId", "instanceId", "workspaceId", "editorId", "serverInstanceId", "digest"]);
  const projection = parseSnapshotProjection(Object.fromEntries(projectionKeys.map(key => [key, input[key]])));
  const digest = string(input.digest, 64); if (!/^[a-f0-9]{64}$/.test(digest)) bad();
  const workspaceId = string(input.workspaceId, 128); if (!/^[a-f0-9]{64}$/.test(workspaceId)) bad();
  return { ...projection, requestId: uuid(input.requestId), instanceId: uuid(input.instanceId), workspaceId, editorId: uuid(input.editorId), serverInstanceId: uuid(input.serverInstanceId), digest };
}
