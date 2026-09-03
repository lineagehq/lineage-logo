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

async function directory(pathname: string): Promise<void> {
  const info = await lstat(pathname);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new SeatifyBootstrapError("conflict");
}

/** Creates a sealed starter workspace, never merging with user-owned contents. */
export async function bootstrapSeatifyExample(workspace: string): Promise<void> {
  const fixture = packageFixture();
  let source: Buffer;
  try {
    await access(fixture, constants.R_OK);
    source = await readFile(fixture);
  } catch (error) {
    throw new SeatifyBootstrapError("unavailable", error);
  }
  let exists: boolean;
  try {
    await lstat(workspace);
    exists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") exists = false;
    else throw new SeatifyBootstrapError("io", error);
  }
  const concepts = path.join(workspace, "concepts");
  const iterations = path.join(workspace, "iterations");
  const destination = path.join(concepts, FIXTURE);
  if (exists) {
    try {
      await directory(workspace);
      const rootEntries = await readdir(workspace);
      if (rootEntries.length !== 2 || !rootEntries.includes("concepts") || !rootEntries.includes("iterations")) throw new SeatifyBootstrapError("conflict");
      await Promise.all([directory(concepts), directory(iterations)]);
      const [conceptEntries, iterationEntries] = await Promise.all([readdir(concepts), readdir(iterations)]);
      if (conceptEntries.length !== 1 || conceptEntries[0] !== FIXTURE || iterationEntries.length !== 0) throw new SeatifyBootstrapError("conflict");
      const destinationInfo = await lstat(destination);
      if (!destinationInfo.isFile() || destinationInfo.isSymbolicLink()) throw new SeatifyBootstrapError("conflict");
      const installed = await readFile(destination);
      if (!installed.equals(source)) throw new SeatifyBootstrapError("conflict");
    } catch (error) {
      if (error instanceof SeatifyBootstrapError && error.kind === "conflict") throw error;
      throw new SeatifyBootstrapError("io", error);
    }
    return;
  }
  let createdWorkspace = false;
  let createdConcepts = false;
  let createdIterations = false;
  try {
    await mkdir(workspace, { recursive: false });
    createdWorkspace = true;
    await mkdir(concepts);
    createdConcepts = true;
    await mkdir(iterations);
    createdIterations = true;
    await copyFile(fixture, destination, constants.COPYFILE_EXCL);
  } catch (error) {
    if (createdConcepts) await rmdir(concepts).catch(() => undefined);
    if (createdIterations) await rmdir(iterations).catch(() => undefined);
    if (createdWorkspace) await rmdir(workspace).catch(() => undefined);
    throw new SeatifyBootstrapError("io", error);
  }
}
