import { createHash } from "node:crypto";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test, expect, type Page } from "@playwright/test";
import { PNG } from "pngjs";
import { SaxesParser } from "saxes";
import type { AgentHandoff } from "../../src/shared/agent-handoff";

const exec = promisify(execFile);
function inspectExport(svg: string) {
  const ids = new Set<string>(), refs: string[] = [];
  const parser = new SaxesParser({ xmlns: true });
  parser.on("opentag", tag => {
    for (const attribute of Object.values(tag.attributes)) {
      if (attribute.local === "id") { expect(ids.has(attribute.value)).toBe(false); ids.add(attribute.value); }
      for (const match of attribute.value.matchAll(/url\(#([^)]*)\)/g)) refs.push(match[1]);
      if (attribute.local === "href" && attribute.value.startsWith("#")) refs.push(attribute.value.slice(1));
      expect(attribute.name.startsWith("data-lineage-")).toBe(false);
    }
  });
  parser.write(svg).close();
  for (const ref of refs) expect(ids.has(ref)).toBe(true);
  return ids;
}
async function downloadExport(page: Page, destination: string) {
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download export", exact: true }).click();
  await (await downloaded).saveAs(destination);
  return readFile(destination);
}
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

test("packed empty-workspace journey revises agent construction and preserves manual corrections through restart", async ({ browser }, testInfo) => {
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
    const packageSha256 = createHash("sha256").update(await readFile(path.join(pack, tarball))).digest("hex");
    const candidateHead = (await exec("git", ["rev-parse", "HEAD"])).stdout.trim();
    expect(packageSha256).toMatch(/^[a-f0-9]{64}$/);
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
    const imported = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><text id="wordmark" aria-label="Brand wordmark" x="50" y="300" font-family="sans-serif" font-size="30">Starting brand</text></svg>';
    await dialog.getByLabel("SVG file (up to 5 MB)", { exact: true }).setInputFiles({ name: "my-logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from(imported) });
    await dialog.getByRole("button", { name: "Import SVG", exact: true }).click();
    await expect(page.locator("#artboard #wordmark")).toHaveText("Starting brand");
    const originalPath = path.join(workspace, "concepts/my-logo-2.svg"); expect(await readFile(originalPath, "utf8")).toBe(imported);
    // A supported SVG can exceed 5 MiB on the wire after JSON escaping.
    const escapedImport = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><desc>' + "\n".repeat(3 * 1024 * 1024) + '</desc><rect width="10" height="10"/></svg>';
    const expanded = await page.request.post(first.url + "/api/concepts", { headers: { Origin: first.url }, data: { name: "escaped-import", svg: escapedImport } });
    expect(expanded.status()).toBe(201);
    expect(await readFile(path.join(workspace, "concepts/escaped-import.svg"), "utf8")).toBe(escapedImport);
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
    await writeFile(proposal, JSON.stringify({ protocolVersion: 1, transactionId: "guided-first-draft", producer: { kind: "test" }, document: { sessionId: initial.snapshot.sessionId, baseRevision: initial.snapshot.baseRevision }, operations: [{ type: "addLayer", operationId: "add-mark", parent: null, placement: "last" }] }));
    const rejected = start(bin, ["submit", "--instance", initial.snapshot.instanceId, "--proposal", proposal, "--artifact", artifact, "--group-id", "proposed-logo", "--json", "--quiet"], env); running.push(rejected);
    const revisionReason = "Use a smaller circular mark and preserve the wordmark.";
    await page.getByRole("textbox", { name: "Revision request", exact: true }).fill(revisionReason);
    await page.getByRole("button", { name: "Reject and request revision", exact: true }).click();
    await expect.poll(() => rejected.child.exitCode).not.toBeNull();
    expect(JSON.parse(rejected.output()).revisionRequest).toBe(revisionReason);
    await expect(page.locator("#agent-review-status")).toHaveText("reverted");
    await expect(page.locator("#artboard #brand-circle")).toHaveCount(0);
    expect(await readFile(originalPath, "utf8")).toBe(imported);
    const revised = await handoff(page, path.join(root, "revised.json"), revisionReason);
    await writeFile(artifact, (await readFile(artifact, "utf8")).replace('r="60"', 'r="45"'));
    const constructed = await submit(revised, "guided-construct", [{ type: "addLayer", operationId: "add-mark", parent: null, placement: "last" }], true);
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
    // Join the agent/manual journey to finishing using this same accepted artwork.
    await page.locator(".layer-button").filter({ hasText: "Brand wordmark" }).click();
    if (await page.locator("#text-group").getAttribute("open") === null) await page.locator("#text-group summary").click();
    await page.locator("#text-content").fill("Release wordmark"); await page.locator("#text-content").press("Enter");
    await expect(page.locator("#artboard #wordmark")).toHaveText("Release wordmark");
    await expect(page.locator("#lifecycle-state")).toHaveAttribute("data-state", "dirty");
    const selection = await page.locator('.layer-button[aria-pressed="true"]').textContent();
    await expect(page.locator('.file-button[aria-current="true"]')).toHaveAttribute("data-path", final.receipt.artifact.path);
    const versionsBefore = await readdir(path.join(workspace, "iterations"));
    await page.getByRole("button", { name: "Save version / export", exact: true }).click();
    const finishing = page.getByRole("dialog", { name: "Save a named version or export", exact: true });
    await finishing.getByRole("textbox", { name: "Version name", exact: true }).fill("Release candidate");
    await finishing.getByRole("button", { name: "Save named version", exact: true }).click();
    await expect(finishing.getByRole("status")).toContainText("Named version saved:");
    const addedVersions = (await readdir(path.join(workspace, "iterations"))).filter(name => !versionsBefore.includes(name));
    expect(addedVersions).toHaveLength(1);
    const namedPath = `iterations/${addedVersions[0]}`, namedBytes = await readFile(path.join(workspace, namedPath), "utf8");
    expect(namedBytes).toContain("Release wordmark"); expect(namedBytes).toContain("#2255aa"); inspectExport(namedBytes);
    const exportHashes: Record<string, string> = {};
    for (const [target, name] of [["", "full"], ["proposed-logo", "mark"], ["wordmark", "wordmark"]]) {
      await finishing.getByRole("combobox", { name: "Artwork", exact: true }).selectOption(target);
      await finishing.getByRole("combobox", { name: "Format", exact: true }).selectOption("svg");
      const bytes = await downloadExport(page, path.join(root, `${name}.svg`)), svg = bytes.toString();
      const ids = inspectExport(svg);
      if (name !== "wordmark") { expect(ids.has("brand-circle")).toBe(true); expect(ids.has("brand-paint")).toBe(true); }
      if (name === "mark") expect(svg).not.toContain("Release wordmark");
      else { expect(svg).toContain("Release wordmark"); expect(svg).toContain("#2255aa"); }
      if (name === "wordmark") expect(ids.has("brand-circle")).toBe(false);
      exportHashes[`${name}.svg`] = createHash("sha256").update(bytes).digest("hex");
      await finishing.getByRole("combobox", { name: "Format", exact: true }).selectOption("png");
      for (const size of [16, 32, 64]) for (const background of ["transparent", "white", "black"]) {
        await finishing.getByRole("combobox", { name: "PNG size", exact: false }).selectOption(String(size));
        await finishing.getByRole("combobox", { name: "PNG background", exact: true }).selectOption(background);
        const filename = `${name}-${size}-${background}.png`, pngBytes = await downloadExport(page, path.join(root, filename));
        const png = PNG.sync.read(pngBytes);
        expect([png.width, png.height]).toEqual([size, size]);
        const corner = Array.from(png.data.subarray(0, 4));
        expect(corner).toEqual(background === "transparent" ? [0, 0, 0, 0] : background === "white" ? [255, 255, 255, 255] : [0, 0, 0, 255]);
        const pixels = Array.from({ length: size * size }, (_, index) => Array.from(png.data.subarray(index * 4, index * 4 + 4)));
        // Tiny wordmarks blend into opaque backgrounds; require a blue contribution, not an unblended channel value.
        expect(pixels.filter(([r, , b, a]) => a > 0 && b > r).length, filename).toBeGreaterThan(0);
        if (background === "transparent") {
          expect(pixels.filter(([, , , a]) => a === 0).length).toBeGreaterThan(size);
          if (name === "mark") {
            expect(pixels.filter(([, , , a]) => a === 255).length).toBeGreaterThan(size * size / 3);
            const center = (Math.floor(size / 2) * size + Math.floor(size / 2)) * 4;
            expect(png.data[center + 3]).toBe(255);
          }
        } else expect(pixels.every(([, , , a]) => a === 255)).toBe(true);
        exportHashes[filename] = createHash("sha256").update(pngBytes).digest("hex");
      }
    }
    await finishing.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save version / export", exact: true })).toBeFocused();
    await expect(page.locator("#lifecycle-state")).toHaveAttribute("data-state", "dirty");
    await expect(page.locator('.file-button[aria-current="true"]')).toHaveAttribute("data-path", final.receipt.artifact.path);
    expect(await page.locator('.layer-button[aria-pressed="true"]').textContent()).toBe(selection);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.locator("#artboard #wordmark")).toHaveText("Manual correction");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(page.locator("#artboard #wordmark")).toHaveText("Release wordmark");
    expect(await readFile(path.join(workspace, final.receipt.artifact.path), "utf8")).toBe(final.saved);
    expect(await readFile(path.join(workspace, namedPath), "utf8")).toBe(namedBytes);
    await page.close(); await stop(first.server);
    const restarted = await launch(); const reopened = await context.newPage(); await reopened.goto(restarted.url);
    await reopened.locator(".file-button").filter({ hasText: path.basename(final.receipt.artifact.path, ".svg") }).click();
    await expect(reopened.locator("#artboard #wordmark")).toHaveText("Manual correction");
    await expect(reopened.locator("#artboard #wordmark")).toHaveAttribute("fill", "#2255aa");
    await reopened.locator(`[data-path="${namedPath}"]`).click();
    await expect(reopened.locator("#artboard #wordmark")).toHaveText("Release wordmark");
    await expect(reopened.locator("#artboard #wordmark")).toHaveAttribute("fill", "#2255aa");
    await expect(reopened.locator("#artboard #brand-circle")).toHaveAttribute("r", "45");
    expect(await readFile(path.join(workspace, namedPath), "utf8")).toBe(namedBytes);
    const evidence = { candidateHead, packageSha256, browser: browser.version(), node: process.version, platform: process.platform, namedVersionSha256: createHash("sha256").update(namedBytes).digest("hex"), exportHashes, scope: "Installed agent/manual/named-version/export continuity; not the entire G4 gate" };
    await testInfo.attach("g4-installed-artifacts", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
    if (process.env.LINEAGE_LOGO_G4_RECEIPT) await writeFile(process.env.LINEAGE_LOGO_G4_RECEIPT, JSON.stringify(evidence, null, 2) + "\n");
    expect(await readFile(originalPath, "utf8")).toBe(imported); expect(await readFile(blankPath, "utf8")).toBe(blank);
    expect(await readFile(path.join(workspace, final.receipt.artifact.path), "utf8")).toBe(final.saved);
  } finally {
    await context.close(); await Promise.allSettled(running.map(stop)); await rm(root, { recursive: true, force: true });
  }
});
