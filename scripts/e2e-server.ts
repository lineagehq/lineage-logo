import { spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { access, copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const API_PORT = 43117;
const CLIENT_PORT = 43118;
const EDITOR_ORIGIN = `http://marquee-qa.localhost:${CLIENT_PORT}`;
const PROXIED_EDITOR_ORIGIN = `http://127.0.0.1:${CLIENT_PORT}`;
const AGENT_TOKEN = "lineage-logo-e2e-agent-token";
const WORKSPACE_PREFIX = "lineage-logo-marquee-qa-";
const repositoryRoot = process.cwd();
const canonicalSeatifyConstellationFixture = path.join(repositoryRoot, "examples/seatify-constellation.svg");
const fixtures = [
  path.join(repositoryRoot, "tests/fixtures/workspace/concepts/complex-seatify.svg"),
  canonicalSeatifyConstellationFixture,
];
const executable = (name: string) => path.join(repositoryRoot, "node_modules", ".bin", name);
const detached = process.platform !== "win32";

let workspace: string | undefined;
let stopping = false;
const children: ChildProcess[] = [];

function signalChild(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  try {
    if (detached) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

async function removeExactWorkspace(): Promise<void> {
  if (!workspace) return;
  const createdPath = workspace;
  const temporaryRoot = await realpath(tmpdir());
  const info = await lstat(createdPath);
  const resolved = await realpath(createdPath);
  if (!info.isDirectory() || info.isSymbolicLink() || path.dirname(resolved) !== temporaryRoot
    || resolved !== createdPath || !path.basename(resolved).startsWith(WORKSPACE_PREFIX)) {
    throw new Error("Refusing to remove an unexpected e2e workspace.");
  }
  await rm(resolved, { recursive: true });
  await access(resolved, constants.F_OK).then(
    () => { throw new Error("The isolated e2e workspace still exists after cleanup."); },
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    },
  );
  console.log("Removed the isolated e2e workspace.");
  workspace = undefined;
}

async function shutdown(exitCode: number, signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
  if (stopping) return;
  stopping = true;
  const exits = children.map(waitForExit);
  for (const child of children) signalChild(child, signal);
  const exitedGracefully = await Promise.race([
    Promise.all(exits).then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000)),
  ]);
  if (!exitedGracefully) {
    for (const child of children) signalChild(child, "SIGKILL");
    await Promise.all(exits);
  }
  await removeExactWorkspace();
  process.exitCode = exitCode;
}

async function main(): Promise<void> {
  await Promise.all(fixtures.map((fixture) => access(fixture, constants.R_OK)));
  const temporaryRoot = await realpath(tmpdir());
  workspace = await mkdtemp(path.join(temporaryRoot, WORKSPACE_PREFIX));
  const concepts = path.join(workspace, "concepts");
  await mkdir(concepts);
  for (const fixture of fixtures) {
    const copiedFixture = path.join(concepts, path.basename(fixture));
    await copyFile(fixture, copiedFixture, constants.COPYFILE_EXCL);
    const [sourceBytes, copiedBytes] = await Promise.all([readFile(fixture), readFile(copiedFixture)]);
    if (!sourceBytes.equals(copiedBytes)) throw new Error(`The e2e fixture copy is not byte-for-byte exact: ${path.basename(fixture)}`);
  }
  console.log("Canonical Seatify constellation fixture: examples/seatify-constellation.svg");

  const environment = {
    ...process.env,
    LINEAGE_LOGO_CLIENT_PORT: String(CLIENT_PORT),
    LINEAGE_LOGO_PORT: String(API_PORT),
    // Vite intentionally rewrites proxied API Origin headers to its loopback
    // listener. Keep the descriptive hostname for the public browser URL while
    // validating the exact internal Origin that reaches the API server.
    LINEAGE_LOGO_EDITOR_ORIGIN: PROXIED_EDITOR_ORIGIN,
    LINEAGE_LOGO_PUBLIC_EDITOR_ORIGIN: EDITOR_ORIGIN,
    LINEAGE_LOGO_AGENT_TOKEN: AGENT_TOKEN,
    LINEAGE_LOGO_REGISTRY_DIR: path.join(workspace, ".lineage-registry"),
    LINEAGE_LOGO_E2E_ALLOW_UNBOUND_AGENT: "1",
  };
  children.push(
    spawn(executable("vite"), ["--host", "127.0.0.1", "--port", String(CLIENT_PORT), "--strictPort"], {
      cwd: repositoryRoot,
      detached,
      env: environment,
      stdio: "inherit",
    }),
    spawn(executable("tsx"), ["src/server/index.ts", "--workspace", workspace, "--port", String(API_PORT)], {
      cwd: repositoryRoot,
      detached,
      env: environment,
      stdio: "inherit",
    }),
  );

  for (const child of children) {
    child.once("error", () => {
      console.error("An e2e child process could not start.");
      void shutdown(1);
    });
    child.once("exit", (code, signal) => {
      if (stopping) return;
      console.error(`E2E child exited before Playwright shutdown (${code ?? signal ?? "unknown"}).`);
      void shutdown(code ?? 1);
    });
  }
  console.log(`Marquee QA editor: ${EDITOR_ORIGIN}`);
  console.log("Created an isolated fixture workspace and registry.");
}

process.once("SIGINT", () => { void shutdown(130, "SIGINT"); });
process.once("SIGTERM", () => { void shutdown(0); });
if (process.platform !== "win32") {
  process.once("SIGHUP", () => { void shutdown(0); });
  process.once("SIGQUIT", () => { void shutdown(0); });
}

main().catch(async () => {
  console.error("The isolated e2e environment could not start.");
  await shutdown(1).catch(() => console.error("The isolated e2e environment could not be cleaned up."));
});
