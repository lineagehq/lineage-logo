import { randomUUID } from "node:crypto";
import { link, mkdir, realpath, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { BLANK_LOGO_SVG, logoFilenameStem, validateLogoImport } from "../shared/logo-creation.js";
import type { SvgFileEntry } from "./workspace.js";

/** A new concept is exclusively linked into place; existing artwork is never overwritten. */
export async function createWorkspaceLogo(root: string, input: unknown): Promise<SvgFileEntry> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Provide a logo name and optional SVG.");
  const request = input as Record<string, unknown>;
  if (Object.keys(request).some(key => !["name", "svg"].includes(key))) throw new Error("Create request contains unsupported fields.");
  const stem = logoFilenameStem(request.name);
  const svg = validateLogoImport(request.svg === undefined ? BLANK_LOGO_SVG : request.svg);
  const canonicalRoot = await realpath(root);
  const directory = path.join(canonicalRoot, "concepts");
  await mkdir(directory, { recursive: true });
  const resolved = await realpath(directory);
  // Require the actual collection, not a symlink to another folder inside or outside the workspace.
  if (resolved !== directory) throw new Error("The concepts folder must be a real folder in this workspace. Choose a workspace without a linked concepts folder.");
  const temporary = path.join(resolved, `.lineage-import-${randomUUID()}.tmp`);
  await writeFile(temporary, svg, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try {
    for (let index = 1; index <= 1000; index++) {
      const name = `${stem}${index === 1 ? "" : `-${index}`}.svg`;
      try {
        await link(temporary, path.join(resolved, name));
        return { collection: "concepts", name, path: `concepts/${name}` };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    throw new Error("Too many logos share that name. Choose another name.");
  } finally { await unlink(temporary).catch(() => undefined); }
}
