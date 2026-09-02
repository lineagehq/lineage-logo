import type {
  AgentOperation, AgentTransactionError, AgentTransactionResult, AgentTransactionV1, LayerRef,
} from "../../shared/agent-protocol";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const EDITABLE_SELECTOR = "g, path, rect, circle, ellipse, polygon, polyline, line, text";
const RESOURCE_SELECTOR = "defs, metadata, clipPath, mask, filter, linearGradient, radialGradient, pattern, marker, symbol";
const ACTIVE_ELEMENTS = new Set(["script", "foreignObject", "animate", "animateMotion", "animateTransform", "set", "style"]);
const REFERENCE_ATTRIBUTES = new Set(["href", "xlink:href", "fill", "stroke", "clip-path", "mask", "filter", "marker-start", "marker-mid", "marker-end"]);

export interface AgentDocumentContext { sessionId: string; sourcePath: string; revision: number }
export interface AgentSelectionIntent { targetSessionKeys: string[]; primarySessionKey?: string; scopeSessionKey?: string }
export interface AgentOperationEvidence {
  operationId: string;
  type: AgentOperation["type"];
  label: string;
  current: string;
  proposed: string;
  context: string;
}
export interface StagedAgentTransaction {
  candidate?: SVGSVGElement;
  selection?: AgentSelectionIntent;
  evidence?: AgentOperationEvidence[];
  result: AgentTransactionResult;
}

class EvaluationError extends Error {
  constructor(readonly detail: AgentTransactionError) { super(detail.message); }
}

function reject(transactionId: string, error: EvaluationError): StagedAgentTransaction {
  return { result: { transactionId, status: "rejected", error: error.detail } };
}

function fail(code: AgentTransactionError["code"], message: string, operationId?: string, path?: string): never {
  throw new EvaluationError({ code, message, operationId, path });
}

function selectable(node: Element, root: SVGSVGElement): node is SVGGraphicsElement {
  return node !== root && node.matches(EDITABLE_SELECTOR) && node.closest("svg") === root && !node.closest(RESOURCE_SELECTOR);
}

function nodesWithSelf(root: Element): Element[] { return [root, ...Array.from(root.querySelectorAll("*"))]; }

function referenceIds(root: Element): string[] {
  const ids: string[] = [];
  for (const node of nodesWithSelf(root)) for (const attribute of Array.from(node.attributes)) {
    if (!REFERENCE_ATTRIBUTES.has(attribute.name)) continue;
    const pattern = attribute.name === "href" || attribute.name === "xlink:href"
      ? /url\(\s*#([^\s)'"}]+)\s*\)|^#([^\s]+)$/g
      : /url\(\s*#([^\s)'"}]+)\s*\)/g;
    for (const match of attribute.value.matchAll(pattern)) ids.push(match[1] ?? match[2]);
  }
  return ids;
}

function idCounts(root: Element): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of nodesWithSelf(root)) if (node.id) counts.set(node.id, (counts.get(node.id) ?? 0) + 1);
  return counts;
}

function validateFragment(fragment: Element, operationId: string): void {
  for (const node of nodesWithSelf(fragment)) {
    if (node.namespaceURI !== SVG_NS) fail("unsafe_svg", `Unsupported namespace on ${node.localName}`, operationId);
    if (ACTIVE_ELEMENTS.has(node.localName)) fail("unsafe_svg", `Active SVG element ${node.localName} is not allowed`, operationId);
    for (const attribute of Array.from(node.attributes)) {
      if (attribute.name.startsWith("data-lineage-")) fail("unsafe_svg", `Reserved editor attribute ${attribute.name} is not allowed`, operationId);
      if (attribute.name === "style" || attribute.name.toLowerCase().startsWith("on")) fail("unsafe_svg", `Active attribute ${attribute.name} is not allowed`, operationId);
      if (attribute.namespaceURI && attribute.namespaceURI !== XLINK_NS && attribute.namespaceURI !== "http://www.w3.org/2000/xmlns/") fail("unsafe_svg", `Unsupported attribute namespace on ${attribute.name}`, operationId);
      if ((attribute.localName === "href" || attribute.localName === "src") && !attribute.value.startsWith("#")) fail("unsafe_svg", `External ${attribute.name} is not allowed`, operationId);
      for (const match of attribute.value.matchAll(/url\(\s*([^)]*)\)/gi)) if (!match[1].trim().startsWith("#")) fail("unsafe_svg", `External URL in ${attribute.name} is not allowed`, operationId);
    }
  }
}

