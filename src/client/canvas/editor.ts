import { SVG, type Element as SvgElement, type Svg } from "@svgdotjs/svg.js";
import "@svgdotjs/svg.draggable.js";
import "@svgdotjs/svg.select.js";
import "@svgdotjs/svg.resize.js";
import { History } from "../history/history";
import { evaluateAgentTransaction, type AgentDocumentContext, type AgentSelectionIntent, type StagedAgentTransaction } from "../agent/transaction";
import type { AgentTransactionV1 } from "../../shared/agent-protocol";

interface EditorControls {
  alignBottomButton: HTMLButtonElement;
  alignCenterButton: HTMLButtonElement;
  alignLeftButton: HTMLButtonElement;
  alignmentReason: HTMLElement;
  alignMiddleButton: HTMLButtonElement;
  alignRightButton: HTMLButtonElement;
  alignTopButton: HTMLButtonElement;
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
].join(",");

const EDITABLE_SELECTOR = "g, path, rect, circle, ellipse, polygon, polyline, line, text";
const RESOURCE_SELECTOR = "defs, metadata, clipPath, mask, filter, linearGradient, radialGradient, pattern, marker, symbol";
const HOVER_ATTRIBUTE = "data-lineage-hover";
const SECONDARY_ATTRIBUTE = "data-lineage-secondary";
const REVIEW_ATTRIBUTE = "data-lineage-review-highlight";

export type SvgPaintProperty = "fill" | "stroke";

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

export interface OperationAvailability {
  allowed: boolean;
  reason: string;
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
  readonly #inspectorEdit = new InspectorEditSession();
  #keyCounter = 0;
  #lockedKeys = new Set<string>();
  #selected?: SvgElement;
  #selectedNodes: SVGGraphicsElement[] = [];
  #scope?: SVGGraphicsElement | SVGSVGElement;
  #hovered?: SVGGraphicsElement;
  #suppressCanvasClickUntil = 0;
  #syncingControls = false;
  #agentMutationBlocked = false;

