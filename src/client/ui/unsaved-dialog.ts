export type UnsavedDecision = "save" | "discard" | "cancel";

export class UnsavedDialogController {
  readonly #dialog: HTMLDialogElement;
  readonly #message: HTMLElement;
  readonly #error: HTMLElement;
  readonly #cancel: HTMLButtonElement;
  readonly #discard: HTMLButtonElement;
  readonly #save: HTMLButtonElement;
  #resolve: ((decision: UnsavedDecision) => void) | undefined;
  #invoker: HTMLElement | undefined;

  constructor(options: {
    dialog: HTMLDialogElement;
    message: HTMLElement;
    error: HTMLElement;
    cancel: HTMLButtonElement;
    discard: HTMLButtonElement;
    save: HTMLButtonElement;
  }) {
    this.#dialog = options.dialog;
    this.#message = options.message;
    this.#error = options.error;
    this.#cancel = options.cancel;
    this.#discard = options.discard;
    this.#save = options.save;
    this.#cancel.addEventListener("click", () => this.finish("cancel"));
    this.#discard.addEventListener("click", () => this.finish("discard"));
    this.#save.addEventListener("click", () => this.finish("save"));
    this.#dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.finish("cancel");
    });
    this.#dialog.addEventListener("close", () => {
      if (!this.#resolve) return;
      const resolve = this.#resolve;
      this.#resolve = undefined;
      const invoker = this.#invoker;
      this.#invoker = undefined;
      queueMicrotask(() => invoker?.isConnected && invoker.focus());
      resolve("cancel");
    });
    this.#dialog.addEventListener("keydown", (event) => this.trapFocus(event));
  }

  request(targetName: string, invoker: HTMLElement): Promise<UnsavedDecision> {
    if (this.#resolve) return Promise.resolve("cancel");
    this.#invoker = invoker;
    this.#message.textContent = `Save your current corrections before opening ${targetName}?`;
    this.clearError();
    this.setBusy(false);
    this.#dialog.showModal();
    queueMicrotask(() => this.#cancel.focus());
    return this.waitForDecision();
  }

  waitForDecision(): Promise<UnsavedDecision> {
    if (!this.#dialog.open || this.#resolve) return Promise.resolve("cancel");
    return new Promise((resolve) => { this.#resolve = resolve; });
  }

  setBusy(busy: boolean): void {
    this.#cancel.disabled = busy;
    this.#discard.disabled = busy;
    this.#save.disabled = busy;
    this.#dialog.setAttribute("aria-busy", String(busy));
  }

  showError(message: string): void {
    this.setBusy(false);
    this.#error.textContent = message;
    this.#save.focus();
  }

  clearError(): void { this.#error.textContent = ""; }

  /** Closes an active switch prompt without restoring focus or authorizing an action. */
  preempt(): boolean {
    const active = this.#dialog.open || Boolean(this.#resolve);
    const resolve = this.#resolve;
    this.#resolve = undefined;
    this.#invoker = undefined;
    this.setBusy(false);
    this.clearError();
    if (this.#dialog.open) this.#dialog.close();
    resolve?.("cancel");
    return active;
  }

  closeAfterSuccess(): void {
    this.#resolve = undefined;
    this.#invoker = undefined;
    if (this.#dialog.open) this.#dialog.close();
  }

  private finish(decision: UnsavedDecision): void {
    const resolve = this.#resolve;
    if (!resolve) return;
    this.#resolve = undefined;
    if (decision === "save") {
      resolve(decision);
      return;
    }
    if (this.#dialog.open) this.#dialog.close();
    const invoker = this.#invoker;
    this.#invoker = undefined;
    if (decision === "cancel") queueMicrotask(() => invoker?.isConnected && invoker.focus());
    resolve(decision);
  }

  private trapFocus(event: KeyboardEvent): void {
    if (event.key !== "Tab") return;
    const focusable = [this.#cancel, this.#discard, this.#save].filter((button) => !button.disabled);
    if (!focusable.length) return;
    const current = focusable.indexOf(this.#dialog.ownerDocument.activeElement as HTMLButtonElement);
    const next = event.shiftKey
      ? (current <= 0 ? focusable.length - 1 : current - 1)
      : (current === focusable.length - 1 ? 0 : current + 1);
    if (current < 0 || next !== current + (event.shiftKey ? -1 : 1)) {
      event.preventDefault();
      focusable[next]?.focus();
    }
  }
}
