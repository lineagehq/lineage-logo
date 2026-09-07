import type { LayoutStorage, SidebarSide } from './layout';

/** Panel preferences never change the document or its editing history. */
export class PanelResizeController {
  readonly #shell: HTMLElement;
  readonly #storage: LayoutStorage;
  readonly #widths = { left: 230, right: 292 };
  readonly #handles: HTMLButtonElement[] = [];
  #cancel?: () => void;

  constructor(shell: HTMLElement, storage: LayoutStorage) {
    this.#shell = shell;
    this.#storage = storage;
    for (const side of ['left', 'right'] as const) {
      try {
        const saved = Number(storage.getItem(`lineage.layout.${side}-width.v1`));
        if (Number.isFinite(saved) && saved >= 200 && saved <= 420) this.#widths[side] = saved;
      } catch { /* The current tab remains resizable when preferences are unavailable. */ }
      const panel = shell.querySelector<HTMLElement>(side === 'left' ? '.file-sidebar' : '.review-sidebar')!;
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = `panel-resize panel-resize-${side}`;
      handle.dataset.side = side;
      handle.setAttribute('role', 'separator');
      handle.setAttribute('aria-orientation', 'vertical');
      handle.setAttribute('aria-label', `Resize ${side === 'left' ? 'workspace' : 'layers and inspector'} panel`);
      handle.title = 'Drag to resize. Arrow keys adjust width; Home and End use minimum and maximum. Escape cancels dragging.';
      handle.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && this.#cancel) {
          event.preventDefault();
          event.stopPropagation();
          this.#cancel();
          return;
        }
        const direction = side === 'left' ? 1 : -1;
        const step = event.shiftKey ? 40 : 10;
        const width = this.#effective(side);
        const next = event.key === 'Home' ? 200 : event.key === 'End' ? this.#maximum()
          : event.key === 'ArrowLeft' ? width - direction * step
          : event.key === 'ArrowRight' ? width + direction * step : undefined;
        if (next === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        this.#set(side, next);
        this.#save(side);
      });
      handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        this.#cancel?.();
        handle.focus();
        const start = this.#widths[side];
        const effective = this.#effective(side);
        const x = event.clientX;
        const pointerId = event.pointerId;
        handle.setPointerCapture(pointerId);
        shell.dataset.resizing = 'true';
        const move = (next: PointerEvent) => {
          if (next.pointerId === pointerId) this.#set(side, effective + (next.clientX - x) * (side === 'left' ? 1 : -1));
        };
        const finish = (cancel: boolean) => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', abort);
          handle.removeEventListener('lostpointercapture', abort);
          document.removeEventListener('keydown', key);
          this.#cancel = undefined;
          if (cancel) this.#widths[side] = start;
          else this.#save(side);
          delete shell.dataset.resizing;
          if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
          this.render();
        };
        const up = (next: PointerEvent) => { if (next.pointerId === pointerId) finish(false); };
        const abort = () => finish(true);
        const key = (next: KeyboardEvent) => {
          if (next.key === 'Escape') { next.preventDefault(); next.stopPropagation(); finish(true); }
        };
        this.#cancel = abort;
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', abort);
        handle.addEventListener('lostpointercapture', abort);
        document.addEventListener('keydown', key);
      });
      panel.append(handle);
      this.#handles.push(handle);
    }
    new ResizeObserver(() => this.render()).observe(shell);
    this.render();
  }

  #maximum(): number {
    const width = this.#shell.getBoundingClientRect().width;
    return Math.max(200, Math.min(420, width <= 800 ? width - 80 : width * 0.38));
  }

  #effective(side: SidebarSide): number { return Math.min(this.#maximum(), this.#widths[side]); }

  #set(side: SidebarSide, width: number): void {
    this.#widths[side] = Math.round(Math.max(200, Math.min(this.#maximum(), width)));
    this.render();
  }

  #save(side: SidebarSide): void {
    try { this.#storage.setItem(`lineage.layout.${side}-width.v1`, String(this.#widths[side])); }
    catch { /* Width remains usable for this tab. */ }
  }

  render(): void {
    for (const handle of this.#handles) {
      const side = handle.dataset.side as SidebarSide;
      const width = Math.round(this.#effective(side));
      this.#shell.style.setProperty(`--${side}-preferred-width`, `${width}px`);
      handle.setAttribute('aria-valuemin', '200');
      handle.setAttribute('aria-valuemax', String(Math.round(this.#maximum())));
      handle.setAttribute('aria-valuenow', String(width));
      handle.setAttribute('aria-valuetext', `${width} pixels`);
    }
  }
}
