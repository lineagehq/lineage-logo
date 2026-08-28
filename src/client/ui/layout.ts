export type SidebarSide = "left" | "right";

export interface LayoutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const MEMORY_STORAGE: LayoutStorage = {
  getItem: () => null,
  setItem: () => undefined,
};

export function safeLayoutStorage(acquire: () => LayoutStorage): LayoutStorage {
  try { return acquire(); } catch { return MEMORY_STORAGE; }
}

export interface LayoutSnapshot {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  leftAutoCollapsed: boolean;
  rightAutoCollapsed: boolean;
  pendingReview: boolean;
}

const LEFT_KEY = "lineage.layout.left-collapsed.v1";
const RIGHT_KEY = "lineage.layout.right-collapsed.v1";

function storedBoolean(storage: LayoutStorage, key: string): boolean {
  try { return storage.getItem(key) === "true"; } catch { return false; }
}

export class CanvasLayoutController {
  readonly #shell: HTMLElement;
  readonly #leftToggle: HTMLButtonElement;
  readonly #rightToggle: HTMLButtonElement;
  readonly #pendingBadge: HTMLElement;
  readonly #storage: LayoutStorage;
  readonly #onPreferenceChange?: () => void;
  #leftPreferred: boolean;
  #rightPreferred: boolean;
  #leftAuto = false;
  #rightAuto = false;
  #leftReveal = false;
  #rightReveal = false;
  #pending = false;
  #pendingWasRevealed = false;

  constructor(options: {
    shell: HTMLElement;
    leftToggle: HTMLButtonElement;
    rightToggle: HTMLButtonElement;
    pendingBadge: HTMLElement;
    storage: LayoutStorage;
    onPreferenceChange?: () => void;
  }) {
    this.#shell = options.shell;
    this.#leftToggle = options.leftToggle;
    this.#rightToggle = options.rightToggle;
    this.#pendingBadge = options.pendingBadge;
    this.#storage = options.storage;
    this.#onPreferenceChange = options.onPreferenceChange;
    this.#leftPreferred = storedBoolean(this.#storage, LEFT_KEY);
    this.#rightPreferred = storedBoolean(this.#storage, RIGHT_KEY);
    this.#leftToggle.addEventListener("click", () => this.toggle("left"));
    this.#rightToggle.addEventListener("click", () => this.toggle("right"));
    this.render();
  }

  responsive(width: number): void {
    const leftAuto = width < 1120;
    const rightAuto = width < 920;
    if (leftAuto !== this.#leftAuto) this.#leftReveal = false;
    if (rightAuto !== this.#rightAuto) this.#rightReveal = false;
    this.#leftAuto = leftAuto;
    this.#rightAuto = rightAuto;
    this.render();
  }

  toggle(side: SidebarSide): void {
    if (side === "left") {
      const collapsed = this.snapshot.leftCollapsed;
      if (this.#leftAuto) this.#leftReveal = collapsed;
      this.#leftPreferred = !collapsed;
      this.persist(LEFT_KEY, this.#leftPreferred);
    } else {
      const collapsed = this.snapshot.rightCollapsed;
      if (this.#rightAuto) this.#rightReveal = collapsed;
      else this.#rightReveal = false;
      this.#rightPreferred = !collapsed;
      this.#pendingWasRevealed = this.#pending;
      this.persist(RIGHT_KEY, this.#rightPreferred);
    }
    this.render();
    this.#onPreferenceChange?.();
  }

  restorePreferences(leftCollapsed: boolean, rightCollapsed: boolean): void {
    this.#leftPreferred = leftCollapsed;
    this.#rightPreferred = rightCollapsed;
    this.#leftReveal = false;
    this.#rightReveal = false;
    this.render();
  }

  setPendingReview(pending: boolean): void {
    if (pending && !this.#pending) {
      this.#rightReveal = true;
      this.#pendingWasRevealed = true;
    }
    if (!pending) {
      this.#rightReveal = false;
      this.#pendingWasRevealed = false;
    }
    this.#pending = pending;
    this.render();
  }

  reveal(side: SidebarSide): void {
    if (side === "left") this.#leftReveal = true;
    else this.#rightReveal = true;
    this.render();
  }

  get snapshot(): LayoutSnapshot {
    return {
      leftCollapsed: (this.#leftPreferred || this.#leftAuto) && !this.#leftReveal,
      rightCollapsed: (this.#rightPreferred || this.#rightAuto) && !this.#rightReveal,
      leftAutoCollapsed: this.#leftAuto,
      rightAutoCollapsed: this.#rightAuto,
      pendingReview: this.#pending,
    };
  }

  get preferences(): { leftCollapsed: boolean; rightCollapsed: boolean } {
    return { leftCollapsed: this.#leftPreferred, rightCollapsed: this.#rightPreferred };
  }

  private persist(key: string, value: boolean): void {
    try { this.#storage.setItem(key, String(value)); } catch { /* preferences remain usable for this tab */ }
  }

  private render(): void {
    const state = this.snapshot;
    this.#shell.dataset.leftCollapsed = String(state.leftCollapsed);
    this.#shell.dataset.rightCollapsed = String(state.rightCollapsed);
    this.#shell.dataset.leftAutoCollapsed = String(state.leftAutoCollapsed);
    this.#shell.dataset.rightAutoCollapsed = String(state.rightAutoCollapsed);
    this.#leftToggle.setAttribute("aria-expanded", String(!state.leftCollapsed));
    this.#rightToggle.setAttribute("aria-expanded", String(!state.rightCollapsed));
    this.#leftToggle.setAttribute("aria-label", `${state.leftCollapsed ? "Expand" : "Collapse"} workspace panel`);
    this.#rightToggle.setAttribute("aria-label", `${state.rightCollapsed ? "Expand" : "Collapse"} layers and inspector panel`);
    this.#pendingBadge.hidden = !(this.#pending && state.rightCollapsed && this.#pendingWasRevealed);
  }
}

export function isLayoutShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), dialog[open]"));
}

export class PreferencesDialogController {
  readonly #dialog: HTMLDialogElement;
  readonly #closeButton: HTMLButtonElement;
  readonly #initialFocus: HTMLElement;
  #invoker?: HTMLElement;

  constructor(options: { dialog: HTMLDialogElement; closeButton: HTMLButtonElement; initialFocus: HTMLElement }) {
    this.#dialog = options.dialog;
    this.#closeButton = options.closeButton;
    this.#initialFocus = options.initialFocus;
    this.#closeButton.addEventListener("click", () => this.close());
    this.#dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.close();
    });
    this.#dialog.addEventListener("click", (event) => {
      if (event.target === this.#dialog) this.close();
    });
    this.#dialog.addEventListener("keydown", (event) => this.#trapFocus(event));
  }

  open(invoker: HTMLElement): void {
    if (this.#dialog.open) return;
    this.#invoker = invoker;
    this.#dialog.showModal();
    queueMicrotask(() => this.#initialFocus.focus());
  }

  close(): void {
    if (!this.#dialog.open) return;
    this.#dialog.close();
    const invoker = this.#invoker;
    this.#invoker = undefined;
    queueMicrotask(() => invoker?.focus());
  }

  #trapFocus(event: KeyboardEvent): void {
    if (event.key !== "Tab") return;
    const focusable = Array.from(this.#dialog.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
    )).filter((node) => !node.hidden);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1) as HTMLElement;
    if (event.shiftKey && this.#dialog.ownerDocument.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && this.#dialog.ownerDocument.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
