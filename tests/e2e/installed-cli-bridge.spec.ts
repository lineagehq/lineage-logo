import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test, type BrowserContext } from "@playwright/test";
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

async function openSeatify(context: BrowserContext, url: string) {
  const page = await context.newPage();
  const streamRequest = page.waitForRequest((request) => request.url().endsWith("/api/agent/events"));
  const streamResponse = page.waitForResponse((response) => response.url().endsWith("/api/agent/events"));
  await page.goto(url);
  const connectedState = page.evaluate(() => new Promise<string>((resolve) => {
    const status = document.querySelector("#status");
    if (!status) throw new Error("Editor status is unavailable.");
    const inspect = () => {
      if (status.textContent === "Agent connection ready") {
        observer.disconnect();
        resolve(status.textContent);
      }
    };
    const observer = new MutationObserver(inspect);
    observer.observe(status, { childList: true, characterData: true, subtree: true });
    inspect();
  }));
  await page.locator('[data-path="concepts/seatify-constellation.svg"]').click();
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
  expect(status).toBe("Agent connection ready");
  await expect(page.locator("#artboard svg[aria-label='Seatify constellation logo']")).toBeVisible();
  return page;
}

async function manifest(entry: AgentInstanceRegistryEntry) {
  const response = await fetch(`${entry.apiOrigin}/api/agent/document`, { headers: {
    Authorization: `Bearer ${entry.token}`,
    "X-Lineage-Instance-ID": entry.instanceId,
    "X-Lineage-Workspace-ID": entry.workspaceId,
  } });
  if (!response.ok) throw new Error("Installed editor manifest is unavailable.");
  return await response.json() as {
    sessionId: string; sourcePath: string; revision: number;
    layers: Array<{ sessionKey: string; name: string }>;
  };
}

