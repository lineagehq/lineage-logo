export interface PreviewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SvgPreview {
  svg: string;
  targetId?: string;
  fallback: boolean;
  status: string;
}

export type PreviewMeasure = (target: SVGGraphicsElement, root: SVGSVGElement) => PreviewBounds | undefined;

const ELIGIBLE_TARGETS = new Set(["g", "path", "rect", "circle", "ellipse", "polygon", "polyline", "line", "text", "use"]);
const LOCAL_REFERENCE = /url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g;

function decodeCssEscapes(value: string): string {
  return value.replace(/\\(?:([0-9a-f]{1,6})(?:\r\n|[\t\n\f\r ])?|\r\n|[\n\r\f]|(.))/gi, (_match, hex: string | undefined, escaped: string | undefined) => {
    if (hex) {
      const codePoint = Number.parseInt(hex, 16);
      return codePoint === 0 || codePoint > 0x10ffff ? "\uFFFD" : String.fromCodePoint(codePoint);
    }
    return escaped ?? "";
  });
}

function splitCssList(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
    } else if (character === '"' || character === "'") quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (character === "," && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function calculatedOpacity(value: string): number | undefined {
  if (!/^calc\([\s\S]*\)$/i.test(value)) return undefined;
  const source = value.slice(value.indexOf("(") + 1, -1);
  let index = 0;
  const whitespace = () => { while (/\s/.test(source[index] ?? "")) index += 1; };
  const expression = (): number | undefined => {
    let result = term();
    if (result === undefined) return undefined;
    whitespace();
    while (source[index] === "+" || source[index] === "-") {
      const operator = source[index++];
      const right = term();
      if (right === undefined) return undefined;
      result = operator === "+" ? result + right : result - right;
      whitespace();
    }
    return result;
  };
  const primary = (): number | undefined => {
    whitespace();
    if (source[index] === "(") {
      index += 1;
      const result = expression();
      whitespace();
      if (source[index++] !== ")") return undefined;
      return result;
    }
    const match = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(source.slice(index));
    if (!match) return undefined;
    index += match[0].length;
    const percentage = source[index] === "%";
    if (percentage) index += 1;
    const numeric = Number(match[0]);
    return percentage ? numeric / 100 : numeric;
  };
  function term(): number | undefined {
    let result = primary();
    if (result === undefined) return undefined;
    whitespace();
    while (source[index] === "*" || source[index] === "/") {
      const operator = source[index++];
      const right = primary();
      if (right === undefined || (operator === "/" && right === 0)) return undefined;
      result = operator === "*" ? result * right : result / right;
      whitespace();
    }
    return result;
  }
  const result = expression();
  whitespace();
  return index === source.length && result !== undefined && Number.isFinite(result) ? result : undefined;
}

function zeroOpacity(value: string | null): boolean {
  if (value === null) return false;
  const normalized = decodeCssEscapes(value).trim().toLowerCase();
  const calculated = calculatedOpacity(normalized);
  if (calculated !== undefined) return calculated <= 0;
  const numeric = normalized.endsWith("%") ? Number(normalized.slice(0, -1)) : Number(normalized);
  return normalized !== "" && Number.isFinite(numeric) && numeric <= 0;
}

type CssSpecificity = readonly [inline: number, ids: number, classes: number, elements: number];

interface CssDeclaration {
  property: string;
  value: string;
  important?: boolean;
  order?: number;
  specificity?: CssSpecificity;
}

function cssDeclarations(value: string): CssDeclaration[] {
  const css = decodeCssEscapes(value.replace(/\/\*[\s\S]*?\*\//g, " "));
  const declarations: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < css.length; index += 1) {
    const character = css[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
    } else if (character === "\"" || character === "'") quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (character === ";" && depth === 0) {
      declarations.push(css.slice(start, index));
      start = index + 1;
    }
  }
  declarations.push(css.slice(start));
  return declarations.flatMap((declaration) => {
    const separator = declaration.indexOf(":");
    if (separator < 0) return [];
    const rawProperty = declaration.slice(0, separator).trim();
    const rawValue = declaration.slice(separator + 1).trim();
    const important = /!\s*important\s*$/i.test(rawValue);
    return [{
      property: rawProperty.startsWith("--") ? rawProperty : rawProperty.toLowerCase(),
      value: rawValue.replace(/!\s*important\s*$/i, "").trim(),
      important,
    }];
  });
}

function compareSpecificity(left: CssSpecificity, right: CssSpecificity): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function addSpecificity(left: CssSpecificity, right: CssSpecificity): CssSpecificity {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2], left[3] + right[3]];
}

