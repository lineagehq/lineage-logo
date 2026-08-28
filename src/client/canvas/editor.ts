import { off, SVG, type Element as SvgElement, type Svg } from "@svgdotjs/svg.js";
import "@svgdotjs/svg.draggable.js";
import "@svgdotjs/svg.select.js";
import "@svgdotjs/svg.resize.js";
import { History } from "../history/history";
import { evaluateAgentTransaction, type AgentDocumentContext, type AgentSelectionIntent, type StagedAgentTransaction } from "../agent/transaction";
import type { AgentTransactionV1 } from "../../shared/agent-protocol";
import {
  composeGroupScale,
  formatMatrix,
  GroupTransformGesture,
  relativeMatrix,
  SelectionTranslationGesture,
  transformVectorToLocal,
  type MatrixCoefficients,
  type SelectionTranslationTarget,
  type TransformBox,
} from "./transform";
import { marqueeMatches, renderedClientRect, type ClientRect, type MarqueeHitRule } from "./marquee-selection";
import { DEFAULT_SELECTION_PREFERENCES, type SelectionPreferences } from "../selection-preferences";

interface EditorControls {
  alignBottomButton: HTMLButtonElement;
  alignCenterButton: HTMLButtonElement;
  alignLeftButton: HTMLButtonElement;
  alignmentReason: HTMLElement;
  alignMiddleButton: HTMLButtonElement;
  alignRightButton: HTMLButtonElement;
  alignTopButton: HTMLButtonElement;
  distributeHorizontalButton: HTMLButtonElement;
  distributeVerticalButton: HTMLButtonElement;
  groupButton: HTMLButtonElement;
  hierarchyReason: HTMLElement;
  lockButton: HTMLButtonElement;
  name: HTMLInputElement;
  nameClearButton: HTMLButtonElement;
  reorderEarlierButton: HTMLButtonElement;
  reorderLaterButton: HTMLButtonElement;
  deleteButton: HTMLButtonElement;
  duplicateButton: HTMLButtonElement;
  fill: HTMLInputElement;
  fillError: HTMLElement;
  fillPicker: HTMLInputElement;
  fillState: HTMLElement;
  hideButton: HTMLButtonElement;
  opacity: HTMLInputElement;
  positionX: HTMLInputElement;
  positionY: HTMLInputElement;
  rotation: HTMLInputElement;
  scale: HTMLInputElement;
  selectionEmpty: HTMLElement;
  selectionName: HTMLElement;
  selectionPanel: HTMLElement;
  stroke: HTMLInputElement;
  strokeError: HTMLElement;
  strokePicker: HTMLInputElement;
  strokeState: HTMLElement;
  strokeWidth: HTMLInputElement;
  spaceHorizontalButton: HTMLButtonElement;
  spaceVerticalButton: HTMLButtonElement;
  textAnchor: HTMLSelectElement;
  textContent: HTMLInputElement;
  textError: HTMLElement;
  textFamily: HTMLInputElement;
  textLetterSpacing: HTMLInputElement;
  textSize: HTMLInputElement;
  textWeight: HTMLInputElement;
  ungroupButton: HTMLButtonElement;
}

interface EditorCallbacks {
  onDocumentChange: (svg: SVGSVGElement) => void;
  onDirtyChange: (dirty: boolean) => void;
  onHistoryChange: (canUndo: boolean, canRedo: boolean) => void;
  onSelectionChange: (element?: SVGGraphicsElement) => void;
  onSelectionContextChange: (context: SelectionContext) => void;
  onStatus: (message: string) => void;
}

export interface SelectionContext {
  activeScope?: SVGGraphicsElement;
  breadcrumb: SVGGraphicsElement[];
  canDrillBack: boolean;
  canEditInside: boolean;
  hovered?: SVGGraphicsElement;
  lockedKeys: Set<string>;
  selectedNodes: SVGGraphicsElement[];
  selected?: SVGGraphicsElement;
}

const HANDLE_SELECTOR = [
  ".svg_select_shape",
  ".svg_select_shape_pointSelect",
  ".svg_select_handle",
  ".svg_select_handle_rot",
  "[data-lineage-selection-halos]",
].join(",");
const SELECTION_BOUNDING_SHAPE_SELECTOR = ".svg_select_shape, .svg_select_shape_pointSelect";

const EDITABLE_SELECTOR = "g, path, rect, circle, ellipse, polygon, polyline, line, text";
const RESOURCE_SELECTOR = "defs, metadata, clipPath, mask, filter, linearGradient, radialGradient, pattern, marker, symbol";
const HOVER_ATTRIBUTE = "data-lineage-hover";
const SECONDARY_ATTRIBUTE = "data-lineage-secondary";
const PRIMARY_FALLBACK_ATTRIBUTE = "data-lineage-primary-fallback";
const SELECTION_HALOS_SELECTOR = "[data-lineage-selection-halos]";
const REVIEW_ATTRIBUTE = "data-lineage-review-highlight";
const ROTATION_HANDLE_SELECTOR = ".svg_select_handle_rot";
const ROTATION_KNOB_CLASS = "lineage-rotation-knob";
const ROTATION_ICON_CLASS = "lineage-rotation-icon";
const ROTATION_ICON_PATH = "M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5";
const ROTATION_HIT_TARGET_DIAMETER_PX = 30;
const ROTATION_KNOB_DIAMETER_PX = 18;
const ROTATION_ICON_DIAMETER_PX = 12;

export type SvgPaintProperty = "fill" | "stroke";

interface RotationMatrix {
  a: number;
  b: number;
}

export function matrixRotationDegrees(matrix: RotationMatrix): number {
  const degrees = Math.atan2(matrix.b, matrix.a) * (180 / Math.PI);
  return normalizeRotationDegrees(degrees);
}

