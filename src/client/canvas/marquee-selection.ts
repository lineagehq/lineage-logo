export interface ClientPoint {
  x: number;
  y: number;
}

export interface ClientRect {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

export type MarqueeHitRule = "contain" | "touch";

export const MARQUEE_ACTIVATION_DISTANCE = 4;

export interface MarqueeKeyInput {
  altKey: boolean;
  code: string;
  composing: boolean;
  ctrlKey: boolean;
  editableOrModal: boolean;
  metaKey: boolean;
  repeat: boolean;
}

export type RegionSelectionActivation = "left-control" | "m";

export class MarqueeActivationController {
  #held = false;
  #activation: RegionSelectionActivation;

  constructor(activation: RegionSelectionActivation = "m") {
    this.#activation = activation;
  }

  get held(): boolean {
    return this.#held;
  }

  get activation(): RegionSelectionActivation { return this.#activation; }

  configure(activation: RegionSelectionActivation): boolean {
    if (activation === this.#activation) return false;
    this.#activation = activation;
    return this.disarm();
  }

  keyDown(input: MarqueeKeyInput): boolean {
    const expectedCode = this.#activation === "left-control" ? "ControlLeft" : "KeyM";
    const allowedControl = this.#activation === "left-control" && input.ctrlKey;
    if (this.#held || input.code !== expectedCode || input.repeat || input.composing || input.editableOrModal
      || input.metaKey || input.altKey || (input.ctrlKey && !allowedControl)) return false;
    this.#held = true;
    return true;
  }

  keyUp(code: string): boolean {
    const expectedCode = this.#activation === "left-control" ? "ControlLeft" : "KeyM";
    return code === expectedCode && this.disarm();
  }

  disarm(): boolean {
    if (!this.#held) return false;
    this.#held = false;
    return true;
  }
}

export interface ContextMenuInput {
  canvasTarget: boolean;
  ctrlKey: boolean;
  point: ClientPoint;
  time: number;
}

export class ContextMenuSuppressionController {
  #token?: { expires: number; origin: ClientPoint; pointerId: number; terminal: ClientPoint };

  pointerDown(): void {
    this.#token = undefined;
  }

  accept(pointerId: number, point: ClientPoint, time: number): void {
    this.#token = { expires: time + 750, origin: { ...point }, pointerId, terminal: { ...point } };
  }

  pointerMove(pointerId: number, point: ClientPoint): void {
    if (this.#token?.pointerId === pointerId) this.#token.terminal = { ...point };
  }

  consume(input: ContextMenuInput): boolean {
    const token = this.#token;
    if (!token || !input.canvasTarget || !input.ctrlKey || input.time > token.expires) return false;
    const closeTo = (point: ClientPoint) => Math.hypot(input.point.x - point.x, input.point.y - point.y) <= 8;
    if (!closeTo(token.origin) && !closeTo(token.terminal)) return false;
    this.#token = undefined;
    return true;
  }
}

export type StageGestureTransition<TCandidate = unknown> =
  | { type: "none" }
  | { type: "pan-start"; pointerId: number }
  | { type: "pan-move"; dx: number; dy: number }
  | { type: "pan-end" }
  | { type: "background-start"; pointerId: number }
  | { type: "background-pending" }
  | { type: "background-inert" }
  | { type: "background-click"; additive: boolean }
  | { type: "background-inert-end" }
  | { type: "background-cancel" }
  | { type: "marquee-start"; additive: boolean; pointerId: number }
  | { type: "marquee-pending" }
  | { type: "marquee-active"; additive: boolean; rect: ClientRect }
  | { type: "marquee-commit"; additive: boolean; rect?: ClientRect }
  | { type: "control-click"; additive: boolean; candidate?: TCandidate }
  | { type: "region-noop" }
  | { type: "marquee-cancel" };

export interface StagePointerStart<TCandidate = unknown> {
  activation?: RegionSelectionActivation;
  additive: boolean;
  altKey: boolean;
  button: number;
  canMarquee: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  marqueeArmed: boolean;
  point: ClientPoint;
  pointerId: number;
  spacePressed: boolean;
  candidate?: TCandidate;
}

type ActiveStageGesture<TCandidate> =
  | { kind: "pan"; pointerId: number; start: ClientPoint }
  | { additive: boolean; current: ClientPoint; kind: "background"; pointerId: number; start: ClientPoint }
  | { activation: RegionSelectionActivation; additive: boolean; candidate?: TCandidate; current: ClientPoint; kind: "marquee"; latched: boolean; pointerId: number; start: ClientPoint };

export class StageGestureController<TCandidate = unknown> {
  #active?: ActiveStageGesture<TCandidate>;

  get activeKind(): ActiveStageGesture<TCandidate>["kind"] | undefined {
    return this.#active?.kind;
  }

  pointerDown(input: StagePointerStart<TCandidate>): StageGestureTransition<TCandidate> {
    if (this.#active) return { type: "none" };
    const pan = input.button === 1 || (input.button === 0 && input.spacePressed);
    if (pan) {
      this.#active = { kind: "pan", pointerId: input.pointerId, start: input.point };
      return { type: "pan-start", pointerId: input.pointerId };
    }
    const activation = input.activation ?? "m";
    const activationControl = activation === "left-control" && input.ctrlKey;
    if (input.button !== 0 || input.metaKey || input.altKey || (input.ctrlKey && !activationControl) || !input.canMarquee) return { type: "none" };
    if (input.marqueeArmed) {
      this.#active = {
        additive: input.additive,
        activation,
        candidate: input.candidate,
        current: input.point,
        kind: "marquee",
        latched: false,
        pointerId: input.pointerId,
        start: input.point,
      };
      return { type: "marquee-start", additive: input.additive, pointerId: input.pointerId };
    }
    this.#active = { additive: input.additive, current: input.point, kind: "background", pointerId: input.pointerId, start: input.point };
    return { type: "background-start", pointerId: input.pointerId };
  }

  pointerMove(pointerId: number, point: ClientPoint): StageGestureTransition<TCandidate> {
    const active = this.#active;
    if (!active || active.pointerId !== pointerId) return { type: "none" };
    if (active.kind === "pan") {
      return { type: "pan-move", dx: point.x - active.start.x, dy: point.y - active.start.y };
    }
    active.current = point;
    if (active.kind === "background") {
      return crossedMarqueeThreshold(active.start, point) ? { type: "background-inert" } : { type: "background-pending" };
    }
    if (crossedMarqueeThreshold(active.start, point)) active.latched = true;
    return active.latched
      ? { type: "marquee-active", additive: active.additive, rect: clientRectFromPoints(active.start, point) }
      : { type: "marquee-pending" };
  }

  pointerUp(pointerId: number): StageGestureTransition<TCandidate> {
    const active = this.#take(pointerId);
    if (!active) return { type: "none" };
    if (active.kind === "pan") return { type: "pan-end" };
    if (active.kind === "background") {
      return crossedMarqueeThreshold(active.start, active.current)
        ? { type: "background-inert-end" }
        : { type: "background-click", additive: active.additive };
    }
    if (!active.latched) return active.activation === "left-control"
      ? { type: "control-click", additive: active.additive, candidate: active.candidate }
      : { type: "region-noop" };
    return {
      type: "marquee-commit",
      additive: active.additive,
      rect: clientRectFromPoints(active.start, active.current),
    };
  }

  cancel(pointerId?: number): StageGestureTransition<TCandidate> {
    const active = pointerId === undefined ? this.#active : this.#active?.pointerId === pointerId ? this.#active : undefined;
    if (!active) return { type: "none" };
    this.#active = undefined;
    if (active.kind === "pan") return { type: "pan-end" };
    return active.kind === "background" ? { type: "background-cancel" } : { type: "marquee-cancel" };
  }

  #take(pointerId: number): ActiveStageGesture<TCandidate> | undefined {
    if (this.#active?.pointerId !== pointerId) return undefined;
    const active = this.#active;
    this.#active = undefined;
    return active;
  }
}

export function clientRectFromPoints(start: ClientPoint, end: ClientPoint): ClientRect {
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const bottom = Math.max(start.y, end.y);
  return { bottom, height: bottom - top, left, right, top, width: right - left };
}

export function crossedMarqueeThreshold(start: ClientPoint, end: ClientPoint): boolean {
  return Math.hypot(end.x - start.x, end.y - start.y) >= MARQUEE_ACTIVATION_DISTANCE;
}

export function marqueeContains(marquee: ClientRect, candidate: ClientRect): boolean {
  return candidate.left >= marquee.left
    && candidate.right <= marquee.right
    && candidate.top >= marquee.top
    && candidate.bottom <= marquee.bottom;
}

export function marqueeTouches(marquee: ClientRect, candidate: ClientRect): boolean {
  return candidate.right >= marquee.left
    && candidate.left <= marquee.right
    && candidate.bottom >= marquee.top
    && candidate.top <= marquee.bottom;
}

export function marqueeMatches(marquee: ClientRect, candidate: ClientRect, rule: MarqueeHitRule): boolean {
  return rule === "touch" ? marqueeTouches(marquee, candidate) : marqueeContains(marquee, candidate);
}

function finiteClientRect(rect: DOMRect): boolean {
  return [rect.left, rect.right, rect.top, rect.bottom, rect.width, rect.height].every(Number.isFinite);
}

export function renderedClientRect(
  node: SVGGraphicsElement,
  boundary: SVGGraphicsElement | SVGSVGElement,
): DOMRect | undefined {
  const view = node.ownerDocument.defaultView;
  const nodeStyle = view?.getComputedStyle(node);
  const visibility = nodeStyle?.visibility || node.getAttribute("visibility") || "visible";
  if (visibility === "hidden" || visibility === "collapse") return undefined;
  let candidate: Element | null = node;
  while (candidate) {
    const style = view?.getComputedStyle(candidate);
    const opacity = Number(style?.opacity || candidate.getAttribute("opacity") || "1");
    if ((style?.display || candidate.getAttribute("display")) === "none"
      || (Number.isFinite(opacity) && opacity <= 0)) return undefined;
    if (candidate === boundary) break;
    candidate = candidate.parentElement;
  }
  const rect = node.getBoundingClientRect();
  if (!finiteClientRect(rect) || (rect.width === 0 && rect.height === 0)) return undefined;
  return rect;
}
