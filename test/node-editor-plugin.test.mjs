import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const packagedHost = new URL("../dist/node-editor-plugin/package/src/host.js", import.meta.url);
const packagedEditor = new URL("../dist/node-editor-plugin/package/editor/index.html", import.meta.url);

function bootstrapFor(html, overrides = {}) {
  return {
    bootstrap: { type: "bootstrap", pluginId: "lineage.logo.editor", processId: "process-test", sessionId: "session-test", bootstrapCredential: "bootstrap_credential_1234", expiresAt: Date.now() + 10_000 },
    profileId: "profile-test", controlCredential: "control_credential_1234567890", idleTimeoutMs: 10_000,
    editorHtmlBase64: html.toString("base64"), editorSha256: createHash("sha256").update(html).digest("hex"),
    ...overrides,
  };
}

function startPackagedHost(payload) {
  const child = spawn(process.execPath, [packagedHost.pathname], { stdio: ["ignore", "ignore", "pipe", "pipe"] });
  const pipe = child.stdio[3];
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  pipe.on("error", () => undefined);
  pipe.end(`${JSON.stringify(payload)}\n`);
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stderr }));
  });
  const ready = new Promise((resolve, reject) => {
    let buffered = "";
    const timer = setTimeout(() => reject(new Error("host readiness timed out")), 5_000);
    pipe.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      const newline = buffered.indexOf("\n");
      if (newline >= 0) { clearTimeout(timer); resolve(JSON.parse(buffered.slice(0, newline))); }
    });
    exited.then(({ code, stderr: errorText }) => { clearTimeout(timer); if (code) reject(new Error(errorText.trim() || `host exited ${code}`)); });
  });
  return { child, exited, ready };
}

async function rejectsBootstrap(payload, pattern) {
  const running = startPackagedHost(payload);
  await assert.rejects(running.ready, pattern);
  const result = await running.exited;
  assert.equal(result.code, 1);
  assert.match(result.stderr, pattern);
}

test("manifest exposes one bounded SVG-only protocol 1.3 editor", async () => {
  const manifest = JSON.parse(await read("src/node-editor-plugin/manifest.json"));
  assert.equal(manifest.pluginId, "lineage.logo.editor");
  assert.equal(manifest.nodeEditors.length, 1);
  assert.deepEqual(manifest.nodeEditors[0].accepts.mimeTypes, ["image/svg+xml"]);
  assert.ok(manifest.nodeEditors[0].accepts.maxBytes <= 16 * 1024 * 1024);
  assert.match(manifest.nodeEditors[0].editor.origin, /^http:\/\/lineage-logo-editor\.localhost:\d+$/);
  assert.deepEqual(manifest.protocol.map(({ major, minMinor, maxMinor }) => ({ major, minMinor, maxMinor })), [{ major: 1, minMinor: 3, maxMinor: 3 }]);
  assert.ok(manifest.protocol[0].requiredFeatures.includes("document-content"));
});

test("editor consumes the existing canvas primitives and confines authority", async () => {
  const source = await read("src/node-editor-plugin/editor.ts");
  assert.match(source, /import \{ SvgEditor, serializeSvg \} from "\.\.\/client\/canvas\/editor"/);
  assert.match(source, /new SvgEditor\(/);
  assert.match(source, /serializeSvg\(editor\.svgNode, true\)/);
  for (const message of ["connected", "document", "state", "dirty", "save", "cancel"]) assert.match(source, new RegExp(`lineage\\.node-editor\\.${message}`));
  assert.match(source, /record\.payload instanceof ArrayBuffer/);
  assert.match(source, /crypto\.subtle\.digest\("SHA-256", record\.payload\)/);
  assert.match(source, /record\.mimeType !== "image\/svg\+xml"/);
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|document\.cookie|launchCredential|processCapability|controlCredential|document\/content/);
  assert.doesNotMatch(source, /postMessage\([^\n]+["']\*["']/);
});

test("contract lock is an exact immutable commit and schema digest", async () => {
  const lock = JSON.parse(await read("lineage-node-editor-contract.lock.json"));
  assert.equal(lock.repository, "lineagehq/lineage");
  assert.match(lock.commit, /^[a-f0-9]{40}$/);
  assert.equal(lock.protocol, "1.3");
  assert.match(lock.schemaSha256, /^[a-f0-9]{64}$/);
});

test("canonical editor is one self-contained HTML document", async () => {
  const html = await read("dist/node-editor-plugin/package/editor/index.html");
  assert.match(html, /Lineage Logo editor/);
  assert.match(html, /new MessageChannel/);
  assert.doesNotMatch(html, /__LINEAGE_NODE_EDITOR_SCRIPT__|<script[^>]+src=|<link[^>]+href=|sourceMappingURL/);
});

test("packaged host confines control authority and serves the exact editor at a descriptive localhost origin", async (context) => {
  const html = await readFile(packagedEditor);
  const running = startPackagedHost(bootstrapFor(html));
  const { child } = running;
  context.after(() => { if (child.exitCode === null) child.kill(); });
  const credential = "control_credential_1234567890";
  const ready = await running.ready;
  assert.match(ready.editorOrigin, /^http:\/\/lineage-logo-editor\.localhost:\d+$/);
  assert.match(ready.controlOrigin, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.notEqual(ready.editorOrigin, ready.controlOrigin);
  assert.equal((await fetch(`${ready.controlOrigin}/health`)).status, 401);
  const authorized = await fetch(`${ready.controlOrigin}/health`, { headers: { authorization: `Bearer ${credential}` } });
  assert.equal(authorized.status, 200);
  assert.deepEqual(await authorized.json(), { ok: true, pluginId: "lineage.logo.editor", profileId: "profile-test" });
  const editorUrl = new URL(`${ready.editorOrigin}/editor/index.html`); editorUrl.hostname = "127.0.0.1";
  const served = await fetch(editorUrl);
  assert.equal(served.status, 200);
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), html);
  const shutdown = await fetch(`${ready.controlOrigin}/shutdown`, { method: "POST", headers: { authorization: `Bearer ${credential}` } });
  assert.equal(shutdown.status, 202);
  assert.equal((await running.exited).code, 0);
});

test("packaged host rejects every noncanonical or over-budget editor bootstrap", async () => {
  const html = await readFile(packagedEditor);
  const canonicalBase64 = html.toString("base64");
  const alternate = Buffer.from(html);
  alternate[0] ^= 1;
  await rejectsBootstrap(bootstrapFor(html, { editorHtmlBase64: canonicalBase64.slice(0, -1) }), /canonical base64/);
  await rejectsBootstrap(bootstrapFor(html, { editorHtmlBase64: Buffer.from(html.subarray(0, -3)).toString("base64") }), /base64 length/);
  await rejectsBootstrap(bootstrapFor(html, { editorSha256: "0".repeat(64) }), /digest/);
  await rejectsBootstrap(bootstrapFor(alternate), /digest/);
  await rejectsBootstrap(bootstrapFor(Buffer.from("short canonical-form candidate"), { profileId: "p".repeat(4_000) }), /metadata exceeds 4096 bytes/);
  await rejectsBootstrap(bootstrapFor(html, { profileId: "p".repeat(5_000) }), /exceeds the canonical editor plus 4096 metadata bytes/);
});
