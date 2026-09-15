import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

const siteRoot = new URL("../site/", import.meta.url);

async function pngSize(path: string): Promise<{ width: number; height: number }> {
  const bytes = await readFile(new URL(path, siteRoot));
  const image = PNG.sync.read(bytes);
  return { width: image.width, height: image.height };
}

describe("published brand assets", () => {
  it.each([
    ["favicon-16.png", 16, 16],
    ["favicon-32.png", 32, 32],
    ["apple-touch-icon.png", 180, 180],
    ["assets/brand/github-avatar.png", 512, 512],
    ["assets/brand/social-card.png", 1200, 630],
    ["assets/brand/github-social-preview.png", 1280, 640],
  ])("ships %s at %ix%i", async (path, width, height) => {
    await expect(pngSize(path)).resolves.toEqual({ width, height });
  });

  it("publishes favicon, touch-icon, Open Graph, and Twitter card metadata", async () => {
    const html = await readFile(new URL("index.html", siteRoot), "utf8");
    const window = new Window({ url: "https://lineagehq.github.io/lineage-logo/" });
    window.document.write(html);
    const document = window.document;

    expect(document.querySelector('link[rel="icon"][type="image/svg+xml"]')?.getAttribute("href")).toBe("favicon.svg");
    expect(document.querySelector('link[rel="icon"][sizes="32x32"]')?.getAttribute("href")).toBe("favicon-32.png");
    expect(document.querySelector('link[rel="icon"][sizes="16x16"]')?.getAttribute("href")).toBe("favicon-16.png");
    expect(document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href")).toBe("apple-touch-icon.png");
    expect(document.querySelector('meta[property="og:image"]')?.getAttribute("content")).toBe("https://lineagehq.github.io/lineage-logo/assets/brand/social-card.png");
    expect(document.querySelector('meta[property="og:image:width"]')?.getAttribute("content")).toBe("1200");
    expect(document.querySelector('meta[property="og:image:height"]')?.getAttribute("content")).toBe("630");
    expect(document.querySelector('meta[name="twitter:card"]')?.getAttribute("content")).toBe("summary_large_image");
    expect(document.querySelector('meta[name="twitter:image"]')?.getAttribute("content")).toBe("https://lineagehq.github.io/lineage-logo/assets/brand/social-card.png");

    window.close();
  });
});
