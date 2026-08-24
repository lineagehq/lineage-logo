import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import {
  alignmentAvailability,
  alignmentOffsets,
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
  svgPaintState,
  ungroupAvailability,
  ungroupSelection,
} from "../src/client/canvas/editor";

describe("editor serialization", () => {
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

  it("strips multi-selection affordances and all editor session state from clean saves", () => {
    const window = new Window();
    window.document.body.innerHTML = '<svg><path id="mark" data-lineage-key="element-1" data-lineage-secondary="true" /></svg>';
    const root = window.document.querySelector("svg") as unknown as SVGSVGElement;

    expect(serializeSvg(root, true)).toBe('<svg><path id="mark"></path></svg>');
    expect(serializeSvg(root, false)).not.toContain("data-lineage-secondary");
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
