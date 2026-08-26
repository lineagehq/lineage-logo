import { Window } from "happy-dom";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasLayoutController, isLayoutShortcutTarget, safeLayoutStorage } from "../src/client/ui/layout";
import { UnsavedDialogController } from "../src/client/ui/unsaved-dialog";
import { INSPECTOR_SUMMARY_IDS, renderInspectorSummaries } from "../src/client/ui/inspector";
import type { SelectionContext } from "../src/client/canvas/editor";

function layoutFixture(stored: Record<string, string> = {}) {
  const window = new Window();
  window.document.body.innerHTML = `
    <main id="shell"><button id="left"></button><button id="right"></button><span id="badge"></span></main>
  `;
  const storage = {
    values: { ...stored },
    getItem(key: string) { return this.values[key] ?? null; },
    setItem(key: string, value: string) { this.values[key] = value; },
  };
  const shell = window.document.querySelector("#shell") as unknown as HTMLElement;
  const left = window.document.querySelector("#left") as unknown as HTMLButtonElement;
  const right = window.document.querySelector("#right") as unknown as HTMLButtonElement;
  const badge = window.document.querySelector("#badge") as unknown as HTMLElement;
  const controller = new CanvasLayoutController({ shell, leftToggle: left, rightToggle: right, pendingBadge: badge, storage });
  return { window, shell, left, right, badge, storage, controller };
}

function dialogFixture() {
  const window = new Window();
  window.document.body.innerHTML = `
    <button id="invoker">Other file</button>
    <dialog id="dialog"><p id="message"></p><p id="error"></p>
      <button id="cancel">Cancel</button><button id="discard">Discard</button><button id="save">Save</button>
    </dialog>`;
  const dialog = window.document.querySelector("#dialog") as unknown as HTMLDialogElement;
  const cancel = window.document.querySelector("#cancel") as unknown as HTMLButtonElement;
  const discard = window.document.querySelector("#discard") as unknown as HTMLButtonElement;
  const save = window.document.querySelector("#save") as unknown as HTMLButtonElement;
  const invoker = window.document.querySelector("#invoker") as unknown as HTMLButtonElement;
  const controller = new UnsavedDialogController({
    dialog,
    message: window.document.querySelector("#message") as unknown as HTMLElement,
    error: window.document.querySelector("#error") as unknown as HTMLElement,
    cancel,
    discard,
    save,
  });
  return { window, dialog, cancel, discard, save, invoker, controller };
}

afterEach(() => vi.restoreAllMocks());

