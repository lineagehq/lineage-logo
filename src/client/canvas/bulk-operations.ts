/** Presentation attributes are deliberately read on each selected layer itself.
 * A group's explicit children keep their own paint when the group is edited. */
export type BulkAppearanceAttribute = "fill" | "stroke" | "stroke-width" | "opacity";
export type BulkEdit = { kind: "appearance"; attribute: BulkAppearanceAttribute; value: string }
  | { kind: "visibility"; hidden: boolean }
  | { kind: "duplicate" } | { kind: "delete" };
export type BulkEditResult = { changed: boolean; error?: string };

export function disjointTargets<T extends Element>(nodes: readonly T[]): T[] {
  const unique = [...new Set(nodes)];
  return unique.filter((node) => !unique.some((other) => other !== node && other.contains(node)))
    .sort((left, right) => left.compareDocumentPosition(right) & 2 ? 1 : -1);
}

export function ownAttributeValue(nodes: readonly Element[], attribute: string): { mixed: boolean; value: string | null } {
  const value = nodes[0]?.getAttribute(attribute) ?? null;
  return { mixed: nodes.some((node) => node.getAttribute(attribute) !== value), value };
}

export function bulkNumericError(attribute: "stroke-width" | "opacity", value: string): string | undefined {
  if (!value.trim()) return undefined;
  const numeric = Number(value);
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) || !Number.isFinite(numeric)) {
    return "Enter a finite number for every selected layer.";
  }
  if (numeric < 0 || (attribute === "opacity" && numeric > 1)) {
    return attribute === "opacity" ? "Opacity must be between 0 and 1." : "Stroke width must be zero or greater.";
  }
  return undefined;
}

