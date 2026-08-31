import { Window } from "happy-dom";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasLayoutController, isLayoutShortcutTarget, PreferencesDialogController, safeLayoutStorage } from "../src/client/ui/layout";
import { UnsavedDialogController } from "../src/client/ui/unsaved-dialog";
import { INSPECTOR_SUMMARY_IDS, renderInspectorSummaries } from "../src/client/ui/inspector";
import type { SelectionContext } from "../src/client/canvas/editor";
import { ContextMenuSuppressionController, MarqueeActivationController, StageGestureController } from "../src/client/canvas/marquee-selection";

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

  it("restores bounded sidebar preferences without treating responsive collapse as a preference", () => {
    const { controller } = layoutFixture();
    controller.responsive(800);
    controller.restorePreferences(true, false);
    expect(controller.preferences).toEqual({ leftCollapsed: true, rightCollapsed: false });
    expect(controller.snapshot).toMatchObject({
      leftCollapsed: true,
      rightCollapsed: true,
      leftAutoCollapsed: true,
      rightAutoCollapsed: true,
    });
    controller.responsive(1400);
    expect(controller.snapshot).toMatchObject({ leftCollapsed: true, rightCollapsed: false });
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

describe("canvas gesture wiring", () => {
  const down = (controller: StageGestureController, overrides: Partial<Parameters<StageGestureController["pointerDown"]>[0]> = {}) => controller.pointerDown({
    additive: false, altKey: false, button: 0, canMarquee: true, ctrlKey: false, metaKey: false,
    marqueeArmed: true, point: { x: 10, y: 20 }, pointerId: 7, spacePressed: false, ...overrides,
  });

  it("gives middle and Space-primary pan precedence without turning object-primary or modified presses into marquee", () => {
    const middle = new StageGestureController();
    expect(down(middle, { button: 1, canMarquee: false })).toEqual({ type: "pan-start", pointerId: 7 });
    expect(middle.pointerMove(7, { x: 14, y: 27 })).toEqual({ type: "pan-move", dx: 4, dy: 7 });
    expect(middle.pointerUp(7)).toEqual({ type: "pan-end" });

    const space = new StageGestureController();
    expect(down(space, { canMarquee: false, spacePressed: true })).toEqual({ type: "pan-start", pointerId: 7 });
    expect(space.cancel(7)).toEqual({ type: "pan-end" });
    expect(down(new StageGestureController(), { canMarquee: false })).toEqual({ type: "none" });
    expect(down(new StageGestureController(), { metaKey: true })).toEqual({ type: "none" });
    expect(down(new StageGestureController(), { altKey: true })).toEqual({ type: "none" });
  });

  it("executes pending, threshold, Shift no-op, commit, pointercancel, and lost-capture transitions", () => {
    const pending = new StageGestureController();
    expect(down(pending)).toEqual({ type: "marquee-start", additive: false, pointerId: 7 });
    expect(pending.pointerMove(7, { x: 13, y: 20 })).toEqual({ type: "marquee-pending" });
    expect(pending.pointerUp(7)).toEqual({ type: "region-noop" });

    const additive = new StageGestureController();
    down(additive, { additive: true });
    additive.pointerMove(7, { x: 13, y: 20 });
    expect(additive.pointerUp(7)).toEqual({ type: "region-noop" });

    const active = new StageGestureController();
    down(active);
    expect(active.pointerMove(7, { x: 14, y: 20 })).toEqual({
      type: "marquee-active",
      additive: false,
      rect: { bottom: 20, height: 0, left: 10, right: 14, top: 20, width: 4 },
    });
    expect(active.pointerUp(7)).toEqual({
      type: "marquee-commit", additive: false,
      rect: { bottom: 20, height: 0, left: 10, right: 14, top: 20, width: 4 },
    });

    const pointerCancel = new StageGestureController();
    down(pointerCancel);
    expect(pointerCancel.cancel(7)).toEqual({ type: "marquee-cancel" });
    const lostCapture = new StageGestureController();
    down(lostCapture);
    expect(lostCapture.cancel(7)).toEqual({ type: "marquee-cancel" });
    expect(lostCapture.pointerUp(7)).toEqual({ type: "none" });
  });

  it("treats unarmed short background presses as clicks and longer drags as inert", () => {
    const click = new StageGestureController();
    expect(down(click, { marqueeArmed: false })).toEqual({ type: "background-start", pointerId: 7 });
    expect(click.pointerMove(7, { x: 13, y: 20 })).toEqual({ type: "background-pending" });
    expect(click.pointerUp(7)).toEqual({ type: "background-click", additive: false });

    const additiveClick = new StageGestureController();
    expect(down(additiveClick, { additive: true, marqueeArmed: false })).toEqual({ type: "background-start", pointerId: 7 });
    expect(additiveClick.pointerMove(7, { x: 13, y: 20 })).toEqual({ type: "background-pending" });
    expect(additiveClick.pointerUp(7)).toEqual({ type: "background-click", additive: true });

    const inert = new StageGestureController();
    down(inert, { marqueeArmed: false });
    expect(inert.pointerMove(7, { x: 14, y: 20 })).toEqual({ type: "background-inert" });
    expect(inert.pointerUp(7)).toEqual({ type: "background-inert-end" });
    const additiveInert = new StageGestureController();
    down(additiveInert, { additive: true, marqueeArmed: false });
    additiveInert.pointerMove(7, { x: 14, y: 20 });
    expect(additiveInert.pointerUp(7)).toEqual({ type: "background-inert-end" });
    const canceled = new StageGestureController();
    down(canceled, { marqueeArmed: false });
    expect(canceled.cancel(7)).toEqual({ type: "background-cancel" });
  });

  it("arms only a fresh unmodified physical KeyM outside editable, modal, repeat, and composition contexts", () => {
    const valid = { altKey: false, code: "KeyM", composing: false, ctrlKey: false, editableOrModal: false, metaKey: false, repeat: false };
    const activation = new MarqueeActivationController();
    expect(activation.keyDown(valid)).toBe(true);
    expect(activation.held).toBe(true);
    expect(activation.keyDown(valid)).toBe(false);
    expect(activation.keyUp("KeyA")).toBe(false);
    expect(activation.keyUp("KeyM")).toBe(true);
    expect(activation.held).toBe(false);
    for (const invalid of [
      { ...valid, code: "KeyN" }, { ...valid, repeat: true }, { ...valid, composing: true },
      { ...valid, editableOrModal: true }, { ...valid, metaKey: true }, { ...valid, ctrlKey: true }, { ...valid, altKey: true },
    ]) expect(new MarqueeActivationController().keyDown(invalid)).toBe(false);
    activation.keyDown(valid);
    expect(activation.disarm()).toBe(true);
    expect(activation.held).toBe(false);
  });

  it("arms only physical ControlLeft and irreversibly arbitrates exact click versus marquee", () => {
    const activation = new MarqueeActivationController("left-control");
    const key = { altKey: false, code: "ControlLeft", composing: false, ctrlKey: true, editableOrModal: false, metaKey: false, repeat: false };
    expect(activation.keyDown(key)).toBe(true);
    expect(new MarqueeActivationController("left-control").keyDown({ ...key, code: "ControlRight" })).toBe(false);
    const candidate = { id: "leaf" };
    const click = new StageGestureController<typeof candidate>();
    down(click as StageGestureController, { activation: "left-control", candidate, ctrlKey: true });
    expect(click.pointerUp(7)).toEqual({ type: "control-click", additive: false, candidate });
    const drag = new StageGestureController<typeof candidate>();
    drag.pointerDown({ activation: "left-control", additive: true, altKey: false, button: 0, canMarquee: true, candidate,
      ctrlKey: true, marqueeArmed: true, metaKey: false, point: { x: 10, y: 20 }, pointerId: 7, spacePressed: false });
    expect(drag.pointerMove(7, { x: 14, y: 20 }).type).toBe("marquee-active");
    expect(drag.pointerMove(7, { x: 11, y: 20 }).type).toBe("marquee-active");
    expect(drag.pointerUp(7)).toEqual({ type: "marquee-commit", additive: true,
      rect: { bottom: 20, height: 0, left: 10, right: 11, top: 20, width: 1 } });
    const reset = new MarqueeActivationController("m");
    expect(reset.keyDown({ ...key, code: "KeyM", ctrlKey: false })).toBe(true);
    expect(reset.configure("left-control")).toBe(true);
    expect(reset.held).toBe(false);
    expect(reset.keyDown({ ...key, code: "KeyM", ctrlKey: false })).toBe(false);
    expect(reset.keyDown(key)).toBe(true);
  });

  it("suppresses only one causal Control context menu at either click or drag endpoint", () => {
    const menus = new ContextMenuSuppressionController();
    menus.pointerDown();
    menus.accept(7, { x: 10, y: 20 }, 100);
    expect(menus.consume({ canvasTarget: true, ctrlKey: true, point: { x: 10, y: 20 }, time: 110 })).toBe(true);
    expect(menus.consume({ canvasTarget: true, ctrlKey: true, point: { x: 10, y: 20 }, time: 111 })).toBe(false);

    menus.pointerDown();
    menus.accept(8, { x: 10, y: 20 }, 200);
    menus.pointerMove(8, { x: 110, y: 90 });
    expect(menus.consume({ canvasTarget: true, ctrlKey: true, point: { x: 110, y: 90 }, time: 250 })).toBe(true);
  });

  it("invalidates stale suppression on every pointerdown and excludes non-canvas or non-Control menus", () => {
    const menus = new ContextMenuSuppressionController();
    menus.accept(7, { x: 10, y: 20 }, 100);
    menus.pointerDown();
    expect(menus.consume({ canvasTarget: true, ctrlKey: true, point: { x: 10, y: 20 }, time: 110 })).toBe(false);
    menus.accept(8, { x: 10, y: 20 }, 200);
    expect(menus.consume({ canvasTarget: false, ctrlKey: true, point: { x: 10, y: 20 }, time: 210 })).toBe(false);
    expect(menus.consume({ canvasTarget: true, ctrlKey: false, point: { x: 10, y: 20 }, time: 211 })).toBe(false);
    expect(menus.consume({ canvasTarget: true, ctrlKey: true, point: { x: 10, y: 20 }, time: 951 })).toBe(false);
  });

  it("wires disarm to keyup, Escape, blur, hidden visibility, and editable/modal focus", () => {
    const source = readFileSync("src/client/main.ts", "utf8");
    expect(source).toContain('event.code === "KeyM"');
    expect(source).toContain('event.code === "ControlLeft"');
    expect(source).toContain('event.key === "Escape" && marqueeActivation.held');
    expect(source).toContain('window.addEventListener("blur", disarmMarquee)');
    expect(source).toContain('document.addEventListener("visibilitychange"');
    expect(source).toContain('document.addEventListener("focusin"');
    expect(source).toContain("isLayoutShortcutTarget(event.target)");
    expect(source).toContain("editor.completeBackgroundGesture(false, transition.additive)");
    expect(source).toContain("editor.previewMarquee(transition.rect, transition.additive)");
    expect(source).toContain('stage.addEventListener("contextmenu"');
    expect(source).toContain('document.addEventListener("pointerdown", () => contextMenuSuppression.pointerDown(), true)');
  });

  it("provides a non-interactive viewport overlay and pan/marquee cursor states", () => {
    const styles = readFileSync("src/client/styles.css", "utf8");
    expect(styles).toMatch(/\.stage\.pan-ready\s*\{[^}]*cursor:\s*grab/);
    expect(styles).toMatch(/\.stage\.panning\s*\{[^}]*cursor:\s*grabbing/);
    expect(styles).toMatch(/\.stage\.marquee-ready\s*\{[^}]*cursor:\s*crosshair/);
    expect(styles).toMatch(/\.stage\.marquee-active\s*\{[^}]*cursor:\s*crosshair/);
    expect(styles).toMatch(/\.marquee-selection\s*\{[^}]*pointer-events:\s*none/);
  });
});

describe("preferences and shortcuts dialog", () => {
  it("focuses the first preference, traps focus, closes on Escape, and returns focus to its invoker", async () => {
    const window = new Window();
    window.document.body.innerHTML = `
      <button id="invoker">Preferences</button>
      <dialog id="preferences"><select id="first"><option>Default</option></select><button id="restore">Restore defaults</button><button id="close">Close</button></dialog>`;
    const dialog = window.document.querySelector("#preferences") as unknown as HTMLDialogElement;
    const invoker = window.document.querySelector("#invoker") as unknown as HTMLButtonElement;
    const first = window.document.querySelector("#first") as unknown as HTMLSelectElement;
    const close = window.document.querySelector("#close") as unknown as HTMLButtonElement;
    const controller = new PreferencesDialogController({ dialog, closeButton: close, initialFocus: first });
    invoker.focus();
    controller.open(invoker);
    await Promise.resolve();
    expect(dialog.open).toBe(true);
    expect(window.document.activeElement).toBe(first);
    close.focus();
    close.dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, key: "Tab" }) as unknown as Event);
    expect(window.document.activeElement).toBe(first);
    dialog.dispatchEvent(new window.Event("cancel", { cancelable: true }) as unknown as Event);
    expect(dialog.open).toBe(false);
    await Promise.resolve();
    expect(window.document.activeElement).toBe(invoker);
  });

  it("ships the five chartered controls, selection badge, current shortcut copy, and reduced-motion fallback", () => {
    const source = readFileSync("src/client/main.ts", "utf8");
    const styles = readFileSync("src/client/styles.css", "utf8");
    for (const id of [
      "preference-precise-modifier", "preference-marquee-mode", "preference-click-depth",
      "preference-individual-outlines", "preference-region-activation", "restore-selection-preferences",
      "preference-alignment-snapping", "preference-snap-canvas", "preference-snap-objects", "preference-snap-tolerance",
    ]) expect(source).toContain(`id="${id}"`);
    expect(source).toContain("Preferences &amp; shortcuts");
    expect(source).toContain("Option/Alt-click toggles");
    expect(source).toContain("Option / Alt suspends · Shift snaps rotation to 15°");
    expect(source).toContain('id="selection-count-badge"');
    expect(source).toContain('aria-live="polite" aria-atomic="true"');
    expect(source).toContain("objects selected");
    expect(source).toContain("for (const selectedNode of context.selectedNodes)");
    expect(source).toContain("applySelectionPreferences(selectionPreferencesStore.reset())");
    expect(source).toContain('id="region-selection-hint"');
    for (const label of [
      "Oriented frame X", "Oriented frame Y", "Oriented frame width",
      "Oriented frame height", "Absolute frame rotation °", "Lock aspect ratio",
    ]) expect(source).toContain(label);
    expect(source).toContain('id="geometry-error" class="field-error" aria-live="polite"');
    expect(source).toContain('aria-describedby="geometry-mode geometry-error"');
    expect(styles).toContain('#geometry-group input[aria-invalid="true"]');
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain(".artboard { transition: none; }");
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
