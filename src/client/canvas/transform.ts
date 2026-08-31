export interface MatrixCoefficients {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface TransformBox {
  height: number;
  width: number;
  x: number;
  y: number;
}

export type SnapAxis = "x" | "y";
export type SnapAnchorName = "min" | "center" | "max";
export type SnapTargetFamily = "canvas" | "object";

export interface SnapTarget {
  axis: SnapAxis;
  anchor: SnapAnchorName;
  family: SnapTargetFamily;
  key: string;
  order: number;
  value: number;
  spanMin: number;
  spanMax: number;
}

export interface SnapWinner extends SnapTarget {
  correction: number;
  correctionPx: number;
  sourceAnchor: SnapAnchorName;
}

export interface TranslationSnapResult {
  dx: number;
  dy: number;
  winners: SnapWinner[];
}

export interface ScaleSnapResult {
  factor: number;
  winner?: SnapWinner;
}

const MATRIX_PRECISION = 6;
const MAX_COEFFICIENT = 1_000_000_000;
const MIN_SCALE = 10 ** -MATRIX_PRECISION;

const ANCHORS: SnapAnchorName[] = ["min", "center", "max"];

function anchorValue(min: number, max: number, anchor: SnapAnchorName): number {
  return anchor === "min" ? min : anchor === "max" ? max : (min + max) / 2;
}

function targetRank(target: SnapTarget): number {
  if (target.family === "canvas" && target.anchor === "center") return 0;
  if (target.family === "object" && target.anchor === "center") return 1;
  return target.family === "canvas" ? 2 : 3;
}

function sourceRank(anchor: SnapAnchorName): number {
  return anchor === "center" ? 0 : anchor === "min" ? 1 : 2;
}

function screenCorrection(matrix: MatrixCoefficients, axis: SnapAxis, correction: number): number {
  const x = axis === "x" ? correction : 0;
  const y = axis === "y" ? correction : 0;
  return Math.hypot(matrix.a * x + matrix.c * y, matrix.b * x + matrix.d * y);
}

function chooseWinner(candidates: SnapWinner[]): SnapWinner | undefined {
  return candidates.sort((left, right) => {
    const distance = left.correctionPx - right.correctionPx;
    if (Math.abs(distance) > 0.001) return distance;
    return targetRank(left) - targetRank(right)
      || left.order - right.order
      || (left.anchor === "min" ? 0 : 1) - (right.anchor === "min" ? 0 : 1)
      || sourceRank(left.sourceAnchor) - sourceRank(right.sourceAnchor);
  })[0];
}

/** Resolve a raw root-space translation against deterministic canvas/object anchors. */
export function snapTranslation(
  box: TransformBox,
  rawDx: number,
  rawDy: number,
  targets: SnapTarget[],
  rootToScreen: MatrixCoefficients,
  tolerancePx: number,
): TranslationSnapResult {
  if (!finiteBox(box) || ![rawDx, rawDy, tolerancePx].every(Number.isFinite) || tolerancePx < 0) {
    throw new RangeError("Snapping requires finite selection geometry and tolerance.");
  }
  const winners: SnapWinner[] = [];
  for (const axis of ["x", "y"] as const) {
    const raw = axis === "x" ? rawDx : rawDy;
    const min = (axis === "x" ? box.x : box.y) + raw;
    const max = min + (axis === "x" ? box.width : box.height);
    const candidates: SnapWinner[] = [];
    for (const target of targets.filter((candidate) => candidate.axis === axis)) {
      for (const sourceAnchor of ANCHORS) {
        const correction = target.value - anchorValue(min, max, sourceAnchor);
        const correctionPx = screenCorrection(rootToScreen, axis, correction);
        if (correctionPx <= tolerancePx + 0.001) {
          candidates.push({ ...target, correction, correctionPx, sourceAnchor });
        }
      }
    }
    const winner = chooseWinner(candidates);
    if (winner) winners.push(winner);
  }
  return {
    dx: bounded(rawDx + (winners.find((winner) => winner.axis === "x")?.correction ?? 0)),
    dy: bounded(rawDy + (winners.find((winner) => winner.axis === "y")?.correction ?? 0)),
    winners,
  };
}

export function snapUniformScale(
  box: TransformBox,
  anchor: { x: number; y: number },
  rawFactor: number,
  targets: SnapTarget[],
  rootToScreen: MatrixCoefficients,
  tolerancePx: number,
  axes: SnapAxis[] = ["x", "y"],
): ScaleSnapResult {
  if (!finiteBox(box) || ![anchor.x, anchor.y, rawFactor, tolerancePx].every(Number.isFinite)) {
    throw new RangeError("Resize snapping requires finite geometry.");
  }
  const candidates: Array<SnapWinner & { factor: number }> = [];
  for (const axis of axes) {
    const pivot = axis === "x" ? anchor.x : anchor.y;
    const min = axis === "x" ? box.x : box.y;
    const max = min + (axis === "x" ? box.width : box.height);
    for (const target of targets.filter((candidate) => candidate.axis === axis)) {
      for (const sourceAnchor of ANCHORS) {
        const source = anchorValue(min, max, sourceAnchor);
        const denominator = source - pivot;
        if (Math.abs(denominator) < MIN_SCALE) continue;
        const factor = (target.value - pivot) / denominator;
        if (!Number.isFinite(factor) || factor < MIN_SCALE) continue;
        const rawValue = pivot + denominator * rawFactor;
        const correction = target.value - rawValue;
        const correctionPx = screenCorrection(rootToScreen, axis, correction);
        if (correctionPx <= tolerancePx + 0.001) {
          candidates.push({ ...target, correction, correctionPx, sourceAnchor, factor });
        }
      }
    }
  }
  const winner = candidates.sort((left, right) => {
    const distance = left.correctionPx - right.correctionPx;
    if (Math.abs(distance) > 0.001) return distance;
    return targetRank(left) - targetRank(right)
      || left.order - right.order
      || (left.anchor === "min" ? 0 : 1) - (right.anchor === "min" ? 0 : 1)
      || sourceRank(left.sourceAnchor) - sourceRank(right.sourceAnchor)
      || (left.axis === "x" ? 0 : 1) - (right.axis === "x" ? 0 : 1);
  })[0];
  return winner ? { factor: bounded(winner.factor), winner } : { factor: rawFactor };
}

/** Shift rotation snaps the absolute visible frame angle; Alt/Option remains free. */
export function snapAbsoluteRotation(
  baseDegrees: number,
  rawDeltaDegrees: number,
  shiftKey: boolean,
  altKey: boolean,
  direction = 0,
): number {
  if (![baseDegrees, rawDeltaDegrees, direction].every(Number.isFinite)) {
    throw new RangeError("Rotation snapping requires finite angles.");
  }
  if (!shiftKey || altKey) return rawDeltaDegrees;
  const absolute = baseDegrees + rawDeltaDegrees;
  const lower = Math.floor(absolute / 15) * 15;
  const upper = lower + 15;
  const lowerDistance = Math.abs(absolute - lower);
  const upperDistance = Math.abs(upper - absolute);
  const snapped = Math.abs(lowerDistance - upperDistance) <= 1e-9
    ? direction > 0 ? upper : direction < 0 ? lower : absolute >= 0 ? upper : lower
    : lowerDistance < upperDistance ? lower : upper;
  return bounded(snapped - baseDegrees);
}

export function boxSnapTargets(
  box: TransformBox,
  family: SnapTargetFamily,
  key: string,
  order: number,
): SnapTarget[] {
  if (!finiteBox(box)) return [];
  return [
    ...ANCHORS.map((anchor): SnapTarget => ({
      axis: "x", anchor, family, key, order,
      value: anchorValue(box.x, box.x + box.width, anchor),
      spanMin: box.y, spanMax: box.y + box.height,
    })),
    ...ANCHORS.map((anchor): SnapTarget => ({
      axis: "y", anchor, family, key, order,
      value: anchorValue(box.y, box.y + box.height, anchor),
      spanMin: box.x, spanMax: box.x + box.width,
    })),
  ];
}

function bounded(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_COEFFICIENT) {
    throw new RangeError("The grouped transform exceeds the supported numeric range.");
  }
  const rounded = Number(value.toFixed(MATRIX_PRECISION));
  return Object.is(rounded, -0) || Math.abs(rounded) < 10 ** -MATRIX_PRECISION ? 0 : rounded;
}

