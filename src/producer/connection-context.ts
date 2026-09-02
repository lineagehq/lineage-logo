import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  identifyWorkspace, publicInstanceIdentity, readAgentInstanceRegistry, removeConclusiveStaleEntry,
  type AgentInstanceIdentity, type AgentInstanceRegistryEntry,
} from "../shared/instance-registry.js";

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

export interface ResolveAgentConnectionOptions {
  workspace?: string;
  instance?: string;
  legacyContext?: string;
}

export interface AgentInstanceChoice {
  instanceId: string;
  workspaceLabel: string;
  startedAt: string;
  editorOrigin: string;
}

export interface ResolvedAgentConnectionContext {
  context: AgentConnectionContext;
  instanceId: string;
  workspaceId: string;
  workspaceLabel: string;
  editorOrigin: string;
}

export interface ResolvedAgentConnection {
  client: import("./agent-client.js").AgentProducerClient;
  instanceId: string;
  workspaceLabel: string;
  editorOrigin: string;
}

export class AgentInstanceResolutionError extends Error {
  constructor(
    readonly reason: "not_found" | "ambiguous" | "unavailable",
    readonly choices: AgentInstanceChoice[] = [],
  ) { super(reason); }
}

export interface AgentInstanceResolverDependencies {
  registryDirectory?: string;
  fetch?: typeof fetch;
  processAbsent?: (pid: number) => boolean;
}

function choice(entry: AgentInstanceRegistryEntry): AgentInstanceChoice {
  return {
    instanceId: entry.instanceId.slice(0, 8),
    workspaceLabel: entry.workspaceLabel,
    startedAt: entry.startedAt,
    editorOrigin: entry.editorOrigin,
  };
}

function parseIdentity(value: unknown): AgentInstanceIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("identity");
  const input = value as Record<string, unknown>;
  const fields = ["schemaVersion", "instanceId", "workspaceId", "protocolVersion", "apiOrigin", "editorOrigin"];
  if (Object.keys(input).some((key) => !fields.includes(key)) || fields.some((key) => !(key in input))
    || input.schemaVersion !== 1 || input.protocolVersion !== 1
    || typeof input.instanceId !== "string" || typeof input.workspaceId !== "string"
    || typeof input.apiOrigin !== "string" || typeof input.editorOrigin !== "string") throw new Error("identity");
  return input as unknown as AgentInstanceIdentity;
}

async function verifyEntry(entry: AgentInstanceRegistryEntry, request: typeof fetch): Promise<boolean> {
  try {
    const response = await request(`${entry.apiOrigin}/api/agent/identity`, {
      headers: { Authorization: `Bearer ${entry.token}` }, signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return false;
    const actual = parseIdentity(await response.json());
    const expected = publicInstanceIdentity(entry);
    return Object.keys(expected).every((key) => actual[key as keyof AgentInstanceIdentity] === expected[key as keyof AgentInstanceIdentity]);
  } catch { return false; }
}

async function liveEntries(
  candidates: AgentInstanceRegistryEntry[], dependencies: AgentInstanceResolverDependencies,
): Promise<AgentInstanceRegistryEntry[]> {
  const request = dependencies.fetch ?? fetch;
  const live: AgentInstanceRegistryEntry[] = [];
  for (const entry of candidates) {
    if (await verifyEntry(entry, request)) live.push(entry);
    else await removeConclusiveStaleEntry(entry, dependencies.registryDirectory, dependencies.processAbsent);
  }
  return live;
}

export async function resolveAgentConnectionContext(
  options: ResolveAgentConnectionOptions = {}, dependencies: AgentInstanceResolverDependencies = {},
): Promise<ResolvedAgentConnectionContext> {
  if (options.legacyContext) {
    if (options.workspace || options.instance) throw new AgentInstanceResolutionError("not_found");
    const context = await readAgentConnectionContext(options.legacyContext).catch(() => { throw new AgentInstanceResolutionError("unavailable"); });
    const api = new URL(context.apiOrigin);
    return {
      context, instanceId: `legacy-${context.pid}`, workspaceId: "legacy", workspaceLabel: "legacy workspace",
      editorOrigin: `http://lineage-logo.localhost:${api.port}`,
    };
  }

  const entries = await readAgentInstanceRegistry(dependencies.registryDirectory).catch(() => { throw new AgentInstanceResolutionError("unavailable"); });
  let candidates: AgentInstanceRegistryEntry[];
  if (options.instance) {
    candidates = entries.filter((entry) => entry.instanceId === options.instance);
    if (candidates.length === 0) throw new AgentInstanceResolutionError("not_found", entries.map(choice));
  } else if (options.workspace) {
    const identity = await identifyWorkspace(options.workspace).catch(() => { throw new AgentInstanceResolutionError("not_found"); });
    candidates = entries.filter((entry) => entry.workspaceId === identity.workspaceId);
    if (candidates.length === 0) throw new AgentInstanceResolutionError("not_found", entries.map(choice));
  } else candidates = entries;

  const live = await liveEntries(candidates, dependencies);
  if (live.length === 0) throw new AgentInstanceResolutionError(candidates.length > 0 ? "unavailable" : "not_found", entries.map(choice));
  if (live.length > 1) throw new AgentInstanceResolutionError("ambiguous", live.map(choice));
  const selected = live[0];
  return {
    context: { protocolVersion: 1, apiOrigin: selected.apiOrigin, token: selected.token, pid: selected.pid },
    instanceId: selected.instanceId,
    workspaceId: selected.workspaceId,
    workspaceLabel: selected.workspaceLabel,
    editorOrigin: selected.editorOrigin,
  };
}

export async function resolveAgentConnection(options: ResolveAgentConnectionOptions = {}): Promise<ResolvedAgentConnection> {
  const resolved = await resolveAgentConnectionContext(options);
  const { AgentProducerClient } = await import("./agent-client.js");
  return {
    client: new AgentProducerClient({
      context: resolved.context,
      binding: { instanceId: resolved.instanceId, workspaceId: resolved.workspaceId },
    }),
    instanceId: resolved.instanceId,
    workspaceLabel: resolved.workspaceLabel,
    editorOrigin: resolved.editorOrigin,
  };
}
