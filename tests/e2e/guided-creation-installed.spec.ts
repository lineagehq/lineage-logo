import { createHash } from "node:crypto";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test, expect, type Page } from "@playwright/test";
import type { AgentHandoff } from "../../src/shared/agent-handoff";

const exec = promisify(execFile);
type Running = { child: ChildProcess; output: () => string };
function start(bin: string, args: string[], env: NodeJS.ProcessEnv): Running {
  const child = spawn(bin, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.stdout!.on("data", data => { output += String(data); });
  return { child, output: () => output };
}
async function stop(run: Running) {
  if (run.child.exitCode !== null || run.child.signalCode !== null) return;
  run.child.kill("SIGTERM");
  await Promise.race([once(run.child, "exit"), new Promise(resolve => setTimeout(resolve, 3000))]);
  if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill("SIGKILL");
}
async function freePort() {
  const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  server.close(); await once(server, "close"); return port;
}
async function handoff(page: Page, destination: string, intent: string, target = "Whole document"): Promise<AgentHandoff> {
  await page.getByRole("button", { name: "Prepare agent handoff", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Prepare an agent handoff", exact: true });
  await dialog.getByRole("combobox", { name: "Target", exact: true }).selectOption({ label: target });
  await dialog.getByLabel("What should change?", { exact: true }).fill(intent);
  await dialog.getByRole("button", { name: "Prepare current handoff", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Includes current unsaved artwork");
  const downloaded = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download handoff JSON", exact: true }).click();
  await (await downloaded).saveAs(destination);
  const result = JSON.parse(await readFile(destination, "utf8")) as AgentHandoff;
  expect(createHash("sha256").update(result.snapshot.svg).digest("hex")).toBe(result.snapshot.digest);
  expect(result.instructions).toContain("No agent was invoked");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  return result;
}

test("packed empty-workspace UI creates, safely imports and hands off current edits through two reviewed CLI proposals", async ({ browser }) => {
  test.setTimeout(150_000);
  const root = await mkdtemp(path.join(tmpdir(), "lineage-guided-installed-"));
  const workspace = path.join(root, "workspace"), consumer = path.join(root, "consumer"), pack = path.join(root, "pack");
  const running: Running[] = [];
  const context = await browser.newContext({ acceptDownloads: true });
  context.setDefaultTimeout(15_000);
  const env = { ...process.env, LINEAGE_LOGO_REGISTRY_DIR: path.join(root, "registry") };
  try {
    await Promise.all([workspace, consumer, pack].map(directory => mkdir(directory)));
    await exec("npm", ["pack", "--json", "--pack-destination", pack], { maxBuffer: 10 * 1024 * 1024 });
    const tarball = (await readdir(pack)).find(name => name.endsWith(".tgz"))!;
    await writeFile(path.join(consumer, "package.json"), '{"private":true}');
    await exec("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", path.join(pack, tarball)], { cwd: consumer });
    const installedDocs = await readFile(path.join(consumer, "node_modules/lineage-logo/docs/public-beta/agent-handoff.md"), "utf8");
    expect(installedDocs).toContain("Prepare agent handoff"); expect(installedDocs).toContain("--group-id proposed-logo");
    const bin = path.join(consumer, "node_modules/.bin/lineage-logo");
    const launch = async () => {
      const port = await freePort(), url = `http://lineage-logo.localhost:${port}`;
      const server = start(bin, ["launch", "--workspace", workspace, "--port", String(port), "--no-open"], env); running.push(server);
      await expect.poll(() => server.output(), { timeout: 20000 }).toContain(url);
      await expect.poll(async () => fetch(url).then(response => response.status).catch(() => 0)).toBe(200);
      return { server, url };
    };
    const first = await launch(); const page = await context.newPage(); await page.goto(first.url);
    expect(await readdir(workspace)).toEqual([]);
    for (const endpoint of ["/api/concepts", "/api/agent/handoff"]) {
      const refused = await page.request.post(first.url + endpoint, { headers: { Origin: "https://unrelated.example" }, data: { name: "must-not-create" } });
      expect(refused.status()).toBe(403);
    }
    expect(await readdir(workspace)).toEqual([]);
    await page.getByRole("button", { name: "Create a logo", exact: true }).click();
    await page.getByRole("dialog", { name: "Create a logo", exact: true }).getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await readdir(workspace)).toEqual([]);
    await page.getByRole("button", { name: "Create a logo", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "Create a logo", exact: true });
    await dialog.getByLabel("Logo name", { exact: true }).fill("my-logo");
    await dialog.getByRole("button", { name: "Create blank logo", exact: true }).click();
    await expect(page.locator("#artboard svg #logo")).toHaveCount(1);
    const blankPath = path.join(workspace, "concepts/my-logo.svg"), blank = await readFile(blankPath, "utf8");
    await page.getByRole("button", { name: "Import SVG", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Import an SVG", exact: true });
    await dialog.getByLabel("SVG file (up to 5 MB)", { exact: true }).setInputFiles({ name: "my-logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>window.bad=true</script></svg>') });
    await dialog.getByRole("button", { name: "Import SVG", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("unsupported active or external content");
    expect(await readdir(path.join(workspace, "concepts"))).toEqual(["my-logo.svg"]);
    const imported = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><text id="wordmark" aria-label="Brand wordmark" x="50" y="300" font-size="30">Starting brand</text></svg>';
    await dialog.getByLabel("SVG file (up to 5 MB)", { exact: true }).setInputFiles({ name: "my-logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from(imported) });
    await dialog.getByRole("button", { name: "Import SVG", exact: true }).click();
    await expect(page.locator("#artboard #wordmark")).toHaveText("Starting brand");
    const originalPath = path.join(workspace, "concepts/my-logo-2.svg"); expect(await readFile(originalPath, "utf8")).toBe(imported);
    const initial = await handoff(page, path.join(root, "initial.json"), "Add a blue circular mark, preserving the wordmark.");
    expect(initial.sourcePath).toBe("concepts/my-logo-2.svg");
    const artifact = path.join(root, "artifact.svg"), proposal = path.join(root, "proposal.json");
    await writeFile(artifact, '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="brand-paint"><stop stop-color="#2244aa"/><stop offset="1" stop-color="#44aacc"/></linearGradient></defs><g id="proposed-logo" aria-label="Brand mark"><circle id="brand-circle" cx="150" cy="150" r="60" fill="url(#brand-paint)"/></g></svg>');
    const submit = async (binding: AgentHandoff, transactionId: string, operations: unknown[], withArtifact: boolean) => {
      await writeFile(proposal, JSON.stringify({ protocolVersion: 1, transactionId, producer: { kind: "test" }, document: { sessionId: binding.snapshot.sessionId, baseRevision: binding.snapshot.baseRevision }, operations }));
      const command = start(bin, ["submit", "--instance", binding.snapshot.instanceId, "--proposal", proposal, ...(withArtifact ? ["--artifact", artifact, "--group-id", "proposed-logo"] : []), "--json", "--quiet"], env); running.push(command);
      await expect(page.locator("#agent-accept")).toBeVisible(); await page.locator("#agent-accept").click();
      await expect.poll(() => command.child.exitCode, { timeout: 20000 }).toBe(0);
      const receipt = JSON.parse(command.output());
      const saved = await readFile(path.join(workspace, receipt.artifact.path), "utf8");
      expect(createHash("sha256").update(saved).digest("hex")).toBe(receipt.artifact.digest);
      return { receipt, saved };
    };
    const constructed = await submit(initial, "guided-construct", [{ type: "addLayer", operationId: "add-mark", parent: null, placement: "last" }], true);
    expect(constructed.saved).toContain('id="brand-paint"'); expect(constructed.saved).toContain("Starting brand");
    await page.locator(".layer-button").filter({ hasText: "Brand wordmark" }).click();
    if (await page.locator("#text-group").getAttribute("open") === null) await page.locator("#text-group summary").click();
    await page.locator("#text-content").fill("Manual correction"); await page.locator("#text-content").press("Enter");
    await expect(page.locator("#artboard #wordmark")).toHaveText("Manual correction");
    expect(await readFile(path.join(workspace, constructed.receipt.artifact.path), "utf8")).toBe(constructed.saved);
    const corrected = await handoff(page, path.join(root, "corrected.json"), "Change only the selected wordmark's fill to dark blue.", "Selected layers");
    expect(corrected.snapshot.svg).toContain("Manual correction"); expect(corrected.snapshot.selectedLayerIds).toHaveLength(1);
    const final = await submit(corrected, "guided-followup", [{ type: "setPaint", operationId: "wordmark-paint", target: { sessionKey: corrected.snapshot.selectedLayerIds[0] }, property: "fill", value: "#2255aa" }], false);
    expect(final.saved).toContain("Manual correction"); expect(final.saved).toContain("#2255aa");
    await page.close(); await stop(first.server);
    const restarted = await launch(); const reopened = await context.newPage(); await reopened.goto(restarted.url);
    await reopened.locator(".file-button").filter({ hasText: path.basename(final.receipt.artifact.path, ".svg") }).click();
    await expect(reopened.locator("#artboard #wordmark")).toHaveText("Manual correction");
    await expect(reopened.locator("#artboard #wordmark")).toHaveAttribute("fill", "#2255aa");
    expect(await readFile(originalPath, "utf8")).toBe(imported); expect(await readFile(blankPath, "utf8")).toBe(blank);
    expect(await readFile(path.join(workspace, final.receipt.artifact.path), "utf8")).toBe(final.saved);
  } finally {
    await context.close(); await Promise.allSettled(running.map(stop)); await rm(root, { recursive: true, force: true });
  }
});
