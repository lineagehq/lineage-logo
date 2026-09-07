import { AGENT_MAX_REVISION_REASON, parseRevisionRequest, validateCleanAgentSvg } from "../../shared/agent-protocol";
import { createSvgPreview } from "../preview";

export interface VisualReviewInput {
  transactionId: string;
  acceptedSvg: string;
  proposedSvg: string;
  target?: string;
}

/** Both images use a union frame: translations and resizing remain visible. */
export function comparisonSources(input: VisualReviewInput): { accepted: string; proposed: string; context: string } {
  validateCleanAgentSvg(input.acceptedSvg);
  validateCleanAgentSvg(input.proposedSvg);
  const previews = input.target ? [createSvgPreview(input.acceptedSvg, input.target), createSvgPreview(input.proposedSvg, input.target)] : undefined;
  const isolated = previews?.every((preview) => !preview.fallback);
  const sources = isolated ? previews!.map((preview) => preview.svg) : [input.acceptedSvg, input.proposedSvg];
  const roots = sources.map((source) => new DOMParser().parseFromString(source, "image/svg+xml").documentElement);
  const frames = roots.map((root) => {
    const values = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
    if (values?.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0) return values;
    const width = Number(root.getAttribute("width"));
    const height = Number(root.getAttribute("height"));
    if (width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height)) return [0, 0, width, height];
    throw new Error("Comparison requires an explicit viewBox or numeric document size.");
  });
  const x = Math.min(...frames.map((frame) => frame[0]));
  const y = Math.min(...frames.map((frame) => frame[1]));
  const right = Math.max(...frames.map((frame) => frame[0] + frame[2]));
  const bottom = Math.max(...frames.map((frame) => frame[1] + frame[3]));
  for (const root of roots) {
    root.setAttribute("viewBox", `${x} ${y} ${right - x} ${bottom - y}`);
    root.removeAttribute("width"); root.removeAttribute("height");
    root.setAttribute("preserveAspectRatio", "xMidYMid meet");
  }
  return { accepted: roots[0].outerHTML, proposed: roots[1].outerHTML,
    context: isolated ? `Comparing ${input.target} in the same frame.` : `Comparing the whole document in the same frame.${input.target ? " Target unavailable in one version." : ""}` };
}

/** Presentation only. The owner commits decisions through the existing durable lifecycle. */
export class AgentVisualReview {
  readonly element: HTMLElement;
  readonly #images: HTMLElement;
  readonly #context: HTMLElement;
  readonly #reason: HTMLTextAreaElement;
  readonly #reject: HTMLButtonElement;
  readonly #error: HTMLElement;
  #identity?: string;
  #urls: string[] = [];
  #returnFocus?: HTMLElement;

  constructor(host: HTMLElement, onRevision: (reason: string) => Promise<void>) {
    this.element = host;
    host.classList.add("agent-visual-review");
    const heading = document.createElement("h3"); heading.textContent = "Compare artwork";
    this.#context = document.createElement("p");
    const backgroundLabel = document.createElement("label"); backgroundLabel.textContent = "Comparison background ";
    const background = document.createElement("select"); background.setAttribute("aria-label", "Comparison background");
    for (const [value, label] of [["#ffffff", "White"], ["#1f2937", "Dark"], ["#d1d5db", "Gray"]]) {
      const option = document.createElement("option"); option.value = value; option.textContent = label; background.append(option);
    }
    this.#images = document.createElement("div"); this.#images.className = "agent-comparison-images";
    this.#images.style.setProperty("--comparison-background", "#ffffff");
    background.addEventListener("change", () => this.#images.style.setProperty("--comparison-background", background.value));
    backgroundLabel.append(background);
    const label = document.createElement("label"); label.textContent = "What should change?";
    this.#reason = document.createElement("textarea"); this.#reason.maxLength = AGENT_MAX_REVISION_REASON;
    this.#reason.rows = 3; this.#reason.setAttribute("aria-label", "Revision request");
    label.append(this.#reason);
    this.#reject = document.createElement("button"); this.#reject.type = "button";
    this.#reject.textContent = "Reject and request revision";
    this.#error = document.createElement("p"); this.#error.setAttribute("role", "status");
    this.#reject.addEventListener("click", async () => {
      let reason: string;
      try { reason = parseRevisionRequest(this.#reason.value); }
      catch (error) { this.#error.textContent = (error as Error).message; this.#reason.focus(); return; }
      this.#returnFocus = this.#reject;
      this.setBusy(true); this.#error.textContent = "Sending revision request…";
      try { await onRevision(reason); }
      catch (error) { this.#error.textContent = error instanceof Error ? error.message : "Revision request failed. Retry when connected."; }
      finally { this.setBusy(false); }
    });
    host.append(heading, this.#context, backgroundLabel, this.#images, label, this.#reject, this.#error);
  }

  update(input?: VisualReviewInput): void {
    this.element.hidden = !input;
    if (!input) { this.#identity = undefined; this.#clearImages(); return; }
    if (input.transactionId === this.#identity) return;
    this.#identity = input.transactionId; this.#reason.value = ""; this.#error.textContent = "";
    this.#clearImages();
    try {
      const sources = comparisonSources(input);
      this.#context.textContent = sources.context;
      for (const [label, source] of [["Accepted", sources.accepted], ["Proposed", sources.proposed]]) {
        const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
        this.#urls.push(url);
        const figure = document.createElement("figure"); const caption = document.createElement("figcaption");
        caption.textContent = label; figure.append(caption);
        for (const size of [160, 16, 32, 64]) {
          const image = document.createElement("img"); image.alt = `${label} artwork at ${size} pixels`;
          image.width = size; image.height = size; image.src = url;
          figure.append(image);
        }
        this.#images.append(figure);
      }
    } catch (error) { this.#context.textContent = `Visual comparison unavailable: ${(error as Error).message}`; }
  }

  #clearImages(): void {
    this.#images.replaceChildren();
    for (const url of this.#urls) URL.revokeObjectURL(url);
    this.#urls = [];
  }

  setBusy(busy: boolean): void { this.#reject.disabled = busy; this.#reason.disabled = busy; }

  /** Called after a terminal decision, with a reachable canvas/inspector control. */
  restoreFocus(fallback: HTMLElement): void {
    if (this.#returnFocus || this.element.contains(document.activeElement)) fallback.focus();
    this.#returnFocus = undefined;
  }
}
