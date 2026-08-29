import { expect, test, type Page } from "@playwright/test";

type InputProbe = {
  code?: string;
  ctrlKey: boolean;
  pointerId?: number;
  shiftKey: boolean;
  type: string;
};

type DragGeometry = {
  end: { x: number; y: number };
  exit: { x: number; y: number };
  start: { x: number; y: number };
};

declare global {
  interface Window {
    __marqueeInputProbe: InputProbe[];
  }
}

const runtimeSvgSelector = [
  "[data-lineage-selection-halos]",
  "[data-lineage-collective-transform]",
  ".svg_select_shape",
  ".svg_select_shape_pointSelect",
  ".svg_select_handle",
  ".svg_select_handle_rot",
].join(", ");

async function openFixture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__marqueeInputProbe = [];
    const recordKeyboard = (event: KeyboardEvent) => {
      window.__marqueeInputProbe.push({ code: event.code, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, type: event.type });
    };
    document.addEventListener("keydown", recordKeyboard, true);
    document.addEventListener("keyup", recordKeyboard, true);
    for (const type of ["pointerdown", "pointermove", "pointerup", "click"] as const) {
      document.addEventListener(type, (event) => {
        window.__marqueeInputProbe.push({
          ctrlKey: event.ctrlKey,
          pointerId: "pointerId" in event ? event.pointerId : undefined,
          shiftKey: event.shiftKey,
          type: event.type,
        });
      }, true);
    }
  });
  await page.goto("/");
  await expect(page).toHaveURL(/^http:\/\/marquee-qa\.localhost:/);
  await page.getByRole("button", { name: "complex-seatify" }).click();
  await expect(page.locator("#artboard svg[aria-label='Complex Seatify venue logo']")).toBeVisible();
}

async function previewLabels(page: Page): Promise<string[]> {
  return await page.locator("#artboard svg").evaluate((root) => {
    const selector = "g, path, rect, circle, ellipse, polygon, polyline, line, text";
    const previewRects = Array.from(root.querySelectorAll<SVGGraphicsElement>(
      "[data-lineage-selection-halos][data-lineage-marquee-preview] > [data-lineage-marquee-preview]",
    )).map((element) => element.getBoundingClientRect());
    if (previewRects.length === 0) return [];

    const candidates = Array.from(root.querySelectorAll<SVGGraphicsElement>(selector))
      .filter((element) => Boolean(element.getAttribute("aria-label")?.trim()))
      .filter((element) => !Array.from(element.querySelectorAll<SVGGraphicsElement>(selector))
        .some((descendant) => {
          const bounds = descendant.getBoundingClientRect();
          return Boolean(descendant.getAttribute("aria-label")?.trim()) && bounds.width > 0 && bounds.height > 0;
        }))
      .map((element) => ({ bounds: element.getBoundingClientRect(), label: element.getAttribute("aria-label")!.trim() }))
      .filter(({ bounds }) => bounds.width > 0 && bounds.height > 0);

    const unused = new Set(candidates.map((_candidate, index) => index));
    return previewRects.map((halo) => {
      const ranked = [...unused].map((index) => {
        const bounds = candidates[index].bounds;
        const error = Math.abs(bounds.left - halo.left) + Math.abs(bounds.top - halo.top)
          + Math.abs(bounds.right - halo.right) + Math.abs(bounds.bottom - halo.bottom);
        return { error, index };
      }).sort((left, right) => left.error - right.error);
      const match = ranked[0];
      if (!match) throw new Error("A preview halo had no live labeled-object geometry match.");
      const candidate = candidates[match.index];
      const tolerance = Math.min(candidate.bounds.width, candidate.bounds.height) * 0.2;
      if (match.error > tolerance) {
        throw new Error(`Preview halo could not be mapped reliably; nearest ${candidate.label} error=${match.error}.`);
      }
      unused.delete(match.index);
      return candidate.label;
    }).sort();
  });
}

async function selectedLayerLabels(page: Page): Promise<string[]> {
  return await page.locator(".layer-button[aria-pressed='true']").evaluateAll((buttons) =>
    buttons.map((button) => button.querySelector(".layer-type + span")?.textContent?.trim() ?? "").filter(Boolean).sort(),
  );
}