function multiply(left: MatrixCoefficients, right: MatrixCoefficients): MatrixCoefficients {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

const IDENTITY: MatrixCoefficients = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function determinant(matrix: MatrixCoefficients): number {
  return matrix.a * matrix.d - matrix.b * matrix.c;
}

function inverse(matrix: MatrixCoefficients): MatrixCoefficients {
  const value = determinant(matrix);
  if (!Number.isFinite(value) || value === 0) {
    throw new RangeError("The selected layer has a singular parent transform.");
  }
  const result = {
    a: matrix.d / value,
    b: -matrix.b / value,
    c: -matrix.c / value,
    d: matrix.a / value,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) / value,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) / value,
  };
  if (Object.values(result).some((coefficient) => !Number.isFinite(coefficient) || Math.abs(coefficient) > MAX_COEFFICIENT)) {
    throw new RangeError("The selected layer's parent transform exceeds the supported numeric range.");
  }
  return result;
}

function normalized(matrix: MatrixCoefficients): MatrixCoefficients {
  return {
    a: bounded(matrix.a),
    b: bounded(matrix.b),
    c: bounded(matrix.c),
    d: bounded(matrix.d),
    e: bounded(matrix.e),
    f: bounded(matrix.f),
  };
}

function finiteBox(box: TransformBox): boolean {
  return [box.x, box.y, box.width, box.height].every(Number.isFinite)
    && box.width > 0
    && box.height > 0;
}

