import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installedVersionCapabilities, isExactRegistryVersion, safeDiagnostic } from "../../scripts/registry-release-check";

function runValidation(version: string, environment: NodeJS.ProcessEnv = process.env): { status: number; output: string } {
  try {
    const output = execFileSync(process.execPath, ["--experimental-strip-types", "scripts/registry-release-check.ts", "--validate-version"], {
      cwd: process.cwd(),
      env: { ...environment, REGISTRY_PACKAGE_VERSION: version },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

describe("public registry release enforcement", () => {
  it.each(["beta", "latest", "^1.0.0", "1.0", "v1.0.0", "1.0.0-01", "1.0.0-alpha.01", "1.0.0+build..1"])("refuses invalid or mutable selector %s", (version) => {
    expect(isExactRegistryVersion(version)).toBe(false);
    const result = runValidation(version);
    expect(result.status).toBe(1);
    expect(result.output).toContain("REGISTRY_PACKAGE_VERSION must be an exact semantic version");
  });

  it.each(["0.1.0-beta.1", "1.0.0", "1.0.0-rc.1+build.7", "10.20.30-0"])("accepts exact SemVer %s", (version) => {
    expect(isExactRegistryVersion(version)).toBe(true);
    expect(runValidation(version).status).toBe(0);
  });

  it("does not invoke npm when validation fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lineage-registry-validator-"));
    const npm = path.join(root, "npm");
    const marker = path.join(root, "npm-called");
    try {
      await writeFile(npm, `#!/bin/sh\nprintf called > ${marker}\nexit 99\n`);
      await chmod(npm, 0o755);
      const result = runValidation("1.0.0-01", { ...process.env, PATH: `${root}${path.delimiter}${process.env.PATH}` });
      expect(result.status).toBe(1);
      await expect(readFile(marker, "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses explicit installed-version capabilities and redacts sensitive diagnostics", () => {
    expect(installedVersionCapabilities("0.1.0-beta.1")).toEqual({ publicOnboarding: false, publicRouting: false });
    expect(installedVersionCapabilities("0.1.0-beta.2")).toEqual({ publicOnboarding: true, publicRouting: true });
    const diagnostic = safeDiagnostic("Bearer registry-check-secret-token-value at /Users/example/private.svg <svg><text>private</text></svg>");
    expect(diagnostic).toContain("[redacted]");
    expect(diagnostic).toContain("[path]");
    expect(diagnostic).toContain("[svg]");
    expect(diagnostic).not.toContain("secret-token");
    expect(diagnostic).not.toContain("private.svg");
    expect(diagnostic).not.toContain("<svg");
  });
});