async function authoredSvg(page: Page): Promise<string> {
  return await page.locator("#artboard svg").evaluate((root, runtimeSelector) => {
    const clone = root.cloneNode(true) as SVGSVGElement;
    clone.querySelectorAll(runtimeSelector).forEach((element) => element.remove());
    clone.querySelectorAll("g:empty").forEach((element) => element.remove());
    for (const element of [clone, ...Array.from(clone.querySelectorAll("*"))]) {
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.name.startsWith("data-lineage-")) element.removeAttribute(attribute.name);
      }
    }
    return new XMLSerializer().serializeToString(clone);
  }, runtimeSvgSelector);
}

async function editControlState(page: Page): Promise<Record<string, boolean>> {
  return await page.locator("#undo, #redo, #reset-edits, #save-iteration").evaluateAll((controls) =>
    Object.fromEntries(controls.map((control) => [control.id, (control as HTMLButtonElement).disabled])),
  );
}

async function inspectorState(page: Page): Promise<unknown> {
  return await page.locator("#inspector-panel").evaluate((panel) => ({
    breadcrumb: panel.querySelector("#selection-breadcrumb")?.textContent,
    controls: Array.from(panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")).map((control) => ({
      checked: control instanceof HTMLInputElement && control.type === "checkbox" ? control.checked : undefined,
      disabled: control.disabled,
      id: control.id,
      value: control.value,
    })),
    emptyHidden: (panel.querySelector("#selection-empty") as HTMLElement | null)?.hidden,
    name: panel.querySelector("#selection-name")?.textContent,
    panelHidden: (panel.querySelector("#selection-panel") as HTMLElement | null)?.hidden,
    summaries: Array.from(panel.querySelectorAll(".group-summary")).map((summary) => summary.textContent),
  }));
}

async function targetGeometry(page: Page, label: string, overlap: "contain" | "partial" = "contain"): Promise<DragGeometry> {
  const target = page.locator(`#artboard svg [aria-label=${JSON.stringify(label)}]`);
  await expect(target).toBeVisible();
  await target.scrollIntoViewIfNeeded();
  const [targetBounds, stageBounds] = await Promise.all([target.boundingBox(), page.locator("#stage").boundingBox()]);
  if (!targetBounds || !stageBounds) throw new Error(`Live geometry is unavailable for ${label}.`);
  const padding = Math.min(targetBounds.width, targetBounds.height) * 0.08;
  const start = { x: targetBounds.x - padding, y: targetBounds.y - padding };
  const end = overlap === "contain"
    ? { x: targetBounds.x + targetBounds.width + padding, y: targetBounds.y + targetBounds.height + padding }
    : { x: targetBounds.x + targetBounds.width * 0.5, y: targetBounds.y + targetBounds.height * 0.5 };
  const exit = { x: start.x + targetBounds.width * 0.1, y: start.y + targetBounds.height * 0.1 };
  for (const point of [start, end, exit]) {
    expect(point.x).toBeGreaterThan(stageBounds.x);
    expect(point.x).toBeLessThan(stageBounds.x + stageBounds.width);
    expect(point.y).toBeGreaterThan(stageBounds.y);
    expect(point.y).toBeLessThan(stageBounds.y + stageBounds.height);
  }
  return { end, exit, start };
}

async function beginMarquee(
  page: Page,
  label: string,
  options: { additive?: boolean; overlap?: "contain" | "partial" } = {},
): Promise<DragGeometry> {
  const geometry = await targetGeometry(page, label, options.overlap);
  await page.mouse.move(geometry.start.x, geometry.start.y);
  await page.evaluate(() => { window.__marqueeInputProbe = []; });
  await page.keyboard.down("ControlLeft");
  if (options.additive) await page.keyboard.down("ShiftLeft");
  await expect(page.locator("#stage")).toHaveClass(/marquee-ready/);
  await page.mouse.down();
  await page.mouse.move(geometry.end.x, geometry.end.y, { steps: 8 });
  await expect(page.locator("#stage")).toHaveClass(/marquee-active/);
  const pointerCaptureHeld = await page.locator("#stage").evaluate((stage) => {
    const pointerDown = window.__marqueeInputProbe.find((event) => event.type === "pointerdown");
    return pointerDown?.pointerId !== undefined && (stage as HTMLElement).hasPointerCapture(pointerDown.pointerId);
  });
  expect(pointerCaptureHeld).toBe(true);
  return geometry;
}

