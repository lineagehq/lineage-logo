import { registerWindow } from "@svgdotjs/svg.js";
import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";
import {
  applySvgTextEdit,
  alignmentAvailability,
  alignmentOffsets,
  cleanSvgsEqualForDirtyComparison,
  distributionOffsets,
  findSelectableByKeys,
  groupAvailability,
  groupSelection,
  getDirectSelectionTarget,
  getLogicalSelectionTarget,
  getScopedSelectionTarget,
  getSelectionAncestry,
  getSelectionLabel,
  isSelectableNode,
  isValidSvgPaint,
  paintPickerValue,
  renameLayer,
  reorderAvailability,
  reorderSelection,
  serializeSvg,
  setLayerHidden,
  SvgEditor,
  svgPaintState,
  ungroupAvailability,
  ungroupSelection,
  validateSvgTextEdit,
  visibleHistoryAvailability,
} from "../src/client/canvas/editor";
import {
  clientRectFromPoints,
  crossedMarqueeThreshold,
  marqueeContains,
  marqueeTouches,
  renderedClientRect,
} from "../src/client/canvas/marquee-selection";

describe("editor serialization", () => {
  it("keeps history visibly disabled while provisional agent state restores snapshots", () => {
    expect(visibleHistoryAvailability(true, true, true)).toEqual({ canUndo: false, canRedo: false });
    expect(visibleHistoryAvailability(false, true, false)).toEqual({ canUndo: true, canRedo: false });
  });
  it("removes selection handles and temporary editor state", () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <svg viewBox="0 0 512 512" role="img" aria-label="concept.svg"
        data-lineage-added-role="true" data-lineage-added-label="true">
        <g id="icon" data-lineage-key="element-1" data-lineage-scale="120">
          <path id="mark" d="M0 0h10v10z" fill="#fff" />
        </g>
        <g>
          <rect class="svg_select_shape" />
          <polyline class="svg_select_handle svg_select_handle_rb" />
        </g>
      </svg>
    `;
    const root = window.document.querySelector("svg") as unknown as SVGSVGElement;

    const output = serializeSvg(root, true);
    expect(output).toContain('viewBox="0 0 512 512"');
    expect(output).toContain('id="icon"');
    expect(output).toContain('id="mark"');
    expect(output).not.toContain("svg_select");
    expect(output).not.toContain("<g></g>");
    expect(output).not.toContain("data-lineage-");
    expect(output).not.toContain("aria-label");
    expect(output).not.toContain('role="img"');
  });

  it("retains editor state in undo snapshots", () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <svg><g data-lineage-key="element-1" data-lineage-rotation="15" /></svg>
    `;
    const root = window.document.querySelector("svg") as unknown as SVGSVGElement;
    const output = serializeSvg(root, false);
    expect(output).toContain('data-lineage-key="element-1"');
    expect(output).toContain('data-lineage-rotation="15"');
  });

  it("strips hover prediction from clean saves and undo snapshots", () => {
    const window = new Window();
    window.document.body.innerHTML = '<svg><path id="mark" data-lineage-key="element-1" data-lineage-hover="true" /></svg>';
    const root = window.document.querySelector("svg") as unknown as SVGSVGElement;

    expect(serializeSvg(root, true)).not.toContain("data-lineage-hover");
    expect(serializeSvg(root, false)).not.toContain("data-lineage-hover");
  });

  it("strips primary fallback and multi-selection affordances from clean saves and snapshots", () => {
    const window = new Window();
    window.document.body.innerHTML = '<svg><path id="mark" data-lineage-key="element-1" data-lineage-secondary="true"/><path id="primary" data-lineage-primary-fallback="true"/></svg>';
    const root = window.document.querySelector("svg") as unknown as SVGSVGElement;

    expect(serializeSvg(root, true)).toBe('<svg><path id="mark"></path><path id="primary"></path></svg>');
    expect(serializeSvg(root, false)).not.toContain("data-lineage-secondary");
    expect(serializeSvg(root, false)).not.toContain("data-lineage-primary-fallback");
  });

  it("strips the dedicated selection halo overlay from clean saves and snapshots", () => {
    const window = new Window();
    window.document.body.innerHTML = '<svg><path id="mark"/><g data-lineage-selection-halos="true"><rect class="lineage-selection-halo"/></g></svg>';
    const root = window.document.querySelector("svg") as unknown as SVGSVGElement;
    expect(serializeSvg(root, true)).toBe('<svg><path id="mark"></path></svg>');
    expect(serializeSvg(root, false)).not.toContain("lineage-selection-halo");
  });

  it("strips the complete collective transform overlay from clean saves and snapshots", () => {
    const window = new Window();
    window.document.body.innerHTML = '<svg><path id="mark"/><g data-lineage-collective-transform="true" role="group" aria-label="Transform 3 selected layers"><rect class="svg_select_shape lineage-collective-outline"/><circle class="svg_select_handle lineage-collective-resize-handle" data-lineage-collective-handle="rb"/><g class="svg_select_handle_rot lineage-collective-rotation-handle"><circle/><path/></g><g data-lineage-collective-angle="27"><rect/><text>Δ +27°</text></g></g></svg>';
    const root = window.document.querySelector("svg") as unknown as SVGSVGElement;
    expect(serializeSvg(root, true)).toBe('<svg><path id="mark"></path></svg>');
    expect(serializeSvg(root, false)).toBe('<svg><path id="mark"></path></svg>');
  });

  it("strips agent review highlighting without changing accepted SVG content", () => {
    const window = new Window();
    window.document.body.innerHTML = '<svg><g id="accepted" data-lineage-review-highlight="true"><path id="mark" /></g></svg>';
    const root = window.document.querySelector("svg") as unknown as SVGSVGElement;
    expect(serializeSvg(root, true)).toBe('<svg><g id="accepted"><path id="mark"></path></g></svg>');
  });

  it("preserves accessibility attributes that came from the source SVG", () => {
    const window = new Window();
    window.document.body.innerHTML = '<svg role="img" aria-label="Original label"></svg>';
    const root = window.document.querySelector("svg") as unknown as SVGSVGElement;
    const output = serializeSvg(root, true);
    expect(output).toContain('role="img"');
    expect(output).toContain('aria-label="Original label"');
  });

  it("removes only reserved legacy edit metadata from clean exports", () => {
    const window = new Window();
    window.document.body.innerHTML = '<svg><metadata id="lineage-logo-edit">legacy</metadata><metadata id="authoring">keep</metadata><path data-agent-review="remove" data-review-state="remove" data-transport-id="remove" data-lineage-key="element-1" /></svg>';
    const root = window.document.querySelector("svg") as unknown as SVGSVGElement;
    const output = serializeSvg(root, true);
    expect(output).not.toContain("lineage-logo-edit");
    expect(output).toContain('<metadata id="authoring">keep</metadata>');
    expect(output).not.toContain("data-agent-review");
    expect(output).not.toContain("data-review-state");
    expect(output).not.toContain("data-transport-id");
    expect(output).not.toContain("data-lineage-");
  });
});

