import { randomUUID } from "node:crypto";
import { link, mkdir, realpath, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
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

export async function getNextIterationPath(root: string): Promise<string> {
  const files = await listSvgFiles(root);
  const highest = files
    .filter((file) => file.collection === "iterations")
    .map((file) => /^iteration-(\d+)\.svg$/i.exec(file.name))
    .filter((match): match is RegExpExecArray => match !== null)
    .reduce((maximum, match) => Math.max(maximum, Number(match[1])), 0);
  return `iterations/iteration-${highest + 1}.svg`;
}

export async function saveNextIteration(
  root: string,
  sourcePath: string,
  svg: string,
): Promise<SvgFileEntry> {
  if (Buffer.byteLength(svg, "utf8") > SVG_LIMIT_BYTES) {
    throw new Error("Edited SVG exceeds the 5 MB document limit.");
  }
  validateSvg(svg);
  await readWorkspaceSvg(root, sourcePath);

  const iterationsDirectory = path.join(root, "iterations");
  await mkdir(iterationsDirectory, { recursive: true });
  const resolvedIterations = await realpath(iterationsDirectory);
  if (!isInside(root, resolvedIterations)) {
    throw new Error("Iterations directory escapes the selected workspace.");
  }

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const relativePath = await getNextIterationPath(root);
    const name = path.basename(relativePath);
    const target = path.join(root, relativePath);
    const temporary = path.join(resolvedIterations, `.lineage-logo-${randomUUID()}.tmp`);
    await writeFile(temporary, stripReservedEditMetadata(svg), { encoding: "utf8", flag: "wx" });

    try {
      await link(temporary, target);
      return { collection: "iterations", name, path: relativePath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  throw new Error("Unable to allocate the next iteration filename.");
}

export function stripReservedEditMetadata(svg: string): string {
  return svg.replace(/\s*<metadata\s+id=["']lineage-logo-edit["'][^>]*>[\s\S]*?<\/metadata>/gi, "");
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
