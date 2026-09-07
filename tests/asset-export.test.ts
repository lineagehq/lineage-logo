// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { SaxesParser } from "saxes";
import { buildSvgAsset, renderPngAsset } from "../src/client/export/assets";
const wrap = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">${body}</svg>`;
const options = { measure: () => ({ x: 10, y: 5, width: 80, height: 20 }), hasFont: () => true };
describe("asset export", () => {
  it("preserves transitive defs and text without mutating source and removes unrelated artwork", () => {
    const source = wrap('<defs><linearGradient id="base"><stop stop-color="white"/></linearGradient><linearGradient id="paint" href="#base"/></defs><g id="mark"><rect width="80" height="20" fill="url(#paint)"/><text>Brand</text></g><text id="tagline">Elsewhere</text>');
    const result = buildSvgAsset(source, { targetId: "mark" }, options);
    const tags: string[] = []; const parser = new SaxesParser({ xmlns: true }); parser.on("opentag", tag => tags.push(tag.local)); parser.write(result).close();
    expect(tags.filter(tag => tag === "linearGradient")).toHaveLength(2);
    expect(result).toContain('href="#base"'); expect(result).toContain("Brand"); expect(result).not.toContain("Elsewhere"); expect(source).toContain("Elsewhere");
    expect(new DOMParser().parseFromString(result, "image/svg+xml").documentElement.getAttribute("viewBox")).toBe("3.6 -1.4 92.8 32.8");
  });
  it.each([['<g id="mark" display="none"><rect width="10" height="10"/></g>', /hidden/], ['<g id="mark"><rect fill="url(#missing)"/></g>', /Missing local resource/], ['<text id="mark" font-family="Absent">Words</text>', /unavailable locally/]])("refuses misleading target success", (body, message) => {
    expect(() => buildSvgAsset(wrap(body), { targetId: "mark" }, { ...options, hasFont: () => false })).toThrow(message);
  });
  it("does not substitute whole artwork for a missing target", () => expect(() => buildSvgAsset(wrap('<rect width="20" height="20"/>'), { targetId: "missing" }, options)).toThrow(/visible artwork/));
  it("reports unsupported resources and refuses malformed bounds", () => {
    expect(() => buildSvgAsset(wrap('<image href="https://example.com/x.png"/>'), {}, options)).toThrow(/local resources/);
    expect(() => buildSvgAsset(wrap('<style>rect{fill:red}</style>'), {}, options)).toThrow(/stylesheet/);
    expect(() => buildSvgAsset(wrap('<rect/>').replace('100 50', '0 0'), {}, options)).toThrow(/viewBox/);
  });
  it("keeps white paint and wide/tall viewBoxes", () => {
    for (const box of ["0 0 1000 20", "0 0 20 1000"]) expect(buildSvgAsset(wrap('<rect fill="white" width="20" height="20"/>').replace("0 0 100 50", box), {}, options)).toContain(`viewBox="${box}"`);
  });
  it("validates retained use-referenced text rather than only direct target descendants", () => {
    const source = wrap('<defs><text id="letters" y="30" font-family="Absent">Brand</text></defs><use id="mark" href="#letters"/>');
    expect(() => buildSvgAsset(source, { targetId: "mark" }, { ...options, hasFont: () => false })).toThrow(/unavailable locally/);
  });
  it("validates font inheritance through nested use instances and respects text overrides", () => {
    const source = wrap('<defs><text id="letters" y="30">Brand</text><g id="nested"><use href="#letters"/></g></defs><use id="mark" href="#nested" font-family="Absent"/>');
    const fonts = { ...options, hasFont: (family: string) => family !== "Absent" };
    for (const request of [{}, { targetId: "mark" }]) {
      expect(() => buildSvgAsset(source, request, fonts)).toThrow(/unavailable locally/);
      expect(() => buildSvgAsset(source.replace('id="letters"', 'id="letters" font-family="serif"'), request, fonts)).not.toThrow();
    }
  });
  it("retains the percentage reference viewport inside the crop", () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect id="mark" x="25%" y="25%" width="50%" height="50%" fill="red"/></svg>';
    const result = buildSvgAsset(source, { targetId: "mark" }, { ...options, measure: () => ({x:100,y:100,width:200,height:200}) });
    const root = new DOMParser().parseFromString(result,"image/svg+xml").documentElement;
    expect(root.getAttribute("viewBox")).toBe("84 84 232 232");
    expect(root.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 400 400");
    expect(root.querySelector("svg")?.getAttribute("width")).toBe("400");
    expect(root.querySelector("#mark")?.getAttribute("width")).toBe("50%");
  });
  it("rejects invalid PNG dimensions before decoding", async () => {
    for (const size of [0, -1, 4097, 1.5, NaN]) await expect(renderPngAsset(wrap(""), { size, background: "transparent" })).rejects.toThrow(/size/);
  });
});
