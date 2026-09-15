import { chromium, type Page } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = path.join(repositoryRoot, "site");
const brandRoot = path.join(siteRoot, "assets", "brand");
const mark = await readFile(path.join(siteRoot, "favicon.svg"), "utf8");
const markUrl = `data:image/svg+xml;base64,${Buffer.from(mark).toString("base64")}`;

await mkdir(brandRoot, { recursive: true });

const browser = await chromium.launch({ headless: true });

async function capture(
  output: string,
  width: number,
  height: number,
  markup: string,
  transparent = false,
): Promise<void> {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0}body{overflow:hidden}</style></head><body>${markup}</body></html>`);
  await page.screenshot({ path: output, omitBackground: transparent });
  await page.close();
}

async function icon(page: Page, size: number, inset: number, background: string): Promise<void> {
  await page.setContent(`<!doctype html><html><head><style>*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0}body{display:grid;place-items:center;overflow:hidden;background:${background}}img{width:${size - inset * 2}px;height:${size - inset * 2}px}</style></head><body><img src="${markUrl}" alt=""></body></html>`);
}

async function captureIcon(output: string, size: number, inset: number, background: string, transparent = false): Promise<void> {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await icon(page, size, inset, background);
  await page.screenshot({ path: output, omitBackground: transparent });
  await page.close();
}

function socialCard(width: number, height: number): string {
  const scale = width / 1200;
  return `<main style="width:100%;height:100%;padding:${54 * scale}px ${70 * scale}px ${56 * scale}px;background:#F7F2E8;color:#20201D;font-family:Arial,Helvetica,sans-serif;display:flex;flex-direction:column">
    <header style="display:flex;align-items:center;gap:${18 * scale}px;padding-bottom:${34 * scale}px;border-bottom:${1 * scale}px solid #D9D1C3">
      <img src="${markUrl}" alt="" style="width:${62 * scale}px;height:${62 * scale}px">
      <strong style="font-size:${30 * scale}px;letter-spacing:-${1.1 * scale}px">Lineage Logo</strong>
    </header>
    <section style="display:flex;flex:1;flex-direction:column;justify-content:center">
      <div style="margin-bottom:${15 * scale}px;color:#686359;font-size:${15 * scale}px;font-weight:700;letter-spacing:${2.4 * scale}px">LOCAL-FIRST SVG LOGO EDITOR</div>
      <div style="font-size:${76 * scale}px;font-weight:700;line-height:.98;letter-spacing:-${4.6 * scale}px">Keep the logo.<br>Fine-tune the details.</div>
    </section>
    <footer style="color:#686359;font-size:${22 * scale}px">Precise visual edits—by hand or with your agent.</footer>
  </main>`;
}

try {
  await captureIcon(path.join(siteRoot, "favicon-16.png"), 16, 0, "transparent", true);
  await captureIcon(path.join(siteRoot, "favicon-32.png"), 32, 0, "transparent", true);
  await captureIcon(path.join(siteRoot, "apple-touch-icon.png"), 180, 18, "#F7F2E8");
  await captureIcon(path.join(brandRoot, "github-avatar.png"), 512, 52, "#F7F2E8");
  await capture(path.join(brandRoot, "social-card.png"), 1200, 630, socialCard(1200, 630));
  await capture(path.join(brandRoot, "github-social-preview.png"), 1280, 640, socialCard(1280, 640));
} finally {
  await browser.close();
}
