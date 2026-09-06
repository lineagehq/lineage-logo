import { Window } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerWindow } from "@svgdotjs/svg.js";
import { SvgEditor, type SelectionContext } from "../src/client/canvas/editor";
import { DEFAULT_SELECTION_PREFERENCES } from "../src/client/selection-preferences";
import { disjointTargets, duplicateSubtrees, localReferences, type BulkEdit } from "../src/client/canvas/bulk-operations";
import type { MatrixCoefficients } from "../src/client/canvas/transform";
const IDENTITY: MatrixCoefficients = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const CONTROL_TAGS = {
  alignBottomButton: "button", alignCenterButton: "button", alignLeftButton: "button",
  alignmentReason: "div", alignMiddleButton: "button", alignRightButton: "button",
  alignTopButton: "button", groupButton: "button", hierarchyReason: "div", lockButton: "button",
  name: "input", nameClearButton: "button", reorderEarlierButton: "button", reorderLaterButton: "button",
  deleteButton: "button", duplicateButton: "button", fill: "input", fillError: "div",
  fillPicker: "input", fillState: "div", hideButton: "button", opacity: "input",
  positionX: "input", positionY: "input", rotation: "input", scale: "input",
  positionWidth: "input", positionHeight: "input", aspectLock: "input",
  geometryMode: "div", geometryError: "div",
  selectionEmpty: "div", selectionName: "div", selectionPanel: "div", stroke: "input",
  strokeError: "div", strokePicker: "input", strokeState: "div", strokeWidth: "input",
  ungroupButton: "button",
} as const;

interface EditorHarness {
  controls: ConstructorParameters<typeof SvgEditor>[1];
  editor: SvgEditor;
  group: SVGGraphicsElement;
  root: SVGSVGElement;
  statuses: string[];
  window: Window;
}

function installWindow(window: Window): void {
  for (const name of [
    "window", "document", "DOMParser", "Event", "CustomEvent", "MouseEvent", "KeyboardEvent",
    "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "SVGElement", "SVGGraphicsElement",
    "SVGSVGElement", "Node", "Element", "CSS",
  ] as const) {
    vi.stubGlobal(name, window[name as keyof Window]);
  }
  vi.stubGlobal("performance", window.performance);
  registerWindow(
    window as unknown as NonNullable<Parameters<typeof registerWindow>[0]>,
    window.document as unknown as NonNullable<Parameters<typeof registerWindow>[1]>,
  );
  const svgPrototype = window.SVGElement.prototype as unknown as {
    getBBox: () => { x: number; y: number; width: number; height: number };
    getScreenCTM: () => MatrixCoefficients;
  };
  svgPrototype.getBBox = () => ({ x: 0, y: 0, width: 20, height: 20 });
  svgPrototype.getScreenCTM = () => IDENTITY;
  const graphicsPrototype = window.SVGGraphicsElement.prototype as unknown as typeof svgPrototype;
  graphicsPrototype.getBBox = svgPrototype.getBBox;
  graphicsPrototype.getScreenCTM = svgPrototype.getScreenCTM;
}

function editorHarness(onSelectionContextChange: (context: SelectionContext) => void = () => undefined): EditorHarness {
  const window = new Window({ url: "http://localhost/" });
  installWindow(window);
  const artboard = window.document.createElement("div");
  artboard.innerHTML = `<svg viewBox="0 0 100 100">
    <defs><linearGradient id="paint"><stop offset="0" stop-color="#fff"></stop></linearGradient></defs>
    <g id="logo" transform="translate(4 5)" data-unsupported="preserve">
      <g id="icon"><path id="waveform" d="M0 10h20" fill="url(#paint)"></path></g>
      <text id="wordmark">BleepThat</text>
    </g>
  </svg>`;
  window.document.body.append(artboard);
  const controls = Object.fromEntries(Object.entries(CONTROL_TAGS).map(([name, tag]) => {
    const control = window.document.createElement(tag);
    if (control instanceof window.HTMLInputElement) control.value = name === "opacity" || name === "scale" ? "100" : "0";
    return [name, control];
  })) as unknown as ConstructorParameters<typeof SvgEditor>[1];
  const statuses: string[] = [];
  const editor = new SvgEditor(artboard as unknown as HTMLElement, controls, {
    onDocumentChange: () => undefined,
    onDirtyChange: () => undefined,
    onHistoryChange: () => undefined,
    onSelectionChange: () => undefined,
    onSelectionContextChange,
    onStatus: (message) => statuses.push(message),
  });
  const root = artboard.querySelector("svg") as unknown as SVGSVGElement;
  editor.setSelectionPreferences({ ...DEFAULT_SELECTION_PREFERENCES, alignmentSnappingEnabled: false });
  editor.load(root);
  const group = root.querySelector("#logo") as unknown as SVGGraphicsElement;
  editor.selectNode(group);
  return { controls, editor, group, root, statuses, window };
}