export function formatMatrix(matrix: MatrixCoefficients): string {
  const value = normalized(matrix);
  return `matrix(${[value.a, value.b, value.c, value.d, value.e, value.f].join(",")})`;
}

export function relativeMatrix(
  rootToScreen: MatrixCoefficients,
  localToScreen: MatrixCoefficients,
): MatrixCoefficients {
  return normalized(multiply(inverse(rootToScreen), localToScreen));
}

export function transformVectorToLocal(
  localToRoot: MatrixCoefficients,
  dx: number,
  dy: number,
): { dx: number; dy: number } {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    throw new RangeError("The selection translation contains a non-finite offset.");
  }
  const local = inverse(localToRoot);
  return {
    dx: bounded(local.a * dx + local.c * dy),
    dy: bounded(local.b * dx + local.d * dy),
  };
}

export function transformPointToLocal(
  localToRoot: MatrixCoefficients,
  x: number,
  y: number,
): { x: number; y: number } {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new RangeError("The collective transform pointer is non-finite.");
  }
  const local = inverse(localToRoot);
  return {
    x: bounded(local.a * x + local.c * y + local.e),
    y: bounded(local.b * x + local.d * y + local.f),
  };
}

export function composeRootTranslation(
  initial: MatrixCoefficients,
  parentToRoot: MatrixCoefficients,
  dx: number,
  dy: number,
): MatrixCoefficients {
  const local = transformVectorToLocal(parentToRoot, dx, dy);
  return normalized({
    ...initial,
    e: initial.e + local.dx,
    f: initial.f + local.dy,
  });
}

export interface SelectionTranslationTarget {
  element: SVGGraphicsElement;
  initial: MatrixCoefficients;
  parentToRoot: MatrixCoefficients;
}

export class SelectionTranslationGesture {
  readonly #targets: Array<SelectionTranslationTarget & { originalTransform: string | null }>;
  #currentDx = 0;
  #currentDy = 0;

  constructor(targets: SelectionTranslationTarget[]) {
    if (targets.length === 0 || new Set(targets.map((target) => target.element)).size !== targets.length) {
      throw new RangeError("Selection translation requires distinct connected layers.");
    }
    this.#targets = targets.map((target) => ({
      ...target,
      initial: normalized(target.initial),
      parentToRoot: normalized(target.parentToRoot),
      originalTransform: target.element.getAttribute("transform"),
    }));
    for (const target of this.#targets) {
      transformVectorToLocal(target.parentToRoot, 0, 0);
      const horizontal = transformVectorToLocal(target.parentToRoot, 1, 0);
      const vertical = transformVectorToLocal(target.parentToRoot, 0, 1);
      if ((horizontal.dx === 0 && horizontal.dy === 0) || (vertical.dx === 0 && vertical.dy === 0)) {
        throw new RangeError("The selected layer's coordinate space exceeds the supported translation precision.");
      }
    }
  }

  move(dx: number, dy: number): boolean {
    const next = this.#targets.map((target) => formatMatrix(composeRootTranslation(
      target.initial,
      target.parentToRoot,
      dx,
      dy,
    )));
    const changed = next.some((value, index) => value !== this.#targets[index].element.getAttribute("transform"));
    next.forEach((value, index) => this.#targets[index].element.setAttribute("transform", value));
    this.#currentDx = bounded(dx);
    this.#currentDy = bounded(dy);
    return changed;
  }

  cancel(): void {
    this.#restoreOriginal();
  }

  complete(): boolean {
    if (this.#currentDx === 0 && this.#currentDy === 0) {
      this.#restoreOriginal();
      return false;
    }
    return true;
  }

  #restoreOriginal(): void {
    for (const target of this.#targets) {
      if (target.originalTransform === null) target.element.removeAttribute("transform");
      else target.element.setAttribute("transform", target.originalTransform);
    }
    this.#currentDx = 0;
    this.#currentDy = 0;
  }
}

