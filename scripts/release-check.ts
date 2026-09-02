import { spawn } from "node:child_process";
import { chmod, lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

interface PackedFile { path: string }

export function validatePackedFiles(files: PackedFile[]): void {
  const names = files.map((file) => file.path);
  const allowed = names.every((name) => name === "package.json" || name === "README.md" || name === "LICENSE"
    || name === "examples/seatify-constellation.svg" || name.startsWith("dist/"));
  if (!allowed || !names.includes("LICENSE") || !names.includes("dist/cli/bin.js") || !names.includes("examples/seatify-constellation.svg")) {
    throw new Error("release package allowlist mismatch");
  }
  if (names.some((name) => /(^|\/)(?:tests?|docs|scripts|\.agents|\.github|node_modules)(\/|$)/.test(name))) {
    throw new Error("release package contains an internal path");
  }
}

export function isValidPackageVersion(value: string): boolean {
  return value.length <= 129
    && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\s*$/.test(value);
}

export function safeDiagnostic(value: string): string {
  return value.replace(/(?:Bearer\s+)?[A-Za-z0-9_-]{24,}/g, "[redacted]")
    .replace(/(?:\/?[A-Za-z0-9._-]+){3,}/g, "[path]")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "[svg]")
    .slice(0, 240);
}

export function parsePackResult(output: string): Array<{ filename: string; files: PackedFile[] }> {
  const start = Math.max(output.lastIndexOf("\n["), output.startsWith("[") ? 0 : -1);
  if (start < 0) throw new Error("package creation did not return JSON");
  return JSON.parse(output.slice(start === 0 ? 0 : start + 1)) as Array<{ filename: string; files: PackedFile[] }>;
}

async function command(commandName: string, args: string[], cwd: string, env = process.env): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(commandName, args, { cwd, env: { ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function main(): Promise<void> {
  const repositoryRoot = await realpath(process.cwd());
  const temporaryRoot = await realpath(tmpdir());
  const installRoot = await mkdtemp(path.join(temporaryRoot, "lineage-logo-release-"));
  let tarball = "";
  let phase = "package";
  try {
    const packed = await command("npm", ["pack", "--json"], repositoryRoot);
    if (packed.code !== 0) throw new Error("package creation failed");
    const result = parsePackResult(packed.stdout);
    if (result.length !== 1) throw new Error("package creation returned an unexpected result");
    validatePackedFiles(result[0].files);
    tarball = path.join(repositoryRoot, path.basename(result[0].filename));

    phase = "clean install and reinstall";
    for (let pass = 0; pass < 2; pass += 1) {
      const installed = await command("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", tarball], installRoot);
      if (installed.code !== 0) throw new Error("isolated package install or reinstall failed");
    }
    const bin = path.join(installRoot, "node_modules", ".bin", process.platform === "win32" ? "lineage-logo.cmd" : "lineage-logo");
    if (process.platform !== "win32") await chmod(bin, 0o755);
    const isolatedEnvironment = {
      ...process.env,
      LINEAGE_LOGO_REGISTRY_DIR: path.join(installRoot, "registry"),
      LINEAGE_LOGO_AGENT_TOKEN: "release-check-secret-token-value",
    };
    phase = "installed CLI help";
    const help = await command(bin, ["--help"], installRoot, isolatedEnvironment);
    phase = "installed CLI version";
    const version = await command(bin, ["--version"], installRoot, isolatedEnvironment);
    phase = "installed CLI doctor";
    const doctor = await command(bin, ["doctor", "--json"], installRoot, isolatedEnvironment);
    phase = "installed CLI help validation";
    if (help.code !== 0 || !help.stdout.includes("Usage: lineage-logo")) throw new Error("installed help failed");
    phase = "installed CLI version validation";
    if (version.code !== 0 || !isValidPackageVersion(version.stdout)) throw new Error("installed version failed");
    phase = "installed CLI doctor validation";
    if (doctor.code !== 4) throw new Error(`installed doctor exit taxonomy changed (code ${doctor.code})`);
    const receipt = JSON.parse(doctor.stdout) as { schemaVersion?: unknown; command?: unknown; ok?: unknown; status?: unknown };
    if (receipt.schemaVersion !== 1 || receipt.command !== "doctor" || receipt.ok !== false || receipt.status !== "unavailable") {
      throw new Error("installed doctor schema changed");
    }
    phase = "installed CLI redaction validation";
    const publicOutput = `${help.stdout}${help.stderr}${version.stdout}${version.stderr}${doctor.stdout}${doctor.stderr}`;
    for (const secret of [repositoryRoot, installRoot, isolatedEnvironment.LINEAGE_LOGO_AGENT_TOKEN, "<svg", "registry"]) {
      if (publicOutput.includes(secret)) throw new Error("installed diagnostics exposed private data");
    }
    phase = "reinstalled package validation";
    const manifest = JSON.parse(await readFile(path.join(installRoot, "node_modules", "lineage-logo", "package.json"), "utf8")) as { version?: unknown };
    if (manifest.version !== version.stdout.trim()) throw new Error("reinstalled package version mismatch");
    process.stdout.write("Release package clean-install and same-artifact reinstall checks passed.\n");
  } catch (error) {
    process.stderr.write(`Release check failed during ${phase}: ${safeDiagnostic(error instanceof Error ? error.message : "unknown failure")}\n`);
    process.exitCode = 1;
  } finally {
    if (tarball) await rm(tarball, { force: true });
    const info = await lstat(installRoot);
    const resolvedInstall = await realpath(installRoot);
    if (!info.isDirectory() || info.isSymbolicLink() || path.dirname(resolvedInstall) !== temporaryRoot
      || !path.basename(resolvedInstall).startsWith("lineage-logo-release-")) {
      throw new Error("refusing unsafe release-check cleanup");
    }
    await rm(resolvedInstall, { recursive: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
