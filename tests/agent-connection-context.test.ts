import { randomBytes } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { publishAgentConnectionContext, readAgentConnectionContext } from "../src/producer/connection-context";

const temporary: string[] = [];
afterEach(async () => { for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true }); });

async function directory(): Promise<string> {
  const value = await mkdtemp(path.join(os.tmpdir(), "lineage-context-test-"));
  temporary.push(value);
  return value;
}

describe("protected active agent context", () => {
  it("publishes and reads an owner-only regular descriptor without exposing the token elsewhere", async () => {
    const root = await directory();
    const descriptor = path.join(root, "private", "active.json");
    const context = { protocolVersion: 1 as const, apiOrigin: "http://127.0.0.1:4567", token: randomBytes(32).toString("base64url"), pid: process.pid };
    const cleanup = await publishAgentConnectionContext(context, descriptor);
    expect(await readAgentConnectionContext(descriptor)).toEqual(context);
    const info = await lstat(descriptor);
    expect(info.isFile()).toBe(true);
    expect(info.isSymbolicLink()).toBe(false);
    expect(info.mode & 0o077).toBe(0);
    expect(await readFile(descriptor, "utf8")).not.toContain("Authorization");
    await cleanup();
    await expect(lstat(descriptor)).rejects.toThrow();
  });

  it("refuses a symlink descriptor and insecure or non-loopback content", async () => {
    const root = await directory();
    const target = path.join(root, "target.json");
    const descriptor = path.join(root, "active.json");
    await writeFile(target, "{}", { mode: 0o600 });
    await symlink(target, descriptor);
    await expect(readAgentConnectionContext(descriptor)).rejects.toThrow();
    const invalid = path.join(root, "invalid.json");
    await writeFile(invalid, JSON.stringify({ protocolVersion: 1, apiOrigin: "https://example.com", token: randomBytes(32).toString("hex"), pid: 1 }), { mode: 0o600 });
    await expect(readAgentConnectionContext(invalid)).rejects.toThrow("loopback");
  });

  it("refuses a symlinked context directory", async () => {
    const root = await directory();
    await mkdir(path.join(root, "actual"), { mode: 0o700 });
    await symlink(path.join(root, "actual"), path.join(root, "linked"));
    await expect(publishAgentConnectionContext({
      protocolVersion: 1, apiOrigin: "http://127.0.0.1:4567", token: randomBytes(32).toString("hex"), pid: process.pid,
    }, path.join(root, "linked", "active.json"))).rejects.toThrow("regular directory");
  });
});
