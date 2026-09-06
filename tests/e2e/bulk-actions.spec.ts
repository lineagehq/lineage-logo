import { expect, test, type Page } from "@playwright/test";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const token = "lineage-logo-e2e-agent-token";
const sourcePath = "concepts/complex-seatify.svg";
const cross = ["West north seat", "Ticket accent star"];
const siblings = ["West north seat", "West east seat"];
const bulkControls = ["fill", "stroke", "stroke-width", "opacity", "duplicate-selection", "delete-selection", "hide-selection"];
function layer(page: Page, name: string) {
  return page.locator(".layer-button").filter({ has: page.locator(".layer-type + span", { hasText: new RegExp(`^${name}$`) }) });
}
function artwork(page: Page, name: string) { return page.locator(`#artboard [aria-label=${JSON.stringify(name)}]`); }
async function select(page: Page, names: string[]) {
  for (const name of names) await expect(artwork(page, name)).toHaveCount(1);
  const sameParent = await page.locator("#artboard svg").evaluate((root, labels) => {
    const nodes = labels.map((label) => Array.from(root.querySelectorAll("[aria-label]")).find((node) => node.getAttribute("aria-label") === label));
    return nodes.every((node) => node?.parentElement === nodes[0]?.parentElement);
  }, names);
  if (sameParent) {
    await layer(page, names[0]).click();
    for (const name of names.slice(1)) await layer(page, name).click({ modifiers: ["Shift"] });
  } else if (names.every((name) => /^(West north seat|Ticket accent star)( copy)?$/.test(name))) {
    // Layers Shift-click is intentionally sibling-only. Exercise the public
    // Control-marquee workflow for manual cross-parent selection instead.
    await layer(page, "Venue logo").click();
    for (const [index, name] of names.entries()) {
      const target = artwork(page, name);
      await target.scrollIntoViewIfNeeded();
      const box = (await target.boundingBox())!;
      const padding = Math.min(box.width, box.height) * 0.08;
      await page.mouse.move(box.x - padding, box.y - padding);
      await page.keyboard.down("ControlLeft");
      if (index) await page.keyboard.down("ShiftLeft");
      await page.mouse.down();
      await page.mouse.move(box.x + box.width + padding, box.y + box.height + padding, { steps: 8 });
      await page.mouse.up();
      if (index) await page.keyboard.up("ShiftLeft");
      await page.keyboard.up("ControlLeft");
    }
  } else {
    // Overlapping resource artwork uses the documented producer focus API;
    // its acceptance is selection-only and must not manufacture undo history.
    const origin = new URL(page.url()).origin;
    const activePath = await page.locator('.file-button[aria-current="true"]').getAttribute("data-path");
    let manifest: { sessionId: string; sourcePath: string; revision: number; layers: Array<{ name: string; sessionKey: string }> };
    await expect.poll(async () => {
      const response = await page.request.get(`${origin}/api/agent/document`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok()) return undefined;
      manifest = await response.json(); return manifest.sourcePath;
    }).toBe(activePath);
    const targets = names.map((name) => ({ sessionKey: manifest!.layers.find((entry) => entry.name === name)!.sessionKey }));
    const response = await page.request.post(`${origin}/api/agent/transactions`, {
      headers: { Authorization: `Bearer ${token}` }, data: {
        protocolVersion: 1, transactionId: `bulk-focus-${Date.now()}`, producer: { kind: "test", name: "Bulk focus QA" },
        document: { sessionId: manifest!.sessionId, sourcePath: manifest!.sourcePath, baseRevision: manifest!.revision },
        operations: [{ type: "selectFocus", operationId: "focus", targets, primary: targets.at(-1) }],
      },
    });
    expect(response.status()).toBe(202);
    await expect(page.locator("#agent-review-status")).toHaveAttribute("data-status", "accepted");
  }
  await expect(page.locator(".layer-button[aria-pressed='true']")).toHaveCount(names.length);
  await expect.poll(async () => (await page.locator(".layer-button[aria-pressed='true'] .layer-type + span").allTextContents()).sort()).toEqual([...names].sort());
}

async function open(page: Page) {
  await page.goto("/");
  const file = page.locator(`[data-path="${sourcePath}"]`);
  if (await file.getAttribute("aria-current") !== "true") await file.click();
  await expect(artwork(page, "Venue logo")).toBeVisible();
  await expect.poll(async () => {
    const response = await page.request.get("/api/agent/document", { headers: { Authorization: `Bearer ${token}` } });
    return response.ok() ? (await response.json()).sourcePath : undefined;
  }).toBe(sourcePath);
}
async function attrs(page: Page, names: string[]) {
  return Promise.all(names.map((name) => artwork(page, name).evaluate((node) => ({
    fill: node.getAttribute("fill"), stroke: node.getAttribute("stroke"), width: node.getAttribute("stroke-width"),
    opacity: node.getAttribute("opacity"), transform: node.getAttribute("transform"), parent: node.parentElement?.id,
  }))));
}
async function undoOnce(page: Page) {
  await page.locator("#undo").click();
  await expect(page.locator("#undo")).toBeDisabled();
}

