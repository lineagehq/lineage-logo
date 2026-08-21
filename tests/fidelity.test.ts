import { readFile } from "node:fs/promises";
import path from "node:path";
import { SVG, registerWindow, type Svg } from "@svgdotjs/svg.js";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

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
});
