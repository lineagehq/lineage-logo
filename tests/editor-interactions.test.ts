import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerWindow, SVG } from "@svgdotjs/svg.js";
import { History } from "../src/client/history/history";
import { cleanSvgsEqualForDirtyComparison, collectiveTransformAvailability, matrixRotationDegrees, rotationHandleRadii, serializeSvg, SvgEditor, translationAvailability, type SelectionContext } from "../src/client/canvas/editor";
import {
  CollectiveTransformGesture,
  collectiveRotationMatrix,
  collectiveScaleMatrix,
  composeCollectiveRootTransform,
  composeGroupDrag,
  composeGroupResize,
  composeGroupScale,
  composeRootTranslation,
  formatMatrix,
  GroupTransformGesture,
  relativeMatrix,
  SelectionTranslationGesture,
  transformVectorToLocal,
  type MatrixCoefficients,
} from "../src/client/canvas/transform";
import { DEFAULT_SELECTION_PREFERENCES } from "../src/client/selection-preferences";

const IDENTITY: MatrixCoefficients = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

const CONTROL_TAGS = {
  alignBottomButton: "button", alignCenterButton: "button", alignLeftButton: "button",
  alignmentReason: "div", alignMiddleButton: "button", alignRightButton: "button",
  alignTopButton: "button", groupButton: "button", hierarchyReason: "div", lockButton: "button",
  name: "input", nameClearButton: "button", reorderEarlierButton: "button", reorderLaterButton: "button",
  deleteButton: "button", duplicateButton: "button", fill: "input", fillError: "div",
  fillPicker: "input", fillState: "div", hideButton: "button", opacity: "input",
  positionX: "input", positionY: "input", rotation: "input", scale: "input",
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
  editor.load(root);
  const group = root.querySelector("#logo") as unknown as SVGGraphicsElement;
  editor.selectNode(group);
  return { controls, editor, group, root, statuses, window };
}

function touchEvent(window: Window, type: string, x: number, y: number): unknown {
  const event = new window.Event(type, { bubbles: true, cancelable: true }) as unknown as Event & {
    changedTouches: Array<{ clientX: number; clientY: number }>;
    touches: Array<{ clientX: number; clientY: number }>;
  };
  Object.defineProperties(event, {
    changedTouches: { value: [{ clientX: x, clientY: y }] },
    touches: { value: type === "touchend" || type === "touchcancel" ? [] : [{ clientX: x, clientY: y }] },
  });
  return event;
}

function mouseEvent(window: Window, type: string, x: number, y: number): unknown {
  const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, buttons: type === "mouseup" ? 0 : 1, clientX: x, clientY: y });
  Object.defineProperty(event, "which", { value: 1 });
  return event;
}

function setScreenMatrix(node: SVGElement, matrix: MatrixCoefficients | (() => MatrixCoefficients)): void {
  Object.defineProperty(node, "getScreenCTM", {
    configurable: true,
    value: () => ({ ...(typeof matrix === "function" ? matrix() : matrix) }),
  });
}

function dispatch(target: unknown, event: unknown): void {
  (target as { dispatchEvent: (candidate: never) => boolean }).dispatchEvent(event as never);
}

interface TestDragHandler {
  drag: (candidate: never) => void;
  endDrag: (candidate: never) => void;
  startDrag: (candidate: never) => void;
}

interface TestResizeHandler {
  eventType: string;
  handleResize: (candidate: never) => void;
  lastEvent: unknown;
}

function startDrag(group: SVGGraphicsElement, event: unknown): TestDragHandler {
  const handler = SVG(group).remember("_draggable") as TestDragHandler;
  handler.startDrag(event as never);
  return handler;
}

function startResize(
  group: SVGGraphicsElement,
  window: Window,
  type: "rb" | "rot",
  event: unknown,
): TestResizeHandler {
  const handler = SVG(group).remember("_ResizeHandler") as TestResizeHandler;
  handler.handleResize(new window.CustomEvent(type, {
    detail: {
      event,
      index: 0,
      points: [[0, 0], [20, 0], [20, 20], [0, 20]],
    },
  }) as never);
  return handler;
}

function selectNestedMulti(editor: SvgEditor): SVGGraphicsElement {
  editor.selectNode(editor.svgNode?.querySelector("#logo") as SVGGraphicsElement);
  editor.editInside();
  const wordmark = editor.svgNode?.querySelector("#wordmark") as SVGGraphicsElement;
  const icon = editor.svgNode?.querySelector("#icon") as SVGGraphicsElement;
  editor.selectNode(wordmark);
  editor.selectNode(icon, true);
  return icon;
}

function selectCrossParentMulti(editor: SvgEditor): { primary: SVGGraphicsElement; secondary: SVGGraphicsElement } {
  const root = editor.svgNode as SVGSVGElement;
  const logo = root.querySelector("#logo") as unknown as SVGGraphicsElement;
  const icon = root.querySelector("#icon") as unknown as SVGGraphicsElement;
  const secondary = root.querySelector("#waveform") as unknown as SVGGraphicsElement;
  const primary = root.querySelector("#wordmark") as unknown as SVGGraphicsElement;
  setScreenMatrix(root, IDENTITY);
  setScreenMatrix(logo, { ...IDENTITY, e: 4, f: 5 });
  setScreenMatrix(icon, { a: 2, b: 0, c: 0, d: 2, e: 4, f: 5 });
  editor.applyAgentSelection({
    targetSessionKeys: [secondary.dataset.lineageKey!, primary.dataset.lineageKey!],
    primarySessionKey: primary.dataset.lineageKey,
  });
  return { primary, secondary };
}

function editorContext(editor: SvgEditor): {
  primary: string | undefined;
  scope: string | undefined;
  selected: string[];
} {
  return {
    primary: editor.selectionContext.selected?.id,
    scope: editor.selectionContext.activeScope?.id,
    selected: editor.selectionContext.selectedNodes.map((node) => node.id),
  };
}

function fidelitySnapshot(editor: SvgEditor): {
  descendants: string;
  references: string[];
} {
  const root = editor.svgNode as SVGSVGElement;
  return {
    descendants: (root.querySelector("#icon") as SVGGraphicsElement).innerHTML,
    references: [
      root.querySelector("#waveform")?.getAttribute("fill") ?? "",
      root.querySelector("#paint")?.outerHTML ?? "",
    ],
  };
}

afterEach(() => {
  registerWindow(null, null);
  vi.unstubAllGlobals();
});

function nestedDocument(): { group: SVGGraphicsElement; root: SVGSVGElement; window: Window } {
  const window = new Window();
  window.document.body.innerHTML = `<svg viewBox="0 0 100 100">
    <defs>
      <linearGradient id="paint"><stop offset="0" stop-color="#fff"></stop></linearGradient>
      <clipPath id="clip"><path d="M0 0h20v20z"></path></clipPath>
      <mask id="mask"><rect width="20" height="20"></rect></mask>
      <symbol id="glyph"><path d="M0 0h2v2z"></path></symbol>
    </defs>
    <g id="logo" transform="translate(4 5)" clip-path="url(#clip)" mask="url(#mask)" data-unsupported="preserve">
      <g id="icon" transform="rotate(8 10 10)" aria-label="Nested icon">
        <path id="waveform" d="M0 10h20" fill="url(#paint)" vector-effect="non-scaling-stroke"></path>
        <use id="glyph-use" href="#glyph"></use>
      </g>
      <text id="wordmark" data-font-source="unknown">BleepThat</text>
    </g>
  </svg>`;
  return {
    group: window.document.querySelector("#logo") as unknown as SVGGraphicsElement,
    root: window.document.querySelector("svg") as unknown as SVGSVGElement,
    window,
  };
}

