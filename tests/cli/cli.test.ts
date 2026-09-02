import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXIT, InstanceResolutionError, runLineageCli, type CliIo, type ResolvedInstance } from "../../src/cli/index";
import type { AgentProducerOutcome } from "../../src/producer/agent-client";

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
    document: { sessionId: "session", sourcePath: "concept.svg", baseRevision: 1 },
    operations: [{ type: "renameLayer", operationId: "rename", target: { sessionKey: "logo" }, name: "Updated" }],
  }));
  return { artifact, proposal };
}

function instance(outcome: AgentProducerOutcome | Record<string, unknown>): ResolvedInstance {
  return {
    instanceId: "12345678-secret-tail", workspaceLabel: "/private/Customers/Seatify 🚫", editorOrigin: "http://lineage-logo.localhost:4173",
    client: { manifest: vi.fn(), submitAndWait: vi.fn().mockResolvedValue(outcome) },
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
    expect(version.stdout).toEqual(["0.1.0-beta.1"]);
    expect(await runLineageCli([], capture().io)).toBe(EXIT.usage);
  });

  it("passes a descriptive launch contract to the compatibility implementation", async () => {
    const output = capture();
    const launch = vi.fn().mockResolvedValue(EXIT.success);
    expect(await runLineageCli(["launch", "--workspace", ".", "--port", "4273", "--no-open"], output.io, { launch })).toBe(EXIT.success);
    expect(launch).toHaveBeenCalledWith({ workspace: ".", port: 4273, open: false, development: false, json: false }, output.io);
    expect(await runLineageCli(["launch", "--workspace", ".", "--port", "80"], capture().io, { launch })).toBe(EXIT.usage);
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

  it("fails closed with exit 3 for absent or ambiguous selection", async () => {
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
