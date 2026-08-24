import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Window, type Element as HappyElement } from "happy-dom";
import type { AgentDocumentManifest, AgentOperation, AgentTransactionV1 } from "../src/shared/agent-protocol";

const SVG_NS = "http://www.w3.org/2000/svg";
const SELECTABLE = new Set(["g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text"]);

export interface AdapterOptions {
  api: string;
  token: string;
  mode: "replace" | "add" | "set-paint";
  artifact?: string;
  selector?: string;
  targetKey?: string;
  targetName?: string;
  parentKey?: string;
  parentName?: string;
  property?: "fill" | "stroke";
  value?: string;
  transactionId?: string;
}

function localReferences(element: HappyElement): Set<string> {
  const references = new Set<string>();
  for (const item of [element, ...element.querySelectorAll("*")]) {
    for (const attribute of item.getAttributeNames()) {
      const value = item.getAttribute(attribute) ?? "";
      for (const match of value.matchAll(/url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)|(?:^|\s)#([^\s]+)$/g)) {
        references.add(match[1] ?? match[2]);
      }
    }
  }
  return references;
}

/** Extracts one selectable layer and embeds any root-level resources it references. */
export function extractLayerArtifact(source: string, selector: string): string {
  const window = new Window();
  window.document.body.innerHTML = source;
  const root = window.document.querySelector("svg");
  if (!root) throw new Error("Artifact must contain one SVG root");
  let selected: HappyElement | null;
  try {
    selected = root.querySelector(selector);
  } catch {
    throw new Error(`Invalid SVG selector: ${selector}`);
  }
  if (!selected || !SELECTABLE.has(selected.localName)) throw new Error(`Selector must match one selectable SVG layer: ${selector}`);

  const clone = selected.cloneNode(true) as HappyElement;
  const known = new Set([clone.id, ...[...clone.querySelectorAll("[id]")].map((item) => item.id)].filter(Boolean));
  const resources: HappyElement[] = [];
  const pending = [...localReferences(clone)];
  while (pending.length > 0) {
    const id = pending.shift()!;
    if (known.has(id)) continue;
    const sourceResource = [...root.querySelectorAll("[id]")].find((item) => item.id === id);
    if (!sourceResource || selected.contains(sourceResource)) continue;
    const resource = sourceResource.cloneNode(true) as HappyElement;
    resources.push(resource);
    known.add(id);
    for (const dependency of localReferences(resource)) if (!known.has(dependency)) pending.push(dependency);
  }
  if (resources.length > 0) {
    const defs = window.document.createElementNS(SVG_NS, "defs");
    defs.append(...resources);
    clone.prepend(defs);
  }
  return clone.outerHTML;
}

function resolveLayer(manifest: AgentDocumentManifest, key: string | undefined, name: string | undefined, label: string): string {
  if (key) return key;
  if (!name) throw new Error(`${label} requires --${label}-key or --${label}-name`);
  const matches = manifest.layers.filter((layer) => layer.name === name);
  if (matches.length !== 1) throw new Error(`${label} name must match exactly one manifest layer: ${name}`);
  return matches[0].sessionKey;
}

export async function buildLogoDesignerTransaction(options: AdapterOptions, manifest: AgentDocumentManifest): Promise<AgentTransactionV1> {
  let operation: AgentOperation;
  if (options.mode === "set-paint") {
    operation = {
      type: "setPaint",
      operationId: "targeted-paint",
      target: { sessionKey: resolveLayer(manifest, options.targetKey, options.targetName, "target") },
      property: options.property ?? "fill",
      value: options.value ?? "none",
    };
  } else {
    if (!options.artifact) throw new Error(`${options.mode} requires --artifact`);
    const svg = await readFile(options.artifact, "utf8");
    const selector = options.selector ?? (options.targetName ? `#${options.targetName}` : undefined);
    if (!selector) throw new Error(`${options.mode} requires --selector or --target-name`);
    const fragment = extractLayerArtifact(svg, selector);
    operation = options.mode === "replace"
      ? { type: "replaceLayer", operationId: "logo-artifact", target: { sessionKey: resolveLayer(manifest, options.targetKey, options.targetName, "target") }, svg: fragment }
      : { type: "addLayer", operationId: "logo-artifact", parent: options.parentKey || options.parentName ? { sessionKey: resolveLayer(manifest, options.parentKey, options.parentName, "parent") } : null, placement: "last", svg: fragment };
  }
  return {
    protocolVersion: 1,
    transactionId: options.transactionId ?? randomUUID(),
    producer: { kind: "logo-designer-skill", name: "lineage-logo-adapter", version: "1" },
    document: { sessionId: manifest.sessionId, sourcePath: manifest.sourcePath, baseRevision: manifest.revision },
    operations: [operation],
  };
}

export async function submitLogoDesignerTransaction(options: AdapterOptions): Promise<{ transaction: AgentTransactionV1; response: unknown }> {
  const headers = { Authorization: `Bearer ${options.token}` };
  const documentResponse = await fetch(`${options.api.replace(/\/$/, "")}/api/agent/document`, { headers });
  if (!documentResponse.ok) throw new Error(`Manifest request failed (${documentResponse.status}): ${await documentResponse.text()}`);
  const manifest = await documentResponse.json() as AgentDocumentManifest;
  const transaction = await buildLogoDesignerTransaction(options, manifest);
  const response = await fetch(`${options.api.replace(/\/$/, "")}/api/agent/transactions`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(transaction),
  });
  const body = await response.json().catch(() => ({ error: response.statusText }));
  if (!response.ok) throw new Error(`Transaction submission failed (${response.status}): ${JSON.stringify(body)}`);
  return { transaction, response: body };
}

function parseArguments(argv: string[]): AdapterOptions {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) throw new Error(`Expected --name value arguments; received ${argv[index] ?? "end of input"}`);
    args.set(argv[index].slice(2), argv[index + 1]);
  }
  const token = args.get("token") ?? process.env.LINEAGE_LOGO_AGENT_TOKEN;
  if (!token) throw new Error("Set LINEAGE_LOGO_AGENT_TOKEN or pass --token");
  const mode = args.get("mode") ?? "replace";
  if (mode !== "replace" && mode !== "add" && mode !== "set-paint") throw new Error(`Unsupported --mode: ${mode}`);
  const property = args.get("property");
  if (property !== undefined && property !== "fill" && property !== "stroke") throw new Error(`Unsupported --property: ${property}`);
  return {
    api: args.get("api") ?? "http://127.0.0.1:4173",
    token,
    mode,
    artifact: args.get("artifact"), selector: args.get("selector"),
    targetKey: args.get("target-key"), targetName: args.get("target-name"),
    parentKey: args.get("parent-key"), parentName: args.get("parent-name"),
    property, value: args.get("value"), transactionId: args.get("transaction-id"),
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  submitLogoDesignerTransaction(parseArguments(process.argv.slice(2)))
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
