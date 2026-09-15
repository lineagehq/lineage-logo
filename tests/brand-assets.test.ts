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

async function darkPixelBounds(
  path: string,
  region: { left: number; top: number; right: number; bottom: number },
): Promise<{ width: number; height: number }> {
  const bytes = await readFile(new URL(path, siteRoot));
  const image = PNG.sync.read(bytes);
  let minX = region.right;
  let minY = region.bottom;
  let maxX = region.left - 1;
  let maxY = region.top - 1;

  for (let y = region.top; y < region.bottom; y += 1) {
    for (let x = region.left; x < region.right; x += 1) {
      const offset = (y * image.width + x) * 4;
      const isDark = image.data[offset] < 80
        && image.data[offset + 1] < 80
        && image.data[offset + 2] < 80
        && image.data[offset + 3] > 200;
      if (!isDark) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return {
    width: maxX >= minX ? maxX - minX + 1 : 0,
    height: maxY >= minY ? maxY - minY + 1 : 0,
  };
}

async function textRowBands(
  path: string,
  region: { left: number; top: number; right: number; bottom: number },
): Promise<Array<{ top: number; bottom: number }>> {
  const bytes = await readFile(new URL(path, siteRoot));
  const image = PNG.sync.read(bytes);
  const activeRows: number[] = [];

  for (let y = region.top; y < region.bottom; y += 1) {
    let darkPixels = 0;
    for (let x = region.left; x < region.right; x += 1) {
      const offset = (y * image.width + x) * 4;
      const isTextPixel = image.data[offset] < 140
        && image.data[offset + 1] < 140
        && image.data[offset + 2] < 140
        && image.data[offset + 3] > 200;
      if (isTextPixel) darkPixels += 1;
    }
    if (darkPixels > 12) activeRows.push(y);
  }

  const bands: Array<{ top: number; bottom: number }> = [];
  for (const y of activeRows) {
    const current = bands.at(-1);
    if (!current || y > current.bottom + 10) {
      bands.push({ top: y, bottom: y });
    } else {
      current.bottom = y;
    }
  }
  return bands;
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

  it("keeps the social-card mark prominent at link-preview size", async () => {
    const bounds = await darkPixelBounds("assets/brand/social-card.png", {
      left: 30,
      top: 20,
      right: 145,
      bottom: 150,
    });

    expect(bounds.width).toBeGreaterThanOrEqual(56);
    expect(bounds.height).toBeGreaterThanOrEqual(56);
  });

  it("keeps the supporting message visually connected to the headline", async () => {
    const bands = await textRowBands("assets/brand/social-card.png", {
      left: 50,
      top: 170,
      right: 1150,
      bottom: 610,
    });

    expect(bands).toHaveLength(2);
    expect(bands[1].top - bands[0].bottom).toBeLessThanOrEqual(40);
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