  constructor(artboard: HTMLElement, controls: EditorControls, callbacks: EditorCallbacks) {
    this.#artboard = artboard;
    this.#controls = controls;
    this.#callbacks = callbacks;
    this.#bindControls();
    document.addEventListener("keydown", (event) => this.#handleKeydown(event));
  }

  load(svg: SVGSVGElement): void {
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
    this.#baseline = this.serializeClean();
    this.#initialSnapshot = this.#snapshot();
    this.#setSelectionUi(undefined);
    this.#notifySelectionContext();
    this.#notifyHistory();
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
    for (const secondary of unique.filter((candidate) => candidate !== nextPrimary)) {
      secondary.setAttribute(SECONDARY_ATTRIBUTE, "true");
    }
    if (!nextPrimary) {
      this.#setSelectionUi(undefined);
      this.#callbacks.onSelectionChange(undefined);
      this.#notifySelectionContext();
      return;
    }
    const node = nextPrimary;
    const selected = SVG(nextPrimary) as SvgElement;
    this.#selected = selected;

    const hasComplexResources = Boolean(node.querySelector(RESOURCE_SELECTOR))
      || Array.from(node.attributes).some((attribute) => attribute.value.includes("url(#"));
    if (!this.#agentMutationBlocked && node.getAttribute("display") !== "none" && !this.#isLocked(node) && !hasComplexResources) {
      selected
        .select()
        .resize({ preserveAspectRatio: true, aroundCenter: false, grid: 1, degree: 1 })
        .draggable();
      selected.on("dragstart.lineage", () => this.#beginInteractiveMutation());
      selected.on("dragmove.lineage", (event) => {
        if (this.#agentMutationBlocked) {
          event.preventDefault();
          return;
        }
        this.#markInteractiveMoved();
        this.#syncSelectionUi();
      });
      selected.on("dragend.lineage", () => {
        this.#finishInteractiveMutation();
        if (this.#agentMutationBlocked) queueMicrotask(() => selected.draggable(false));
      });
      selected.on("beforeresize.lineage", () => this.#beginInteractiveMutation());
      selected.on("resize.lineage", (event) => {
        if (this.#agentMutationBlocked) {
          event.preventDefault();
          return;
        }
        this.#markInteractiveMoved();
        this.#syncSelectionUi();
        this.#scheduleInteractiveFinish();
      });
    }

    this.#setSelectionUi(node);
    this.#callbacks.onSelectionChange(node);
    this.#notifySelectionContext();
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
    if (this.serializeClean() === this.#baseline) {
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

  stageAgentTransaction(transaction: AgentTransactionV1, context: AgentDocumentContext): StagedAgentTransaction | undefined {
    const root = this.svgNode;
    if (!root) return undefined;
    if (this.#interactiveMutation) {
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
    this.#agentMutationBlocked = blocked;
    this.#setSelection([...this.#selectedNodes], this.selectedNode);
    this.#callbacks.onHistoryChange(blocked ? false : this.#history.canUndo, blocked ? false : this.#history.canRedo);
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

  acceptAgentCandidate(candidate: SVGSVGElement, selection?: AgentSelectionIntent): void {
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
    this.#history.checkpoint(before);
    this.#restore(JSON.stringify(accepted));
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
        if (hidden) this.#selectNode(node);
        else this.#selected?.select(false).resize(false).draggable(false);
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
    group: OperationAvailability;
    reorderEarlier: OperationAvailability;
    reorderLater: OperationAvailability;
    ungroup: OperationAvailability;
  } {
    const root = this.svgNode;
    const unavailable = { allowed: false, reason: "Open an SVG to organize layers." };
    if (!root) return { align: unavailable, group: unavailable, reorderEarlier: unavailable, reorderLater: unavailable, ungroup: unavailable };
    const locked = (node: SVGGraphicsElement) => this.#isLocked(node);
    return {
      align: alignmentAvailability(this.#selectedNodes, root, locked),
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
    svg.addEventListener("pointermove", (event) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest(HANDLE_SELECTOR)) {
        this.#setHover(undefined);
        return;
      }
      this.#setHover(getScopedSelectionTarget(target, this.#scope ?? svg, svg));
    });
    svg.addEventListener("pointerleave", () => this.#setHover(undefined));
    svg.addEventListener("click", (event) => {
      if (performance.now() < this.#suppressCanvasClickUntil) return;
      const target = event.target;
      if (!(target instanceof Element) || target.closest(HANDLE_SELECTOR)) return;
      const candidate = event.altKey
        ? getDirectSelectionTarget(target, svg)
        : getScopedSelectionTarget(target, this.#scope ?? svg, svg);
      if (candidate) {
        if (event.altKey) {
          this.#scope = getSelectableParent(candidate, svg) ?? svg;
          this.#setSelection([candidate], candidate);
        } else if (event.shiftKey) {
          this.#toggleNode(candidate);
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
      [this.#controls.scale, () => this.#scaleSelection()],
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

  #beginInteractiveMutation(): void {
    if (!this.#canMutatePrimary()) return;
    if (this.#interactiveMutation) return;
    this.#interactiveSnapshot = this.#snapshot();
    this.#interactiveMutation = true;
    this.#interactiveMoved = false;
  }

  #markInteractiveMoved(): void {
    if (!this.#interactiveMutation || this.#agentMutationBlocked || this.#interactiveMoved) return;
    this.#interactiveMoved = true;
    this.#history.checkpoint(this.#interactiveSnapshot);
    this.#notifyHistory();
  }

  #scheduleInteractiveFinish(): void {
    window.addEventListener("pointerup", () => this.#finishInteractiveMutation(), { once: true });
    window.addEventListener("mouseup", () => this.#finishInteractiveMutation(), { once: true });
  }

  #finishInteractiveMutation(): void {
    if (!this.#interactiveMutation) return;
    this.#interactiveMutation = false;
    if (this.#interactiveMoved) this.#suppressCanvasClickUntil = performance.now() + 150;
    this.#syncSelectionUi();
    this.#notifyDocumentChange();
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

  #rotateSelection(): void {
    if (!this.#selected) return;
    const next = Number(this.#controls.rotation.value);
    const node = this.#selected.node as SVGGraphicsElement;
    const previous = Number(node.dataset.lineageRotation ?? 0);
    if (!Number.isFinite(next) || !Number.isFinite(previous)) return;
    const box = this.#selected.bbox();
    this.#mutateWithoutCheckpoint(() => {
      this.#selected?.rotate(next - previous, box.cx, box.cy);
      node.dataset.lineageRotation = String(next);
    });
  }

  #duplicateSelection(): void {
    if (!this.#canMutatePrimary()) return;
    const source = this.selectedNode;
    if (!source) return;
    this.#mutate(() => {
      const clone = source.cloneNode(true) as SVGGraphicsElement;
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
    if (!this.#canMutatePrimary()) return;
    const node = this.selectedNode;
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

  #handleKeydown(event: KeyboardEvent): void {
    const target = event.target;
    if (document.querySelector("dialog[open]")) return;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
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
      if (this.#scope && this.svgNode && this.#scope !== this.svgNode) this.backToGroup();
      else this.#setSelection([]);
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.#deleteSelection();
      return;
    }
    if (!this.#canMutatePrimary() || !event.key.startsWith("Arrow")) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    const movement: Record<string, [number, number]> = {
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
    };
    const [dx, dy] = movement[event.key] ?? [0, 0];
    this.#mutate(() => this.#selected?.dmove(dx, dy));
  }

  #mutateWithoutCheckpoint(change: () => void): void {
    change();
    this.#syncSelectionUi();
    this.#notifyDocumentChange();
    this.#notifyHistory();
  }

  #deselect(): void {
    this.#selectedNodes.forEach((node) => node.removeAttribute(SECONDARY_ATTRIBUTE));
    if (!this.#selected) return;
    this.#selected.off(".lineage");
    this.#selected.select(false).resize(false).draggable(false);
    this.#selected = undefined;
  }

  #setSelectionUi(node?: SVGGraphicsElement): void {
    this.#controls.selectionEmpty.hidden = Boolean(node);
    this.#controls.selectionPanel.hidden = !node;
    if (!node) {
      this.#controls.selectionName.textContent = "None";
      this.#controls.name.value = "";
      this.#controls.fillState.textContent = "";
      this.#controls.strokeState.textContent = "";
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
    const node = this.#selected.node as SVGGraphicsElement;
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
    this.#controls.rotation.value = node.dataset.lineageRotation ?? "0";
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
      this.#callbacks.onDirtyChange(this.serializeClean() !== this.#baseline);
    }
  }

  #notifyHistory(): void {
    this.#callbacks.onHistoryChange(this.#history.canUndo, this.#history.canRedo);
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
    return Boolean(node && this.#selectedNodes.length === 1 && !this.#isLocked(node));
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
    const operationButtons = [
      this.#controls.alignLeftButton,
      this.#controls.alignCenterButton,
      this.#controls.alignRightButton,
      this.#controls.alignTopButton,
      this.#controls.alignMiddleButton,
      this.#controls.alignBottomButton,
    ];
    if (this.#agentMutationBlocked) {
      for (const button of [...operationButtons, this.#controls.groupButton, this.#controls.ungroupButton, this.#controls.reorderEarlierButton, this.#controls.reorderLaterButton]) button.disabled = true;
      this.#controls.hierarchyReason.textContent = "Review the pending agent transaction before editing layers.";
      this.#controls.alignmentReason.textContent = "Review the pending agent transaction before aligning layers.";
      return;
    }
    for (const button of operationButtons) button.disabled = !state.align.allowed;
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
    this.#controls.alignmentReason.textContent = state.align.allowed
      ? "Align selected layers to their combined selection bounds."
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
}