function parseFragment(root: SVGSVGElement, source: string, operationId: string): SVGGraphicsElement {
  const Parser = root.ownerDocument.defaultView?.DOMParser ?? DOMParser;
  const parsed = new Parser().parseFromString(`<svg xmlns="${SVG_NS}">${source}</svg>`, "image/svg+xml");
  if (parsed.querySelector("parsererror")) fail("invalid_svg", "Layer fragment is not valid SVG XML", operationId);
  const wrapper = parsed.documentElement;
  const elements = Array.from(wrapper.children);
  if (elements.length !== 1 || !selectable(elements[0], wrapper as unknown as SVGSVGElement)) fail("invalid_svg", "Layer fragment must contain exactly one selectable top-level layer", operationId);
  validateFragment(elements[0], operationId);
  return root.ownerDocument.importNode(elements[0], true) as SVGGraphicsElement;
}

function keyMatches(root: SVGSVGElement, key: string): SVGGraphicsElement[] {
  return Array.from(root.querySelectorAll<SVGGraphicsElement>(EDITABLE_SELECTOR)).filter((node) => selectable(node, root) && node.getAttribute("data-lineage-key") === key);
}

function resolve(root: SVGSVGElement, results: Map<string, SVGGraphicsElement>, ref: LayerRef, operationId: string): SVGGraphicsElement {
  if ("operationId" in ref) {
    const node = results.get(ref.operationId);
    if (!node || !root.contains(node)) fail("missing_target", `Operation result ${ref.operationId} is unavailable`, operationId);
    return node;
  }
  const matches = keyMatches(root, ref.sessionKey);
  if (matches.length === 0) fail("missing_target", `No layer has session key ${ref.sessionKey}`, operationId);
  if (matches.length > 1) fail("ambiguous_target", `Multiple layers have session key ${ref.sessionKey}`, operationId);
  return matches[0];
}

function locked(node: SVGGraphicsElement, root: SVGSVGElement, lockedKeys: ReadonlySet<string>): boolean {
  let current: Element | null = node;
  while (current && current !== root) {
    const key = current.getAttribute("data-lineage-key");
    if (key && lockedKeys.has(key)) return true;
    current = current.parentElement;
  }
  return nodesWithSelf(node).some((descendant) => {
    const key = descendant.getAttribute("data-lineage-key");
    return Boolean(key && lockedKeys.has(key));
  });
}

function assertMutable(node: SVGGraphicsElement, root: SVGSVGElement, lockedKeys: ReadonlySet<string>, operationId: string): void {
  if (locked(node, root, lockedKeys)) fail("locked_target", "The target or one of its ancestors/descendants is locked", operationId);
}

function siblingAnchor(root: SVGSVGElement, results: Map<string, SVGGraphicsElement>, placement: { before: LayerRef } | { after: LayerRef }, operationId: string): { sibling: SVGGraphicsElement; before: boolean } {
  if ("before" in placement) return { sibling: resolve(root, results, placement.before, operationId), before: true };
  return { sibling: resolve(root, results, placement.after, operationId), before: false };
}

