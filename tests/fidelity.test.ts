import { readFile } from "node:fs/promises";
import path from "node:path";
import { SVG, registerWindow, type Svg } from "@svgdotjs/svg.js";
import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";
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
import { createSvgPreview, eligiblePreviewTargetIds, paintedLocalBounds } from "../src/client/preview";

describe("SVG.js fidelity spike", () => {
  it("preserves explicit root sizing and representative safe structures in clean serialization", () => {
    const window = new Window();
    window.document.body.innerHTML = `<svg width="640" height="360" viewBox="0 0 64 36" data-custom="root">
      <metadata id="author">Unrelated metadata</metadata><title>Logo title</title>
      <defs><linearGradient id="paint"><stop offset="0" stop-color="#fff" /></linearGradient><symbol id="shape"><path d="M0 0h2v2z" /></symbol></defs>
      <g id="layer" transform="translate(4 5)" style="opacity:.8" data-custom="layer"><text>Brand</text><use href="#shape" fill="url(#paint)" /></g>
      <switch requiredFeatures="feature"><path d="M0 0" /></switch>
    </svg>`;
    const root = window.document.querySelector("svg") as unknown as SVGSVGElement;
    const output = serializeSvg(root, true);
    const reopened = new Window();
    reopened.document.body.innerHTML = output;
    const svg = reopened.document.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("640");
    expect(svg.getAttribute("height")).toBe("360");
    expect(svg.getAttribute("data-custom")).toBe("root");
    expect(svg.querySelector("#layer")?.getAttribute("transform")).toBe("translate(4 5)");
    expect(svg.querySelector("#layer")?.getAttribute("style")).toBe("opacity:.8");
    expect(svg.querySelector("text")?.textContent).toBe("Brand");
    expect(svg.querySelector("use")?.getAttribute("href")).toBe("#shape");
    expect(svg.querySelector("use")?.getAttribute("fill")).toBe("url(#paint)");
    expect(svg.querySelector("switch")).not.toBeNull();
    expect(svg.querySelector('metadata#author')?.textContent).toBe("Unrelated metadata");
  });
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

describe("detached targeted previews", () => {
  function withSvgDom<T>(run: (window: Window) => T): T {
    const window = new Window();
    vi.stubGlobal("DOMParser", window.DOMParser);
    try { return run(window); } finally { vi.unstubAllGlobals(); }
  }

  const source = `<svg width="640" height="240" viewBox="0 0 640 240" data-source="exact">
    <defs><linearGradient id="paint"><stop offset="0" stop-color="#fff"/></linearGradient><filter id="shadow"><feGaussianBlur stdDeviation="2"/></filter></defs>
    <g id="logo"><g id="icon" filter="url(#shadow)"><path id="wave" fill="url(#paint)" d="M20 20h80v80H20z"/></g><text id="wordmark" x="140" y="80">BleepThat</text></g>
  </svg>`;

  it("requests painted bounds so thick strokes and markers are not cropped", () => {
    const getBBox = vi.fn(() => ({ x: -10, y: -10, width: 30, height: 30 }));
    expect(paintedLocalBounds({ getBBox } as unknown as SVGGraphicsElement)).toEqual({ x: -10, y: -10, width: 30, height: 30 });
    expect(getBBox).toHaveBeenCalledWith({ fill: true, stroke: true, markers: true, clipped: true });
  });

  it("defaults to #icon, keeps local resources and references, and crops only the detached clone", () => withSvgDom(() => {
    const preview = createSvgPreview(source, undefined, () => ({ x: 20, y: 20, width: 80, height: 80 }));
    expect(preview).toMatchObject({ targetId: "icon", fallback: false, status: "Previewing #icon." });
    expect(preview.svg).toContain('viewBox="13.6 13.6 92.8 92.8"');
    expect(preview.svg).toContain('id="paint"');
    expect(preview.svg).toContain('fill="url(#paint)"');
    expect(preview.svg).toContain('filter="url(#shadow)"');
    expect(preview.svg).not.toContain("wordmark");
    expect(preview.svg).not.toContain("BleepThat");
    expect(preview.svg).not.toContain('width="640"');
    expect(source).toContain('viewBox="0 0 640 240"');
  }));

  it("supports another explicit eligible target without altering the source", () => withSvgDom(() => {
    const preview = createSvgPreview(source, "#wordmark", () => ({ x: 140, y: 40, width: 220, height: 50 }));
    expect(preview.targetId).toBe("wordmark");
    expect(preview.fallback).toBe(false);
    expect(eligiblePreviewTargetIds(source)).toEqual(["logo", "icon", "wave", "wordmark"]);
    expect(source).toContain('width="640"');
  }));

  it("keeps the full transitive local reference graph outside defs and prunes unrelated branches", () => withSvgDom(() => {
    const graph = `<svg viewBox="0 0 200 200">
      <g id="library"><symbol id="glyph"><path d="M0 0h10v10z" fill="url(#gradient)"/></symbol><linearGradient id="gradient" href="#gradient-base"><stop offset="1"/></linearGradient><linearGradient id="gradient-base"><stop offset="0"/></linearGradient></g>
      <clipPath id="clip"><use href="#glyph"/></clipPath><mask id="mask"><use href="#glyph"/></mask><filter id="filter"><feFlood flood-color="red"/></filter><pattern id="pattern"><use href="#glyph"/></pattern><marker id="marker"><use href="#glyph"/></marker>
      <g id="icon" clip-path="url(#clip)" mask="url(#mask)" filter="url(#filter)" fill="url(#pattern)" marker-start="url(#marker)"><use href="#glyph"/></g>
      <g id="unrelated"><rect width="200" height="200"/></g>
    </svg>`;
    const preview = createSvgPreview(graph, "#icon", () => ({ x: 1, y: 2, width: 20, height: 30 }));
    expect(preview.fallback).toBe(false);
    for (const id of ["glyph", "gradient", "gradient-base", "clip", "mask", "filter", "pattern", "marker"]) {
      expect(preview.svg).toContain(`id="${id}"`);
    }
    expect(preview.svg).not.toContain('id="unrelated"');
  }));

  it("closes references from retained ancestors, root inheritance, applicable styles, and custom properties", () => withSvgDom(() => {
    const graph = `<svg viewBox="0 0 200 200" fill="url(#root-paint)">
      <style>.theme { --accent: url(#custom-paint); stroke: var(--accent) } #icon { filter: url(#styled-filter) } #other { fill: url(#unrelated-paint) }</style>
      <defs>
        <linearGradient id="root-paint" href="#base-paint"/><linearGradient id="base-paint"/>
        <linearGradient id="custom-paint"/><filter id="styled-filter"><feFlood/></filter>
        <linearGradient id="unrelated-paint"/>
      </defs>
      <g id="logo" class="theme" clip-path="url(#ancestor-clip)"><clipPath id="ancestor-clip"><use href="#clip-shape"/></clipPath><path id="clip-shape" d="M0 0h20v20z"/><g id="icon"><rect width="20" height="20"/></g><text id="other">Other</text></g>
    </svg>`;
    const preview = createSvgPreview(graph, "#icon", () => ({ x: 0, y: 0, width: 20, height: 20 }));
    expect(preview.fallback).toBe(false);
    for (const id of ["root-paint", "base-paint", "custom-paint", "styled-filter", "ancestor-clip", "clip-shape"]) {
      expect(preview.svg).toContain(`id="${id}"`);
    }
    expect(preview.svg).not.toContain('id="unrelated-paint"');
    expect(preview.svg).not.toContain('id="other"');
  }));

  it("reaches a true fixed point when newly retained styled resources add references", () => withSvgDom(() => {
    const graph = `<svg viewBox="0 0 100 100">
      <style>
        #icon { filter: url(#first) }
        :is(#first, .never) .styled-resource { fill: var(--paint) }
        .styled-resource { --paint: url(#second) }
        #second { stroke: url(#third) }
        #unrelated { fill: url(#unused) }
      </style>
      <defs>
        <filter id="first"><feImage class="styled-resource" href="#shape"/></filter>
        <linearGradient id="second"/><linearGradient id="third"/>
        <path id="shape" d="M0 0h10v10z"/><linearGradient id="unused"/>
      </defs>
      <g id="icon"><rect width="10" height="10"/></g><g id="unrelated"/>
    </svg>`;
    const preview = createSvgPreview(graph, "#icon", () => ({ x: 0, y: 0, width: 10, height: 10 }));
    expect(preview.fallback).toBe(false);
    for (const id of ["first", "shape", "second", "third"]) expect(preview.svg).toContain(`id="${id}"`);
    expect(preview.svg).not.toContain('id="unused"');
    expect(preview.svg).not.toContain('id="unrelated"');
  }));

  it("iterates inherited custom-property references on every newly retained ancestor", () => withSvgDom(() => {
    const graph = `<svg viewBox="0 0 100 100" style="--root-paint:url(#root-paint);fill:var(--root-paint)">
      <defs>
        <g id="first-ancestors" style="--inherited-paint:url(#second)">
          <filter id="first"><feImage href="#shape" fill="var(--inherited-paint)"/></filter>
        </g>
        <g id="second-ancestors" style="--next-paint:url(#third)">
          <linearGradient id="second" style="stroke:var(--next-paint)"/>
        </g>
        <linearGradient id="third"/><linearGradient id="root-paint"/>
        <path id="shape" d="M0 0h10v10z"/><linearGradient id="unused"/>
      </defs>
      <g id="icon" filter="url(#first)"><rect width="10" height="10"/></g>
      <g id="unrelated" fill="url(#unused)"/>
    </svg>`;
    const preview = createSvgPreview(graph, "#icon", () => ({ x: 0, y: 0, width: 10, height: 10 }));
    expect(preview.fallback).toBe(false);
    for (const id of ["first", "first-ancestors", "shape", "second", "second-ancestors", "third", "root-paint"]) {
      expect(preview.svg).toContain(`id="${id}"`);
    }
    expect(preview.svg).not.toContain('id="unused"');
    expect(preview.svg).not.toContain('id="unrelated"');
  }));

  it("follows only used custom-property paths and excludes unused referenced branches", () => withSvgDom(() => {
    const graph = `<svg viewBox="0 0 100 100" style="--used:url(#kept);--unused:url(#other)">
      <defs><linearGradient id="kept"/><linearGradient id="other"/></defs>
      <g id="icon" style="fill:var(--used)"><rect width="10" height="10"/></g>
    </svg>`;
    const preview = createSvgPreview(graph, "#icon", () => ({ x: 0, y: 0, width: 10, height: 10 }));
    expect(preview.fallback).toBe(false);
    expect(preview.svg).toContain('id="kept"');
    expect(preview.svg).not.toContain('id="other"');
  }));

  it.each([
    ["complex selector", '<style>:is(#icon, .other) { display: none }</style>'],
    ["calculated zero", '<style>#icon { opacity: calc(25% - 25%) }</style>'],
    ["escaped selector and keyword", '<style>#\\69 con { visibility: h\\69 dden }</style>'],
    ["escaped property and collapse", '<style>#icon { vis\\69 bility: c\\6f llapse }</style>'],
  ])("falls back for browser-valid %s stylesheet hiding", (_reason, rule) => withSvgDom(() => {
    const hidden = source.replace("<defs>", `${rule}<defs>`);
    const preview = createSvgPreview(hidden, "#icon", () => ({ x: 0, y: 0, width: 10, height: 10 }));
    expect(preview.fallback).toBe(true);
    expect(preview.status).toBe("Whole SVG fallback: #icon is hidden.");
  }));

  it.each([
    ["later stylesheet rule", '<style>#icon { display: none } #icon { display: block }</style>', 'id="icon"'],
    ["inline style", '<style>#icon { visibility: hidden }</style>', 'id="icon" style="visibility: visible"'],
    ["stylesheet over presentation", '<style>#icon { display: block }</style>', 'id="icon" display="none"'],
  ])("does not report a visible target hidden after a %s override", (_reason, rule, target) => withSvgDom(() => {
    const visible = source.replace("<defs>", `${rule}<defs>`).replace('id="icon"', target);
    const preview = createSvgPreview(visible, "#icon", () => ({ x: 0, y: 0, width: 10, height: 10 }));
    expect(preview).toMatchObject({ fallback: false, targetId: "icon", status: "Previewing #icon." });
  }));

  it("ignores hidden declarations inside false media conditions", () => withSvgDom(() => {
    const visible = source.replace("<defs>", '<style>@media (max-width: 0px) { #icon { display: none } }</style><defs>');
    const preview = createSvgPreview(visible, "#icon", () => ({ x: 0, y: 0, width: 10, height: 10 }));
    expect(preview).toMatchObject({ fallback: false, targetId: "icon", status: "Previewing #icon." });
  }));

  it("allows a target to override inherited ancestor visibility", () => withSvgDom(() => {
    const visible = source.replace('id="logo"', 'id="logo" visibility="hidden"')
      .replace('id="icon"', 'id="icon" visibility="visible"');
    const preview = createSvgPreview(visible, "#icon", () => ({ x: 0, y: 0, width: 10, height: 10 }));
    expect(preview).toMatchObject({ fallback: false, targetId: "icon", status: "Previewing #icon." });
  }));

  it("keeps stylesheet ancestry and falls back when pruning would change structural selectors", () => withSvgDom(() => {
    const insideDefs = source.replace("<defs>", '<defs><style>#icon { opacity:.5 }</style>');
    const preview = createSvgPreview(insideDefs, "#icon", () => ({ x: 0, y: 0, width: 10, height: 10 }));
    expect(preview.fallback).toBe(false);
    expect(preview.svg).toContain("<defs><style>");

    const structural = source.replace("<defs>", '<style>#background + #icon { opacity:.5 }</style><defs>')
      .replace('<g id="logo">', '<g id="logo"><path id="background"/>');
    expect(createSvgPreview(structural, "#icon", () => ({ x: 0, y: 0, width: 10, height: 10 })))
      .toMatchObject({ fallback: true, status: expect.stringContaining("ambiguous local reference graph") });
  }));

  it.each([
    ["higher selector specificity", '<style>#icon { display: none } .icon { display: block }</style>', 'id="icon" class="icon"'],
    ["important priority", '<style>#icon { visibility: hidden !important } #icon { visibility: visible }</style>', 'id="icon"'],
    ["zero-specificity :where", '<style>#icon { display: none } :where(#icon) { display: block }</style>', 'id="icon"'],
    ["lexicographic specificity", '<style>#icon { display: none } .a.b.c.d.e.f.g.h.i.j { display: block }</style>', 'id="icon" class="a b c d e f g h i j"'],
  ])("respects %s when deciding whether a preview target is hidden", (_reason, rule, target) => withSvgDom(() => {
    const hidden = source.replace("<defs>", `${rule}<defs>`).replace('id="icon"', target);
    const preview = createSvgPreview(hidden, "#icon", () => ({ x: 0, y: 0, width: 10, height: 10 }));
    expect(preview).toMatchObject({ fallback: true, status: "Whole SVG fallback: #icon is hidden." });
  }));

  it.each([
    ["escaped display", 'display="n\\6f ne"'],
    ["escaped visibility", 'visibility="h\\69 dden"'],
    ["calculated inline opacity", 'style="opacity: calc((1 - 1) * 2)"'],
  ])("falls back for browser-valid %s presentation hiding", (_reason, attribute) => withSvgDom(() => {
    const hidden = source.replace('id="icon"', `id="icon" ${attribute}`);
    const preview = createSvgPreview(hidden, "#icon", () => ({ x: 0, y: 0, width: 10, height: 10 }));
    expect(preview.fallback).toBe(true);
    expect(preview.status).toBe("Whole SVG fallback: #icon is hidden.");
  }));

  it.each([
    ["display", "--state:none", "display:var(--state)"],
    ["visibility", "--state:collapse", "visibility:var(--state,visible)"],
    ["opacity", "--state:calc(25% - 25%)", "opacity:var(--state)"],
    ["fallback", "--unrelated:block", "display:var(--missing, none)"],
  ])("falls back for bounded var()-driven %s hiding", (_reason, definition, use) => withSvgDom(() => {
    const hidden = source.replace('id="logo"', `id="logo" style="${definition}"`)
      .replace('id="icon"', `id="icon" style="${use}"`);
    const preview = createSvgPreview(hidden, "#icon", () => ({ x: 0, y: 0, width: 10, height: 10 }));
    expect(preview.fallback).toBe(true);
    expect(preview.status).toBe("Whole SVG fallback: #icon is hidden.");
  }));

  it.each([
    ["duplicate", source.replace('id="wordmark"', 'id="icon"')],
    ["inline hidden", source.replace('id="icon"', 'id="icon" style="display:none"')],
    ["stylesheet hidden", source.replace("<defs>", "<style>#icon { visibility: hidden }</style><defs>")],
    ["ancestor hidden", source.replace('id="logo"', 'id="logo" opacity="0"')],
    ["zero opacity", source.replace('id="icon"', 'id="icon" opacity="0.0"')],
    ["percentage zero opacity", source.replace('id="icon"', 'id="icon" opacity="0%"')],
    ["collapsed", source.replace('id="icon"', 'id="icon" visibility="collapse"')],
    ["inline percentage zero opacity", source.replace('id="icon"', 'id="icon" style="opacity: 0% !important"')],
    ["stylesheet percentage zero opacity", source.replace("<defs>", "<style>#icon { opacity: 0% }</style><defs>")],
    ["ancestor collapsed inline", source.replace('id="logo"', 'id="logo" style="visibility: collapse"')],
  ])("falls back accessibly for a %s target", (reason, svg) => withSvgDom(() => {
    const preview = createSvgPreview(svg, "#icon", () => ({ x: 0, y: 0, width: 10, height: 10 }));
    expect(preview.fallback).toBe(true);
    expect(preview.status).toMatch(/^Whole SVG fallback:/);
    expect(preview.status.toLowerCase()).toMatch(/hidden|duplicated/);
    expect(preview.svg).toContain('viewBox="0 0 640 240"');
    expect(reason).toBeTruthy();
  }));

  it("falls back for non-finite and zero bounds", () => withSvgDom(() => {
    for (const bounds of [
      { x: Number.NaN, y: 0, width: 10, height: 10 },
      { x: 0, y: 0, width: 0, height: 10 },
    ]) {
      const preview = createSvgPreview(source, "#icon", () => bounds);
      expect(preview.fallback).toBe(true);
      expect(preview.status).toContain("no usable visible bounds");
    }
  }));

  it.each([
    ["#missing", source, "missing"],
    ["not-a-fragment", source, "invalid"],
    ["#icon", source.replace('id="icon"', 'id="icon" display="none"'), "hidden"],
    ["#icon", source, "usable visible bounds"],
  ])("visibly falls back for %s when the target is absent, invalid, hidden, or unusable", (target, svg, reason) => withSvgDom(() => {
    const preview = createSvgPreview(svg, target, () => undefined);
    expect(preview.fallback).toBe(true);
    expect(preview.status).toContain("Whole SVG fallback");
    expect(preview.status).toContain(reason);
    expect(preview.svg).toContain('viewBox="0 0 640 240"');
  }));
});
