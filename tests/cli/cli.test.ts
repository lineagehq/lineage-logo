import { lstat, mkdir, mkdtemp, readFile, rm, rmdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXIT, InstanceResolutionError, runLineageCli, type CliIo, type ResolvedInstance } from "../../src/cli/index";
import { bootstrapSeatifyExample, SeatifyBootstrapError } from "../../src/cli/seatify-example";
import type { AgentProducerOutcome } from "../../src/producer/agent-client";

const filesystem = vi.hoisted(() => ({
  mkdirOverride: undefined as undefined | ((actual: typeof mkdir, ...args: Parameters<typeof mkdir>) => ReturnType<typeof mkdir>),
  readdirOverride: undefined as undefined | ((actual: typeof import("node:fs/promises").readdir, ...args: Parameters<typeof import("node:fs/promises").readdir>) => ReturnType<typeof import("node:fs/promises").readdir>),
  accessOverride: undefined as undefined | ((actual: typeof import("node:fs/promises").access, ...args: Parameters<typeof import("node:fs/promises").access>) => ReturnType<typeof import("node:fs/promises").access>),
  copyFileOverride: undefined as undefined | ((actual: typeof import("node:fs/promises").copyFile, ...args: Parameters<typeof import("node:fs/promises").copyFile>) => ReturnType<typeof import("node:fs/promises").copyFile>),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdir: (...args: Parameters<typeof mkdir>) => filesystem.mkdirOverride ? filesystem.mkdirOverride(actual.mkdir, ...args) : actual.mkdir(...args),
    readdir: (...args: Parameters<typeof actual.readdir>) => filesystem.readdirOverride ? filesystem.readdirOverride(actual.readdir, ...args) : actual.readdir(...args),
    access: (...args: Parameters<typeof actual.access>) => filesystem.accessOverride ? filesystem.accessOverride(actual.access, ...args) : actual.access(...args),
    copyFile: (...args: Parameters<typeof actual.copyFile>) => filesystem.copyFileOverride ? filesystem.copyFileOverride(actual.copyFile, ...args) : actual.copyFile(...args),
  };
});

const temporary: string[] = [];
afterEach(async () => Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

function capture(): { io: CliIo; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, io: { stdout: (line) => stdout.push(line), stderr: (line) => stderr.push(line) } };
}

async function submissionFiles(): Promise<{ artifact: string; proposal: string }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lineage-cli-test-"));
  temporary.push(directory);
  const artifact = path.join(directory, "artifact.svg");
  const proposal = path.join(directory, "proposal.json");
  await writeFile(artifact, '<svg xmlns="http://www.w3.org/2000/svg"><g id="logo" /></svg>');
  await writeFile(proposal, JSON.stringify({
    protocolVersion: 1, transactionId: "cli-test", producer: { kind: "test", name: "CLI test" },
    document: { sessionId: "session", baseRevision: 1 },
    operations: [{ type: "renameLayer", operationId: "rename", target: { sessionKey: "logo" }, name: "Updated" }],
  }));
  return { artifact, proposal };
}

function instance(outcome: AgentProducerOutcome | Record<string, unknown>): ResolvedInstance {
  return {
    instanceId: "12345678-secret-tail", workspaceLabel: "/private/Customers/Seatify 🚫", editorOrigin: "http://lineage-logo.localhost:4173",
    client: {
      manifest: vi.fn().mockResolvedValue({ sessionId: "session", sourcePath: "concept.svg", revision: 1, layers: [] }),
      submitAndWait: vi.fn().mockResolvedValue(outcome),
    },
  } as unknown as ResolvedInstance;
}

