import { readFile } from "node:fs/promises";
import path from "node:path";
import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";
import { isSelectableNode, serializeSvg } from "../src/client/canvas/editor";
import { automaticPreviewTargetId } from "../src/client/preview";
import { validateSvg } from "../src/server/workspace";

const fixturePath = path.resolve("tests/fixtures/workspace/concepts/complex-seatify.svg");
const constellationFixturePath = path.resolve("examples/seatify-constellation.svg");
const prohibitedConstellationCopyPath = path.resolve("tests/fixtures/workspace/concepts/seatify-constellation.svg");
const editableSelector = "g, path, rect, circle, ellipse, polygon, polyline, line, text";
const resourceSelector = "defs, metadata, clipPath, mask, filter, linearGradient, radialGradient, pattern, marker, symbol";

function parseSvg(source: string): { window: Window; root: SVGSVGElement } {
  const window = new Window();
  window.document.body.innerHTML = source;
  return {
    window,
    root: window.document.querySelector("svg") as unknown as SVGSVGElement,
  };
}

function selectableNodes(root: SVGSVGElement): Element[] {
  return Array.from(root.querySelectorAll(editableSelector)).filter((node) => isSelectableNode(node, root));
}

function selectableDepth(node: Element, root: SVGSVGElement): number {
  let depth = 0;
  let current = node.parentElement as Element | null;
  while (current && current !== root) {
    if (isSelectableNode(current, root)) depth += 1;
    current = current.parentElement as Element | null;
  }
  return depth + 1;
}

function ancestrySignature(node: Element, root: SVGSVGElement): string {
  const ids: string[] = [];
  let current: Element | null = node;
  while (current && current !== root) {
    if (isSelectableNode(current, root)) ids.unshift(current.id);
    current = current.parentElement as Element | null;
  }
  return ids.join("/");
}