describe("clean SVG dirty comparison", () => {
  const opening = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" role="img" xmlns:xlink="http://www.w3.org/1999/xlink"><g id="mark" fill="#fff"><path d="M0 0h2v2z"/></g></svg>';

  it("ignores only ordering among complete root namespace declaration tokens", () => {
    const reordered = '<svg xmlns:xlink="http://www.w3.org/1999/xlink" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" role="img"><g id="mark" fill="#fff"><path d="M0 0h2v2z"/></g></svg>';
    expect(opening).not.toBe(reordered);
    expect(cleanSvgsEqualForDirtyComparison(opening, reordered)).toBe(true);
  });

  it.each([
    ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" role="img" xmlns:href="http://www.w3.org/1999/xlink"><g id="mark" fill="#fff"><path d="M0 0h2v2z"/></g></svg>', "namespace prefix"],
    ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" role="img" xmlns:xlink="urn:changed"><g id="mark" fill="#fff"><path d="M0 0h2v2z"/></g></svg>', "namespace value"],
    ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" role="img"><g id="mark" fill="#fff"><path d="M0 0h2v2z"/></g></svg>', "namespace presence"],
    ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" role="img" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xlink="http://www.w3.org/1999/xlink"><g id="mark" fill="#fff"><path d="M0 0h2v2z"/></g></svg>', "namespace count"],
    ['<svg xmlns="http://www.w3.org/2000/svg" role="img" viewBox="0 0 20 20" xmlns:xlink="http://www.w3.org/1999/xlink"><g id="mark" fill="#fff"><path d="M0 0h2v2z"/></g></svg>', "ordinary root attribute order"],
    ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 20" role="img" xmlns:xlink="http://www.w3.org/1999/xlink"><g id="mark" fill="#fff"><path d="M0 0h2v2z"/></g></svg>', "ordinary root attribute value"],
    ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" role="img" xmlns:xlink="http://www.w3.org/1999/xlink"><g fill="#fff" id="mark"><path d="M0 0h2v2z"/></g></svg>', "descendant attribute order"],
    ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" role="img" xmlns:xlink="http://www.w3.org/1999/xlink"><g id="mark" fill="#000"><path d="M0 0h2v2z"/></g></svg>', "descendant value"],
  ])("rejects a meaningful %s difference", (candidate) => {
    expect(cleanSvgsEqualForDirtyComparison(opening, candidate)).toBe(false);
  });

  it("does not alter public clean serialization bytes", () => {
    const { root } = (() => {
      const window = new Window();
      window.document.body.innerHTML = opening;
      return { root: window.document.querySelector("svg") as unknown as SVGSVGElement };
    })();
    expect(serializeSvg(root, true)).toBe(root.outerHTML);
  });
});

