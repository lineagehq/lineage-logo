import { getSelectionLabel, isSelectableNode, serializeSvg } from "../canvas/editor";
import { SnapshotError, parseSnapshotProjection, SNAPSHOT_MAX_LAYERS, type AgentSnapshotProjection, type AgentSnapshotRequest, type SnapshotBounds, type SnapshotLayer } from "../../shared/agent-snapshot";

export interface SnapshotCaptureState {
  root: SVGSVGElement;
  context: { sessionId: string; revision: number };
  selectedNodes: SVGGraphicsElement[];
  primary?: SVGGraphicsElement;
  lockedKeys: ReadonlySet<string>;
  pending: boolean;
}
function hidden(node: SVGGraphicsElement, root: SVGSVGElement): boolean {
  const view = root.ownerDocument.defaultView!;
  const visibility = view.getComputedStyle(node).visibility;
  if (visibility === "hidden" || visibility === "collapse") return true;
  for (let current: Element | null = node; current; current = current === root ? null : current.parentElement) {
    const style = view.getComputedStyle(current);
    if (style.display === "none" || style.opacity === "0") return true;
  }
  return false;
}
function matrixOf(node: SVGGraphicsElement, root: SVGSVGElement): DOMMatrix | undefined {
  try {
    const rootMatrix = root.getScreenCTM(), matrix = node.getScreenCTM();
    if (!rootMatrix || !matrix) return undefined;
    const relative = rootMatrix.inverse().multiply(matrix);
    return [relative.a, relative.b, relative.c, relative.d, relative.e, relative.f].every(Number.isFinite) ? relative : undefined;
  } catch { return undefined; }
}
function measure(node: SVGGraphicsElement, matrix: DOMMatrix | undefined, isHidden: boolean): SnapshotBounds {
  if (isHidden) return { status: "unsupported", reason: "hidden" };
  if (!matrix) return { status: "unsupported", reason: "unavailable" };
  try {
    const box = node.getBBox();
    const points = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]]
      .map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
    const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
    const width = Math.max(...points.map(p => p.x)) - x, height = Math.max(...points.map(p => p.y)) - y;
    if (![x, y, width, height].every(Number.isFinite)) throw new Error();
    return { status: "available", x, y, width, height };
  } catch { return { status: "unsupported", reason: "unavailable" }; }
}
/** Synchronous accepted-document projection: no await, mutation or file access. */
export function captureAgentSnapshot(state: SnapshotCaptureState, request: AgentSnapshotRequest): AgentSnapshotProjection {
  if (state.pending) throw new SnapshotError("pending_review");
  if (!state.root.isConnected) throw new SnapshotError("snapshot_unavailable");
  if (state.context.sessionId !== request.sessionId || state.context.revision !== request.baseRevision) throw new SnapshotError("stale_snapshot");
  const { root } = state;
  const svg = serializeSvg(root, true);
  // The keyed clone has the same element topology as clean output after removing
  // legacy editor metadata; keys themselves are never inserted into exported SVG.
  const keyed = new DOMParser().parseFromString(serializeSvg(root, false), "image/svg+xml").documentElement;
  keyed.querySelectorAll("metadata#lineage-logo-edit").forEach(node => node.remove());
  const originals = new Map(Array.from(root.querySelectorAll<SVGGraphicsElement>("[data-lineage-key]"))
    .filter(node => isSelectableNode(node, root)).map(node => [node.dataset.lineageKey!, node]));
  if (originals.size > SNAPSHOT_MAX_LAYERS) throw new SnapshotError("snapshot_too_large");
  const pathOf = (node: Element): number[] => {
    const result: number[] = [];
    for (let current = node; current !== keyed;) {
      const parent = current.parentElement;
      if (!parent) throw new SnapshotError("invalid_snapshot");
      result.unshift(Array.from(parent.children).indexOf(current)); current = parent;
    }
    return result;
  };
  const layers: SnapshotLayer[] = [];
  for (const node of Array.from(keyed.querySelectorAll("[data-lineage-key]"))) {
    const key = node.getAttribute("data-lineage-key")!;
    const original = originals.get(key);
    if (!original) continue;
    const matrix = matrixOf(original, root);
    const isHidden = hidden(original, root);
    let parentLayerId: string | null = null, locked = false;
    for (let current: Element | null = original; current && current !== root; current = current.parentElement) {
      const currentKey = current.getAttribute("data-lineage-key");
      if (currentKey && state.lockedKeys.has(currentKey)) locked = true;
      if (current !== original && parentLayerId === null && currentKey && originals.has(currentKey)) parentLayerId = currentKey;
    }
    const style = root.ownerDocument.defaultView!.getComputedStyle(original);
    const paint = (attribute: string) => {
      // Computed local paint URLs can be made absolute by the browser. Expose
      // local fragment references, never the page URL or its query string.
      let computed: string | null = style.getPropertyValue(attribute) || null;
      if (computed?.includes("url(")) {
        const local = /url\(["']?(?:[^#"')]*)(#[A-Za-z_][\w:.-]*)["']?\)/.exec(computed);
        computed = local ? computed.replace(local[0], `url(${local[1]})`) : null;
      }
      return { explicit: original.getAttribute(attribute), computed };
    };
    layers.push({ layerId: key, svgId: node.getAttribute("id"), svgPath: pathOf(node), parentLayerId,
      type: original.localName, name: getSelectionLabel(original, root), hidden: isHidden, locked,
      transform: original.getAttribute("transform"), matrix: matrix ? [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f] : null,
      bounds: measure(original, matrix, isHidden),
      paint: { fill: paint("fill"), stroke: paint("stroke"), strokeWidth: paint("stroke-width"), opacity: paint("opacity") },
    });
  }
  const frame = root.viewBox.baseVal;
  const documentBounds: SnapshotBounds = frame && frame.width > 0 && frame.height > 0
    ? { status: "available", x: frame.x, y: frame.y, width: frame.width, height: frame.height }
    : { status: "unsupported", reason: "no-viewbox" };
  const selectedLayerIds = state.selectedNodes.map(node => node.dataset.lineageKey!).filter(key => originals.has(key));
  return parseSnapshotProjection({ schemaVersion: 1, sessionId: state.context.sessionId, baseRevision: state.context.revision, svg, documentBounds,
    selectedLayerIds, primaryLayerId: state.primary?.dataset.lineageKey && selectedLayerIds.includes(state.primary.dataset.lineageKey) ? state.primary.dataset.lineageKey : null, layers });
}
