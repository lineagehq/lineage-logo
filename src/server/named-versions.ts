import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, realpath, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateSnapshotSvg } from "../shared/agent-snapshot.js";
import { versionFilename } from "../shared/version-name.js";
import { readWorkspaceSvg, type SvgFileEntry } from "./workspace.js";

/** A new immutable copy. Existing files (including symlinks) are never overwritten. */
export async function saveNamedVersion(root: string, sourcePath: string, name: unknown, svg: string): Promise<SvgFileEntry> {
  const filename = versionFilename(name);
  if (typeof svg !== "string" || Buffer.byteLength(svg, "utf8") > 5 * 1024 * 1024) throw new Error("Named SVG must be no larger than 5 MB.");
  validateSnapshotSvg(svg);
  const canonical = await realpath(root);
  await readWorkspaceSvg(canonical, sourcePath);
  const directory = path.join(canonical, "iterations");
  await mkdir(directory, { recursive: true });
  if ((await lstat(directory)).isSymbolicLink() || await realpath(directory) !== directory) throw new Error("The iterations folder must be inside this workspace, without a symbolic link.");
  const temporary = path.join(directory, `.lineage-version-${randomUUID()}.tmp`);
  await writeFile(temporary, svg, { encoding: "utf8", flag: "wx" });
  try {
    await link(temporary, path.join(directory, filename));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("That version name already exists. Choose another name; no file was overwritten.");
    throw error;
  } finally { await unlink(temporary); }
  return { collection: "iterations", name: filename, path: `iterations/${filename}` };
}