describe("lineage-logo CLI", () => {
  it("exposes stable help, version, usage, and launch syntax", async () => {
    const help = capture();
    expect(await runLineageCli(["--help"], help.io)).toBe(EXIT.success);
    expect(help.stdout.join("\n")).toContain("launch --workspace <path>");
    expect(help.stdout.join("\n")).toContain("submit --artifact <path> --proposal <path>");
    const version = capture();
    expect(await runLineageCli(["--version"], version.io)).toBe(EXIT.success);
    expect(version.stdout).toEqual(["0.1.0-beta.3"]);
    expect(await runLineageCli([], capture().io)).toBe(EXIT.usage);
  });

  it("passes a descriptive launch contract to the compatibility implementation", async () => {
    const output = capture();
    const launch = vi.fn().mockResolvedValue(EXIT.success);
    expect(await runLineageCli(["launch", "--workspace", ".", "--port", "4273", "--no-open"], output.io, { launch })).toBe(EXIT.success);
    expect(launch).toHaveBeenCalledWith({ workspace: ".", port: 4273, open: false, development: false, json: false }, output.io);
    expect(await runLineageCli(["launch", "--workspace", ".", "--port", "80"], capture().io, { launch })).toBe(EXIT.usage);
  });

  it("creates only the Seatify starter paths and refuses a changed workspace", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "lineage-seatify-bootstrap-"));
    await rm(workspace, { recursive: true, force: true });
    temporary.push(workspace);
    const first = capture();
    expect(await runLineageCli(["example", "seatify", "--workspace", workspace], first.io)).toBe(EXIT.success);
    expect(await readFile(path.join(workspace, "concepts", "seatify-constellation.svg"), "utf8")).toContain('aria-label="Seatify constellation logo"');
    expect(first.stdout.join("\n")).toContain("lineage-logo launch --workspace <directory>");
    expect(first.stdout.join("\n")).not.toContain(workspace);
    expect(await runLineageCli(["example", "seatify", "--workspace", workspace], capture().io)).toBe(EXIT.success);
    await writeFile(path.join(workspace, "notes.txt"), "user work");
    expect(await runLineageCli(["example", "seatify", "--workspace", workspace, "--json"], capture().io)).toBe(EXIT.conflict);
    expect(await readFile(path.join(workspace, "notes.txt"), "utf8")).toBe("user work");
  });

  it("refuses a Seatify fixture symlink even when its bytes match", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "lineage-seatify-symlink-"));
    temporary.push(workspace);
    await Promise.all([mkdir(path.join(workspace, "concepts")), mkdir(path.join(workspace, "iterations"))]);
    await symlink(path.resolve("examples/seatify-constellation.svg"), path.join(workspace, "concepts", "seatify-constellation.svg"));
    expect(await runLineageCli(["example", "seatify", "--workspace", workspace], capture().io)).toBe(EXIT.conflict);
  });

  it("reports a missing packaged fixture as unavailable without creating a workspace", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "lineage-seatify-missing-fixture-"));
    temporary.push(parent);
    const workspace = path.join(parent, "workspace");
    filesystem.accessOverride = async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); };
    try {
      await expect(bootstrapSeatifyExample(workspace)).rejects.toMatchObject({ name: "SeatifyBootstrapError", kind: "unavailable" } satisfies Partial<SeatifyBootstrapError>);
    } finally {
      filesystem.accessOverride = undefined;
    }
    await expect(readFile(workspace)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("leaves its partial starter root after a copy failure rather than deleting paths", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "lineage-seatify-rollback-"));
    temporary.push(parent);
    const workspace = path.join(parent, "workspace");
    filesystem.copyFileOverride = async () => { throw new Error("disk failure"); };
    try {
      await expect(bootstrapSeatifyExample(workspace)).rejects.toMatchObject({ name: "SeatifyBootstrapError", kind: "io" } satisfies Partial<SeatifyBootstrapError>);
    } finally {
      filesystem.copyFileOverride = undefined;
    }
    expect((await lstat(workspace)).isDirectory()).toBe(true);
    expect((await lstat(path.join(workspace, "concepts"))).isDirectory()).toBe(true);
    expect((await lstat(path.join(workspace, "iterations"))).isDirectory()).toBe(true);
  });

  it("does not remove a concurrent replacement of a directory it created before a copy failure", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "lineage-seatify-replacement-race-"));
    temporary.push(parent);
    const workspace = path.join(parent, "workspace");
    const replacement = path.join(workspace, "concepts");
    filesystem.copyFileOverride = async (_actual, _source, destination) => {
      await rmdir(replacement);
      await mkdir(replacement);
      throw new Error(`copy failed for ${destination}`);
    };
    try {
      await expect(bootstrapSeatifyExample(workspace)).rejects.toMatchObject({ name: "SeatifyBootstrapError", kind: "io" } satisfies Partial<SeatifyBootstrapError>);
    } finally {
      filesystem.copyFileOverride = undefined;
    }
    expect((await lstat(replacement)).isDirectory()).toBe(true);
  });

  it("does not remove an empty workspace created concurrently after its own mkdir loses the race", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "lineage-seatify-race-"));
    temporary.push(parent);
    const workspace = path.join(parent, "workspace");
    filesystem.mkdirOverride = async (actual, pathname, options) => {
      if (pathname === workspace) {
        await actual(workspace, { recursive: false });
        const error = Object.assign(new Error("already exists"), { code: "EEXIST" });
        throw error;
      }
      return actual(pathname, options);
    };
    try {
      await expect(bootstrapSeatifyExample(workspace)).rejects.toMatchObject({ name: "SeatifyBootstrapError", kind: "io" } satisfies Partial<SeatifyBootstrapError>);
    } finally {
      filesystem.mkdirOverride = undefined;
    }
    expect((await lstat(workspace)).isDirectory()).toBe(true);
  });

  it("classifies an existing-workspace filesystem read failure as I/O, not a conflict", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "lineage-seatify-existing-io-"));
    temporary.push(parent);
    const workspace = path.join(parent, "workspace");
    await mkdir(workspace);
    await Promise.all([mkdir(path.join(workspace, "concepts")), mkdir(path.join(workspace, "iterations"))]);
    await writeFile(path.join(workspace, "concepts", "seatify-constellation.svg"), await readFile(path.resolve("examples/seatify-constellation.svg")));
    filesystem.readdirOverride = async (actual, pathname, options) => {
      if (pathname === workspace) {
        const error = Object.assign(new Error("permission denied"), { code: "EACCES" });
        throw error;
      }
      return actual(pathname, options);
    };
    try {
      await expect(bootstrapSeatifyExample(workspace)).rejects.toMatchObject({ name: "SeatifyBootstrapError", kind: "io" } satisfies Partial<SeatifyBootstrapError>);
    } finally {
      filesystem.readdirOverride = undefined;
    }
  });

  it("writes one deterministic, sanitized doctor JSON object", async () => {
    const output = capture();
    const selected = instance({ status: "reverted", transactionId: "unused" });
    expect(await runLineageCli(["doctor", "--json"], output.io, { resolveInstance: async () => selected })).toBe(EXIT.success);
    expect(output.stdout).toHaveLength(1);
    const result = JSON.parse(output.stdout[0]);
    expect(result).toMatchObject({ schemaVersion: 1, command: "doctor", ok: true, status: "ok" });
    expect(output.stdout[0]).not.toMatch(/private|secret-tail|token/i);
  });

  it("projects live editor context without a source path or credentials", async () => {
    const output = capture();
    const selected = instance({ status: "reverted", transactionId: "unused" });
    selected.client.manifest = vi.fn().mockResolvedValue({
      sessionId: "session", sourcePath: "/private/seatify.svg", revision: 7,
      layers: [{ sessionKey: "seatify-title", name: "Seatify title", type: "text", locked: false }],
    });
    expect(await runLineageCli(["context", "--json"], output.io, { resolveInstance: async () => selected })).toBe(EXIT.success);
    const result = JSON.parse(output.stdout[0]);
    expect(result).toMatchObject({ command: "context", ok: true, context: {
      protocolVersion: 1, editorId: "12345678", sessionId: "session", baseRevision: 7,
      layers: [{ layerId: "seatify-title", name: "Seatify title", type: "text", locked: false }],
    } });
    expect(output.stdout[0]).not.toMatch(/private|secret-tail|token/i);
  });

  it("fails closed with exit 3 for absent or ambiguous submit selection", async () => {
    const files = await submissionFiles();
    for (const reason of ["not_found", "ambiguous"] as const) {
      const output = capture();
      const code = await runLineageCli([
        "submit", "--artifact", files.artifact, "--proposal", files.proposal, "--json",
      ], output.io, { resolveInstance: async () => { throw new InstanceResolutionError(reason); } });
      expect(code).toBe(EXIT.selection);
      expect(JSON.parse(output.stdout[0])).toMatchObject({ schemaVersion: 1, command: "submit", ok: false, status: "not_found" });
    }
  });

  it("fails closed for ambiguous public context selection", async () => {
    const output = capture();
    expect(await runLineageCli(["context", "--json"], output.io, {
      resolveInstance: async () => { throw new InstanceResolutionError("ambiguous"); },
    })).toBe(EXIT.selection);
    expect(JSON.parse(output.stdout[0])).toMatchObject({ command: "context", ok: false, status: "not_found" });
  });

  it("accepts a source-path-free public proposal and rejects a private-path field", async () => {
    const files = await submissionFiles();
    const output = capture();
    const selected = instance({ status: "reverted", transactionId: "cli-test" });
    expect(await runLineageCli(["submit", "--artifact", files.artifact, "--proposal", files.proposal, "--json"], output.io, {
      resolveInstance: async () => selected,
    })).toBe(EXIT.rejected);
    expect(selected.client.submitAndWait).toHaveBeenCalledWith(expect.objectContaining({
      document: { sessionId: "session", sourcePath: "concept.svg", baseRevision: 1 },
    }));
    await writeFile(files.proposal, JSON.stringify({
      protocolVersion: 1, transactionId: "cli-test", producer: { kind: "test" },
      document: { sessionId: "session", sourcePath: "/private/source.svg", baseRevision: 1 },
      operations: [{ type: "selectFocus", operationId: "focus", targets: [{ sessionKey: "logo" }] }],
    }));
    const rejected = capture();
    expect(await runLineageCli(["submit", "--artifact", files.artifact, "--proposal", files.proposal, "--json"], rejected.io, {
      resolveInstance: async () => selected,
    })).toBe(EXIT.usage);
    expect(JSON.parse(rejected.stdout[0])).toMatchObject({ ok: false, status: "invalid" });
    expect(rejected.stdout[0]).not.toContain("private");
  });

  it.each([
    ["session", "other", 1],
    ["revision", "session", 2],
  ] as const)("fails closed when public context %s does not match", async (_kind, sessionId, revision) => {
    const files = await submissionFiles();
    const stale = capture();
    const selected = instance({ status: "reverted", transactionId: "cli-test" });
    selected.client.manifest = vi.fn().mockResolvedValue({ sessionId, sourcePath: "concept.svg", revision, layers: [] });
    expect(await runLineageCli(["submit", "--artifact", files.artifact, "--proposal", files.proposal, "--json"], stale.io, {
      resolveInstance: async () => selected,
    })).toBe(EXIT.conflict);
    expect(selected.client.submitAndWait).not.toHaveBeenCalled();
  });

  it("fails closed for unsupported versions and a schema-valid oversized proposal", async () => {
    const files = await submissionFiles();
    await writeFile(files.proposal, JSON.stringify({ protocolVersion: 2, transactionId: "cli-test", producer: { kind: "test" }, document: { sessionId: "session", baseRevision: 1 }, operations: [{ type: "selectFocus", operationId: "focus", targets: [{ sessionKey: "logo" }] }] }));
    expect(await runLineageCli(["submit", "--artifact", files.artifact, "--proposal", files.proposal], capture().io)).toBe(EXIT.usage);
    const valid = JSON.stringify({ protocolVersion: 1, transactionId: "cli-test", producer: { kind: "test" }, document: { sessionId: "session", baseRevision: 1 }, operations: [{ type: "selectFocus", operationId: "focus", targets: [{ sessionKey: "logo" }] }] });
    await writeFile(files.proposal, valid + " ".repeat(5 * 1024 * 1024));
    const output = capture();
    expect(await runLineageCli(["submit", "--artifact", files.artifact, "--proposal", files.proposal, "--json"], output.io)).toBe(EXIT.usage);
    expect(JSON.parse(output.stdout[0]).message).toBe("Proposal is not a valid transaction.");
  });

  it.each([
    ["reverted", EXIT.rejected, "rejected"],
    ["stale", EXIT.conflict, "conflict"],
    ["unavailable", EXIT.unavailable, "unavailable"],
  ] as const)("maps %s submission outcomes to stable exits", async (status, expectedExit, expectedStatus) => {
    const files = await submissionFiles();
    const output = capture();
    const outcome = status === "unavailable"
      ? { status, transactionId: "cli-test", message: "token=never-print" }
      : { status, transactionId: "cli-test" };
    const code = await runLineageCli([
      "submit", "--artifact", files.artifact, "--proposal", files.proposal, "--json",
    ], output.io, { resolveInstance: async () => instance(outcome as AgentProducerOutcome) });
    expect(code).toBe(expectedExit);
    expect(JSON.parse(output.stdout[0])).toMatchObject({ schemaVersion: 1, command: "submit", ok: false, status: expectedStatus });
    expect(output.stdout[0]).not.toContain("never-print");
  });

  it("reports success only for a durable relative-path receipt and gates SVG output", async () => {
    const files = await submissionFiles();
    const svg = await readFile(files.artifact, "utf8");
    const durable = {
      status: "accepted", transactionId: "cli-test",
      artifact: { durablePath: "iterations/seatify-iteration-1.svg", digest: "a".repeat(64), svg },
    };
    for (const include of [false, true]) {
      const output = capture();
      const code = await runLineageCli([
        "submit", "--artifact", files.artifact, "--proposal", files.proposal, "--json", "--quiet", ...(include ? ["--include-svg"] : []),
      ], output.io, { resolveInstance: async () => instance(durable) });
      expect(code).toBe(EXIT.success);
      expect(output.stderr).toEqual([]);
      const result = JSON.parse(output.stdout[0]);
      expect(result.artifact).toMatchObject({ path: "iterations/seatify-iteration-1.svg", digest: "a".repeat(64) });
      expect("svg" in result.artifact).toBe(include);
    }
  });

  it("does not treat the legacy in-memory accepted artifact as saved", async () => {
    const files = await submissionFiles();
    const output = capture();
    const legacy = { status: "accepted", transactionId: "cli-test", artifact: { sourcePath: "concept.svg", revision: 2, svg: await readFile(files.artifact, "utf8") } };
    expect(await runLineageCli([
      "submit", "--artifact", files.artifact, "--proposal", files.proposal, "--json",
    ], output.io, { resolveInstance: async () => instance(legacy as AgentProducerOutcome) })).toBe(EXIT.conflict);
    expect(JSON.parse(output.stdout[0])).toMatchObject({ ok: false, status: "conflict" });
  });
});