for (const [kind, names] of [["siblings", siblings], ["cross-parent", cross]] as const) {
  test(`bulk appearance edits ${kind} atomically with truthful mixed values`, async ({ page }) => {
    await open(page); await select(page, [...names]);
    const before = await attrs(page, [...names]);
    if (kind === "cross-parent") {
      await expect(page.locator("#fill")).toHaveValue("");
      await expect(page.locator("#fill")).toHaveAttribute("placeholder", "Mixed");
      await expect(page.locator("#fill-state")).toContainText("Mixed");
      await expect(page.locator("#paint-summary")).toContainText("Mixed");
    }
    for (const [control, attribute, value] of [["fill", "fill", "#123456"], ["stroke", "stroke", "#abcdef"], ["stroke-width", "stroke-width", "7.5"], ["opacity", "opacity", "0.4"]]) {
      if (control === "stroke-width" || control === "opacity") {
        if (await page.locator("#geometry-group").getAttribute("open") === null) await page.locator("#geometry-group > summary").click();
      }
      await page.locator(`#${control}`).fill(value);
      await page.locator(`#${control}`).press("Tab");
      for (const name of names) await expect(artwork(page, name)).toHaveAttribute(attribute, value);
      await undoOnce(page);
      expect(await attrs(page, [...names])).toEqual(before);
      await expect(page.locator(".layer-button[aria-pressed='true']")).toHaveCount(2);
      await page.locator("#redo").click();
      for (const name of names) await expect(artwork(page, name)).toHaveAttribute(attribute, value);
      await page.locator("#undo").click();
    }
  });
}

test("bulk group paint preserves explicit child paint and invalid edits preserve redo", async ({ page }) => {
  await open(page); await select(page, ["West table cluster", "East table cluster"]);
  await expect(page.locator("#group-paint-help")).toBeVisible();
  const children = await attrs(page, ["West north seat", "East north seat"]);
  await page.locator("#fill").fill("#987654"); await page.locator("#fill").press("Tab");
  for (const name of ["West table cluster", "East table cluster"]) await expect(artwork(page, name)).toHaveAttribute("fill", "#987654");
  expect(await attrs(page, ["West north seat", "East north seat"])).toEqual(children);
  await undoOnce(page);
  await page.locator("#fill").fill("not-a-color");
  await expect(page.locator("#fill-error")).not.toBeEmpty();
  await expect(page.locator("#undo")).toBeDisabled();
  await expect(page.locator("#redo")).toBeEnabled();
  await page.locator("#geometry-group > summary").click();
  await page.locator("#opacity").fill("1.5");
  await expect(page.locator("#opacity")).toHaveAttribute("aria-invalid");
  await expect(page.locator("#undo")).toBeDisabled();
  await expect(page.locator("#redo")).toBeEnabled();
  expect(await attrs(page, ["West north seat", "East north seat"])).toEqual(children);
});

test("bulk hide, duplicate and keyboard delete preserve transformed geometry, hierarchy and one-step undo", async ({ page }) => {
  await open(page); await select(page, cross);
  const before = await attrs(page, cross);
  await page.locator("#hide-selection").click();
  for (const name of cross) await expect(artwork(page, name)).toHaveAttribute("display", "none");
  await undoOnce(page);
  expect(await attrs(page, cross)).toEqual(before);
  const points = async (names: string[]) => Promise.all(names.map((name) => artwork(page, name).evaluate((element) => {
    const node = element as SVGGraphicsElement;
    const root = node.ownerSVGElement!;
    const matrix = root.getScreenCTM()!.inverse().multiply(node.getScreenCTM()!);
    const box = node.getBBox();
    return [new DOMPoint(box.x, box.y), new DOMPoint(box.x + box.width, box.y + box.height)].map((point) => {
      const transformed = point.matrixTransform(matrix); return { x: transformed.x, y: transformed.y };
    });
  })));
  const oldPoints = await points(cross);
  await page.locator("#duplicate-selection").click();
  const copies = cross.map((name) => `${name} copy`);
  for (const name of copies) await expect(artwork(page, name)).toHaveCount(1);
  const newPoints = await points(copies);
  for (let n = 0; n < 2; n++) for (let corner = 0; corner < 2; corner++) for (const axis of ["x", "y"] as const) {
    expect(Math.abs(newPoints[n][corner][axis] - oldPoints[n][corner][axis] - 12)).toBeLessThan(0.5);
  }
  for (let n = 0; n < 2; n++) {
    expect(await artwork(page, copies[n]).evaluate((node) => node.parentElement!.id)).toBe(before[n].parent);
    expect(await artwork(page, cross[n]).evaluate((node) => node.nextElementSibling?.getAttribute("aria-label"))).toBe(copies[n]);
  }
  await undoOnce(page);
  for (const name of copies) await expect(artwork(page, name)).toHaveCount(0);
  await page.locator("#redo").click();
  await page.locator("#artboard").click({ position: { x: 1, y: 1 } });
  await select(page, copies);
  await page.keyboard.press("Delete");
  for (const name of copies) await expect(artwork(page, name)).toHaveCount(0);
  for (const name of cross) await expect(artwork(page, name)).toHaveCount(1);
  await page.locator("#undo").click();
  for (const name of copies) await expect(artwork(page, name)).toHaveCount(1);
  await expect(page.locator(".layer-button[aria-pressed='true']")).toHaveCount(2);
});

