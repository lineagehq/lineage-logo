import { randomBytes, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentInstanceResolutionError, resolveAgentConnectionContext } from "../../src/producer/connection-context";
import { identifyWorkspace, publicInstanceIdentity, readAgentInstanceRegistry, registerAgentInstance } from "../../src/shared/instance-registry";

const temporary: string[] = [];
afterEach(async () => Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "lineage-registry-test-"));
  temporary.push(root);
  const registry = path.join(root, "registry");
  const workspaceA = path.join(root, "Seatify Alpha");
  const workspaceB = path.join(root, "Seatify Beta");
  await Promise.all([mkdir(workspaceA), mkdir(workspaceB)]);
  return { registry, workspaceA, workspaceB };
}

async function add(registry: string, workspace: string, port: number, pid = process.pid) {
  const identity = await identifyWorkspace(workspace);
  const startedAt = new Date().toISOString();
  return await registerAgentInstance({
    instanceId: randomUUID(), pid, startedAt, ...identity,
    apiOrigin: `http://127.0.0.1:${port}`,
    editorOrigin: `http://lineage-logo.localhost:${port}`,
    token: randomBytes(32).toString("base64url"),
  }, registry);
}

function verifier(entries: Array<Awaited<ReturnType<typeof add>>["entry"]>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const entry = entries.find((candidate) => `${candidate.apiOrigin}/api/agent/identity` === String(input));
    const authorization = new Headers(init?.headers).get("Authorization");
    if (!entry || authorization !== `Bearer ${entry.token}`) return new Response("", { status: 401 });
    return new Response(JSON.stringify(publicInstanceIdentity(entry)), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

describe("protected per-instance registry", () => {
  it("stores one owner-only descriptor per UUID without raw workspace paths", async () => {
    const { registry, workspaceA, workspaceB } = await fixture();
    const first = await add(registry, workspaceA, 4101);
    const second = await add(registry, workspaceB, 4102);
    expect((await lstat(registry)).mode & 0o077).toBe(0);
    const entries = await readAgentInstanceRegistry(registry);
    expect(entries.map((entry) => entry.instanceId).sort()).toEqual([first.entry.instanceId, second.entry.instanceId].sort());
    for (const entry of entries) {
      const descriptor = path.join(registry, `${entry.instanceId}.json`);
      expect((await lstat(descriptor)).mode & 0o077).toBe(0);
      const raw = await readFile(descriptor, "utf8");
      expect(raw).not.toContain(workspaceA);
      expect(raw).not.toContain(workspaceB);
    }
    await first.remove();
    expect((await readAgentInstanceRegistry(registry)).map((entry) => entry.instanceId)).toEqual([second.entry.instanceId]);
  });

  it("rejects an insecure registry rather than trusting its descriptors", async () => {
    const { registry, workspaceA } = await fixture();
    await add(registry, workspaceA, 4103);
    await chmod(registry, 0o755);
    await expect(readAgentInstanceRegistry(registry)).rejects.toThrow("owner-only");
  });

  it("applies exact instance, exact workspace, then sole-live precedence and fails closed on ambiguity", async () => {
    const { registry, workspaceA, workspaceB } = await fixture();
    const first = await add(registry, workspaceA, 4104);
    const second = await add(registry, workspaceB, 4105);
    const fetch = verifier([first.entry, second.entry]);
    expect((await resolveAgentConnectionContext({ instance: second.entry.instanceId }, { registryDirectory: registry, fetch })).instanceId).toBe(second.entry.instanceId);
    expect((await resolveAgentConnectionContext({ workspace: workspaceA }, { registryDirectory: registry, fetch })).instanceId).toBe(first.entry.instanceId);
    await expect(resolveAgentConnectionContext({}, { registryDirectory: registry, fetch })).rejects.toMatchObject({
      reason: "ambiguous",
      choices: expect.arrayContaining([
        expect.objectContaining({ instanceId: first.entry.instanceId.slice(0, 8), workspaceLabel: "Seatify Alpha" }),
        expect.objectContaining({ instanceId: second.entry.instanceId.slice(0, 8), workspaceLabel: "Seatify Beta" }),
      ]),
    });
    await expect(resolveAgentConnectionContext({ instance: randomUUID() }, { registryDirectory: registry, fetch })).rejects.toBeInstanceOf(AgentInstanceResolutionError);
  });

  it("requires authenticated identity equality and deletes only conclusively dead entries", async () => {
    const { registry, workspaceA } = await fixture();
    const dead = await add(registry, workspaceA, 4106, 2_000_000_000);
    const wrongIdentity = vi.fn(async () => new Response(JSON.stringify({
      ...publicInstanceIdentity(dead.entry), workspaceId: "f".repeat(64),
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    await expect(resolveAgentConnectionContext({ instance: dead.entry.instanceId }, {
      registryDirectory: registry, fetch: wrongIdentity, processAbsent: () => false,
    })).rejects.toMatchObject({ reason: "unavailable" });
    expect(await readAgentInstanceRegistry(registry)).toHaveLength(1);
    await expect(resolveAgentConnectionContext({ instance: dead.entry.instanceId }, {
      registryDirectory: registry, fetch: wrongIdentity, processAbsent: () => true,
    })).rejects.toMatchObject({ reason: "unavailable" });
    expect(await readAgentInstanceRegistry(registry)).toHaveLength(0);
  });

  it("does not silently use a legacy singleton when the registry is empty", async () => {
    const { registry } = await fixture();
    await expect(resolveAgentConnectionContext({}, { registryDirectory: registry })).rejects.toMatchObject({ reason: "not_found" });
  });
});