test("installed CLI bridge selects one of two live Seatify editors and cleans up safely", async ({ browser }) => {
  test.setTimeout(120_000);
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
    await Promise.all([
      mkdir(pack), mkdir(consumer), mkdir(path.join(workspaceA, "concepts"), { recursive: true }), mkdir(path.join(workspaceB, "concepts"), { recursive: true }),
    ]);
    const canonical = path.join(repositoryRoot, "examples/seatify-constellation.svg");
    await Promise.all([
      copyFile(canonical, path.join(workspaceA, "concepts/seatify-constellation.svg")),
      copyFile(canonical, path.join(workspaceB, "concepts/seatify-constellation.svg")),
    ]);
    expect((await command("npm", ["pack", "--json", "--pack-destination", pack])).code).toBe(0);
    const tarball = (await readdir(pack)).find((name) => name.endsWith(".tgz"));
    expect(tarball).toBeTruthy();
    await writeFile(path.join(consumer, "package.json"), JSON.stringify({ private: true }));
    expect((await command("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", path.join(pack, tarball!)], process.env, consumer)).code).toBe(0);
    const bin = path.join(consumer, "node_modules/.bin/lineage-logo");
    const env = { ...process.env, LINEAGE_LOGO_REGISTRY_DIR: registry };

    const help = await command(bin, ["--help"], env);
    const version = await command(bin, ["--version"], env);
    expect(help).toMatchObject({ code: 0, stderr: "" });
    expect(help.stdout).toContain("Usage: lineage-logo");
    expect(version).toEqual({ code: 0, stdout: "0.1.0-beta.1\n", stderr: "" });

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
    const documentA = await manifest(entryA);
    const target = documentA.layers.find((layer) => layer.name === "Seatify title");
    expect(target).toBeTruthy();
    const proposal = path.join(root, "selection.json");
    await writeFile(proposal, JSON.stringify({
      protocolVersion: 1, transactionId: "installed-seatify-selection", producer: { kind: "test", name: "installed bridge" },
      document: { sessionId: documentA.sessionId, sourcePath: documentA.sourcePath, baseRevision: documentA.revision },
      operations: [{ type: "selectFocus", operationId: "focus", targets: [{ sessionKey: target!.sessionKey }] }],
    }));
    const artifact = path.join(workspaceA, "concepts/seatify-constellation.svg");

    const ambiguous = await command(bin, ["submit", "--artifact", artifact, "--proposal", proposal, "--json", "--quiet"], env);
    expect(ambiguous.code).toBe(3);
    expect(JSON.parse(ambiguous.stdout)).toMatchObject({ schemaVersion: 1, command: "submit", ok: false, status: "not_found" });

    const byWorkspace = await command(bin, ["doctor", "--workspace", workspaceA, "--json"], env);
    const byInstance = await command(bin, ["doctor", "--instance", entryB.instanceId, "--json"], env);
    expect(byWorkspace.code).toBe(0);
    expect(byInstance.code).toBe(0);
    expect(JSON.parse(byWorkspace.stdout)).toMatchObject({ ok: true, status: "ok" });
    expect(JSON.parse(byInstance.stdout)).toMatchObject({ ok: true, status: "ok" });

    const routed = startCommand(bin, ["submit", "--artifact", artifact, "--proposal", proposal, "--workspace", workspaceA, "--json", "--quiet"], env);
    auxiliary.push(routed);
    await expect(pageA.locator(".layer-button[aria-pressed='true']")).toHaveCount(1);
    await expect(pageA.locator(".layer-button[aria-pressed='true']")).toContainText("Seatify title");
    await expect(pageB.locator(".layer-button[aria-pressed='true']")).toHaveCount(0);
    await stopCommand(routed);

    const sourceA = await readFile(artifact, "utf8");
    const mutatingManifestA = await manifest(entryA);
    const titleA = mutatingManifestA.layers.find((layer) => layer.name === "Seatify title");
    expect(titleA).toBeTruthy();
    const acceptedProposal = path.join(root, "accepted.json");
    await writeFile(acceptedProposal, JSON.stringify({
      protocolVersion: 1, transactionId: "installed-seatify-accepted", producer: { kind: "test", name: "installed bridge" },
      document: { sessionId: mutatingManifestA.sessionId, sourcePath: mutatingManifestA.sourcePath, baseRevision: mutatingManifestA.revision },
      operations: [{ type: "renameLayer", operationId: "rename-accepted", target: { sessionKey: titleA!.sessionKey }, name: "Installed accepted title" }],
    }));
    const accepted = startCommand(bin, ["submit", "--artifact", artifact, "--proposal", acceptedProposal, "--workspace", workspaceA, "--json", "--quiet"], env);
    auxiliary.push(accepted);
    await expect(pageA.locator("#agent-review-status")).toHaveText("pending");
    await expect(pageA.locator("#agent-review-summary")).toContainText("1 operation: 1 document change");
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

    const artifactB = path.join(workspaceB, "concepts/seatify-constellation.svg");
    const sourceB = await readFile(artifactB, "utf8");
    const mutatingManifestB = await manifest(entryB);
    const titleB = mutatingManifestB.layers.find((layer) => layer.name === "Seatify title");
    expect(titleB).toBeTruthy();
    const revertedProposal = path.join(root, "reverted.json");
    await writeFile(revertedProposal, JSON.stringify({
      protocolVersion: 1, transactionId: "installed-seatify-reverted", producer: { kind: "test", name: "installed bridge" },
      document: { sessionId: mutatingManifestB.sessionId, sourcePath: mutatingManifestB.sourcePath, baseRevision: mutatingManifestB.revision },
      operations: [{ type: "renameLayer", operationId: "rename-reverted", target: { sessionKey: titleB!.sessionKey }, name: "Must not persist" }],
    }));
    const reverted = startCommand(bin, ["submit", "--artifact", artifactB, "--proposal", revertedProposal, "--instance", entryB.instanceId, "--json", "--quiet"], env);
    auxiliary.push(reverted);
    await expect(pageB.locator("#agent-review-status")).toHaveText("pending");
    await pageB.locator("#agent-revert").click();
    await expect(pageB.locator("#agent-review-status")).toHaveText("reverted");
    const revertedResult = await finishCommand(reverted);
    expect(revertedResult.code).toBe(5);
    expect(JSON.parse(revertedResult.stdout)).toMatchObject({ schemaVersion: 1, command: "submit", ok: false, status: "rejected" });
    expect(await readFile(artifactB, "utf8")).toBe(sourceB);
    expect(await readdir(path.join(workspaceB, "iterations")).catch(() => [])).toEqual([]);

    const publicOutput = [help, version, ambiguous, byWorkspace, byInstance, routed, acceptedResult, revertedResult, ...running]
      .map((item) => `${item.stdout}${item.stderr}`).join("\n");
    const forbidden = [root, registry, workspaceA, workspaceB, entryA.token, entryB.token];
    expect(forbidden.some((value) => publicOutput.includes(value))).toBe(false);
    expect(publicOutput.includes("<svg")).toBe(false);
    expect(running.every((editor) => /^http:\/\/lineage-logo\.localhost:\d+$/.test(editor.url))).toBe(true);

    await contextA.close();
    await stopEditor(running[0]);
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