function select(editor: SvgEditor, ...ids: string[]): SVGGraphicsElement[] {
  const nodes = ids.map((id) => editor.svgNode!.querySelector(`#${id}`) as SVGGraphicsElement);
  editor.applyAgentSelection({ targetSessionKeys: nodes.map((node) => node.dataset.lineageKey!), primarySessionKey: nodes.at(-1)!.dataset.lineageKey });
  return nodes;
}
function selected(editor: SvgEditor): string[] { return editor.selectedNodes.map((node) => node.id); }
function input(h: EditorHarness, name: "fill" | "strokeWidth" | "opacity", value: string): void {
  h.controls[name].dispatchEvent(new h.window.Event("focus") as unknown as Event);
  h.controls[name].value = value;
  h.controls[name].dispatchEvent(new h.window.Event("input") as unknown as Event);
}
afterEach(() => vi.unstubAllGlobals());

describe("atomic bulk editing", () => {
  it.each([
    ["fill", "#112233"], ["stroke", "none"], ["stroke-width", "2.5"], ["opacity", "0.4"],
  ] as const)("changes cross-parent %s in one undo/redo while preserving selection and other attributes", (attribute, value) => {
    const h = editorHarness();
    select(h.editor, "waveform", "wordmark");
    const before = h.editor.serializeClean();
    expect(h.editor.applyBulkEdit({ kind: "appearance", attribute, value })).toEqual({ changed: true });
    expect(h.editor.selectedNodes.every((node) => node.getAttribute(attribute) === value)).toBe(true);
    const after = h.editor.serializeClean();
    expect(h.editor.undo()).toBe(true);
    expect(h.editor.serializeClean()).toBe(before);
    expect(selected(h.editor)).toEqual(["waveform", "wordmark"]);
    expect(h.editor.undo()).toBe(false);
    expect(h.editor.redo()).toBe(true);
    expect(h.editor.serializeClean()).toBe(after);
    expect(selected(h.editor)).toEqual(["waveform", "wordmark"]);
    expect(h.editor.redo()).toBe(false);
  });

  it("shows own mixed values and changes only group-own paint after ancestor normalization", () => {
    const h = editorHarness();
    const [path, text] = select(h.editor, "waveform", "wordmark");
    expect(h.controls.fill.value).toBe("");
    expect(h.controls.fill.placeholder).toBe("Mixed");
    expect(h.controls.fillState.textContent).toBe("Mixed own paint values");
    expect(h.controls.fill.disabled).toBe(false);
    expect(h.controls.fillPicker.disabled).toBe(false);
    expect(disjointTargets([path, h.group, path, text])).toEqual([h.group]);
    expect(h.editor.applyBulkEdit({ kind: "appearance", attribute: "fill", value: "#123456" }, [path, h.group, text])).toEqual({ changed: true });
    expect(h.group.getAttribute("fill")).toBe("#123456");
    expect(path.getAttribute("fill")).toBe("url(#paint)");
    expect(text.hasAttribute("fill")).toBe(false);
    expect(h.editor.undo()).toBe(true);
    expect(h.editor.undo()).toBe(false);
  });

  it("groups a focused inspector session into one bulk checkpoint and leaves unrelated paint alone", () => {
    const h = editorHarness();
    select(h.editor, "waveform", "wordmark");
    const before = h.editor.serializeClean();
    input(h, "fill", "#123456");
    h.controls.fill.value = "#987654";
    h.controls.fill.dispatchEvent(new h.window.Event("input") as unknown as Event);
    expect(h.editor.selectedNodes.every((node) => node.getAttribute("fill") === "#987654")).toBe(true);
    expect(h.editor.selectedNodes.every((node) => !node.hasAttribute("stroke"))).toBe(true);
    expect(h.editor.undo()).toBe(true);
    expect(h.editor.serializeClean()).toBe(before);
    expect(h.editor.undo()).toBe(false);
  });

  it.each([
    { kind: "appearance", attribute: "opacity", value: "-1" },
    { kind: "appearance", attribute: "opacity", value: "1.1" },
    { kind: "appearance", attribute: "stroke-width", value: "NaN" },
    { kind: "appearance", attribute: "stroke-width", value: "-2" },
    { kind: "appearance", attribute: "fill", value: "url(#missing)" },
  ] satisfies BulkEdit[])("rejects invalid input without document or history changes: %j", (edit) => {
    const h = editorHarness();
    select(h.editor, "waveform", "wordmark");
    const before = h.editor.serializeClean();
    expect(h.editor.applyBulkEdit(edit)).toMatchObject({ changed: false, error: expect.any(String) });
    expect(h.editor.serializeClean()).toBe(before);
    expect(h.editor.undo()).toBe(false);
  });

  it("rejects no-ops without history and preserves redo", () => {
    const h = editorHarness();
    select(h.editor, "waveform", "wordmark");
    h.editor.applyBulkEdit({ kind: "appearance", attribute: "opacity", value: "0.3" });
    h.editor.undo();
    expect(h.editor.applyBulkEdit({ kind: "appearance", attribute: "opacity", value: "" })).toEqual({ changed: false });
    expect(h.editor.applyBulkEdit({ kind: "visibility", hidden: false })).toEqual({ changed: false });
    expect(h.editor.undo()).toBe(false);
    expect(h.editor.redo()).toBe(true);
  });

  it.each(["ancestor", "descendant", "pending"])("rejects the entire operation for %s locks", (mode) => {
    const h = editorHarness();
    if (mode === "descendant") h.editor.selectNode(h.root.querySelector("#waveform") as SVGGraphicsElement);
    h.editor.toggleLock();
    const nodes = mode === "descendant" ? [h.group] : select(h.editor, "waveform", "wordmark");
    if (mode === "pending") {
      h.editor.selectNode(h.group); h.editor.toggleLock();
      select(h.editor, "waveform", "wordmark"); h.editor.setAgentMutationBlocked(true);
    }
    const before = h.editor.serializeClean();
    for (const edit of [{ kind: "delete" }, { kind: "duplicate" }, { kind: "visibility", hidden: true }, { kind: "appearance", attribute: "fill", value: "#123456" }] satisfies BulkEdit[]) {
      expect(h.editor.applyBulkEdit(edit, nodes)).toMatchObject({ changed: false, error: expect.any(String) });
      expect(h.editor.serializeClean()).toBe(before);
    }
    h.editor.setAgentMutationBlocked(false);
    expect(h.editor.undo()).toBe(false);
  });

  it("hides and shows all targets consistently with one reversible checkpoint", () => {
    const h = editorHarness();
    const nodes = select(h.editor, "waveform", "wordmark");
    nodes[0].setAttribute("display", "inline");
    const before = h.editor.serializeClean();
    h.editor.toggleVisibility();
    expect(nodes.map((node) => node.getAttribute("display"))).toEqual(["none", "none"]);
    expect(h.controls.hideButton.textContent).toBe("Show");
    expect(h.editor.undo()).toBe(true);
    expect(h.editor.serializeClean()).toBe(before);
    expect(selected(h.editor)).toEqual(["waveform", "wordmark"]);
    expect(h.editor.redo()).toBe(true);
    h.editor.toggleVisibility();
    expect(h.editor.serializeClean()).toBe(before);
  });

  it("deletes cross-parent targets atomically and restores structure/selection", () => {
    const h = editorHarness();
    select(h.editor, "waveform", "wordmark");
    const before = h.editor.serializeClean();
    expect(h.editor.applyBulkEdit({ kind: "delete" })).toEqual({ changed: true });
    expect(h.root.querySelector("#icon")).not.toBeNull();
    expect(h.root.querySelector("#waveform")).toBeNull();
    expect(h.root.querySelector("#paint")).not.toBeNull();
    expect(selected(h.editor)).toEqual([]);
    expect(h.editor.undo()).toBe(true);
    expect(h.editor.serializeClean()).toBe(before);
    expect(selected(h.editor)).toEqual(["waveform", "wordmark"]);
    expect(h.editor.redo()).toBe(true);
    expect(selected(h.editor)).toEqual([]);
  });

  it("rejects deleting referenced artwork unless all dependents are selected", () => {
    const h = editorHarness();
    const reference = h.root.ownerDocument.createElementNS(h.root.namespaceURI, "use");
    reference.setAttribute("href", "#waveform");
    h.root.append(reference);
    h.editor.load(h.root);
    select(h.editor, "waveform", "wordmark");
    const before = h.editor.serializeClean();
    expect(h.editor.applyBulkEdit({ kind: "delete" })).toMatchObject({ changed: false, error: expect.stringContaining("references") });
    expect(h.editor.serializeClean()).toBe(before);
    expect(h.editor.undo()).toBe(false);
  });

  it("duplicates disjoint trees with one root-space offset, collision-safe IDs and shared references", () => {
    const h = editorHarness();
    const [path, text] = select(h.editor, "waveform", "wordmark");
    const use = h.root.ownerDocument.createElementNS(h.root.namespaceURI, "use");
    use.setAttribute("id", "waveform-copy-1"); use.setAttribute("href", "#waveform"); h.group.append(use);
    text.setAttribute("aria-labelledby", "waveform");
    Object.defineProperty(path.parentElement, "getScreenCTM", { configurable: true, value: () => ({ a: 2, b: 0, c: 0, d: 3, e: 20, f: 30 }) });
    const before = h.editor.serializeClean();
    expect(h.editor.applyBulkEdit({ kind: "duplicate" })).toEqual({ changed: true });
    const copies = h.editor.selectedNodes;
    expect(copies.map((node) => node.id)).toEqual(["waveform-copy-2", "wordmark-copy-1"]);
    expect(copies[0].getAttribute("transform")).toBe("matrix(1,0,0,1,6,4)");
    expect(copies[1].getAttribute("transform")).toBe("matrix(1,0,0,1,12,12)");
    expect(copies[1].getAttribute("aria-labelledby")).toBe("waveform-copy-2");
    expect(copies[0].getAttribute("fill")).toBe("url(#paint)");
    expect(path.nextElementSibling).toBe(copies[0]);
    expect(text.nextElementSibling).toBe(copies[1]);
    expect(use.getAttribute("href")).toBe("#waveform");
    const after = h.editor.serializeClean();
    expect(h.editor.undo()).toBe(true);
    expect(h.editor.serializeClean()).toBe(before);
    expect(selected(h.editor)).toEqual(["waveform", "wordmark"]);
    expect(h.editor.undo()).toBe(false);
    expect(h.editor.redo()).toBe(true);
    expect(h.editor.serializeClean()).toBe(after);
    expect(selected(h.editor)).toEqual(["waveform-copy-2", "wordmark-copy-1"]);
  });

  it("rewrites quoted URLs, hrefs, ARIA and copied resources without changing external references", () => {
    const h = editorHarness();
    h.group.innerHTML = `<defs><linearGradient id="g"><stop/></linearGradient><mask id="m"><rect/></mask></defs><path id="a" fill="url( '#g' )" mask='url("#m")'/><use id="b" href="#a" aria-labelledby="a external" style="fill:url(#g)"/>`;
    const [clone] = duplicateSubtrees(h.root, [h.group]);
    const ids = new Set(Array.from(clone.querySelectorAll("[id]"), (node) => node.id));
    for (const node of Array.from(clone.querySelectorAll("*"))) for (const ref of localReferences(node)) expect(ref === "external" || ids.has(ref)).toBe(true);
    expect(clone.querySelector("use")!.getAttribute("href")).toBe("#a-copy-1");
    expect(h.group.querySelector("use")!.getAttribute("href")).toBe("#a");
    expect(clone.querySelectorAll("defs > *")).toHaveLength(2);
  });
  it.each(["inline", "stylesheet"])("refuses overridden %s presentation attributes across the entire selection", (mode) => {
    const h = editorHarness();
    const nodes = select(h.editor, "waveform", "wordmark");
    if (mode === "inline") nodes[1].setAttribute("style", "fill: red; display: inline");
    else {
      const style = h.root.ownerDocument.createElementNS(h.root.namespaceURI, "style");
      style.textContent = "#wordmark { fill: red; display: inline }"; h.root.append(style);
    }
    select(h.editor, "waveform", "wordmark");
    expect(h.controls.fillState.textContent).toContain("overridden by CSS");
    const before = h.editor.serializeClean();
    expect(h.editor.applyBulkEdit({ kind: "appearance", attribute: "fill", value: "#abcdef" })).toMatchObject({ changed: false, error: expect.stringContaining("CSS") });
    expect(h.editor.applyBulkEdit({ kind: "visibility", hidden: true })).toMatchObject({ changed: false, error: expect.stringContaining("CSS") });
    expect(h.editor.serializeClean()).toBe(before);
    expect(h.editor.undo()).toBe(false);
  });

  it("refuses separately offset reference targets but permits their common-group copy", () => {
    const h = editorHarness();
    const use = h.root.ownerDocument.createElementNS(h.root.namespaceURI, "use");
    use.setAttribute("href", "#waveform");
    const instance = h.root.ownerDocument.createElementNS(h.root.namespaceURI, "g");
    instance.setAttribute("id", "instance"); instance.append(use); h.group.append(instance);
    h.editor.load(h.root);
    select(h.editor, "waveform", "instance");
    const before = h.editor.serializeClean();
    expect(h.editor.applyBulkEdit({ kind: "duplicate" })).toMatchObject({ changed: false, error: expect.stringContaining("common group") });
    expect(h.editor.serializeClean()).toBe(before);
    expect(h.editor.undo()).toBe(false);
    h.editor.selectNode(h.group);
    expect(h.editor.applyBulkEdit({ kind: "duplicate" })).toEqual({ changed: true });
    const clone = h.editor.selectedNode!;
    expect(clone.querySelector("use")!.getAttribute("href")).toBe(`#${clone.querySelector("path")!.id}`);
    expect(clone.querySelector("path")!.getAttribute("transform")).toBeNull();
    expect(h.editor.undo()).toBe(true);
    expect(h.editor.serializeClean()).toBe(before);
    expect(h.editor.undo()).toBe(false);
  });

  it.each(["duplicate-id", "id-style", "encoded-reference"])("rejects unsafe structural input (%s) before inserting or deleting anything", (mode) => {
    const h = editorHarness();
    if (mode === "duplicate-id") h.group.querySelector("text")!.id = "waveform";
    if (mode === "id-style") {
      const style = h.root.ownerDocument.createElementNS(h.root.namespaceURI, "style");
      style.textContent = "#waveform { fill: red }"; h.root.append(style);
    }
    if (mode === "encoded-reference") h.group.querySelector("path")!.setAttribute("fill", "url(#%70aint)");
    const before = h.editor.serializeClean();
    expect(h.editor.applyBulkEdit({ kind: "duplicate" })).toMatchObject({ changed: false, error: expect.any(String) });
    if (mode === "encoded-reference") expect(h.editor.applyBulkEdit({ kind: "delete" })).toMatchObject({ changed: false, error: expect.stringContaining("encoded") });
    expect(h.editor.serializeClean()).toBe(before);
    expect(h.editor.undo()).toBe(false);
  });

  it.each(["delete", "duplicate"] as const)("normalizes selected ancestor/descendant %s into one target and one history step", (kind) => {
    const h = editorHarness();
    const path = h.root.querySelector("#waveform") as SVGGraphicsElement;
    const before = h.editor.serializeClean();
    expect(h.editor.applyBulkEdit({ kind }, [path, h.group, path])).toEqual({ changed: true });
    if (kind === "delete") expect(h.root.querySelectorAll("#logo, #waveform")).toHaveLength(0);
    else {
      expect(h.editor.selectedNodes).toHaveLength(1);
      expect(h.editor.selectedNode!.querySelectorAll("path")).toHaveLength(1);
      expect(h.root.querySelectorAll('path[id^="waveform"]')).toHaveLength(2);
    }
    expect(h.editor.undo()).toBe(true);
    expect(h.editor.serializeClean()).toBe(before);
    expect(h.editor.undo()).toBe(false);
    expect(h.editor.redo()).toBe(true);
    expect(h.editor.selectedNodes).toHaveLength(kind === "delete" ? 0 : 1);
  });

});