export interface CollectiveTransformTarget extends SelectionTranslationTarget {}

export function collectiveScaleMatrix(anchorX: number, anchorY: number, factor: number): MatrixCoefficients {
  if (![anchorX, anchorY, factor].every(Number.isFinite) || factor < MIN_SCALE || factor > MAX_COEFFICIENT) {
    throw new RangeError("The collective resize exceeds the supported scale range.");
  }
  return normalized({
    a: factor,
    b: 0,
    c: 0,
    d: factor,
    e: anchorX * (1 - factor),
    f: anchorY * (1 - factor),
  });
}

/**
 * Scale in an oriented root frame while keeping the supplied opposite corner
 * fixed. This is the numeric-inspector counterpart to the collective handles:
 * it composes one root-space matrix and therefore preserves every member's
 * relative geometry, including members under different transformed parents.
 */
export function collectiveFrameScaleMatrix(
  anchorX: number,
  anchorY: number,
  scaleX: number,
  scaleY: number,
  rotationDegrees: number,
): MatrixCoefficients {
  if (![anchorX, anchorY, scaleX, scaleY, rotationDegrees].every(Number.isFinite)
    || scaleX < MIN_SCALE || scaleY < MIN_SCALE
    || scaleX > MAX_COEFFICIENT || scaleY > MAX_COEFFICIENT) {
    throw new RangeError("The oriented-frame resize exceeds the supported scale range.");
  }
  const orientedScale = normalized({
    a: scaleX,
    b: 0,
    c: 0,
    d: scaleY,
    e: anchorX * (1 - scaleX),
    f: anchorY * (1 - scaleY),
  });
  const toRoot = collectiveRotationMatrix(0, 0, rotationDegrees);
  const toFrame = collectiveRotationMatrix(0, 0, -rotationDegrees);
  return normalized(multiply(multiply(toRoot, orientedScale), toFrame));
}

export function collectiveRotationMatrix(pivotX: number, pivotY: number, degrees: number): MatrixCoefficients {
  if (![pivotX, pivotY, degrees].every(Number.isFinite)) {
    throw new RangeError("The collective rotation contains non-finite geometry.");
  }
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return normalized({
    a: cosine,
    b: sine,
    c: -sine,
    d: cosine,
    e: pivotX - cosine * pivotX + sine * pivotY,
    f: pivotY - sine * pivotX - cosine * pivotY,
  });
}

export function composeCollectiveRootTransform(
  initial: MatrixCoefficients,
  parentToRoot: MatrixCoefficients,
  collectiveRoot: MatrixCoefficients,
): MatrixCoefficients {
  return normalized(multiply(multiply(multiply(inverse(parentToRoot), collectiveRoot), parentToRoot), initial));
}

export class CollectiveTransformGesture {
  readonly #targets: Array<CollectiveTransformTarget & { originalTransform: string | null }>;
  #currentRoot = IDENTITY;

