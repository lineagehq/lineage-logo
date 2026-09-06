import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import type { AgentSnapshot } from "../../src/shared/agent-snapshot";
const execute = promisify(execFile);

test("installed snapshot captures unsaved styled id-less artwork without changing selection, history or files", async ({ browser }) => {
  test.setTimeout(120000);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "lineage-snapshot-installed-"));
  let child: ChildProcess | undefined;
  const context = await browser.newContext();
  try {
    const consumer = path.join(temporary, "consumer"), workspace = path.join(temporary, "private-workspace"), pack = path.join(temporary, "pack");
    await Promise.all([consumer, workspace, pack].map(p => mkdir(p)));
    const original = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><style>.mark{fill:url(#paint)}</style><defs><linearGradient id="paint"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><g id="logo"><rect class="mark" fill="url(#paint)" aria-label="Snapshot rectangle" x="30" y="20" width="60" height="40"/></g><rect id="hidden-mark" display="none" width="10" height="10"/></svg>';
    await mkdir(path.join(workspace, "concepts"));
    await writeFile(path.join(workspace, "concepts/logo.svg"), original);
    await execute("npm", ["pack", "--json", "--pack-destination", pack], { maxBuffer: 10 * 1024 * 1024 });
    const tarball = (await readdir(pack)).find(p => p.endsWith(".tgz"))!;
    await writeFile(path.join(consumer, "package.json"), '{"private":true}');
    await execute("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", path.join(pack, tarball)], { cwd: consumer });
    const bin = path.join(consumer, "node_modules/.bin/lineage-logo");
    const env = { ...process.env, LINEAGE_LOGO_REGISTRY_DIR: path.join(temporary, "registry") };
    const socket = createServer(); socket.listen(0, "127.0.0.1"); await once(socket, "listening");
    const port = (socket.address() as { port: number }).port; await new Promise<void>(resolve => socket.close(() => resolve()));
    child = spawn(bin, ["launch", "--workspace", workspace, "--port", String(port), "--no-open"], { env, stdio: "ignore" });
    const url = `http://lineage-logo.localhost:${port}`;
    await expect.poll(() => fetch(url).then(r => r.status).catch(() => 0), { timeout: 20000 }).toBe(200);
    const page = await context.newPage(); page.setDefaultTimeout(10000); const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    await page.goto(url);
    await page.locator('[data-path="concepts/logo.svg"]').click();
    const rect = page.locator("#artboard svg #logo rect"); await expect(rect).toBeVisible();
    await page.locator(".layer-button").filter({ has: page.locator(".layer-type + span", { hasText: /^Snapshot rectangle$/ }) }).click();
    // Use the mounted inspector to create a real unsaved edit.
    await page.locator("#geometry-group > summary").click();
    const x = page.locator("#position-x"); await expect(x).toBeEnabled();
    await x.fill("47"); await x.press("Enter");
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
    const key = await rect.getAttribute("data-lineage-key");
    const before = await rect.evaluate(node => node.outerHTML);
    const publicContext = await execute(bin, ["context", "--workspace", workspace, "--json"], { env });
    expect(publicContext.stdout).not.toMatch(/<svg|sourcePath|private-workspace|token/);
    const result = await execute(bin, ["snapshot", "--workspace", workspace, "--json"], { env, maxBuffer: 15 * 1024 * 1024 });
    const snapshot = JSON.parse(result.stdout).snapshot as AgentSnapshot;
    expect(snapshot.digest).toBe(createHash("sha256").update(snapshot.svg).digest("hex"));
    expect(snapshot.svg).toContain("<style>"); expect(snapshot.svg).toContain("linearGradient");
    expect(snapshot.svg).not.toContain("data-lineage-key");
    expect(snapshot.selectedLayerIds).toEqual([key]); expect(snapshot.primaryLayerId).toBe(key);
    const layer = snapshot.layers.find(layer => layer.layerId === key)!;
    expect(layer.svgId).toBeNull(); expect(layer.parentLayerId).toBeTruthy();
    expect(layer.paint.fill.computed).toBe("url(#paint)"); expect(layer.bounds.status).toBe("available");
    expect(snapshot.layers.find(layer => layer.svgId === "hidden-mark")).toMatchObject({ hidden: true, bounds: { status: "unsupported", reason: "hidden" } });
    expect(snapshot.svg).not.toBe(original);
    expect(result.stdout).not.toMatch(/sourcePath|private-workspace|private-token/);
    expect(await rect.evaluate(node => node.outerHTML)).toBe(before);
    expect(await readFile(path.join(workspace, "concepts/logo.svg"), "utf8")).toBe(original);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    await page.locator("#lock-selection").click();
    const lockedResult = await execute(bin, ["snapshot", "--workspace", workspace, "--json"], { env, maxBuffer: 15 * 1024 * 1024 });
    const lockedSnapshot = JSON.parse(lockedResult.stdout).snapshot as AgentSnapshot;
    expect(lockedSnapshot.layers.find(layer => layer.layerId === key)?.locked).toBe(true);
    expect(lockedSnapshot.selectedLayerIds).toEqual([key]);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    if (child && child.exitCode === null) { child.kill("SIGTERM"); await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 5000))]); if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
    await rm(temporary, { recursive: true, force: true });
  }
});
