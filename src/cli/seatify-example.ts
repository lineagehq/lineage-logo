import { constants } from "node:fs";
import { access, copyFile, lstat, mkdir, readdir, readFile, rmdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE = "seatify-constellation.svg";

function packageFixture(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../examples", FIXTURE);
}

export class SeatifyBootstrapError extends Error {
  constructor(readonly kind: "conflict" | "unavailable" | "io", cause?: unknown) {
    super(kind);
    this.name = "SeatifyBootstrapError";
    this.cause = cause;
  }
}

export interface SeatifyBootstrapDependencies {
  copyFile?: typeof copyFile;
}

async function directory(pathname: string): Promise<void> {
  const info = await lstat(pathname);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("conflict");
}

/** Creates a sealed starter workspace, never merging with user-owned contents. */
export async function bootstrapSeatifyExample(workspace: string, fixture = packageFixture(), dependencies: SeatifyBootstrapDependencies = {}): Promise<void> {
  let source: Buffer;
  try {
    await access(fixture, constants.R_OK);
    source = await readFile(fixture);
  } catch (error) {
    throw new SeatifyBootstrapError("unavailable", error);
  }
  const exists = await lstat(workspace).then(() => true).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
  const concepts = path.join(workspace, "concepts");
  const iterations = path.join(workspace, "iterations");
  const destination = path.join(concepts, FIXTURE);
  if (exists) {
    try {
      await directory(workspace);
      const rootEntries = await readdir(workspace);
      if (rootEntries.length !== 2 || !rootEntries.includes("concepts") || !rootEntries.includes("iterations")) throw new Error("conflict");
      await Promise.all([directory(concepts), directory(iterations)]);
      const [conceptEntries, iterationEntries] = await Promise.all([readdir(concepts), readdir(iterations)]);
      if (conceptEntries.length !== 1 || conceptEntries[0] !== FIXTURE || iterationEntries.length !== 0) throw new Error("conflict");
      const destinationInfo = await lstat(destination);
      if (!destinationInfo.isFile() || destinationInfo.isSymbolicLink()) throw new Error("conflict");
      const installed = await readFile(destination);
      if (!installed.equals(source)) throw new Error("conflict");
    } catch (error) {
      throw new SeatifyBootstrapError("conflict", error);
    }
    return;
  }
  try {
    await mkdir(workspace, { recursive: false });
    await mkdir(concepts);
    await mkdir(iterations);
    await (dependencies.copyFile ?? copyFile)(fixture, destination, constants.COPYFILE_EXCL);
  } catch (error) {
    await rmdir(concepts).catch(() => undefined);
    await rmdir(iterations).catch(() => undefined);
    await rmdir(workspace).catch(() => undefined);
    throw new SeatifyBootstrapError("io", error);
  }
}
