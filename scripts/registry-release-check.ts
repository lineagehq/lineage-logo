import { spawn } from "node:child_process";
import { chmod, lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const PACKAGE_NAME = "lineage-logo";
const FIXTURE_PATH = "examples/seatify-constellation.svg";
const SEMVER_NUMBER = "(?:0|[1-9]\\d*)";
const SEMVER_IDENTIFIER = "(?:0|[1-9]\\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)";
const EXACT_SEMVER = new RegExp(`^${SEMVER_NUMBER}\\.${SEMVER_NUMBER}\\.${SEMVER_NUMBER}(?:-${SEMVER_IDENTIFIER}(?:\\.${SEMVER_IDENTIFIER})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);

export type InstalledVersionCapabilities = {
  publicOnboarding: boolean;
  publicRouting: boolean;
};

export function isExactRegistryVersion(value: string | undefined): value is string {
  return typeof value === "string" && EXACT_SEMVER.test(value);
}

export function installedVersionCapabilities(version: string): InstalledVersionCapabilities {
  // 0.1.0-beta.1 predates the public bootstrap/context contract. Every later
  // immutable version is expected to provide the supported public commands.
  return version === "0.1.0-beta.1"
    ? { publicOnboarding: false, publicRouting: false }
    : { publicOnboarding: true, publicRouting: true };
}

export function safeDiagnostic(value: string): string {
  return value.replace(/<svg\b[\s\S]*?<\/svg>/gi, "[svg]")
    .replace(/(?:Bearer\s+|(?:token|authorization|password|secret)\s*[=:]\s*)[^\s,;]+/gi, "[redacted]")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]")
    .replace(/(?:[A-Za-z]:[\\/]|\/)(?:[^\s<>:"|?*]+[\\/])+[^\s<>:"|?*]+/g, "[path]")
    .slice(0, 240);
}

export function validateRegistryPackageVersion(version: string | undefined): version is string {
  return isExactRegistryVersion(version);
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
  const version = process.env.REGISTRY_PACKAGE_VERSION;
  if (!validateRegistryPackageVersion(version)) {
    process.stderr.write("REGISTRY_PACKAGE_VERSION must be an exact semantic version; tags and ranges are not allowed.\n");
    process.exitCode = 1;
    return;
  }

  if (process.argv.includes("--validate-version")) {
    process.stdout.write(`Registry package version ${version} is an exact semantic version.\n`);
    return;
  }

  const temporaryRoot = await realpath(tmpdir());
  const installRoot = await mkdtemp(path.join(temporaryRoot, "lineage-logo-registry-"));
  let phase = "registry install";
  try {
    const installed = await command("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", "--registry=https://registry.npmjs.org", `${PACKAGE_NAME}@${version}`], installRoot);
    if (installed.code !== 0) throw new Error("exact public registry install failed");

    const packageRoot = path.join(installRoot, "node_modules", PACKAGE_NAME);
    phase = "installed manifest";
    const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as { version?: unknown };
    if (manifest.version !== version) throw new Error("installed registry package version mismatch");
    phase = "installed Seatify fixture";
    const fixture = await readFile(path.join(packageRoot, FIXTURE_PATH), "utf8");
    if (!fixture.includes("<svg") || !fixture.includes("Seatify constellation")) throw new Error("installed Seatify fixture is unavailable");

    const bin = path.join(installRoot, "node_modules", ".bin", process.platform === "win32" ? "lineage-logo.cmd" : "lineage-logo");
    if (process.platform !== "win32") await chmod(bin, 0o755);
    const environment = { ...process.env, LINEAGE_LOGO_REGISTRY_DIR: path.join(installRoot, "registry"), LINEAGE_LOGO_AGENT_TOKEN: "registry-check-secret-token-value" };
    phase = "installed CLI";
    const [help, installedVersion, doctor] = await Promise.all([
      command(bin, ["--help"], installRoot, environment),
      command(bin, ["--version"], installRoot, environment),
      command(bin, ["doctor", "--json"], installRoot, environment),
    ]);
    if (help.code !== 0 || !help.stdout.includes("Usage: lineage-logo")) throw new Error("installed help failed");
    if (installedVersion.code !== 0 || installedVersion.stdout.trim() !== version) throw new Error("installed version failed");
    if (doctor.code !== 4) throw new Error("installed doctor exit taxonomy changed");
    const receipt = JSON.parse(doctor.stdout) as { schemaVersion?: unknown; command?: unknown; ok?: unknown; status?: unknown };
    if (receipt.schemaVersion !== 1 || receipt.command !== "doctor" || receipt.ok !== false || receipt.status !== "unavailable") throw new Error("installed doctor schema changed");
    phase = "redaction";
    const publicOutput = `${help.stdout}${help.stderr}${installedVersion.stdout}${installedVersion.stderr}${doctor.stdout}${doctor.stderr}`;
    for (const secret of [installRoot, environment.LINEAGE_LOGO_AGENT_TOKEN, "<svg", "registry"]) {
      if (publicOutput.includes(secret)) throw new Error("installed diagnostics exposed private data");
    }
    process.stdout.write(`Registry package ${version} CLI, fixture, and redaction checks passed.\n`);
  } catch (error) {
    process.stderr.write(`Registry check failed during ${phase}: ${safeDiagnostic(error instanceof Error ? error.message : "unknown failure")}. Verify that ${version} is published unchanged, then retry.\n`);
    process.exitCode = 1;
  } finally {
    const info = await lstat(installRoot);
    const resolvedInstall = await realpath(installRoot);
    if (!info.isDirectory() || info.isSymbolicLink() || path.dirname(resolvedInstall) !== temporaryRoot || !path.basename(resolvedInstall).startsWith("lineage-logo-registry-")) {
      throw new Error("refusing unsafe registry-check cleanup");
    }
    await rm(resolvedInstall, { recursive: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
