import { Window } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerWindow, SVG } from "@svgdotjs/svg.js";
import { History } from "../src/client/history/history";
import { matrixRotationDegrees, rotationHandleRadii, serializeSvg, SvgEditor } from "../src/client/canvas/editor";
import {
  composeGroupDrag,
  composeGroupResize,
  composeGroupScale,
  formatMatrix,
  GroupTransformGesture,
  type MatrixCoefficients,
} from "../src/client/canvas/transform";

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

function editorHarness(): EditorHarness {
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
    onSelectionContextChange: () => undefined,
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
  it("keeps primary-only keyboard actions inert while multiple layers are selected", () => {
    const { editor, window } = editorHarness();
    selectNestedMulti(editor);
    const before = editor.serializeClean();
    const context = editorContext(editor);

    for (const event of [
      new window.KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }),
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

  it("uses ResizeHandler.handleResize for pointercancel and a real immediate mouse resize", async () => {
    const { editor, window } = editorHarness();
    const group = selectNestedMulti(editor);
    const before = editor.serializeClean();
    const context = editorContext(editor);
    const fidelity = fidelitySnapshot(editor);

    const canceledHandler = startResize(group, window, "rb", mouseEvent(window, "mousedown", 20, 20));
    dispatch(window, mouseEvent(window, "mousemove", 28, 28));
    dispatch(window, new window.Event("pointercancel"));
    await Promise.resolve();
    expect(editor.serializeClean()).toBe(before);
    expect(editorContext(editor)).toEqual(context);
    expect(canceledHandler.eventType).toBe("");
    expect(canceledHandler.lastEvent).toBeNull();
    expect(editor.undo()).toBe(false);
    dispatch(window, mouseEvent(window, "mousemove", 60, 60));
    dispatch(window, mouseEvent(window, "mouseup", 60, 60));
    expect(editor.serializeClean()).toBe(before);

    startResize(editor.selectedNode as SVGGraphicsElement, window, "rb", mouseEvent(window, "mousedown", 20, 20));
    dispatch(window, mouseEvent(window, "mousemove", 30, 30));
    dispatch(window, mouseEvent(window, "mouseup", 30, 30));
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

  it("uses ResizeHandler.handleResize for touchcancel and a real immediate touch rotation", async () => {
    const { controls, editor, statuses, window } = editorHarness();
    const group = selectNestedMulti(editor);
    const before = editor.serializeClean();
    const context = editorContext(editor);
    const fidelity = fidelitySnapshot(editor);

    const canceledHandler = startResize(group, window, "rot", touchEvent(window, "touchstart", 10, -10));
    dispatch(window, touchEvent(window, "touchmove", 20, 10));
    dispatch(window, touchEvent(window, "touchcancel", 20, 10));
    await Promise.resolve();
    expect(editor.serializeClean()).toBe(before);
    expect(editorContext(editor)).toEqual(context);
    expect(canceledHandler.eventType).toBe("");
    expect(canceledHandler.lastEvent).toBeNull();
    expect(editor.undo()).toBe(false);
    dispatch(window, touchEvent(window, "touchmove", 50, 50));
    dispatch(window, touchEvent(window, "touchend", 50, 50));
    expect(editor.serializeClean()).toBe(before);

    startResize(editor.selectedNode as SVGGraphicsElement, window, "rot", touchEvent(window, "touchstart", 10, -10));
    dispatch(window, touchEvent(window, "touchmove", 20, 10));
    expect(controls.rotation.value).not.toBe("0");
    expect(statuses.at(-1)).toMatch(/^Rotation -?\d+(?:\.\d)?°$/);
    dispatch(window, touchEvent(window, "touchend", 20, 10));
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

  it("terminates a real resize session when review lock starts and permits one successor after unlock", async () => {
    const { editor, window } = editorHarness();
    const group = selectNestedMulti(editor);
    const before = editor.serializeClean();
    const context = editorContext(editor);
    const fidelity = fidelitySnapshot(editor);

    startResize(group, window, "rb", touchEvent(window, "touchstart", 20, 20));
    dispatch(window, touchEvent(window, "touchmove", 28, 28));
    editor.setAgentMutationBlocked(true);
    expect(editor.serializeClean()).toBe(before);
    expect(editorContext(editor)).toEqual(context);
    expect(editor.undo()).toBe(false);
    dispatch(window, touchEvent(window, "touchmove", 60, 60));
    dispatch(window, touchEvent(window, "touchend", 60, 60));
    await Promise.resolve();
    expect(editor.serializeClean()).toBe(before);

    editor.setAgentMutationBlocked(false);
    startResize(editor.selectedNode as SVGGraphicsElement, window, "rb", touchEvent(window, "touchstart", 20, 20));
    dispatch(window, touchEvent(window, "touchmove", 30, 30));
    dispatch(window, touchEvent(window, "touchend", 30, 30));
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
