import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test, type BrowserContext } from "@playwright/test";
import { installedVersionCapabilities } from "../../scripts/registry-release-check";
import { identifyWorkspace, readAgentInstanceRegistry, type AgentInstanceRegistryEntry } from "../../src/shared/instance-registry";

const execute = promisify(execFile);
const repositoryRoot = process.cwd();

type CommandResult = { code: number; stdout: string; stderr: string };
type RunningCommand = { child: ChildProcess; stdout: string; stderr: string };
type RunningEditor = RunningCommand & { url: string; serverPid?: number; stopRequested?: boolean };

async function command(file: string, args: string[], env = process.env, cwd?: string): Promise<CommandResult> {
  try {
    const result = await execute(file, args, { cwd, env, maxBuffer: 10 * 1024 * 1024 });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

function startCommand(file: string, args: string[], env = process.env): RunningCommand {
  const child = spawn(file, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  const running: RunningCommand = { child, stdout: "", stderr: "" };
  child.stdout?.on("data", (chunk) => { running.stdout += String(chunk); });
  child.stderr?.on("data", (chunk) => { running.stderr += String(chunk); });
  return running;
}

async function availablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port is available.");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

async function poll<T>(read: () => Promise<T | undefined>, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for the isolated installed CLI bridge.");
}

async function startEditor(bin: string, workspace: string, registry: string, port: number): Promise<RunningEditor> {
  const child = spawn(bin, ["launch", "--workspace", workspace, "--port", String(port), "--no-open"], {
    env: { ...process.env, LINEAGE_LOGO_REGISTRY_DIR: registry }, stdio: ["ignore", "pipe", "pipe"],
  });
  const running: RunningEditor = { child, stdout: "", stderr: "", url: `http://lineage-logo.localhost:${port}` };
  child.stdout?.on("data", (chunk) => { running.stdout += String(chunk); });
  child.stderr?.on("data", (chunk) => { running.stderr += String(chunk); });
  await poll(async () => running.stdout.includes(running.url) ? true : undefined);
  await poll(async () => fetch(running.url).then((response) => response.ok ? true : undefined).catch(() => undefined));
  return running;
}

async function stopEditor(running: RunningEditor): Promise<void> {
  if (running.stopRequested) return;
  running.stopRequested = true;
  if (running.child.exitCode !== null || running.child.signalCode !== null) return;
  running.child.kill("SIGTERM");
  const exited = once(running.child, "exit");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (running.child.exitCode === null && running.child.signalCode === null) running.child.kill("SIGKILL");
}

async function stopCommand(running: RunningCommand): Promise<void> {
  if (running.child.exitCode !== null || running.child.signalCode !== null) return;
  running.child.kill("SIGTERM");
  await Promise.race([once(running.child, "exit"), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (running.child.exitCode === null && running.child.signalCode === null) running.child.kill("SIGKILL");
}

async function finishCommand(running: RunningCommand, timeoutMs = 30_000): Promise<CommandResult> {
  if (running.child.exitCode === null && running.child.signalCode === null) {
    await Promise.race([
      once(running.child, "exit"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Installed CLI command did not finish.")), timeoutMs)),
    ]);
  }
  return { code: running.child.exitCode ?? 1, stdout: running.stdout, stderr: running.stderr };
}

async function openSeatify(context: BrowserContext, url: string, workspacePath = "concepts/seatify-constellation.svg") {
  const page = await context.newPage();
  const streamRequest = page.waitForRequest((request) => request.url().endsWith("/api/agent/events"));
  const streamResponse = page.waitForResponse((response) => response.url().endsWith("/api/agent/events"));
  await page.goto(url);
  const connectedState = page.evaluate((sourcePath) => new Promise<string>((resolve) => {
    const status = document.querySelector("#status");
    if (!status) throw new Error("Editor status is unavailable.");
    const inspect = () => {
      if (status.textContent === "Agent connection ready" || (sourcePath.startsWith("iterations/") && status.textContent === `Saved ${sourcePath}`)) {
        observer.disconnect();
        resolve(status.textContent);
      }
    };
    const observer = new MutationObserver(inspect);
    observer.observe(status, { childList: true, characterData: true, subtree: true });
    inspect();
  }), workspacePath);
  await page.locator(`[data-path="${workspacePath}"]`).click();
  const [request, response, status] = await Promise.all([streamRequest, streamResponse, connectedState]);
  const requestHeaders = await request.allHeaders();
  const responseHeaders = await response.allHeaders();
  expect(request.method()).toBe("GET");
  expect(new URL(request.url()).host).toBe(new URL(url).host);
  expect(requestHeaders.origin).toBeUndefined();
  expect(requestHeaders["sec-fetch-site"]).toBe("same-origin");
  expect(requestHeaders["sec-fetch-mode"]).toBe("cors");
  expect(requestHeaders["sec-fetch-dest"]).toBe("empty");
  expect(response.status()).toBe(200);
  expect(responseHeaders["content-type"]).toContain("text/event-stream");
  expect(["Agent connection ready", ...(workspacePath.startsWith("iterations/") ? [`Saved ${workspacePath}`] : [])]).toContain(status);
  await expect(page.locator("#artboard svg[aria-label='Seatify constellation logo']")).toBeVisible();
  return page;
}

type BridgeDocument = {
  sessionId: string;
  baseRevision: number;
  sourcePath?: string;
  layers: Array<{ layerId: string; name: string }>;
};

async function publicContext(bin: string, workspace: string, env: NodeJS.ProcessEnv): Promise<BridgeDocument> {
  const result = await command(bin, ["context", "--workspace", workspace, "--json"], env);
  if (result.code !== 0) throw new Error("Installed public context is unavailable.");
  const body = JSON.parse(result.stdout) as { context: { sessionId: string; baseRevision: number; layers: Array<{ layerId: string; name: string }> } };
  if (result.stdout.includes(workspace) || result.stdout.includes("sourcePath")) throw new Error("Installed public context leaked private data.");
  return body.context;
}

async function installedManifest(entry: AgentInstanceRegistryEntry): Promise<BridgeDocument> {
  const response = await fetch(`${entry.apiOrigin}/api/agent/document`, {
    headers: {
      Authorization: `Bearer ${entry.token}`,
      "x-lineage-instance-id": entry.instanceId,
      "x-lineage-workspace-id": entry.workspaceId,
    },
  });
  if (!response.ok) throw new Error("Installed legacy manifest is unavailable.");
  const body = await response.json() as { sessionId: string; sourcePath: string; revision: number; layers: Array<{ sessionKey: string; name: string }> };
  return {
    sessionId: body.sessionId,
    sourcePath: body.sourcePath,
    baseRevision: body.revision,
    layers: body.layers.map((layer) => ({ layerId: layer.sessionKey, name: layer.name })),
  };
}

test("installed CLI bridge selects one of two live Seatify editors and cleans up safely", async ({ browser }) => {
  test.setTimeout(120_000);
  const registryPackageVersion = process.env.REGISTRY_PACKAGE_VERSION;
  const root = await mkdtemp(path.join(os.tmpdir(), "lineage-installed-bridge-"));
  const pack = path.join(root, "pack");
  const consumer = path.join(root, "consumer");
  const registry = path.join(root, "registry");
  const workspaceA = path.join(root, "Seatify Alpha");
  const workspaceB = path.join(root, "Seatify Beta");
  const running: RunningEditor[] = [];
  const auxiliary: RunningCommand[] = [];
  const contexts: BrowserContext[] = [];
  try {
    await mkdir(consumer);
    let packageSpecifier = "";
    if (registryPackageVersion) {
      packageSpecifier = `lineage-logo@${registryPackageVersion}`;
    } else {
      await mkdir(pack);
      expect((await command("npm", ["pack", "--json", "--pack-destination", pack])).code).toBe(0);
      const tarball = (await readdir(pack)).find((name) => name.endsWith(".tgz"));
      expect(tarball).toBeTruthy();
      packageSpecifier = path.join(pack, tarball!);
    }
    await writeFile(path.join(consumer, "package.json"), JSON.stringify({ private: true }));
    expect((await command("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--registry=https://registry.npmjs.org", packageSpecifier], process.env, consumer)).code).toBe(0);
    if (registryPackageVersion) {
      const lockfile = JSON.parse(await readFile(path.join(consumer, "package-lock.json"), "utf8")) as { packages?: Record<string, { resolved?: unknown; version?: unknown }> };
      expect(lockfile.packages?.["node_modules/lineage-logo"]).toMatchObject({
        version: registryPackageVersion,
        resolved: `https://registry.npmjs.org/lineage-logo/-/lineage-logo-${registryPackageVersion}.tgz`,
      });
    }
    const bin = path.join(consumer, "node_modules/.bin/lineage-logo");
    const installedPackage = JSON.parse(await readFile(path.join(consumer, "node_modules", "lineage-logo", "package.json"), "utf8")) as { version?: unknown };
    expect(installedPackage.version).toEqual(expect.any(String));
    const installedPackageVersion = installedPackage.version as string;
    if (registryPackageVersion) expect(installedPackageVersion).toBe(registryPackageVersion);
    const capabilities = registryPackageVersion
      ? installedVersionCapabilities(installedPackageVersion)
      : { publicOnboarding: true, publicRouting: true };
    const installedFixture = await readFile(path.join(consumer, "node_modules", "lineage-logo", "examples", "seatify-constellation.svg"), "utf8");
    const env = { ...process.env, LINEAGE_LOGO_REGISTRY_DIR: registry };

    if (capabilities.publicOnboarding) {
      expect((await command(bin, ["example", "seatify", "--workspace", workspaceA], env)).code).toBe(0);
      expect((await command(bin, ["example", "seatify", "--workspace", workspaceB], env)).code).toBe(0);
    } else {
      await Promise.all([workspaceA, workspaceB].map(async (workspace) => {
        await mkdir(path.join(workspace, "concepts"), { recursive: true });
        await writeFile(path.join(workspace, "concepts", "seatify-constellation.svg"), installedFixture);
      }));
    }
    expect(await readFile(path.join(workspaceA, "concepts", "seatify-constellation.svg"), "utf8")).toBe(installedFixture);
    expect(await readFile(path.join(workspaceB, "concepts", "seatify-constellation.svg"), "utf8")).toBe(installedFixture);

    const help = await command(bin, ["--help"], env);
    const version = await command(bin, ["--version"], env);
    expect(help).toMatchObject({ code: 0, stderr: "" });
    expect(help.stdout).toContain("Usage: lineage-logo");
    expect(version).toEqual({ code: 0, stdout: `${installedPackageVersion}\n`, stderr: "" });

    const [portA, portB] = await Promise.all([availablePort(), availablePort()]);
    if (portA === portB) throw new Error("Test ports must be distinct.");
    running.push(await startEditor(bin, workspaceA, registry, portA));
    running.push(await startEditor(bin, workspaceB, registry, portB));
    const entries = await poll(async () => {
      const current = await readAgentInstanceRegistry(registry).catch(() => []);
      return current.length === 2 ? current : undefined;
    });
    const [identityA, identityB] = await Promise.all([identifyWorkspace(workspaceA), identifyWorkspace(workspaceB)]);
    const entryA = entries.find((entry) => entry.workspaceId === identityA.workspaceId)!;
    const entryB = entries.find((entry) => entry.workspaceId === identityB.workspaceId)!;
    expect(entryA).toBeTruthy();
    expect(entryB).toBeTruthy();
    running[0].serverPid = entryA.pid;
    running[1].serverPid = entryB.pid;

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    contexts.push(contextA, contextB);
    const pageA = await openSeatify(contextA, running[0].url);
    const pageB = await openSeatify(contextB, running[1].url);
    const documentA = capabilities.publicRouting ? await publicContext(bin, workspaceA, env) : await installedManifest(entryA);
    const target = documentA.layers.find((layer) => layer.name === "Seatify title");
    expect(target).toBeTruthy();
    const proposal = path.join(root, "selection.json");
    await writeFile(proposal, JSON.stringify({
      protocolVersion: 1, transactionId: "installed-seatify-selection", producer: { kind: "test", name: "installed bridge" },
      document: capabilities.publicRouting
        ? { sessionId: documentA.sessionId, baseRevision: documentA.baseRevision }
        : { sessionId: documentA.sessionId, sourcePath: documentA.sourcePath!, baseRevision: documentA.baseRevision },
      operations: [{ type: "selectFocus", operationId: "focus", targets: [{ sessionKey: target!.layerId }] }],
    }));
    const artifact = path.join(workspaceA, "concepts/seatify-constellation.svg");

    const ambiguous = capabilities.publicRouting ? await command(bin, ["submit", "--artifact", artifact, "--proposal", proposal, "--json", "--quiet"], env) : undefined;
    if (ambiguous) {
      expect(ambiguous.code).toBe(3);
      expect(JSON.parse(ambiguous.stdout)).toMatchObject({ schemaVersion: 1, command: "submit", ok: false, status: "not_found" });
    }

    const byWorkspace = await command(bin, ["doctor", "--workspace", workspaceA, "--json"], env);
    const byInstance = await command(bin, ["doctor", "--instance", entryB.instanceId, "--json"], env);
    expect(byWorkspace.code).toBe(0);
    expect(byInstance.code).toBe(0);
    expect(JSON.parse(byWorkspace.stdout)).toMatchObject({ ok: true, status: "ok" });
    expect(JSON.parse(byInstance.stdout)).toMatchObject({ ok: true, status: "ok" });

    let routed: RunningCommand | undefined;
    if (capabilities.publicRouting) {
      routed = startCommand(bin, ["submit", "--artifact", artifact, "--proposal", proposal, "--workspace", workspaceA, "--json", "--quiet"], env);
      auxiliary.push(routed);
      await expect(pageA.locator(".layer-button[aria-pressed='true']")).toHaveCount(1);
      await expect(pageA.locator(".layer-button[aria-pressed='true']")).toContainText("Seatify title");
      await expect(pageB.locator(".layer-button[aria-pressed='true']")).toHaveCount(0);
      await stopCommand(routed);
    }

    const sourceA = await readFile(artifact, "utf8");
    const mutatingManifestA = capabilities.publicRouting ? await publicContext(bin, workspaceA, env) : await installedManifest(entryA);
    const titleA = mutatingManifestA.layers.find((layer) => layer.name === "Seatify title");
    expect(titleA).toBeTruthy();
    const acceptedProposal = path.join(root, "accepted.json");
    await writeFile(acceptedProposal, JSON.stringify({
      protocolVersion: 1, transactionId: "installed-seatify-accepted", producer: { kind: "test", name: "installed bridge" },
      document: capabilities.publicRouting
        ? { sessionId: mutatingManifestA.sessionId, baseRevision: mutatingManifestA.baseRevision }
        : { sessionId: mutatingManifestA.sessionId, sourcePath: mutatingManifestA.sourcePath!, baseRevision: mutatingManifestA.baseRevision },
      operations: [{ type: "renameLayer", operationId: "rename-accepted", target: { sessionKey: titleA!.layerId }, name: "Installed accepted title" }],
    }));
    const accepted = startCommand(bin, ["submit", "--artifact", artifact, "--proposal", acceptedProposal, "--workspace", workspaceA, "--json", "--quiet"], env);
    auxiliary.push(accepted);
    const acceptedReviewSummary = pageA.locator("#agent-review-summary");
    await expect(acceptedReviewSummary).toBeVisible();
    await expect(acceptedReviewSummary).toContainText("1 operation: 1 document change");
    await expect(pageA.locator("#agent-accept")).toBeVisible();
    await pageA.locator("#agent-accept").click();
    await expect(pageA.locator("#agent-review-status")).toHaveText("Saved");
    const acceptedResult = await finishCommand(accepted);
    expect(acceptedResult.code).toBe(0);
    const acceptedReceipt = JSON.parse(acceptedResult.stdout) as {
      schemaVersion: number; command: string; ok: boolean; status: string;
      artifact: { path: string; digest: string };
    };
    expect(acceptedReceipt).toMatchObject({ schemaVersion: 1, command: "submit", ok: true, status: "ok" });
    expect(acceptedReceipt.artifact.path).toMatch(/^iterations\/seatify-constellation-agent-[a-f0-9]{16}\.svg$/);
    expect(acceptedReceipt.artifact.digest).toMatch(/^[a-f0-9]{64}$/);
    const savedA = await readFile(path.join(workspaceA, acceptedReceipt.artifact.path), "utf8");
    expect(savedA).toContain('aria-label="Installed accepted title"');
    expect(savedA).not.toContain("data-lineage-");
    expect(await readFile(artifact, "utf8")).toBe(sourceA);

    await contextA.close();
    await stopEditor(running[0]);
    const restartPort = await availablePort();
    const restarted = await startEditor(bin, workspaceA, registry, restartPort);
    running.push(restarted);
    const restartedContext = await browser.newContext();
    contexts.push(restartedContext);
    const reopened = await openSeatify(restartedContext, restarted.url, acceptedReceipt.artifact.path);
    await expect(reopened.getByRole("button", { name: "text Installed accepted title" })).toBeVisible();
    expect(await readFile(artifact, "utf8")).toBe(sourceA);
    await reopened.close();
    await restartedContext.close();
    await stopEditor(restarted);

    const artifactB = path.join(workspaceB, "concepts/seatify-constellation.svg");
    const sourceB = await readFile(artifactB, "utf8");
    const mutatingManifestB = capabilities.publicRouting ? await publicContext(bin, workspaceB, env) : await installedManifest(entryB);
    const titleB = mutatingManifestB.layers.find((layer) => layer.name === "Seatify title");
    expect(titleB).toBeTruthy();
    const revertedProposal = path.join(root, "reverted.json");
    await writeFile(revertedProposal, JSON.stringify({
      protocolVersion: 1, transactionId: "installed-seatify-reverted", producer: { kind: "test", name: "installed bridge" },
      document: capabilities.publicRouting
        ? { sessionId: mutatingManifestB.sessionId, baseRevision: mutatingManifestB.baseRevision }
        : { sessionId: mutatingManifestB.sessionId, sourcePath: mutatingManifestB.sourcePath!, baseRevision: mutatingManifestB.baseRevision },
      operations: [{ type: "renameLayer", operationId: "rename-reverted", target: { sessionKey: titleB!.layerId }, name: "Must not persist" }],
    }));
    const reverted = startCommand(bin, ["submit", "--artifact", artifactB, "--proposal", revertedProposal, "--instance", entryB.instanceId, "--json", "--quiet"], env);
    auxiliary.push(reverted);
    const revertedReviewSummary = pageB.locator("#agent-review-summary");
    await expect(revertedReviewSummary).toBeVisible();
    await expect(revertedReviewSummary).toContainText("1 operation: 1 document change");
    await expect(pageB.locator("#agent-revert")).toBeVisible();
    await pageB.locator("#agent-revert").click();
    await expect(pageB.locator("#agent-review-status")).toHaveText("reverted");
    const revertedResult = await finishCommand(reverted);
    expect(revertedResult.code).toBe(5);
    expect(JSON.parse(revertedResult.stdout)).toMatchObject({ schemaVersion: 1, command: "submit", ok: false, status: "rejected" });
    expect(await readFile(artifactB, "utf8")).toBe(sourceB);
    expect(await readdir(path.join(workspaceB, "iterations")).catch(() => [])).toEqual([]);

    const publicOutput = [help, version, ambiguous, byWorkspace, byInstance, routed, acceptedResult, revertedResult, ...running]
      .filter((item): item is Exclude<typeof item, undefined> => item !== undefined)
      .map((item) => `${item.stdout}${item.stderr}`).join("\n");
    const forbidden = [root, registry, workspaceA, workspaceB, entryA.token, entryB.token];
    expect(forbidden.some((value) => publicOutput.includes(value))).toBe(false);
    expect(publicOutput.includes("<svg")).toBe(false);
    expect(running.every((editor) => /^http:\/\/lineage-logo\.localhost:\d+$/.test(editor.url))).toBe(true);

    await poll(async () => {
      const current = await readAgentInstanceRegistry(registry);
      return current.length === 1 && current[0].instanceId === entryB.instanceId ? true : undefined;
    });
    expect((await command(bin, ["doctor", "--instance", entryB.instanceId, "--json"], env)).code).toBe(0);
    await contextB.close();
    await stopEditor(running[1]);
    await poll(async () => (await readAgentInstanceRegistry(registry)).length === 0 ? true : undefined);
  } finally {
    await Promise.allSettled(contexts.map((context) => context.close()));
    await Promise.allSettled(auxiliary.map(stopCommand));
    await Promise.allSettled(running.map(stopEditor));
    const registered = await readAgentInstanceRegistry(registry).catch(() => []);
    const knownServerPids = new Set(running.map((editor) => editor.serverPid).filter((pid): pid is number => pid !== undefined));
    for (const entry of registered) {
      if (!knownServerPids.has(entry.pid)) {
        try { process.kill(entry.pid, "SIGTERM"); } catch {}
      }
    }
    await rm(root, { recursive: true, force: true });
    const remains = await access(root).then(() => true).catch(() => false);
    expect(remains).toBe(false);
  }
});

test("installed structural artifact and narrow follow-up preserve manual edits through save and restart", async ({ browser }) => {
  test.setTimeout(120_000);
  const root = await mkdtemp(path.join(os.tmpdir(), "lineage-installed-structural-"));
  const consumer = path.join(root, 'consumer'); const workspace = path.join(root, 'workspace'); const registry = path.join(root, 'registry');
  const running: RunningEditor[] = []; const commands: RunningCommand[] = []; const contexts: BrowserContext[] = [];
  try {
    await mkdir(consumer); await mkdir(path.join(root, 'pack'));
    expect((await command('npm', ['pack', '--json', '--pack-destination', path.join(root, 'pack')])).code).toBe(0);
    const tarball = (await readdir(path.join(root, 'pack'))).find(name => name.endsWith('.tgz'))!;
    await writeFile(path.join(consumer, 'package.json'), '{"private":true}');
    expect((await command('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', path.join(root, 'pack', tarball)], process.env, consumer)).code).toBe(0);
    const bin = path.join(consumer, 'node_modules/.bin/lineage-logo');
    const env = { ...process.env, LINEAGE_LOGO_REGISTRY_DIR: registry };
    expect((await command(bin, ['example', 'seatify', '--workspace', workspace], env)).code).toBe(0);
    const originalPath = path.join(workspace, 'concepts/seatify-constellation.svg'); const original = await readFile(originalPath, 'utf8');
    const editor = await startEditor(bin, workspace, registry, await availablePort()); running.push(editor);
    const context = await browser.newContext(); contexts.push(context);
    const page = await openSeatify(context, editor.url);
    const manifest = await publicContext(bin, workspace, env);
    const artifact = path.join(root, 'logo.svg'); const proposal = path.join(root, 'proposal.json');
    await writeFile(artifact, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><defs><linearGradient id="c3-gradient"><stop offset="0" stop-color="#2244aa"/><stop offset="1" stop-color="#55ccaa"/></linearGradient><mask id="c3-mask"><rect width="160" height="100" fill="white"/></mask><path id="c3-shape" d="M0 0 L50 0 L25 50 Z"/></defs><g id="c3-logo" aria-label="Constructed brand" transform="translate(180 170)"><g id="c3-icon" aria-label="Constructed icon" transform="rotate(12)"><use href="#c3-shape" fill="url(#c3-gradient)" mask="url(#c3-mask)"/></g><text id="c3-tagline" aria-label="Constructed tagline" x="65" y="28" font-size="20">Made for you</text></g></svg>');
    await writeFile(proposal, JSON.stringify({ protocolVersion: 1, transactionId: 'construct-logo', producer: { kind: 'test' }, document: { sessionId: manifest.sessionId, baseRevision: manifest.baseRevision }, operations: [{ type: 'addLayer', operationId: 'construct', parent: null, placement: 'last' }] }));
    const submitted = startCommand(bin, ['submit', '--artifact', artifact, '--group-id', 'c3-logo', '--proposal', proposal, '--workspace', workspace, '--json', '--quiet'], env); commands.push(submitted);
    await expect(page.locator('#agent-review-summary')).toBeVisible();
    expect(await readdir(path.join(workspace, 'iterations')).catch(() => [])).toEqual([]);
    await page.locator('#agent-accept').click();
    const result = await finishCommand(submitted); expect(result.code).toBe(0);
    const receipt = JSON.parse(result.stdout); const firstSaved = await readFile(path.join(workspace, receipt.artifact.path), 'utf8');
    const { createHash } = await import('node:crypto');
    expect(createHash('sha256').update(firstSaved).digest('hex')).toBe(receipt.artifact.digest);
    expect(firstSaved).toContain('id="c3-logo"'); expect(firstSaved).toContain('id="c3-gradient"');
    await page.locator('#undo').click(); await expect(page.locator('#artboard #c3-logo')).toHaveCount(0);
    await page.locator('#redo').click(); await expect(page.locator('#artboard #c3-logo')).toHaveCount(1);
    await page.locator('.layer-button').filter({ hasText: 'Constructed tagline' }).click();
    if (await page.locator('#text-group').getAttribute('open') === null) await page.locator('#text-group summary').click();
    await expect(page.locator('#text-content')).toBeVisible();
    await page.locator('#text-content').fill('Manually refined'); await page.locator('#text-content').press('Enter');
    await expect(page.locator('#artboard #c3-tagline')).toHaveText('Manually refined');
    const snapshotResult = await command(bin, ['snapshot', '--workspace', workspace, '--json'], env); expect(snapshotResult.code).toBe(0);
    const snapshot = JSON.parse(snapshotResult.stdout).snapshot;
    expect(snapshot.svg).toContain('Manually refined'); expect(createHash('sha256').update(snapshot.svg).digest('hex')).toBe(snapshot.digest);
    const icon = snapshot.layers.find((layer: { svgId: string }) => layer.svgId === 'c3-icon');
    const title = snapshot.layers.find((layer: { name: string }) => layer.name === 'Seatify title');
    const iconRootPosition = () => page.locator('#artboard #c3-icon').evaluate((element) => {
      const node = element as SVGGraphicsElement;
      const root = node.ownerSVGElement!;
      const relative = root.getScreenCTM()!.inverse().multiply(node.getScreenCTM()!);
      const box = node.getBBox();
      const point = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(relative);
      return { x: point.x, y: point.y };
    });
    const iconBefore = await iconRootPosition();
    const tagline = snapshot.layers.find((layer: { svgId: string }) => layer.svgId === 'c3-tagline');
    await writeFile(proposal, JSON.stringify({ protocolVersion: 1, transactionId: 'narrow-followup', producer: { kind: 'test' }, document: { sessionId: snapshot.sessionId, baseRevision: snapshot.baseRevision }, operations: [
      { type: 'translateLayer', operationVersion: 1, operationId: 'move', target: { sessionKey: icon.layerId }, dx: 4, dy: -2 },
      { type: 'setText', operationVersion: 1, operationId: 'title-text', target: { sessionKey: title.layerId }, value: 'Seatify refreshed' },
      { type: 'setPaint', operationId: 'paint', target: { sessionKey: tagline.layerId }, property: 'fill', value: '#2255aa' },
    ] }));
    const followup = startCommand(bin, ['submit', '--proposal', proposal, '--workspace', workspace, '--json', '--quiet'], env); commands.push(followup);
    await expect(page.locator('#agent-accept')).toBeVisible(); await page.locator('#agent-accept').click();
    const finalResult = await finishCommand(followup); expect(finalResult.code).toBe(0); const finalReceipt = JSON.parse(finalResult.stdout);
    const finalSvg = await readFile(path.join(workspace, finalReceipt.artifact.path), 'utf8');
    expect(createHash('sha256').update(finalSvg).digest('hex')).toBe(finalReceipt.artifact.digest);
    expect(finalSvg).toContain('Seatify refreshed');
    const iconAfter = await iconRootPosition();
    expect(iconAfter.x - iconBefore.x).toBeCloseTo(4, 4); expect(iconAfter.y - iconBefore.y).toBeCloseTo(-2, 4);
    expect(finalSvg).toContain('Manually refined'); expect(finalSvg).toContain('matrix(1,0,0,1,4,-2) rotate(12)'); expect(finalSvg).not.toContain('data-lineage-');
    await page.locator('#undo').click(); await expect(page.locator('#artboard #c3-icon')).toHaveAttribute('transform', 'rotate(12)');
    await expect(page.locator('#artboard #c3-tagline')).toHaveText('Manually refined'); await expect(page.locator('#artboard #c3-tagline')).not.toHaveAttribute('fill', '#2255aa');
    await page.locator('#redo').click(); await expect(page.locator('#artboard #c3-tagline')).toHaveAttribute('fill', '#2255aa');
    await context.close(); await stopEditor(editor);
    const restarted = await startEditor(bin, workspace, registry, await availablePort()); running.push(restarted);
    const reopenedContext = await browser.newContext(); contexts.push(reopenedContext);
    const reopened = await openSeatify(reopenedContext, restarted.url, finalReceipt.artifact.path);
    await expect(reopened.locator('#artboard #c3-tagline')).toHaveText('Manually refined');
    await expect(reopened.locator('#artboard #c3-icon')).toHaveAttribute('transform', 'matrix(1,0,0,1,4,-2) rotate(12)');
    expect(await readFile(originalPath, 'utf8')).toBe(original);
    expect(await readFile(path.join(workspace, finalReceipt.artifact.path), 'utf8')).toBe(finalSvg);
  } finally {
    await Promise.allSettled(contexts.map(context => context.close()));
    await Promise.allSettled(commands.map(stopCommand)); await Promise.allSettled(running.map(stopEditor));
    await rm(root, { recursive: true, force: true });
  }
});