describe("deterministic grouped transform composition", () => {
  it("converts one root-space delta into scaled, rotated, and skewed parent spaces", () => {
    expect(transformVectorToLocal({ a: 2, b: 0, c: 0, d: 4, e: 50, f: 60 }, 10, 8)).toEqual({ dx: 5, dy: 2 });
    expect(transformVectorToLocal({ a: 0, b: 1, c: -1, d: 0, e: 50, f: 60 }, 10, 8)).toEqual({ dx: 8, dy: -10 });
    expect(composeRootTranslation(
      { ...IDENTITY, e: 3, f: 4 },
      { a: 2, b: 0, c: 0, d: 4, e: 50, f: 60 },
      10,
      8,
    )).toEqual({ ...IDENTITY, e: 8, f: 6 });
  });

  it("derives parent-to-root coordinates without leaking artboard zoom or screen translation", () => {
    expect(relativeMatrix(
      { a: 2, b: 0, c: 0, d: 2, e: 100, f: 80 },
      { a: 4, b: 0, c: 0, d: 6, e: 140, f: 100 },
    )).toEqual({ a: 2, b: 0, c: 0, d: 3, e: 20, f: 10 });
  });

  it("moves every translation target atomically and restores exact source syntax on cancel or no-op", () => {
    const window = new Window();
    window.document.body.innerHTML = '<svg><g id="scaled"><path id="a" transform="translate(3 4)"/></g><g id="plain"><path id="b"/></g></svg>';
    const first = window.document.querySelector("#a") as unknown as SVGGraphicsElement;
    const second = window.document.querySelector("#b") as unknown as SVGGraphicsElement;
    const before = window.document.querySelector("svg")?.innerHTML;
    const gesture = new SelectionTranslationGesture([
      { element: first, initial: { ...IDENTITY, e: 3, f: 4 }, parentToRoot: { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 } },
      { element: second, initial: IDENTITY, parentToRoot: IDENTITY },
    ]);
    expect(gesture.move(10, -6)).toBe(true);
    expect(first.getAttribute("transform")).toBe("matrix(1,0,0,1,8,1)");
    expect(second.getAttribute("transform")).toBe("matrix(1,0,0,1,10,-6)");
    gesture.cancel();
    expect(window.document.querySelector("svg")?.innerHTML).toBe(before);

    const noOp = new SelectionTranslationGesture([
      { element: first, initial: { ...IDENTITY, e: 3, f: 4 }, parentToRoot: IDENTITY },
      { element: second, initial: IDENTITY, parentToRoot: IDENTITY },
    ]);
    noOp.move(0, 0);
    expect(noOp.complete()).toBe(false);
    expect(window.document.querySelector("svg")?.innerHTML).toBe(before);
  });

  it("applies one immutable root transform through independent parent spaces and restores exact syntax", () => {
    const window = new Window();
    window.document.body.innerHTML = '<svg><g><path id="a" transform="translate(3 4)"/></g><g><path id="b"/></g></svg>';
    const first = window.document.querySelector("#a") as unknown as SVGGraphicsElement;
    const second = window.document.querySelector("#b") as unknown as SVGGraphicsElement;
    const before = window.document.querySelector("svg")?.innerHTML;
    const scale = collectiveScaleMatrix(20, 20, 1.5);
    expect(formatMatrix(composeCollectiveRootTransform(IDENTITY, { a: 2, b: 0, c: 0, d: 2, e: 4, f: 5 }, scale)))
      .toBe("matrix(1.5,0,0,1.5,-4,-3.75)");
    const gesture = new CollectiveTransformGesture([
      { element: first, initial: { ...IDENTITY, e: 3, f: 4 }, parentToRoot: { a: 2, b: 0, c: 0, d: 2, e: 4, f: 5 } },
      { element: second, initial: IDENTITY, parentToRoot: IDENTITY },
    ]);
    expect(gesture.apply(scale)).toBe(true);
    expect(first.getAttribute("transform")).toBe("matrix(1.5,0,0,1.5,0.5,2.25)");
    expect(second.getAttribute("transform")).toBe("matrix(1.5,0,0,1.5,-10,-10)");
    gesture.cancel();
    expect(window.document.querySelector("svg")?.innerHTML).toBe(before);
    expect(formatMatrix(collectiveRotationMatrix(10, 10, 90))).toBe("matrix(0,1,-1,0,20,0)");
  });

  it("rejects singular and non-finite collective coordinate spaces before mutation", () => {
    expect(() => transformVectorToLocal({ a: 1, b: 0, c: 2, d: 0, e: 0, f: 0 }, 1, 1)).toThrow(/singular/);
    expect(() => composeRootTranslation(IDENTITY, IDENTITY, Number.POSITIVE_INFINITY, 0)).toThrow(/non-finite/);
    expect(transformVectorToLocal({ a: 0.0009, b: 0, c: 0, d: 0.0009, e: 0, f: 0 }, 1, 1)).toEqual({
      dx: 1111.111111,
      dy: 1111.111111,
    });
    expect(() => new SelectionTranslationGesture([
      { element: new Window().document.createElementNS("http://www.w3.org/2000/svg", "path") as unknown as SVGGraphicsElement, initial: IDENTITY, parentToRoot: { a: 10_000_000, b: 0, c: 0, d: 10_000_000, e: 0, f: 0 } },
    ])).toThrow(/translation precision/);
  });

  it("rounds a drag to a bounded plain-decimal root matrix", () => {
    expect(formatMatrix(composeGroupDrag(
      { ...IDENTITY, e: 4, f: 5 },
      2.123456789,
      -5.0000001,
    ))).toBe("matrix(1,0,0,1,6.123457,0)");
  });

  it.each([
    ["scaled", { a: 2, b: 0, c: 0, d: 3, e: 4, f: 5 }, "matrix(2,0,0,3,18,14)"],
    ["rotated", { a: 0, b: 1, c: -1, d: 0, e: 4, f: 5 }, "matrix(0,1,-1,0,1,12)"],
    ["skewed", { a: 1, b: 0.25, c: 0.5, d: 1, e: 4, f: 5 }, "matrix(1,0.25,0.5,1,12.5,9.75)"],
  ] as const)("composes a %s group's local pointer delta after its existing root matrix", (_label, initial, expected) => {
    expect(formatMatrix(composeGroupDrag(initial, 7, 3))).toBe(expected);
  });

  it("maps resize bounds once through the original root matrix", () => {
    expect(formatMatrix(composeGroupResize(
      { ...IDENTITY, e: 4, f: 5 },
      { x: 0, y: 0, width: 10, height: 20 },
      { x: 5, y: 6, width: 15, height: 30 },
    ))).toBe("matrix(1.5,0,0,1.5,9,11)");
  });

  it("composes a transformed nested root resize in group-local coordinates", () => {
    expect(formatMatrix(composeGroupResize(
      { a: 1, b: 0.25, c: 0.5, d: 1, e: 4, f: 5 },
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 5, y: 2, width: 30, height: 30 },
    ))).toBe("matrix(1.5,0.375,0.75,1.5,10,8.25)");
  });

  it.each([
    ["translated", { ...IDENTITY, e: 4, f: 5 }, "matrix(1.1,0,0,1.1,3,4)"],
    ["scaled", { a: 2, b: 0, c: 0, d: 3, e: 4, f: 5 }, "matrix(2.2,0,0,3.3,2,2)"],
    ["rotated", { a: 0, b: 1, c: -1, d: 0, e: 4, f: 5 }, "matrix(0,1.1,-1.1,0,5,4)"],
    ["skewed", { a: 1, b: 0.25, c: 0.5, d: 1, e: 4, f: 5 }, "matrix(1.1,0.275,0.55,1.1,2.5,3.75)"],
  ] as const)("composes a bounded 110%% scale on a %s group root", (_label, initial, expected) => {
    expect(formatMatrix(composeGroupScale(
      initial,
      { x: 0, y: 0, width: 20, height: 20 },
      1.1,
    ))).toBe(expected);
  });

  it("rejects non-finite, degenerate, and coefficient-growing input", () => {
    expect(() => composeGroupDrag(IDENTITY, Number.POSITIVE_INFINITY, 0)).toThrow(/non-finite/);
    expect(() => composeGroupDrag(IDENTITY, 1e20, 0)).toThrow(/numeric range/);
    expect(() => composeGroupResize(
      IDENTITY,
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 0, y: 0, width: 0, height: 10 },
    )).toThrow(/finite, non-zero/);
    expect(() => composeGroupScale(IDENTITY, { x: 0, y: 0, width: 10, height: 10 }, 1e20)).toThrow(/scale range/);
    expect(() => composeGroupScale(IDENTITY, { x: 0, y: 0, width: 10, height: 10 }, 1e-8)).toThrow(/scale range/);
    expect(() => composeGroupResize(
      IDENTITY,
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 0, y: 0, width: 1e-8, height: 10 },
    )).toThrow(/scale range/);
    expect(formatMatrix({ ...IDENTITY, b: -0, e: 0.00000001 })).toBe("matrix(1,0,0,1,0,0)");
    expect(formatMatrix({ ...IDENTITY, e: 0.000001 })).not.toMatch(/[eE][+-]?\d/);
  });
});

describe("rotation affordance", () => {
  it.each([
    [{ a: 1, b: 0 }, 0],
    [{ a: 0, b: 1 }, 90],
    [{ a: 0, b: -1 }, -90],
    [{ a: Math.SQRT1_2, b: Math.SQRT1_2 }, 45],
  ])("reports the visible matrix angle for %o", (matrix, expected) => {
    expect(matrixRotationDegrees(matrix)).toBe(expected);
  });

  it("uses a standard rotation icon with a prominent 30 pixel hit target", () => {
    expect(rotationHandleRadii(0.5)).toEqual({ hit: 30, knob: 18 });
    const { group, root } = editorHarness();
    expect(group.hasAttribute("data-lineage-rotation")).toBe(false);
    expect(root.querySelector(".lineage-rotation-knob")?.getAttribute("r")).toBe("9");
    expect(root.querySelector(".lineage-rotation-knob")?.getAttribute("stroke-width")).toBe("12");
    expect(root.querySelector(".lineage-rotation-icon")?.getAttribute("d")).toContain("a9 9");
    expect(root.querySelector(".svg_select_handle_rot")?.children).toHaveLength(3);
  });
});