test("bulk mutation rejects locked descendants, locked ancestors and pending review", async ({ page }) => {
  await open(page); await select(page, ["West north seat"]);
  await page.locator("#lock-selection").click();
  await select(page, ["West table cluster", "East table cluster"]);
  for (const control of bulkControls) await expect(page.locator(`#${control}`)).toBeDisabled();
  const before = await attrs(page, ["West table cluster", "East table cluster"]);
  await page.keyboard.press("Delete");
  expect(await attrs(page, ["West table cluster", "East table cluster"])).toEqual(before);
  await expect(page.locator("#undo")).toBeDisabled();
  await select(page, ["West north seat"]); await page.locator("#lock-selection").click();
  await select(page, ["West table cluster"]); await page.locator("#lock-selection").click();
  await select(page, cross);
  for (const control of bulkControls) await expect(page.locator(`#${control}`)).toBeDisabled();
  await select(page, ["West table cluster"]); await page.locator("#lock-selection").click();
  await select(page, cross);
  const manifest = await page.request.get("/api/agent/document", { headers: { Authorization: `Bearer ${token}` } }).then((response) => response.json());
  const target = manifest.layers.find((entry: { name: string }) => entry.name === "Venue caption");
  const queued = await page.request.post("/api/agent/transactions", {
    headers: { Authorization: `Bearer ${token}` }, data: {
      protocolVersion: 1, transactionId: `bulk-pending-${Date.now()}`, producer: { kind: "test", name: "Bulk QA" },
      document: { sessionId: manifest.sessionId, sourcePath: manifest.sourcePath, baseRevision: manifest.revision },
      operations: [{ type: "renameLayer", operationId: "rename", target: { sessionKey: target.sessionKey }, name: "Bulk proposal" }],
    },
  });
  expect(queued.status()).toBe(202);
  await expect(page.locator("#agent-review-status")).toHaveAttribute("data-status", "pending");
  for (const control of bulkControls) await expect(page.locator(`#${control}`)).toBeDisabled();
  await page.getByRole("button", { name: "Revert", exact: true }).click();
  await expect(page.locator("#agent-review-status")).toHaveAttribute("data-status", "reverted");
  await expect(page.locator("#fill")).toBeEnabled();
  await expect(page.locator("#undo")).toBeDisabled();
});

