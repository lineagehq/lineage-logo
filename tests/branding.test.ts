import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Lineage Logo branding", () => {
  it("uses the endpoint-free negative-space mark in the editor favicon and top bar", () => {
    const source = readFileSync("src/client/main.ts", "utf8");
    const styles = readFileSync("src/client/styles.css", "utf8");

    expect(source).toContain('import brandIconSvg from "../../site/favicon.svg?raw";');
    expect(source).not.toContain("const brandIconSvg =");
    expect(source).toContain("new Blob([brandIconSvg]");
    expect(source).toContain('${brandIconSvg}</span><span>Lineage Logo</span>');
    expect(source).not.toContain("#CB6748");
    expect(styles).toContain(".brand-mark svg");
  });

  it("uses the same endpoint-free mark for the landing-page favicon and navigation", () => {
    expect(existsSync("site/favicon.svg")).toBe(true);
    if (!existsSync("site/favicon.svg")) return;

    const favicon = readFileSync("site/favicon.svg", "utf8");
    const page = readFileSync("site/index.html", "utf8");
    const styles = readFileSync("site/styles.css", "utf8");

    expect(favicon).toContain('id="lineage-cutout"');
    expect(favicon).not.toContain("#CB6748");
    expect(page).toContain('<link rel="icon" href="favicon.svg" type="image/svg+xml" sizes="any">');
    expect(page).toContain('<strong class="site-brand"><img src="favicon.svg" alt="" width="25" height="25">Lineage Logo</strong>');
    expect(styles).toContain(".site-brand img");
  });
});