describe("duplicate layer labels", () => {
  it("labels named clone roots deterministically without changing the source or descendant labels", () => {
    const window = new Window({ url: "http://localhost/" });
    for (const name of [
      "window", "document", "DOMParser", "Event", "CustomEvent", "KeyboardEvent", "HTMLElement", "HTMLInputElement",
      "HTMLTextAreaElement", "SVGElement", "SVGGraphicsElement", "SVGSVGElement", "Node", "Element", "CSS",
    ] as const) vi.stubGlobal(name, window[name as keyof Window]);
    registerWindow(window as never, window.document as never);
    try {
      const artboard = window.document.createElement("div");
      artboard.innerHTML = '<svg><g id="logo" aria-label="Venue"><path id="child" aria-label="Venue child" d="M0 0h10v10z"/></g><path id="collision" aria-label="Venue copy" d="M20 0h10v10z"/><path id="unnamed" d="M40 0h10v10z"/></svg>';
      window.document.body.append(artboard);
      const names = [
        "alignBottomButton", "alignCenterButton", "alignLeftButton", "alignmentReason", "alignMiddleButton", "alignRightButton",
        "alignTopButton", "deleteButton", "duplicateButton", "fill", "fillError", "fillPicker", "fillState", "groupButton",
        "hierarchyReason", "hideButton", "lockButton", "name", "nameClearButton", "opacity", "positionX", "positionY",
        "reorderEarlierButton", "reorderLaterButton", "rotation", "scale", "selectionEmpty", "selectionName", "selectionPanel",
        "stroke", "strokeError", "strokePicker", "strokeState", "strokeWidth", "ungroupButton",
      ];
      const controls = Object.fromEntries(names.map((name) => [name, window.document.createElement("button")])) as unknown as Record<string, HTMLElement>;
      const editor = new SvgEditor(artboard as unknown as HTMLElement, controls as never, {
        onDocumentChange: () => undefined, onDirtyChange: () => undefined, onHistoryChange: () => undefined,
        onSelectionChange: () => undefined, onSelectionContextChange: () => undefined, onStatus: () => undefined,
      });
      editor.load(artboard.querySelector("svg") as unknown as SVGSVGElement);
      const source = editor.svgNode?.querySelector("#logo") as unknown as SVGGraphicsElement;
      editor.selectNode(source);
      controls.duplicateButton.click();
      expect(source.getAttribute("aria-label")).toBe("Venue");
      expect(editor.selectedNode?.getAttribute("aria-label")).toBe("Venue copy 2");
      expect(editor.selectedNode?.querySelector("path")?.getAttribute("aria-label")).toBe("Venue child");
      editor.selectNode(source);
      controls.duplicateButton.click();
      expect(editor.selectedNode?.getAttribute("aria-label")).toBe("Venue copy 3");

      const unnamed = editor.svgNode?.querySelector("#unnamed") as unknown as SVGGraphicsElement;
      editor.selectNode(unnamed);
      controls.duplicateButton.click();
      expect(editor.selectedNode?.hasAttribute("aria-label")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("validated SVG paint", () => {
  const supportedPaint = (_property: string, value: string) => [
    "none",
    "currentColor",
    "rebeccapurple",
    "rgb(10 20 30 / 50%)",
    "url(#brand-gradient)",
  ].includes(value);

  it.each(["", "none", "currentColor", "rebeccapurple", "rgb(10 20 30 / 50%)", "url(#brand-gradient)"])(
    "accepts standards-compliant inherited, solid, and referenced paint %j",
    (value) => expect(isValidSvgPaint(value, "fill", supportedPaint)).toBe(true),
  );

  it.each(["#not-a-color", "rgb(nope)", "red; stroke: blue"])(
    "rejects invalid paint %j without canonicalizing it",
    (value) => expect(isValidSvgPaint(value, "stroke", supportedPaint)).toBe(false),
  );

  it("expands picker-compatible short hex while leaving ordinary SVG paint text intact", () => {
    expect(paintPickerValue("#Ab3")).toBe("#aabb33");
    expect(paintPickerValue("#AABB33")).toBe("#aabb33");
    expect(paintPickerValue("currentColor")).toBeUndefined();
    expect(paintPickerValue("url(#paint)")).toBeUndefined();
  });

  it("explains explicit paint provenance without inventing inherited values", () => {
    expect(svgPaintState(null)).toBe("Inherited / SVG default");
    expect(svgPaintState("")).toBe("Inherited / SVG default");
    expect(svgPaintState("none")).toBe("No paint");
    expect(svgPaintState("currentColor")).toBe("Uses currentColor");
    expect(svgPaintState("url(#paint)")).toBe("Paint server / gradient");
    expect(svgPaintState("#aabbcc")).toBe("Solid color");
    expect(svgPaintState("rebeccapurple")).toBe("CSS paint value");
  });
});

describe("bounded SVG text editing", () => {
  function textNode(): { root: SVGSVGElement; text: SVGTextElement } {
    const window = new Window();
    window.document.body.innerHTML = '<svg><text id="wordmark" font-size="24" font-weight="600" font-family="Inter, sans-serif" text-anchor="start" letter-spacing="1">BleepThat</text></svg>';
    return {
      root: window.document.querySelector("svg") as unknown as SVGSVGElement,
      text: window.document.querySelector("text") as unknown as SVGTextElement,
    };
  }

  it("applies every supported property as plain text or one bounded presentation attribute", () => {
    const { root, text } = textNode();
    const edits = [
      { property: "content", value: "Bleep That" },
      { property: "font-size", value: "32" },
      { property: "font-weight", value: "bold" },
      { property: "font-family", value: "Avenir Next, sans-serif" },
      { property: "text-anchor", value: "middle" },
      { property: "letter-spacing", value: "-0.75" },
    ] as const;
    edits.forEach((edit) => expect(applySvgTextEdit(text, edit)).toEqual({ changed: true }));
    expect(text.textContent).toBe("Bleep That");
    expect(text.getAttribute("font-size")).toBe("32");
    expect(text.getAttribute("font-weight")).toBe("bold");
    expect(text.getAttribute("font-family")).toBe("Avenir Next, sans-serif");
    expect(text.getAttribute("text-anchor")).toBe("middle");
    expect(text.getAttribute("letter-spacing")).toBe("-0.75");
    const clean = serializeSvg(root, true);
    expect(clean).not.toContain("data-lineage-");
    expect(clean).toContain("Bleep That");
  });

  it("writes through inline and important stylesheet typography instead of adding ineffective attributes", () => {
    const window = new Window();
    const root = window.document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const style = window.document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = "#styled { font-weight: 700 !important }";
    const inlineNode = window.document.createElementNS("http://www.w3.org/2000/svg", "text");
    inlineNode.id = "inline";
    inlineNode.setAttribute("style", "font-size:40px");
    const styledNode = window.document.createElementNS("http://www.w3.org/2000/svg", "text");
    styledNode.id = "styled";
    root.append(style, inlineNode, styledNode);
    window.document.body.append(root);
    const inline = inlineNode as unknown as SVGTextElement;
    const styled = styledNode as unknown as SVGTextElement;
    expect(applySvgTextEdit(inline, { property: "font-size", value: "20" })).toEqual({ changed: true });
    expect(inline.getAttribute("font-size")).toBeNull();
    expect(inline.style.getPropertyValue("font-size")).toBe("20px");
    expect(applySvgTextEdit(styled, { property: "font-weight", value: "400" })).toEqual({ changed: true });
    expect(styled.getAttribute("font-weight")).toBeNull();
    expect(styled.style.getPropertyValue("font-weight")).toBe("400");
    expect(styled.style.getPropertyPriority("font-weight")).toBe("important");
  });

  it.each([
    ["content", "<tspan onclick=alert(1)>bad</tspan>"],
    ["font-size", "1001"],
    ["font-weight", "calc(1)"],
    ["font-family", "url(https://example.com/font.woff)"],
    ["font-family", "Inter; fill:red"],
    ["text-anchor", "url(#mark)"],
    ["letter-spacing", "calc(2px)"],
  ] as const)("rejects unsafe or unbounded %s input without changing bytes", (property, value) => {
    const { root, text } = textNode();
    const before = root.outerHTML;
    expect(applySvgTextEdit(text, { property, value }).error).toBeTruthy();
    expect(root.outerHTML).toBe(before);
  });

  it("treats normalized no-ops as unchanged and round-trips edited text byte-equivalently", () => {
    const { root, text } = textNode();
    const before = serializeSvg(root, true);
    expect(applySvgTextEdit(text, { property: "content", value: "BleepThat" })).toEqual({ changed: false });
    expect(applySvgTextEdit(text, { property: "font-size", value: "24.0000" })).toEqual({ changed: false });
    expect(serializeSvg(root, true)).toBe(before);
    expect(applySvgTextEdit(text, { property: "content", value: "Bleep That" })).toEqual({ changed: true });
    const saved = serializeSvg(root, true);
    const reopened = new Window();
    reopened.document.body.innerHTML = saved;
    expect((reopened.document.querySelector("svg") as unknown as SVGSVGElement).outerHTML).toBe(saved);
    expect(reopened.document.querySelector("text")?.textContent).toBe("Bleep That");
  });

  it("rejects content changes for structured text without touching any child while allowing typography", () => {
    const window = new Window();
    window.document.body.innerHTML = `<svg><text id="structured"><title>Accessible</title>Lead<!--keep--><tspan dx="2">Middle</tspan><textPath href="#curve">Tail</textPath></text></svg>`;
    const text = window.document.querySelector("text") as unknown as SVGTextElement;
    const before = text.outerHTML;
    const childrenBefore = text.innerHTML;
    expect(applySvgTextEdit(text, { property: "content", value: "Replacement" })).toMatchObject({ changed: false, error: expect.any(String) });
    expect(text.outerHTML).toBe(before);
    expect(applySvgTextEdit(text, { property: "font-size", value: "32" })).toEqual({ changed: true });
    expect(text.innerHTML).toBe(childrenBefore);
  });

  it("preserves raw bytes for every normalized-equivalent typography edit", () => {
    const window = new Window();
    window.document.body.innerHTML = '<svg><text font-size="024.0000" font-weight="0600" font-family="\'Avenir Next\' , sans-serif" text-anchor="middle" letter-spacing="01.5000">Text</text></svg>';
    const root = window.document.querySelector("svg") as unknown as SVGSVGElement;
    const text = window.document.querySelector("text") as unknown as SVGTextElement;
    const before = root.outerHTML;
    for (const edit of [
      { property: "font-size", value: "24" },
      { property: "font-weight", value: "600" },
      { property: "font-family", value: "Avenir Next,sans-serif" },
      { property: "text-anchor", value: " middle " },
      { property: "letter-spacing", value: "1.5" },
    ] as const) expect(applySvgTextEdit(text, edit)).toEqual({ changed: false });
    expect(root.outerHTML).toBe(before);
  });

  it("treats case-insensitive CSS keywords as exact-byte no-ops", () => {
    const window = new Window();
    window.document.body.innerHTML = '<svg><text font-weight="BOLD" text-anchor="MIDDLE" letter-spacing="NORMAL">Text</text></svg>';
    const root = window.document.querySelector("svg") as unknown as SVGSVGElement;
    const text = window.document.querySelector("text") as unknown as SVGTextElement;
    const before = root.outerHTML;
    for (const edit of [
      { property: "font-weight", value: "bold" },
      { property: "text-anchor", value: "middle" },
      { property: "letter-spacing", value: "normal" },
    ] as const) expect(applySvgTextEdit(text, edit)).toEqual({ changed: false });
    expect(root.outerHTML).toBe(before);
  });

  it.each([
    ["A\\76 enir/**/ Next, sans-serif", "Avenir Next,sans-serif"],
    ["Avenir Next, sans-serif", "A\\76 enir/**/ Next,sans-serif"],
    ["'Avenir Next'/**/, SYSTEM-UI", "\"Avenir Next\",system-ui"],
  ])("treats browser-equivalent escaped/commented family %s to %s as an exact-byte no-op", (current, next) => {
    const window = new Window();
    const root = window.document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const text = window.document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("font-family", current);
    text.textContent = "Text";
    root.append(text);
    const before = root.outerHTML;
    expect(applySvgTextEdit(text as unknown as SVGTextElement, { property: "font-family", value: next })).toEqual({ changed: false });
    expect(root.outerHTML).toBe(before);
  });

  it("treats every signed and exponent numeric spelling as an exact-byte no-op", () => {
    const window = new Window();
    window.document.body.innerHTML = '<svg><text font-size="+9.6e1" font-weight="+6e2" letter-spacing="-3e0">Text</text></svg>';
    const root = window.document.querySelector("svg") as unknown as SVGSVGElement;
    const text = window.document.querySelector("text") as unknown as SVGTextElement;
    const before = root.outerHTML;
    for (const edit of [
      { property: "font-size", value: "96.000" },
      { property: "font-weight", value: "600" },
      { property: "letter-spacing", value: "-03.000" },
    ] as const) expect(applySvgTextEdit(text, edit)).toEqual({ changed: false });
    expect(root.outerHTML).toBe(before);
  });

  it.each([
    ["bold", "700"],
    ["BOLD", "+7e2"],
    ["700", "bold"],
    ["+7e2", "BOLD"],
    ["normal", "400"],
    ["NORMAL", "+4e2"],
    ["400", "normal"],
    ["+4e2", "NORMAL"],
  ])("treats font-weight alias %s to %s as an exact-byte no-op", (current, next) => {
    const window = new Window();
    window.document.body.innerHTML = `<svg><text font-weight="${current}">Text</text></svg>`;
    const root = window.document.querySelector("svg") as unknown as SVGSVGElement;
    const text = window.document.querySelector("text") as unknown as SVGTextElement;
    const before = root.outerHTML;
    expect(applySvgTextEdit(text, { property: "font-weight", value: next })).toEqual({ changed: false });
    expect(root.outerHTML).toBe(before);
  });

  it("preserves bytes, history, dirty state, selection, and drill scope through real no-op control commits", () => {
    const window = new Window({ url: "http://localhost/" });
    for (const name of [
      "window", "document", "DOMParser", "Event", "CustomEvent", "KeyboardEvent", "HTMLElement", "HTMLInputElement",
      "HTMLTextAreaElement", "HTMLSelectElement", "SVGElement", "SVGGraphicsElement", "SVGSVGElement", "Node", "Element", "CSS",
    ] as const) vi.stubGlobal(name, window[name as keyof Window]);
    registerWindow(window as never, window.document as never);
    try {
      const artboard = window.document.createElement("div");
      artboard.innerHTML = '<svg><g id="wordmark"><text id="primary" font-size="+9.6e1" font-weight="+6e2" font-family="A\\72 ial/**/, sans-serif" text-anchor="MIDDLE" letter-spacing="-3e0">BLEEPED</text><text id="bold-alias" font-weight="BOLD">Bold</text><text id="normal-alias" font-weight="normal">Normal</text></g></svg>';
      window.document.body.append(artboard);
      const names = [
        "alignBottomButton", "alignCenterButton", "alignLeftButton", "alignmentReason", "alignMiddleButton", "alignRightButton",
        "alignTopButton", "deleteButton", "duplicateButton", "fill", "fillError", "fillPicker", "fillState", "groupButton",
        "hierarchyReason", "hideButton", "lockButton", "name", "nameClearButton", "opacity", "positionX", "positionY",
        "reorderEarlierButton", "reorderLaterButton", "rotation", "scale", "selectionEmpty", "selectionName", "selectionPanel",
        "stroke", "strokeError", "strokePicker", "strokeState", "strokeWidth", "ungroupButton",
      ];
      const controls = Object.fromEntries(names.map((name) => [name, window.document.createElement("button")])) as unknown as Record<string, unknown>;
      for (const name of ["textContent", "textFamily", "textLetterSpacing", "textSize", "textWeight"]) controls[name] = window.document.createElement("input");
      controls.textAnchor = window.document.createElement("select");
      for (const value of ["start", "middle", "end"]) {
        const option = window.document.createElement("option"); option.value = value;
        (controls.textAnchor as unknown as HTMLSelectElement).append(option as unknown as Node);
      }
      controls.textError = window.document.createElement("small");
      let documentChanges = 0;
      let dirtyChanges = 0;
      const dirtyStates: boolean[] = [];
      let historyChanges = 0;
      const editor = new SvgEditor(artboard as unknown as HTMLElement, controls as never, {
        onDocumentChange: () => { documentChanges += 1; },
        onDirtyChange: (value) => { dirtyChanges += 1; dirtyStates.push(value); },
        onHistoryChange: () => { historyChanges += 1; },
        onSelectionChange: () => undefined,
        onSelectionContextChange: () => undefined,
        onStatus: () => undefined,
      });
      const root = artboard.querySelector("svg") as unknown as SVGSVGElement;
      const text = artboard.querySelector("text") as unknown as SVGGraphicsElement;
      editor.load(root);
      editor.selectNode(text);
      const before = editor.serializeClean();
      const scope = editor.selectionContext.activeScope;
      const historyBaseline = historyChanges;
      for (const [name, value] of [
        ["textContent", "BLEEPED"], ["textSize", "96"], ["textWeight", "600"],
        ["textFamily", "Arial,sans-serif"], ["textAnchor", "middle"], ["textLetterSpacing", "-03.000"],
      ] as const) {
        const control = controls[name] as HTMLInputElement | HTMLSelectElement;
        control.value = value;
        control.dispatchEvent(new window.Event("change") as unknown as Event);
      }
      for (const [id, value] of [["bold-alias", "700"], ["normal-alias", "+4e2"]] as const) {
        const aliasNode = artboard.querySelector(`#${id}`) as unknown as SVGGraphicsElement;
        editor.selectNode(aliasNode);
        const aliasScope = editor.selectionContext.activeScope;
        (controls.textWeight as HTMLInputElement).value = value;
        (controls.textWeight as HTMLInputElement).dispatchEvent(new window.Event("change") as unknown as Event);
        expect(editor.selectedNode).toBe(aliasNode);
        expect(editor.selectionContext.activeScope).toBe(aliasScope);
      }
      editor.selectNode(text);
      expect(editor.serializeClean()).toBe(before);
      expect({ documentChanges, dirtyChanges, historyChanges }).toEqual({ documentChanges: 0, dirtyChanges: 0, historyChanges: historyBaseline });
      expect(editor.selectedNode).toBe(text);
      expect(editor.selectionContext.activeScope).toBe(scope);
      expect(editor.selectionContext.canDrillBack).toBe(true);

      text.textContent = "Unsaved manual edit";
      editor.load(root, before);
      expect(dirtyChanges).toBe(1);
      expect(editor.serializeClean()).not.toBe(before);
      editor.reset();
      expect(editor.serializeClean()).toBe(before);
      expect(dirtyChanges).toBe(3);
      expect(dirtyStates.at(-1)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    '<text><title>Accessible</title>Text</text>',
    '<text>Lead<tspan dx="2">Middle</tspan></text>',
    '<text><textPath href="#curve">Path text</textPath></text>',
    '<text>Lead<!--keep-->Tail</text>',
    '<text>Lead<tspan>Middle</tspan>Tail</text>',
  ])("rejects structured content without mutating markup: %s", (markup) => {
    const window = new Window();
    window.document.body.innerHTML = `<svg>${markup}</svg>`;
    const text = window.document.querySelector("text") as unknown as SVGTextElement;
    const before = text.outerHTML;
    const childrenBefore = text.innerHTML;
    expect(applySvgTextEdit(text, { property: "content", value: "Replacement" })).toMatchObject({ changed: false, error: expect.any(String) });
    expect(text.outerHTML).toBe(before);
    expect(applySvgTextEdit(text, { property: "font-size", value: "32" })).toEqual({ changed: true });
    expect(text.innerHTML).toBe(childrenBefore);
  });

  it("does not let a family edit activate imported or URL-backed fonts", () => {
    for (const css of [
      '@font-face { font-family: "Remote Face"; src: local("Fallback"), url(https://example.test/font.woff2) }',
      '@/**/font-face /* formatting */ { font-family /* name */ : "Remote Face"; src /* source */ : local("Fallback"), url /* gap */ (https://example.test/font.woff2) }',
      '@import url("https://example.test/fonts.css");',
      '@/**/import url("https://example.test/fonts.css");',
    ]) {
      const window = new Window();
      const svgElement = window.document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const style = window.document.createElementNS("http://www.w3.org/2000/svg", "style");
      style.textContent = css;
      const textElement = window.document.createElementNS("http://www.w3.org/2000/svg", "text");
      textElement.setAttribute("font-family", "sans-serif");
      textElement.textContent = "Text";
      svgElement.append(style, textElement);
      window.document.body.append(svgElement);
      const root = svgElement as unknown as SVGSVGElement;
      const text = textElement as unknown as SVGTextElement;
      const before = root.outerHTML;
      expect(applySvgTextEdit(text, { property: "font-family", value: "Remote Face, sans-serif" })).toMatchObject({ changed: false, error: expect.any(String) });
      expect(root.outerHTML).toBe(before);
    }
    const { text } = textNode();
    expect(applySvgTextEdit(text, { property: "font-family", value: "Avenir Next, system-ui" })).toEqual({ changed: true });
  });

  it("decodes CSS escapes before checking external font family, source, and import activation", () => {
    for (const css of [
      '@\\66 ont-face { font-\\66 amily: "R\\65 mote Face"; s\\72 c: local("Fallback"), u\\72l(https://example.test/font.woff2) }',
      '@\\69 mport u\\72l("https://example.test/fonts.css");',
    ]) {
      const window = new Window();
      const root = window.document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const style = window.document.createElementNS("http://www.w3.org/2000/svg", "style");
      style.textContent = css;
      const text = window.document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("font-family", "sans-serif");
      text.textContent = "Text";
      root.append(style, text);
      window.document.body.append(root);
      const before = root.outerHTML;
      expect(applySvgTextEdit(text as unknown as SVGTextElement, { property: "font-family", value: "Remote Face, sans-serif" }))
        .toMatchObject({ changed: false, error: expect.any(String) });
      expect(root.outerHTML).toBe(before);
    }
  });

  it("rejects URL-backed font faces whose valid strings contain escaped braces", () => {
    const window = new Window();
    const root = window.document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const style = window.document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = '@font-face { font-family: "Remote Face"; src: local("\\7d "), url("https://example.test/font.woff2") }';
    const text = window.document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("font-family", "sans-serif");
    root.append(style, text);
    window.document.body.append(root);
    const before = root.outerHTML;
    expect(applySvgTextEdit(text as unknown as SVGTextElement, { property: "font-family", value: "Remote Face, sans-serif" }))
      .toMatchObject({ changed: false, error: expect.any(String) });
    expect(root.outerHTML).toBe(before);
  });

  it("allows local-only font-face declarations and safe local family lists", () => {
    const window = new Window();
    const root = window.document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const style = window.document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = '@font-face { font-family: "Local Face"; src: local("Local Face") }';
    const text = window.document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("font-family", "sans-serif");
    text.textContent = "Text";
    root.append(style, text);
    window.document.body.append(root);
    expect(applySvgTextEdit(text as unknown as SVGTextElement, { property: "font-family", value: "Local Face, system-ui" })).toEqual({ changed: true });
  });

  it("does not confuse unrelated local paint references with a local-only font face", () => {
    const window = new Window();
    const root = window.document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const style = window.document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = '@font-face { font-family: "Local Face"; src: local("Local Face") } #shape { fill:url(#gradient) }';
    const text = window.document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("font-family", "sans-serif");
    root.append(style, text);
    window.document.body.append(root);
    expect(applySvgTextEdit(text as unknown as SVGTextElement, { property: "font-family", value: "Local Face, system-ui" }))
      .toEqual({ changed: true });
  });

  it("rejects URL-backed font faces nested in grouping rules", () => {
    const window = new Window();
    const root = window.document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const style = window.document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = '@media all { @font-face { font-family: "Remote Face"; src: url("https://example.test/font.woff2") } }';
    const text = window.document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("font-family", "sans-serif");
    root.append(style, text);
    window.document.body.append(root);
    const before = root.outerHTML;
    expect(applySvgTextEdit(text as unknown as SVGTextElement, { property: "font-family", value: "Remote Face, sans-serif" }))
      .toMatchObject({ changed: false, error: expect.any(String) });
    expect(root.outerHTML).toBe(before);
  });

  it("validates bounded numeric and local-family forms without accepting CSS or external resources", () => {
    expect(validateSvgTextEdit({ property: "font-size", value: "0.25" })).toMatchObject({ valid: true, normalized: "0.25" });
    expect(validateSvgTextEdit({ property: "font-weight", value: "1000" })).toMatchObject({ valid: true });
    expect(validateSvgTextEdit({ property: "letter-spacing", value: "normal" })).toMatchObject({ valid: true });
    expect(validateSvgTextEdit({ property: "font-family", value: "Inter, system-ui" })).toMatchObject({ valid: true });
    expect(validateSvgTextEdit({ property: "font-size", value: "0.00001" })).toMatchObject({ valid: false });
  });
});

describe("safe layer organization", () => {
  function documentFor(source: string): { root: SVGSVGElement; window: Window } {
    const window = new Window();
    window.document.body.innerHTML = source;
    return { root: window.document.querySelector("svg") as unknown as SVGSVGElement, window };
  }

  it("renames with a trimmed aria-label without changing IDs or references", () => {
    const { root, window } = documentFor(`
      <svg><defs><path id="shape" /></defs><g id="named"><use href="#shape" /></g></svg>
    `);
    const node = window.document.querySelector("#named") as unknown as SVGGraphicsElement;
    expect(renameLayer(node, "  Accessible name  ")).toBe(true);
    expect(node.getAttribute("aria-label")).toBe("Accessible name");
    expect(node.id).toBe("named");
    expect(root.querySelector("use")?.getAttribute("href")).toBe("#shape");
    expect(renameLayer(node, "   ")).toBe(true);
    expect(node.hasAttribute("aria-label")).toBe(false);
    expect(renameLayer(node, "")).toBe(false);
  });

  it("toggles layer visibility without disturbing source identity or child structure", () => {
    const { root, window } = documentFor('<svg><g id="named"><path id="child"/></g></svg>');
    const node = window.document.querySelector("#named") as unknown as SVGGraphicsElement;
    expect(setLayerHidden(node, true)).toBe(true);
    expect(node.getAttribute("display")).toBe("none");
    expect(setLayerHidden(node, true)).toBe(false);
    expect(setLayerHidden(node, false)).toBe(true);
    expect(node.hasAttribute("display")).toBe(false);
    expect(node.id).toBe("named");
    expect(root.querySelector("#child")).not.toBeNull();
  });

  it("restores an explicit source display value after a hide/show round trip", () => {
    const { root } = documentFor('<svg><path id="mark" display="inline"/></svg>');
    const node = root.querySelector("#mark") as unknown as SVGGraphicsElement;
    expect(setLayerHidden(node, true)).toBe(true);
    expect(node.getAttribute("display")).toBe("none");
    expect(node.dataset.lineagePreviousDisplay).toBe("inline");
    expect(serializeSvg(root, true)).not.toContain("data-lineage-previous-display");
    expect(setLayerHidden(node, false)).toBe(true);
    expect(node.getAttribute("display")).toBe("inline");
    expect(node.dataset.lineagePreviousDisplay).toBeUndefined();
  });

  it("moves one contiguous block exactly one selectable sibling earlier and later", () => {
    const { root } = documentFor('<svg><path id="a"/><path id="b"/><path id="c"/><path id="d"/></svg>');
    const node = (id: string) => root.querySelector(`#${id}`) as unknown as SVGGraphicsElement;
    expect(reorderAvailability([node("b"), node("c")], root, "earlier").allowed).toBe(true);
    expect(reorderSelection([node("c"), node("b")], root, "earlier")).toBe(true);
    expect(Array.from(root.children).map((child) => child.id)).toEqual(["b", "c", "a", "d"]);
    expect(reorderSelection([node("b"), node("c")], root, "later")).toBe(true);
    expect(Array.from(root.children).map((child) => child.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("groups adjacent same-parent layers in a neutral SVG wrapper and round-trips through clean reload", () => {
    const { root } = documentFor(`
      <svg><defs><linearGradient id="paint"><stop /></linearGradient></defs>
        <path id="a" transform="translate(2 3)" fill="url(#paint)" role="img" aria-label="A" />
        <path id="b" clip-path="url(#clip)" mask="url(#mask)" filter="url(#fx)" />
        <path id="c" />
      </svg>
    `);
    const a = root.querySelector("#a") as unknown as SVGGraphicsElement;
    const b = root.querySelector("#b") as unknown as SVGGraphicsElement;
    const beforeAttributes = [a.outerHTML, b.outerHTML];
    expect(groupAvailability([a, b], root).allowed).toBe(true);
    const group = groupSelection([b, a], root);
    expect(group?.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(group?.attributes.length).toBe(0);
    expect(Array.from(group?.children ?? []).map((child) => child.id)).toEqual(["a", "b"]);
    expect([a.outerHTML, b.outerHTML]).toEqual(beforeAttributes);

    const clean = serializeSvg(root, true);
    const reloaded = documentFor(clean).root;
    const neutral = reloaded.querySelector("svg > g") as unknown as SVGGraphicsElement;
    expect(ungroupAvailability(neutral, reloaded).allowed).toBe(true);
    expect(ungroupSelection(neutral).map((child) => child.id)).toEqual(["a", "b"]);
    expect(Array.from(reloaded.children).filter((child) => child.localName !== "defs").map((child) => child.id)).toEqual(["a", "b", "c"]);
    expect(reloaded.querySelector("#a")?.getAttribute("fill")).toBe("url(#paint)");
  });

  it("rejects unsafe grouping and reorder without changing markup", () => {
    const cases = [
      '<svg><path id="a"/><path id="b"/><path id="c"/></svg>',
      '<svg><g><path id="a"/></g><path id="b"/></svg>',
      '<svg><style>path + path { opacity: .5 }</style><path id="a"/><path id="b"/></svg>',
    ];
    cases.forEach((source, index) => {
      const { root } = documentFor(source);
      const a = root.querySelector("#a") as unknown as SVGGraphicsElement;
      const b = root.querySelector("#b") as unknown as SVGGraphicsElement;
      const before = root.outerHTML;
      const groupState = groupAvailability([a, b], root, index === 0 ? (node) => node === a : undefined);
      expect(groupState.allowed).toBe(false);
      if (root.querySelector("style")) expect(reorderAvailability([a], root, "later").allowed).toBe(false);
      expect(root.outerHTML).toBe(before);
    });
    const { root } = documentFor('<svg><path id="a"/><path id="middle"/><path id="b"/></svg>');
    const before = root.outerHTML;
    expect(groupAvailability([
      root.querySelector("#a") as unknown as SVGGraphicsElement,
      root.querySelector("#b") as unknown as SVGGraphicsElement,
    ], root).allowed).toBe(false);
    expect(root.outerHTML).toBe(before);
  });

  it("allows a named neutral group to be ungrouped with an explicit name-loss warning", () => {
    const { root } = documentFor('<svg><g aria-label="Named group"><path id="a"/></g></svg>');
    const group = root.querySelector("g") as unknown as SVGGraphicsElement;
    const availability = ungroupAvailability(group, root);
    expect(availability.allowed).toBe(true);
    expect(availability.reason).toContain("name will be removed");
    expect(ungroupSelection(group).map((child) => child.id)).toEqual(["a"]);
    expect(root.querySelector("[aria-label]")).toBeNull();
  });

  it.each(["id", "transform", "class", "style", "opacity", "fill", "stroke", "clip-path", "mask", "filter", "role"])(
    "rejects ungroup when the wrapper has source attribute %s",
    (attribute) => {
      const value = attribute === "transform" ? "translate(1)" : "value";
      const { root } = documentFor(`<svg><g ${attribute}="${value}"><path id="a"/></g></svg>`);
      const group = root.querySelector("g") as unknown as SVGGraphicsElement;
      const before = root.outerHTML;
      expect(ungroupAvailability(group, root).allowed).toBe(false);
      expect(root.outerHTML).toBe(before);
    },
  );
});

describe("multi-selection alignment", () => {
  const boxes = [
    { x: 10, y: 20, width: 20, height: 10 },
    { x: 50, y: 60, width: 40, height: 30 },
  ];

  it.each([
    ["left", [{ dx: 0, dy: 0 }, { dx: -40, dy: 0 }]],
    ["center", [{ dx: 30, dy: 0 }, { dx: -20, dy: 0 }]],
    ["right", [{ dx: 60, dy: 0 }, { dx: 0, dy: 0 }]],
    ["top", [{ dx: 0, dy: 0 }, { dx: 0, dy: -40 }]],
    ["middle", [{ dx: 0, dy: 30 }, { dx: 0, dy: -20 }]],
    ["bottom", [{ dx: 0, dy: 60 }, { dx: 0, dy: 0 }]],
  ] as const)("computes %s offsets from the shared selection bounds", (direction, expected) => {
    expect(alignmentOffsets(boxes, direction)).toEqual(expected);
  });

  it("allows non-contiguous same-parent siblings and rejects ambiguous or locked selections", () => {
    const window = new Window();
    window.document.body.innerHTML = '<svg><g id="nested"><path id="inside"/></g><path id="a"/><path id="gap"/><path id="b"/></svg>';
    const root = window.document.querySelector("svg") as unknown as SVGSVGElement;
    const node = (id: string) => root.querySelector(`#${id}`) as unknown as SVGGraphicsElement;
    expect(alignmentAvailability([node("a"), node("b")], root).allowed).toBe(true);
    expect(alignmentAvailability([node("a")], root).allowed).toBe(false);
    expect(alignmentAvailability([node("a"), node("inside")], root).reason).toContain("same parent");
    expect(alignmentAvailability([node("a"), node("b")], root, (candidate) => candidate === node("a")).reason).toContain("Unlock");
  });
});

describe("multi-selection distribution", () => {
  it("distributes horizontal and vertical centers with deterministic fixed outer anchors", () => {
    const boxes = [
      { x: 0, y: 100, width: 10, height: 20 },
      { x: 100, y: 0, width: 10, height: 10 },
      { x: 30, y: 30, width: 10, height: 10 },
    ];
    expect(distributionOffsets(boxes, "horizontal-centers")).toEqual([
      { dx: 0, dy: 0 },
      { dx: 0, dy: 0 },
      { dx: 20, dy: 0 },
    ]);
    expect(distributionOffsets(boxes, "vertical-centers")).toEqual([
      { dx: 0, dy: 0 },
      { dx: 0, dy: 0 },
      { dx: 0, dy: 22.5 },
    ]);
  });

  it("equalizes edge gaps with mixed and zero sizes while allowing deterministic overlap", () => {
    expect(distributionOffsets([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 30, y: 20, width: 20, height: 0 },
      { x: 100, y: 80, width: 10, height: 20 },
    ], "horizontal-gaps")).toEqual([
      { dx: 0, dy: 0 },
      { dx: 15, dy: 0 },
      { dx: 0, dy: 0 },
    ]);
    expect(distributionOffsets([
      { x: 0, y: 0, width: 40, height: 10 },
      { x: 20, y: 20, width: 40, height: 10 },
      { x: 50, y: 50, width: 40, height: 10 },
    ], "horizontal-gaps")[1]).toEqual({ dx: 5, dy: 0 });
    expect(distributionOffsets([
      { x: 0, y: 0, width: 10, height: 0 },
      { x: 0, y: 20, width: 10, height: 0 },
      { x: 0, y: 100, width: 10, height: 0 },
    ], "vertical-gaps")[1]).toEqual({ dx: 0, dy: 30 });
  });

  it("is a no-op below the three-object contract", () => {
    expect(distributionOffsets([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 20, y: 0, width: 10, height: 10 },
    ], "horizontal-centers")).toEqual([{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }]);
  });
});

describe("canvas selection", () => {
  it("stops at the logical top-level layer instead of selecting the SVG root", () => {
    const window = new Window();
    window.document.body.innerHTML = '<svg><g id="icon"><path id="spark" /></g></svg>';
    const root = window.document.querySelector("svg") as unknown as SVGSVGElement;
    const spark = window.document.querySelector("path") as unknown as SVGGraphicsElement;

    expect(getLogicalSelectionTarget(spark, root)?.id).toBe("icon");
    expect(getLogicalSelectionTarget(root as unknown as SVGGraphicsElement, root)).toBeUndefined();
  });

  it("resolves the direct child of the active scope for both hover and normal click", () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <svg>
        <g id="logo"><g id="wordmark"><path id="letter" /></g></g>
      </svg>
    `;
    const root = window.document.querySelector("svg") as unknown as SVGSVGElement;
    const logo = window.document.querySelector("#logo") as unknown as SVGGraphicsElement;
    const wordmark = window.document.querySelector("#wordmark") as unknown as SVGGraphicsElement;
    const letter = window.document.querySelector("#letter") as unknown as SVGGraphicsElement;

    expect(getScopedSelectionTarget(letter, root, root)).toBe(logo);
    expect(getScopedSelectionTarget(letter, logo, root)).toBe(wordmark);
    expect(getDirectSelectionTarget(letter, root)).toBe(letter);
  });

  it("excludes roots, resources, handles, and nested SVG content", () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <svg>
        <defs><path id="resource" /></defs>
        <g id="handles"><rect class="svg_select_shape" /></g>
        <svg><path id="nested" /></svg>
        <path id="editable" />
      </svg>
    `;
    const root = window.document.querySelector("svg") as unknown as SVGSVGElement;
    const query = (selector: string) => window.document.querySelector(selector) as unknown as SVGGraphicsElement;

    expect(isSelectableNode(root, root)).toBe(false);
    expect(isSelectableNode(query("#resource"), root)).toBe(false);
    expect(isSelectableNode(query(".svg_select_shape"), root)).toBe(false);
    expect(isSelectableNode(query("#nested"), root)).toBe(false);
    expect(isSelectableNode(query("#editable"), root)).toBe(true);
  });

  it("builds selectable ancestry and deterministic labels without changing markup", () => {
    const window = new Window();
    window.document.body.innerHTML = '<svg><g id="unique"><path /><path /></g><g id="unique" /></svg>';
    const root = window.document.querySelector("svg") as unknown as SVGSVGElement;
    const paths = window.document.querySelectorAll("path") as unknown as NodeListOf<SVGGraphicsElement>;
    const before = root.outerHTML;

    expect(getSelectionAncestry(paths[1], root).map((node) => node.localName)).toEqual(["g", "path"]);
    expect(getSelectionLabel(paths[1], root)).toBe("path-2");
    expect(getSelectionLabel(window.document.querySelector("g") as unknown as SVGGraphicsElement, root)).toBe("g-1");
    expect(root.outerHTML).toBe(before);
  });

  it("restores context by session key with the nearest surviving ancestor fallback", () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <svg>
        <g data-lineage-key="group"><path data-lineage-key="child" /></g>
      </svg>
    `;
    const root = window.document.querySelector("svg") as unknown as SVGSVGElement;

    expect(findSelectableByKeys(root, ["child", "group"])?.dataset.lineageKey).toBe("child");
    window.document.querySelector("path")?.remove();
    expect(findSelectableByKeys(root, ["child", "group"])?.dataset.lineageKey).toBe("group");
    expect(findSelectableByKeys(root, ["missing"])).toBeUndefined();
  });
});

describe("marquee client geometry", () => {
  it("normalizes reverse drags and applies inclusive containment and touching rules", () => {
    const marquee = clientRectFromPoints({ x: 30, y: 40 }, { x: 10, y: 20 });
    expect(marquee).toEqual({ bottom: 40, height: 20, left: 10, right: 30, top: 20, width: 20 });
    expect(marqueeContains(marquee, { bottom: 40, height: 20, left: 10, right: 30, top: 20, width: 20 })).toBe(true);
    expect(marqueeContains(marquee, { bottom: 41, height: 21, left: 10, right: 30, top: 20, width: 20 })).toBe(false);
    expect(marqueeTouches(marquee, { bottom: 50, height: 10, left: 30, right: 40, top: 40, width: 10 })).toBe(true);
    expect(marqueeTouches(marquee, { bottom: 50, height: 9, left: 31, right: 40, top: 41, width: 9 })).toBe(false);
    expect(crossedMarqueeThreshold({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(false);
    expect(crossedMarqueeThreshold({ x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
  });

  it("keeps rendered zero-thickness lines but excludes hidden, transparent, and unusable candidates", () => {
    const window = new Window();
    window.document.body.innerHTML = '<svg><g id="scope"><line id="line"/><path id="hidden" style="visibility:hidden"/><g visibility="hidden"><path id="override" style="visibility:visible"/></g><g opacity="0"><path id="transparent"/></g><path id="point"/></g></svg>';
    const scope = window.document.querySelector("#scope") as unknown as SVGGraphicsElement;
    const rect = (left: number, top: number, width: number, height: number) => ({
      bottom: top + height, height, left, right: left + width, top, width,
      x: left, y: top, toJSON: () => ({}),
    });
    const node = (id: string) => window.document.querySelector(`#${id}`) as unknown as SVGGraphicsElement;
    Object.defineProperty(node("line"), "getBoundingClientRect", { value: () => rect(4, 8, 20, 0) });
    Object.defineProperty(node("hidden"), "getBoundingClientRect", { value: () => rect(0, 0, 10, 10) });
    Object.defineProperty(node("override"), "getBoundingClientRect", { value: () => rect(0, 0, 10, 10) });
    Object.defineProperty(node("transparent"), "getBoundingClientRect", { value: () => rect(0, 0, 10, 10) });
    Object.defineProperty(node("point"), "getBoundingClientRect", { value: () => rect(4, 8, 0, 0) });
    expect(renderedClientRect(node("line"), scope)).toMatchObject({ height: 0, width: 20 });
    expect(renderedClientRect(node("hidden"), scope)).toBeUndefined();
    expect(renderedClientRect(node("override"), scope)).toMatchObject({ height: 10, width: 10 });
    expect(renderedClientRect(node("transparent"), scope)).toBeUndefined();
    expect(renderedClientRect(node("point"), scope)).toBeUndefined();
  });
});