function selectorSpecificity(selector: string): CssSpecificity {
  let base = selector;
  let functional: CssSpecificity = [0, 0, 0, 0];
  for (let index = 0; index < base.length;) {
    const match = /^:(where|is|not|has)\(/i.exec(base.slice(index));
    if (!match) {
      index += 1;
      continue;
    }
    let depth = 1;
    let quote = "";
    let end = index + match[0].length;
    for (; end < base.length && depth > 0; end += 1) {
      const character = base[end];
      if (quote) {
        if (character === "\\") end += 1;
        else if (character === quote) quote = "";
      } else if (character === '"' || character === "'") quote = character;
      else if (character === "(") depth += 1;
      else if (character === ")") depth -= 1;
    }
    if (depth !== 0) break;
    const argumentsSource = base.slice(index + match[0].length, end - 1);
    if (match[1].toLowerCase() !== "where") {
      const argumentSpecificity = splitCssList(argumentsSource).map(selectorSpecificity)
        .reduce<CssSpecificity>((maximum, candidate) => compareSpecificity(candidate, maximum) > 0 ? candidate : maximum, [0, 0, 0, 0]);
      functional = addSpecificity(functional, argumentSpecificity);
    }
    base = `${base.slice(0, index)} ${base.slice(end)}`;
  }
  const attributes = base.match(/\[[^\]]+\]/g)?.length ?? 0;
  const withoutAttributes = base.replace(/\[[^\]]+\]/g, " ");
  const ids = withoutAttributes.match(/#[\w:-]+/g)?.length ?? 0;
  const classes = withoutAttributes.match(/\.[\w-]+|:(?!:)[\w-]+/g)?.length ?? 0;
  const elements = withoutAttributes.match(/(?:^|[\s>+~,(])(?:[a-z][\w-]*|\*)/gi)
    ?.filter((token) => !token.trim().endsWith("*")).length ?? 0;
  return addSpecificity(functional, [0, ids, classes + attributes, elements]);
}

function effectiveDeclarations(declarations: CssDeclaration[]): Map<string, CssDeclaration> {
  const effective = new Map<string, CssDeclaration>();
  for (const declaration of declarations) {
    const current = effective.get(declaration.property);
    const nextImportant = declaration.important ? 1 : 0;
    const currentImportant = current?.important ? 1 : 0;
    const specificityOrder = compareSpecificity(declaration.specificity ?? [0, 0, 0, 0], current?.specificity ?? [0, 0, 0, 0]);
    if (!current || nextImportant > currentImportant
      || (nextImportant === currentImportant && specificityOrder > 0)
      || (nextImportant === currentImportant && specificityOrder === 0 && (declaration.order ?? 0) >= (current.order ?? 0))) {
      effective.set(declaration.property, declaration);
    }
  }
  return effective;
}

function matchingStylesheetDeclarations(target: Element, root: SVGSVGElement): CssDeclaration[] {
  const declarations: CssDeclaration[] = [];
  let order = 0;
  for (const style of Array.from(root.querySelectorAll("style"))) {
    let rules: CSSRuleList;
    try {
      if (style.sheet?.cssRules.length) rules = style.sheet.cssRules;
      else {
        const Sheet = root.ownerDocument.defaultView?.CSSStyleSheet;
        if (!Sheet) continue;
        const sheet = new Sheet();
        sheet.replaceSync(decodeCssEscapes((style.textContent ?? "").replace(/\/\*[\s\S]*?\*\//g, " ")));
        rules = sheet.cssRules;
      }
    } catch { continue; }
    const visit = (group: CSSRuleList): void => {
      for (const rule of Array.from(group)) {
        if (rule.type === 1) {
          const cssRule = rule as CSSStyleRule;
          const matching = splitCssList(decodeCssEscapes(cssRule.selectorText)).filter((selector) => {
            try { return target.matches(selector); } catch { return false; }
          });
          if (matching.length === 0) continue;
          const specificity = matching.map(selectorSpecificity)
            .reduce<CssSpecificity>((maximum, candidate) => compareSpecificity(candidate, maximum) > 0 ? candidate : maximum, [0, 0, 0, 0]);
          declarations.push(...cssDeclarations(cssRule.style.cssText)
            .map((declaration) => ({ ...declaration, specificity, order: order++ })));
          continue;
        }
        const nested = (rule as CSSRule & { cssRules?: CSSRuleList }).cssRules;
        if (!nested) continue;
        if (rule.type === 4) {
          const condition = (rule as CSSMediaRule).conditionText;
          const matchMedia = root.ownerDocument.defaultView?.matchMedia;
          if (!matchMedia || !matchMedia.call(root.ownerDocument.defaultView, condition).matches) continue;
        } else if (rule.type === 12) {
          const condition = (rule as CSSSupportsRule).conditionText;
          const supports = root.ownerDocument.defaultView?.CSS?.supports;
          if (!supports || !supports.call(root.ownerDocument.defaultView?.CSS, condition)) continue;
        }
        visit(nested);
      }
    };
    visit(rules);
  }
  return declarations;
}

function declarationsFor(target: Element, root: SVGSVGElement): CssDeclaration[] {
  return [
    ...matchingStylesheetDeclarations(target, root),
    ...cssDeclarations(target.getAttribute("style") ?? "").map((declaration, order) => ({ ...declaration, specificity: [1, 0, 0, 0] as const, order: 1_000_000 + order })),
  ];
}

function customPropertyDefinitions(target: Element, root: SVGSVGElement): Map<string, string> {
  const ancestry: Element[] = [];
  let node: Element | null = target;
  while (node) {
    ancestry.unshift(node);
    if (node === root) break;
    node = node.parentElement;
  }
  const definitions = new Map<string, string>();
  for (const ancestor of ancestry) {
    for (const declaration of effectiveDeclarations(declarationsFor(ancestor, root)).values()) {
      if (declaration.property.startsWith("--")) definitions.set(declaration.property, declaration.value);
    }
  }
  return definitions;
}

function splitVarArguments(value: string): [string, string | undefined] {
  let depth = 0;
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
    } else if (character === "\"" || character === "'") quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (character === "," && depth === 0) return [value.slice(0, index).trim(), value.slice(index + 1).trim()];
  }
  return [value.trim(), undefined];
}

function resolveCssVariables(value: string, definitions: Map<string, string>, stack = new Set<string>()): string {
  let output = "";
  let cursor = 0;
  const lower = value.toLowerCase();
  while (cursor < value.length) {
    const start = lower.indexOf("var(", cursor);
    if (start < 0) return output + value.slice(cursor);
    output += value.slice(cursor, start);
    let depth = 1;
    let quote = "";
    let end = start + 4;
    for (; end < value.length && depth > 0; end += 1) {
      const character = value[end];
      if (quote) {
        if (character === "\\") end += 1;
        else if (character === quote) quote = "";
      } else if (character === "\"" || character === "'") quote = character;
      else if (character === "(") depth += 1;
      else if (character === ")") depth -= 1;
    }
    if (depth !== 0) return output + value.slice(start);
    const [name, fallback] = splitVarArguments(value.slice(start + 4, end - 1));
    const definition = definitions.get(name);
    if (definition !== undefined && !stack.has(name)) {
      const nextStack = new Set(stack);
      nextStack.add(name);
      output += resolveCssVariables(definition, definitions, nextStack);
    } else if (fallback !== undefined) {
      output += resolveCssVariables(fallback, definitions, stack);
    }
    cursor = end;
  }
  return output;
}

function targetsById(root: SVGSVGElement, id: string): SVGGraphicsElement[] {
  return Array.from(root.querySelectorAll<SVGGraphicsElement>("[id]")).filter((node) => node.id === id);
}

function uniqueTargetById(root: SVGSVGElement, id: string): SVGGraphicsElement | undefined {
  const matches = targetsById(root, id);
  return matches.length === 1 ? matches[0] : undefined;
}

function hiddenBySvgPresentation(target: Element, root: SVGSVGElement): boolean {
  const ancestry: Element[] = [];
  let node: Element | null = target;
  while (node) {
    ancestry.unshift(node);
    if (node === root) break;
    node = node.parentElement;
  }
  let visibility = "visible";
  for (const current of ancestry) {
    const definitions = customPropertyDefinitions(current, root);
    const presentation = ["display", "visibility", "opacity"].flatMap((property) => {
      const value = current.getAttribute(property);
      return value === null || value === undefined
        ? []
        : [{ property, value: decodeCssEscapes(value), specificity: [0, 0, 0, 0] as const, order: -1 }];
    });
    const declarations = [
      ...presentation,
      ...matchingStylesheetDeclarations(current, root),
      ...cssDeclarations(current.getAttribute("style") ?? "")
        .map((declaration, order) => ({ ...declaration, specificity: [1, 0, 0, 0] as const, order: 1_000_000 + order })),
    ];
    const effective = effectiveDeclarations(declarations);
    const resolved = (property: string): string | undefined => {
      const value = effective.get(property)?.value;
      return value === undefined ? undefined : resolveCssVariables(value, definitions).trim().toLowerCase();
    };
    if (resolved("display") === "none" || zeroOpacity(resolved("opacity") ?? null)) return true;
    const nextVisibility = resolved("visibility");
    if (nextVisibility === "visible" || nextVisibility === "hidden" || nextVisibility === "collapse") visibility = nextVisibility;
    else if (nextVisibility === "initial") visibility = "visible";
  }
  return visibility === "hidden" || visibility === "collapse";
}

function finiteBounds(bounds: PreviewBounds | undefined): bounds is PreviewBounds {
  return Boolean(bounds
    && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    && bounds.width > 0
    && bounds.height > 0);
}

export function paintedLocalBounds(target: SVGGraphicsElement): PreviewBounds | undefined {
  try {
    const box = (target as SVGGraphicsElement & {
      getBBox(options?: { fill?: boolean; stroke?: boolean; markers?: boolean; clipped?: boolean }): DOMRect;
    }).getBBox({ fill: true, stroke: true, markers: true, clipped: true });
    const bounds = { x: box.x, y: box.y, width: box.width, height: box.height };
    return finiteBounds(bounds) ? bounds : undefined;
  } catch { return undefined; }
}

function browserMeasure(target: SVGGraphicsElement, root: SVGSVGElement): PreviewBounds | undefined {
  const host = document.createElement("div");
  host.className = "preview-measure-host";
  const imported = document.importNode(root, true);
  host.append(imported);
  document.body.append(host);
  try {
    const measuredTarget = target.id ? uniqueTargetById(imported, target.id) : undefined;
    if (!measuredTarget) return undefined;
    const box = paintedLocalBounds(measuredTarget);
    if (!box) return undefined;
    const targetMatrix = measuredTarget.getCTM();
    const rootMatrix = imported.getCTM();
    if (!targetMatrix || !rootMatrix) return undefined;
    const matrix = rootMatrix.inverse().multiply(targetMatrix);
    const points = [
      new DOMPoint(box.x, box.y),
      new DOMPoint(box.x + box.width, box.y),
      new DOMPoint(box.x + box.width, box.y + box.height),
      new DOMPoint(box.x, box.y + box.height),
    ].map((point) => point.matrixTransform(matrix));
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  } catch {
    return undefined;
  } finally {
    host.remove();
  }
}

function wholeSvgPreview(root: SVGSVGElement, reason: string): SvgPreview {
  return {
    svg: root.outerHTML,
    fallback: true,
    status: `Whole SVG fallback: ${reason}`,
  };
}

function localReferenceIds(value: string): string[] {
  return Array.from(value.matchAll(LOCAL_REFERENCE), (match) => match[1]).filter(Boolean);
}

function referencedIds(node: Element, root: SVGSVGElement): string[] {
  const definitions = customPropertyDefinitions(node, root);
  const values = Array.from(node.attributes).flatMap((attribute) => {
    if ((attribute.localName === "href" || attribute.name === "xlink:href") && attribute.value.trim().startsWith("#")) {
      return [attribute.value.trim().slice(1)];
    }
    if (attribute.name === "style") return [];
    return localReferenceIds(resolveCssVariables(decodeCssEscapes(attribute.value), definitions));
  });
  for (const declaration of declarationsFor(node, root)) {
    if (declaration.property.startsWith("--")) continue;
    values.push(...localReferenceIds(resolveCssVariables(declaration.value, definitions)));
  }
  return values.filter(Boolean);
}

function isolateTargetBranch(target: SVGGraphicsElement, root: SVGSVGElement): boolean {
  const styles = Array.from(root.querySelectorAll("style"));
  for (const style of styles) {
    const css = decodeCssEscapes((style.textContent ?? "").replace(/\/\*[\s\S]*?\*\//g, " "));
    for (const match of css.matchAll(/([^{}]+)\{/g)) {
      const selector = match[1].trim();
      if (selector.startsWith("@")) continue;
      if (/[+~]|:(?:first|last|only|nth)-(?:child|of-type)\b|:empty\b|:has\s*\(/i.test(selector)) return false;
    }
  }
  const targetBranch = [target, ...Array.from(target.querySelectorAll("*"))];
  const ancestors: Element[] = [];
  let ancestor: Element | null = target.parentElement;
  while (ancestor) {
    ancestors.push(ancestor);
    if (ancestor === root as unknown as Element) break;
    ancestor = ancestor.parentElement;
  }
  const relevant = [...targetBranch, ...ancestors];
  const retainedRoots = new Set<Element>([target]);
  const pending = [...relevant];
  const queued = new Set(pending);
  const visited = new Set<Element>();
  const visitedIds = new Set<string>();
  const enqueueNode = (node: Element) => {
    if (queued.has(node)) return;
    queued.add(node);
    pending.push(node);
  };
  const enqueueId = (id: string): boolean => {
    if (!id || visitedIds.has(id)) return true;
    visitedIds.add(id);
    const matches = targetsById(root, id);
    if (matches.length !== 1) return false;
    const retained = matches[0];
    retainedRoots.add(retained);
    enqueueNode(retained);
    retained.querySelectorAll("*").forEach(enqueueNode);
    let retainedAncestor = retained.parentElement;
    while (retainedAncestor) {
      enqueueNode(retainedAncestor);
      if (retainedAncestor === root as unknown as Element) break;
      retainedAncestor = retainedAncestor.parentElement;
    }
    return true;
  };
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const id of referencedIds(node, root)) {
      if (!enqueueId(id)) return false;
    }
  }
  const keep = new Set<Element>();
  for (const retained of [...ancestors, ...styles]) {
    keep.add(retained);
    let retainedAncestor = retained.parentElement;
    while (retainedAncestor) {
      keep.add(retainedAncestor);
      if (retainedAncestor === root as unknown as Element) break;
      retainedAncestor = retainedAncestor.parentElement;
    }
  }
  for (const retained of retainedRoots) {
    keep.add(retained);
    retained.querySelectorAll("*").forEach((node) => keep.add(node));
    let ancestor = retained.parentElement;
    while (ancestor) {
      keep.add(ancestor);
      if (ancestor === root as unknown as Element) break;
      ancestor = ancestor.parentElement;
    }
  }
  root.querySelectorAll("*").forEach((node) => {
    if (!keep.has(node)) node.remove();
  });
  return true;
}

export function eligiblePreviewTargetIds(source: string): string[] {
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = parsed.documentElement;
  if (root.localName !== "svg" || parsed.querySelector("parsererror")) return [];
  return Array.from(root.querySelectorAll<SVGGraphicsElement>("[id]"))
    .filter((node) => ELIGIBLE_TARGETS.has(node.localName) && !hiddenBySvgPresentation(node, root as unknown as SVGSVGElement))
    .map((node) => node.id)
    .filter((id, index, ids) => Boolean(id) && ids.indexOf(id) === index);
}

export function automaticPreviewTargetId(source: string): string | undefined {
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = parsed.documentElement as unknown as SVGSVGElement;
  if (root.localName !== "svg" || parsed.querySelector("parsererror")) return undefined;
  const candidates = Array.from(root.querySelectorAll<SVGGraphicsElement>("[id][aria-label]"))
    .filter((node) => ELIGIBLE_TARGETS.has(node.localName)
      && targetsById(root, node.id).length === 1
      && !node.closest("defs, clipPath, mask, filter, pattern, marker, symbol")
      && !hiddenBySvgPresentation(node, root));
  const score = (node: SVGGraphicsElement): number => {
    const label = (node.getAttribute("aria-label") ?? "").trim().toLocaleLowerCase();
    if (!label) return Number.NEGATIVE_INFINITY;
    const descendants = Array.from(node.querySelectorAll<SVGGraphicsElement>("g, path, rect, circle, ellipse, polygon, polyline, line, text, use"))
      .filter((candidate) => !hiddenBySvgPresentation(candidate, root));
    const textCount = descendants.filter((candidate) => candidate.localName === "text").length;
    const semantic = /\b(?:icon|symbol|emblem)\b/.test(label) ? 55
      : /\bmark\b/.test(label) && !/\bwordmark\b/.test(label) ? 40
        : 0;
    const textPenalty = /\b(?:wordmark|tagline|descriptor|caption|text)\b/.test(label) ? 120 : textCount * 30;
    return semantic + (node.localName === "g" ? 24 : 0) + Math.min(descendants.length + 1, 48) - textPenalty;
  };
  return candidates
    .map((node, order) => ({ id: node.id, order, score: score(node) }))
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((left, right) => right.score - left.score || left.order - right.order)[0]?.id;
}

export function createSvgPreview(
  source: string,
  requestedTarget = "#icon",
  measure: PreviewMeasure = browserMeasure,
): SvgPreview {
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = parsed.documentElement as unknown as SVGSVGElement;
  if (root.localName !== "svg" || parsed.querySelector("parsererror")) {
    return { svg: source, fallback: true, status: "Whole SVG fallback: source is not valid SVG." };
  }
  if (!/^#[A-Za-z_][\w:.-]*$/.test(requestedTarget)) return wholeSvgPreview(root, "the requested target is invalid.");
  const id = requestedTarget.slice(1);
  const matches = targetsById(root, id);
  if (matches.length === 0) return wholeSvgPreview(root, `${requestedTarget} is missing.`);
  if (matches.length > 1) return wholeSvgPreview(root, `${requestedTarget} is duplicated.`);
  const target = matches[0];
  if (!ELIGIBLE_TARGETS.has(target.localName)) return wholeSvgPreview(root, `${requestedTarget} is not an eligible graphics target.`);
  if (hiddenBySvgPresentation(target, root)) return wholeSvgPreview(root, `${requestedTarget} is hidden.`);
  const bounds = measure(target, root);
  if (!finiteBounds(bounds)) return wholeSvgPreview(root, `${requestedTarget} has no usable visible bounds.`);

  const padding = Math.max(bounds.width, bounds.height) * 0.08;
  if (!isolateTargetBranch(target, root)) return wholeSvgPreview(root, `${requestedTarget} has an ambiguous local reference graph.`);
  root.setAttribute("viewBox", [bounds.x - padding, bounds.y - padding, bounds.width + padding * 2, bounds.height + padding * 2]
    .map((value) => Number(value.toFixed(4)))
    .join(" "));
  root.removeAttribute("width");
  root.removeAttribute("height");
  root.setAttribute("preserveAspectRatio", "xMidYMid meet");
  return {
    svg: root.outerHTML,
    targetId: id,
    fallback: false,
    status: `Previewing ${requestedTarget}.`,
  };
}
