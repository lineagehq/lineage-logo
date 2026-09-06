/** Presentation-only sizing: never change authored SVG attributes. */
export interface DocumentFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  basis: "viewBox" | "dimensions" | "fallback";
}

export function documentFrame(svg: Pick<Element, "getAttribute">): DocumentFrame {
  const values = (svg.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (values.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0) {
    return { x: values[0], y: values[1], width: values[2], height: values[3], basis: "viewBox" };
  }
  const dimension = (name: string): number | undefined => {
    const value = svg.getAttribute(name)?.trim();
    if (!value || !/^(?:\d+(?:\.\d*)?|\.\d+)(?:px)?$/.test(value)) return undefined;
    const number = Number.parseFloat(value);
    return number > 0 && Number.isFinite(number) ? number : undefined;
  };
  const width = dimension("width");
  const height = dimension("height");
  if (width && height) return { x: 0, y: 0, width, height, basis: "dimensions" };
  return { x: 0, y: 0, width: 300, height: 150, basis: "fallback" };
}

export function applyDocumentFrame(board: HTMLElement, svg: SVGSVGElement): DocumentFrame {
  const frame = documentFrame(svg);
  board.style.width = `${frame.width}px`;
  board.style.height = `${frame.height}px`;
  board.dataset.frameBasis = frame.basis;
  board.title = frame.basis === "viewBox"
    ? "Document bounds. At 100%, one SVG unit equals one CSS pixel."
    : frame.basis === "dimensions"
      ? "Document bounds use the SVG pixel dimensions."
      : "No usable viewBox or pixel dimensions: preview uses a 300 × 150 CSS pixel fallback.";
  return frame;
}

export function fitDocumentZoom(availableWidth: number, availableHeight: number, width: number, height: number): number {
  if (![availableWidth, availableHeight, width, height].every((value) => Number.isFinite(value) && value > 0)) return 1;
  return Math.min(4, Math.max(0.01, Math.min(availableWidth / width, availableHeight / height)));
}

/** Include negative/outside artwork in scrollable layout without moving SVG nodes. */
export function extendedDocumentBounds(frame: DocumentFrame, artwork?: { x: number; y: number; width: number; height: number }): DocumentFrame {
  if (!artwork) return frame;
  const x = Math.min(frame.x, artwork.x);
  const y = Math.min(frame.y, artwork.y);
  return { ...frame, x, y, width: Math.max(frame.x + frame.width, artwork.x + artwork.width) - x,
    height: Math.max(frame.y + frame.height, artwork.y + artwork.height) - y };
}
