import { realpath, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const SVG_LIMIT_BYTES = 5 * 1024 * 1024;
const COLLECTIONS = ["concepts", "iterations"] as const;

export type Collection = (typeof COLLECTIONS)[number];

export interface SvgFileEntry {
  collection: Collection;
  name: string;
  path: string;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

export async function resolveWorkspaceRoot(input: string): Promise<string> {
  if (!input) {
    throw new Error("Pass an explicit logo workspace with --workspace <path>.");
  }

  const resolved = await realpath(path.resolve(input));
  const info = await stat(resolved);
  if (!info.isDirectory()) {
    throw new Error(`Workspace is not a directory: ${resolved}`);
  }
  return resolved;
}

export async function listSvgFiles(root: string): Promise<SvgFileEntry[]> {
  const files: SvgFileEntry[] = [];

  for (const collection of COLLECTIONS) {
    const directory = path.join(root, collection);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".svg") {
        continue;
      }
      files.push({
        collection,
        name: entry.name,
        path: `${collection}/${entry.name}`,
      });
    }
  }

  return files.sort((left, right) =>
    left.path.localeCompare(right.path, undefined, { numeric: true }),
  );
}

export async function readWorkspaceSvg(root: string, requestedPath: string): Promise<string> {
  if (!requestedPath || path.isAbsolute(requestedPath)) {
    throw new Error("SVG path must be relative to the workspace.");
  }

  const normalized = path.normalize(requestedPath);
  const [collection] = normalized.split(path.sep);
  if (!COLLECTIONS.includes(collection as Collection) || path.extname(normalized).toLowerCase() !== ".svg") {
    throw new Error("Only SVG files in concepts/ or iterations/ can be opened.");
  }

  const candidate = await realpath(path.join(root, normalized));
  if (!isInside(root, candidate)) {
    throw new Error("Requested SVG escapes the selected workspace.");
  }

  const info = await stat(candidate);
  if (!info.isFile() || info.size > SVG_LIMIT_BYTES) {
    throw new Error("Requested SVG is not a supported file.");
  }

  const svg = await readFile(candidate, "utf8");
  validateSvg(svg);
  return svg;
}

export function validateSvg(svg: string): void {
  if (!/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(svg)) {
    throw new Error("File does not contain an SVG root element.");
  }

  const forbidden = [
    /<script\b/i,
    /<foreignObject\b/i,
    /\son[a-z]+\s*=/i,
    /(?:href|src)\s*=\s*["'](?!#)[^"']+/i,
    /url\s*\(\s*(?:["']\s*)?(?!#)/i,
  ];
  if (forbidden.some((pattern) => pattern.test(svg))) {
    throw new Error("SVG contains active or external content.");
  }
}