function expectSafeLocalSvg(source: string, root: SVGSVGElement): void {
  expect(root.querySelector("style, foreignObject, script")).toBeNull();
  expect(source).not.toMatch(/\son[a-z]+\s*=/i);
  for (const node of [root, ...Array.from(root.querySelectorAll("*"))]) {
    for (const attribute of Array.from(node.attributes)) {
      if (attribute.name === "xmlns") continue;
      expect(attribute.value).not.toMatch(/(?:https?:|file:|data:|javascript:)/i);
      if (attribute.name === "href" || attribute.name === "xlink:href") {
        expect(attribute.value).toMatch(/^#[A-Za-z_][\w:.-]*$/);
      }
    }
  }
}

describe("canonical Seatify constellation fixture", () => {
  it("selects a useful preview target from accessible structure without fixture-specific IDs", async () => {
    const source = await readFile(constellationFixturePath, "utf8");
    const window = new Window();
    vi.stubGlobal("DOMParser", window.DOMParser);
    try {
      expect(automaticPreviewTargetId(source)).toBe("constellation-mark");
      expect(automaticPreviewTargetId(`<svg><g id="arbitrary-symbol" aria-label="Product symbol"><path id="shape" d="M0 0h10v10z"/></g><g id="words" aria-label="Product wordmark"><text>Product</text></g></svg>`))
        .toBe("arbitrary-symbol");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("is the sole fixture source and has the expected safe, accessible structure", async () => {
    const source = await readFile(constellationFixturePath, "utf8");
    await expect(readFile(prohibitedConstellationCopyPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(() => validateSvg(source)).not.toThrow();

    const { root } = parseSvg(source);
    expect(root.getAttribute("viewBox")).toBe("0 0 1024 640");
    expect(root.getAttribute("role")).toBe("img");
    expect(root.getAttribute("aria-label")).toBe("Seatify constellation logo");
    expect(root.querySelector(":scope > title")?.textContent).toBe("Seatify optimized seating constellation");
    expect(root.querySelector(":scope > desc")?.textContent).toContain("Six abstract seats");

    const selectable = selectableNodes(root);
    expect(selectable).toHaveLength(44);
    expect(selectable.every((node) => node.id.length > 0 && (node.getAttribute("aria-label")?.trim().length ?? 0) > 0)).toBe(true);
    expect(new Set(selectable.map((node) => node.getAttribute("aria-label"))).size).toBe(selectable.length);

    const ids = Array.from(root.querySelectorAll("[id]")).map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const requiredId of [
      "constellation-logo",
      "constellation-mark",
      "constellation-seat-gradient",
      "constellation-table-gradient",
      "circular-table",
      "seat-north",
      "seat-northwest",
      "constellation-wordmark",
      "constellation-title",
    ]) {
      expect(root.querySelector(`#${requiredId}`)).not.toBeNull();
    }

    expect(root.querySelectorAll("linearGradient, radialGradient")).toHaveLength(2);
    expect(root.querySelectorAll("#constellation-mark > g[id^='seat-']")).toHaveLength(6);
    expect(root.querySelectorAll("text")).toHaveLength(3);
    expect(root.querySelectorAll("#constellation-mark > g[transform]")).toHaveLength(6);
    expect(root.querySelector("#seat-northeast")?.getAttribute("transform")).toBe("translate(467 235) rotate(60)");
    expect(root.querySelector("#table-surface")?.getAttribute("fill")).toBe("url(#constellation-table-gradient)");
    expect(root.querySelector("#seat-north-base")?.getAttribute("fill")).toBe("url(#constellation-seat-gradient)");
    expectSafeLocalSvg(source, root);
  });

  it("preserves structure, accessibility, transforms, text, and references through a clean round trip", async () => {
    const source = await readFile(constellationFixturePath, "utf8");
    const { root } = parseSvg(source);
    const before = selectableNodes(root);
    const beforeReferences = Array.from(source.matchAll(/url\(#([^)]+)\)/g), (match) => match[1]).sort();

    root.setAttribute("data-lineage-added-role", "false");
    root.querySelector("#seat-north")?.setAttribute("data-lineage-key", "element-1");
    root.querySelector("#constellation-title")?.setAttribute("data-lineage-review-highlight", "true");

    const clean = serializeSvg(root, true);
    expect(clean).not.toContain("data-lineage-");
    expect(() => validateSvg(clean)).not.toThrow();

    const { root: reopened } = parseSvg(clean);
    const after = selectableNodes(reopened);
    expect(after.map((node) => node.id)).toEqual(before.map((node) => node.id));
    expect(after.map((node) => node.getAttribute("aria-label"))).toEqual(before.map((node) => node.getAttribute("aria-label")));
    expect(after.map((node) => ancestrySignature(node, reopened))).toEqual(before.map((node) => ancestrySignature(node, root)));
    expect(Array.from(clean.matchAll(/url\(#([^)]+)\)/g), (match) => match[1]).sort()).toEqual(beforeReferences);
    expect(reopened.getAttribute("viewBox")).toBe("0 0 1024 640");
    expect(reopened.querySelector("#seat-southeast")?.getAttribute("transform")).toBe("translate(467 405) rotate(120)");
    expect(reopened.querySelector("#constellation-title")?.textContent).toBe("seatify");
    expect(serializeSvg(reopened, true)).toBe(clean);
  });
});

describe("complex Seatify fixture", () => {
  it("provides a bounded, meaningful hierarchy with safe local resources", async () => {
    const source = await readFile(fixturePath, "utf8");
    expect(() => validateSvg(source)).not.toThrow();

    const { root } = parseSvg(source);
    const selectable = selectableNodes(root);
    expect(selectable).toHaveLength(42);
    expect(selectable.length).toBeGreaterThanOrEqual(30);
    expect(selectable.length).toBeLessThanOrEqual(50);
    expect(Math.max(...selectable.map((node) => selectableDepth(node, root)))).toBeGreaterThanOrEqual(4);
    expect(selectable.every((node) => node.id.length > 0 && (node.getAttribute("aria-label")?.trim().length ?? 0) > 0)).toBe(true);
    expect(new Set(selectable.map((node) => node.getAttribute("aria-label"))).size).toBe(selectable.length);

    const ids = Array.from(root.querySelectorAll("[id]")).map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const requiredId of [
      "venue-logo",
      "venue-mark",
      "stage-zone",
      "seating-map",
      "access-routes",
      "ticket-accent",
      "wordmark",
    ]) {
      expect(root.querySelector(`#${requiredId}`)).not.toBeNull();
    }

    expect(root.querySelector("linearGradient")).not.toBeNull();
    expect(root.querySelector("clipPath, mask")).not.toBeNull();
    expect(root.querySelector("path")).not.toBeNull();
    expect(root.querySelector("text")).not.toBeNull();
    expect(root.querySelector("[stroke]")).not.toBeNull();
    expect(root.querySelector("[opacity]")).not.toBeNull();
    expect(root.querySelectorAll("[transform] [transform]").length).toBeGreaterThan(0);
    expectSafeLocalSvg(source, root);

    const referencedLeaves = Array.from(root.querySelectorAll("[fill*='url('], [stroke*='url('], [clip-path*='url('], [mask*='url('], [filter*='url(']"));
    expect(referencedLeaves.map((node) => node.id).sort()).toEqual([
      "ticket-ribbon",
      "ticket-stub",
      "venue-shell-frame",
    ]);
    for (const leaf of referencedLeaves) {
      expect(isSelectableNode(leaf, root)).toBe(true);
      expect(leaf.querySelector(editableSelector)).toBeNull();
      const wrapper = leaf.parentElement;
      expect(wrapper?.localName).toBe("g");
      expect(wrapper?.id).not.toBe("");
      expect(wrapper?.hasAttribute("transform")).toBe(true);
      expect(wrapper && isSelectableNode(wrapper, root)).toBe(true);
      for (const attribute of Array.from(leaf.attributes)) {
        for (const match of attribute.value.matchAll(/url\(#([^)]+)\)/g)) {
          const target = root.querySelector(`#${match[1]}`);
          expect(target).not.toBeNull();
          expect(target?.closest(resourceSelector)).not.toBeNull();
        }
      }
    }

    const westSeats = Array.from(root.querySelectorAll("#table-cluster-west > circle")).slice(1);
    expect(westSeats).toHaveLength(4);
    expect(westSeats.every((node) => node.parentElement?.id === "table-cluster-west")).toBe(true);
  });

  it("preserves identities, hierarchy, labels, transforms, and resource references through a clean round trip", async () => {
    const source = await readFile(fixturePath, "utf8");
    const { root } = parseSvg(source);
    const before = selectableNodes(root);
    const beforeSignatures = before.map((node) => ancestrySignature(node, root));
    const beforeReferences = Array.from(source.matchAll(/url\(#([^)]+)\)/g), (match) => match[1]).sort();

    root.setAttribute("data-lineage-added-role", "false");
    root.querySelector("#ticket-ribbon")?.setAttribute("data-lineage-key", "element-34");
    root.querySelector("#east-seat-north")?.setAttribute("data-lineage-secondary", "true");
    root.querySelector("#seatify-title")?.setAttribute("data-lineage-review-highlight", "true");

    const clean = serializeSvg(root, true);
    expect(clean).not.toContain("data-lineage-");
    expect(() => validateSvg(clean)).not.toThrow();

    const { root: reopened } = parseSvg(clean);
    const after = selectableNodes(reopened);
    expect(after.map((node) => node.id)).toEqual(before.map((node) => node.id));
    expect(after.map((node) => node.getAttribute("aria-label"))).toEqual(before.map((node) => node.getAttribute("aria-label")));
    expect(after.map((node) => ancestrySignature(node, reopened))).toEqual(beforeSignatures);
    expect(Array.from(clean.matchAll(/url\(#([^)]+)\)/g), (match) => match[1]).sort()).toEqual(beforeReferences);
    expect(reopened.querySelector("#venue-logo")?.getAttribute("transform")).toBe("translate(42 34)");
    expect(reopened.querySelector("#table-clusters")?.getAttribute("transform")).toBe("rotate(1 350 360)");
    expect(reopened.querySelector("#ticket-ribbon")?.getAttribute("clip-path")).toBe("url(#ticket-ribbon-clip)");
    expect(reopened.querySelector("#ticket-stub")?.getAttribute("mask")).toBe("url(#ticket-stub-mask)");
    expect(reopened.querySelector("#venue-shell-frame")?.getAttribute("fill")).toBe("url(#venue-gradient)");
    expect(serializeSvg(reopened, true)).toBe(clean);
  });
});
