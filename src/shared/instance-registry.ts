import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, realpath, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const INSTANCE_REGISTRY_SCHEMA_VERSION = 1 as const;
export const INSTANCE_PROTOCOL_VERSION = 1 as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

export interface AgentInstanceIdentity {
  schemaVersion: typeof INSTANCE_REGISTRY_SCHEMA_VERSION;
  instanceId: string;
  workspaceId: string;
  protocolVersion: typeof INSTANCE_PROTOCOL_VERSION;
  apiOrigin: string;
  editorOrigin: string;
}

export interface AgentInstanceRegistryEntry extends AgentInstanceIdentity {
  pid: number;
  startedAt: string;
  heartbeatAt: string;
  workspaceLabel: string;
  token: string;
}

export interface WorkspaceIdentity {
  workspaceId: string;
  workspaceLabel: string;
}

export interface RegisteredAgentInstance {
  entry: AgentInstanceRegistryEntry;
  heartbeat: () => Promise<void>;
  remove: () => Promise<void>;
}

function ownerId(): number | undefined {
  return typeof process.getuid === "function" ? process.getuid() : undefined;
}

function safeLabel(value: string): string {
  return value.replace(/[^A-Za-z0-9._ -]/g, "").trim().slice(0, 80) || "workspace";
}

function plainLoopbackOrigin(value: string): string {
  const origin = new URL(value);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.pathname !== "/"
    || origin.search || origin.hash || origin.username || origin.password || !origin.port) {
    throw new Error("Instance API origin is invalid.");
  }
  return origin.origin;
}

function descriptiveEditorOrigin(value: string): string {
  const origin = new URL(value);
  if (origin.protocol !== "http:" || !origin.hostname.endsWith(".localhost") || origin.hostname === "localhost"
    || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password || !origin.port) {
    throw new Error("Instance editor origin is invalid.");
  }
  return origin.origin;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("Instance timestamp is invalid.");
  return new Date(value).toISOString();
}

export function parseAgentInstanceRegistryEntry(value: unknown): AgentInstanceRegistryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Instance descriptor is invalid.");
  const input = value as Record<string, unknown>;
  const fields = ["schemaVersion", "instanceId", "pid", "startedAt", "heartbeatAt", "workspaceId", "workspaceLabel", "apiOrigin", "editorOrigin", "protocolVersion", "token"];
  if (Object.keys(input).some((key) => !fields.includes(key)) || fields.some((key) => !(key in input))
    || input.schemaVersion !== 1 || input.protocolVersion !== 1 || typeof input.instanceId !== "string" || !UUID.test(input.instanceId)
    || !Number.isSafeInteger(input.pid) || Number(input.pid) <= 0 || typeof input.workspaceId !== "string" || !SHA256.test(input.workspaceId)
    || typeof input.workspaceLabel !== "string" || input.workspaceLabel !== safeLabel(input.workspaceLabel)
    || typeof input.token !== "string" || input.token.length < 16) {
    throw new Error("Instance descriptor is invalid.");
  }
  return {
    schemaVersion: 1,
    instanceId: input.instanceId,
    pid: Number(input.pid),
    startedAt: timestamp(input.startedAt),
    heartbeatAt: timestamp(input.heartbeatAt),
    workspaceId: input.workspaceId,
    workspaceLabel: input.workspaceLabel,
    apiOrigin: plainLoopbackOrigin(String(input.apiOrigin)),
    editorOrigin: descriptiveEditorOrigin(String(input.editorOrigin)),
    protocolVersion: 1,
    token: input.token,
  };
}

export function publicInstanceIdentity(entry: AgentInstanceRegistryEntry): AgentInstanceIdentity {
  return {
    schemaVersion: 1, instanceId: entry.instanceId, workspaceId: entry.workspaceId,
    protocolVersion: 1, apiOrigin: entry.apiOrigin, editorOrigin: entry.editorOrigin,
  };
}

