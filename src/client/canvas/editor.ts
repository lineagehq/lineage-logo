import { SVG, type Element as SvgElement, type Svg } from "@svgdotjs/svg.js";
import "@svgdotjs/svg.draggable.js";
import "@svgdotjs/svg.select.js";
import "@svgdotjs/svg.resize.js";
import { History } from "../history/history";

interface EditorControls {
  deleteButton: HTMLButtonElement;
  duplicateButton: HTMLButtonElement;
  fill: HTMLInputElement;
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
  strokeWidth: HTMLInputElement;
}

interface EditorCallbacks {
  onDocumentChange: (svg: SVGSVGElement) => void;
  onDirtyChange: (dirty: boolean) => void;
  onHistoryChange: (canUndo: boolean, canRedo: boolean) => void;
  onSelectionChange: (element?: SVGGraphicsElement) => void;
  onStatus: (message: string) => void;
}

const HANDLE_SELECTOR = [
  ".svg_select_shape",
  ".svg_select_shape_pointSelect",
  ".svg_select_handle",
  ".svg_select_handle_rot",
].join(",");

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

  if (stripEditorState) {
    if (clone.hasAttribute("data-lineage-added-role")) clone.removeAttribute("role");
    if (clone.hasAttribute("data-lineage-added-label")) clone.removeAttribute("aria-label");
    for (const element of [clone, ...Array.from(clone.querySelectorAll("*"))]) {
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.name.startsWith("data-lineage-")) {
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
  if (target === root) return undefined;
  let candidate = target;
  while (candidate.parentElement && candidate.parentNode !== root) {
    if (candidate.parentElement.localName === "svg") break;
    candidate = candidate.parentElement as unknown as SVGGraphicsElement;
  }
  return candidate;
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
  #keyCounter = 0;
  #selected?: SvgElement;
  #suppressCanvasClickUntil = 0;
  #syncingControls = false;

  constructor(artboard: HTMLElement, controls: EditorControls, callbacks: EditorCallbacks) {
    this.#artboard = artboard;
    this.#controls = controls;
    this.#callbacks = callbacks;
    this.#bindControls();
    document.addEventListener("keydown", (event) => this.#handleKeydown(event));
  }

  load(svg: SVGSVGElement): void {
    this.#deselect();
    this.#drawing = SVG(svg) as Svg;
    this.#history.reset();
    this.#assignKeys(svg);
    this.#bindCanvasSelection(svg);
    this.#baseline = this.serializeClean();
    this.#initialSnapshot = this.#snapshot();
    this.#setSelectionUi(undefined);
    this.#notifyHistory();
  }

  selectNode(node: SVGGraphicsElement): void {
    if (!this.#drawing || !node.isConnected) return;
    this.#deselect();
    const selected = SVG(node) as SvgElement;
    this.#selected = selected;

    if (node.getAttribute("display") !== "none") {
      selected
        .select()
        .resize({ preserveAspectRatio: true, aroundCenter: false, grid: 1, degree: 1 })
        .draggable();
      selected.on("dragstart.lineage", () => this.#beginInteractiveMutation());
      selected.on("dragmove.lineage", () => this.#syncSelectionUi());
      selected.on("dragend.lineage", () => this.#finishInteractiveMutation());
      selected.on("beforeresize.lineage", () => this.#beginInteractiveMutation());
      selected.on("resize.lineage", () => {
        this.#syncSelectionUi();
        this.#scheduleInteractiveFinish();
      });
    }

    this.#setSelectionUi(node);
    this.#callbacks.onSelectionChange(node);
  }

  undo(): void {
    const previous = this.#history.undo(this.#snapshot());
    if (previous === undefined) return;
    this.#restore(previous);
    this.#callbacks.onStatus("Undid the last correction");
  }

  redo(): void {
    const next = this.#history.redo(this.#snapshot());
    if (next === undefined) return;
    this.#restore(next);
    this.#callbacks.onStatus("Redid the correction");
  }

  reset(): void {
    if (!this.#drawing || this.serializeClean() === this.#baseline) return;
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

  #assignKeys(root: SVGSVGElement): void {
    for (const node of root.querySelectorAll<SVGGraphicsElement>("g, path, rect, circle, ellipse, polygon, polyline, line, text")) {
      if (!node.dataset.lineageKey) {
        this.#keyCounter += 1;
        node.dataset.lineageKey = `element-${this.#keyCounter}`;
      }
    }
  }

  #bindCanvasSelection(svg: SVGSVGElement): void {
    svg.addEventListener("click", (event) => {
      if (performance.now() < this.#suppressCanvasClickUntil) return;
      const target = event.target;
      if (!(target instanceof SVGGraphicsElement) || target.closest(HANDLE_SELECTOR)) return;
      const candidate = event.altKey ? target : getLogicalSelectionTarget(target, svg);
      if (candidate) this.selectNode(candidate);
      else {
        this.#deselect();
        this.#setSelectionUi(undefined);
        this.#callbacks.onSelectionChange(undefined);
      }
      event.stopPropagation();
    });
    svg.addEventListener("dblclick", (event) => {
      const target = event.target;
      if (!(target instanceof SVGGraphicsElement) || target.closest(HANDLE_SELECTOR)) return;
      this.selectNode(target);
      event.stopPropagation();
    });
  }

  #bindControls(): void {
    const attributeControls: Array<[HTMLInputElement, string]> = [
      [this.#controls.fill, "fill"],
      [this.#controls.stroke, "stroke"],
      [this.#controls.strokeWidth, "stroke-width"],
      [this.#controls.opacity, "opacity"],
    ];
    for (const [control, attribute] of attributeControls) {
      control.addEventListener("focus", () => {
        if (!this.#selected) return;
        this.#history.checkpoint(this.#snapshot());
        this.#notifyHistory();
      });
      control.addEventListener("input", () => {
        if (this.#syncingControls || !this.#selected) return;
        this.#selected.attr(attribute, control.value.trim() || null);
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
      control.addEventListener("focus", () => {
        if (!this.#selected) return;
        this.#history.checkpoint(this.#snapshot());
        this.#notifyHistory();
      });
      control.addEventListener("input", () => {
        if (this.#syncingControls || !this.#selected) return;
        apply();
      });
      control.addEventListener("change", () => this.#syncSelectionUi());
    }
    this.#controls.duplicateButton.addEventListener("click", () => this.#duplicateSelection());
    this.#controls.deleteButton.addEventListener("click", () => this.#deleteSelection());
    this.#controls.hideButton.addEventListener("click", () => this.#toggleVisibility());
  }

  #beginInteractiveMutation(): void {
    if (this.#interactiveMutation) return;
    this.#history.checkpoint(this.#snapshot());
    this.#interactiveMutation = true;
    this.#notifyHistory();
  }

  #scheduleInteractiveFinish(): void {
    window.addEventListener("pointerup", () => this.#finishInteractiveMutation(), { once: true });
    window.addEventListener("mouseup", () => this.#finishInteractiveMutation(), { once: true });
  }

  #finishInteractiveMutation(): void {
    if (!this.#interactiveMutation) return;
    this.#interactiveMutation = false;
    this.#suppressCanvasClickUntil = performance.now() + 150;
    this.#syncSelectionUi();
    this.#notifyDocumentChange();
  }

  #mutate(change: () => void): void {
    if (!this.#drawing) return;
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
    if (!this.#selected) return;
    const source = this.#selected.node as SVGGraphicsElement;
    this.#mutate(() => {
      const clone = source.cloneNode(true) as SVGGraphicsElement;
      this.#remapCloneIds(clone);
      clone.removeAttribute("data-lineage-key");
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
    if (!this.#selected) return;
    const node = this.#selected.node as SVGGraphicsElement;
    this.#mutate(() => {
      this.#deselect();
      node.remove();
      this.#setSelectionUi(undefined);
      this.#callbacks.onSelectionChange(undefined);
    });
  }

  #toggleVisibility(): void {
    if (!this.#selected) return;
    const node = this.#selected.node as SVGGraphicsElement;
    const hidden = node.getAttribute("display") === "none";
    this.#mutate(() => {
      if (hidden) {
        node.removeAttribute("display");
        const selectedNode = node;
        this.selectNode(selectedNode);
      } else {
        node.setAttribute("display", "none");
        this.#selected?.select(false).resize(false).draggable(false);
      }
    });
  }

  #handleKeydown(event: KeyboardEvent): void {
    const target = event.target;
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
    if (!this.#selected || !event.key.startsWith("Arrow")) return;
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
    if (!this.#selected) return;
    this.#selected.off(".lineage");
    this.#selected.select(false).resize(false).draggable(false);
    this.#selected = undefined;
  }

  #setSelectionUi(node?: SVGGraphicsElement): void {
    this.#controls.selectionEmpty.hidden = Boolean(node);
    this.#controls.selectionPanel.hidden = !node;
    if (!node) return;
    this.#controls.selectionName.textContent = node.id || node.localName;
    this.#syncSelectionUi();
  }

  #syncSelectionUi(): void {
    if (!this.#selected || !this.#drawing) return;
    const node = this.#selected.node as SVGGraphicsElement;
    const box = this.#selected.rbox(this.#drawing);
    this.#syncingControls = true;
    this.#controls.fill.value = String(this.#selected.attr("fill") ?? "");
    this.#controls.stroke.value = String(this.#selected.attr("stroke") ?? "");
    this.#controls.strokeWidth.value = String(this.#selected.attr("stroke-width") ?? "");
    this.#controls.opacity.value = String(this.#selected.attr("opacity") ?? 1);
    this.#controls.positionX.value = String(Number(box.x.toFixed(2)));
    this.#controls.positionY.value = String(Number(box.y.toFixed(2)));
    this.#controls.scale.value = node.dataset.lineageScale ?? "100";
    this.#controls.rotation.value = node.dataset.lineageRotation ?? "0";
    this.#controls.hideButton.textContent = node.getAttribute("display") === "none" ? "Show" : "Hide";
    this.#syncingControls = false;
  }

  #snapshot(): string {
    return serializeSvg(this.svgNode, false);
  }

  #restore(markup: string): void {
    const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
    const restored = parsed.documentElement;
    if (!(restored instanceof SVGSVGElement) || parsed.querySelector("parsererror")) return;
    this.#deselect();
    const imported = document.importNode(restored, true);
    this.#artboard.replaceChildren(imported);
    this.#drawing = SVG(imported) as Svg;
    this.#bindCanvasSelection(imported);
    this.#setSelectionUi(undefined);
    this.#callbacks.onSelectionChange(undefined);
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
}