describe("Geometry Scale % grouped commits", () => {
  it.each([
    ["translate(4 5)", "matrix(1.1,0,0,1.1,3,4)"],
    ["scale(2 3) translate(2 1.6666666667)", "matrix(2.2,0,0,3.3,2,2)"],
    ["matrix(0,1,-1,0,4,5)", "matrix(0,1.1,-1.1,0,5,4)"],
    ["matrix(1,0.25,0.5,1,4,5)", "matrix(1.1,0.275,0.55,1.1,2.5,3.75)"],
  ])("commits one bounded root-only checkpoint for nested group %s", (initialTransform, expected) => {
    const { controls, editor, group, window } = editorHarness();
    editor.selectNode(group);
    editor.editInside();
    const nested = editor.svgNode?.querySelector("#icon") as SVGGraphicsElement;
    nested.setAttribute("transform", initialTransform);
    editor.selectNode(nested);
    const before = editor.serializeClean();
    const context = editorContext(editor);
    const fidelity = fidelitySnapshot(editor);
    const descendants = nested.innerHTML;

    dispatch(controls.scale, new window.Event("focus"));
    controls.scale.value = "105";
    dispatch(controls.scale, new window.Event("input"));
    controls.scale.value = "110";
    dispatch(controls.scale, new window.Event("input"));
    dispatch(controls.scale, new window.Event("change"));

    expect(editor.selectedNode?.getAttribute("transform")).toBe(expected);
    expect(editor.selectedNode?.innerHTML).toBe(descendants);
    expect(editorContext(editor)).toEqual(context);
    expect(fidelitySnapshot(editor)).toEqual(fidelity);
    const after = editor.serializeClean();
    expect(after).not.toBe(before);
    expect(after).not.toMatch(/[eE][+-]?\d/);
    expect(after).not.toContain("-0");
    expect(editor.undo()).toBe(true);
    expect(editor.serializeClean()).toBe(before);
    expect(editorContext(editor)).toEqual(context);
    expect(editor.undo()).toBe(false);
    expect(editor.redo()).toBe(true);
    expect(editor.serializeClean()).toBe(after);
    expect(editorContext(editor)).toEqual(context);
    expect(editor.redo()).toBe(false);
  });

  it("preserves exact SVG, context, and history for invalid, normalized-equivalent, no-op, and Escape cancellation", () => {
    const { controls, editor, group, window } = editorHarness();
    editor.selectNode(group);
    editor.editInside();
    editor.selectNode(editor.svgNode?.querySelector("#icon") as SVGGraphicsElement);
    const before = editor.serializeClean();
    const context = editorContext(editor);

    for (const value of ["invalid", "0", "-1", "1e100", "100.0", "+1e2"]) {
      dispatch(controls.scale, new window.Event("focus"));
      controls.scale.value = value;
      dispatch(controls.scale, new window.Event("input"));
      dispatch(controls.scale, new window.Event("change"));
      expect(editor.serializeClean()).toBe(before);
      expect(editorContext(editor)).toEqual(context);
      expect(editor.undo()).toBe(false);
    }

    dispatch(controls.scale, new window.Event("focus"));
    controls.scale.value = "112.5";
    dispatch(controls.scale, new window.Event("input"));
    expect(editor.serializeClean()).not.toBe(before);
    dispatch(controls.scale, new window.KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    expect(editor.serializeClean()).toBe(before);
    expect(editorContext(editor)).toEqual(context);
    expect(editor.undo()).toBe(false);
    expect(group.isConnected).toBe(false);
  });
});

describe("multi-selection mutation boundaries", () => {
  it("nudges every selected cross-parent layer by the same root-space delta in one reversible checkpoint", () => {
    const { editor, window } = editorHarness();
    const { primary, secondary } = selectCrossParentMulti(editor);
    const before = editor.serializeClean();
    const context = editorContext(editor);

    dispatch(window.document, new window.KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight", shiftKey: true }));
    expect(secondary.getAttribute("transform")).toBe("matrix(1,0,0,1,5,0)");
    expect(primary.getAttribute("transform")).toBe("matrix(1,0,0,1,10,0)");
    expect(editorContext(editor)).toEqual(context);
    const after = editor.serializeClean();
    expect(after).not.toBe(before);
    expect(editor.undo()).toBe(true);
    expect(editor.serializeClean()).toBe(before);
    expect(editorContext(editor)).toEqual(context);
    expect(editor.undo()).toBe(false);
    expect(editor.redo()).toBe(true);
    expect(editor.serializeClean()).toBe(after);
    expect(editorContext(editor)).toEqual(context);
    expect(editor.redo()).toBe(false);
  });

  it("collectively drags cross-parent layers from any selected object and keeps cancellation and threshold paths clean", () => {
    const { editor, window } = editorHarness();
    let selection = selectCrossParentMulti(editor);
    const before = editor.serializeClean();
    const context = editorContext(editor);
    expect(SVG(selection.secondary).remember("_draggable")).toBeTruthy();
    expect(SVG(selection.primary).remember("_draggable")).toBeTruthy();
    let handler = startDrag(selection.secondary, mouseEvent(window, "mousedown", 5, 5));
    handler.drag(mouseEvent(window, "mousemove", 15, 11) as never);
    handler.endDrag(mouseEvent(window, "mouseup", 15, 11) as never);
    expect(selection.secondary.getAttribute("transform")).toBe("matrix(1,0,0,1,5,3)");
    expect(selection.primary.getAttribute("transform")).toBe("matrix(1,0,0,1,10,6)");
    expect(editorContext(editor)).toEqual(context);
    const after = editor.serializeClean();
    expect(editor.undo()).toBe(true);
    expect(editor.serializeClean()).toBe(before);
    expect(editorContext(editor)).toEqual(context);
    expect(editor.undo()).toBe(false);

    selection = selectCrossParentMulti(editor);
    handler = startDrag(selection.primary, mouseEvent(window, "mousedown", 5, 5));
    handler.drag(mouseEvent(window, "mousemove", 7, 5) as never);
    handler.endDrag(mouseEvent(window, "mouseup", 7, 5) as never);
    expect(editor.serializeClean()).toBe(before);
    expect(editor.undo()).toBe(false);

    selection = selectCrossParentMulti(editor);
    handler = startDrag(selection.primary, mouseEvent(window, "mousedown", 5, 5));
    handler.drag(mouseEvent(window, "mousemove", 15, 11) as never);
    dispatch(window.document, new window.KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    expect(editor.serializeClean()).toBe(before);
    expect(editorContext(editor)).toEqual(context);
    expect(editor.undo()).toBe(false);
    expect(after).not.toBe(before);
  });

  it("rejects a locked secondary or pending Agent boundary without partially moving the primary", () => {
    const { editor, statuses, window } = editorHarness();
    const secondary = editor.svgNode?.querySelector("#waveform") as SVGGraphicsElement;
    editor.selectNode(secondary);
    editor.toggleLock();
    const selection = selectCrossParentMulti(editor);
    const before = editor.serializeClean();
    const availability = translationAvailability(editor.selectedNodes, editor.svgNode!, (node) => editor.selectionContext.lockedKeys.has(node.dataset.lineageKey ?? ""));
    expect(availability.allowed).toBe(false);
    dispatch(window.document, new window.KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    expect(editor.serializeClean()).toBe(before);
    expect(statuses.at(-1)).toMatch(/Unlock every selected layer/);
    const handler = startDrag(selection.primary, mouseEvent(window, "mousedown", 5, 5));
    handler.drag(mouseEvent(window, "mousemove", 15, 5) as never);
    handler.endDrag(mouseEvent(window, "mouseup", 15, 5) as never);
    expect(editor.serializeClean()).toBe(before);
    expect(editor.undo()).toBe(false);

    editor.setAgentMutationBlocked(true);
    dispatch(window.document, new window.KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    expect(editor.serializeClean()).toBe(before);
    expect(statuses.at(-1)).toMatch(/pending Agent review/);
  });

  it("does not install a draggable source when the locked member is primary", () => {
    const { editor, window } = editorHarness();
    const primary = editor.svgNode?.querySelector("#wordmark") as SVGGraphicsElement;
    editor.selectNode(primary);
    editor.toggleLock();
    selectCrossParentMulti(editor);
    const before = editor.serializeClean();

    dispatch(primary, mouseEvent(window, "mousedown", 5, 5));
    dispatch(window, mouseEvent(window, "mousemove", 20, 12));
    dispatch(window, mouseEvent(window, "mouseup", 20, 12));

    expect(editor.serializeClean()).toBe(before);
    expect(editor.undo()).toBe(false);
  });

  it("rejects a disconnected selected layer without changing the editor document or history", () => {
    const { editor } = editorHarness();
    selectCrossParentMulti(editor);
    const root = editor.svgNode!;
    const disconnected = root.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path") as unknown as SVGGraphicsElement;
    disconnected.setAttribute("d", "M0 0h20v20z");
    const selected = [...editor.selectedNodes, disconnected];
    const before = editor.serializeClean();
    const context = editorContext(editor);

    expect(disconnected.isConnected).toBe(false);
    expect(translationAvailability(selected, root)).toEqual({
      allowed: false,
      reason: "Every selected layer must remain connected and editable before moving.",
    });
    expect(editor.serializeClean()).toBe(before);
    expect(editorContext(editor)).toEqual(context);
    expect(editor.undo()).toBe(false);
    expect(editor.redo()).toBe(false);
  });

  it("rejects computed-style-hidden layers and nested ancestor selections atomically", () => {
    let harness = editorHarness();
    const hidden = harness.editor.svgNode?.querySelector("#waveform") as SVGGraphicsElement;
    hidden.setAttribute("style", "display: none");
    const hiddenSelection = selectCrossParentMulti(harness.editor);
    const hiddenBefore = harness.editor.serializeClean();
    expect(hidden.getAttribute("display")).toBeNull();
    expect(translationAvailability(harness.editor.selectedNodes, harness.editor.svgNode!).reason).toMatch(/Show every selected layer/);
    dispatch(harness.window.document, new harness.window.KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    expect(harness.editor.serializeClean()).toBe(hiddenBefore);
    expect(harness.statuses.at(-1)).toMatch(/Show every selected layer/);
    expect(hiddenSelection.primary.getAttribute("transform")).toBeNull();
    expect(harness.editor.undo()).toBe(false);

    harness = editorHarness();
    const root = harness.editor.svgNode!;
    const ancestor = root.querySelector("#logo") as SVGGraphicsElement;
    const descendant = root.querySelector("#waveform") as SVGGraphicsElement;
    harness.editor.applyAgentSelection({
      targetSessionKeys: [ancestor.dataset.lineageKey!, descendant.dataset.lineageKey!],
      primarySessionKey: descendant.dataset.lineageKey,
    });
    const nestedBefore = harness.editor.serializeClean();
    expect(harness.editor.selectedNodes).toEqual([ancestor, descendant]);
    expect(translationAvailability(harness.editor.selectedNodes, root).reason).toMatch(/either a group or its nested layers/);
    dispatch(harness.window.document, new harness.window.KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    expect(harness.editor.serializeClean()).toBe(nestedBefore);
    expect(harness.statuses.at(-1)).toMatch(/either a group or its nested layers/);
    expect(harness.editor.undo()).toBe(false);
  });

  it("rejects inline and stylesheet-controlled transforms before any collective mutation", () => {
    for (const source of ["inline", "stylesheet"] as const) {
      const harness = editorHarness();
      const root = harness.editor.svgNode!;
      const controlled = root.querySelector("#waveform") as SVGGraphicsElement;
      if (source === "inline") controlled.style.transform = "translate(5px, 0px)";
      else {
        const style = root.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "style");
        style.textContent = "#waveform { transform: translate(5px, 0px); }";
        root.prepend(style);
      }
      selectCrossParentMulti(harness.editor);
      const before = harness.editor.serializeClean();
      expect(translationAvailability(harness.editor.selectedNodes, root).reason).toMatch(/Convert CSS transforms/);
      dispatch(harness.window.document, new harness.window.KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
      expect(harness.editor.serializeClean()).toBe(before);
      expect(harness.statuses.at(-1)).toMatch(/Convert CSS transforms/);
      expect(harness.editor.undo()).toBe(false);
    }
  });

  it("distributes cross-parent visual centers with fixed outer anchors in one reversible checkpoint", () => {
    const { controls, editor, root } = editorHarness();
    const top = root.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path") as unknown as SVGGraphicsElement;
    top.id = "top";
    top.setAttribute("d", "M0 0h20v20z");
    root.append(top);
    const logo = root.querySelector("#logo") as unknown as SVGGraphicsElement;
    const icon = root.querySelector("#icon") as unknown as SVGGraphicsElement;
    const waveform = root.querySelector("#waveform") as unknown as SVGGraphicsElement;
    const wordmark = root.querySelector("#wordmark") as unknown as SVGGraphicsElement;
    icon.setAttribute("transform", "scale(2)");
    wordmark.setAttribute("transform", "translate(36 -5)");
    top.setAttribute("transform", "translate(100 0)");
    editor.load(root);
    setScreenMatrix(root, IDENTITY);
    setScreenMatrix(logo, { ...IDENTITY, e: 4, f: 5 });
    setScreenMatrix(icon, { a: 2, b: 0, c: 0, d: 2, e: 4, f: 5 });
    setScreenMatrix(waveform, { a: 2, b: 0, c: 0, d: 2, e: 4, f: 5 });
    setScreenMatrix(wordmark, () => {
      const local = SVG(wordmark).matrixify();
      return { a: local.a, b: local.b, c: local.c, d: local.d, e: 4 + local.e, f: 5 + local.f };
    });
    setScreenMatrix(top, { ...IDENTITY, e: 100, f: 0 });
    editor.applyAgentSelection({
      targetSessionKeys: [waveform.dataset.lineageKey!, wordmark.dataset.lineageKey!, top.dataset.lineageKey!],
      primarySessionKey: top.dataset.lineageKey,
    });
    const before = editor.serializeClean();
    const context = editorContext(editor);
    expect(controls.distributeHorizontalButton.disabled).toBe(false);

    editor.distribute("horizontal-centers");
    expect(waveform.getAttribute("transform")).toBeNull();
    expect(wordmark.getAttribute("transform")).toBe("matrix(1,0,0,1,53,-5)");
    expect(top.getAttribute("transform")).toBe("translate(100 0)");
    expect(wordmark.getScreenCTM()!.e + 10).toBe(67);
    expect(editorContext(editor)).toEqual(context);
    const after = editor.serializeClean();
    expect(after).not.toBe(before);
    expect(editor.undo()).toBe(true);
    expect(editor.serializeClean()).toBe(before);
    expect(editorContext(editor)).toEqual(context);
    expect(editor.undo()).toBe(false);
    expect(editor.redo()).toBe(true);
    expect(editor.serializeClean()).toBe(after);
    expect(editorContext(editor)).toEqual(context);
    expect(editor.redo()).toBe(false);
  });

  it("does not checkpoint or announce success for a sub-precision distribution no-op", () => {
    const { editor, root, statuses } = editorHarness();
    const top = root.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path") as unknown as SVGGraphicsElement;
    top.id = "top";
    top.setAttribute("d", "M0 0h20v20z");
    root.append(top);
    const logo = root.querySelector("#logo") as SVGGraphicsElement;
    const icon = root.querySelector("#icon") as SVGGraphicsElement;
    const waveform = root.querySelector("#waveform") as SVGGraphicsElement;
    const wordmark = root.querySelector("#wordmark") as SVGGraphicsElement;
    logo.removeAttribute("transform");
    wordmark.setAttribute("transform", "translate(1.0000004 0)");
    top.setAttribute("transform", "translate(2 0)");
    editor.load(root);
    setScreenMatrix(root, IDENTITY);
    setScreenMatrix(logo, IDENTITY);
    setScreenMatrix(icon, IDENTITY);
    setScreenMatrix(waveform, IDENTITY);
    setScreenMatrix(wordmark, () => SVG(wordmark).matrixify());
    setScreenMatrix(top, () => SVG(top).matrixify());
    editor.applyAgentSelection({
      targetSessionKeys: [waveform.dataset.lineageKey!, wordmark.dataset.lineageKey!, top.dataset.lineageKey!],
      primarySessionKey: top.dataset.lineageKey,
    });
    const before = editor.serializeClean();

    editor.distribute("horizontal-centers");

    expect(editor.serializeClean()).toBe(before);
    expect(wordmark.getAttribute("transform")).toBe("translate(1.0000004 0)");
    expect(statuses.at(-1)).toBe("The selected centers are already distributed");
    expect(editor.undo()).toBe(false);
  });

  it("keeps destructive and duplicating primary-only shortcuts inert for a multi-selection", () => {
    const { editor, window } = editorHarness();
    selectNestedMulti(editor);
    const before = editor.serializeClean();
    const context = editorContext(editor);

    for (const event of [
      new window.KeyboardEvent("keydown", { bubbles: true, key: "Delete" }),
      new window.KeyboardEvent("keydown", { bubbles: true, key: "d", metaKey: true }),
    ]) dispatch(window.document, event);

    expect(editor.serializeClean()).toBe(before);
    expect(editorContext(editor)).toEqual(context);
  });
});

describe("group drag and resize interaction fidelity", () => {
  it("changes only the selected group root during drag and survives an exact clean reopen", () => {
    const { group, root } = nestedDocument();
    const descendantsBefore = Array.from(group.querySelectorAll("*")).map((node) => node.outerHTML);
    const rootChildrenBefore = Array.from(root.children).map((node) => node.id || node.localName);
    const gesture = new GroupTransformGesture(
      group,
      { ...IDENTITY, e: 4, f: 5 },
      { x: 0, y: 0, width: 20, height: 20 },
    );

    expect(gesture.drag(7.25, -3.5)).toBe(true);
    expect(gesture.complete()).toBe(true);
    expect(group.getAttribute("transform")).toBe("matrix(1,0,0,1,11.25,1.5)");
    expect(Array.from(group.querySelectorAll("*")).map((node) => node.outerHTML)).toEqual(descendantsBefore);
    expect(Array.from(root.children).map((node) => node.id || node.localName)).toEqual(rootChildrenBefore);

    const clean = serializeSvg(root, true);
    const reopened = new Window();
    reopened.document.body.innerHTML = clean;
    expect((reopened.document.querySelector("svg") as unknown as SVGSVGElement).outerHTML).toBe(clean);
    expect(reopened.document.querySelector("#icon > #waveform")?.getAttribute("fill")).toBe("url(#paint)");
    expect(reopened.document.querySelector("#glyph-use")?.getAttribute("href")).toBe("#glyph");
    expect(reopened.document.querySelector("#logo")?.getAttribute("clip-path")).toBe("url(#clip)");
    expect(reopened.document.querySelector("#logo")?.getAttribute("mask")).toBe("url(#mask)");
    expect(reopened.document.querySelector("#paint")).not.toBeNull();
  });

  it("composes resize only on the root without descendant or reference rewrites", () => {
    const { group, root } = nestedDocument();
    const descendantsBefore = group.innerHTML;
    const attributesBefore = Array.from(group.attributes)
      .filter((attribute) => attribute.name !== "transform")
      .map((attribute) => [attribute.name, attribute.value]);
    const gesture = new GroupTransformGesture(
      group,
      { ...IDENTITY, e: 4, f: 5 },
      { x: 0, y: 0, width: 20, height: 20 },
    );

    expect(gesture.resize({ x: 0, y: 0, width: 32, height: 32 })).toBe(true);
    expect(gesture.complete()).toBe(true);
    expect(group.getAttribute("transform")).toBe("matrix(1.6,0,0,1.6,4,5)");
    expect(group.innerHTML).toBe(descendantsBefore);
    expect(Array.from(group.attributes)
      .filter((attribute) => attribute.name !== "transform")
      .map((attribute) => [attribute.name, attribute.value])).toEqual(attributesBefore);
    expect(root.querySelector("#logo > #icon > #glyph-use")).not.toBeNull();
  });

  it("restores exact source syntax for cancellation and rounded no-op gestures", () => {
    const { group } = nestedDocument();
    const before = group.outerHTML;
    const canceled = new GroupTransformGesture(
      group,
      { ...IDENTITY, e: 4, f: 5 },
      { x: 0, y: 0, width: 20, height: 20 },
    );
    canceled.drag(4, 2);
    canceled.cancel();
    expect(group.outerHTML).toBe(before);

    const noOp = new GroupTransformGesture(
      group,
      { ...IDENTITY, e: 4, f: 5 },
      { x: 0, y: 0, width: 20, height: 20 },
    );
    expect(noOp.drag(0.00000001, -0.00000001)).toBe(false);
    expect(noOp.complete()).toBe(false);
    expect(group.outerHTML).toBe(before);
  });

  it("creates one exact reversible checkpoint per completed gesture with stable selection", () => {
    const { group, root } = nestedDocument();
    const history = new History();
    const selection = { primary: "logo", scope: "root" };
    const snapshot = () => JSON.stringify({ markup: serializeSvg(root, true), selection });
    const before = snapshot();
    const gesture = new GroupTransformGesture(
      group,
      { ...IDENTITY, e: 4, f: 5 },
      { x: 0, y: 0, width: 20, height: 20 },
    );
    gesture.drag(8, 3);
    gesture.drag(12, 6);
    if (gesture.complete()) history.checkpoint(before);
    const after = snapshot();

    expect(history.checkpointCount).toBe(1);
    expect(JSON.parse(after).selection).toEqual(selection);
    expect(history.undo(after)).toBe(before);
    expect(history.redo(before)).toBe(after);

    const canceled = new GroupTransformGesture(
      group,
      { ...IDENTITY, e: 16, f: 11 },
      { x: 0, y: 0, width: 20, height: 20 },
    );
    canceled.drag(1, 1);
    canceled.cancel();
    expect(history.checkpointCount).toBe(1);
  });
});

describe("SvgEditor plugin cancellation teardown", () => {
  it("uses DragHandler.startDrag for Escape cancellation and a real immediate mouse successor", () => {
    const { editor, statuses, window } = editorHarness();
    const group = selectNestedMulti(editor);
    const before = editor.serializeClean();
    const context = editorContext(editor);
    const fidelity = fidelitySnapshot(editor);

    startDrag(group, mouseEvent(window, "mousedown", 5, 5));
    dispatch(window, mouseEvent(window, "mousemove", 12, 9));
    expect(editor.serializeClean()).not.toBe(before);
    dispatch(window.document, new window.KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));

    expect(editor.serializeClean()).toBe(before);
    expect(editorContext(editor)).toEqual(context);
    expect(fidelitySnapshot(editor)).toEqual(fidelity);
    expect(editor.undo()).toBe(false);
    dispatch(window, mouseEvent(window, "mousemove", 40, 40));
    dispatch(window, mouseEvent(window, "mouseup", 40, 40));
    expect(editor.serializeClean()).toBe(before);
    expect(editorContext(editor)).toEqual(context);

    startDrag(editor.selectedNode as SVGGraphicsElement, mouseEvent(window, "mousedown", 5, 5));
    dispatch(window, mouseEvent(window, "mousemove", 15, 11));
    dispatch(window, mouseEvent(window, "mouseup", 15, 11));
    const after = editor.serializeClean();
    expect(after).not.toBe(before);
    expect(editorContext(editor)).toEqual(context);
    expect(fidelitySnapshot(editor)).toEqual(fidelity);
    expect(editor.undo()).toBe(true);
    expect(editor.serializeClean()).toBe(before);
    expect(editorContext(editor)).toEqual(context);
    expect(editor.undo()).toBe(false);
    expect(editor.redo()).toBe(true);
    expect(editor.serializeClean()).toBe(after);
    expect(editor.redo()).toBe(false);
    expect(statuses).toEqual(["Undid the last correction", "Redid the correction"]);
  });

  it("uses DragHandler.startDrag for touchcancel and a real immediate touch successor", async () => {
    const { editor, window } = editorHarness();
    const group = selectNestedMulti(editor);
    const before = editor.serializeClean();
    const context = editorContext(editor);
    const fidelity = fidelitySnapshot(editor);

    startDrag(group, touchEvent(window, "touchstart", 2, 2));
    dispatch(window, touchEvent(window, "touchmove", 7, 5));
    dispatch(window, touchEvent(window, "touchcancel", 7, 5));
    await Promise.resolve();
    expect(editor.serializeClean()).toBe(before);
    expect(editorContext(editor)).toEqual(context);
    expect(editor.undo()).toBe(false);
    dispatch(window, touchEvent(window, "touchmove", 30, 30));
    dispatch(window, touchEvent(window, "touchend", 30, 30));
    expect(editor.serializeClean()).toBe(before);

    startDrag(editor.selectedNode as SVGGraphicsElement, touchEvent(window, "touchstart", 2, 2));
    dispatch(window, touchEvent(window, "touchmove", 8, 6));
    dispatch(window, touchEvent(window, "touchend", 8, 6));
    const after = editor.serializeClean();
    expect(after).not.toBe(before);
    expect(editorContext(editor)).toEqual(context);
    expect(fidelitySnapshot(editor)).toEqual(fidelity);
    expect(editor.undo()).toBe(true);
    expect(editor.serializeClean()).toBe(before);
    expect(editor.undo()).toBe(false);
    expect(editor.redo()).toBe(true);
    expect(editor.serializeClean()).toBe(after);
  });

  it("cancels and commits shared-overlay resize through public pointer events", async () => {
    const { editor, root, window } = editorHarness();
    selectNestedMulti(editor);
    const before = editor.serializeClean();
    const context = editorContext(editor);
    const fidelity = fidelitySnapshot(editor);

    expect(collectiveTransformAvailability(editor.selectedNodes, root).allowed).toBe(true);
    let handle = root.querySelector('[data-lineage-collective-handle="rb"]') as SVGElement;
    dispatch(handle, new window.PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 20, clientY: 20, pointerId: 71 }));
    dispatch(window, new window.PointerEvent("pointermove", { bubbles: true, clientX: 28, clientY: 28, pointerId: 71 }));
    const preview = editor.serializeClean();
    dispatch(window, new window.PointerEvent("pointercancel", { bubbles: true, pointerId: 700 }));
    await Promise.resolve();
    expect(editor.serializeClean()).toBe(preview);
    dispatch(window, new window.PointerEvent("pointercancel", { bubbles: true, pointerId: 71 }));
    await Promise.resolve();
    expect(editor.serializeClean()).toBe(before);
    expect(editorContext(editor)).toEqual(context);
    expect(editor.undo()).toBe(false);

    handle = editor.svgNode?.querySelector('[data-lineage-collective-handle="rb"]') as SVGElement;
    dispatch(handle, new window.PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 20, clientY: 20, pointerId: 72 }));
    dispatch(window, new window.PointerEvent("pointermove", { bubbles: true, clientX: 30, clientY: 30, pointerId: 72 }));
    dispatch(window, new window.PointerEvent("pointerup", { bubbles: true, clientX: 30, clientY: 30, pointerId: 72 }));
    await Promise.resolve();
    const after = editor.serializeClean();
    expect(after).not.toBe(before);
    expect(editorContext(editor)).toEqual(context);
    expect(fidelitySnapshot(editor)).toEqual(fidelity);
    expect(editor.undo()).toBe(true);
    expect(editor.serializeClean()).toBe(before);
    expect(editor.undo()).toBe(false);
    expect(editor.redo()).toBe(true);
    expect(editor.serializeClean()).toBe(after);
  });

  it("cancels and commits shared-overlay rotation around the frozen union center", async () => {
    const { editor, root, statuses, window } = editorHarness();
    selectNestedMulti(editor);
    editor.selectedNodes.forEach((node) => node.setAttribute("data-lineage-rotation", "15"));
    const before = editor.serializeClean();
    const context = editorContext(editor);
    const fidelity = fidelitySnapshot(editor);

    let handle = root.querySelector('[data-lineage-collective-handle="rotation"]') as SVGElement;
    dispatch(handle, new window.PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: -20, pointerId: 73 }));
    dispatch(window, new window.PointerEvent("pointermove", { bubbles: true, clientX: 40, clientY: 10, pointerId: 73 }));
    dispatch(window, new window.PointerEvent("pointercancel", { bubbles: true, pointerId: 73 }));
    await Promise.resolve();
    expect(editor.serializeClean()).toBe(before);
    expect(editorContext(editor)).toEqual(context);
    expect(editor.undo()).toBe(false);

    handle = editor.svgNode?.querySelector('[data-lineage-collective-handle="rotation"]') as SVGElement;
    dispatch(handle, new window.PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: -20, pointerId: 74 }));
    dispatch(window, new window.PointerEvent("pointermove", { bubbles: true, clientX: 40, clientY: 10, pointerId: 74 }));
    expect(statuses.at(-1)).toMatch(/^Rotation -?\d+° for 2 selected layers$/);
    dispatch(window, new window.PointerEvent("pointerup", { bubbles: true, clientX: 40, clientY: 10, pointerId: 74 }));
    await Promise.resolve();
    const after = editor.serializeClean();
    expect(after).not.toBe(before);
    expect(editor.selectedNodes.every((node) => !node.hasAttribute("data-lineage-rotation"))).toBe(true);
    expect(editorContext(editor)).toEqual(context);
    expect(fidelitySnapshot(editor)).toEqual(fidelity);
    expect(editor.undo()).toBe(true);
    expect(editor.serializeClean()).toBe(before);
    expect(editor.selectedNodes.every((node) => node.getAttribute("data-lineage-rotation") === "15")).toBe(true);
    expect(editor.undo()).toBe(false);
    expect(editor.redo()).toBe(true);
    expect(editor.serializeClean()).toBe(after);
    expect(editor.selectedNodes.every((node) => !node.hasAttribute("data-lineage-rotation"))).toBe(true);
  });

  it("cancels an active collective gesture before applying Undo", async () => {
    const { editor, root, window } = editorHarness();
    selectNestedMulti(editor);
    const baseline = editor.serializeClean();
    dispatch(window.document, new window.KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    const priorEdit = editor.serializeClean();
    expect(priorEdit).not.toBe(baseline);

    const handle = root.querySelector('[data-lineage-collective-handle="rb"]') as SVGElement;
    dispatch(handle, new window.PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 20, clientY: 20, pointerId: 75 }));
    dispatch(window, new window.PointerEvent("pointermove", { bubbles: true, clientX: 34, clientY: 34, pointerId: 75 }));
    dispatch(window.document, new window.KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "z" }));
    dispatch(window, new window.PointerEvent("pointerup", { bubbles: true, clientX: 34, clientY: 34, pointerId: 75 }));
    await Promise.resolve();

    expect(editor.serializeClean()).toBe(baseline);
    expect(editor.undo()).toBe(false);
    expect(editor.redo()).toBe(true);
    expect(editor.serializeClean()).toBe(priorEdit);
  });

  it("activates focusable collective controls with Enter and Space", () => {
    const { editor, root, window } = editorHarness();
    selectNestedMulti(editor);
    editor.selectedNodes.forEach((node) => node.setAttribute("data-lineage-scale", "125"));
    const before = editor.serializeClean();
    const resize = root.querySelector('[data-lineage-collective-handle="rb"]') as SVGElement;
    dispatch(resize, new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }));
    const resized = editor.serializeClean();
    expect(resized).not.toBe(before);
    expect(editor.selectedNodes.every((node) => !node.hasAttribute("data-lineage-scale"))).toBe(true);
    expect(editor.undo()).toBe(true);
    expect(editor.serializeClean()).toBe(before);

    const rotation = editor.svgNode?.querySelector('[data-lineage-collective-handle="rotation"]') as SVGElement;
    dispatch(rotation, new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: " ", shiftKey: true }));
    expect(editor.serializeClean()).not.toBe(before);
    expect(editor.undo()).toBe(true);
    expect(editor.serializeClean()).toBe(before);
  });

  it("immediately cleans up a collective session when fresh pointerdown preflight fails", () => {
    const { editor, root, statuses, window } = editorHarness();
    selectNestedMulti(editor);
    const context = editorContext(editor);
    const primary = editor.selectedNode!;
    const handle = root.querySelector('[data-lineage-collective-handle="rb"]') as SVGElement;
    primary.setAttribute("display", "none");
    const before = editor.serializeClean();
    dispatch(handle, new window.PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 20, clientY: 20, pointerId: 77 }));
    expect(editor.serializeClean()).toBe(before);
    expect(editorContext(editor)).toEqual(context);
    expect(statuses.at(-1)).toMatch(/Show every selected layer/);
    expect(editor.undo()).toBe(false);
    dispatch(window, new window.PointerEvent("pointerup", { bubbles: true, clientX: 40, clientY: 40, pointerId: 77 }));
    expect(editor.serializeClean()).toBe(before);
  });

  it.each(["hidden", "disconnected", "overlap", "css", "geometry"] as const)(
    "revalidates a %s terminal gate after the last collective move and restores exact selection bytes",
    (gate) => {
      const { editor, root, window } = editorHarness();
      selectNestedMulti(editor);
      const before = editor.serializeClean();
      const context = editorContext(editor);
      const selected = [...editor.selectedNodes];
      const handle = root.querySelector('[data-lineage-collective-handle="rb"]') as SVGElement;
      dispatch(handle, new window.PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 20, clientY: 20, pointerId: 78 }));
      dispatch(window, new window.PointerEvent("pointermove", { bubbles: true, clientX: 32, clientY: 32, pointerId: 78 }));
      if (gate === "hidden") selected[0].setAttribute("visibility", "hidden");
      else if (gate === "disconnected") selected[0].remove();
      else if (gate === "overlap") selected[1].append(selected[0]);
      else if (gate === "css") selected[0].style.transform = "translateX(1px)";
      else setScreenMatrix(root, { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 });
      dispatch(window, new window.PointerEvent("pointerup", { bubbles: true, clientX: 32, clientY: 32, pointerId: 78 }));
      expect(editor.serializeClean()).toBe(before);
      expect(editorContext(editor)).toEqual(context);
      expect(editor.undo()).toBe(false);
      expect(root.querySelector("[data-lineage-collective-transform]") ?? editor.svgNode?.querySelector("[data-lineage-collective-transform]")).toBeTruthy();
    },
  );

  it("restores rounded identity, Escape, and lost-capture collective paths with zero history", () => {
    const { editor, root, window } = editorHarness();
    selectNestedMulti(editor);
    const before = editor.serializeClean();
    const context = editorContext(editor);
    let handle = root.querySelector('[data-lineage-collective-handle="rb"]') as SVGElement;
    dispatch(handle, new window.PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 20, clientY: 20, pointerId: 79 }));
    dispatch(window, new window.PointerEvent("pointermove", { bubbles: true, clientX: 30, clientY: 30, pointerId: 79 }));
    dispatch(window, new window.PointerEvent("pointermove", { bubbles: true, clientX: 20, clientY: 20, pointerId: 79 }));
    dispatch(window, new window.PointerEvent("pointerup", { bubbles: true, clientX: 20, clientY: 20, pointerId: 79 }));
    expect(editor.serializeClean()).toBe(before);

    handle = editor.svgNode?.querySelector('[data-lineage-collective-handle="rb"]') as SVGElement;
    dispatch(handle, new window.PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 20, clientY: 20, pointerId: 80 }));
    dispatch(window, new window.PointerEvent("pointermove", { bubbles: true, clientX: 30, clientY: 30, pointerId: 80 }));
    dispatch(window.document, new window.KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    expect(editor.serializeClean()).toBe(before);

    handle = editor.svgNode?.querySelector('[data-lineage-collective-handle="rb"]') as SVGElement;
    dispatch(handle, new window.PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 20, clientY: 20, pointerId: 81 }));
    dispatch(window, new window.PointerEvent("pointermove", { bubbles: true, clientX: 30, clientY: 30, pointerId: 81 }));
    dispatch(handle, new window.PointerEvent("lostpointercapture", { bubbles: true, pointerId: 81 }));
    expect(editor.serializeClean()).toBe(before);
    expect(editorContext(editor)).toEqual(context);
    expect(editor.undo()).toBe(false);
  });

  it("keeps resource-backed selectable leaves eligible for editor-owned collective controls", () => {
    const { editor, root } = editorHarness();
    const { secondary } = selectCrossParentMulti(editor);
    expect(secondary.getAttribute("fill")).toBe("url(#paint)");
    expect(collectiveTransformAvailability(editor.selectedNodes, root).allowed).toBe(true);
    expect(root.querySelectorAll("[data-lineage-collective-handle]")).toHaveLength(9);
    expect(SVG(secondary).remember("_ResizeHandler")).toBeUndefined();
  });

  it("terminates a real drag session before load and ignores its late plugin events", () => {
    const { editor, root, window } = editorHarness();
    const group = selectNestedMulti(editor);
    const replacement = root.cloneNode(true) as SVGSVGElement;
    replacement.setAttribute("data-loaded", "replacement");
    root.parentElement?.replaceChildren(replacement);

    startDrag(group, mouseEvent(window, "mousedown", 5, 5));
    dispatch(window, mouseEvent(window, "mousemove", 12, 9));
    editor.load(replacement);
    const loaded = editor.serializeClean();
    expect(editor.svgNode?.getAttribute("data-loaded")).toBe("replacement");
    expect(editor.undo()).toBe(false);
    dispatch(window, mouseEvent(window, "mousemove", 70, 70));
    dispatch(window, mouseEvent(window, "mouseup", 70, 70));
    expect(editor.serializeClean()).toBe(loaded);

    const successor = editor.svgNode?.querySelector("#logo") as SVGGraphicsElement;
    editor.selectNode(successor);
    startDrag(successor, mouseEvent(window, "mousedown", 5, 5));
    dispatch(window, mouseEvent(window, "mousemove", 10, 8));
    dispatch(window, mouseEvent(window, "mouseup", 10, 8));
    expect(editor.undo()).toBe(true);
    expect(editor.serializeClean()).toBe(loaded);
    expect(editor.undo()).toBe(false);
  });

  it("terminates a shared resize when review lock starts and permits one successor after unlock", async () => {
    const { editor, root, window } = editorHarness();
    selectNestedMulti(editor);
    const before = editor.serializeClean();
    const context = editorContext(editor);
    const fidelity = fidelitySnapshot(editor);

    let handle = root.querySelector('[data-lineage-collective-handle="rb"]') as SVGElement;
    dispatch(handle, new window.PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 20, clientY: 20, pointerId: 75 }));
    dispatch(window, new window.PointerEvent("pointermove", { bubbles: true, clientX: 28, clientY: 28, pointerId: 75 }));
    editor.setAgentMutationBlocked(true);
    expect(editor.serializeClean()).toBe(before);
    expect(editorContext(editor)).toEqual(context);
    expect(editor.undo()).toBe(false);
    dispatch(window, new window.PointerEvent("pointermove", { bubbles: true, clientX: 60, clientY: 60, pointerId: 75 }));
    dispatch(window, new window.PointerEvent("pointerup", { bubbles: true, clientX: 60, clientY: 60, pointerId: 75 }));
    await Promise.resolve();
    expect(editor.serializeClean()).toBe(before);

    editor.setAgentMutationBlocked(false);
    handle = editor.svgNode?.querySelector('[data-lineage-collective-handle="rb"]') as SVGElement;
    dispatch(handle, new window.PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 20, clientY: 20, pointerId: 76 }));
    dispatch(window, new window.PointerEvent("pointermove", { bubbles: true, clientX: 30, clientY: 30, pointerId: 76 }));
    dispatch(window, new window.PointerEvent("pointerup", { bubbles: true, clientX: 30, clientY: 30, pointerId: 76 }));
    await Promise.resolve();
    const after = editor.serializeClean();
    expect(after).not.toBe(before);
    expect(editorContext(editor)).toEqual(context);
    expect(fidelitySnapshot(editor)).toEqual(fidelity);
    expect(editor.undo()).toBe(true);
    expect(editor.serializeClean()).toBe(before);
    expect(editor.undo()).toBe(false);
    expect(editor.redo()).toBe(true);
    expect(editor.serializeClean()).toBe(after);
  });
});