async function releaseModifiers(page: Page, additive: boolean): Promise<void> {
  if (additive) await page.keyboard.up("ShiftLeft");
  await page.keyboard.up("ControlLeft");
}

async function commitMarquee(page: Page, additive = false): Promise<void> {
  await page.mouse.up();
  const input = await page.evaluate(() => window.__marqueeInputProbe);
  const controlDown = input.findIndex((event) => event.type === "keydown" && event.code === "ControlLeft");
  expect(controlDown).toBeGreaterThanOrEqual(0);
  const gesturePointers = input.slice(controlDown).filter((event) => event.type.startsWith("pointer"));
  expect(gesturePointers).not.toHaveLength(0);
  expect(gesturePointers.every((event) => event.ctrlKey && (!additive || event.shiftKey))).toBe(true);
  expect(gesturePointers.at(-1)).toMatchObject({ ctrlKey: true, type: "pointerup" });
  await releaseModifiers(page, additive);
}

async function selectLayer(page: Page, label: string): Promise<void> {
  await page.getByRole("button", { exact: true, name: `circle ${label}` }).click();
  await expect.poll(() => selectedLayerLabels(page)).toEqual([label]);
}

async function setMarqueeMode(page: Page, mode: "contain" | "touch"): Promise<void> {
  await page.locator("#shortcut-help").click();
  await expect(page.locator("#shortcut-dialog")).toBeVisible();
  await page.locator("#preference-marquee-mode").selectOption(mode);
  await expect(page.locator("#preference-marquee-mode")).toHaveValue(mode);
  await page.locator("#close-shortcut-help").click();
  await expect(page.locator("#shortcut-dialog")).toBeHidden();
}

async function expectCleanDocument(page: Page, baseline: string): Promise<void> {
  expect(await authoredSvg(page)).toBe(baseline);
  expect(await editControlState(page)).toEqual({ redo: true, "reset-edits": true, "save-iteration": true, undo: true });
}

test.beforeEach(async ({ page }) => openFixture(page));

test("live marquee preview enters, exits, commits exact Layers, and never mutates the document", async ({ page }) => {
  const documentBefore = await authoredSvg(page);
  const inspectorBefore = await inspectorState(page);
  await expectCleanDocument(page, documentBefore);
  const geometry = await beginMarquee(page, "West table");

  await expect.poll(() => previewLabels(page)).toEqual(["West table"]);
  await expectCleanDocument(page, documentBefore);
  expect(await inspectorState(page)).toEqual(inspectorBefore);
  await page.mouse.move(geometry.exit.x, geometry.exit.y, { steps: 4 });
  await expect.poll(() => previewLabels(page)).toEqual([]);
  await page.mouse.move(geometry.end.x, geometry.end.y, { steps: 8 });
  await expect.poll(() => previewLabels(page)).toEqual(["West table"]);
  const lastPreview = await previewLabels(page);

  await commitMarquee(page);
  await expect.poll(() => selectedLayerLabels(page)).toEqual(lastPreview);
  await expectCleanDocument(page, documentBefore);
  await expect(page.locator("#selection-name")).toHaveText("West table");
  if (process.env.LINEAGE_LOGO_E2E_FORCE_FAILURE === "1") {
    expect("intentional failure-diagnostic mode").toBe("green run");
  }
});

