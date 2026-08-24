import { readFile } from "node:fs/promises";
import path from "node:path";
import { SVG, registerWindow, type Svg } from "@svgdotjs/svg.js";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import {
  applyAlignmentOffsets,
  groupAvailability,
  groupSelection,
  renameLayer,
  reorderSelection,
  serializeSvg,
  ungroupAvailability,
  ungroupSelection,
} from "../src/client/canvas/editor";

describe("SVG.js fidelity spike", () => {
  it("preserves structural features through import and serialization", async () => {
    const source = await readFile(
      path.resolve("tests/fixtures/workspace/concepts/concept-1.svg"),
      "utf8",
    );
    const window = new Window();
    window.document.body.innerHTML = source;
    registerWindow(window as never, window.document as never);
    const drawing = SVG(window.document.querySelector("svg") as never) as unknown as Svg;

    const output = drawing.svg();
    for (const id of ["accent", "round-clip", "cutout", "soft-shadow", "icon", "spark"]) {
      expect(output).toContain(`id="${id}"`);
    }
    expect(output).toContain('transform="rotate(8 256 256)"');
    expect(output).toContain('fill="url(#accent)"');
    expect(drawing.viewbox()).toMatchObject({ width: 512, height: 512 });
  });

  it("keeps hierarchy, IDs, resources, and references unchanged when editor-only context is stripped", () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <svg viewBox="0 0 20 20">
        <defs><linearGradient id="paint"><stop offset="0" /></linearGradient></defs>
        <g id="outer" transform="translate(2 3)" data-lineage-key="element-1" data-lineage-hover="true">
          <g id="inner" mask="url(#cutout)" data-lineage-key="element-2">
            <path id="mark" fill="url(#paint)" d="M0 0h10v10z" data-lineage-key="element-3" />
          </g>
        </g>
      </svg>
    `;
    const root = window.document.querySelector("svg") as unknown as SVGSVGElement;
    const output = serializeSvg(root, true);
    const reparsed = new Window();
    reparsed.document.body.innerHTML = output;

    expect(reparsed.document.querySelector("#outer > #inner > #mark")).not.toBeNull();
    expect(reparsed.document.querySelector("#outer")?.getAttribute("transform")).toBe("translate(2 3)");
    expect(reparsed.document.querySelector("#inner")?.getAttribute("mask")).toBe("url(#cutout)");
    expect(reparsed.document.querySelector("#mark")?.getAttribute("fill")).toBe("url(#paint)");
    expect(reparsed.document.querySelector("#paint")).not.toBeNull();
    expect(output).not.toContain("data-lineage-");
  });

  it("preserves the representative fixture through rename, reorder, neutral group, save, reload, and ungroup", async () => {
    const source = await readFile(path.resolve("tests/fixtures/workspace/concepts/concept-1.svg"), "utf8");
    const window = new Window();
    window.document.body.innerHTML = source;
    const root = window.document.querySelector("svg") as unknown as SVGSVGElement;
    const icon = root.querySelector("#icon") as unknown as SVGGraphicsElement;
    const rect = icon.querySelector("rect") as unknown as SVGGraphicsElement;
    const spark = icon.querySelector("#spark") as unknown as SVGGraphicsElement;
    const references = ["url(#accent)", "url(#cutout)", "url(#round-clip)", "url(#soft-shadow)"];

    expect(renameLayer(spark, "  Spark mark  ")).toBe(true);
    expect(spark.id).toBe("spark");
    expect(reorderSelection([spark], root, "earlier")).toBe(true);
    expect(Array.from(icon.children).map((node) => node.id || node.localName)).toEqual(["spark", "rect"]);
    expect(reorderSelection([spark], root, "later")).toBe(true);
    expect(groupAvailability([rect, spark], root).allowed).toBe(true);
    const neutral = groupSelection([rect, spark], root);
    expect(neutral?.attributes.length).toBe(0);

    const clean = serializeSvg(root, true);
    references.forEach((reference) => expect(clean).toContain(reference));
    expect(clean).toContain('transform="rotate(8 256 256)"');
    expect(clean).toContain('aria-label="Spark mark"');
    expect(clean).not.toContain("data-lineage-");

    const reloadedWindow = new Window();
    reloadedWindow.document.body.innerHTML = clean;
    const reloaded = reloadedWindow.document.querySelector("svg") as unknown as SVGSVGElement;
    const reloadedNeutral = reloaded.querySelector("#icon > g") as unknown as SVGGraphicsElement;
    expect(ungroupAvailability(reloadedNeutral, reloaded).allowed).toBe(true);
    expect(ungroupSelection(reloadedNeutral).map((node) => node.id || node.localName)).toEqual(["rect", "spark"]);
    references.forEach((reference) => expect(reloaded.outerHTML).toContain(reference));
    expect(reloaded.querySelector("#icon")?.getAttribute("clip-path")).toBe("url(#round-clip)");
    expect(reloaded.querySelector("#icon")?.getAttribute("filter")).toBe("url(#soft-shadow)");
  });

  it("aligns by composing only transforms while preserving hierarchy and unsupported attributes", () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <svg viewBox="0 0 100 100">
        <defs><linearGradient id="paint"><stop offset="0" /></linearGradient></defs>
        <g id="parent" clip-path="url(#clip)">
          <path id="a" d="M0 0h10v10z" transform="rotate(15)" fill="url(#paint)" vector-effect="non-scaling-stroke" data-custom="keep" />
          <g id="b" transform="translate(4 5)" mask="url(#mask)" filter="url(#fx)" aria-label="Layer B">
            <path id="child" d="M0 0h2v2z" />
          </g>
        </g>
      </svg>
    `;
    registerWindow(window as never, window.document as never);
    const root = window.document.querySelector("svg") as unknown as SVGSVGElement;
    const a = root.querySelector("#a") as unknown as SVGGraphicsElement;
    const b = root.querySelector("#b") as unknown as SVGGraphicsElement;
    const preserved = (node: SVGGraphicsElement) => Array.from(node.attributes)
      .filter((attribute) => attribute.name !== "transform")
      .map((attribute) => [attribute.name, attribute.value]);
    const beforeA = preserved(a);
    const beforeB = preserved(b);

    expect(applyAlignmentOffsets([a, b], [{ dx: 12, dy: 0 }, { dx: 0, dy: -7 }])).toBe(true);

    expect(preserved(a)).toEqual(beforeA);
    expect(preserved(b)).toEqual(beforeB);
    expect(root.querySelector("#parent > #a")).toBe(a);
    expect(root.querySelector("#parent > #b > #child")).not.toBeNull();
    expect(a.getAttribute("transform")).toMatch(/^matrix\(/);
    expect(b.getAttribute("transform")).toBe("matrix(1,0,0,1,4,-2)");
    expect(serializeSvg(root, true)).not.toContain("data-lineage-");
  });
});
