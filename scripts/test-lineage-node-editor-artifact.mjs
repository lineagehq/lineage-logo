#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function inspect(outputRoot) {
  const receipt = JSON.parse(await readFile(join(outputRoot, "checksums.json"), "utf8"));
  const manifest = await readFile(join(outputRoot, "package/manifest.json"));
  const host = await readFile(join(outputRoot, "package/src/host.js"));
  const editor = await readFile(join(outputRoot, "package/editor/index.html"));
  const archive = await readFile(join(outputRoot, receipt.artifact));
  for (const [name, bytes] of [["manifest.json", manifest], ["src/host.js", host], ["editor/index.html", editor]]) {
    assert.equal(receipt.files[name].sha256, sha256(bytes));
    assert.equal(receipt.files[name].bytes, bytes.length);
  }
  assert.equal(receipt.sha256, sha256(archive));
  const html = editor.toString("utf8");
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=|sourceMappingURL|@import\s+|url\(\s*["']?https?:\/\//i);
  assert.doesNotMatch(html, /localStorage|sessionStorage|document\.cookie|launchCredential|processCapability|controlCredential|document\/content|fetch\s*\(/);
  assert.doesNotMatch(html, /postMessage\([^\n]+["']\*["']/);
  for (const bytes of [archive, manifest, host, editor]) assert.equal(bytes.includes(Buffer.from(root)), false, "artifact embeds its build path");
  return { receipt, manifest, host, editor, archive };
}

const canonical = join(root, "dist/node-editor-plugin");
await inspect(canonical);
if (process.argv.includes("--repro")) {
  const temporary = await mkdtemp(join(tmpdir(), "lineage-logo-plugin-repro-"));
  try {
    const outputs = [join(temporary, "a"), join(temporary, "b")];
    for (const output of outputs) {
      const result = spawnSync(process.execPath, [join(root, "scripts/build-lineage-node-editor-plugin.mjs"), "--out-dir", output], { cwd: root, stdio: "inherit" });
      assert.equal(result.status, 0, "clean plugin build failed");
    }
    const [a, b] = await Promise.all(outputs.map(inspect));
    assert.deepEqual(a.receipt, b.receipt);
    assert.deepEqual(a.archive, b.archive);
    assert.deepEqual(a.manifest, b.manifest); assert.deepEqual(a.host, b.host); assert.deepEqual(a.editor, b.editor);
    console.log(JSON.stringify({ reproducible: true, sha256: a.receipt.sha256 }));
  } finally { await rm(temporary, { recursive: true, force: true }); }
} else console.log(JSON.stringify({ artifact: "verified" }));