function normalizeRotationDegrees(degrees: number): number {
  const normalized = ((degrees + 180) % 360 + 360) % 360 - 180;
  const rounded = Number(normalized.toFixed(1));
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function rotationHandleRadii(screenScale: number): { hit: number; knob: number } {
  const scale = Number.isFinite(screenScale) && screenScale > 0 ? screenScale : 1;
  return {
    hit: ROTATION_HIT_TARGET_DIAMETER_PX / 2 / scale,
    knob: ROTATION_KNOB_DIAMETER_PX / 2 / scale,
  };
}

function enhanceRotationHandle(root: SVGSVGElement): void {
  const handle = root.querySelector<SVGGElement>(ROTATION_HANDLE_SELECTOR);
  const knob = handle?.querySelector<SVGCircleElement>("circle");
  if (!handle || !knob) return;
  const matrix = knob.getScreenCTM();
  const scaleX = matrix ? Math.hypot(matrix.a, matrix.b) : 1;
  const scaleY = matrix ? Math.hypot(matrix.c, matrix.d) : scaleX;
  const measuredScale = Math.max(scaleX, scaleY);
  const screenScale = Number.isFinite(measuredScale) && measuredScale > 0 ? measuredScale : 1;
  const { hit, knob: knobRadius } = rotationHandleRadii(screenScale);
  knob.classList.add(ROTATION_KNOB_CLASS);
  knob.setAttribute("r", String(knobRadius));
  knob.setAttribute("stroke-width", String((hit - knobRadius) * 2));

  const icon = handle.querySelector<SVGPathElement>(`.${ROTATION_ICON_CLASS}`)
    ?? root.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path");
  const centerX = Number(knob.getAttribute("cx"));
  const centerY = Number(knob.getAttribute("cy"));
  const iconScale = ROTATION_ICON_DIAMETER_PX / 24 / screenScale;
  icon.classList.add(ROTATION_ICON_CLASS);
  icon.setAttribute("d", ROTATION_ICON_PATH);
  icon.setAttribute("transform", `translate(${centerX - 12 * iconScale} ${centerY - 12 * iconScale}) scale(${iconScale})`);
  if (!icon.isConnected) handle.append(icon);
}

export type SvgTextProperty = "content" | "font-size" | "font-weight" | "font-family" | "text-anchor" | "letter-spacing";

export interface SvgTextEdit {
  property: SvgTextProperty;
  value: string;
}

export interface SvgTextValidation {
  valid: boolean;
  normalized?: string;
  error?: string;
}

const TEXT_LIMITS = {
  content: 2048,
  family: 128,
  size: 1000,
  spacing: 100,
};

const CSS_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

function decodeCssEscapes(value: string): string {
  return value.replace(/\\(?:([0-9a-f]{1,6})(?:\r\n|[\t\n\f\r ])?|\r\n|[\n\r\f]|(.))/gi, (_match, hex: string | undefined, escaped: string | undefined) => {
    if (hex) {
      const codePoint = Number.parseInt(hex, 16);
      return codePoint === 0 || codePoint > 0x10ffff ? "\uFFFD" : String.fromCodePoint(codePoint);
    }
    return escaped ?? "";
  });
}

export function validateSvgTextEdit(edit: SvgTextEdit): SvgTextValidation {
  const value = edit.value.trim();
  if (edit.property === "content") {
    if (edit.value.length > TEXT_LIMITS.content) return { valid: false, error: `Text is limited to ${TEXT_LIMITS.content} characters.` };
    if (/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(edit.value)) {
      return { valid: false, error: "Text must be plain content without markup or control characters." };
    }
    return { valid: true, normalized: edit.value };
  }
  if (edit.property === "text-anchor") {
    const keyword = value.toLowerCase();
    return ["start", "middle", "end"].includes(keyword)
      ? { valid: true, normalized: keyword }
      : { valid: false, error: "Alignment must be start, middle, or end." };
  }
  if (edit.property === "font-weight") {
    const keyword = value.toLowerCase();
    if (["normal", "bold", "bolder", "lighter"].includes(keyword)) return { valid: true, normalized: keyword };
    const weight = Number(value);
    return CSS_NUMBER.test(value) && Number.isInteger(weight) && weight >= 1 && weight <= 1000
      ? { valid: true, normalized: String(weight) }
      : { valid: false, error: "Weight must be normal, bold, bolder, lighter, or an integer from 1 to 1000." };
  }
  if (edit.property === "font-family") {
    if (!value || value.length > TEXT_LIMITS.family || /(?:url\s*\(|@import|[;{}<>\\])/i.test(value)
      || !/^[\p{L}\p{N} _,'".-]+(?:\s*,\s*[\p{L}\p{N} _,'".-]+)*$/u.test(value)) {
      return { valid: false, error: "Use a bounded local font-family list without URLs, CSS, or external font rules." };
    }
    return { valid: true, normalized: value };
  }
  if (edit.property === "font-size") {
    const size = Number(value);
    const normalized = Number(size.toFixed(4));
    return CSS_NUMBER.test(value) && Number.isFinite(size) && normalized > 0 && normalized <= TEXT_LIMITS.size
      ? { valid: true, normalized: String(normalized) }
      : { valid: false, error: `Font size must be at least 0.0001 and at most ${TEXT_LIMITS.size}.` };
  }
  const spacing = Number(value);
  if (value.toLowerCase() === "normal") return { valid: true, normalized: "normal" };
  return CSS_NUMBER.test(value) && Number.isFinite(spacing) && Math.abs(spacing) <= TEXT_LIMITS.spacing
    ? { valid: true, normalized: String(Number(spacing.toFixed(4))) }
    : { valid: false, error: `Letter spacing must be normal or between -${TEXT_LIMITS.spacing} and ${TEXT_LIMITS.spacing}.` };
}

const GENERIC_FONT_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "emoji", "math", "fangsong",
]);

function fontFamilies(value: string): string[] {
  const decoded = decodeCssEscapes(value.replace(/\/\*[\s\S]*?\*\//g, " "));
  const families: string[] = [];
  let start = 0;
  let quote = "";
  for (let index = 0; index < decoded.length; index += 1) {
    const character = decoded[index];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === ",") {
      families.push(decoded.slice(start, index));
      start = index + 1;
    }
  }
  families.push(decoded.slice(start));
  return families.map((family) => family.trim().replace(/^(['"])([\s\S]*)\1$/, "$2").replace(/\s+/g, " ").toLowerCase());
}

function activatesExternalFont(node: SVGTextElement, value: string): boolean {
  const requested = fontFamilies(value).filter((family) => !GENERIC_FONT_FAMILIES.has(family));
  if (requested.length === 0) return false;
  const root = node.closest("svg");
  if (!root) return false;
  // CSS comments are whitespace to the browser. Strip them only in this
  // detection copy so formatting stays byte-exact and cannot hide a rule.
  const css = Array.from(root.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
  const decodedCss = decodeCssEscapes(css);
  if (/@\s*import\b/i.test(decodedCss) || root.querySelector('link[rel~="stylesheet" i][href]')) return true;
  // Let the browser parse a detached CSSOM copy so quoted or escaped braces
  // cannot confuse rule boundaries and no stylesheet is activated or fetched.
  for (const style of Array.from(root.querySelectorAll("style"))) {
    let rules: CSSRuleList;
    try {
      if (style.sheet?.cssRules.length) {
        rules = style.sheet.cssRules;
      } else {
        const Sheet = root.ownerDocument.defaultView?.CSSStyleSheet;
        if (!Sheet) return true;
        const sheet = new Sheet();
        sheet.replaceSync(decodeCssEscapes((style.textContent ?? "").replace(/\/\*[\s\S]*?\*\//g, "")));
        rules = sheet.cssRules;
      }
    } catch {
      return true;
    }
    const pending = [...Array.from(rules)];
    while (pending.length > 0) {
      const rule = pending.shift()!;
      const nested = (rule as CSSRule & { cssRules?: CSSRuleList }).cssRules;
      if (nested) pending.push(...Array.from(nested));
      if (rule.type !== 5) continue;
      const fontFace = rule as CSSFontFaceRule;
      const family = fontFace.style.getPropertyValue("font-family");
      const source = fontFace.style.getPropertyValue("src");
      if (source && /url\s*\(/i.test(decodeCssEscapes(source))
        && fontFamilies(family).some((candidate) => requested.includes(candidate))) return true;
    }
  }
  return false;
}

function effectiveTextValue(property: Exclude<SvgTextProperty, "content">, value: string): string | undefined {
  const validation = validateSvgTextEdit({ property, value });
  if (!validation.valid || validation.normalized === undefined) return undefined;
  if (property === "font-family") return fontFamilies(validation.normalized).join(",");
  if (property === "font-weight") {
    const weight = validation.normalized.toLowerCase();
    if (weight === "normal") return "400";
    if (weight === "bold") return "700";
    return weight;
  }
  if (property === "text-anchor" || property === "letter-spacing") {
    return validation.normalized.toLowerCase();
  }
  return validation.normalized;
}

function importedTextValue(property: Exclude<SvgTextProperty, "content">, value: string): string {
  if ((property === "font-size" || property === "letter-spacing") && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?px$/i.test(value.trim())) {
    return value.trim().slice(0, -2);
  }
  return value;
}

function cssTextValue(property: Exclude<SvgTextProperty, "content">, value: string): string {
  if ((property === "font-size" || property === "letter-spacing") && value.toLowerCase() !== "normal") return `${value}px`;
  return value;
}

function displayedTextValue(node: SVGTextElement, property: Exclude<SvgTextProperty, "content">, fallback = ""): string {
  const explicit = node.style.getPropertyValue(property) || node.getAttribute(property);
  if (explicit) return importedTextValue(property, explicit);
  try {
    const computed = node.ownerDocument.defaultView?.getComputedStyle(node).getPropertyValue(property);
    return computed ? importedTextValue(property, computed) : fallback;
  } catch { return fallback; }
}

function cssControlsTextProperty(node: SVGTextElement, property: Exclude<SvgTextProperty, "content">): { controlled: boolean; important: boolean } {
  let controlled = Boolean(node.style.getPropertyValue(property));
  let important = node.style.getPropertyPriority(property) === "important";
  const root = node.closest("svg");
  if (!root) return { controlled, important };
  for (const style of Array.from(root.querySelectorAll("style"))) {
    let rules: CSSRuleList;
    try {
      if (style.sheet?.cssRules.length) rules = style.sheet.cssRules;
      else {
        const Sheet = root.ownerDocument.defaultView?.CSSStyleSheet;
        if (!Sheet) continue;
        const sheet = new Sheet();
        sheet.replaceSync(style.textContent ?? "");
        rules = sheet.cssRules;
      }
    } catch { continue; }
    const pending = [...Array.from(rules)];
    while (pending.length > 0) {
      const rule = pending.shift()!;
      const nested = (rule as CSSRule & { cssRules?: CSSRuleList }).cssRules;
      if (nested) pending.push(...Array.from(nested));
      if (rule.type !== 1) continue;
      const cssRule = rule as CSSStyleRule;
      try {
        if (!node.matches(cssRule.selectorText) || !cssRule.style.getPropertyValue(property)) continue;
      } catch { continue; }
      controlled = true;
      important ||= cssRule.style.getPropertyPriority(property) === "important";
    }
  }
  return { controlled, important };
}

export function applySvgTextEdit(node: SVGTextElement, edit: SvgTextEdit): { changed: boolean; error?: string } {
  const current = edit.property === "content" ? null : node.getAttribute(edit.property);
  // Existing SVG may use CSS escapes or comments that the bounded editor does
  // not accept for new values. A browser-equivalent family commit is still an
  // exact no-op and must not rewrite those imported bytes.
  if (edit.property === "font-family" && current !== null
    && fontFamilies(current).join(",") === fontFamilies(edit.value).join(",")) {
    return { changed: false };
  }
  const validation = validateSvgTextEdit(edit);
  if (!validation.valid || validation.normalized === undefined) return { changed: false, error: validation.error };
  if (edit.property === "content") {
    if (Array.from(node.childNodes).some((child) => child.nodeType !== 3) || node.childNodes.length > 1) {
      return { changed: false, error: "Content editing is unavailable for structured text; typography edits remain available." };
    }
    if (node.textContent === validation.normalized) return { changed: false };
    node.textContent = validation.normalized;
    return { changed: true };
  }
  if (edit.property === "font-family" && activatesExternalFont(node, validation.normalized)) {
    return { changed: false, error: "This family could activate an imported or URL-backed font. Use a local family list." };
  }
  const cssControl = cssControlsTextProperty(node, edit.property);
  const inlineCurrent = node.style.getPropertyValue(edit.property);
  const effectiveCurrent = inlineCurrent || current || (cssControl.controlled ? displayedTextValue(node, edit.property) : null);
  if (effectiveCurrent !== null && effectiveTextValue(edit.property, importedTextValue(edit.property, effectiveCurrent))
    === effectiveTextValue(edit.property, validation.normalized)) {
    return { changed: false };
  }
  if (cssControl.controlled) {
    node.removeAttribute(edit.property);
    node.style.setProperty(edit.property, cssTextValue(edit.property, validation.normalized), cssControl.important ? "important" : "");
    return { changed: true };
  }
  node.setAttribute(edit.property, validation.normalized);
  return { changed: true };
}

export function isValidSvgPaint(
  value: string,
  property: SvgPaintProperty,
  supports: (property: string, value: string) => boolean = (candidateProperty, candidateValue) => {
    if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
      return CSS.supports(candidateProperty, candidateValue);
    }
    const probe = document.createElementNS("http://www.w3.org/2000/svg", "path");
    probe.style.setProperty(candidateProperty, candidateValue);
    return probe.style.getPropertyValue(candidateProperty) !== "";
  },
): boolean {
  const candidate = value.trim();
  return candidate === "" || supports(property, candidate);
}

export function paintPickerValue(value: string): string | undefined {
  const candidate = value.trim();
  const short = /^#([\da-f]{3})$/i.exec(candidate);
  if (short) return `#${Array.from(short[1], (character) => character.repeat(2)).join("")}`.toLowerCase();
  return /^#[\da-f]{6}$/i.test(candidate) ? candidate.toLowerCase() : undefined;
}

export function svgPaintState(value: string | null): string {
  if (value === null || value.trim() === "") return "Inherited / SVG default";
  const candidate = value.trim();
  if (candidate === "none") return "No paint";
  if (candidate.toLowerCase() === "currentcolor") return "Uses currentColor";
  if (/^url\(/i.test(candidate)) return "Paint server / gradient";
  return paintPickerValue(candidate) ? "Solid color" : "CSS paint value";
}

export class InspectorEditSession {
  #checkpointed = false;
  #focusedSnapshot = "";

  begin(snapshot: string): void {
    this.#focusedSnapshot = snapshot;
    this.#checkpointed = false;
  }

  checkpointForChange(before: string, after: string): string | undefined {
    if (before === after || this.#checkpointed) return undefined;
    this.#checkpointed = true;
    return this.#focusedSnapshot || before;
  }
}

export function serializeSvg(root: SVGSVGElement | undefined, stripEditorState: boolean): string {
  if (!root) return "";
  const clone = root.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll(SELECTION_HALOS_SELECTOR).forEach((node) => node.remove());
  const handles = Array.from(clone.querySelectorAll(HANDLE_SELECTOR));
  const handleGroups = new Set(
    handles
      .map((node) => node.parentElement)
      .filter((parent) =>
        parent !== null
        && parent.localName === "g"
        && Array.from(parent.children).every((child) => child.matches(HANDLE_SELECTOR)),
      ),
  );
  handleGroups.forEach((group) => group?.remove());
  handles.forEach((node) => node.remove());
  for (const element of [clone, ...Array.from(clone.querySelectorAll("*"))]) {
    element.removeAttribute(HOVER_ATTRIBUTE);
    element.removeAttribute(SECONDARY_ATTRIBUTE);
    element.removeAttribute(PRIMARY_FALLBACK_ATTRIBUTE);
    element.removeAttribute(REVIEW_ATTRIBUTE);
  }

  if (stripEditorState) {
    for (const metadata of Array.from(clone.querySelectorAll("metadata#lineage-logo-edit"))) metadata.remove();
    if (clone.hasAttribute("data-lineage-added-role")) clone.removeAttribute("role");
    if (clone.hasAttribute("data-lineage-added-label")) clone.removeAttribute("aria-label");
    for (const element of [clone, ...Array.from(clone.querySelectorAll("*"))]) {
      for (const attribute of Array.from(element.attributes)) {
        if (/^data-(?:lineage|agent|review|transport)-/.test(attribute.name)) {
          element.removeAttribute(attribute.name);
        }
      }
    }
  }

  return clone.outerHTML;
}

function dirtyComparisonKey(source: string): string {
  const root = source.match(/^<([A-Za-z_][\w:.-]*)/);
  if (!root) return source;
  let index = root[0].length;
  const ordinaryAttributes: string[] = [];
  const namespaceDeclarations: string[] = [];
  while (index < source.length) {
    while (/\s/.test(source[index] ?? "")) index += 1;
    if (source[index] === ">" || (source[index] === "/" && source[index + 1] === ">")) break;
    const tokenStart = index;
    while (index < source.length && !/[\s=/>]/.test(source[index])) index += 1;
    const name = source.slice(tokenStart, index);
    if (!name) return source;
    while (/\s/.test(source[index] ?? "")) index += 1;
    if (source[index] !== "=") return source;
    index += 1;
    while (/\s/.test(source[index] ?? "")) index += 1;
    const quote = source[index];
    if (quote !== '"' && quote !== "'") return source;
    index += 1;
    while (index < source.length && source[index] !== quote) index += 1;
    if (source[index] !== quote) return source;
    index += 1;
    const token = source.slice(tokenStart, index);
    if (name === "xmlns" || name.startsWith("xmlns:")) namespaceDeclarations.push(token);
    else ordinaryAttributes.push(token);
  }
  if (index >= source.length) return source;
  return JSON.stringify([
    root[0],
    ordinaryAttributes,
    namespaceDeclarations.sort(),
    source.slice(index),
  ]);
}

export function cleanSvgsEqualForDirtyComparison(left: string, right: string): boolean {
  return left === right || dirtyComparisonKey(left) === dirtyComparisonKey(right);
}

export function visibleHistoryAvailability(blocked: boolean, canUndo: boolean, canRedo: boolean): { canUndo: boolean; canRedo: boolean } {
  return blocked ? { canUndo: false, canRedo: false } : { canUndo, canRedo };
}

export function getLogicalSelectionTarget(
  target: SVGGraphicsElement,
  root: SVGSVGElement,
): SVGGraphicsElement | undefined {
  return getScopedSelectionTarget(target, root, root);
}

export function isSelectableNode(node: Element, root: SVGSVGElement): node is SVGGraphicsElement {
  return node !== root
    && node.matches(EDITABLE_SELECTOR)
    && node.closest("svg") === root
    && !node.closest(RESOURCE_SELECTOR)
    && !node.matches(HANDLE_SELECTOR)
    && !node.closest(HANDLE_SELECTOR)
    && !node.querySelector(HANDLE_SELECTOR);
}

export function getSelectableParent(
  node: Element,
  root: SVGSVGElement,
): SVGGraphicsElement | SVGSVGElement | undefined {
  let parent = node.parentElement as Element | null;
  while (parent) {
    if (parent === root) return root;
    if (isSelectableNode(parent, root)) return parent;
    if (parent.localName === "svg") return undefined;
    parent = parent.parentElement;
  }
  return undefined;
}

export function getDirectSelectionTarget(
  target: Element,
  root: SVGSVGElement,
): SVGGraphicsElement | undefined {
  let candidate: Element | null = target;
  while (candidate && candidate !== root) {
    if (isSelectableNode(candidate, root)) return candidate;
    if (candidate.localName === "svg" || candidate.closest(RESOURCE_SELECTOR)) return undefined;
    candidate = candidate.parentElement;
  }
  return undefined;
}

export function getScopedSelectionTarget(
  target: Element,
  scope: SVGGraphicsElement | SVGSVGElement,
  root: SVGSVGElement,
): SVGGraphicsElement | undefined {
  if (target === scope || !scope.contains(target)) return undefined;
  let candidate = getDirectSelectionTarget(target, root);
  while (candidate) {
    const parent = getSelectableParent(candidate, root);
    if (parent === scope) return candidate;
    if (!parent || parent === root) return undefined;
    candidate = parent;
  }
  return undefined;
}

export function getSelectionAncestry(
  node: SVGGraphicsElement | undefined,
  root: SVGSVGElement,
): SVGGraphicsElement[] {
  if (!node || !isSelectableNode(node, root)) return [];
  const ancestry: SVGGraphicsElement[] = [];
  let candidate: SVGGraphicsElement | SVGSVGElement | undefined = node;
  while (candidate && candidate !== root) {
    ancestry.unshift(candidate as SVGGraphicsElement);
    candidate = getSelectableParent(candidate, root);
  }
  return ancestry;
}

export function getSelectionLabel(node: SVGGraphicsElement, root: SVGSVGElement): string {
  const accessibleName = node.getAttribute("aria-label")?.trim();
  if (accessibleName) return accessibleName;
  if (node.id && Array.from(root.querySelectorAll("[id]")).filter((candidate) => candidate.id === node.id).length === 1) {
    return node.id;
  }
  const parent = getSelectableParent(node, root);
  const siblings = parent
    ? Array.from(parent.children).filter((candidate) => isSelectableNode(candidate, root) && candidate.localName === node.localName)
    : [];
  return `${node.localName}-${Math.max(1, siblings.indexOf(node) + 1)}`;
}

export type HierarchyDirection = "earlier" | "later";
export type AlignmentDirection = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type DistributionDirection = "horizontal-centers" | "vertical-centers" | "horizontal-gaps" | "vertical-gaps";

export interface AlignmentBox {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface AlignmentOffset {
  dx: number;
  dy: number;
}

function transformBox(box: AlignmentBox, matrix: MatrixCoefficients): AlignmentBox {
  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x, y: box.y + box.height },
    { x: box.x + box.width, y: box.y + box.height },
  ].map((point) => ({
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  }));
  const x = Math.min(...corners.map((point) => point.x));
  const right = Math.max(...corners.map((point) => point.x));
  const y = Math.min(...corners.map((point) => point.y));
  const bottom = Math.max(...corners.map((point) => point.y));
  if (![x, right, y, bottom].every(Number.isFinite)) throw new RangeError("A selected layer has invalid visual bounds.");
  return { x, y, width: right - x, height: bottom - y };
}

function rootBox(node: SVGGraphicsElement, root: SVGSVGElement): AlignmentBox {
  const rootScreen = screenMatrix(root);
  const nodeScreen = screenMatrix(node);
  if (!rootScreen || !nodeScreen) throw new RangeError("A selected layer's visual bounds are unavailable.");
  return transformBox(node.getBBox(), relativeMatrix(rootScreen, nodeScreen));
}

export interface OperationAvailability {
  allowed: boolean;
  reason: string;
}

function matrixCoefficients(matrix: DOMMatrix | SVGMatrix | null): MatrixCoefficients | undefined {
  if (!matrix) return undefined;
  const value = { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f };
  return Object.values(value).every(Number.isFinite) ? value : undefined;
}

function screenMatrix(node: SVGElement): MatrixCoefficients | undefined {
  return matrixCoefficients((node as SVGGraphicsElement).getScreenCTM?.() ?? null);
}

function parentToRootMatrix(node: SVGGraphicsElement, root: SVGSVGElement): MatrixCoefficients {
  const parent = node.parentElement as SVGElement | null;
  const rootScreen = screenMatrix(root);
  const parentScreen = parent === root ? rootScreen : parent ? screenMatrix(parent) : undefined;
  if (!rootScreen || !parentScreen) throw new RangeError("The selected layer's coordinate space is unavailable.");
  return relativeMatrix(rootScreen, parentScreen);
}

function translationTargets(nodes: SVGGraphicsElement[], root: SVGSVGElement): SelectionTranslationTarget[] {
  return nodes.map((node) => ({
    element: node,
    initial: (SVG(node) as SvgElement).matrixify(),
    parentToRoot: parentToRootMatrix(node, root),
  }));
}

function isHiddenForTranslation(node: SVGGraphicsElement, root: SVGSVGElement): boolean {
  let candidate: Element | null = node;
  while (candidate) {
    const computed = candidate.ownerDocument.defaultView?.getComputedStyle(candidate);
    const display = computed?.display || candidate.getAttribute("display");
    const visibility = computed?.visibility || candidate.getAttribute("visibility");
    const opacity = computed?.opacity || candidate.getAttribute("opacity");
    if (display === "none" || visibility === "hidden" || visibility === "collapse"
      || (opacity !== null && opacity !== "" && Number.isFinite(Number(opacity)) && Number(opacity) <= 0)) return true;
    if (candidate === root) break;
    candidate = candidate.parentElement;
  }
  return false;
}

function hasCssControlledTransform(node: SVGGraphicsElement, root: SVGSVGElement): boolean {
  if (node.style.getPropertyValue("transform")) return true;
  for (const style of Array.from(root.querySelectorAll("style"))) {
    let rules: CSSRuleList;
    try {
      if (style.sheet) {
        rules = style.sheet.cssRules;
      } else {
        const Sheet = root.ownerDocument.defaultView?.CSSStyleSheet;
        if (!Sheet) return true;
        const sheet = new Sheet();
        sheet.replaceSync(style.textContent ?? "");
        rules = sheet.cssRules;
      }
    } catch {
      return true;
    }
    const pending = [...Array.from(rules)];
    while (pending.length > 0) {
      const rule = pending.shift() as CSSRule & { cssRules?: CSSRuleList; selectorText?: string; style?: CSSStyleDeclaration };
      if (rule.cssRules) pending.push(...Array.from(rule.cssRules));
      if (!rule.selectorText || !rule.style?.getPropertyValue("transform")) continue;
      try {
        if (node.matches(rule.selectorText)) return true;
      } catch {
        return true;
      }
    }
  }
  return false;
}

export function translationAvailability(
  nodes: SVGGraphicsElement[],
  root: SVGSVGElement,
  isLocked: (node: SVGGraphicsElement) => boolean = () => false,
  agentBlocked = false,
): OperationAvailability {
  const unique = Array.from(new Set(nodes));
  if (agentBlocked) return { allowed: false, reason: "Finish the pending Agent review before moving layers." };
  if (unique.length === 0) return { allowed: false, reason: "Select at least one visible layer to move." };
  if (unique.some((node) => !node.isConnected || !isSelectableNode(node, root))) {
    return { allowed: false, reason: "Every selected layer must remain connected and editable before moving." };
  }
  if (unique.some((ancestor) => unique.some((descendant) => ancestor !== descendant && ancestor.contains(descendant)))) {
    return { allowed: false, reason: "Select either a group or its nested layers before moving them together." };
  }
  if (unique.some((node) => isHiddenForTranslation(node, root))) {
    return { allowed: false, reason: "Show every selected layer and its ancestors before moving the selection." };
  }
  if (unique.some((node) => hasCssControlledTransform(node, root))) {
    return { allowed: false, reason: "Convert CSS transforms on every selected layer to SVG transform attributes before moving the selection." };
  }
  if (unique.some(isLocked)) return { allowed: false, reason: "Unlock every selected layer and its ancestors before moving the selection." };
  try {
    new SelectionTranslationGesture(translationTargets(unique, root));
  } catch (error) {
    return { allowed: false, reason: error instanceof Error ? error.message : "The selected coordinate spaces cannot be moved together." };
  }
  return { allowed: true, reason: "Move every selected layer by one shared visual delta." };
}

function directElementChildren(parent: Element): Element[] {
  return Array.from(parent.children).filter((child) => !child.matches(HANDLE_SELECTOR));
}

export function selectionBlock(
  nodes: SVGGraphicsElement[],
  root: SVGSVGElement,
): SVGGraphicsElement[] | undefined {
  const unique = Array.from(new Set(nodes));
  if (unique.length === 0 || unique.some((node) => !isSelectableNode(node, root))) return undefined;
  const parent = unique[0].parentElement;
  if (!parent || unique.some((node) => node.parentElement !== parent)) return undefined;
  const children = directElementChildren(parent);
  const ordered = unique.toSorted((left, right) => children.indexOf(left) - children.indexOf(right));
  const indexes = ordered.map((node) => children.indexOf(node));
  if (indexes.some((index, position) => position > 0 && index !== indexes[position - 1] + 1)) return undefined;
  return ordered;
}

function documentHasStyle(root: SVGSVGElement): boolean {
  return root.querySelector("style") !== null;
}

export function alignmentAvailability(
  nodes: SVGGraphicsElement[],
  root: SVGSVGElement,
  isLocked: (node: SVGGraphicsElement) => boolean = () => false,
): OperationAvailability {
  const unique = Array.from(new Set(nodes));
  if (unique.length < 2) return { allowed: false, reason: "Select at least two sibling layers to align." };
  if (unique.some((node) => !isSelectableNode(node, root))) {
    return { allowed: false, reason: "Alignment requires supported editable layers." };
  }
  const parent = unique[0].parentElement;
  if (!parent || unique.some((node) => node.parentElement !== parent)) {
    return { allowed: false, reason: "Alignment requires selected layers with the same parent." };
  }
  if (unique.some(isLocked)) return { allowed: false, reason: "Unlock the selected layers and their ancestors before aligning." };
  return { allowed: true, reason: "Align the selection to its shared bounding box." };
}

export function alignmentOffsets(boxes: AlignmentBox[], direction: AlignmentDirection): AlignmentOffset[] {
  if (boxes.length === 0) return [];
  const left = Math.min(...boxes.map((box) => box.x));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const top = Math.min(...boxes.map((box) => box.y));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  const center = (left + right) / 2;
  const middle = (top + bottom) / 2;
  return boxes.map((box) => {
    if (direction === "left") return { dx: left - box.x, dy: 0 };
    if (direction === "center") return { dx: center - (box.x + box.width / 2), dy: 0 };
    if (direction === "right") return { dx: right - (box.x + box.width), dy: 0 };
    if (direction === "top") return { dx: 0, dy: top - box.y };
    if (direction === "middle") return { dx: 0, dy: middle - (box.y + box.height / 2) };
    return { dx: 0, dy: bottom - (box.y + box.height) };
  });
}

export function distributionOffsets(boxes: AlignmentBox[], direction: DistributionDirection): AlignmentOffset[] {
  if (boxes.length < 3) return boxes.map(() => ({ dx: 0, dy: 0 }));
  const horizontal = direction.startsWith("horizontal");
  const gaps = direction.endsWith("gaps");
  const start = (box: AlignmentBox) => horizontal ? box.x : box.y;
  const size = (box: AlignmentBox) => horizontal ? box.width : box.height;
  const center = (box: AlignmentBox) => start(box) + size(box) / 2;
  const ordered = boxes.map((box, index) => ({ box, index }))
    .toSorted((left, right) => (gaps ? start(left.box) - start(right.box) : center(left.box) - center(right.box)) || left.index - right.index);
  const result = boxes.map(() => ({ dx: 0, dy: 0 }));
  if (gaps) {
    const first = ordered[0].box;
    const last = ordered.at(-1)!.box;
    const span = start(last) + size(last) - start(first);
    const totalSize = ordered.reduce((sum, item) => sum + size(item.box), 0);
    const gap = (span - totalSize) / (ordered.length - 1);
    let cursor = start(first) + size(first) + gap;
    for (const item of ordered.slice(1, -1)) {
      const delta = cursor - start(item.box);
      result[item.index] = horizontal ? { dx: delta, dy: 0 } : { dx: 0, dy: delta };
      cursor += size(item.box) + gap;
    }
  } else {
    const first = center(ordered[0].box);
    const last = center(ordered.at(-1)!.box);
    const step = (last - first) / (ordered.length - 1);
    for (const [position, item] of ordered.slice(1, -1).entries()) {
      const delta = first + (position + 1) * step - center(item.box);
      result[item.index] = horizontal ? { dx: delta, dy: 0 } : { dx: 0, dy: delta };
    }
  }
  return result.map(({ dx, dy }) => ({
    dx: Math.abs(dx) < 1e-9 ? 0 : dx,
    dy: Math.abs(dy) < 1e-9 ? 0 : dy,
  }));
}

export function distributionAvailability(
  nodes: SVGGraphicsElement[],
  root: SVGSVGElement,
  isLocked: (node: SVGGraphicsElement) => boolean = () => false,
  agentBlocked = false,
): OperationAvailability {
  if (new Set(nodes).size < 3) return { allowed: false, reason: "Select at least three visible layers to distribute or space." };
  const translation = translationAvailability(nodes, root, isLocked, agentBlocked);
  if (!translation.allowed) return translation;
  try {
    nodes.forEach((node) => rootBox(node, root));
  } catch (error) {
    return { allowed: false, reason: error instanceof Error ? error.message : "The selected visual bounds are unavailable." };
  }
  return { allowed: true, reason: "Distribute centers or equalize edge gaps while keeping the outer layers fixed." };
}

export function applyAlignmentOffsets(
  nodes: SVGGraphicsElement[],
  offsets: AlignmentOffset[],
): boolean {
  let changed = false;
  nodes.forEach((node, index) => {
    const offset = offsets[index];
    if (!offset || (Math.abs(offset.dx) < 1e-9 && Math.abs(offset.dy) < 1e-9)) return;
    const element = SVG(node) as SvgElement;
    const matrix = element.matrixify();
    matrix.e += offset.dx;
    matrix.f += offset.dy;
    element.transform(matrix);
    changed = true;
  });
  return changed;
}

export function groupAvailability(
  nodes: SVGGraphicsElement[],
  root: SVGSVGElement,
  isLocked: (node: SVGGraphicsElement) => boolean = () => false,
): OperationAvailability {
  if (documentHasStyle(root)) return { allowed: false, reason: "Grouping is unavailable because this SVG contains a style element." };
  if (nodes.length < 2) return { allowed: false, reason: "Select at least two adjacent sibling layers to group." };
  if (nodes.some(isLocked)) return { allowed: false, reason: "Unlock the selected layers and their ancestors before grouping." };
  if (!selectionBlock(nodes, root)) return { allowed: false, reason: "Group requires adjacent selectable layers with the same parent." };
  return { allowed: true, reason: "Group the selected adjacent layers without changing their coordinate space." };
}

export function ungroupAvailability(
  node: SVGGraphicsElement | undefined,
  root: SVGSVGElement,
  isLocked: (node: SVGGraphicsElement) => boolean = () => false,
): OperationAvailability {
  if (documentHasStyle(root)) return { allowed: false, reason: "Ungrouping is unavailable because this SVG contains a style element." };
  if (!node || node.localName !== "g") return { allowed: false, reason: "Select one neutral group to ungroup." };
  if (isLocked(node)) return { allowed: false, reason: "Unlock this group and its ancestors before ungrouping." };
  const sourceAttributes = Array.from(node.attributes).filter((attribute) =>
    !attribute.name.startsWith("data-lineage-") && attribute.name !== "aria-label",
  );
  if (sourceAttributes.length > 0) {
    return { allowed: false, reason: `Ungroup is disabled because this group has source attribute ${sourceAttributes[0].name}.` };
  }
  const children = directElementChildren(node);
  if (children.length === 0 || children.some((child) => !isSelectableNode(child, root))) {
    return { allowed: false, reason: "Ungroup requires a neutral group containing only supported editable layers." };
  }
  return node.hasAttribute("aria-label")
    ? { allowed: true, reason: "Ungroup this neutral wrapper. Its group name will be removed." }
    : { allowed: true, reason: "Ungroup this neutral wrapper while preserving child order." };
}

export function reorderAvailability(
  nodes: SVGGraphicsElement[],
  root: SVGSVGElement,
  direction: HierarchyDirection,
  isLocked: (node: SVGGraphicsElement) => boolean = () => false,
): OperationAvailability {
  if (documentHasStyle(root)) return { allowed: false, reason: "Reordering is unavailable because this SVG contains a style element." };
  if (nodes.some(isLocked)) return { allowed: false, reason: "Unlock the selected layers and their ancestors before reordering." };
  const block = selectionBlock(nodes, root);
  if (!block) return { allowed: false, reason: "Reorder requires one layer or an adjacent sibling selection." };
  const parent = block[0].parentElement;
  if (!parent) return { allowed: false, reason: "The selected layers do not have a movable parent." };
  const siblings = directElementChildren(parent).filter((child): child is SVGGraphicsElement => isSelectableNode(child, root));
  const edge = direction === "earlier" ? block[0] : block.at(-1)!;
  const edgeIndex = siblings.indexOf(edge);
  const neighbor = siblings[edgeIndex + (direction === "earlier" ? -1 : 1)];
  if (!neighbor || block.includes(neighbor)) {
    return { allowed: false, reason: `The selection is already ${direction === "earlier" ? "earliest" : "latest"} in paint order.` };
  }
  return { allowed: true, reason: `Move the selection one layer ${direction} in SVG paint order.` };
}

export function groupSelection(nodes: SVGGraphicsElement[], root: SVGSVGElement): SVGGElement | undefined {
  const block = selectionBlock(nodes, root);
  if (!block || block.length < 2) return undefined;
  const parent = block[0].parentElement;
  if (!parent) return undefined;
  const group = root.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "g") as SVGGElement;
  parent.insertBefore(group, block[0]);
  block.forEach((node) => group.append(node));
  return group;
}

export function ungroupSelection(node: SVGGraphicsElement): SVGGraphicsElement[] {
  const parent = node.parentElement;
  if (!parent) return [];
  const children = directElementChildren(node) as SVGGraphicsElement[];
  children.forEach((child) => parent.insertBefore(child, node));
  node.remove();
  return children;
}

export function reorderSelection(
  nodes: SVGGraphicsElement[],
  root: SVGSVGElement,
  direction: HierarchyDirection,
): boolean {
  const block = selectionBlock(nodes, root);
  if (!block) return false;
  const parent = block[0].parentElement;
  if (!parent) return false;
  const siblings = directElementChildren(parent).filter((child): child is SVGGraphicsElement => isSelectableNode(child, root));
  if (direction === "earlier") {
    const neighbor = siblings[siblings.indexOf(block[0]) - 1];
    if (!neighbor) return false;
    block.forEach((node) => parent.insertBefore(node, neighbor));
  } else {
    const neighbor = siblings[siblings.indexOf(block.at(-1)!) + 1];
    if (!neighbor) return false;
    const anchor = neighbor.nextSibling;
    block.forEach((node) => parent.insertBefore(node, anchor));
  }
  return true;
}

export function renameLayer(node: SVGGraphicsElement, name: string): boolean {
  const trimmed = name.trim();
  const current = node.getAttribute("aria-label") ?? "";
  if (current === trimmed) return false;
  if (trimmed) node.setAttribute("aria-label", trimmed);
  else node.removeAttribute("aria-label");
  return true;
}

export function setLayerHidden(node: SVGGraphicsElement, hidden: boolean): boolean {
  const currentlyHidden = node.getAttribute("display") === "none";
  if (currentlyHidden === hidden) return false;
  if (hidden) {
    const explicitDisplay = node.getAttribute("display");
    if (explicitDisplay !== null) node.dataset.lineagePreviousDisplay = explicitDisplay;
    else delete node.dataset.lineagePreviousDisplay;
    node.setAttribute("display", "none");
  } else {
    const previousDisplay = node.dataset.lineagePreviousDisplay;
    if (previousDisplay !== undefined) node.setAttribute("display", previousDisplay);
    else node.removeAttribute("display");
    delete node.dataset.lineagePreviousDisplay;
  }
  return true;
}

export function findSelectableByKeys(
  root: SVGSVGElement,
  keys: string[],
): SVGGraphicsElement | undefined {
  for (const key of keys) {
    const candidate = Array.from(root.querySelectorAll<SVGGraphicsElement>(EDITABLE_SELECTOR))
      .find((node) => node.dataset.lineageKey === key);
    if (candidate && isSelectableNode(candidate, root)) return candidate;
  }
  return undefined;
}

interface EditorSnapshot {
  markup: string;
  primaryKeys?: string[];
  selectionPaths?: string[][];
  scopeKeys: string[];
  selectionKeys: string[];
}

function interactionPoint(event: Event): { x: number; y: number } | undefined {
  const candidate = event as Event & {
    changedTouches?: ArrayLike<{ clientX: number; clientY: number }>;
    clientX?: number;
    clientY?: number;
    touches?: ArrayLike<{ clientX: number; clientY: number }>;
  };
  const touch = candidate.touches?.[0] ?? candidate.changedTouches?.[0];
  const x = touch?.clientX ?? candidate.clientX;
  const y = touch?.clientY ?? candidate.clientY;
  return Number.isFinite(x) && Number.isFinite(y) ? { x: Number(x), y: Number(y) } : undefined;
}

interface DraggableSession {
  init: (enabled: boolean) => void;
}

interface ResizeSession {
  eventType: string;
  lastEvent: Event | null;
}

export class SvgEditor {
  readonly #artboard: HTMLElement;
  readonly #callbacks: EditorCallbacks;
  readonly #controls: EditorControls;
  readonly #history = new History();
  #drawing?: Svg;
  #baseline = "";
  #initialSnapshot = "";
  #interactiveMutation = false;
  #interactiveMoved = false;
  #interactiveSnapshot = "";
  #groupTransformGesture?: GroupTransformGesture;
  #groupTransformRejected = false;
  #groupDragOffset = { x: 0, y: 0 };
  #selectionTranslationGesture?: SelectionTranslationGesture;
  #selectionTranslationRejected = false;
  #translationRootToScreen?: MatrixCoefficients;
  #groupRotationGesture = false;
  #interactiveCleanup?: () => void;
  #interactivePluginSession?: DraggableSession | ResizeSession;
  #interactivePluginType?: "drag" | "resize";
  #interactiveStartPoint?: { x: number; y: number };
  readonly #inspectorEdit = new InspectorEditSession();
  #keyCounter = 0;
  #lockedKeys = new Set<string>();
  #selected?: SvgElement;
  #selectionDragSources: SvgElement[] = [];
  #selectedNodes: SVGGraphicsElement[] = [];
  #scope?: SVGGraphicsElement | SVGSVGElement;
  #hovered?: SVGGraphicsElement;
  #suppressCanvasClickUntil = 0;
  #syncingControls = false;
  #agentMutationBlocked = false;
  #selectionPreferences: SelectionPreferences = { ...DEFAULT_SELECTION_PREFERENCES };
  #marqueeGesture?: {
    nodes: SVGGraphicsElement[];
    primary?: SVGGraphicsElement;
    scope: SVGGraphicsElement | SVGSVGElement;
  };
  #precisePointer?: {
    candidate: SVGGraphicsElement;
    moved: boolean;
    pointerId: number;
    startX: number;
    startY: number;
  };
  #groupScaleEdit?: {
    box: TransformBox;
    initialMatrix: { a: number; b: number; c: number; d: number; e: number; f: number };
    initialPercent: number;
    originalScale: string | null;
    originalTransform: string | null;
    snapshot: string;
  };

  constructor(artboard: HTMLElement, controls: EditorControls, callbacks: EditorCallbacks) {
    this.#artboard = artboard;
    this.#controls = controls;
    const compatibleControls = controls as unknown as Record<string, HTMLElement | undefined>;
    for (const name of ["textContent", "textFamily", "textLetterSpacing", "textSize", "textWeight"]) {
      compatibleControls[name] ??= artboard.ownerDocument.createElement("input");
    }
    for (const name of ["distributeHorizontalButton", "distributeVerticalButton", "spaceHorizontalButton", "spaceVerticalButton"]) {
      compatibleControls[name] ??= artboard.ownerDocument.createElement("button");
    }
    compatibleControls.textAnchor ??= artboard.ownerDocument.createElement("select");
    compatibleControls.textError ??= artboard.ownerDocument.createElement("small");
    this.#callbacks = callbacks;
    this.#bindControls();
    document.addEventListener("keydown", (event) => this.#handleKeydown(event));
  }

  load(svg: SVGSVGElement, savedBaseline?: string): void {
    this.cancelMarquee();
    this.#cancelPrecisePointer();
    this.#cancelInteractiveMutation(false);
    this.#groupScaleEdit = undefined;
    this.#clearHover();
    this.#deselect();
    this.#drawing = SVG(svg) as Svg;
    this.#history.reset();
    this.#keyCounter = 0;
    this.#lockedKeys.clear();
    this.#selectedNodes = [];
    this.#assignKeys(svg);
    this.#scope = svg;
    this.#bindCanvasSelection(svg);
    this.#baseline = savedBaseline ?? this.serializeClean();
    this.#initialSnapshot = this.#snapshot();
    if (savedBaseline !== undefined) {
      const parsed = new DOMParser().parseFromString(savedBaseline, "image/svg+xml");
      const saved = parsed.documentElement as unknown as SVGSVGElement;
      if (saved.localName === "svg" && !parsed.querySelector("parsererror")) {
        const currentCounter = this.#keyCounter;
        this.#keyCounter = 0;
        this.#assignKeys(saved);
        this.#keyCounter = currentCounter;
        this.#initialSnapshot = JSON.stringify({
          markup: serializeSvg(saved, false),
          primaryKeys: [],
          selectionPaths: [],
          scopeKeys: [],
          selectionKeys: [],
        } satisfies EditorSnapshot);
      }
    }
    this.#setSelectionUi(undefined);
    this.#notifySelectionContext();
    this.#notifyHistory();
    if (savedBaseline !== undefined) this.#callbacks.onDirtyChange(!cleanSvgsEqualForDirtyComparison(this.serializeClean(), this.#baseline));
  }

  selectNode(node: SVGGraphicsElement, extend = false): void {
    const root = this.svgNode;
    if (!root || !node.isConnected || !isSelectableNode(node, root)) return;
    if (extend) {
      if (getSelectableParent(node, root) !== (this.#scope ?? root)) {
        this.#callbacks.onStatus("Shift-select is limited to direct siblings in the active scope");
        return;
      }
      this.#toggleNode(node);
      return;
    }
    this.#scope = getSelectableParent(node, root) ?? root;
    this.#setSelection([node], node);
  }

  editInside(): void {
    const root = this.svgNode;
    const selected = this.selectedNode;
    if (!root || this.#selectedNodes.length !== 1 || !selected || !this.#hasDirectSelectableChildren(selected, root)) return;
    this.#scope = selected;
    this.#clearHover();
    this.#notifySelectionContext();
  }

  backToGroup(): void {
    const root = this.svgNode;
    const scope = this.#scope;
    if (!root || !scope || scope === root || !isSelectableNode(scope, root)) return;
    this.#scope = getSelectableParent(scope, root) ?? root;
    this.#setSelection([scope], scope);
  }

  selectAncestor(node: SVGGraphicsElement): void {
    const root = this.svgNode;
    const selected = this.selectedNode;
    if (!root || !selected || !getSelectionAncestry(selected, root).includes(node)) return;
    this.selectNode(node);
  }

  get selectionContext(): SelectionContext {
    const root = this.svgNode;
    const selected = this.selectedNode;
    const activeScope = root && this.#scope !== root ? this.#scope as SVGGraphicsElement : undefined;
    return {
      activeScope,
      breadcrumb: root ? getSelectionAncestry(selected, root) : [],
      canDrillBack: Boolean(activeScope),
      canEditInside: Boolean(root && this.#selectedNodes.length === 1 && selected && this.#hasDirectSelectableChildren(selected, root)),
      hovered: this.#hovered,
      lockedKeys: new Set(this.#lockedKeys),
      selectedNodes: [...this.#selectedNodes],
      selected,
    };
  }

  #selectNode(node: SVGGraphicsElement): void {
    this.#setSelection([node], node);
  }

  #setSelection(nodes: SVGGraphicsElement[], primary?: SVGGraphicsElement): void {
    const root = this.svgNode;
    if (!this.#drawing || !root) return;
    const unique = Array.from(new Set(nodes)).filter((node) => node.isConnected && isSelectableNode(node, root));
    const nextPrimary = primary && unique.includes(primary) ? primary : unique.at(-1);
    this.#clearHover();
    this.#deselect();
    this.#selectedNodes = unique;
    if (!nextPrimary) {
      this.#setSelectionUi(undefined);
      this.#callbacks.onSelectionChange(undefined);
      this.#notifySelectionContext();
      return;
    }
    const node = nextPrimary;
    const selected = SVG(nextPrimary) as SvgElement;
    this.#selected = selected;

    const hasComplexResources = node.localName !== "g" && (
      Boolean(node.querySelector(RESOURCE_SELECTOR))
      || Array.from(node.attributes).some((attribute) => attribute.value.includes("url(#"))
    );
    const canInstallHandles = !this.#agentMutationBlocked
      && node.getAttribute("display") !== "none"
      && !this.#isLocked(node)
      && !hasComplexResources;
    const canInstallCollectiveDrag = this.#selectedNodes.length > 1
      && translationAvailability(
        this.#selectedNodes,
        root,
        (candidate) => this.#isLocked(candidate),
        this.#agentMutationBlocked,
      ).allowed;
    if (!canInstallHandles) node.setAttribute(PRIMARY_FALLBACK_ATTRIBUTE, "true");
    this.#renderSelectionHalos();
    if (canInstallHandles) {
      selected
        .select()
        .resize({ preserveAspectRatio: true, aroundCenter: false, grid: 1, degree: 1 });
      enhanceRotationHandle(root);
      selected.on("beforeresize.lineage", (event) => {
        const detail = (event as CustomEvent<{
          event: CustomEvent<{ event: Event }>;
          handler: ResizeSession;
        }>).detail;
        this.#beginInteractiveMutation(
          detail.event.type === "rot" ? "rotation" : "resize",
          detail.event.detail.event,
          detail.handler,
        );
      });
      selected.on("resize.lineage", (event) => {
        if (this.#agentMutationBlocked) {
          event.preventDefault();
          return;
        }
        const detail = (event as CustomEvent<{ angle: number; box: TransformBox; event: Event; eventType: string }>).detail;
        const terminalPoint = interactionPoint(detail.event);
        const releasedAtStart = Boolean(terminalPoint && this.#interactiveStartPoint
          && Math.abs(terminalPoint.x - this.#interactiveStartPoint.x) <= 1
          && Math.abs(terminalPoint.y - this.#interactiveStartPoint.y) <= 1);
        const terminalWithoutMotion = (detail.event.type === "mouseup" || detail.event.type === "touchend")
          && (!this.#interactiveMoved || releasedAtStart);
        if (detail.event.type === "touchcancel" || terminalWithoutMotion) {
          event.preventDefault();
          this.#cancelInteractiveMutation();
          return;
        } else if (detail.eventType === "rot") {
          this.#markInteractiveMoved(true);
          const degrees = normalizeRotationDegrees(matrixRotationDegrees(selected.matrixify()) + detail.angle);
          node.dataset.lineageRotation = String(degrees);
          this.#callbacks.onStatus(`Rotation ${degrees}°`);
        } else if (this.#groupTransformGesture) {
          event.preventDefault();
          try {
            this.#markInteractiveMoved(this.#groupTransformGesture.resize(detail.box));
          } catch (error) {
            this.#rejectGroupTransform(error);
          }
        } else if (this.#groupTransformRejected) {
          event.preventDefault();
        } else {
          this.#markInteractiveMoved(true);
        }
        this.#syncSelectionUi();
      });
    }
    const dragNodes = canInstallCollectiveDrag
      ? this.#selectedNodes
      : canInstallHandles
        ? [node]
        : [];
    dragNodes.forEach((candidate) => this.#bindSelectionDragSource(candidate));

    this.#setSelectionUi(node);
    this.#callbacks.onSelectionChange(node);
    this.#notifySelectionContext();
  }

  #bindSelectionDragSource(node: SVGGraphicsElement): void {
    const source = SVG(node) as SvgElement;
    source.draggable();
    this.#selectionDragSources.push(source);
    source.on("dragstart.lineage", (event) => {
      const detail = (event as CustomEvent<{ event: Event; handler: DraggableSession }>).detail;
      this.#beginInteractiveMutation("drag", detail.event, detail.handler);
    });
    source.on("dragmove.lineage", (event) => {
      if (this.#agentMutationBlocked) {
        event.preventDefault();
        return;
      }
      if (this.#selectionTranslationGesture) {
        event.preventDefault();
        const detail = (event as CustomEvent<{ event: Event }>).detail;
        const point = interactionPoint(detail.event);
        const start = this.#interactiveStartPoint;
        const rootToScreen = this.#translationRootToScreen;
        if (!point || !start || !rootToScreen) {
          this.#rejectSelectionTranslation(new RangeError("The collective drag pointer could not be resolved."));
        } else {
          try {
            const screenDx = point.x - start.x;
            const screenDy = point.y - start.y;
            const crossedThreshold = Math.hypot(screenDx, screenDy) >= 3;
            const rootDelta = crossedThreshold
              ? transformVectorToLocal(rootToScreen, screenDx, screenDy)
              : { dx: 0, dy: 0 };
            this.#markInteractiveMoved(this.#selectionTranslationGesture.move(rootDelta.dx, rootDelta.dy));
          } catch (error) {
            this.#rejectSelectionTranslation(error);
          }
        }
      } else if (this.#selectionTranslationRejected) {
        event.preventDefault();
      } else if (this.#groupTransformGesture) {
        event.preventDefault();
        const detail = (event as CustomEvent<{ dx: number; dy: number }>).detail;
        this.#groupDragOffset.x += detail.dx;
        this.#groupDragOffset.y += detail.dy;
        try {
          this.#markInteractiveMoved(this.#groupTransformGesture.drag(this.#groupDragOffset.x, this.#groupDragOffset.y));
        } catch (error) {
          this.#rejectGroupTransform(error);
        }
      } else if (this.#groupTransformRejected) {
        event.preventDefault();
      } else {
        this.#markInteractiveMoved(true);
      }
      this.#syncSelectionUi();
    });
    source.on("dragend.lineage", () => {
      this.#finishInteractiveMutation();
      if (this.#agentMutationBlocked) queueMicrotask(() => source.draggable(false));
    });
  }

  #toggleNode(node: SVGGraphicsElement): void {
    if (this.#selectedNodes.includes(node)) {
      const remaining = this.#selectedNodes.filter((candidate) => candidate !== node);
      const primary = node === this.selectedNode ? remaining.at(-1) : this.selectedNode;
      this.#setSelection(remaining, primary);
    } else {
      this.#setSelection([...this.#selectedNodes, node], node);
    }
  }

  undo(): boolean {
    if (this.#agentMutationBlocked) return false;
    const previous = this.#history.undo(this.#snapshot());
    if (previous === undefined) return false;
    this.#restore(previous);
    this.#callbacks.onStatus("Undid the last correction");
    return true;
  }

  redo(): boolean {
    if (this.#agentMutationBlocked) return false;
    const next = this.#history.redo(this.#snapshot());
    if (next === undefined) return false;
    this.#restore(next);
    this.#callbacks.onStatus("Redid the correction");
    return true;
  }

  reset(): void {
    if (!this.#drawing || this.#agentMutationBlocked) return;
    this.#lockedKeys.clear();
    if (cleanSvgsEqualForDirtyComparison(this.serializeClean(), this.#baseline)) {
      this.#scope = this.svgNode;
      this.#setSelection([]);
      this.#callbacks.onStatus("Cleared the editing context");
      return;
    }
    this.#history.reset();
    this.#restore(this.#initialSnapshot);
    this.#baseline = this.serializeClean();
    this.#callbacks.onDirtyChange(false);
    this.#callbacks.onStatus("Reset to the originally loaded SVG");
  }

  serializeClean(): string {
    return serializeSvg(this.svgNode, true);
  }

  get svgNode(): SVGSVGElement | undefined {
    return this.#drawing?.node as SVGSVGElement | undefined;
  }

  get selectedNode(): SVGGraphicsElement | undefined {
    return this.#selected?.node as SVGGraphicsElement | undefined;
  }

  get selectedNodes(): SVGGraphicsElement[] {
    return [...this.#selectedNodes];
  }

  get marqueeActive(): boolean {
    return Boolean(this.#marqueeGesture);
  }

  setSelectionPreferences(preferences: SelectionPreferences): void {
    this.#selectionPreferences = { ...preferences };
    if (this.#drawing) this.#setSelection([...this.#selectedNodes], this.selectedNode);
  }

  canStartMarquee(target: EventTarget | null): boolean {
    const root = this.svgNode;
    if (!root || this.#agentMutationBlocked || !(target instanceof Element)) return false;
    if (target.closest(HANDLE_SELECTOR)) return false;
    return !getDirectSelectionTarget(target, root);
  }

  canStartRegionSelection(target: EventTarget | null): boolean {
    const root = this.svgNode;
    if (!root || this.#agentMutationBlocked || !(target instanceof Element) || !this.#artboard.contains(target)) return false;
    return !target.closest(".svg_select_handle, .svg_select_handle_rot");
  }

  exactRegionCandidate(target: EventTarget | null): SVGGraphicsElement | undefined {
    const root = this.svgNode;
    if (!root || !(target instanceof Element)) return undefined;
    return target.closest(SELECTION_BOUNDING_SHAPE_SELECTOR)
      ? this.selectedNode
      : getDirectSelectionTarget(target, root);
  }

  beginMarquee(): boolean {
    const root = this.svgNode;
    if (!root || this.#agentMutationBlocked || this.#marqueeGesture) return false;
    this.#marqueeGesture = {
      nodes: [...this.#selectedNodes],
      primary: this.selectedNode,
      scope: this.#scope ?? root,
    };
    this.#clearHover();
    this.#notifySelectionContext();
    return true;
  }

  completeBackgroundGesture(inert: boolean, additive = false): void {
    this.#armCanvasClickSuppression();
    if (!inert && !additive) this.#setSelection([]);
  }

  completeControlGesture(candidate: SVGGraphicsElement | undefined, additive: boolean): void {
    const root = this.svgNode;
    this.cancelMarquee();
    this.#armCanvasClickSuppression();
    if (candidate && root && candidate.isConnected) this.#toggleExactNode(candidate, root);
    else if (!additive) this.#setSelection([]);
  }

  suppressCanvasClick(): void {
    this.cancelMarquee();
    this.#armCanvasClickSuppression();
  }

  commitMarquee(rect: ClientRect | undefined, additive: boolean, rule: MarqueeHitRule = this.#selectionPreferences.marqueeMode): void {
    const gesture = this.#marqueeGesture;
    const root = this.svgNode;
    if (!gesture || !root) return;
    this.#marqueeGesture = undefined;
    this.#suppressCanvasClickUntil = performance.now() + 250;
    if (!rect) {
      if (!additive) this.#setSelection([]);
      this.#announceMarqueeEnd();
      return;
    }
    const visible = Array.from(gesture.scope.querySelectorAll<SVGGraphicsElement>(EDITABLE_SELECTOR))
      .filter((node) => isSelectableNode(node, root))
      .map((node) => ({ node, rect: renderedClientRect(node, gesture.scope) }))
      .filter((candidate): candidate is { node: SVGGraphicsElement; rect: DOMRect } => Boolean(candidate.rect));
    const leafCandidates = visible.filter(({ node }) => !visible.some(({ node: descendant }) => node !== descendant && node.contains(descendant)));
    const matches = leafCandidates
      .filter((candidate) => marqueeMatches(rect, candidate.rect, rule))
      .map((candidate) => candidate.node);
    if (additive) {
      if (matches.length > 0) {
        const normalized = this.#normalizeMarqueeUnion([...gesture.nodes, ...matches], gesture.scope, root);
        this.#setSelection(normalized, matches.at(-1));
      }
    } else {
      this.#setSelection(matches, matches.at(-1));
    }
    this.#callbacks.onStatus(matches.length === 1 ? "Selected 1 layer" : `Selected ${matches.length} layers`);
    this.#announceMarqueeEnd();
  }

  cancelMarquee(): boolean {
    const gesture = this.#marqueeGesture;
    if (!gesture) return false;
    this.#marqueeGesture = undefined;
    this.#armCanvasClickSuppression();
    this.#scope = gesture.scope;
    this.#setSelection(gesture.nodes, gesture.primary);
    this.#announceMarqueeEnd();
    return true;
  }

  #normalizeMarqueeUnion(
    nodes: SVGGraphicsElement[],
    scope: SVGGraphicsElement | SVGSVGElement,
    root: SVGSVGElement,
  ): SVGGraphicsElement[] {
    const selected = new Set(nodes.filter((node) => node.isConnected && isSelectableNode(node, root) && scope.contains(node)));
    const ordered = Array.from(scope.querySelectorAll<SVGGraphicsElement>(EDITABLE_SELECTOR))
      .filter((node) => selected.has(node));
    return ordered.filter((node) => !ordered.some((descendant) => node !== descendant && node.contains(descendant)));
  }

  refreshSelectionAffordances(): void {
    const root = this.svgNode;
    if (root && this.#selected) enhanceRotationHandle(root);
  }

  stageAgentTransaction(transaction: AgentTransactionV1, context: AgentDocumentContext): StagedAgentTransaction | undefined {
    const root = this.svgNode;
    if (!root) return undefined;
    if (this.#interactiveMutation || this.#groupScaleEdit) {
      return {
        result: {
          transactionId: transaction.transactionId,
          status: "rejected",
          error: { code: "pending_transaction", message: "Finish the active canvas gesture before staging an agent transaction." },
        },
      };
    }
    return evaluateAgentTransaction(root, transaction, context, this.#lockedKeys);
  }

  setAgentMutationBlocked(blocked: boolean): void {
    if (this.#agentMutationBlocked === blocked) return;
    if (blocked) {
      this.cancelMarquee();
      this.#cancelPrecisePointer();
      this.#cancelInteractiveMutation();
      const scaleSnapshot = this.#groupScaleEdit?.snapshot;
      this.#groupScaleEdit = undefined;
      if (scaleSnapshot) this.#restore(scaleSnapshot);
    }
    this.#agentMutationBlocked = blocked;
    this.#setSelection([...this.#selectedNodes], this.selectedNode);
    const availability = visibleHistoryAvailability(blocked, this.#history.canUndo, this.#history.canRedo);
    this.#callbacks.onHistoryChange(availability.canUndo, availability.canRedo);
  }

  applyAgentSelection(selection?: AgentSelectionIntent): void {
    const root = this.svgNode;
    if (!root || !selection) return;
    const nodes = selection.targetSessionKeys
      .map((key) => findSelectableByKeys(root, [key]))
      .filter((node): node is SVGGraphicsElement => Boolean(node));
    const primary = selection.primarySessionKey ? findSelectableByKeys(root, [selection.primarySessionKey]) : nodes.at(-1);
    this.#scope = selection.scopeSessionKey ? findSelectableByKeys(root, [selection.scopeSessionKey]) ?? root : root;
    this.#setSelection(nodes, primary);
  }

  beginAgentAcceptance(candidate: SVGSVGElement, selection?: AgentSelectionIntent): string {
    const before = this.#snapshot();
    const previous = JSON.parse(before) as EditorSnapshot;
    const accepted: EditorSnapshot = {
      ...previous,
      markup: serializeSvg(candidate, false),
      ...(selection ? {
        primaryKeys: selection.primarySessionKey ? [selection.primarySessionKey] : [],
        selectionKeys: selection.primarySessionKey ? [selection.primarySessionKey] : [],
        selectionPaths: selection.targetSessionKeys.map((key) => [key]),
        scopeKeys: selection.scopeSessionKey ? [selection.scopeSessionKey] : [],
      } : {}),
    };
    this.#restore(JSON.stringify(accepted));
    return before;
  }

  finalizeAgentAcceptance(checkpoint: unknown): void {
    if (typeof checkpoint !== "string") throw new Error("Agent acceptance checkpoint is invalid.");
    this.#history.checkpoint(checkpoint);
    this.#notifyHistory();
  }

  rollbackAgentAcceptance(checkpoint: unknown): void {
    if (typeof checkpoint !== "string") throw new Error("Agent acceptance checkpoint is invalid.");
    this.#restore(checkpoint);
  }

  setAgentReviewHighlights(keys: ReadonlySet<string>): void {
    const root = this.svgNode;
    if (!root) return;
    for (const node of Array.from(root.querySelectorAll<SVGGraphicsElement>(EDITABLE_SELECTOR))) {
      if (node.dataset.lineageKey && keys.has(node.dataset.lineageKey)) node.setAttribute(REVIEW_ATTRIBUTE, "true");
      else node.removeAttribute(REVIEW_ATTRIBUTE);
    }
  }

  focusAgentLayer(sessionKey: string): boolean {
    const root = this.svgNode;
    const node = root ? findSelectableByKeys(root, [sessionKey]) : undefined;
    if (!node) return false;
    this.selectNode(node);
    return true;
  }

  renameSelection(name: string): void {
    const node = this.#singleMutableSelection("rename");
    const trimmed = name.trim();
    if (!node || (node.getAttribute("aria-label") ?? "") === trimmed) return;
    this.#mutate(() => {
      renameLayer(node, trimmed);
      this.#setSelectionUi(node);
      this.#notifySelectionContext();
    });
    this.#callbacks.onStatus(trimmed ? `Renamed layer to ${trimmed}` : "Removed the custom layer name");
  }

  toggleLock(): void {
    if (this.#agentMutationBlocked) return;
    const node = this.selectedNode;
    const key = node?.dataset.lineageKey;
    if (!node || !key || this.#selectedNodes.length !== 1) return;
    if (!this.#lockedKeys.has(key) && this.#isLocked(node)) {
      this.#callbacks.onStatus("Select the locked ancestor in Layers to unlock this layer");
      return;
    }
    if (this.#lockedKeys.has(key)) {
      this.#lockedKeys.delete(key);
      this.#callbacks.onStatus(`Unlocked ${this.#label(node)}`);
    } else {
      this.#lockedKeys.add(key);
      this.#callbacks.onStatus(`Locked ${this.#label(node)} for this editing session`);
    }
    this.#setSelection([...this.#selectedNodes], node);
  }

  toggleVisibility(node = this.selectedNode): void {
    const root = this.svgNode;
    if (!root || !node || !node.isConnected || !isSelectableNode(node, root)) return;
    if (this.#isLocked(node)) {
      this.#callbacks.onStatus(`Unlock ${this.#label(node)} before changing its visibility`);
      return;
    }
    const hidden = node.getAttribute("display") === "none";
    this.#mutate(() => {
      setLayerHidden(node, !hidden);
      if (node === this.selectedNode) {
        this.#setSelection([...this.#selectedNodes], node);
      }
    });
    this.#callbacks.onStatus(`${hidden ? "Showed" : "Hid"} ${this.#label(node)}`);
  }

  reorder(direction: HierarchyDirection): void {
    const root = this.svgNode;
    if (!root) return;
    const availability = reorderAvailability(this.#selectedNodes, root, direction, (node) => this.#isLocked(node));
    if (!availability.allowed) {
      this.#callbacks.onStatus(availability.reason);
      return;
    }
    const selected = [...this.#selectedNodes];
    const primary = this.selectedNode;
    this.#mutate(() => {
      reorderSelection(selected, root, direction);
      this.#setSelection(selected, primary);
    });
    this.#callbacks.onStatus(`Moved selection one layer ${direction} in paint order`);
  }

  group(): void {
    const root = this.svgNode;
    if (!root) return;
    const availability = groupAvailability(this.#selectedNodes, root, (node) => this.#isLocked(node));
    if (!availability.allowed) {
      this.#callbacks.onStatus(availability.reason);
      return;
    }
    const parent = this.#selectedNodes[0].parentNode as SVGGraphicsElement | SVGSVGElement | null;
    this.#mutate(() => {
      this.#deselect();
      const group = groupSelection(this.#selectedNodes, root);
      if (!group) return;
      this.#assignKeys(root);
      this.#scope = parent === root ? root : parent ?? root;
      this.#setSelection([group], group);
    });
    this.#callbacks.onStatus("Grouped the selected layers in a neutral SVG group");
  }

  ungroup(): void {
    const root = this.svgNode;
    const node = this.selectedNode;
    if (!root) return;
    const availability = ungroupAvailability(node, root, (candidate) => this.#isLocked(candidate));
    if (!availability.allowed || !node) {
      this.#callbacks.onStatus(availability.reason);
      return;
    }
    const parent = node.parentNode as SVGGraphicsElement | SVGSVGElement | null;
    const removedName = node.getAttribute("aria-label")?.trim();
    this.#mutate(() => {
      this.#deselect();
      const children = ungroupSelection(node);
      this.#scope = parent === root ? root : parent ?? root;
      this.#setSelection(children, children.at(-1));
    });
    this.#callbacks.onStatus(removedName
      ? `Ungrouped ${removedName}, removed its group name, and preserved child order`
      : "Ungrouped the neutral wrapper and preserved child order");
  }

  operationState(): {
    align: OperationAvailability;
    distribute: OperationAvailability;
    group: OperationAvailability;
    reorderEarlier: OperationAvailability;
    reorderLater: OperationAvailability;
    ungroup: OperationAvailability;
  } {
    const root = this.svgNode;
    const unavailable = { allowed: false, reason: "Open an SVG to organize layers." };
    if (!root) return { align: unavailable, distribute: unavailable, group: unavailable, reorderEarlier: unavailable, reorderLater: unavailable, ungroup: unavailable };
    const locked = (node: SVGGraphicsElement) => this.#isLocked(node);
    return {
      align: alignmentAvailability(this.#selectedNodes, root, locked),
      distribute: distributionAvailability(this.#selectedNodes, root, locked, this.#agentMutationBlocked),
      group: groupAvailability(this.#selectedNodes, root, locked),
      reorderEarlier: reorderAvailability(this.#selectedNodes, root, "earlier", locked),
      reorderLater: reorderAvailability(this.#selectedNodes, root, "later", locked),
      ungroup: ungroupAvailability(this.#selectedNodes.length === 1 ? this.selectedNode : undefined, root, locked),
    };
  }

  align(direction: AlignmentDirection): void {
    const root = this.svgNode;
    if (!root) return;
    const availability = alignmentAvailability(this.#selectedNodes, root, (node) => this.#isLocked(node));
    if (!availability.allowed) {
      this.#callbacks.onStatus(availability.reason);
      return;
    }
    const boxes = this.#selectedNodes.map((node) => {
      const element = SVG(node) as SvgElement;
      return element.bbox().transform(element.matrixify());
    });
    const offsets = alignmentOffsets(boxes, direction);
    if (!offsets.some(({ dx, dy }) => Math.abs(dx) >= 1e-9 || Math.abs(dy) >= 1e-9)) {
      this.#callbacks.onStatus(`Selection is already aligned ${direction}`);
      return;
    }
    const selected = [...this.#selectedNodes];
    const primary = this.selectedNode;
    this.#mutate(() => {
      applyAlignmentOffsets(selected, offsets);
      this.#setSelection(selected, primary);
    });
    this.#callbacks.onStatus(`Aligned ${selected.length} layers ${direction}`);
  }

  distribute(direction: DistributionDirection): void {
    const root = this.svgNode;
    if (!root) return;
    const availability = distributionAvailability(
      this.#selectedNodes,
      root,
      (node) => this.#isLocked(node),
      this.#agentMutationBlocked,
    );
    if (!availability.allowed) {
      this.#callbacks.onStatus(availability.reason);
      return;
    }
    let boxes: AlignmentBox[];
    try {
      boxes = this.#selectedNodes.map((node) => rootBox(node, root));
    } catch (error) {
      this.#callbacks.onStatus(error instanceof Error ? error.message : "The selected visual bounds are unavailable.");
      return;
    }
    const offsets = distributionOffsets(boxes, direction);
    if (!offsets.some(({ dx, dy }) => Math.abs(dx) >= 1e-9 || Math.abs(dy) >= 1e-9)) {
      this.#callbacks.onStatus(direction.endsWith("gaps") ? "The selected edge gaps are already equal" : "The selected centers are already distributed");
      return;
    }
    const selected = [...this.#selectedNodes];
    const primary = this.selectedNode;
    const before = this.#snapshot();
    const gestures: SelectionTranslationGesture[] = [];
    try {
      const targets = translationTargets(selected, root);
      offsets.forEach((offset, index) => {
        if (Math.abs(offset.dx) < 1e-9 && Math.abs(offset.dy) < 1e-9) return;
        const gesture = new SelectionTranslationGesture([targets[index]]);
        gestures.push(gesture);
        gesture.move(offset.dx, offset.dy);
      });
      const changed = gestures.map((gesture) => gesture.complete()).some(Boolean);
      if (!changed) {
        this.#callbacks.onStatus(direction.endsWith("gaps") ? "The selected edge gaps are already equal" : "The selected centers are already distributed");
        return;
      }
      this.#setSelection(selected, primary);
      this.#history.checkpoint(before);
      this.#notifyDocumentChange();
      this.#notifyHistory();
      const label = direction === "horizontal-centers"
        ? "Distributed horizontal centers"
        : direction === "vertical-centers"
          ? "Distributed vertical centers"
          : direction === "horizontal-gaps"
            ? "Equalized horizontal edge gaps"
            : "Equalized vertical edge gaps";
      this.#callbacks.onStatus(`${label} across ${selected.length} layers`);
    } catch (error) {
      gestures.forEach((gesture) => gesture.cancel());
      this.#callbacks.onStatus(error instanceof Error ? error.message : "The selected layers could not be distributed.");
    }
  }

  #assignKeys(root: SVGSVGElement): void {
    const nodes = Array.from(root.querySelectorAll<SVGGraphicsElement>(EDITABLE_SELECTOR))
      .filter((node) => isSelectableNode(node, root));
    const usedKeys = new Set(nodes.map((node) => node.dataset.lineageKey).filter(Boolean));
    for (const node of nodes) {
      if (!isSelectableNode(node, root)) continue;
      if (!node.dataset.lineageKey) {
        let key: string;
        do {
          this.#keyCounter += 1;
          key = `element-${this.#keyCounter}`;
        } while (usedKeys.has(key));
        node.dataset.lineageKey = key;
        usedKeys.add(key);
      }
    }
  }

  #bindCanvasSelection(svg: SVGSVGElement): void {
    svg.addEventListener("pointerdown", (event) => {
      if (!this.#isExactTogglePointer(event)) return;
      const target = event.target;
      const candidate = target instanceof Element && target.closest(SELECTION_BOUNDING_SHAPE_SELECTOR)
        ? this.selectedNode
        : target instanceof Element ? getDirectSelectionTarget(target, svg) : undefined;
      if (!candidate) return;
      this.#precisePointer = {
        candidate,
        moved: false,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      };
      svg.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    svg.addEventListener("pointermove", (event) => {
      const precise = this.#precisePointer;
      if (!precise || precise.pointerId !== event.pointerId) return;
      if (Math.hypot(event.clientX - precise.startX, event.clientY - precise.startY) >= 4) precise.moved = true;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    svg.addEventListener("pointerup", (event) => {
      const precise = this.#precisePointer;
      if (!precise || precise.pointerId !== event.pointerId) return;
      this.#precisePointer = undefined;
      if (!precise.moved) this.#toggleExactNode(precise.candidate, svg);
      this.#suppressCanvasClickUntil = performance.now() + 250;
      if (svg.hasPointerCapture?.(event.pointerId)) svg.releasePointerCapture(event.pointerId);
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    const cancelPrecise = (event: PointerEvent) => {
      if (this.#precisePointer?.pointerId !== event.pointerId) return;
      this.#cancelPrecisePointer();
      event.stopImmediatePropagation();
    };
    svg.addEventListener("pointercancel", cancelPrecise, true);
    svg.addEventListener("lostpointercapture", cancelPrecise, true);
    svg.addEventListener("pointermove", (event) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest(HANDLE_SELECTOR)) {
        this.#setHover(undefined);
        return;
      }
      this.#setHover(this.#selectionPreferences.clickDepth === "exact"
        ? getDirectSelectionTarget(target, svg)
        : getScopedSelectionTarget(target, this.#scope ?? svg, svg));
    });
    svg.addEventListener("pointerleave", () => this.#setHover(undefined));
    svg.addEventListener("click", (event) => {
      if (performance.now() < this.#suppressCanvasClickUntil) return;
      const target = event.target;
      if (!(target instanceof Element) || target.closest(HANDLE_SELECTOR)) return;
      const exactToggle = this.#isExactToggleClick(event);
      if ((event.metaKey || event.ctrlKey) && !exactToggle) return;
      const directDefault = this.#selectionPreferences.clickDepth === "exact" && !event.shiftKey;
      const candidate = event.altKey || exactToggle || directDefault
        ? getDirectSelectionTarget(target, svg)
        : getScopedSelectionTarget(target, this.#scope ?? svg, svg);
      if (exactToggle && !candidate) return;
      if (candidate) {
        if (exactToggle) {
          this.#toggleExactNode(candidate, svg);
        } else if (event.altKey) {
          this.#scope = getSelectableParent(candidate, svg) ?? svg;
          this.#setSelection([candidate], candidate);
        } else if (event.shiftKey) {
          this.#toggleNode(candidate);
        } else if (directDefault) {
          this.#scope = getSelectableParent(candidate, svg) ?? svg;
          this.#setSelection([candidate], candidate);
        } else {
          this.#setSelection([candidate], candidate);
        }
      }
      else {
        this.#setSelection([]);
      }
      event.stopPropagation();
    });
    svg.addEventListener("dblclick", (event) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest(HANDLE_SELECTOR)) return;
      const candidate = getDirectSelectionTarget(target, svg);
      if (!candidate) return;
      this.#scope = getSelectableParent(candidate, svg) ?? svg;
      this.#setSelection([candidate], candidate);
      event.stopPropagation();
    });
  }

  #bindControls(): void {
    const textControls: Array<[HTMLInputElement | HTMLSelectElement, SvgTextProperty]> = [
      [this.#controls.textContent, "content"],
      [this.#controls.textSize, "font-size"],
      [this.#controls.textWeight, "font-weight"],
      [this.#controls.textFamily, "font-family"],
      [this.#controls.textAnchor, "text-anchor"],
      [this.#controls.textLetterSpacing, "letter-spacing"],
    ];
    const commitText = (control: HTMLInputElement | HTMLSelectElement, property: SvgTextProperty) => {
      if (this.#syncingControls || !this.#canMutatePrimary()) return;
      const node = this.selectedNode;
      if (!node || node.localName !== "text") return;
      const before = this.#snapshot();
      const result = applySvgTextEdit(node as SVGTextElement, { property, value: control.value });
      if (result.error) {
        control.setAttribute("aria-invalid", "true");
        this.#controls.textError.textContent = result.error;
        return;
      }
      control.removeAttribute("aria-invalid");
      this.#controls.textError.textContent = "";
      if (!result.changed) return;
      this.#history.checkpoint(before);
      this.#syncSelectionUi();
      this.#notifyDocumentChange();
      this.#notifyHistory();
      this.#callbacks.onStatus(`Updated ${property === "content" ? "text content" : property}`);
    };
    for (const [control, property] of textControls) {
      control.addEventListener("change", () => commitText(control, property));
      control.addEventListener("keydown", (rawEvent) => {
        const event = rawEvent as KeyboardEvent;
        if (event.key === "Enter" && control instanceof HTMLInputElement) {
          event.preventDefault();
          commitText(control, property);
          control.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          this.#syncSelectionUi();
          control.blur();
          this.#callbacks.onStatus("Canceled the text edit");
        }
      });
    }

    const paintControls: Array<[
      HTMLInputElement,
      HTMLInputElement,
      HTMLElement,
      SvgPaintProperty,
    ]> = [
      [this.#controls.fill, this.#controls.fillPicker, this.#controls.fillError, "fill"],
      [this.#controls.stroke, this.#controls.strokePicker, this.#controls.strokeError, "stroke"],
    ];
    for (const [control, picker, error, attribute] of paintControls) {
      const state = attribute === "fill" ? this.#controls.fillState : this.#controls.strokeState;
      for (const input of [control, picker]) {
        input.addEventListener("focus", () => this.#beginInspectorEdit());
      }
      const apply = (value: string) => {
        if (this.#syncingControls || !this.#canMutatePrimary() || !this.#selected) return;
        if (!isValidSvgPaint(value, attribute)) {
          control.setAttribute("aria-invalid", "true");
          error.textContent = "Enter a valid SVG paint, such as none, #663399, currentColor, or url(#paint).";
          return;
        }
        control.removeAttribute("aria-invalid");
        error.textContent = "";
        const next = value.trim() || null;
        const node = this.#selected.node as SVGGraphicsElement;
        const current = node.getAttribute(attribute);
        if (current === next) return;
        this.#checkpointInspectorMutation(current ?? "", next ?? "");
        this.#selected.attr(attribute, next);
        const pickerValue = paintPickerValue(value);
        picker.disabled = !pickerValue;
        if (pickerValue) picker.value = pickerValue;
        state.textContent = svgPaintState(next);
        this.#notifyDocumentChange();
      };
      control.addEventListener("input", () => apply(control.value));
      picker.addEventListener("input", () => {
        control.value = picker.value;
        apply(picker.value);
      });
      control.addEventListener("change", () => {
        if (control.getAttribute("aria-invalid") !== "true") this.#syncSelectionUi();
      });
    }

    const attributeControls: Array<[HTMLInputElement, string]> = [
      [this.#controls.strokeWidth, "stroke-width"],
      [this.#controls.opacity, "opacity"],
    ];
    for (const [control, attribute] of attributeControls) {
      control.addEventListener("focus", () => this.#beginInspectorEdit());
      control.addEventListener("input", () => {
        if (this.#syncingControls || !this.#canMutatePrimary() || !this.#selected) return;
        const next = control.value.trim() || null;
        const current = this.#selected.attr(attribute);
        if ((current == null ? null : String(current)) === next) return;
        this.#checkpointInspectorMutation(current == null ? "" : String(current), next ?? "");
        this.#selected.attr(attribute, next);
        this.#notifyDocumentChange();
      });
      control.addEventListener("change", () => this.#syncSelectionUi());
    }

    const transformControls: Array<[HTMLInputElement, () => void]> = [
      [this.#controls.positionX, () => this.#moveSelection("x")],
      [this.#controls.positionY, () => this.#moveSelection("y")],
      [this.#controls.rotation, () => this.#rotateSelection()],
    ];
    for (const [control, apply] of transformControls) {
      control.addEventListener("focus", () => this.#beginInspectorEdit());
      control.addEventListener("input", () => {
        if (this.#syncingControls || !this.#canMutatePrimary()) return;
        const before = this.#snapshot();
        apply();
        this.#checkpointInspectorMutation(before, this.#snapshot());
      });
      control.addEventListener("change", () => this.#syncSelectionUi());
    }
    this.#controls.scale.addEventListener("focus", () => {
      if (!this.#canMutatePrimary() || this.selectedNode?.localName !== "g" || !this.#selected) {
        this.#beginInspectorEdit();
        return;
      }
      const node = this.selectedNode;
      const initialPercent = Number(node.dataset.lineageScale ?? 100);
      if (!Number.isFinite(initialPercent) || initialPercent <= 0) return;
      try {
        this.#groupScaleEdit = {
          box: this.#selected.bbox(),
          initialMatrix: this.#selected.matrixify(),
          initialPercent,
          originalScale: node.getAttribute("data-lineage-scale"),
          originalTransform: node.getAttribute("transform"),
          snapshot: this.#snapshot(),
        };
      } catch (error) {
        this.#callbacks.onStatus(error instanceof Error ? error.message : "The grouped scale was rejected.");
      }
    });
    this.#controls.scale.addEventListener("input", () => {
      if (this.#syncingControls || !this.#canMutatePrimary()) return;
      if (this.#groupScaleEdit && this.selectedNode?.localName === "g") {
        this.#scaleGroupSelection();
        return;
      }
      const before = this.#snapshot();
      this.#scaleSelection();
      this.#checkpointInspectorMutation(before, this.#snapshot());
    });
    this.#controls.scale.addEventListener("change", () => {
      if (this.#groupScaleEdit) this.#completeGroupScaleEdit();
      this.#syncSelectionUi();
    });
    this.#controls.scale.addEventListener("blur", () => {
      if (this.#groupScaleEdit) this.#completeGroupScaleEdit();
    });
    this.#controls.scale.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !this.#groupScaleEdit) return;
      event.preventDefault();
      const snapshot = this.#groupScaleEdit.snapshot;
      this.#groupScaleEdit = undefined;
      this.#restore(snapshot);
      this.#controls.scale.blur();
      this.#callbacks.onStatus("Canceled the grouped scale edit");
    });
    this.#controls.duplicateButton.addEventListener("click", () => this.#duplicateSelection());
    this.#controls.deleteButton.addEventListener("click", () => this.#deleteSelection());
    this.#controls.hideButton.addEventListener("click", () => this.toggleVisibility());
    this.#controls.name.addEventListener("change", () => this.renameSelection(this.#controls.name.value));
    this.#controls.name.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.renameSelection(this.#controls.name.value);
        this.#controls.name.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.#controls.name.value = this.selectedNode?.getAttribute("aria-label") ?? "";
        this.#controls.name.blur();
        this.#callbacks.onStatus("Canceled the layer-name edit");
      }
    });
    this.#controls.nameClearButton.addEventListener("click", () => this.renameSelection(""));
    this.#controls.lockButton.addEventListener("click", () => this.toggleLock());
    this.#controls.reorderEarlierButton.addEventListener("click", () => this.reorder("earlier"));
    this.#controls.reorderLaterButton.addEventListener("click", () => this.reorder("later"));
    this.#controls.groupButton.addEventListener("click", () => this.group());
    this.#controls.ungroupButton.addEventListener("click", () => this.ungroup());
    this.#controls.alignLeftButton.addEventListener("click", () => this.align("left"));
    this.#controls.alignCenterButton.addEventListener("click", () => this.align("center"));
    this.#controls.alignRightButton.addEventListener("click", () => this.align("right"));
    this.#controls.alignTopButton.addEventListener("click", () => this.align("top"));
    this.#controls.alignMiddleButton.addEventListener("click", () => this.align("middle"));
    this.#controls.alignBottomButton.addEventListener("click", () => this.align("bottom"));
    this.#controls.distributeHorizontalButton.addEventListener("click", () => this.distribute("horizontal-centers"));
    this.#controls.distributeVerticalButton.addEventListener("click", () => this.distribute("vertical-centers"));
    this.#controls.spaceHorizontalButton.addEventListener("click", () => this.distribute("horizontal-gaps"));
    this.#controls.spaceVerticalButton.addEventListener("click", () => this.distribute("vertical-gaps"));
  }

  #beginInspectorEdit(): void {
    if (!this.#canMutatePrimary()) return;
    this.#inspectorEdit.begin(this.#snapshot());
  }

  #checkpointInspectorMutation(before: string, after: string): void {
    const checkpoint = this.#inspectorEdit.checkpointForChange(before, after);
    if (checkpoint === undefined) return;
    this.#history.checkpoint(checkpoint);
    this.#notifyHistory();
  }

  #beginInteractiveMutation(
    kind: "drag" | "resize" | "rotation",
    source?: Event,
    pluginSession?: DraggableSession | ResizeSession,
  ): void {
    if (!this.#canMutatePrimary()) return;
    if (this.#interactiveMutation) return;
    this.#interactiveSnapshot = this.#snapshot();
    this.#interactiveMutation = true;
    this.#interactiveMoved = false;
    this.#groupTransformGesture = undefined;
    this.#groupTransformRejected = false;
    this.#groupDragOffset = { x: 0, y: 0 };
    this.#selectionTranslationGesture = undefined;
    this.#selectionTranslationRejected = false;
    this.#translationRootToScreen = undefined;
    this.#groupRotationGesture = kind === "rotation" && this.selectedNode?.localName === "g";
    this.#interactiveStartPoint = source ? interactionPoint(source) : undefined;
    this.#interactivePluginSession = pluginSession;
    this.#interactivePluginType = kind === "drag" ? "drag" : "resize";
    this.#bindInteractiveTerminals();
    const node = this.selectedNode;
    const root = this.svgNode;
    if (kind === "drag" && root && this.#selectedNodes.length > 1) {
      const availability = translationAvailability(
        this.#selectedNodes,
        root,
        (candidate) => this.#isLocked(candidate),
        this.#agentMutationBlocked,
      );
      if (!availability.allowed) {
        this.#selectionTranslationRejected = true;
        this.#callbacks.onStatus(availability.reason);
        return;
      }
      try {
        const rootToScreen = screenMatrix(root);
        if (!rootToScreen || !this.#interactiveStartPoint) {
          throw new RangeError("The collective drag coordinate space is unavailable.");
        }
        this.#translationRootToScreen = rootToScreen;
        this.#selectionTranslationGesture = new SelectionTranslationGesture(translationTargets(this.#selectedNodes, root));
      } catch (error) {
        this.#rejectSelectionTranslation(error);
      }
      return;
    }
    if (kind !== "rotation" && node?.localName === "g" && this.#selected) {
      try {
        const matrix = this.#selected.matrixify();
        const box = this.#selected.bbox();
        this.#groupTransformGesture = new GroupTransformGesture(node, matrix, box);
      } catch (error) {
        this.#groupTransformRejected = true;
        this.#callbacks.onStatus(error instanceof Error ? error.message : `Unable to begin grouped ${kind}`);
      }
    }
  }

  #markInteractiveMoved(changed: boolean): void {
    if (!this.#interactiveMutation || this.#agentMutationBlocked || !changed) return;
    this.#interactiveMoved = true;
  }

  #bindInteractiveTerminals(): void {
    const finish = () => queueMicrotask(() => this.#finishInteractiveMutation());
    const cancel = () => queueMicrotask(() => this.#cancelInteractiveMutation());
    window.addEventListener("mouseup", finish);
    window.addEventListener("touchend", finish);
    window.addEventListener("touchcancel", cancel);
    window.addEventListener("pointercancel", cancel);
    this.#interactiveCleanup = () => {
      window.removeEventListener("mouseup", finish);
      window.removeEventListener("touchend", finish);
      window.removeEventListener("touchcancel", cancel);
      window.removeEventListener("pointercancel", cancel);
      this.#interactiveCleanup = undefined;
    };
  }

  #finishInteractiveMutation(): void {
    if (!this.#interactiveMutation) return;
    this.#interactiveCleanup?.();
    this.#interactiveMutation = false;
    const selectionChanged = this.#selectionTranslationGesture?.complete();
    const groupChanged = this.#groupTransformGesture?.complete();
    if (this.#groupRotationGesture && this.#interactiveMoved && this.#selected) {
      try {
        this.selectedNode?.setAttribute("transform", formatMatrix(this.#selected.matrixify()));
      } catch (error) {
        this.#groupRotationGesture = false;
        this.#restore(this.#interactiveSnapshot);
        this.#callbacks.onStatus(error instanceof Error ? error.message : "The grouped rotation was rejected.");
        return;
      }
    }
    const changed = this.#selectionTranslationGesture
      ? selectionChanged === true
      : this.#groupTransformGesture
        ? groupChanged === true
        : this.#interactiveMoved && this.#snapshot() !== this.#interactiveSnapshot;
    this.#selectionTranslationGesture = undefined;
    this.#selectionTranslationRejected = false;
    this.#translationRootToScreen = undefined;
    this.#groupTransformGesture = undefined;
    this.#groupTransformRejected = false;
    this.#groupRotationGesture = false;
    this.#interactiveStartPoint = undefined;
    this.#interactivePluginSession = undefined;
    this.#interactivePluginType = undefined;
    if (changed) {
      this.#history.checkpoint(this.#interactiveSnapshot);
      this.#notifyHistory();
      this.#suppressCanvasClickUntil = performance.now() + 150;
    }
    this.#syncSelectionUi();
    this.#notifyDocumentChange();
  }

  #cancelInteractiveMutation(restoreSnapshot = true): void {
    if (!this.#interactiveMutation) return;
    this.#interactiveCleanup?.();
    this.#terminateInteractivePlugin();
    this.#selectionTranslationGesture?.cancel();
    this.#selectionTranslationGesture = undefined;
    this.#selectionTranslationRejected = false;
    this.#translationRootToScreen = undefined;
    this.#groupTransformGesture = undefined;
    this.#groupTransformRejected = false;
    this.#groupRotationGesture = false;
    this.#interactiveStartPoint = undefined;
    this.#interactiveMutation = false;
    this.#interactiveMoved = false;
    if (restoreSnapshot) this.#restore(this.#interactiveSnapshot);
  }

  #terminateInteractivePlugin(): void {
    if (this.#interactivePluginType === "drag") {
      off(window, "mousemove.drag touchmove.drag mouseup.drag touchend.drag");
      (this.#interactivePluginSession as DraggableSession | undefined)?.init(true);
    } else if (this.#interactivePluginType === "resize") {
      off(window, "mousemove.resize touchmove.resize mouseup.resize touchend.resize touchcancel.resize");
      const session = this.#interactivePluginSession as ResizeSession | undefined;
      if (session) {
        session.lastEvent = null;
        session.eventType = "";
      }
    }
    this.#interactivePluginSession = undefined;
    this.#interactivePluginType = undefined;
  }

  #rejectGroupTransform(error: unknown): void {
    this.#groupTransformGesture?.cancel();
    this.#groupTransformGesture = undefined;
    this.#groupTransformRejected = true;
    this.#interactiveMoved = false;
    this.#callbacks.onStatus(error instanceof Error ? error.message : "The grouped transform was rejected.");
  }

  #rejectSelectionTranslation(error: unknown): void {
    this.#selectionTranslationGesture?.cancel();
    this.#selectionTranslationGesture = undefined;
    this.#selectionTranslationRejected = true;
    this.#translationRootToScreen = undefined;
    this.#interactiveMoved = false;
    this.#callbacks.onStatus(error instanceof Error ? error.message : "The collective movement was rejected.");
  }

  #mutate(change: () => void): void {
    if (!this.#drawing || this.#agentMutationBlocked) return;
    this.#history.checkpoint(this.#snapshot());
    change();
    this.#syncSelectionUi();
    this.#notifyDocumentChange();
    this.#notifyHistory();
  }

  #moveSelection(axis: "x" | "y"): void {
    if (!this.#selected || !this.#drawing) return;
    const next = Number(axis === "x" ? this.#controls.positionX.value : this.#controls.positionY.value);
    if (!Number.isFinite(next)) return;
    const box = this.#selected.rbox(this.#drawing);
    const delta = next - (axis === "x" ? box.x : box.y);
    this.#mutateWithoutCheckpoint(() => this.#selected?.dmove(axis === "x" ? delta : 0, axis === "y" ? delta : 0));
  }

  #scaleSelection(): void {
    if (!this.#selected) return;
    const next = Number(this.#controls.scale.value);
    const node = this.#selected.node as SVGGraphicsElement;
    const previous = Number(node.dataset.lineageScale ?? 100);
    if (!Number.isFinite(next) || next <= 0 || !Number.isFinite(previous)) return;
    const box = this.#selected.bbox();
    this.#mutateWithoutCheckpoint(() => {
      this.#selected?.scale(next / previous, box.cx, box.cy);
      node.dataset.lineageScale = String(next);
    });
  }

  #scaleGroupSelection(): void {
    const edit = this.#groupScaleEdit;
    const node = this.selectedNode;
    if (!edit || !node || node.localName !== "g") return;
    const next = Number(this.#controls.scale.value);
    if (!Number.isFinite(next) || next <= 0) return;
    const before = this.#snapshot();
    try {
      if (next === edit.initialPercent) {
        if (edit.originalTransform === null) node.removeAttribute("transform");
        else node.setAttribute("transform", edit.originalTransform);
        if (edit.originalScale === null) node.removeAttribute("data-lineage-scale");
        else node.setAttribute("data-lineage-scale", edit.originalScale);
      } else {
        node.setAttribute("transform", formatMatrix(composeGroupScale(
          edit.initialMatrix,
          edit.box,
          next / edit.initialPercent,
        )));
        node.dataset.lineageScale = String(next);
      }
    } catch (error) {
      if (edit.originalTransform === null) node.removeAttribute("transform");
      else node.setAttribute("transform", edit.originalTransform);
      if (edit.originalScale === null) node.removeAttribute("data-lineage-scale");
      else node.setAttribute("data-lineage-scale", edit.originalScale);
      this.#callbacks.onStatus(error instanceof Error ? error.message : "The grouped scale was rejected.");
    }
    this.#syncSelectionUi();
    if (this.#snapshot() !== before) {
      this.#notifyDocumentChange();
      this.#notifyHistory();
    }
  }

  #completeGroupScaleEdit(): void {
    const edit = this.#groupScaleEdit;
    if (!edit) return;
    this.#groupScaleEdit = undefined;
    if (this.#snapshot() === edit.snapshot) return;
    this.#history.checkpoint(edit.snapshot);
    this.#notifyHistory();
  }

  #rotateSelection(): void {
    if (!this.#selected) return;
    const next = Number(this.#controls.rotation.value);
    const node = this.#selected.node as SVGGraphicsElement;
    const previous = node.dataset.lineageRotation === undefined
      ? matrixRotationDegrees(this.#selected.matrixify())
      : Number(node.dataset.lineageRotation);
    if (!Number.isFinite(next) || !Number.isFinite(previous)) return;
    const box = this.#selected.bbox();
    this.#mutateWithoutCheckpoint(() => {
      this.#selected?.rotate(next - previous, box.cx, box.cy);
      node.dataset.lineageRotation = String(next);
    });
  }

  #duplicateSelection(): void {
    const source = this.#singleMutableSelection("duplicating");
    if (!source) return;
    this.#mutate(() => {
      const clone = source.cloneNode(true) as SVGGraphicsElement;
      this.#labelDuplicate(source, clone);
      this.#remapCloneIds(clone);
      for (const node of [clone, ...Array.from(clone.querySelectorAll<SVGGraphicsElement>(EDITABLE_SELECTOR))]) {
        node.removeAttribute("data-lineage-key");
      }
      source.after(clone);
      this.#assignKeys(this.#drawing?.node as SVGSVGElement);
      (SVG(clone) as SvgElement).dmove(12, 12);
      this.selectNode(clone);
    });
  }

  #labelDuplicate(source: SVGGraphicsElement, clone: SVGGraphicsElement): void {
    const sourceLabel = source.getAttribute("aria-label")?.trim();
    const root = this.svgNode;
    if (!sourceLabel || !root) return;
    const usedLabels = new Set(Array.from(root.querySelectorAll<SVGGraphicsElement>(EDITABLE_SELECTOR))
      .map((node) => node.getAttribute("aria-label")?.trim())
      .filter((label): label is string => Boolean(label)));
    const base = `${sourceLabel} copy`;
    let candidate = base;
    let suffix = 2;
    while (usedLabels.has(candidate)) {
      candidate = `${base} ${suffix}`;
      suffix += 1;
    }
    clone.setAttribute("aria-label", candidate);
  }

  #remapCloneIds(clone: SVGGraphicsElement): void {
    const remapped = new Map<string, string>();
    for (const node of [clone, ...Array.from(clone.querySelectorAll<SVGElement>("[id]"))]) {
      if (!node.id) continue;
      this.#keyCounter += 1;
      const replacement = `${node.id}-copy-${this.#keyCounter}`;
      remapped.set(node.id, replacement);
      node.id = replacement;
    }
    for (const node of [clone, ...Array.from(clone.querySelectorAll<SVGElement>("*"))]) {
      for (const attribute of Array.from(node.attributes)) {
        let value = attribute.value;
        for (const [original, replacement] of remapped) {
          value = value.replaceAll(`url(#${original})`, `url(#${replacement})`);
          if (value === `#${original}`) value = `#${replacement}`;
        }
        node.setAttribute(attribute.name, value);
      }
    }
  }

  #deleteSelection(): void {
    const node = this.#singleMutableSelection("deleting");
    if (!node) return;
    const root = this.svgNode;
    const fallbackScope = root ? getSelectableParent(node, root) ?? root : undefined;
    this.#mutate(() => {
      this.#deselect();
      node.remove();
      this.#selectedNodes = [];
      if (this.#scope === node || (this.#scope && node.contains(this.#scope))) {
        this.#scope = fallbackScope;
      }
      this.#setSelectionUi(undefined);
      this.#callbacks.onSelectionChange(undefined);
      this.#notifySelectionContext();
    });
  }

  #translateSelection(dx: number, dy: number): boolean {
    const root = this.svgNode;
    if (!root) return false;
    const availability = translationAvailability(
      this.#selectedNodes,
      root,
      (node) => this.#isLocked(node),
      this.#agentMutationBlocked,
    );
    if (!availability.allowed) {
      this.#callbacks.onStatus(availability.reason);
      return false;
    }
    const selected = [...this.#selectedNodes];
    const primary = this.selectedNode;
    const before = this.#snapshot();
    let gesture: SelectionTranslationGesture | undefined;
    try {
      gesture = new SelectionTranslationGesture(translationTargets(selected, root));
      gesture.move(dx, dy);
      if (!gesture.complete()) return false;
      this.#setSelection(selected, primary);
      this.#history.checkpoint(before);
      this.#notifyDocumentChange();
      this.#notifyHistory();
      return true;
    } catch (error) {
      gesture?.cancel();
      this.#callbacks.onStatus(error instanceof Error ? error.message : "The selection could not be moved together.");
      return false;
    }
  }

  #handleKeydown(event: KeyboardEvent): void {
    const target = event.target;
    if (event.key === "Escape" && (this.#marqueeGesture || this.#precisePointer)) {
      event.preventDefault();
      if (!this.cancelMarquee()) this.#cancelPrecisePointer();
      return;
    }
    if (document.querySelector("dialog[open]")) return;
    if (target instanceof HTMLElement
      && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      this.redo();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
      event.preventDefault();
      this.#duplicateSelection();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g") {
      event.preventDefault();
      if (event.shiftKey) this.ungroup();
      else this.group();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (this.#interactiveMutation) {
        this.#cancelInteractiveMutation();
        return;
      }
      this.#setSelection([]);
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.#deleteSelection();
      return;
    }
    if (this.#selectedNodes.length === 0 || !event.key.startsWith("Arrow")) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    const movement: Record<string, [number, number]> = {
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
    };
    const [dx, dy] = movement[event.key] ?? [0, 0];
    if (this.#translateSelection(dx, dy)) {
      this.#callbacks.onStatus(`Moved ${this.#selectedNodes.length === 1 ? this.#label(this.#selectedNodes[0]) : `${this.#selectedNodes.length} selected layers`}`);
    }
  }

  #mutateWithoutCheckpoint(change: () => void): void {
    change();
    this.#syncSelectionUi();
    this.#notifyDocumentChange();
    this.#notifyHistory();
  }

  #deselect(): void {
    this.svgNode?.querySelector(SELECTION_HALOS_SELECTOR)?.remove();
    this.#selectedNodes.forEach((node) => {
      node.removeAttribute(SECONDARY_ATTRIBUTE);
      node.removeAttribute(PRIMARY_FALLBACK_ATTRIBUTE);
    });
    this.#selectionDragSources.forEach((source) => {
      source.off(".lineage");
      source.draggable(false);
    });
    this.#selectionDragSources = [];
    if (!this.#selected) return;
    this.#selected.off(".lineage");
    this.#selected.select(false).resize(false);
    this.#selected = undefined;
  }

  #isExactToggleClick(event: MouseEvent): boolean {
    if (event.button !== 0 || event.shiftKey) return false;
    if (this.#selectionPreferences.preciseModifier === "alt") {
      return event.altKey && !event.metaKey && !event.ctrlKey;
    }
    if (event.altKey || event.metaKey === event.ctrlKey) return false;
    const isApple = /^(?:Mac|iPhone|iPad|iPod)/.test(navigator.platform);
    return isApple ? event.metaKey : event.ctrlKey;
  }

  #isExactTogglePointer(event: PointerEvent): boolean {
    return this.#isExactToggleClick(event);
  }

  #toggleExactNode(node: SVGGraphicsElement, root: SVGSVGElement): void {
    const parent = getSelectableParent(node, root) ?? root;
    if (parent === (this.#scope ?? root)) this.#toggleNode(node);
    else {
      this.#scope = parent;
      this.#setSelection([node], node);
    }
  }

  #cancelPrecisePointer(): void {
    const precise = this.#precisePointer;
    this.#precisePointer = undefined;
    if (precise) this.#armCanvasClickSuppression();
    const root = this.svgNode;
    if (precise && root?.hasPointerCapture?.(precise.pointerId)) root.releasePointerCapture(precise.pointerId);
  }

  #armCanvasClickSuppression(): void {
    this.#suppressCanvasClickUntil = performance.now() + 250;
  }

  #announceMarqueeEnd(): void {
    this.#artboard.dispatchEvent(new CustomEvent("lineage-marquee-end"));
  }

  #setSelectionUi(node?: SVGGraphicsElement): void {
    this.#controls.selectionEmpty.hidden = Boolean(node);
    this.#controls.selectionPanel.hidden = !node;
    if (!node) {
      this.#controls.selectionName.textContent = "None";
      this.#controls.name.value = "";
      this.#controls.fillState.textContent = "";
      this.#controls.strokeState.textContent = "";
      this.#controls.textError.textContent = "";
      this.#syncOperationUi();
      return;
    }
    this.#controls.selectionName.textContent = this.#selectedNodes.length > 1
      ? `${this.#selectedNodes.length} layers`
      : this.#label(node);
    this.#syncSelectionUi();
  }

  #syncSelectionUi(): void {
    if (!this.#selected || !this.#drawing) return;
    this.#renderSelectionHalos();
    const node = this.#selected.node as SVGGraphicsElement;
    enhanceRotationHandle(this.#drawing.node as SVGSVGElement);
    let box: { x: number; y: number };
    try {
      box = this.#selected.rbox(this.#drawing);
    } catch {
      const nativeBox = node.getBBox();
      box = { x: nativeBox.x, y: nativeBox.y };
    }
    this.#syncingControls = true;
    const explicitFill = node.getAttribute("fill");
    const explicitStroke = node.getAttribute("stroke");
    this.#controls.fill.value = explicitFill ?? "";
    this.#controls.stroke.value = explicitStroke ?? "";
    this.#controls.fill.removeAttribute("aria-invalid");
    this.#controls.stroke.removeAttribute("aria-invalid");
    this.#controls.fillError.textContent = "";
    this.#controls.strokeError.textContent = "";
    const fillPickerValue = paintPickerValue(this.#controls.fill.value);
    const strokePickerValue = paintPickerValue(this.#controls.stroke.value);
    this.#controls.fillPicker.disabled = !fillPickerValue;
    this.#controls.strokePicker.disabled = !strokePickerValue;
    if (fillPickerValue) this.#controls.fillPicker.value = fillPickerValue;
    if (strokePickerValue) this.#controls.strokePicker.value = strokePickerValue;
    this.#controls.fillState.textContent = svgPaintState(explicitFill);
    this.#controls.strokeState.textContent = svgPaintState(explicitStroke);
    this.#controls.strokeWidth.value = String(this.#selected.attr("stroke-width") ?? "");
    this.#controls.opacity.value = String(this.#selected.attr("opacity") ?? 1);
    this.#controls.positionX.value = String(Number(box.x.toFixed(2)));
    this.#controls.positionY.value = String(Number(box.y.toFixed(2)));
    this.#controls.scale.value = node.dataset.lineageScale ?? "100";
    this.#controls.rotation.value = node.dataset.lineageRotation
      ?? String(matrixRotationDegrees(this.#selected.matrixify()));
    const isText = node.localName === "text";
    this.#controls.textContent.value = isText ? node.textContent ?? "" : "";
    this.#controls.textSize.value = isText ? displayedTextValue(node as SVGTextElement, "font-size") : "";
    this.#controls.textWeight.value = isText ? displayedTextValue(node as SVGTextElement, "font-weight") : "";
    this.#controls.textFamily.value = isText ? displayedTextValue(node as SVGTextElement, "font-family") : "";
    this.#controls.textAnchor.value = isText ? displayedTextValue(node as SVGTextElement, "text-anchor", "start") : "start";
    this.#controls.textLetterSpacing.value = isText ? displayedTextValue(node as SVGTextElement, "letter-spacing") : "";
    this.#controls.textError.textContent = "";
    for (const control of [
      this.#controls.textContent,
      this.#controls.textSize,
      this.#controls.textWeight,
      this.#controls.textFamily,
      this.#controls.textAnchor,
      this.#controls.textLetterSpacing,
    ]) control.removeAttribute("aria-invalid");
    this.#controls.hideButton.textContent = node.getAttribute("display") === "none" ? "Show" : "Hide";
    this.#controls.name.value = node.getAttribute("aria-label") ?? "";
    const locked = this.#isLocked(node);
    const directlyLocked = Boolean(node.dataset.lineageKey && this.#lockedKeys.has(node.dataset.lineageKey));
    const single = this.#selectedNodes.length === 1;
    for (const control of [
      this.#controls.fill,
      this.#controls.fillPicker,
      this.#controls.stroke,
      this.#controls.strokePicker,
      this.#controls.strokeWidth,
      this.#controls.opacity,
      this.#controls.positionX,
      this.#controls.positionY,
      this.#controls.scale,
      this.#controls.rotation,
      this.#controls.name,
      this.#controls.nameClearButton,
      this.#controls.duplicateButton,
      this.#controls.deleteButton,
      this.#controls.hideButton,
    ]) control.disabled = !single || locked;
    for (const control of [
      this.#controls.textContent,
      this.#controls.textSize,
      this.#controls.textWeight,
      this.#controls.textFamily,
      this.#controls.textAnchor,
      this.#controls.textLetterSpacing,
    ]) control.disabled = !single || locked || !isText;
    this.#controls.nameClearButton.disabled = !single || locked || !node.hasAttribute("aria-label");
    this.#controls.fillPicker.disabled = !single || locked || !fillPickerValue;
    this.#controls.strokePicker.disabled = !single || locked || !strokePickerValue;
    this.#controls.lockButton.disabled = !single || (locked && !directlyLocked);
    this.#controls.lockButton.textContent = directlyLocked ? "Unlock" : locked ? "Locked by ancestor" : "Lock";
    this.#syncOperationUi();
    this.#syncingControls = false;
  }

  #snapshot(): string {
    const root = this.svgNode;
    const keysFor = (node: SVGGraphicsElement | SVGSVGElement | undefined): string[] => {
      if (!root || !node || node === root) return [];
      return getSelectionAncestry(node as SVGGraphicsElement, root)
        .reverse()
        .map((candidate) => candidate.dataset.lineageKey)
        .filter((key): key is string => Boolean(key));
    };
    return JSON.stringify({
      markup: serializeSvg(root, false),
      primaryKeys: keysFor(this.selectedNode),
      selectionPaths: this.#selectedNodes.map((node) => keysFor(node)),
      scopeKeys: keysFor(this.#scope),
      selectionKeys: keysFor(this.selectedNode),
    } satisfies EditorSnapshot);
  }

  #restore(snapshot: string): void {
    let context: EditorSnapshot;
    try {
      context = JSON.parse(snapshot) as EditorSnapshot;
    } catch {
      context = { markup: snapshot, scopeKeys: [], selectionKeys: [] };
    }
    const parsed = new DOMParser().parseFromString(context.markup, "image/svg+xml");
    const restored = parsed.documentElement;
    if (!(restored instanceof SVGSVGElement) || parsed.querySelector("parsererror")) return;
    this.#clearHover();
    this.#deselect();
    const imported = document.importNode(restored, true);
    this.#artboard.replaceChildren(imported);
    this.#drawing = SVG(imported) as Svg;
    this.#assignKeys(imported);
    this.#scope = findSelectableByKeys(imported, context.scopeKeys) ?? imported;
    this.#bindCanvasSelection(imported);
    const selectionPaths = context.selectionPaths ?? (context.selectionKeys.length > 0 ? [context.selectionKeys] : []);
    const selectedNodes = Array.from(new Set(selectionPaths
      .map((keys) => findSelectableByKeys(imported, keys))
      .filter((node): node is SVGGraphicsElement => Boolean(node))));
    const primary = findSelectableByKeys(imported, context.primaryKeys ?? context.selectionKeys) ?? selectedNodes.at(-1);
    if (selectedNodes.length > 0) this.#setSelection(selectedNodes, primary);
    else {
      this.#setSelectionUi(undefined);
      this.#callbacks.onSelectionChange(undefined);
      this.#notifySelectionContext();
    }
    this.#notifyDocumentChange();
    this.#notifyHistory();
  }

  #notifyDocumentChange(): void {
    const root = this.svgNode;
    if (root) {
      this.#callbacks.onDocumentChange(root);
      this.#callbacks.onDirtyChange(!cleanSvgsEqualForDirtyComparison(this.serializeClean(), this.#baseline));
    }
  }

  #notifyHistory(): void {
    const availability = visibleHistoryAvailability(this.#agentMutationBlocked, this.#history.canUndo, this.#history.canRedo);
    this.#callbacks.onHistoryChange(availability.canUndo, availability.canRedo);
  }

  #label(node: SVGGraphicsElement): string {
    const root = this.svgNode;
    return root ? getSelectionLabel(node, root) : node.localName;
  }

  #isLocked(node: SVGGraphicsElement): boolean {
    const root = this.svgNode;
    if (!root) return false;
    let candidate: SVGGraphicsElement | SVGSVGElement | undefined = node;
    while (candidate && candidate !== root) {
      const key = (candidate as SVGGraphicsElement).dataset.lineageKey;
      if (key && this.#lockedKeys.has(key)) return true;
      candidate = getSelectableParent(candidate, root);
    }
    return false;
  }

  #canMutatePrimary(): boolean {
    if (this.#agentMutationBlocked) return false;
    const node = this.selectedNode;
    return Boolean(node && !this.#isLocked(node));
  }

  #singleMutableSelection(action: string): SVGGraphicsElement | undefined {
    if (this.#agentMutationBlocked) return undefined;
    const node = this.selectedNode;
    if (this.#selectedNodes.length !== 1 || !node) {
      this.#callbacks.onStatus(`${action[0].toUpperCase()}${action.slice(1)} requires one selected layer`);
      return undefined;
    }
    if (this.#isLocked(node)) {
      this.#callbacks.onStatus(`Unlock ${this.#label(node)} before ${action}`);
      return undefined;
    }
    return node;
  }

  #syncOperationUi(): void {
    const state = this.operationState();
    const alignmentButtons = [
      this.#controls.alignLeftButton,
      this.#controls.alignCenterButton,
      this.#controls.alignRightButton,
      this.#controls.alignTopButton,
      this.#controls.alignMiddleButton,
      this.#controls.alignBottomButton,
    ];
    const distributionButtons = [
      this.#controls.distributeHorizontalButton,
      this.#controls.distributeVerticalButton,
      this.#controls.spaceHorizontalButton,
      this.#controls.spaceVerticalButton,
    ];
    if (this.#agentMutationBlocked) {
      for (const button of [...alignmentButtons, ...distributionButtons, this.#controls.groupButton, this.#controls.ungroupButton, this.#controls.reorderEarlierButton, this.#controls.reorderLaterButton]) button.disabled = true;
      this.#controls.hierarchyReason.textContent = "Review the pending agent transaction before editing layers.";
      this.#controls.alignmentReason.textContent = "Review the pending agent transaction before aligning layers.";
      return;
    }
    for (const button of alignmentButtons) {
      button.disabled = !state.align.allowed;
      button.title = state.align.reason;
    }
    for (const button of distributionButtons) {
      button.disabled = !state.distribute.allowed;
      button.title = state.distribute.reason;
    }
    this.#controls.groupButton.disabled = !state.group.allowed;
    this.#controls.ungroupButton.disabled = !state.ungroup.allowed;
    this.#controls.reorderEarlierButton.disabled = !state.reorderEarlier.allowed;
    this.#controls.reorderLaterButton.disabled = !state.reorderLater.allowed;
    this.#controls.groupButton.title = state.group.reason;
    this.#controls.ungroupButton.title = state.ungroup.reason;
    this.#controls.reorderEarlierButton.title = state.reorderEarlier.reason;
    this.#controls.reorderLaterButton.title = state.reorderLater.reason;
    const relevant = this.#selectedNodes.length > 1
      ? state.group
      : state.ungroup.allowed || this.selectedNode?.localName === "g"
        ? state.ungroup
        : state.reorderEarlier.allowed || state.reorderLater.allowed
          ? { allowed: true, reason: "Use Send backward or Bring forward to move one paint-order position." }
          : state.reorderEarlier;
    this.#controls.hierarchyReason.textContent = relevant.reason;
    this.#controls.alignmentReason.textContent = state.distribute.allowed
      ? "Distribute centers or equalize edge gaps while keeping the outer layers fixed."
      : state.align.allowed
        ? "Align selected layers to their combined selection bounds. Select 3+ to distribute or space."
        : this.#selectedNodes.length >= 3
          ? state.distribute.reason
          : state.align.reason;
  }

  #hasDirectSelectableChildren(node: SVGGraphicsElement, root: SVGSVGElement): boolean {
    return Array.from(node.querySelectorAll<SVGGraphicsElement>(EDITABLE_SELECTOR))
      .some((candidate) => isSelectableNode(candidate, root) && getSelectableParent(candidate, root) === node);
  }

  #setHover(node: SVGGraphicsElement | undefined): void {
    if (node === this.#hovered) return;
    this.#clearHover();
    this.#hovered = node;
    node?.setAttribute(HOVER_ATTRIBUTE, "true");
    this.#notifySelectionContext();
  }

  #clearHover(): void {
    this.#hovered?.removeAttribute(HOVER_ATTRIBUTE);
    this.#hovered = undefined;
  }

  #notifySelectionContext(): void {
    this.#callbacks.onSelectionContextChange(this.selectionContext);
  }

  #renderSelectionHalos(): void {
    const root = this.svgNode;
    if (!root) return;
    let group = root.querySelector<SVGGElement>(SELECTION_HALOS_SELECTOR);
    if (this.#selectedNodes.length === 0) {
      group?.remove();
      return;
    }
    if (!group) {
      group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.setAttribute("data-lineage-selection-halos", "true");
      group.setAttribute("aria-hidden", "true");
      group.setAttribute("pointer-events", "none");
      root.append(group);
    }
    let screenMatrix: DOMMatrix | null = null;
    try { screenMatrix = root.getScreenCTM?.() ?? null; } catch { /* Detached test SVGs have no screen matrix. */ }
    const minimumWidth = screenMatrix ? 2 / Math.max(Math.hypot(screenMatrix.a, screenMatrix.b), 0.001) : 1;
    const minimumHeight = screenMatrix ? 2 / Math.max(Math.hypot(screenMatrix.c, screenMatrix.d), 0.001) : 1;
    const rects = this.#selectedNodes.flatMap((node) => {
      try {
        const box = (SVG(node) as SvgElement).rbox(this.#drawing);
        if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) return [];
        const width = Math.max(box.width, minimumWidth);
        const height = Math.max(box.height, minimumHeight);
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("class", "lineage-selection-halo");
        rect.setAttribute("x", String(box.x - (width - box.width) / 2));
        rect.setAttribute("y", String(box.y - (height - box.height) / 2));
        rect.setAttribute("width", String(width));
        rect.setAttribute("height", String(height));
        rect.setAttribute("data-enhanced", String(this.#selectionPreferences.individualOutlines));
        if (node === this.selectedNode && node.getAttribute(PRIMARY_FALLBACK_ATTRIBUTE) === "true") {
          rect.setAttribute(PRIMARY_FALLBACK_ATTRIBUTE, "true");
        }
        return [rect];
      } catch { return []; }
    });
    group.replaceChildren(...rects);
  }
}