  constructor(targets: CollectiveTransformTarget[]) {
    if (targets.length < 1 || new Set(targets.map((target) => target.element)).size !== targets.length) {
      throw new RangeError("A root-frame transform requires one or more distinct layers.");
    }
    this.#targets = targets.map((target) => ({
      ...target,
      initial: normalized(target.initial),
      parentToRoot: normalized(target.parentToRoot),
      originalTransform: target.element.getAttribute("transform"),
    }));
    for (const target of this.#targets) composeCollectiveRootTransform(target.initial, target.parentToRoot, IDENTITY);
  }

  apply(rootTransform: MatrixCoefficients): boolean {
    const collective = normalized(rootTransform);
    const next = this.#targets.map((target) => formatMatrix(composeCollectiveRootTransform(
      target.initial,
      target.parentToRoot,
      collective,
    )));
    const changed = next.some((value, index) => value !== this.#targets[index].element.getAttribute("transform"));
    next.forEach((value, index) => this.#targets[index].element.setAttribute("transform", value));
    this.#currentRoot = collective;
    return changed;
  }

  cancel(): void {
    this.#restoreOriginal();
  }

  complete(): boolean {
    if (formatMatrix(this.#currentRoot) === formatMatrix(IDENTITY)) {
      this.#restoreOriginal();
      return false;
    }
    return true;
  }

  #restoreOriginal(): void {
    for (const target of this.#targets) {
      if (target.originalTransform === null) target.element.removeAttribute("transform");
      else target.element.setAttribute("transform", target.originalTransform);
    }
    this.#currentRoot = IDENTITY;
  }
}

export function composeGroupDrag(
  initial: MatrixCoefficients,
  dx: number,
  dy: number,
): MatrixCoefficients {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    throw new RangeError("The grouped drag contains a non-finite offset.");
  }
  return normalized(multiply(initial, { a: 1, b: 0, c: 0, d: 1, e: bounded(dx), f: bounded(dy) }));
}

export function composeGroupResize(
  initial: MatrixCoefficients,
  source: TransformBox,
  target: TransformBox,
): MatrixCoefficients {
  if (!finiteBox(source) || !finiteBox(target)) {
    throw new RangeError("The grouped resize requires finite, non-zero bounds.");
  }
  const scaleX = target.width / source.width;
  const scaleY = target.height / source.height;
  if (scaleX < MIN_SCALE || scaleY < MIN_SCALE || scaleX > MAX_COEFFICIENT || scaleY > MAX_COEFFICIENT) {
    throw new RangeError("The grouped resize exceeds the supported scale range.");
  }
  const localResize: MatrixCoefficients = {
    a: scaleX,
    b: 0,
    c: 0,
    d: scaleY,
    e: target.x - source.x * scaleX,
    f: target.y - source.y * scaleY,
  };
  return normalized(multiply(initial, localResize));
}

export function composeGroupScale(
  initial: MatrixCoefficients,
  box: TransformBox,
  factor: number,
): MatrixCoefficients {
  if (!finiteBox(box)) {
    throw new RangeError("The grouped scale requires finite, non-zero bounds.");
  }
  if (!Number.isFinite(factor) || factor < MIN_SCALE || factor > MAX_COEFFICIENT) {
    throw new RangeError("The grouped scale exceeds the supported scale range.");
  }
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  return normalized(multiply(initial, {
    a: factor,
    b: 0,
    c: 0,
    d: factor,
    e: centerX * (1 - factor),
    f: centerY * (1 - factor),
  }));
}

export class GroupTransformGesture {
  readonly #element: SVGGraphicsElement;
  readonly #initial: MatrixCoefficients;
  readonly #originalTransform: string | null;
  readonly #sourceBox: TransformBox;
  #current: string;

  constructor(
    element: SVGGraphicsElement,
    initial: MatrixCoefficients,
    sourceBox: TransformBox,
  ) {
    if (!finiteBox(sourceBox)) throw new RangeError("The selected group has invalid bounds.");
    this.#element = element;
    this.#initial = normalized(initial);
    this.#sourceBox = { ...sourceBox };
    this.#originalTransform = element.getAttribute("transform");
    this.#current = formatMatrix(this.#initial);
  }

  drag(dx: number, dy: number): boolean {
    return this.#apply(composeGroupDrag(this.#initial, dx, dy));
  }

  resize(target: TransformBox): boolean {
    return this.#apply(composeGroupResize(this.#initial, this.#sourceBox, target));
  }

  cancel(): void {
    this.#restoreOriginal();
  }

  complete(): boolean {
    const initial = formatMatrix(this.#initial);
    if (this.#current === initial) {
      this.#restoreOriginal();
      return false;
    }
    return true;
  }

  #apply(matrix: MatrixCoefficients): boolean {
    const next = formatMatrix(matrix);
    if (next === this.#current) return false;
    this.#current = next;
    this.#element.setAttribute("transform", next);
    return true;
  }

  #restoreOriginal(): void {
    if (this.#originalTransform === null) this.#element.removeAttribute("transform");
    else this.#element.setAttribute("transform", this.#originalTransform);
    this.#current = formatMatrix(this.#initial);
  }
}