const URL_REFERENCE = /url\(\s*(['"]?)#([^\s)'"\\]+)\1\s*\)/gi;
const IDREF_ATTRIBUTES = new Set(["aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "aria-flowto", "aria-activedescendant", "aria-details", "aria-errormessage"]);
function subtree(node: Element): Element[] { return [node, ...Array.from(node.querySelectorAll("*"))]; }

/** References that can be rewritten without reinterpreting external URLs or colors. */
export function localReferences(node: Element): Set<string> {
  const result = new Set<string>();
  for (const attribute of Array.from(node.attributes)) {
    for (const match of attribute.value.matchAll(URL_REFERENCE)) result.add(match[2]);
    if ((attribute.localName === "href") && attribute.value.startsWith("#")) result.add(attribute.value.slice(1));
    if (IDREF_ATTRIBUTES.has(attribute.name)) attribute.value.trim().split(/\s+/).filter(Boolean).forEach((id) => result.add(id));
    if (attribute.name === "begin" || attribute.name === "end") {
      for (const part of attribute.value.split(";")) {
        const match = /^\s*([\w:-]+)\./.exec(part);
        if (match) result.add(match[1]);
      }
    }
  }
  if (node.localName === "style") {
    for (const match of (node.textContent ?? "").matchAll(URL_REFERENCE)) result.add(match[2]);
  }
  return result;
}

function unsupportedReferenceError(root: SVGSVGElement): string | undefined {
  for (const node of subtree(root)) {
    const values = Array.from(node.attributes, (attribute) => attribute.value);
    if (node.localName === "style") values.push(node.textContent ?? "");
    if (values.some((value) => /url\([^)]*(?:\\|%)/i.test(value))
      || Array.from(node.attributes).some((attribute) => attribute.localName === "href" && attribute.value.startsWith("#") && /[%\\]/.test(attribute.value))) {
      return "Simplify escaped or encoded local references before editing structure so every resource stays connected.";
    }
  }
  return undefined;
}

export function deletionReferenceError(root: SVGSVGElement, targets: readonly Element[]): string | undefined {
  const unsupported = unsupportedReferenceError(root);
  if (unsupported) return unsupported;
  const deleted = new Set(targets.flatMap(subtree));
  const ids = new Set([...deleted].map((node) => node.id).filter(Boolean));
  for (const node of subtree(root)) {
    if (deleted.has(node)) continue;
    if ([...localReferences(node)].some((id) => ids.has(id))) {
      return "Another layer still references this selection. Include that layer or remove its reference before deleting.";
    }
  }
  return undefined;
}

function rewriteUrls(value: string, ids: Map<string, string>): string {
  return value.replace(URL_REFERENCE, (whole, quote: string, id: string) => ids.has(id) ? `url(${quote}#${ids.get(id)}${quote})` : whole);
}

/** Stage detached clones and their shared ID map before touching the document. */
export function duplicateSubtrees(root: SVGSVGElement, sources: readonly SVGGraphicsElement[]): SVGGraphicsElement[] {
  const unsupported = unsupportedReferenceError(root);
  if (unsupported) throw new Error(unsupported);
  const clones = sources.map((source) => source.cloneNode(true) as SVGGraphicsElement);
  const existingIds = Array.from(root.querySelectorAll("[id]")).map((node) => node.id);
  if (root.id) existingIds.push(root.id);
  if (new Set(existingIds).size !== existingIds.length) throw new Error("Resolve duplicate SVG IDs before duplicating layers.");
  const reserved = new Set(existingIds);
  const ids = new Map<string, string>();
  for (const node of clones.flatMap(subtree)) {
    if (node.id) {
      const original = node.id;
      let suffix = 1;
      let candidate = `${original}-copy-${suffix}`;
      while (reserved.has(candidate)) candidate = `${original}-copy-${++suffix}`;
      reserved.add(candidate);
      ids.set(original, candidate);
      node.id = candidate;
    }
    for (const attribute of Array.from(node.attributes)) {
      if (/^data-(?:agent|review|transport)-/.test(attribute.name)
        || /^data-lineage-(?:key|hover|secondary|primary-fallback|review)/.test(attribute.name)) node.removeAttribute(attribute.name);
    }
  }
  // ID selectors in an external style sheet target the original alone. Copying
  // without a CSS parser would silently lose styling, so require an explicit fix.
  const copiedNodes = new Set(sources.flatMap(subtree));
  for (const style of root.querySelectorAll("style")) {
    if (copiedNodes.has(style)) continue;
    const css = style.textContent ?? "";
    if (css.includes("\\") || /\[[^\]]*(?:id|href)\s*[~|^$*]?=/i.test(css)
      || [...ids.keys()].some((id) => new RegExp(`#${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(css))) {
      throw new Error("This selection uses an ID-based stylesheet. Use class styles or presentation attributes before duplicating it.");
    }
  }
  for (const node of clones.flatMap(subtree)) {
    for (const attribute of Array.from(node.attributes)) {
      let value = rewriteUrls(attribute.value, ids);
      if (attribute.localName === "href" && value.startsWith("#") && ids.has(value.slice(1))) value = `#${ids.get(value.slice(1))}`;
      if (IDREF_ATTRIBUTES.has(attribute.name)) value = value.replace(/\S+/g, (id) => ids.get(id) ?? id);
      if (attribute.name === "begin" || attribute.name === "end") value = value.replace(/(^|;)\s*([\w:-]+)(?=\.)/g, (whole, prefix: string, id: string) => ids.has(id) ? `${prefix}${ids.get(id)}` : whole);
      attribute.value = value;
    }
    if (node.localName === "style") {
      // Local CSS selectors can contain escaping or attribute selectors; refuse
      // those rather than guess how an identifier should be reserialized.
      let css = node.textContent ?? "";
      if (css.includes("\\") || /\[[^\]]*(?:id|href)\s*[~|^$*]?=/i.test(css)) throw new Error("Simplify escaped or ID attribute stylesheet selectors before duplicating this selection.");
      const rewritten = rewriteUrls(css, ids);
      if (rewritten !== css) throw new Error("A copied stylesheet references copied resources. Use presentation attributes before duplicating it to preserve the original artwork’s paint.");
      css = rewritten;
      css = css.replace(/([^{}]+)\{/g, (whole, selector: string) => `${selector.replace(/#([\w-]+)/g, (token, id: string) => ids.has(id) ? `#${ids.get(id)}` : token)}{`);
      node.textContent = css;
    }
  }
  return clones;
}