test("Shift-additive preview preserves the prior selection and uses the focused purple affordance", async ({ page }, testInfo) => {
  testInfo.snapshotSuffix = "";
  await selectLayer(page, "West north seat");
  const documentBefore = await authoredSvg(page);
  const inspectorBefore = await inspectorState(page);
  const geometry = await beginMarquee(page, "West table", { additive: true });

  await expect.poll(() => previewLabels(page)).toEqual(["West north seat", "West table"]);
  expect(await inspectorState(page)).toEqual(inspectorBefore);
  await expectCleanDocument(page, documentBefore);
  const halo = page.locator("[data-lineage-selection-halos][data-lineage-marquee-preview]");
  await expect(halo).toBeVisible();
  expect(await halo.locator(".lineage-selection-halo").first().evaluate((element) => getComputedStyle(element).stroke))
    .toBe("rgb(138, 92, 246)");
  const handles = page.locator(".svg_select_shape, .svg_select_shape_pointSelect, .svg_select_handle, .svg_select_handle_rot");
  expect(await handles.count()).toBeGreaterThan(0);
  expect(await handles.evaluateAll((elements) => elements.every((element) => getComputedStyle(element).opacity === "0"))).toBe(true);
  await expect(page.locator("#artboard svg [data-lineage-hover='true']")).toHaveCount(0);
  await expect(halo).toHaveScreenshot("additive-preview-halos.png", { animations: "disabled", caret: "hide", scale: "css" });

  await page.mouse.move(geometry.exit.x, geometry.exit.y, { steps: 4 });
  await expect.poll(() => previewLabels(page)).toEqual(["West north seat"]);
  await page.mouse.move(geometry.end.x, geometry.end.y, { steps: 8 });
  await expect.poll(() => previewLabels(page)).toEqual(["West north seat", "West table"]);
  const lastPreview = await previewLabels(page);
  await commitMarquee(page, true);

  await expect.poll(() => selectedLayerLabels(page)).toEqual(lastPreview);
  await expectCleanDocument(page, documentBefore);
  await expect(page.locator("#organization-summary")).toHaveText("2 layers");
});

test("Escape cancels preview, restores selection and inspector, and suppresses the successor click", async ({ page }) => {
  await selectLayer(page, "West north seat");
  const documentBefore = await authoredSvg(page);
  const inspectorBefore = await inspectorState(page);
  await beginMarquee(page, "West table");
  await expect.poll(() => previewLabels(page)).toEqual(["West table"]);
  expect(await inspectorState(page)).toEqual(inspectorBefore);

  await page.keyboard.press("Escape");
  await expect(page.locator(".marquee-selection")).toHaveCount(0);
  await expect.poll(() => previewLabels(page)).toEqual([]);
  await expect(page.locator("#stage")).not.toHaveClass(/marquee-(active|ready)/);
  await page.mouse.up();
  await releaseModifiers(page, false);

  await expect.poll(() => selectedLayerLabels(page)).toEqual(["West north seat"]);
  expect(await inspectorState(page)).toEqual(inspectorBefore);
  await expectCleanDocument(page, documentBefore);
  const input = await page.evaluate(() => window.__marqueeInputProbe);
  expect(input.some((event) => event.type === "keydown" && event.code === "Escape")).toBe(true);
  expect(input.some((event) => event.type === "pointerup")).toBe(true);
});

test("contain excludes and touch includes the same partial overlap selected through preferences", async ({ page }) => {
  const documentBefore = await authoredSvg(page);
  await setMarqueeMode(page, "contain");
  await beginMarquee(page, "West table", { overlap: "partial" });
  await expect.poll(() => previewLabels(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await releaseModifiers(page, false);

  await setMarqueeMode(page, "touch");
  await beginMarquee(page, "West table", { overlap: "partial" });
  await expect.poll(async () => (await previewLabels(page)).includes("West table")).toBe(true);
  const lastPreview = await previewLabels(page);
  await commitMarquee(page);
  await expect.poll(() => selectedLayerLabels(page)).toEqual(lastPreview);
  await expectCleanDocument(page, documentBefore);
});

for (const variant of ["125% zoom", "both collapsed sidebars"] as const) {
  test(`preview-to-Layers parity survives ${variant}`, async ({ page }) => {
    if (variant === "125% zoom") {
      await page.locator("#zoom-in").click();
      await expect(page.locator("#zoom-label")).toHaveText("125%");
    } else {
      await page.locator("#toggle-left-sidebar").click();
      await page.locator("#toggle-right-sidebar").click();
      await expect(page.locator("#toggle-left-sidebar")).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator("#toggle-right-sidebar")).toHaveAttribute("aria-expanded", "false");
    }
    const documentBefore = await authoredSvg(page);
    await beginMarquee(page, "West table");
    await expect.poll(() => previewLabels(page)).toEqual(["West table"]);
    const lastPreview = await previewLabels(page);
    await commitMarquee(page);
    await expect.poll(() => selectedLayerLabels(page)).toEqual(lastPreview);
    await expectCleanDocument(page, documentBefore);
  });
}
