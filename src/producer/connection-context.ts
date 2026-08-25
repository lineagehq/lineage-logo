import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface AgentConnectionContext {
  protocolVersion: 1;
  apiOrigin: string;
  token: string;
  pid: number;
}

function ownerId(): number | undefined {
  return typeof process.getuid === "function" ? process.getuid() : undefined;
}

export function defaultAgentContextPath(): string {
  return process.env.LINEAGE_LOGO_CONTEXT_FILE
    ?? path.join(os.tmpdir(), `lineage-logo-${ownerId() ?? "user"}`, "active-context.json");
}

async function requirePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Agent context directory must be a regular directory.");
  if (ownerId() !== undefined && info.uid !== ownerId()) throw new Error("Agent context directory must be owned by the current user.");
  if ((info.mode & 0o077) !== 0) await chmod(directory, 0o700);
}

function parseContext(value: unknown): AgentConnectionContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Agent connection context is invalid.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["protocolVersion", "apiOrigin", "token", "pid"].includes(key))
    || input.protocolVersion !== 1 || typeof input.apiOrigin !== "string" || typeof input.token !== "string"
    || input.token.length < 16 || !Number.isSafeInteger(input.pid)) {
    throw new Error("Agent connection context is invalid.");
  }
  const origin = new URL(input.apiOrigin);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) {
    throw new Error("Agent connection context must target a plain loopback origin.");
  }
  return { protocolVersion: 1, apiOrigin: origin.origin, token: input.token, pid: Number(input.pid) };
}

export async function publishAgentConnectionContext(context: AgentConnectionContext, descriptorPath = defaultAgentContextPath()): Promise<() => Promise<void>> {
  const checked = parseContext(context);
  const directory = path.dirname(descriptorPath);
  await requirePrivateDirectory(directory);
  const temporary = path.join(directory, `.active-context-${process.pid}-${crypto.randomUUID()}.tmp`);
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(checked)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, descriptorPath);
  const info = await lstat(descriptorPath);
  if (!info.isFile() || info.isSymbolicLink() || (ownerId() !== undefined && info.uid !== ownerId()) || (info.mode & 0o077) !== 0) {
    await rm(descriptorPath, { force: true });
    throw new Error("Agent context descriptor is not an owner-only regular file.");
  }
  return async () => {
    try {
      const current = await readAgentConnectionContext(descriptorPath);
      if (current.pid === checked.pid && current.token === checked.token) await rm(descriptorPath, { force: true });
    } catch { /* A replaced or removed descriptor is not ours to clean up. */ }
  };
}

export async function readAgentConnectionContext(descriptorPath = defaultAgentContextPath()): Promise<AgentConnectionContext> {
  const handle = await open(descriptorPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || (ownerId() !== undefined && info.uid !== ownerId()) || (info.mode & 0o077) !== 0) {
      throw new Error("Agent context descriptor must be an owner-only regular file.");
    }
    return parseContext(JSON.parse(await handle.readFile("utf8")) as unknown);
  } finally {
    await handle.close();
  }
}
