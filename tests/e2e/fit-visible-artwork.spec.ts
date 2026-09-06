import { expect, test } from "@playwright/test";

for (const stylesheet of [false, true]) {
  test(`Fit artwork retains visible descendants of ${stylesheet ? "nested stylesheet" : "attribute"} hidden groups`, async ({ page }) => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200">
      <defs><linearGradient id="white"><stop stop-color="#fff"/><stop offset="1" stop-color="#fff"/></linearGradient></defs>
      ${stylesheet ? '<style>.concealed { visibility:hidden } .concealed .restored { visibility:visible }</style>' : ''}
      <g id="frame" transform="translate(20 10)" ${stylesheet ? 'class="concealed"' : 'visibility="hidden"'}>
        <rect id="hidden-sibling" width="580" height="180" fill="red"/>
        <g><rect id="visible-mark" aria-label="Visible mark" x="220" y="60" width="80" height="40" fill="url(#white)" ${stylesheet ? 'class="restored"' : 'visibility="visible"'}/></g>
      </g>
      <g display="none"><rect visibility="visible" x="-1000" y="-1000" width="5000" height="5000"/></g>
      <g opacity="0" pointer-events="none"><rect visibility="visible" x="-1000" y="-1000" width="5000" height="5000"/></g>
    </svg>`;
    await page.route("**/api/svg?path=concepts%2Fcomplex-seatify.svg", route => route.fulfill({ contentType: "image/svg+xml", body: source }));
    await page.goto("/");
    await page.locator('[data-path="concepts/complex-seatify.svg"]').click();
    await expect(page.locator("#artboard #visible-mark")).toBeVisible();
    await page.locator("#artboard #visible-mark").click();
    const selection = await page.locator("#selection-name").textContent();
    const acceptedBefore = await page.locator("#artboard > svg").evaluate(async root => {
      const modulePath = "/canvas/editor.ts";
      const { serializeSvg } = await import(modulePath);
      return serializeSvg(root, true);
    });
    await page.locator('[data-background="dark"].background-button').click();
    await page.locator("#zoom-artwork").click();
    await expect(page.locator("#zoom-label")).toHaveText("400%");
    const mark = await page.locator("#artboard #visible-mark").boundingBox();
    const stage = await page.locator("#stage").boundingBox();
    expect(mark!.width).toBeCloseTo(320, 1);
    expect(mark!.height).toBeCloseTo(160, 1);
    expect(mark!.x).toBeGreaterThanOrEqual(stage!.x);
    expect(mark!.x + mark!.width).toBeLessThanOrEqual(stage!.x + stage!.width);
    const png = await page.screenshot();
    const color = await page.evaluate(async ({ png, x, y }) => {
      const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext("2d")!; ctx.drawImage(image, 0, 0);
      return Array.from(ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data);
    }, { png: png.toString("base64"), x: mark!.x + mark!.width / 2, y: mark!.y + mark!.height / 2 });
    expect(color).toEqual([255, 255, 255, 255]);
    expect(await page.locator("#selection-name").textContent()).toBe(selection);
    expect(await page.locator("#artboard > svg").evaluate(async root => {
      const modulePath = "/canvas/editor.ts";
      const { serializeSvg } = await import(modulePath);
      return serializeSvg(root, true);
    })).toBe(acceptedBefore);
    await expect(page.locator("#undo")).toBeDisabled();
    await expect(page.locator("#save-iteration")).toBeDisabled();
  });
}

for (const relative of [false, true]) {
  test(`Fit artwork excludes hidden direct text while preserving ${relative ? "relative" : "explicit"} visible tspan layout`, async ({ page }) => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 100"><g transform="translate(15 5)"><text id="text" visibility="hidden" x="0" y="50" font-size="20" font-family="monospace" fill="#fff">HIDDEN HUGE TEXT<tspan id="visible-glyph" visibility="visible" ${relative ? 'dx="20"' : 'x="400"'}>V</tspan></text><text visibility="hidden" x="-900" y="20">INVISIBLE<tspan>ALSO HIDDEN</tspan></text></g></svg>`;
    await page.route("**/api/svg?path=concepts%2Fcomplex-seatify.svg", route => route.fulfill({ contentType: "image/svg+xml", body: source }));
    await page.goto("/");
    await page.locator('[data-path="concepts/complex-seatify.svg"]').click();
    await expect(page.locator("#artboard #visible-glyph")).toBeVisible();
    await page.locator('[data-background="dark"].background-button').click();
    const before = await page.locator("#artboard > svg").evaluate(async root => {
      const modulePath = "/canvas/editor.ts";
      const { serializeSvg } = await import(modulePath);
      return serializeSvg(root, true);
    });
    const measurement = await page.locator("#artboard > svg").evaluate(async root => {
      const editorPath = "/canvas/editor.ts", previewPath = "/preview.ts";
      const { serializeSvg } = await import(editorPath);
      const { measureArtworkBounds } = await import(previewPath);
      const svg = root as SVGSVGElement;
      const glyph = root.querySelector("#visible-glyph") as SVGGraphicsElement;
      const box = glyph.getBBox();
      const matrix = svg.getCTM()!.inverse().multiply(glyph.getCTM()!);
      const origin = new DOMPoint(box.x, box.y).matrixTransform(matrix);
      return { measured: measureArtworkBounds(serializeSvg(svg, true)), glyph: { x: origin.x, y: origin.y, width: box.width, height: box.height } };
    });
    expect(measurement.measured.x).toBeCloseTo(measurement.glyph.x, 1);
    expect(measurement.measured.width).toBeCloseTo(measurement.glyph.width, 1);
    expect(measurement.measured.x).toBeGreaterThan(relative ? 100 : 400);
    await page.locator("#zoom-artwork").click();
    await expect(page.locator("#zoom-label")).toHaveText("400%");
    const visible = await page.locator("#artboard #visible-glyph").boundingBox();
    const stage = await page.locator("#stage").boundingBox();
    expect(visible!.x).toBeGreaterThanOrEqual(stage!.x);
    expect(visible!.x + visible!.width).toBeLessThanOrEqual(stage!.x + stage!.width);
    const glyphPng = await page.locator("#artboard #visible-glyph").screenshot();
    const whitePixels = await page.evaluate(async png => {
      const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext("2d")!; ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 240 && pixels[i + 1] > 240 && pixels[i + 2] > 240) count++;
      return count;
    }, glyphPng.toString("base64"));
    expect(whitePixels).toBeGreaterThan(20);
    expect(await page.locator("#artboard > svg").evaluate(async root => {
      const modulePath = "/canvas/editor.ts";
      return (await import(modulePath)).serializeSvg(root, true);
    })).toBe(before);
    await expect(page.locator("#undo")).toBeDisabled();
    await expect(page.locator("#save-iteration")).toBeDisabled();
  });
}