function validPaint(value: string): boolean {
  const candidate = value.trim();
  return candidate === "none" || candidate === "currentColor" || /^#[0-9a-f]{3,8}$/i.test(candidate)
    || /^(?:rgb|rgba|hsl|hsla)\([^;{}]+\)$/i.test(candidate) || /^[a-z]+$/i.test(candidate)
    || /^url\(\s*#[A-Za-z_][\w:.-]*\s*\)$/.test(candidate);
}

function ensureNewIds(fragment: Element, candidate: SVGSVGElement, replaced: SVGGraphicsElement | undefined, operationId: string): void {
  const outside = idCounts(candidate);
  if (replaced) for (const node of nodesWithSelf(replaced)) if (node.id) outside.set(node.id, (outside.get(node.id) ?? 1) - 1);
  const introduced = idCounts(fragment);
  for (const [id, count] of introduced) {
    if (count !== 1 || (outside.get(id) ?? 0) > 0) fail("id_conflict", `Introduced ID ${id} is not unique`, operationId);
  }
}

function validateReferences(beforeCounts: Map<string, number>, beforeRefs: string[], candidate: SVGSVGElement, relaxedReplacementIds: ReadonlySet<string>, operationId?: string): void {
  const afterCounts = idCounts(candidate);
  const originalReferences = new Map<string, number>();
  for (const id of beforeRefs) originalReferences.set(id, (originalReferences.get(id) ?? 0) + 1);
  const afterReferences = new Map<string, number>();
  for (const id of referenceIds(candidate)) afterReferences.set(id, (afterReferences.get(id) ?? 0) + 1);
  for (const [id, count] of afterReferences) {
    const originalCount = originalReferences.get(id) ?? 0;
    if ((originalCount === 0 || count > originalCount) && afterCounts.get(id) !== 1) {
      fail("reference_damage", `New reference #${id} does not resolve exactly once`, operationId);
    }
  }
  for (const id of beforeRefs) {
    if (!relaxedReplacementIds.has(id) && beforeCounts.get(id) === 1 && afterCounts.get(id) !== 1) {
      fail("reference_damage", `Existing reference #${id} was damaged`, operationId);
    }
  }
}

function referencesOutside(root: SVGSVGElement, subtree: Element): string[] {
  const outside = root.cloneNode(true) as SVGSVGElement;
  const key = subtree.getAttribute("data-lineage-key");
  const matching = key ? keyMatches(outside, key) : [];
  if (matching.length === 1) matching[0].remove();
  else {
    const path: number[] = [];
    let current: Element | null = subtree;
    while (current?.parentElement) {
      path.unshift(Array.from(current.parentElement.children).indexOf(current));
      current = current.parentElement;
      if (current === root) break;
    }
    let cloneNode: Element = outside;
    for (const index of path) cloneNode = cloneNode.children[index];
    cloneNode.remove();
  }
  return referenceIds(outside);
}

function affectedKeys(node: Element): string[] {
  return nodesWithSelf(node).map((item) => item.getAttribute("data-lineage-key")).filter((key): key is string => Boolean(key));
}

function nodeName(node: Element): string {
  return node.getAttribute("aria-label")?.trim() || node.id || node.localName;
}

function nodeSummary(node: Element): string {
  return `${nodeName(node)} (${node.localName})`;
}

function positionSummary(node: Element): string {
  const siblings = node.parentElement ? Array.from(node.parentElement.children) : [node];
  return `Position ${Math.max(0, siblings.indexOf(node)) + 1} of ${siblings.length}`;
}

export function evaluateAgentTransaction(
  canonical: SVGSVGElement,
  transaction: AgentTransactionV1,
  context: AgentDocumentContext,
  lockedKeys: ReadonlySet<string> = new Set(),
): StagedAgentTransaction {
  const transactionId = transaction.transactionId;
  try {
    if (transaction.document.sessionId !== context.sessionId || transaction.document.sourcePath !== context.sourcePath || transaction.document.baseRevision !== context.revision) {
      fail("stale_document", "Transaction document identity or base revision is stale");
    }
    const candidate = canonical.cloneNode(true) as SVGSVGElement;
    const beforeMarkup = candidate.outerHTML;
    const beforeCounts = idCounts(candidate);
    const beforeRefs = referenceIds(candidate);
    const results = new Map<string, SVGGraphicsElement>();
    const impact: Array<{ operationId: string; affectedSessionKeys: string[]; resultSessionKey?: string }> = [];
    const evidence: AgentOperationEvidence[] = [];
    let selection: AgentSelectionIntent | undefined;
    let hasMutation = false;
    let lastMutationId: string | undefined;
    let generatedKey = 0;
    const relaxedReplacementIds = new Set<string>();
    const assignKey = (node: SVGGraphicsElement): string => {
      let key = node.getAttribute("data-lineage-key");
      if (key) return key;
      do { generatedKey += 1; key = `agent-${transactionId}-${generatedKey}`; } while (keyMatches(candidate, key).length > 0);
      node.setAttribute("data-lineage-key", key);
      return key;
    };
    for (const operation of transaction.operations) {
      const operationId = operation.operationId;
      if (operation.type === "selectFocus") {
        const targets = operation.targets.map((ref) => resolve(candidate, results, ref, operationId));
        const primary = operation.primary ? resolve(candidate, results, operation.primary, operationId) : targets.at(-1)!;
        if (!targets.includes(primary)) fail("invalid_reference", "Primary focus must be included in targets", operationId);
        const scope = operation.scope === undefined || operation.scope === null ? undefined : resolve(candidate, results, operation.scope, operationId);
        selection = { targetSessionKeys: targets.map(assignKey), primarySessionKey: assignKey(primary), ...(scope ? { scopeSessionKey: assignKey(scope) } : {}) };
        impact.push({ operationId, affectedSessionKeys: selection.targetSessionKeys });
        evidence.push({
          operationId, type: operation.type, label: "Change focus",
          current: "Current canvas focus remains unchanged until this proposal is applied.",
          proposed: `Focus ${targets.length} layer${targets.length === 1 ? "" : "s"}: ${targets.map(nodeName).join(", ")}`,
          context: scope ? `Within ${nodeSummary(scope)}` : "Within the document root",
        });
        continue;
      }
      hasMutation = true;
      lastMutationId = operationId;
      if (operation.type === "addLayer") {
        const fragment = parseFragment(candidate, operation.svg, operationId);
        ensureNewIds(fragment, candidate, undefined, operationId);
        const parent: Element = operation.parent === null ? candidate : resolve(candidate, results, operation.parent, operationId);
        if (parent !== candidate) assertMutable(parent as SVGGraphicsElement, candidate, lockedKeys, operationId);
        if (typeof operation.placement === "string") parent.insertBefore(fragment, operation.placement === "first" ? parent.firstChild : null);
        else {
          const anchor = siblingAnchor(candidate, results, operation.placement, operationId);
          if (anchor.sibling.parentElement !== parent) fail("invalid_reference", "Placement sibling is not a child of the requested parent", operationId);
          parent.insertBefore(fragment, anchor.before ? anchor.sibling : anchor.sibling.nextSibling);
        }
        const key = assignKey(fragment);
        results.set(operationId, fragment);
        impact.push({ operationId, affectedSessionKeys: affectedKeys(fragment), resultSessionKey: key });
        evidence.push({
          operationId, type: operation.type, label: "Add layer", current: "No layer",
          proposed: nodeSummary(fragment), context: `In ${parent === candidate ? "document root" : nodeSummary(parent)}`,
        });
      } else if (operation.type === "replaceLayer") {
        const target = resolve(candidate, results, operation.target, operationId);
        const current = nodeSummary(target);
        assertMutable(target, candidate, lockedKeys, operationId);
        const targetIds = idCounts(target);
        const outsideRefs = new Set(referencesOutside(candidate, target));
        for (const id of referenceIds(target)) {
          if (targetIds.get(id) === 1 && !outsideRefs.has(id)) relaxedReplacementIds.add(id);
        }
        const fragment = parseFragment(candidate, operation.svg, operationId);
        ensureNewIds(fragment, candidate, target, operationId);
        const oldKey = target.getAttribute("data-lineage-key");
        if (oldKey && !fragment.hasAttribute("data-lineage-key")) fragment.setAttribute("data-lineage-key", oldKey);
        target.replaceWith(fragment);
        const key = assignKey(fragment);
        results.set(operationId, fragment);
        impact.push({ operationId, affectedSessionKeys: affectedKeys(fragment), resultSessionKey: key });
        evidence.push({
          operationId, type: operation.type, label: "Replace layer", current,
          proposed: nodeSummary(fragment), context: `Keeps session identity ${key}`,
        });
      } else {
        const target = resolve(candidate, results, operation.target, operationId);
        assertMutable(target, candidate, lockedKeys, operationId);
        const key = assignKey(target);
        if (operation.type === "renameLayer") {
          const current = target.getAttribute("aria-label")?.trim() || "Unnamed";
          const name = operation.name?.trim() ?? "";
          if (name) target.setAttribute("aria-label", name); else target.removeAttribute("aria-label");
          evidence.push({
            operationId, type: operation.type, label: "Rename layer", current,
            proposed: name || "Unnamed", context: `${nodeSummary(target)} · session ${key}`,
          });
        } else if (operation.type === "setPaint") {
          const current = target.getAttribute(operation.property) ?? "Inherited";
          if (operation.value !== null && !validPaint(operation.value)) fail("invalid_paint", `Invalid ${operation.property} paint`, operationId);
          if (operation.value === null) target.removeAttribute(operation.property); else target.setAttribute(operation.property, operation.value.trim());
          evidence.push({
            operationId, type: operation.type, label: `Set ${operation.property}`, current,
            proposed: target.getAttribute(operation.property) ?? "Inherited", context: nodeSummary(target),
          });
        } else {
          const current = positionSummary(target);
          const anchor = siblingAnchor(candidate, results, operation.placement, operationId);
          if (anchor.sibling === target || anchor.sibling.parentElement !== target.parentElement) fail("invalid_reference", "Reorder target and sibling must be distinct siblings", operationId);
          target.parentElement!.insertBefore(target, anchor.before ? anchor.sibling : anchor.sibling.nextSibling);
          evidence.push({
            operationId, type: operation.type, label: "Reorder layer", current,
            proposed: positionSummary(target), context: nodeSummary(target.parentElement ?? candidate),
          });
        }
        impact.push({ operationId, affectedSessionKeys: [key] });
      }
    }
    validateReferences(beforeCounts, beforeRefs, candidate, relaxedReplacementIds, lastMutationId);
    if (hasMutation && candidate.outerHTML === beforeMarkup) fail("no_op", "Mutating transaction has no document effect", lastMutationId);
    return { candidate, selection, evidence, result: { transactionId, status: hasMutation ? "staged" : "applied", impact } };
  } catch (error) {
    if (error instanceof EvaluationError) return reject(transactionId, error);
    throw error;
  }
}
