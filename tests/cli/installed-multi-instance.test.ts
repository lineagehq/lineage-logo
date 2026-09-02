import { execFile } from "node:child_process";
import { access, lstat, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execute = promisify(execFile);

async function run(file: string, args: string[], env = process.env, cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await execute(file, args, { cwd, env, maxBuffer: 10 * 1024 * 1024 });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

describe("freshly installed public executable", () => {
  it("runs help, version, and sanitized doctor JSON through npm's generated bin symlink", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lineage-installed-cli-"));
    try {
      const pack = path.join(root, "pack");
      const install = path.join(root, "consumer");
      const registry = path.join(root, "registry");
      await Promise.all([mkdir(pack), mkdir(install)]);
      const packed = await run("npm", ["pack", "--json", "--pack-destination", pack]);
      expect(packed.code).toBe(0);
      const tarballName = (await readdir(pack)).find((name) => name.endsWith(".tgz"));
      expect(tarballName).toBeTruthy();
      await writeFile(path.join(install, "package.json"), JSON.stringify({ private: true }));
      const installed = await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", path.join(pack, tarballName!)], process.env, install);
      expect(installed.code).toBe(0);

      const bin = path.join(install, "node_modules", ".bin", "lineage-logo");
      expect((await lstat(bin)).isSymbolicLink()).toBe(true);
      await access(bin);
      const env = { ...process.env, LINEAGE_LOGO_REGISTRY_DIR: registry };
      const help = await run(bin, ["--help"], env);
      const version = await run(bin, ["--version"], env);
      const doctor = await run(bin, ["doctor", "--json"], env);
      expect(help).toMatchObject({ code: 0, stderr: "" });
      expect(help.stdout).toContain("Usage: lineage-logo");
      expect(version).toEqual({ code: 0, stdout: "0.1.0-beta.1\n", stderr: "" });
      expect(doctor.code).toBe(4);
      expect(JSON.parse(doctor.stdout)).toMatchObject({ schemaVersion: 1, command: "doctor", ok: false, status: "unavailable" });
      const publicOutput = `${help.stdout}${help.stderr}${version.stdout}${version.stderr}${doctor.stdout}${doctor.stderr}`;
      expect(publicOutput).not.toContain(root);
      expect(publicOutput).not.toMatch(/bearer|token|<svg/i);
    } finally {
      await rm(root, { recursive: true, force: true });
      const remains = await access(root).then(() => true).catch(() => false);
      expect(remains).toBe(false);
    }
  }, 60_000);
});
