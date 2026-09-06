import { describe, expect, it } from "vitest";
import { documentFrame, extendedDocumentBounds, fitDocumentZoom } from "../src/client/canvas/document-frame";

const svg = (attributes: Record<string, string>) => ({ getAttribute: (name: string) => attributes[name] ?? null });
describe("document frame presentation contract", () => {
  it("uses native viewBox units including nonzero origins instead of authored display dimensions", () => {
    expect(documentFrame(svg({ viewBox: "-20, 30, 600, 100", width: "1200", height: "200" })))
      .toEqual({ x: -20, y: 30, width: 600, height: 100, basis: "viewBox" });
  });
  it("uses absolute pixel dimensions or an explicit browser-default fallback", () => {
    expect(documentFrame(svg({ width: "80px", height: "320" }))).toMatchObject({ width: 80, height: 320, basis: "dimensions" });
    for (const viewBox of ["0 0 0 20", "0 0 NaN 20", "0 0 -10 20", "0 0 10 20 30"]) {
      expect(documentFrame(svg({ viewBox, width: "100%", height: "1em" })))
        .toMatchObject({ width: 300, height: 150, basis: "fallback" });
    }
  });
  it("fits wide/tall and large documents without the former 25% lower limit", () => {
    expect(fitDocumentZoom(600, 300, 600, 100)).toBe(1);
    expect(fitDocumentZoom(600, 300, 100, 600)).toBe(0.5);
    expect(fitDocumentZoom(600, 300, 6000, 1000)).toBe(0.1);
    expect(fitDocumentZoom(0, 300, 600, 100)).toBe(1);
  });
});

it("extends scroll bounds for negative-origin artwork without changing the document", () => {
  const frame = documentFrame(svg({ viewBox: "10 20 600 100" }));
  expect(extendedDocumentBounds(frame, { x: -90, y: -80, width: 50, height: 50 }))
    .toEqual({ x: -90, y: -80, width: 700, height: 200, basis: "viewBox" });
  expect(frame).toMatchObject({ x: 10, y: 20, width: 600, height: 100 });
});
