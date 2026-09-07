import { validateSnapshotSvg } from "./agent-snapshot.js";

export const LOGO_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const BLANK_LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><g id="logo"/></svg>\n';

/** Validate before writing or mounting: never insert untrusted SVG as HTML. */
export function validateLogoImport(svg: unknown): string {
  if (typeof svg !== "string" || !svg.trim()) throw new Error("Choose a non-empty SVG file.");
  if (new TextEncoder().encode(svg).byteLength > LOGO_IMPORT_MAX_BYTES) throw new Error("Choose an SVG smaller than 5 MB.");
  try { validateSnapshotSvg(svg); } catch {
    throw new Error("This SVG is malformed or contains unsupported active or external content. Export a standalone SVG with embedded shapes, local resources, and no scripts, animation, linked images, or external fonts.");
  }
  return svg;
}

export function logoFilenameStem(name: unknown): string {
  if (typeof name !== "string" || !name.trim() || name.length > 256) throw new Error("Enter a logo name between 1 and 256 characters.");
  if (/[\\/\u0000-\u001f\u007f]/.test(name) || /^\.+$/.test(name.trim())) throw new Error("Use a filename, without folders or control characters.");
  return name.trim().replace(/\.svg$/i, "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[._-]+|[._-]+$/g, "").slice(0, 64).replace(/[._-]+$/g, "") || "logo";
}