export function defaultInstanceRegistryDirectory(): string {
  return process.env.LINEAGE_LOGO_REGISTRY_DIR
    ?? path.join(os.tmpdir(), `lineage-logo-${ownerId() ?? "user"}`, "instances");
}

export async function identifyWorkspace(workspace: string): Promise<WorkspaceIdentity> {
  const canonical = await realpath(workspace);
  return {
    workspaceId: createHash("sha256").update(canonical).digest("hex"),
    workspaceLabel: safeLabel(path.basename(canonical)),
  };
}

async function requirePrivateDirectory(directory: string, create: boolean): Promise<void> {
  if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (ownerId() !== undefined && info.uid !== ownerId()) || (info.mode & 0o077) !== 0) {
    throw new Error("Instance registry directory must be owner-only.");
  }
}

async function writeEntry(directory: string, entry: AgentInstanceRegistryEntry): Promise<void> {
  const checked = parseAgentInstanceRegistryEntry(entry);
  await requirePrivateDirectory(directory, true);
  const destination = path.join(directory, `${checked.instanceId}.json`);
  const temporary = path.join(directory, `.${checked.instanceId}-${process.pid}-${randomUUID()}.tmp`);
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(`${JSON.stringify(checked)}\n`, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temporary, destination);
  await chmod(destination, 0o600);
}

async function readEntryFile(file: string): Promise<AgentInstanceRegistryEntry> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || (ownerId() !== undefined && info.uid !== ownerId()) || (info.mode & 0o077) !== 0) {
      throw new Error("Instance descriptor must be owner-only.");
    }
    return parseAgentInstanceRegistryEntry(JSON.parse(await handle.readFile("utf8")) as unknown);
  } finally { await handle.close(); }
}

export async function readAgentInstanceRegistry(directory = defaultInstanceRegistryDirectory()): Promise<AgentInstanceRegistryEntry[]> {
  try { await requirePrivateDirectory(directory, false); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  return await Promise.all(names.map(async (name) => {
    if (!UUID.test(name.slice(0, -5))) throw new Error("Instance registry contains an invalid descriptor name.");
    const entry = await readEntryFile(path.join(directory, name));
    if (`${entry.instanceId}.json` !== name) throw new Error("Instance descriptor identity does not match its filename.");
    return entry;
  }));
}

export async function registerAgentInstance(
  input: Omit<AgentInstanceRegistryEntry, "schemaVersion" | "protocolVersion" | "heartbeatAt">,
  directory = defaultInstanceRegistryDirectory(),
): Promise<RegisteredAgentInstance> {
  const entry = parseAgentInstanceRegistryEntry({ ...input, schemaVersion: 1, protocolVersion: 1, heartbeatAt: input.startedAt });
  await writeEntry(directory, entry);
  let current = entry;
  return {
    entry,
    heartbeat: async () => {
      current = { ...current, heartbeatAt: new Date().toISOString() };
      await writeEntry(directory, current);
    },
    remove: async () => {
      const file = path.join(directory, `${entry.instanceId}.json`);
      try {
        const stored = await readEntryFile(file);
        if (stored.instanceId === entry.instanceId && stored.pid === entry.pid && stored.token === entry.token) await rm(file);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    },
  };
}

export function isProcessConcurrentlyAbsent(pid: number): boolean {
  try { process.kill(pid, 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
}

export async function removeConclusiveStaleEntry(
  entry: AgentInstanceRegistryEntry,
  directory = defaultInstanceRegistryDirectory(),
  processAbsent: (pid: number) => boolean = isProcessConcurrentlyAbsent,
): Promise<boolean> {
  if (!processAbsent(entry.pid)) return false;
  const file = path.join(directory, `${entry.instanceId}.json`);
  try {
    const current = await readEntryFile(file);
    if (current.instanceId !== entry.instanceId || current.pid !== entry.pid || current.token !== entry.token) return false;
    await rm(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
