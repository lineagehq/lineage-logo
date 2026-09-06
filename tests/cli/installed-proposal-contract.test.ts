import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
const exec = promisify(execFile);

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
    expect(schema.examples).toHaveLength(6);
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