describe("responsive canvas layout", () => {
  it("falls back to tab-local layout state when storage acquisition is blocked", () => {
    const fallback = safeLayoutStorage(() => { throw new DOMException("Blocked", "SecurityError"); });
    expect(fallback.getItem("lineage.layout.left-collapsed.v1")).toBeNull();
    expect(() => fallback.setItem("lineage.layout.left-collapsed.v1", "true")).not.toThrow();
  });

  it("collapses both rails independently with named, accurate toggles", () => {
    const { controller, shell, left, right, storage } = layoutFixture();
    expect(controller.snapshot).toMatchObject({ leftCollapsed: false, rightCollapsed: false });
    left.click();
    expect(shell.dataset.leftCollapsed).toBe("true");
    expect(shell.dataset.rightCollapsed).toBe("false");
    expect(left.getAttribute("aria-expanded")).toBe("false");
    expect(left.getAttribute("aria-label")).toBe("Expand workspace panel");
    right.click();
    expect(right.getAttribute("aria-expanded")).toBe("false");
    expect(storage.values).toEqual({
      "lineage.layout.left-collapsed.v1": "true",
      "lineage.layout.right-collapsed.v1": "true",
    });
  });

  it("uses temporary responsive overrides without overwriting preferences and restores saved intent", () => {
    const { controller, storage } = layoutFixture({ "lineage.layout.right-collapsed.v1": "true" });
    const original = { ...storage.values };
    controller.responsive(1024);
    expect(controller.snapshot).toMatchObject({ leftCollapsed: true, rightCollapsed: true, leftAutoCollapsed: true, rightAutoCollapsed: false });
    expect(storage.values).toEqual(original);
    controller.responsive(980);
    expect(storage.values).toEqual(original);
    controller.responsive(760);
    expect(controller.snapshot).toMatchObject({ leftCollapsed: true, rightCollapsed: true, leftAutoCollapsed: true, rightAutoCollapsed: true });
    expect(storage.values).toEqual(original);
    controller.responsive(1440);
    expect(controller.snapshot).toMatchObject({ leftCollapsed: false, rightCollapsed: true, leftAutoCollapsed: false, rightAutoCollapsed: false });
  });

  it("lets users reveal an auto-collapsed rail while retaining an explicit preference", () => {
    const { controller, left, storage } = layoutFixture();
    controller.responsive(760);
    expect(controller.snapshot.leftCollapsed).toBe(true);
    left.click();
    expect(controller.snapshot.leftCollapsed).toBe(false);
    expect(storage.values["lineage.layout.left-collapsed.v1"]).toBe("false");
  });

  it("reveals a new pending review without changing saved preference, then badges a user-collapsed rail", () => {
    const { controller, right, badge, storage } = layoutFixture({ "lineage.layout.right-collapsed.v1": "true" });
    controller.setPendingReview(true);
    expect(controller.snapshot.rightCollapsed).toBe(false);
    expect(storage.values["lineage.layout.right-collapsed.v1"]).toBe("true");
    expect(badge.hidden).toBe(true);
    right.click();
    expect(controller.snapshot.rightCollapsed).toBe(true);
    expect(badge.hidden).toBe(false);
    controller.setPendingReview(false);
    expect(badge.hidden).toBe(true);
  });

  it("does not alter an editor-state snapshot while layout state changes", () => {
    const { controller } = layoutFixture();
    const documentState = {
      svg: '<svg viewBox="0 0 10 10"><path id="mark" /></svg>', dirty: true, history: 4,
      selectedKeys: ["mark"], drillScope: "logo", zoom: 1.75,
    };
    const before = structuredClone(documentState);
    controller.toggle("left");
    controller.toggle("right");
    controller.responsive(760);
    controller.setPendingReview(true);
    expect(documentState).toEqual(before);
  });

  it("suppresses bracket shortcuts in every editable or modal context", () => {
    const window = new Window();
    window.document.body.innerHTML = `<input><textarea></textarea><select></select><div contenteditable="true"></div><button></button><dialog open><button id="modal"></button></dialog>`;
    const previous = globalThis.Element;
    Object.defineProperty(globalThis, "Element", { configurable: true, value: window.Element });
    try {
      expect(isLayoutShortcutTarget(window.document.querySelector("input") as unknown as EventTarget)).toBe(true);
      expect(isLayoutShortcutTarget(window.document.querySelector("textarea") as unknown as EventTarget)).toBe(true);
      expect(isLayoutShortcutTarget(window.document.querySelector("select") as unknown as EventTarget)).toBe(true);
      expect(isLayoutShortcutTarget(window.document.querySelector("[contenteditable]") as unknown as EventTarget)).toBe(true);
      expect(isLayoutShortcutTarget(window.document.querySelector("#modal") as unknown as EventTarget)).toBe(true);
      expect(isLayoutShortcutTarget(window.document.querySelector("body > button") as unknown as EventTarget)).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "Element", { configurable: true, value: previous });
    }
  });
});

describe("unsaved file-switch dialog", () => {
  it("starts on Cancel, traps focus, and restores the invoking file on Cancel", async () => {
    const { window, dialog, cancel, discard, save, invoker, controller } = dialogFixture();
    invoker.focus();
    const decision = controller.request("iteration-2.svg", invoker);
    await Promise.resolve();
    expect(dialog.open).toBe(true);
    expect(window.document.activeElement).toBe(cancel);
    save.focus();
    save.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }) as unknown as Event);
    expect(window.document.activeElement).toBe(cancel);
    cancel.click();
    expect(await decision).toBe("cancel");
    await Promise.resolve();
    expect(window.document.activeElement).toBe(invoker);
    expect(discard.disabled).toBe(false);
  });

  it("treats Escape as Cancel and preserves caller-owned document state", async () => {
    const { window, dialog, invoker, controller } = dialogFixture();
    const state = { file: "current.svg", dirty: true, history: 3, selection: ["logo"], zoom: 2 };
    const before = structuredClone(state);
    const decision = controller.request("target.svg", invoker);
    dialog.dispatchEvent(new window.Event("cancel", { cancelable: true }) as unknown as Event);
    expect(await decision).toBe("cancel");
    expect(state).toEqual(before);
  });

  it("returns Discard only for the explicit discard action", async () => {
    const { discard, invoker, controller } = dialogFixture();
    const decision = controller.request("target.svg", invoker);
    discard.click();
    expect(await decision).toBe("discard");
  });

  it("keeps an actionable modal open on save failure and announces the error", async () => {
    const { window, dialog, cancel, save, invoker, controller } = dialogFixture();
    const decision = controller.request("target.svg", invoker);
    save.click();
    expect(await decision).toBe("save");
    expect(dialog.open).toBe(true);
    controller.setBusy(true);
    controller.showError("Save failed; the target was not opened.");
    expect(dialog.open).toBe(true);
    expect(window.document.querySelector("#error")?.textContent).toContain("target was not opened");
    expect(save.disabled).toBe(false);
    expect(window.document.activeElement).toBe(save);
    const retry = controller.waitForDecision();
    cancel.click();
    expect(await retry).toBe("cancel");
    expect(dialog.open).toBe(false);
  });

  it("authoritatively preempts an open decision without restoring file focus", async () => {
    const { window, dialog, cancel, discard, save, invoker, controller } = dialogFixture();
    invoker.focus();
    const decision = controller.request("target.svg", invoker);
    await Promise.resolve();
    expect(controller.preempt()).toBe(true);
    expect(await decision).toBe("cancel");
    expect(dialog.open).toBe(false);
    expect(cancel.disabled).toBe(false);
    expect(discard.disabled).toBe(false);
    expect(save.disabled).toBe(false);
    await Promise.resolve();
    expect(window.document.activeElement).not.toBe(invoker);
  });

  it("preempts a Save-busy modal without letting its abandoned decision regain focus", async () => {
    const { window, dialog, save, invoker, controller } = dialogFixture();
    const decision = controller.request("target.svg", invoker);
    save.click();
    expect(await decision).toBe("save");
    controller.setBusy(true);
    expect(dialog.open).toBe(true);
    expect(controller.preempt()).toBe(true);
    expect(dialog.open).toBe(false);
    expect(save.disabled).toBe(false);
    await Promise.resolve();
    expect(window.document.activeElement).not.toBe(invoker);
  });
});

