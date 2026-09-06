import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXIT, runLineageCli, type ResolvedInstance } from "../../src/cli/index";
import { PROPOSAL_EXAMPLES, PUBLIC_PROPOSAL_SCHEMA } from "../../src/cli/proposal-schema";
import { safeError, validateLocalProposal } from "../../src/cli/proposal-validation";
import type { AgentProducerOutcome } from "../../src/producer/agent-client";
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
async function files(proposal: unknown) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "proposal-validation-")); dirs.push(dir);
  const file = path.join(dir, "proposal.json");
  await writeFile(file, typeof proposal === "string" ? proposal : JSON.stringify(proposal));
  const artifact = path.join(dir, "artifact.svg");
  await writeFile(artifact, '<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>');
  return { dir, file, artifact };
}
async function invoke(argv: string[], outcome?: AgentProducerOutcome) {
  const output: string[] = []; const stderr: string[] = [];
  const submitAndWait = vi.fn().mockResolvedValue(outcome);
  const resolveInstance = vi.fn().mockResolvedValue({ instanceId: "test", workspaceLabel: "fixture", client: { manifest: async () => ({ sessionId: "replace-with-context-session", revision: 0, sourcePath: "private-source.svg", layers: [] }), submitAndWait } } as unknown as ResolvedInstance);
  const code = await runLineageCli([...argv, "--json"], { stdout: (line) => output.push(line), stderr: (line) => stderr.push(line) }, { resolveInstance });
  expect(output).toHaveLength(1);
  return { code, result: JSON.parse(output[0]), resolveInstance, submitAndWait, stderr };
}
describe("public proposal local contract", () => {
  it("ships strict v1 schema and runtime-valid examples for every supported operation", async () => {
    const schema = await invoke(["schema"]);
    expect(schema.result.schema).toEqual(PUBLIC_PROPOSAL_SCHEMA);
    expect(schema.result.schema.additionalProperties).toBe(false);
    expect(new Set(PROPOSAL_EXAMPLES.map((p) => p.operations[0].type)).size).toBe(6);
    for (const example of PROPOSAL_EXAMPLES) {
      expect(validateLocalProposal(JSON.stringify(example))).toEqual(example);
      const { file } = await files(example);
      const local = await invoke(["validate", "--proposal", file]);
      expect(local.code).toBe(EXIT.success);
      expect(local.resolveInstance).not.toHaveBeenCalled();
    }
  });
  it.each([
    ["malformed", "{", "invalid_payload"],
    ["version", { ...PROPOSAL_EXAMPLES[0], protocolVersion: 99 }, "unsupported_version"],
    ["private unknown field", { ...PROPOSAL_EXAMPLES[0], "/private/TOKEN_CANARY": "SVG_CANARY" }, "unknown_field"],
    ["unsafe SVG", { ...PROPOSAL_EXAMPLES[0], operations: [{ ...PROPOSAL_EXAMPLES[0].operations[0], svg: '<g onclick="TOKEN_CANARY()"/>' }] }, "unsafe_svg"],
    ["multiple roots", { ...PROPOSAL_EXAMPLES[0], operations: [{ ...PROPOSAL_EXAMPLES[0].operations[0], svg: '<g/><g/>' }] }, "invalid_svg"],
    ["paint URL", { ...PROPOSAL_EXAMPLES[4], operations: [{ ...PROPOSAL_EXAMPLES[4].operations[0], value: "url(https://TOKEN_CANARY)" }] }, "invalid_paint"],
    ["forward reference", { ...PROPOSAL_EXAMPLES[4], operations: [{ ...PROPOSAL_EXAMPLES[4].operations[0], target: { operationId: "later" } }] }, "invalid_reference"],
    ["unknown operation", { ...PROPOSAL_EXAMPLES[0], operations: [{ type: "TOKEN_CANARY", operationId: "op" }] }, "unknown_operation"],
  ])("rejects %s before discovery or delivery with no file changes", async (_label, proposal, errorCode) => {
    const { dir, file, artifact } = await files(proposal);
    const before = await readFile(file, "utf8");
    for (const command of ["validate", "submit"]) {
      const run = await invoke([command, "--proposal", file, "--artifact", artifact]);
      expect(run.code).toBe(EXIT.usage);
      expect(run.result.error.code).toBe(errorCode);
      expect(run.result.error.nextAction).toBeTruthy();
      expect(run.resolveInstance).not.toHaveBeenCalled();
      expect(run.submitAndWait).not.toHaveBeenCalled();
      expect(JSON.stringify(run.result)).not.toMatch(/TOKEN_CANARY|SVG_CANARY|\/private\//);
    }
    expect(await readdir(dir)).toEqual(["artifact.svg", "proposal.json"]);
    expect(await readFile(file, "utf8")).toBe(before);
  });
  it("preserves safe operation identity and bounded known field location", async () => {
    const { file } = await files({ ...PROPOSAL_EXAMPLES[4], operations: [{ ...PROPOSAL_EXAMPLES[4].operations[0], property: "private-invalid" }] });
    const run = await invoke(["validate", "--proposal", file]);
    expect(run.result.error).toMatchObject({ code: "invalid_payload", operationId: "paint", field: "operations[0].property" });
    expect(safeError({ code: "unknown_field", path: "operations[0].target./private/secret", message: "TOKEN_CANARY" }).field).toBe("operations[0].target");
  });
  it.each([
    ["timeout", "timeout"], ["stale", "stale_document"], ["conflict", "conflict"], ["unavailable", "unavailable_editor"], ["disconnected", "unavailable_editor"], ["reverted", "reviewer_rejection"], ["rejected", "validation_rejection"],
  ])("distinguishes %s outcomes with actionable redacted guidance", async (status, expected) => {
    const { file, artifact } = await files(PROPOSAL_EXAMPLES[4]);
    const run = await invoke(["submit", "--proposal", file, "--artifact", artifact], { status, transactionId: "test", message: "TOKEN_CANARY" } as AgentProducerOutcome);
    expect(run.result.error.code).toBe(expected);
    expect(JSON.stringify(run.result)).not.toContain("TOKEN_CANARY");
    if (status === "timeout") expect(run.result.error.nextAction).toContain("do not blindly submit a duplicate");
  });
  it("retains editor validation code without reflecting remote message or unknown path", async () => {
    const { file, artifact } = await files(PROPOSAL_EXAMPLES[4]);
    const run = await invoke(["submit", "--proposal", file, "--artifact", artifact], { status: "rejected", transactionId: "test", error: { status: "rejected", transactionId: "test", error: { code: "locked_target", operationId: "paint", path: "operations[0].target.TOKEN_CANARY", message: "TOKEN_CANARY" } } });
    expect(run.result.error).toMatchObject({ code: "locked_target", operationId: "paint", field: "operations[0].target" });
    expect(JSON.stringify(run.result)).not.toContain("TOKEN_CANARY");
  });
});