test("bulk copies save with clean references and survive a complete server restart without changing the original", async ({ page }) => {
  test.setTimeout(120_000);
  await promisify(execFile)(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], { cwd: process.cwd(), timeout: 60_000 });
  const workspace = await mkdtemp(path.join(tmpdir(), "lineage-bulk-restart-"));
  await mkdir(path.join(workspace, "concepts"));
  const source = path.join(workspace, sourcePath);
  await copyFile(`tests/fixtures/workspace/${sourcePath}`, source);
  const original = await readFile(source, "utf8");
  // Small authored public test inputs use the real workspace loader and editor.
  await writeFile(path.join(workspace, "concepts/bulk-css.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 80"><rect aria-label="CSS mark" x="10" y="10" width="40" height="40" style="fill:red;display:inline"/><rect aria-label="Plain mark" x="80" y="10" width="40" height="40" fill="blue"/></svg>`);
  await writeFile(path.join(workspace, "concepts/bulk-references.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 80"><g aria-label="Reference pair"><rect id="shape" aria-label="Referenced mark" x="10" y="10" width="30" height="30" fill="red"/><g aria-label="Reference instance" transform="translate(60 0)"><use href="#shape"/></g></g></svg>`);
  const probe = createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  const origin = `http://bulk-restart.localhost:${port}`;
  let child: ChildProcess | undefined;
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit"); child.kill("SIGTERM");
    const timer = setTimeout(() => child?.kill("SIGKILL"), 3_000);
    try { await exited; } finally { clearTimeout(timer); }
  }
  async function start() {
    child = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts", "--workspace", workspace, "--port", String(port)], {
      cwd: process.cwd(), stdio: "ignore", env: { ...process.env, LINEAGE_LOGO_EDITOR_ORIGIN: origin, LINEAGE_LOGO_PUBLIC_EDITOR_ORIGIN: origin, LINEAGE_LOGO_AGENT_TOKEN: token, LINEAGE_LOGO_E2E_ALLOW_UNBOUND_AGENT: "1", LINEAGE_LOGO_REGISTRY_DIR: path.join(workspace, ".registry") },
    });
    await expect.poll(async () => {
      if (child!.exitCode !== null) throw new Error("Bulk restart server exited before readiness.");
      try { return (await page.request.get(`${origin}/api/workspace`)).ok(); } catch { return false; }
    }).toBe(true);
  }
  try {
    await start(); await page.goto(origin);
    await page.locator('[data-path="concepts/bulk-css.svg"]').click();
    await select(page, ["CSS mark", "Plain mark"]);
    const cssBefore = await attrs(page, ["CSS mark", "Plain mark"]);
    await page.locator("#fill").fill("#123456");
    await expect(page.locator("#fill-error")).toContainText("CSS overrides");
    expect(await attrs(page, ["CSS mark", "Plain mark"])).toEqual(cssBefore);
    await page.locator("#hide-selection").click();
    await expect(page.locator("#status")).toContainText("CSS controls");
    await expect(page.locator("#undo")).toBeDisabled();
    await page.locator('[data-path="concepts/bulk-references.svg"]').click();
    await select(page, ["Referenced mark"]);
    await page.locator("#delete-selection").click();
    await expect(page.locator("#status")).toContainText("still references");
    await expect(artwork(page, "Referenced mark")).toHaveCount(1);
    await select(page, ["Referenced mark", "Reference instance"]);
    await page.locator("#duplicate-selection").click();
    await expect(page.locator("#status")).toContainText("common group");
    await expect(page.locator("#undo")).toBeDisabled();
    await select(page, ["Reference pair"]);
    await page.locator("#duplicate-selection").click();
    await expect(artwork(page, "Reference pair copy")).toHaveCount(1);
    await page.locator("#undo").click();
    await expect(page.locator("#undo")).toBeDisabled();
    await page.locator(`[data-path="${sourcePath}"]`).click();
    const names = ["Clipped ticket ribbon", "Masked ticket stub"];
    await select(page, names); await page.locator("#duplicate-selection").click();
    const copies = names.map((name) => `${name} copy`);
    await page.locator("#fill").fill("#123456"); await page.locator("#fill").press("Tab");
    const save = page.locator("#save-iteration");
    const savedPath = (await save.getAttribute("title"))!.replace("Create ", "");
    await save.click(); await expect(save).toBeDisabled();
    await expect(page.locator('.file-button[aria-current="true"]')).toHaveAttribute("data-path", savedPath);
    const saved = await readFile(path.join(workspace, savedPath), "utf8");
    expect(saved).not.toMatch(/data-(?:lineage|agent|review|transport)-|svg_select|lineage-selection-halo/);
    const refProof = await page.evaluate((svg) => {
      const root = new DOMParser().parseFromString(svg, "image/svg+xml");
      const ids = Array.from(root.querySelectorAll("[id]"), (node) => node.id);
      const refs = Array.from(svg.matchAll(/url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g), (match) => match[1]);
      return { unique: new Set(ids).size === ids.length, valid: refs.every((id) => ids.includes(id)), refs: refs.length };
    }, saved);
    expect(refProof.unique).toBe(true); expect(refProof.valid).toBe(true); expect(refProof.refs).toBeGreaterThan(4);
    for (const name of copies) await expect(artwork(page, name)).toHaveAttribute("fill", "#123456");
    await expect(page.locator(".layer-button[aria-pressed='true']")).toHaveCount(2);
    await page.locator("#undo").click(); await expect(save).toBeEnabled();
    await page.locator("#redo").click(); await expect(save).toBeDisabled();
    const firstPid = child!.pid;
    await stop(); await start(); expect(child!.pid).not.toBe(firstPid);
    await page.reload();
    await expect(page.locator('.file-button[aria-current="true"]')).toHaveAttribute("data-path", savedPath);
    for (const name of copies) await expect(artwork(page, name)).toHaveAttribute("fill", "#123456");
    expect(await readFile(path.join(workspace, savedPath), "utf8")).toBe(saved);
    expect(await readFile(source, "utf8")).toBe(original);
  } finally {
    await page.goto("about:blank"); await stop(); await rm(workspace, { recursive: true, force: true });
  }
});
