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

const MATRIX_PRECISION = 6;
const MAX_COEFFICIENT = 1_000_000_000;
const MIN_SCALE = 10 ** -MATRIX_PRECISION;

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
