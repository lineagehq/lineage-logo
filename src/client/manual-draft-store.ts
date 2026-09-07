import { sha256 } from "@noble/hashes/sha2.js";
import { SaxesParser } from "saxes";
import type { PreviewBackground, SessionStorageLike } from "./session-restoration";

export const MANUAL_DRAFT_MAX_BYTES = 5 * 1024 * 1024;
export const MANUAL_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const MANUAL_DRAFT_HISTORY_POLICY = "reset-on-restore" as const;
export type ManualDraftAuthority = "manual" | "pending-agent" | "provisional-agent";
export interface ManualDraftIdentity { workspaceId: string; sourcePath: string }
export interface ManualDraftContext { selectionIds: string[]; zoom: number; previewBackground: PreviewBackground }
export interface ManualDraftStorage extends SessionStorageLike { readonly length?: number; key?(index: number): string | null }
export const MANUAL_DRAFT_MAX_RECORDS = 8;
const ORPHAN_GRACE_MS = 5 * 60 * 1000;
export interface ManualDraftV1 extends ManualDraftIdentity {
  generation: string;
  version: 1;
  sourceDigest: string;
  revision: number;
  timestamp: number;
  draftDigest: string;
  context: ManualDraftContext;
  svg: string;
  integrity: string;
}
export type ManualDraftReason = "agent-authority" | "invalid-identity" | "malformed" | "oversized" | "expired" | "future" | "wrong-workspace" | "wrong-source" | "changed-source" | "integrity" | "unsafe-svg" | "storage-unavailable" | "storage-write-failed" | "storage-remove-failed";
export type ManualDraftProblem = { status: "refused" | "failure"; reason: ManualDraftReason; token?: string };
export type ManualDraftRead = { status: "none" } | { status: "ready"; draft: ManualDraftV1; token: string } | ManualDraftProblem;
const messages: Record<ManualDraftReason, string> = {
  "agent-authority": "Finish the pending agent review before managing the manual draft.",
  "invalid-identity": "This document identity cannot be used for manual recovery. Save an iteration instead.",
  malformed: "The stored draft is invalid. Discard it and continue from the saved source.",
  oversized: "The draft exceeds the recovery storage limit. Save an iteration to preserve your work.",
  expired: "The stored draft has expired. Discard it and continue from the saved source.",
  future: "The draft timestamp is ahead of this device clock. Check the clock or discard the draft.",
  "wrong-workspace": "The draft belongs to another workspace and cannot be restored here.",
  "wrong-source": "The draft belongs to another source and cannot be restored here.",
  "changed-source": "The saved source has changed. This draft cannot replace it; discard the draft to continue.",
  integrity: "The draft failed its integrity check. Discard it and continue from the saved source.",
  "unsafe-svg": "The draft contains unsupported active content. Save remains available, but recovery cannot use this draft.",
  "storage-unavailable": "Recovery storage is unavailable. Save an iteration to preserve your work.",
  "storage-write-failed": "The recovery draft could not be stored. Save an iteration to preserve your work.",
  "storage-remove-failed": "The draft could not be discarded. Retry or check browser storage settings.",
};
export const manualDraftReasonMessage = (reason: ManualDraftReason): string => messages[reason];
export function manualDraftDigest(text: string): string {
  return Array.from(sha256(new TextEncoder().encode(text)), byte => byte.toString(16).padStart(2, "0")).join("");
}
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0"));
const bounded = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const digestPattern = /^[a-f0-9]{64}$/;
function validIdentity(identity: ManualDraftIdentity): boolean {
  return bounded(identity.workspaceId, 160) && /^[A-Za-z0-9._:-]+$/.test(identity.workspaceId)
    && bounded(identity.sourcePath, 320) && /^(?:concepts|iterations)\/[^/\\]{1,255}\.svg$/i.test(identity.sourcePath);
}
function validContext(value: unknown): value is ManualDraftContext {
  if (!exact(value, ["selectionIds", "zoom", "previewBackground"])) return false;
  return Array.isArray(value.selectionIds) && value.selectionIds.length <= 100
    && value.selectionIds.every(id => bounded(id, 160)) && new Set(value.selectionIds).size === value.selectionIds.length
    && typeof value.zoom === "number" && Number.isFinite(value.zoom) && value.zoom >= 0.01 && value.zoom <= 4
    && ["checker", "light", "dark"].includes(value.previewBackground as string);
}
export function manualDraftStorageKey(identity: ManualDraftIdentity): string {
  if (!validIdentity(identity)) throw new Error(messages["invalid-identity"]);
  return `lineage.manual-draft.v1.${manualDraftDigest(JSON.stringify([identity.workspaceId, identity.sourcePath]))}`;
}
const safeReference = (value: string): boolean => value.startsWith("#") || /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(value);
function safeCss(value: string): boolean {
  if (/[\\]|\/\*|@import\b|expression\s*\(|(?:-webkit-)?image-set\s*\(|image\s*\(|src\s*:|-moz-binding|behavior\s*:/i.test(value)) return false;
  for (const match of value.matchAll(/url\(\s*([^)]*)\)/gi)) {
    const reference = match[1].trim().replace(/^(['"])(.*)\1$/, "$2");
    if (!safeReference(reference)) return false;
  }
  return true;
}
/** Manual documents retain passive CSS, local resources, text and editor metadata.
 * Recovery rejects active/external content without applying the stricter producer-fragment policy.
 */
export function validateManualDraftSvg(svg: string): boolean {
  if (!svg || new TextEncoder().encode(svg).byteLength > MANUAL_DRAFT_MAX_BYTES) return false;
  let depth = 0;
  let root = false;
  let styleDepth = -1;
  let css = "";
  const reject = (): never => { throw new Error("Unsafe manual recovery SVG."); };
  const parser = new SaxesParser({ xmlns: true });
  parser.on("error", reject);
  parser.on("doctype", reject);
  parser.on("processinginstruction", reject);
  parser.on("xmldecl", declaration => { if (declaration.version !== "1.0" || (declaration.encoding && declaration.encoding.toLowerCase() !== "utf-8")) reject(); });
  parser.on("opentag", tag => {
    if ((tag.uri && tag.uri !== "http://www.w3.org/2000/svg") || (depth === 0 && tag.local !== "svg")) reject();
    if (/^(?:script|foreignObject|animate.*|set|discard|iframe|object|embed|handler|listener|link)$/i.test(tag.local)) reject();
    if (depth === 0) root = true;
    if (tag.local === "style") { styleDepth = depth; css = ""; }
    for (const attribute of Object.values(tag.attributes)) {
      if (/^on/i.test(attribute.local)) reject();
      if (attribute.uri && !["http://www.w3.org/XML/1998/namespace", "http://www.w3.org/1999/xlink", "http://www.w3.org/2000/xmlns/"].includes(attribute.uri)) reject();
      if (attribute.uri === "http://www.w3.org/XML/1998/namespace" && !["lang", "space"].includes(attribute.local)) reject();
      if (["href", "src"].includes(attribute.local) && !safeReference(attribute.value.trim())) reject();
      if (attribute.local === "style" && !safeCss(attribute.value)) reject();
      // URL-bearing presentation attributes must also remain local.
      if (["fill", "stroke", "filter", "mask", "clip-path", "cursor", "marker-start", "marker-mid", "marker-end"].includes(attribute.local) && !safeCss(attribute.value)) reject();
      if (/[\\]|\/\*/.test(attribute.value) && ["fill", "stroke", "filter", "mask", "clip-path", "cursor", "marker-start", "marker-mid", "marker-end"].includes(attribute.local)) reject();
    }
    depth++;
  });
  parser.on("text", text => { if (styleDepth >= 0) css += text; });
  parser.on("cdata", text => { if (styleDepth >= 0) css += text; });
  parser.on("closetag", () => { depth--; if (depth === styleDepth) { if (!safeCss(css)) reject(); styleDepth = -1; } });
  try { parser.write(svg).close(); return root && depth === 0; } catch { return false; }
}
const payload = (draft: Omit<ManualDraftV1, "integrity"> | ManualDraftV1) => ({
  version: draft.version, generation: draft.generation, workspaceId: draft.workspaceId, sourcePath: draft.sourcePath,
  sourceDigest: draft.sourceDigest, revision: draft.revision, timestamp: draft.timestamp,
  draftDigest: draft.draftDigest, context: { selectionIds: draft.context.selectionIds, zoom: draft.context.zoom, previewBackground: draft.context.previewBackground }, svg: draft.svg,
});
const problem = (reason: ManualDraftReason, token?: string): ManualDraftProblem => ({ status: reason.startsWith("storage-") ? "failure" : "refused", reason, ...(token ? { token } : {}) });
const recordKey = (key: string, token: string) => `${key}.record.${token}`;
const markerKey = (key: string, token: string) => `${key}.discarded.${token}`;
/** Clean only this document's abandoned immutable records. Recent in-flight writes
 * are retained; a bounded cap refuses further writes instead of deleting them.
 */
function sweep(storage: ManualDraftStorage, key: string, now: number): boolean {
  if (!storage.key || typeof storage.length !== "number") return true;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const candidate = storage.key(index);
    if (candidate?.startsWith(`${key}.record.`) || candidate?.startsWith(`${key}.discarded.`)) keys.push(candidate);
  }
  const current = storage.getItem(key);
  let remaining = 0;
  for (const candidate of keys) {
    if (candidate.startsWith(`${key}.discarded.`)) {
      // Normal writes publish only valid token pointers, so these obsolete markers cannot become current again.
      if (current !== null && !digestPattern.test(current) && candidate === markerKey(key, manualDraftDigest(current))) continue;
      storage.removeItem(candidate);
      continue;
    }
    if (candidate !== recordKey(key, current ?? "")) {
      let timestamp = 0;
      try { timestamp = JSON.parse(storage.getItem(candidate) ?? "null")?.timestamp ?? 0; } catch { /* malformed orphan */ }
      if (!Number.isSafeInteger(timestamp) || now - timestamp > ORPHAN_GRACE_MS) storage.removeItem(candidate);
    }
    if (storage.getItem(candidate) !== null) remaining++;
  }
  return remaining < MANUAL_DRAFT_MAX_RECORDS;
}
export function writeManualDraft(storage: ManualDraftStorage, input: ManualDraftIdentity & { sourceSvg: string; svg: string; revision: number; context: ManualDraftContext }, now = Date.now(), authority: ManualDraftAuthority = "manual"):
  { status: "saved"; draft: ManualDraftV1; token: string } | ManualDraftProblem {
  if (authority !== "manual") return problem("agent-authority");
  if (!validIdentity(input)) return problem("invalid-identity");
  if (!Number.isSafeInteger(input.revision) || input.revision < 0 || !Number.isSafeInteger(now) || now < 0 || !validContext(input.context) || typeof input.sourceSvg !== "string") return problem("malformed");
  if (typeof input.svg !== "string") return problem("malformed");
  if (new TextEncoder().encode(input.svg).byteLength > MANUAL_DRAFT_MAX_BYTES || new TextEncoder().encode(input.sourceSvg).byteLength > MANUAL_DRAFT_MAX_BYTES) return problem("oversized");
  if (!validateManualDraftSvg(input.svg)) return problem("unsafe-svg");
  const generation = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
  const content = payload({ version: 1, generation, workspaceId: input.workspaceId, sourcePath: input.sourcePath, sourceDigest: manualDraftDigest(input.sourceSvg), revision: input.revision, timestamp: now, draftDigest: manualDraftDigest(input.svg), context: input.context, svg: input.svg });
  const draft: ManualDraftV1 = { ...content, context: { ...content.context, selectionIds: [...content.context.selectionIds] }, integrity: manualDraftDigest(JSON.stringify(content)) };
  const raw = JSON.stringify(draft);
  if (new TextEncoder().encode(raw).byteLength > MANUAL_DRAFT_MAX_BYTES) return problem("oversized");
  const token = manualDraftDigest(raw);
  const key = manualDraftStorageKey(input);
  try {
    if (!sweep(storage, key, now)) return problem("storage-write-failed");
    const prior = storage.getItem(key);
    storage.setItem(recordKey(key, token), raw);
    if (storage.getItem(recordKey(key, token)) !== raw) return problem("storage-write-failed");
    storage.setItem(key, token);
    if (storage.getItem(key) !== token || storage.getItem(recordKey(key, token)) !== raw) {
      if (storage.getItem(key) !== token) storage.removeItem(recordKey(key, token));
      return problem("storage-write-failed");
    }
    if (prior !== null && prior !== token) {
      try { storage.removeItem(digestPattern.test(prior) ? recordKey(key, prior) : markerKey(key, manualDraftDigest(prior))); }
      catch { /* Verified current draft is preserved; bounded sweep retries obsolete cleanup later. */ }
    }
  } catch {
    try { if (storage.getItem(key) !== token) storage.removeItem(recordKey(key, token)); } catch { /* unavailable storage remains a visible failure */ }
    return problem("storage-write-failed");
  }
  return { status: "saved", draft, token };
}
export function readManualDraft(storage: ManualDraftStorage, expected: ManualDraftIdentity & { sourceSvg: string }, now = Date.now(), authority: ManualDraftAuthority = "manual"): ManualDraftRead {
  if (authority !== "manual") return problem("agent-authority");
  if (!validIdentity(expected)) return problem("invalid-identity");
  const key = manualDraftStorageKey(expected);
  let raw: string | null;
  let token: string;
  try {
    const pointer = storage.getItem(key);
    if (pointer === null) return { status: "none" };
    if (!digestPattern.test(pointer)) {
      token = manualDraftDigest(pointer);
      return storage.getItem(markerKey(key, token)) === token ? { status: "none" } : problem("malformed", token);
    }
    token = pointer;
    raw = storage.getItem(recordKey(key, token));
    // Retiring a captured immutable record intentionally leaves a harmless pointer.
    if (raw === null) return { status: "none" };
  } catch { return problem("storage-unavailable"); }
  const refuse = (reason: ManualDraftReason) => problem(reason, token);
  if (new TextEncoder().encode(raw).byteLength > MANUAL_DRAFT_MAX_BYTES) return refuse("oversized");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return refuse("malformed"); }
  if (!exact(value, ["version", "generation", "workspaceId", "sourcePath", "sourceDigest", "revision", "timestamp", "draftDigest", "context", "svg", "integrity"])) return refuse("malformed");
  if (value.version !== 1 || typeof value.generation !== "string" || !/^[a-f0-9]{32}$/.test(value.generation) || !validIdentity(value as unknown as ManualDraftIdentity) || !validContext(value.context)
    || typeof value.svg !== "string" || typeof value.sourceDigest !== "string" || !digestPattern.test(value.sourceDigest)
    || typeof value.draftDigest !== "string" || !digestPattern.test(value.draftDigest) || typeof value.integrity !== "string" || !digestPattern.test(value.integrity)
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !Number.isSafeInteger(value.timestamp) || Number(value.timestamp) < 0
    || !Number.isSafeInteger(now) || now < 0 || typeof expected.sourceSvg !== "string") return refuse("malformed");
  const draft = value as unknown as ManualDraftV1;
  if (draft.workspaceId !== expected.workspaceId) return refuse("wrong-workspace");
  if (draft.sourcePath !== expected.sourcePath) return refuse("wrong-source");
  if (draft.timestamp > now) return refuse("future");
  if (now - draft.timestamp > MANUAL_DRAFT_MAX_AGE_MS) return refuse("expired");
  if (draft.sourceDigest !== manualDraftDigest(expected.sourceSvg)) return refuse("changed-source");
  if (token !== manualDraftDigest(raw) || draft.draftDigest !== manualDraftDigest(draft.svg) || draft.integrity !== manualDraftDigest(JSON.stringify(payload(draft)))) return refuse("integrity");
  if (!validateManualDraftSvg(draft.svg)) return refuse("unsafe-svg");
  return { status: "ready", draft, token };
}
/** Deletion targets the immutable captured record, never the mutable document pointer.
 * A concurrent tab can publish a new pointer at any moment without losing its record.
 */
export function discardManualDraft(storage: ManualDraftStorage, identity: ManualDraftIdentity, capturedToken: string, authority: ManualDraftAuthority = "manual"):
  { status: "retired" | "changed" } | ManualDraftProblem {
  if (authority !== "manual") return problem("agent-authority");
  if (!validIdentity(identity)) return problem("invalid-identity");
  if (!digestPattern.test(capturedToken)) return problem("malformed");
  try {
    const key = manualDraftStorageKey(identity);
    const current = storage.getItem(key);
    if (current === null) return { status: "retired" };
    if (!digestPattern.test(current)) {
      if (manualDraftDigest(current) !== capturedToken) return { status: "changed" };
      const marker = markerKey(key, capturedToken);
      storage.setItem(marker, capturedToken);
      return storage.getItem(marker) === capturedToken ? { status: "retired" } : problem("storage-remove-failed");
    }
    if (current !== capturedToken) {
      storage.removeItem(recordKey(key, capturedToken));
      return { status: "changed" };
    }
    storage.removeItem(recordKey(key, capturedToken));
    return storage.getItem(recordKey(key, capturedToken)) === null ? { status: "retired" } : problem("storage-remove-failed");
  } catch { return problem("storage-remove-failed"); }
}
export function retireManualDraft(storage: ManualDraftStorage, captured: ManualDraftV1, authority: ManualDraftAuthority = "manual") {
  return discardManualDraft(storage, captured, manualDraftDigest(JSON.stringify(captured)), authority);
}
