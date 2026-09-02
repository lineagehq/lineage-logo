#!/usr/bin/env node
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const option = process.argv.indexOf("--lineage-contract-root");
if (option < 0 || !process.argv[option + 1]) throw new Error("--lineage-contract-root <exact checkout> is required");
const root = resolve(process.argv[option + 1]);
const lock = JSON.parse(await readFile(new URL("../lineage-node-editor-contract.lock.json", import.meta.url), "utf8"));
if (!/^[a-f0-9]{40}$/.test(lock.commit)) throw new Error("contract lock must contain an exact commit, never a branch or floating ref");
const git = (...args) => {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
};
if (git("rev-parse", "HEAD") !== lock.commit) throw new Error("Lineage contract checkout is not at the exact locked commit");
if (lock.repository !== "lineagehq/lineage" || lock.protocol !== "1.3") throw new Error("unexpected contract identity");
const remote = git("remote", "get-url", "origin");
if (!/(?:github\.com[:/])lineagehq\/lineage(?:\.git)?$/.test(remote)) throw new Error("contract checkout origin is not lineagehq/lineage");
git("cat-file", "-e", `${lock.commit}^{commit}`);
const schema = await readFile(join(root, lock.schemaPath));
const digest = createHash("sha256").update(schema).digest("hex");
if (digest !== lock.schemaSha256) throw new Error(`protocol schema digest mismatch: ${digest}`);
const protocolRoot = join(root, "packages/node-editor-protocol");
let moduleUrl = pathToFileURL(join(protocolRoot, "src/index.js")).href;
try { await access(join(protocolRoot, "node_modules/ajv/dist/2020.js")); } catch (error) {
  const install = spawnSync("npm", ["ci", "--ignore-scripts", "--prefix", protocolRoot], { stdio: "inherit" });
  if (install.status !== 0) throw error;
}
const [{ validateManifest }, { runConformance }] = await Promise.all([
  import(`${moduleUrl}?contract=${lock.commit}`),
  import(`${pathToFileURL(join(protocolRoot, "src/conformance.js")).href}?contract=${lock.commit}`),
]);
const manifest = JSON.parse(await readFile(new URL("../dist/node-editor-plugin/package/manifest.json", import.meta.url), "utf8"));
validateManifest(manifest);
if (manifest.pluginId !== "lineage.logo.editor" || manifest.protocol.length !== 1 || manifest.protocol[0].minMinor !== 3 || manifest.protocol[0].maxMinor !== 3 || !manifest.protocol[0].requiredFeatures.includes("document-content")) throw new Error("built plugin is not locked to canonical protocol 1.3 document transfer");
const conformance = await runConformance();
console.log(JSON.stringify({ commit: lock.commit, schemaSha256: digest, manifest: manifest.pluginId, conformance }));
