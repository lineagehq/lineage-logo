import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Window, type Element as HappyElement } from "happy-dom";
import { parseAgentTransaction, type AgentDocumentManifest, type AgentOperation, type AgentTransactionV1 } from "../src/shared/agent-protocol";
import { AgentProducerClient, type AgentProducerOutcome } from "../src/producer/agent-client";

const SVG_NS = "http://www.w3.org/2000/svg";
const SELECTABLE = new Set(["g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text"]);

export interface AdapterOptions {
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
  contextPath?: string;
  timeoutMs?: number;
  client?: AgentProducerClient;
}

export const LOGO_DESIGNER_RECEIPT_VERSION = 1 as const;
export const LOGO_DESIGNER_RECEIPT_KIND = "lineage.logo-designer.adapter-receipt" as const;

export interface LogoDesignerAdapterReceiptV1 {
  receiptVersion: typeof LOGO_DESIGNER_RECEIPT_VERSION;
  kind: typeof LOGO_DESIGNER_RECEIPT_KIND;
  transaction: {
    transactionId: string;
    sessionId: string;
    sourcePath: string;
    baseRevision: number;
  };
  outcome: AgentProducerOutcome;
}

export type LogoDesignerPreflightDiagnostic = "invalid_arguments" | "invalid_artifact" | "canvas_unavailable";

export interface LogoDesignerPreflightReceiptV1 {
  receiptVersion: typeof LOGO_DESIGNER_RECEIPT_VERSION;
  kind: typeof LOGO_DESIGNER_RECEIPT_KIND;
  outcome: {
    status: "invalid" | "unavailable";
    diagnostic: LogoDesignerPreflightDiagnostic;
  };
}

export type LogoDesignerCliReceiptV1 = LogoDesignerAdapterReceiptV1 | LogoDesignerPreflightReceiptV1;

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
  return parseAgentTransaction({
    protocolVersion: 1,
    transactionId: options.transactionId ?? randomUUID(),
    producer: { kind: "logo-designer-skill", name: "lineage-logo-adapter", version: "1" },
    document: { sessionId: manifest.sessionId, sourcePath: manifest.sourcePath, baseRevision: manifest.revision },
    operations: [operation],
  });
}

export async function submitLogoDesignerTransaction(options: AdapterOptions): Promise<{ transaction: AgentTransactionV1; outcome: AgentProducerOutcome }> {
  const client = options.client ?? new AgentProducerClient({ contextPath: options.contextPath, timeoutMs: options.timeoutMs });
  const manifest = await client.manifest();
  const transaction = await buildLogoDesignerTransaction(options, manifest);
  return { transaction, outcome: await client.submitAndWait(transaction) };
}

/** Builds the only stdout representation exposed by the CLI. */
export function buildLogoDesignerReceipt(transaction: AgentTransactionV1, outcome: AgentProducerOutcome): LogoDesignerAdapterReceiptV1 {
  if (outcome.transactionId !== transaction.transactionId) throw new Error("Producer outcome transaction identity does not match the submission.");
  if (outcome.status === "accepted") {
    if (!outcome.artifact) throw new Error("Accepted mutation has no artifact receipt.");
    if (outcome.artifact.sourcePath !== transaction.document.sourcePath
      || outcome.artifact.revision !== transaction.document.baseRevision + 1) {
      throw new Error("Accepted artifact identity does not match the submitted document revision.");
    }
  }
  return {
    receiptVersion: LOGO_DESIGNER_RECEIPT_VERSION,
    kind: LOGO_DESIGNER_RECEIPT_KIND,
    transaction: {
      transactionId: transaction.transactionId,
      sessionId: transaction.document.sessionId,
      sourcePath: transaction.document.sourcePath,
      baseRevision: transaction.document.baseRevision,
    },
    outcome,
  };
}

function buildPreflightReceipt(status: "invalid" | "unavailable", diagnostic: LogoDesignerPreflightDiagnostic): LogoDesignerPreflightReceiptV1 {
  return { receiptVersion: LOGO_DESIGNER_RECEIPT_VERSION, kind: LOGO_DESIGNER_RECEIPT_KIND, outcome: { status, diagnostic } };
}

function parseArguments(argv: string[]): AdapterOptions {
  const args = new Map<string, string>();
  const allowed = new Set([
    "mode", "artifact", "selector", "target-key", "target-name", "parent-key", "parent-name",
    "property", "value", "transaction-id", "context", "timeout-ms",
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) throw new Error(`Expected --name value arguments; received ${argv[index] ?? "end of input"}`);
    const name = argv[index].slice(2);
    if (!allowed.has(name) || args.has(name)) throw new Error(`Unsupported or duplicate argument: --${name}`);
    args.set(name, argv[index + 1]);
  }
  const mode = args.get("mode") ?? "replace";
  if (mode !== "replace" && mode !== "add" && mode !== "set-paint") throw new Error(`Unsupported --mode: ${mode}`);
  const property = args.get("property");
  if (property !== undefined && property !== "fill" && property !== "stroke") throw new Error(`Unsupported --property: ${property}`);
  const timeoutMs = args.has("timeout-ms") ? Number(args.get("timeout-ms")) : undefined;
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) throw new Error("--timeout-ms must be a positive number");
  return {
    mode,
    artifact: args.get("artifact"), selector: args.get("selector"),
    targetKey: args.get("target-key"), targetName: args.get("target-name"),
    parentKey: args.get("parent-key"), parentName: args.get("parent-name"),
    property, value: args.get("value"), transactionId: args.get("transaction-id"),
    contextPath: args.get("context"),
    timeoutMs,
  };
}

export async function runLogoDesignerAdapter(
  argv: string[],
  injectedClient?: AgentProducerClient,
): Promise<{ receipt: LogoDesignerCliReceiptV1; exitCode: number }> {
  let options: AdapterOptions;
  try { options = parseArguments(argv); }
  catch { return { receipt: buildPreflightReceipt("invalid", "invalid_arguments"), exitCode: 2 }; }

  const client = injectedClient ?? new AgentProducerClient({ contextPath: options.contextPath, timeoutMs: options.timeoutMs });
  let manifest: AgentDocumentManifest;
  try { manifest = await client.manifest(); }
  catch { return { receipt: buildPreflightReceipt("unavailable", "canvas_unavailable"), exitCode: 4 }; }

  let transaction: AgentTransactionV1;
  try { transaction = await buildLogoDesignerTransaction(options, manifest); }
  catch { return { receipt: buildPreflightReceipt("invalid", "invalid_artifact"), exitCode: 2 }; }

  let outcome: AgentProducerOutcome;
  try { outcome = await client.submitAndWait(transaction); }
  catch { outcome = { status: "unavailable", transactionId: transaction.transactionId, message: "Canvas is unavailable." }; }
  try {
    const receipt = buildLogoDesignerReceipt(transaction, outcome);
    const exitCode = outcome.status === "accepted" ? 6
      : outcome.status === "reverted" ? 5
        : outcome.status === "rejected" ? 2
          : outcome.status === "unavailable" || outcome.status === "disconnected" ? 4
            : 6;
    return { receipt, exitCode };
  }
  catch {
    return {
      receipt: buildLogoDesignerReceipt(transaction, {
        status: "conflict", transactionId: transaction.transactionId, message: "Transaction outcome identity is malformed.",
      }),
      exitCode: 6,
    };
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = await runLogoDesignerAdapter(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result.receipt)}\n`);
  process.exitCode = result.exitCode;
}