describe("marquee and precise selection interactions", () => {
  const platformAccelerator = /^(?:Mac|iPhone|iPad|iPod)/.test(navigator.platform)
    ? { metaKey: true }
    : { ctrlKey: true };

  function setClientRect(node: SVGGraphicsElement, left: number, top: number, width: number, height: number): void {
    Object.defineProperty(node, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: top + height, height, left, right: left + width, top, width,
        x: left, y: top, toJSON: () => ({}),
      }),
    });
  }

  it("selects visible leaf-most descendants across parents in DOM order without changing SVG bytes or history", () => {
    const { editor, root } = editorHarness();
    const logo = root.querySelector("#logo") as unknown as SVGGraphicsElement;
    const top = root.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path") as unknown as SVGGraphicsElement;
    top.id = "top";
    root.append(top);
    const hidden = root.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path") as unknown as SVGGraphicsElement;
    hidden.id = "hidden";
    hidden.setAttribute("display", "none");
    root.append(hidden);
    setClientRect(logo, 10, 10, 20, 20);
    const icon = root.querySelector("#icon") as unknown as SVGGraphicsElement;
    const waveform = root.querySelector("#waveform") as unknown as SVGGraphicsElement;
    const wordmark = root.querySelector("#wordmark") as unknown as SVGGraphicsElement;
    setClientRect(icon, 10, 10, 20, 20);
    setClientRect(waveform, 10, 10, 10, 10);
    setClientRect(wordmark, 22, 10, 8, 10);
    setClientRect(top, 35, 10, 20, 20);
    setClientRect(hidden, 60, 10, 20, 20);
    const before = editor.serializeClean();

    expect(editor.beginMarquee()).toBe(true);
    editor.commitMarquee({ bottom: 40, height: 40, left: 0, right: 90, top: 0, width: 90 }, false);
    expect(editorContext(editor)).toEqual({ primary: "top", scope: undefined, selected: ["waveform", "wordmark", "top"] });
    expect(editor.serializeClean()).toBe(before);
    expect(editor.undo()).toBe(false);
    expect(logo.getAttribute("data-lineage-secondary")).toBeNull();
    expect(icon.getAttribute("data-lineage-secondary")).toBeNull();
    expect(waveform.getAttribute("data-lineage-secondary")).toBeNull();
    expect(wordmark.getAttribute("data-lineage-secondary")).toBeNull();
    expect(top.getAttribute("data-lineage-secondary")).toBeNull();
    expect(root.querySelectorAll("[data-lineage-selection-halos] .lineage-selection-halo")).toHaveLength(3);
    expect(root.querySelectorAll(".svg_select_shape")).toHaveLength(1);
    expect(editor.operationState().group.allowed).toBe(false);
    expect(editor.operationState().align.allowed).toBe(false);
  });

  it("previews live marquee matches with selection halos without committing selection or history", () => {
    const contexts: SelectionContext[] = [];
    const { editor, root } = editorHarness((context) => contexts.push(context));
    const logo = root.querySelector("#logo") as unknown as SVGGraphicsElement;
    const icon = root.querySelector("#icon") as unknown as SVGGraphicsElement;
    const waveform = root.querySelector("#waveform") as unknown as SVGGraphicsElement;
    const wordmark = root.querySelector("#wordmark") as unknown as SVGGraphicsElement;
    setClientRect(logo, 0, 0, 60, 30);
    setClientRect(icon, 0, 0, 30, 30);
    setClientRect(waveform, 10, 10, 10, 10);
    setClientRect(wordmark, 40, 10, 10, 10);
    editor.selectNode(wordmark);
    const before = editor.serializeClean();
    expect(editor.beginMarquee()).toBe(true);
    const contextCount = contexts.length;

    expect(editor.previewMarquee({ bottom: 25, height: 20, left: 5, right: 25, top: 5, width: 20 }, false)).toBe(1);
    expect(editor.selectedNodes).toEqual([wordmark]);
    expect(root.querySelectorAll('[data-lineage-selection-halos][data-lineage-marquee-preview="true"] .lineage-selection-halo')).toHaveLength(1);
    expect(root.querySelectorAll('.lineage-selection-halo[data-lineage-marquee-preview="true"]')).toHaveLength(1);
    expect(contexts).toHaveLength(contextCount);

    expect(editor.previewMarquee({ bottom: 25, height: 20, left: 5, right: 25, top: 5, width: 20 }, true)).toBe(1);
    expect(editor.selectedNodes).toEqual([wordmark]);
    expect(root.querySelectorAll('.lineage-selection-halo[data-lineage-marquee-preview="true"]')).toHaveLength(2);
    expect(editor.serializeClean()).toBe(before);
    expect(editor.undo()).toBe(false);

    expect(editor.cancelMarquee()).toBe(true);
    expect(editor.selectedNodes).toEqual([wordmark]);
    expect(root.querySelector("[data-lineage-selection-halos]")?.hasAttribute("data-lineage-marquee-preview")).toBe(false);
    expect(root.querySelectorAll(".lineage-selection-halo")).toHaveLength(1);
    expect(editor.serializeClean()).toBe(before);
    expect(editor.undo()).toBe(false);
  });

  it("freezes a nested scope and normalizes the full additive union against ancestor coexistence", () => {
    const { editor, root } = editorHarness();
    const logo = root.querySelector("#logo") as unknown as SVGGraphicsElement;
    const icon = root.querySelector("#icon") as unknown as SVGGraphicsElement;
    const waveform = root.querySelector("#waveform") as unknown as SVGGraphicsElement;
    const wordmark = root.querySelector("#wordmark") as unknown as SVGGraphicsElement;
    editor.selectNode(logo);
    editor.editInside();
    editor.selectNode(icon);
    setClientRect(icon, 10, 10, 20, 20);
    setClientRect(waveform, 10, 10, 20, 20);
    setClientRect(wordmark, 40, 10, 20, 20);

    editor.beginMarquee();
    editor.commitMarquee({ bottom: 35, height: 30, left: 5, right: 35, top: 5, width: 30 }, true);
    expect(editorContext(editor)).toEqual({ primary: "waveform", scope: "logo", selected: ["waveform"] });
    expect(editor.selectedNodes).not.toContain(icon);

    editor.beginMarquee();
    editor.commitMarquee({ bottom: 35, height: 30, left: 35, right: 65, top: 5, width: 30 }, true);
    expect(editorContext(editor)).toEqual({ primary: "wordmark", scope: "logo", selected: ["waveform", "wordmark"] });
  });

  it("includes locked visible leaves, excludes hidden leaves, and keeps exactly one primary handle", () => {
    const { editor, root } = editorHarness();
    const logo = root.querySelector("#logo") as unknown as SVGGraphicsElement;
    const waveform = root.querySelector("#waveform") as unknown as SVGGraphicsElement;
    const wordmark = root.querySelector("#wordmark") as unknown as SVGGraphicsElement;
    editor.selectNode(logo);
    editor.editInside();
    editor.selectNode(waveform);
    editor.toggleLock();
    editor.selectNode(logo);
    wordmark.setAttribute("visibility", "hidden");
    setClientRect(logo, 0, 0, 50, 50);
    setClientRect(root.querySelector("#icon") as unknown as SVGGraphicsElement, 5, 5, 20, 20);
    setClientRect(waveform, 5, 5, 20, 20);
    setClientRect(wordmark, 30, 5, 15, 20);
    editor.beginMarquee();
    editor.commitMarquee({ bottom: 60, height: 60, left: 0, right: 60, top: 0, width: 60 }, false);
    expect(editor.selectedNodes).toEqual([waveform]);
    expect(root.querySelectorAll("[data-lineage-selection-halos] .lineage-selection-halo")).toHaveLength(1);
    expect(root.querySelectorAll(".svg_select_shape")).toHaveLength(0);
    expect(editor.undo()).toBe(false);
  });

  it("restores the pre-gesture selection on cancellation and treats a pending Shift drag as a no-op", () => {
    const { editor } = editorHarness();
    const before = editorContext(editor);
    editor.beginMarquee();
    expect(editor.cancelMarquee()).toBe(true);
    expect(editorContext(editor)).toEqual(before);
    editor.beginMarquee();
    editor.commitMarquee(undefined, true);
    expect(editorContext(editor)).toEqual(before);
    editor.beginMarquee();
    editor.commitMarquee(undefined, false);
    expect(editor.selectedNodes).toEqual([]);
  });

  it("publishes hover-free context as soon as a region begins and rejects non-artboard UI targets", () => {
    const contexts: SelectionContext[] = [];
    const { editor, root, window } = editorHarness((context) => contexts.push(context));
    const wordmark = root.querySelector("#wordmark") as unknown as SVGGraphicsElement;
    editor.setSelectionPreferences({ ...DEFAULT_SELECTION_PREFERENCES, clickDepth: "exact" });
    dispatch(wordmark, new window.PointerEvent("pointermove", { bubbles: true }));
    expect(contexts.at(-1)?.hovered).toBe(wordmark);
    expect(editor.beginMarquee()).toBe(true);
    expect(contexts.at(-1)?.hovered).toBeUndefined();
    expect(editor.canStartRegionSelection(wordmark)).toBe(true);
    const bannerButton = window.document.createElement("button");
    window.document.body.append(bannerButton);
    expect(editor.canStartRegionSelection(bannerButton as unknown as EventTarget)).toBe(false);
  });

  it("clears on an unarmed short background gesture but keeps selection and suppresses clicks after an inert drag", () => {
    const inert = editorHarness();
    const before = inert.editor.serializeClean();
    const context = editorContext(inert.editor);
    inert.editor.completeBackgroundGesture(true);
    dispatch(inert.root.querySelector("#wordmark"), new inert.window.MouseEvent("click", { bubbles: true }));
    expect(editorContext(inert.editor)).toEqual(context);
    expect(inert.editor.serializeClean()).toBe(before);
    expect(inert.editor.undo()).toBe(false);

    const click = editorHarness();
    click.editor.completeBackgroundGesture(false);
    expect(click.editor.selectedNodes).toEqual([]);
    expect(click.editor.undo()).toBe(false);

    const additiveClick = editorHarness();
    const additiveContext = editorContext(additiveClick.editor);
    additiveClick.editor.completeBackgroundGesture(false, true);
    dispatch(additiveClick.root.querySelector("#wordmark"), new additiveClick.window.MouseEvent("click", { bubbles: true }));
    expect(editorContext(additiveClick.editor)).toEqual(additiveContext);
    expect(additiveClick.editor.undo()).toBe(false);

    const additiveInert = editorHarness();
    const additiveInertContext = editorContext(additiveInert.editor);
    additiveInert.editor.completeBackgroundGesture(true, true);
    dispatch(additiveInert.root.querySelector("#wordmark"), new additiveInert.window.MouseEvent("click", { bubbles: true }));
    expect(editorContext(additiveInert.editor)).toEqual(additiveInertContext);
    expect(additiveInert.editor.undo()).toBe(false);
  });

  it("uses exact accelerator toggle within scope, replaces across scope, and ignores modified combinations", () => {
    const { editor, root, window } = editorHarness();
    const logo = root.querySelector("#logo") as unknown as SVGGraphicsElement;
    const icon = root.querySelector("#icon") as unknown as SVGGraphicsElement;
    const waveform = root.querySelector("#waveform") as unknown as SVGGraphicsElement;
    editor.selectNode(logo);
    editor.editInside();
    editor.selectNode(icon);
    dispatch(waveform, new window.MouseEvent("click", { bubbles: true, button: 0, ...platformAccelerator }));
    expect(editorContext(editor)).toEqual({ primary: "waveform", scope: "icon", selected: ["waveform"] });
    dispatch(icon, new window.MouseEvent("click", { bubbles: true, button: 0, ...platformAccelerator }));
    expect(editorContext(editor)).toEqual({ primary: "icon", scope: "logo", selected: ["icon"] });
    dispatch(root.querySelector("#wordmark"), new window.MouseEvent("click", { bubbles: true, button: 0, ...platformAccelerator }));
    expect(editorContext(editor)).toEqual({ primary: "wordmark", scope: "logo", selected: ["icon", "wordmark"] });
    dispatch(icon, new window.MouseEvent("click", { bubbles: true, button: 0, shiftKey: true, ...platformAccelerator }));
    expect(editorContext(editor)).toEqual({ primary: "wordmark", scope: "logo", selected: ["icon", "wordmark"] });
  });

  it("completes Control click arbitration as a clean exact toggle while Shift-empty preserves selection", () => {
    const { editor, root } = editorHarness();
    const first = root.querySelector("#wordmark") as unknown as SVGGraphicsElement;
    const second = root.querySelector("#icon") as unknown as SVGGraphicsElement;
    editor.selectNode(first);
    const clean = editor.serializeClean();
    expect(editor.beginMarquee()).toBe(true);
    editor.completeControlGesture(second, false);
    expect(editor.marqueeActive).toBe(false);
    expect(editor.selectedNodes).toEqual([first, second]);
    expect(editor.beginMarquee()).toBe(true);
    editor.completeControlGesture(second, true);
    expect(editor.marqueeActive).toBe(false);
    expect(editor.selectedNodes).toEqual([first]);
    expect(editor.beginMarquee()).toBe(true);
    editor.completeControlGesture(undefined, true);
    expect(editor.marqueeActive).toBe(false);
    expect(editor.selectedNodes).toEqual([first]);
    expect(editor.beginMarquee()).toBe(true);
    editor.suppressCanvasClick();
    expect(editor.marqueeActive).toBe(false);
    expect(editor.selectedNodes).toEqual([first]);
    expect(editor.beginMarquee()).toBe(true);
    editor.completeControlGesture(undefined, false);
    expect(editor.marqueeActive).toBe(false);
    expect(editor.selectedNodes).toEqual([]);
    expect(editor.serializeClean()).toBe(clean);
    expect(editor.undo()).toBe(false);
  });

  it("cancels moved precise pointer sequences before object mutation", () => {
    const { editor, group, window } = editorHarness();
    const before = editor.serializeClean();
    let objectPointerDowns = 0;
    group.addEventListener("pointerdown", () => { objectPointerDowns += 1; });
    const pointer = (type: string, x: number, y: number) => {
      const event = new window.PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 17, ...platformAccelerator });
      dispatch(group, event);
    };
    pointer("pointerdown", 10, 10);
    pointer("pointermove", 20, 10);
    pointer("pointerup", 20, 10);
    expect(editor.serializeClean()).toBe(before);
    expect(editor.selectedNode).toBe(group);
    expect(editor.undo()).toBe(false);
    expect(objectPointerDowns).toBe(0);
  });

  it("captures precise drags from the selection bounding shape without disabling ordinary drag or transform handles", () => {
    const { editor, group, root, window } = editorHarness();
    const shape = root.querySelector(".svg_select_shape") as unknown as SVGGraphicsElement;
    const resizeHandle = root.querySelector(".svg_select_handle:not(.svg_select_handle_rot)") as unknown as SVGGraphicsElement;
    const rotationHandle = root.querySelector(".svg_select_handle_rot") as unknown as SVGGraphicsElement;
    expect(shape).toBeTruthy();
    expect(resizeHandle).toBeTruthy();
    expect(rotationHandle).toBeTruthy();
    const before = editor.serializeClean();
    let overlayDragStarts = 0;
    let resizeStarts = 0;
    let rotationStarts = 0;
    shape.addEventListener("pointerdown", () => {
      overlayDragStarts += 1;
      group.setAttribute("transform", "translate(30 25)");
    });
    resizeHandle.addEventListener("pointerdown", () => { resizeStarts += 1; });
    rotationHandle.addEventListener("pointerdown", () => { rotationStarts += 1; });
    const pointer = (target: SVGGraphicsElement, type: string, x: number, y: number, accelerator: boolean, pointerId: number) => {
      dispatch(target, new window.PointerEvent(type, {
        bubbles: true, button: 0, clientX: x, clientY: y, pointerId,
        ...(accelerator ? platformAccelerator : {}),
      }));
    };

    pointer(shape, "pointerdown", 620, 535, true, 31);
    pointer(shape, "pointermove", 650, 560, true, 31);
    pointer(shape, "pointerup", 650, 560, true, 31);
    expect(overlayDragStarts).toBe(0);
    expect(editor.serializeClean()).toBe(before);
    expect(editor.selectedNode).toBe(group);
    expect(editor.undo()).toBe(false);

    pointer(shape, "pointerdown", 620, 535, false, 32);
    expect(overlayDragStarts).toBe(1);
    group.setAttribute("transform", "translate(4 5)");
    pointer(resizeHandle, "pointerdown", 0, 0, true, 33);
    pointer(rotationHandle, "pointerdown", 0, 0, true, 34);
    expect(resizeStarts).toBe(1);
    expect(rotationStarts).toBe(1);
  });

  it("shows a clean, editor-only violet halo for locked and handle-ineligible selections", () => {
    const { editor, group, root } = editorHarness();
    const clean = editor.serializeClean();
    editor.toggleLock();
    expect(root.querySelectorAll("[data-lineage-selection-halos] .lineage-selection-halo")).toHaveLength(1);
    expect(root.querySelector(".lineage-selection-halo")?.getAttribute("data-lineage-primary-fallback")).toBe("true");
    expect(group.getAttribute("data-lineage-primary-fallback")).toBe("true");
    expect(root.querySelectorAll(".svg_select_shape")).toHaveLength(0);
    expect(editor.serializeClean()).toBe(clean);
    expect(editor.undo()).toBe(false);

    editor.toggleLock();
    expect(group.getAttribute("data-lineage-primary-fallback")).toBeNull();
    expect(root.querySelectorAll(".svg_select_shape")).toHaveLength(1);
    editor.toggleVisibility();
    expect(group.getAttribute("data-lineage-primary-fallback")).toBe("true");
    expect(root.querySelector(".lineage-selection-halo")?.getAttribute("data-lineage-primary-fallback")).toBe("true");
    editor.toggleVisibility();
    expect(group.getAttribute("data-lineage-primary-fallback")).toBeNull();
    editor.selectNode(root.querySelector("#waveform") as unknown as SVGGraphicsElement);
    expect(root.querySelectorAll("[data-lineage-selection-halos] .lineage-selection-halo")).toHaveLength(1);
    expect(root.querySelector(".lineage-selection-halo")?.getAttribute("data-lineage-primary-fallback")).toBe("true");
    expect(editor.serializeClean()).toBe(clean);
  });

  it("cancels marquee before editable/modal Escape guards and suppresses the successor click", () => {
    const { controls, editor, group, root, window } = editorHarness();
    const original = editorContext(editor);
    expect(editor.beginMarquee()).toBe(true);
    controls.name.ownerDocument.body.append(controls.name);
    controls.name.focus();
    dispatch(controls.name, new window.KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    expect(editor.marqueeActive).toBe(false);
    dispatch(root.querySelector("#wordmark"), new window.MouseEvent("click", { bubbles: true }));
    expect(editorContext(editor)).toEqual(original);

    const dialog = window.document.createElement("dialog");
    dialog.setAttribute("open", "");
    const modalButton = window.document.createElement("button");
    dialog.append(modalButton);
    window.document.body.append(dialog);
    expect(editor.beginMarquee()).toBe(true);
    dispatch(modalButton, new window.KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    expect(editor.marqueeActive).toBe(false);
    dispatch(group, new window.MouseEvent("click", { bubbles: true }));
    expect(editorContext(editor)).toEqual(original);
  });

  it("suppresses successor clicks after precise Escape and pointer cancellation", () => {
    const { controls, editor, root, window } = editorHarness();
    const logo = root.querySelector("#logo") as unknown as SVGGraphicsElement;
    const wordmark = root.querySelector("#wordmark") as unknown as SVGGraphicsElement;
    editor.selectNode(logo);
    editor.editInside();
    editor.selectNode(wordmark);
    const original = editorContext(editor);
    controls.name.ownerDocument.body.append(controls.name);
    const preciseDown = (pointerId: number) => dispatch(root.querySelector("#icon"), new window.PointerEvent("pointerdown", {
      bubbles: true, button: 0, pointerId, ...platformAccelerator,
    }));

    preciseDown(21);
    controls.name.focus();
    dispatch(controls.name, new window.KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    dispatch(root.querySelector("#icon"), new window.MouseEvent("click", { bubbles: true }));
    expect(editorContext(editor)).toEqual(original);

    preciseDown(22);
    dispatch(root.querySelector("#icon"), new window.PointerEvent("pointercancel", { bubbles: true, pointerId: 22 }));
    dispatch(root.querySelector("#icon"), new window.MouseEvent("click", { bubbles: true }));
    expect(editorContext(editor)).toEqual(original);
  });

  it("applies logical versus exact default click depth while preserving Alt and double-click exact replacement", () => {
    const { editor, group, root, window } = editorHarness();
    const waveform = root.querySelector("#waveform") as unknown as SVGGraphicsElement;
    dispatch(waveform, new window.MouseEvent("click", { bubbles: true }));
    expect(editor.selectedNode).toBe(group);

    editor.setSelectionPreferences({ ...DEFAULT_SELECTION_PREFERENCES, clickDepth: "exact" });
    dispatch(waveform, new window.MouseEvent("click", { bubbles: true }));
    expect(editorContext(editor)).toEqual({ primary: "waveform", scope: "icon", selected: ["waveform"] });

    editor.selectNode(group);
    editor.setSelectionPreferences({ ...DEFAULT_SELECTION_PREFERENCES });
    dispatch(waveform, new window.MouseEvent("click", { altKey: true, bubbles: true }));
    expect(editorContext(editor)).toEqual({ primary: "waveform", scope: "icon", selected: ["waveform"] });
    editor.selectNode(group);
    dispatch(waveform, new window.MouseEvent("dblclick", { bubbles: true }));
    expect(editorContext(editor)).toEqual({ primary: "waveform", scope: "icon", selected: ["waveform"] });
  });

  it("switches the configured precise toggle to Alt without consuming platform-modified combinations", () => {
    const { editor, root, window } = editorHarness();
    const logo = root.querySelector("#logo") as unknown as SVGGraphicsElement;
    const icon = root.querySelector("#icon") as unknown as SVGGraphicsElement;
    const wordmark = root.querySelector("#wordmark") as unknown as SVGGraphicsElement;
    editor.selectNode(logo);
    editor.editInside();
    editor.selectNode(icon);
    editor.setSelectionPreferences({ ...DEFAULT_SELECTION_PREFERENCES, preciseModifier: "alt" });
    dispatch(wordmark, new window.MouseEvent("click", { altKey: true, bubbles: true }));
    expect(editorContext(editor)).toEqual({ primary: "wordmark", scope: "logo", selected: ["icon", "wordmark"] });
    dispatch(icon, new window.MouseEvent("click", { bubbles: true, ...platformAccelerator }));
    expect(editorContext(editor)).toEqual({ primary: "wordmark", scope: "logo", selected: ["icon", "wordmark"] });
    expect(editor.undo()).toBe(false);
  });

  it("uses fully enclosed or touching marquee geometry from preferences without dirtying history", () => {
    const { editor, group } = editorHarness();
    setClientRect(group, 10, 10, 20, 20);
    const partial = { bottom: 35, height: 20, left: 25, right: 45, top: 15, width: 20 };
    editor.beginMarquee();
    editor.commitMarquee(partial, false);
    expect(editor.selectedNodes).toEqual([]);

    editor.selectNode(group);
    editor.setSelectionPreferences({ ...DEFAULT_SELECTION_PREFERENCES, marqueeMode: "touch" });
    editor.beginMarquee();
    editor.commitMarquee(partial, false);
    expect(editor.selectedNodes).toEqual([group]);
    expect(editor.undo()).toBe(false);
  });

  it("renders filter-independent halos for every selected object without changing clean SVG, history, or primary handles", () => {
    const { editor, root } = editorHarness();
    const clean = editor.serializeClean();
    const primary = selectNestedMulti(editor);
    expect(root.querySelectorAll("[data-lineage-selection-halos] .lineage-selection-halo")).toHaveLength(2);
    expect(root.querySelector("[data-lineage-selection-halos]")?.getAttribute("pointer-events")).toBe("none");
    editor.setSelectionPreferences({ ...DEFAULT_SELECTION_PREFERENCES, individualOutlines: false });
    expect(editorContext(editor).selected).toEqual(["wordmark", "icon"]);
    expect(root.querySelectorAll('.lineage-selection-halo[data-enhanced="false"]')).toHaveLength(2);
    expect(root.querySelectorAll(".svg_select_shape")).toHaveLength(1);
    editor.selectNode(root.querySelector("#waveform") as unknown as SVGGraphicsElement);
    editor.setSelectionPreferences({ ...DEFAULT_SELECTION_PREFERENCES, individualOutlines: true });
    expect(root.querySelectorAll('.lineage-selection-halo[data-enhanced="true"]')).toHaveLength(1);
    expect(editor.serializeClean()).toBe(clean);
    expect(primary.isConnected).toBe(true);
    expect(editor.undo()).toBe(false);
  });

  it("gives horizontal and vertical zero-extent objects visibly nonzero clean halo geometry", () => {
    const { editor, root, window } = editorHarness();
    const horizontal = window.document.createElementNS("http://www.w3.org/2000/svg", "line") as unknown as SVGGraphicsElement;
    horizontal.setAttribute("x1", "0"); horizontal.setAttribute("x2", "20"); horizontal.setAttribute("y1", "5"); horizontal.setAttribute("y2", "5");
    const vertical = horizontal.cloneNode() as SVGGraphicsElement;
    vertical.setAttribute("x1", "5"); vertical.setAttribute("x2", "5"); vertical.setAttribute("y1", "0"); vertical.setAttribute("y2", "20");
    root.append(horizontal, vertical);
    Object.defineProperty(horizontal, "getBBox", { value: () => ({ x: 0, y: 5, width: 20, height: 0 }) });
    Object.defineProperty(vertical, "getBBox", { value: () => ({ x: 5, y: 0, width: 0, height: 20 }) });
    const clean = editor.serializeClean();
    for (const line of [horizontal, vertical]) {
      editor.selectNode(line);
      const halo = root.querySelector(".lineage-selection-halo") as SVGRectElement;
      expect(Number(halo.getAttribute("width"))).toBeGreaterThan(0);
      expect(Number(halo.getAttribute("height"))).toBeGreaterThan(0);
    }
    expect(editor.serializeClean()).toBe(clean);
    expect(editor.undo()).toBe(false);
  });
});

describe("complete complex Seatify history sequence", () => {
  it("tracks exact serialization, dirty state, history, and Save/Reset availability across all 18 undo and redo checkpoints", () => {
    const window = new Window({ url: "http://localhost/" });
    installWindow(window);
    const artboard = window.document.createElement("div");
    const fixture = readFileSync("tests/fixtures/workspace/concepts/complex-seatify.svg", "utf8");
    const savedBaselineMarkup = fixture.replace(
      '<svg viewBox="0 0 1024 768" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Complex Seatify venue logo">',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 768" role="img" aria-label="Complex Seatify venue logo" version="1.1" xmlns:xlink="http://www.w3.org/1999/xlink">',
    );
    const baselineContainer = window.document.createElement("div");
    baselineContainer.innerHTML = savedBaselineMarkup;
    const savedBaseline = (baselineContainer.querySelector("svg") as unknown as SVGSVGElement).outerHTML;
    const xlinkDeclaration = ' xmlns:xlink="http://www.w3.org/1999/xlink"';
    const restoredOrder = savedBaseline
      .replace(xlinkDeclaration, "")
      .replace('xmlns="http://www.w3.org/2000/svg"', `xmlns="http://www.w3.org/2000/svg"${xlinkDeclaration}`);
    artboard.innerHTML = restoredOrder;
    window.document.body.append(artboard);
    const controls = Object.fromEntries(Object.entries(CONTROL_TAGS).map(([name, tag]) => {
      const control = window.document.createElement(tag);
      if (control instanceof window.HTMLInputElement) control.value = name === "opacity" || name === "scale" ? "100" : "0";
      return [name, control];
    })) as unknown as ConstructorParameters<typeof SvgEditor>[1];
    const dirtyStates: boolean[] = [];
    const historyStates: Array<{ canRedo: boolean; canUndo: boolean }> = [];
    const editor = new SvgEditor(artboard as unknown as HTMLElement, controls, {
      onDocumentChange: () => undefined,
      onDirtyChange: (dirty) => dirtyStates.push(dirty),
      onHistoryChange: (canUndo, canRedo) => historyStates.push({ canRedo, canUndo }),
      onSelectionChange: () => undefined,
      onSelectionContextChange: () => undefined,
      onStatus: () => undefined,
    });
    editor.load(artboard.querySelector("svg") as unknown as SVGSVGElement, savedBaseline);
    const baseline = savedBaseline;
    const origin = editor.serializeClean();
    expect(origin).not.toBe(baseline);
    expect(cleanSvgsEqualForDirtyComparison(origin, baseline)).toBe(true);
    expect(dirtyStates.at(-1)).toBe(false);
    const snapshots = [origin];
    const checkpoint = () => {
      const clean = editor.serializeClean();
      expect(clean).not.toBe(snapshots.at(-1));
      snapshots.push(clean);
      expect(dirtyStates.at(-1)).toBe(!cleanSvgsEqualForDirtyComparison(clean, baseline));
      expect(historyStates.at(-1)).toEqual({ canRedo: false, canUndo: true });
      expect({ resetDisabled: !dirtyStates.at(-1), saveDisabled: !dirtyStates.at(-1) }).toEqual({ resetDisabled: false, saveDisabled: false });
    };
    const select = (id: string) => {
      const node = editor.svgNode?.querySelector(`#${id}`) as unknown as SVGGraphicsElement;
      expect(node).toBeTruthy();
      editor.selectNode(node);
      return node;
    };
    const key = (keyValue: string, shiftKey = false) => document.dispatchEvent(new KeyboardEvent("keydown", { key: keyValue, shiftKey }));

    select("ticket-ribbon-wrapper"); key("ArrowRight"); checkpoint();
    select("ticket-stub-wrapper"); key("ArrowRight"); checkpoint();
    select("table-cluster-west"); key("ArrowRight", true); checkpoint(); key("ArrowRight"); checkpoint(); key("ArrowRight"); checkpoint();

    select("table-cluster-east");
    controls.rotation.dispatchEvent(new Event("focus"));
    controls.rotation.value = "4";
    controls.rotation.dispatchEvent(new Event("input"));
    controls.rotation.dispatchEvent(new Event("change"));
    checkpoint();

    select("stage-zone");
    controls.scale.dispatchEvent(new Event("focus"));
    controls.scale.value = "96";
    controls.scale.dispatchEvent(new Event("input"));
    controls.scale.dispatchEvent(new Event("change"));
    checkpoint();

    select("stage-light-left");
    controls.fill.dispatchEvent(new Event("focus"));
    controls.fill.value = "#ff9f1c";
    controls.fill.dispatchEvent(new Event("input"));
    checkpoint();

    select("aisle-center");
    controls.opacity.dispatchEvent(new Event("focus"));
    controls.opacity.value = "0.55";
    controls.opacity.dispatchEvent(new Event("input"));
    checkpoint();

    select("venue-caption");
    controls.textContent.value = "Venue plan · doors 7:30 PM";
    controls.textContent.dispatchEvent(new Event("change"));
    checkpoint();

    select("accent-star"); controls.duplicateButton.click(); checkpoint();
    editor.reorder("earlier"); checkpoint();

    const north = select("west-seat-north");
    const east = editor.svgNode?.querySelector("#west-seat-east") as unknown as SVGGraphicsElement;
    const south = editor.svgNode?.querySelector("#west-seat-south") as unknown as SVGGraphicsElement;
    Object.defineProperty(north, "getBBox", { configurable: true, value: () => ({ height: 36, width: 36, x: -18, y: -94 }) });
    Object.defineProperty(east, "getBBox", { configurable: true, value: () => ({ height: 36, width: 36, x: 58, y: -18 }) });
    Object.defineProperty(south, "getBBox", { configurable: true, value: () => ({ height: 36, width: 36, x: -18, y: 58 }) });
    editor.selectNode(east, true);
    editor.selectNode(south, true);
    editor.align("middle"); checkpoint();
    editor.group(); checkpoint();
    editor.renameSelection("West priority seats"); checkpoint();
    editor.ungroup(); checkpoint();

    select("entrance-left"); editor.toggleVisibility(); checkpoint(); editor.toggleVisibility(); checkpoint();
    expect(snapshots).toHaveLength(19);

    for (let index = 17; index >= 0; index -= 1) {
      expect(editor.undo()).toBe(true);
      const clean = editor.serializeClean();
      expect(clean).toBe(snapshots[index]);
      const dirty = !cleanSvgsEqualForDirtyComparison(clean, baseline);
      expect(dirtyStates.at(-1)).toBe(dirty);
      expect(historyStates.at(-1)).toEqual({ canRedo: true, canUndo: index > 0 });
      expect({ resetDisabled: !dirty, saveDisabled: !dirty }).toEqual({
        resetDisabled: index === 0,
        saveDisabled: index === 0,
      });
    }
    expect(editor.undo()).toBe(false);
    expect(editor.serializeClean()).toBe(origin);
    expect(cleanSvgsEqualForDirtyComparison(editor.serializeClean(), baseline)).toBe(true);

    for (let index = 1; index <= 18; index += 1) {
      expect(editor.redo()).toBe(true);
      const clean = editor.serializeClean();
      expect(clean).toBe(snapshots[index]);
      expect(dirtyStates.at(-1)).toBe(true);
      expect(historyStates.at(-1)).toEqual({ canRedo: index < 18, canUndo: true });
      expect({ resetDisabled: !dirtyStates.at(-1), saveDisabled: !dirtyStates.at(-1) }).toEqual({ resetDisabled: false, saveDisabled: false });
    }
    expect(editor.redo()).toBe(false);
  });
});
