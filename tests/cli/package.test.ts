import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const exec = promisify(execFile);

describe("public package contract", () => {
  it("publishes built runtime, public-beta instructions, and the canonical example", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
    expect(packageJson).not.toHaveProperty("private");
    expect(packageJson.bin).toEqual({ "lineage-logo": "dist/cli/bin.js" });
    expect(packageJson.engines).toEqual({ node: ">=22" });
    expect(packageJson.files).toEqual(["dist/**", "README.md", "examples/seatify-constellation.svg", "docs/public-beta/**"]);
    expect(JSON.stringify(packageJson)).not.toContain("file:..");
  });

  it("includes every linked public-beta document in npm pack contents", async () => {
    const { stdout } = await exec("npm", ["pack", "--dry-run", "--json"], { cwd: process.cwd() });
    const packed = JSON.parse(stdout.slice(stdout.indexOf("[\n"))) as Array<{ files: Array<{ path: string }> }>;
    expect(packed).toHaveLength(1);
    const paths = packed[0].files.map((file) => file.path);
    expect(paths).toEqual(expect.arrayContaining([
      "docs/public-beta/seatify-quickstart.md",
      "docs/public-beta/cohort-protocol.md",
      "docs/public-beta/walkthrough-receipt.schema.json",
      "docs/public-beta/walkthrough-receipt.example.json",
      "docs/public-beta/distinct-user-attestation.schema.json",
      "docs/public-beta/distinct-user-attestation.example.json",
      "docs/public-beta/validate-distinct-user-attestation.mjs",
      "docs/public-beta/invitation.md",
      "docs/public-beta/triage.md",
    ]));
  });

  it("exposes help, complete schema, examples and rejection from a packed clean installation", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "installed-proposal-contract-"));
    try {
      const packed = await exec("npm", ["pack", "--json", "--pack-destination", dir], { cwd: process.cwd(), maxBuffer: 4 * 1024 * 1024 });
      const pack = JSON.parse(packed.stdout.slice(packed.stdout.indexOf("[\n")))[0];
      await writeFile(path.join(dir, "package.json"), JSON.stringify({ private: true }));
      await exec("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", path.join(dir, pack.filename)], { cwd: dir });
      const cli = path.join(dir, "node_modules/lineage-logo/dist/cli/bin.js");
      const invoke = (args: string[]) => exec(process.execPath, [cli, ...args], { cwd: dir });
      expect((await invoke(["--help"])).stdout).toContain("validate --proposal");
      const schema = JSON.parse((await invoke(["schema"])).stdout);
      expect(schema.$id).toBe("urn:lineage-logo:public-proposal:v1");
      expect(schema.examples).toHaveLength(8);
      for (const example of schema.examples) {
        const proposal = path.join(dir, "proposal.json");
        await writeFile(proposal, JSON.stringify(example));
        const validated = JSON.parse((await invoke(["validate", "--proposal", proposal, "--json"])).stdout);
        expect(validated).toMatchObject({ command: "validate", ok: true, operationCount: 1 });
        expect(await readFile(proposal, "utf8")).toBe(JSON.stringify(example));
      }
      const invalid = path.join(dir, "invalid.json");
      await writeFile(invalid, JSON.stringify({ ...schema.examples[0], protocolVersion: 2 }));
      let rejected: { code?: number; stdout?: string } | undefined;
      try { await invoke(["validate", "--proposal", invalid, "--json"]); }
      catch (error) { rejected = error as typeof rejected; }
      expect(rejected?.code).toBe(2);
      expect(JSON.parse(rejected!.stdout!).error.code).toBe("unsupported_version");
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 120_000);
});
