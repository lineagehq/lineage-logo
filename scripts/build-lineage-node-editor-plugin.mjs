#!/usr/bin/env node
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requestedOutput = process.argv.indexOf("--out-dir");
const outputRoot = resolve(requestedOutput >= 0 ? process.argv[requestedOutput + 1] : join(root, "dist", "node-editor-plugin"));
const packageRoot = join(outputRoot, "package");
const files = ["manifest.json", "src/host.js", "editor/index.html"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function tarHeader(name, size) {
  const header = Buffer.alloc(512);
  const write = (value, start, length) => header.write(value, start, Math.min(length, Buffer.byteLength(value)), "utf8");
  const octal = (value, length) => `${value.toString(8).padStart(length - 1, "0")}\0`;
  write(name, 0, 100); write(octal(0o644, 8), 100, 8); write(octal(0, 8), 108, 8); write(octal(0, 8), 116, 8);
  write(octal(size, 12), 124, 12); write(octal(0, 12), 136, 12); header.fill(0x20, 148, 156); header[156] = "0".charCodeAt(0);
  write("ustar\0", 257, 6); write("00", 263, 2); write("root", 265, 32); write("root", 297, 32);
  write(octal([...header].reduce((sum, value) => sum + value, 0), 8), 148, 8);
  return header;
}

function canonicalTar(entries) {
  const chunks = [];
  for (const [name, bytes] of entries) {
    chunks.push(tarHeader(name, bytes.length), bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(join(packageRoot, "src"), { recursive: true });
await mkdir(join(packageRoot, "editor"), { recursive: true });
const result = await build({
  configFile: false,
  root,
  logLevel: "silent",
  build: {
    write: false,
    minify: "esbuild",
    sourcemap: false,
    target: "es2022",
    rollupOptions: { input: join(root, "src/node-editor-plugin/editor.ts"), output: { format: "iife", inlineDynamicImports: true, entryFileNames: "editor.js" } },
  },
});
if (Array.isArray(result)) throw new Error("plugin build unexpectedly returned multiple outputs");
const javascript = result.output.find((entry) => entry.type === "chunk" && entry.isEntry)?.code;
if (!javascript) throw new Error("plugin build did not produce one JavaScript entry");
const template = await readFile(join(root, "src/node-editor-plugin/editor.html"), "utf8");
if (template.split("__LINEAGE_NODE_EDITOR_SCRIPT__").length !== 2) throw new Error("editor template must contain exactly one script marker");
const editorHtml = template.replace("__LINEAGE_NODE_EDITOR_SCRIPT__", javascript.replaceAll("</script", "<\\/script"));
const source = {
  "manifest.json": await readFile(join(root, "src/node-editor-plugin/manifest.json")),
  "src/host.js": await readFile(join(root, "src/node-editor-plugin/host.js")),
  "editor/index.html": Buffer.from(editorHtml),
};
for (const name of files) {
  const target = join(packageRoot, name);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, source[name]);
}
const entries = files.map((name) => [`package/${name}`, source[name]]);
const archive = gzipSync(canonicalTar(entries), { level: 9, mtime: 0 });
const archivePath = join(outputRoot, "lineage-logo-node-editor-plugin-0.1.0.tgz");
await writeFile(archivePath, archive);
const receipt = {
  artifact: "lineage-logo-node-editor-plugin-0.1.0.tgz",
  sha256: sha256(archive),
  files: Object.fromEntries(files.map((name) => [name, { bytes: source[name].length, sha256: sha256(source[name]) }])),
};
await writeFile(join(outputRoot, "checksums.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt));