describe("text, preview, and inspector discoverability", () => {
  it("exposes only the six bounded text controls and an accessible preview target/status", () => {
    const source = readFileSync("src/client/main.ts", "utf8");
    for (const id of ["text-content", "text-size", "text-weight", "text-family", "text-anchor", "text-letter-spacing"]) {
      expect(source).toContain(`id=\"${id}\"`);
    }
    expect(source).toContain('id="preview-target"');
    expect(source).toContain('id="preview-status"');
    expect(source).toContain('role="status" aria-live="polite"');
    expect(source).not.toContain("contenteditable");
  });

  it("keeps concise current-value summaries visible only while inspector groups are collapsed", () => {
    const source = readFileSync("src/client/main.ts", "utf8");
    const styles = readFileSync("src/client/styles.css", "utf8");
    for (const id of ["organization-summary", "alignment-summary", "paint-summary", "text-summary", "geometry-summary"]) {
      expect(source).toContain(`id=\"${id}\"`);
    }
    expect(styles).toContain(".inspector-group:not([open]) .group-summary");
    expect(styles).toContain("display: inline-block");
  });

  it.each([
    ["all-open single selection", true, 1],
    ["all-open multi-selection", true, 3],
    ["all-closed single selection", false, 1],
    ["all-closed multi-selection", false, 3],
  ] as const)("preserves %s through the production selection-summary renderer", (_name, initiallyOpen, selectionCount) => {
    const window = new Window();
    window.document.body.innerHTML = ["organization", "alignment", "paint", "text", "geometry"]
      .map((name) => `<details id="${name}-group"><summary>${name}<span id="${name}-summary" class="group-summary"></span></summary></details>`)
      .join("");
    const groups = Array.from(window.document.querySelectorAll("details"));
    for (const group of groups) group.open = initiallyOpen;
    const before = groups.map((group) => group.open);

    const svg = window.document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const selected = window.document.createElementNS("http://www.w3.org/2000/svg", "text");
    selected.textContent = "BLEEPED";
    selected.setAttribute("font-size", "96");
    svg.append(selected);
    const selectedNodes: SVGGraphicsElement[] = [selected as unknown as SVGGraphicsElement];
    for (let index = 1; index < selectionCount; index += 1) {
      const sibling = window.document.createElementNS("http://www.w3.org/2000/svg", "rect");
      svg.append(sibling);
      selectedNodes.push(sibling as unknown as SVGGraphicsElement);
    }
    renderInspectorSummaries({
      breadcrumb: [], canDrillBack: false, canEditInside: false, lockedKeys: new Set(),
      selected: selected as unknown as SVGGraphicsElement,
      selectedNodes,
    } as SelectionContext, (id) => window.document.getElementById(id) as unknown as HTMLElement | null);

    expect(groups.map((group) => group.open)).toEqual(before);
    const values = INSPECTOR_SUMMARY_IDS.map((id) => window.document.getElementById(id)?.textContent);
    expect(values).toEqual(selectionCount > 1
      ? [`${selectionCount} layers`, `${selectionCount} selected`, "Fill inherited · stroke inherited", "BLEEPED · 96", "Opacity 1 · stroke default"]
      : ["text", "Select 2+", "Fill inherited · stroke inherited", "BLEEPED · 96", "Opacity 1 · stroke default"]);
  });
});
