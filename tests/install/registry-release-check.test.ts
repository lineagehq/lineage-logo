import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

function runRegistryCheck(environment: NodeJS.ProcessEnv): { status: number; output: string } {
  try {
    const output = execFileSync(process.execPath, ["--experimental-strip-types", "scripts/registry-release-check.ts"], {
      cwd: process.cwd(),
      env: environment,
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

  it("uses explicit installed-version capabilities", () => {
    expect(installedVersionCapabilities("0.1.0-beta.1")).toEqual({ publicOnboarding: false, publicRouting: false });
    expect(installedVersionCapabilities("0.1.0-beta.2")).toEqual({ publicOnboarding: true, publicRouting: true });
  });

  it("preserves lowercase hyphenated package-resolution diagnostics", () => {
    // Break caught: treating operational package slugs as opaque tokens erases the actionable failure reason.
    expect(safeDiagnostic("package-resolution-failed-because-registry-unavailable")).toContain("package-resolution-failed-because-registry-unavailable");
    expect(safeDiagnostic("request failed with 8uQm3Zk1Hp9Va6Lw4Nd7Xr2Bc5Ye0TsF")).not.toContain("8uQm3Zk1Hp9Va6Lw4Nd7Xr2Bc5Ye0TsF");
  });

  it("preserves public npm error context while removing secrets, paths, SVG, and stacks", () => {
    // Break caught: reverting to generic/truncated diagnostics hides which public package request failed.
    const diagnostic = safeDiagnostic([
      "npm error code E404",
      "npm error 404 Not Found - GET https://registry.npmjs.org/lineage-logo/-/lineage-logo-1.2.3.tgz - Not found",
      "Authorization: Bearer registry-check-secret-token-value",
      "Authorization: Bearer short-secret",
      "at install (/Users/example/private.svg:42:9)",
      "<svg><text>private</text></svg>",
    ].join("\n"));
    expect(diagnostic).toContain("npm error code E404");
    expect(diagnostic).toContain("https://registry.npmjs.org/lineage-logo/-/lineage-logo-1.2.3.tgz");
    expect(diagnostic).toContain("[redacted]");
    expect(diagnostic).toContain("[svg]");
    expect(diagnostic).not.toContain("secret-token");
    expect(diagnostic).not.toContain("short-secret");
    expect(diagnostic).not.toContain("private.svg");
    expect(diagnostic).not.toContain("<svg");
    expect(diagnostic).not.toContain("at install");
  });

  it("redacts npm auth credentials from npm-style stderr without hiding public context", () => {
    const npmToken = "npm_abcdefghijklmnopqrstuvwxyz0123456789";
    const diagnostic = safeDiagnostic([
      "npm error code E401",
      "npm error 401 Unauthorized - GET https://registry.npmjs.org/lineage-logo - authorization required",
      `npm error auth=${npmToken}`,
      `npm error _auth=${npmToken}`,
      "npm error package-resolution-failed-because-registry-unavailable",
    ].join("\n"));

    expect(diagnostic).toContain("npm error code E401");
    expect(diagnostic).toContain("https://registry.npmjs.org/lineage-logo");
    expect(diagnostic).toContain("package-resolution-failed-because-registry-unavailable");
    expect(diagnostic).not.toContain(npmToken);
    expect(diagnostic).not.toContain("auth=" + npmToken);
    expect(diagnostic).not.toContain("_auth=" + npmToken);
  });

  it("reports cleanup failures through the same sanitized diagnostic boundary", async () => {
    // Break caught: cleanup exceptions bypass the public diagnostic sanitizer and leak raw error details.
    const root = await mkdtemp(path.join(os.tmpdir(), "lineage-registry-cleanup-"));
    const bin = path.join(root, "bin");
    const npm = path.join(bin, "npm");
    await mkdir(bin);
    await writeFile(npm, [
      "#!/bin/sh",
      "printf 'npm error code E404\\nnpm error 404 Not Found - GET https://registry.npmjs.org/lineage-logo/-/lineage-logo-1.2.3.tgz - Not found\\n' >&2",
      "chmod 0500 \"$TMPDIR\"",
      "exit 1",
    ].join("\n"));
    await chmod(npm, 0o755);
    try {
      const result = runRegistryCheck({
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        REGISTRY_PACKAGE_VERSION: "1.2.3",
        TMPDIR: root,
      });
      expect(result.status).toBe(1);
      expect(result.output).toContain("Registry check failed during registry install: exact public registry install failed: npm error code E404");
      expect(result.output).toContain("https://registry.npmjs.org/lineage-logo/-/lineage-logo-1.2.3.tgz");
      expect(result.output).toContain("cleanup");
      expect(result.output).not.toContain("Error:");
      expect(result.output).not.toContain(root);
      expect(result.output).not.toContain("at main");
    } finally {
      await chmod(root, 0o700);
      await rm(root, { recursive: true, force: true });
    }
  });
});
