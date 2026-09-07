import { validateSnapshotSvg } from "../../shared/agent-snapshot";
import { createSvgPreview, measureArtworkBounds, type PreviewMeasure } from "../preview";

export interface AssetRequest { targetId?: string; }
export interface PngRequest { size: number; background: "transparent" | "white" | "black"; }
const GENERIC_FONTS = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"]);

/** Local font detection must not mistake FontFaceSet.check's nonexistent-family success for availability. */
export function browserHasFont(family: string): boolean {
  if (GENERIC_FONTS.has(family.toLowerCase())) return true;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return false;
  const sample = "mmmmmmmmmmWWWWiiii0123456789";
  return ["monospace", "serif"].some(fallback => {
    context.font = `72px ${fallback}`;
    const baseline = context.measureText(sample).width;
    context.font = `72px ${JSON.stringify(family)}, ${fallback}`;
    return context.measureText(sample).width !== baseline;
  });
}

export function buildSvgAsset(source: string, request: AssetRequest = {}, options: { measure?: PreviewMeasure; hasFont?: (family: string) => boolean } = {}): string {
  if (new TextEncoder().encode(source).byteLength > 5 * 1024 * 1024) throw new Error("Export SVG must be no larger than 5 MB.");
  try { validateSnapshotSvg(source); } catch { throw new Error("Export needs a standalone passive SVG with local resources. Remove external resources or unsupported active content."); }
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = parsed.documentElement;
  // CSS may depend on omitted siblings or the host document; do not silently export a changed appearance.
  if (root.querySelector("style")) throw new Error("Export cannot guarantee stylesheet-dependent artwork. Convert stylesheet rules to presentation attributes first.");
  if (root.querySelector("filter, marker, image, foreignObject")) throw new Error("Export cannot guarantee filter, marker or image bounds. Use ordinary SVG shapes and local gradients, masks or clipping paths.");
  const ids = new Map<string, Element>();
  for (const node of Array.from(root.querySelectorAll("[id]"))) {
    if (ids.has(node.id)) throw new Error(`Duplicate SVG ID ${node.id}. Give each element a unique ID before export.`);
    ids.set(node.id, node);
  }
  const target = request.targetId ? ids.get(request.targetId) : root;
  if (!target || target.closest("defs,clipPath,mask,pattern,symbol")) throw new Error("Choose a visible artwork layer for this export.");
  for (const node of [root, ...Array.from(root.querySelectorAll("*"))]) {
    const style = (node as SVGElement).style;
    if (style?.getPropertyValue("font") || /var\(/i.test(style?.fontFamily || node.getAttribute("font-family") || "")) throw new Error("Use an explicit font-family instead of a font shorthand or variable before export.");
    for (const attribute of Array.from(node.attributes)) {
      const refs = Array.from(attribute.value.matchAll(/url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g), match => match[1]);
      if (attribute.localName === "href") refs.push(attribute.value.slice(1));
      for (const id of refs) {
        const referenced = ids.get(id);
        if (!referenced) throw new Error(`Missing local resource #${id}. Restore it before exporting.`);
        if (request.targetId && !target.contains(referenced) && !referenced.closest("defs")) throw new Error(`Resource #${id} is outside this target. Place shared resources in defs before exporting a subset.`);
      }
    }
  }
  const hasFont = options.hasFont ?? browserHasFont;
  const validateFonts = (scope: Element) => {
    for (const text of Array.from(scope.querySelectorAll("text,tspan")).concat(scope.localName === "text" ? [scope] : [])) {
      let owner: Element | null = text;
      let family = "";
      while (owner && !family) { family = (owner as SVGElement).style?.fontFamily || owner.getAttribute("font-family") || ""; owner = owner.parentElement; }
      const first = (family || "serif").split(",")[0].trim().replace(/^['"]|['"]$/g, "");
      if (!hasFont(first)) throw new Error(`Font “${first}” is unavailable locally. Install it or choose an available font before export. Text is not outlined.`);
    }
  };
  if (request.targetId) {
    const result = createSvgPreview(source, `#${request.targetId}`, options.measure);
    if (result.fallback) throw new Error(result.status.replace("Whole SVG fallback:", "Cannot export target:"));
    const isolated = new DOMParser().parseFromString(result.svg, "image/svg+xml").documentElement;
    // Referenced text in retained defs is part of the asset, too.
    validateFonts(isolated);
    const originalFrame = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
    if (!originalFrame || originalFrame.length !== 4 || originalFrame.some(value => !Number.isFinite(value)) || originalFrame[2] <= 0 || originalFrame[3] <= 0) {
      throw new Error("Subset export requires a positive finite viewBox to preserve the original coordinate system.");
    }
    // Crop with an outer frame while keeping percentage geometry and user-space
    // resources relative to their original viewport inside it.
    const cropped = isolated.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
    cropped.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    cropped.setAttribute("viewBox", isolated.getAttribute("viewBox")!);
    cropped.setAttribute("preserveAspectRatio", "xMidYMid meet");
    isolated.setAttribute("viewBox", originalFrame.join(" "));
    for (const [name, value] of [["x", originalFrame[0]], ["y", originalFrame[1]], ["width", originalFrame[2]], ["height", originalFrame[3]]] as const) isolated.setAttribute(name, String(value));
    isolated.setAttribute("overflow", "visible");
    cropped.append(isolated);
    return cropped.outerHTML;
  }
  validateFonts(root);
  const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || viewBox.some(value => !Number.isFinite(value)) || viewBox[2] <= 0 || viewBox[3] <= 0) throw new Error("Full-logo export requires a positive finite viewBox. Set the document bounds first.");
  if (!options.measure && !measureArtworkBounds(source)) throw new Error("The document has no measurable visible artwork to export.");
  root.setAttribute("preserveAspectRatio", "xMidYMid meet");
  root.removeAttribute("width"); root.removeAttribute("height");
  return root.outerHTML;
}

/** A square PNG with aspect-preserving letterboxing, suitable for small icon sizes. */
export async function renderPngAsset(svg: string, request: PngRequest): Promise<Blob> {
  if (!Number.isInteger(request.size) || request.size < 1 || request.size > 4096) throw new Error("Choose a PNG size from 1 to 4096 pixels.");
  if (!["transparent", "white", "black"].includes(request.background)) throw new Error("Choose a transparent, white or black background.");
  validateSnapshotSvg(svg);
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (parsed.querySelector("parsererror") || parsed.documentElement.localName !== "svg") throw new Error("PNG export requires valid SVG.");
  parsed.documentElement.setAttribute("width", String(request.size));
  parsed.documentElement.setAttribute("height", String(request.size));
  parsed.documentElement.setAttribute("preserveAspectRatio", "xMidYMid meet");
  const url = URL.createObjectURL(new Blob([parsed.documentElement.outerHTML], { type: "image/svg+xml" }));
  try {
    const image = new Image(); image.src = url;
    await image.decode().catch(() => { throw new Error("The SVG could not be decoded for PNG export."); });
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = request.size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PNG export is unavailable in this browser.");
    if (request.background !== "transparent") { context.fillStyle = request.background; context.fillRect(0, 0, request.size, request.size); }
    // The SVG root's meet alignment controls content fitting inside this square viewport.
    context.drawImage(image, 0, 0, request.size, request.size);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNG encoding failed. Try a smaller size.")), "image/png"));
  } finally { URL.revokeObjectURL(url); }
}
