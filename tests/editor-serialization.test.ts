import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { getLogicalSelectionTarget, serializeSvg } from "../src/client/canvas/editor";

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

  it("preserves accessibility attributes that came from the source SVG", () => {
    const window = new Window();
    window.document.body.innerHTML = '<svg role="img" aria-label="Original label"></svg>';
    const root = window.document.querySelector("svg") as unknown as SVGSVGElement;
    const output = serializeSvg(root, true);
    expect(output).toContain('role="img"');
    expect(output).toContain('aria-label="Original label"');
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
});
