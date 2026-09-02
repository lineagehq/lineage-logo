#!/usr/bin/env node
import { spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, realpath } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { AgentProducerClient, type AgentProducerOutcome } from "../producer/agent-client.js";
import { parseAgentTransaction, validateCleanAgentSvg, type AgentTransactionV1 } from "../shared/agent-protocol.js";

export const EXIT = {
  success: 0, usage: 2, selection: 3, unavailable: 4, rejected: 5, conflict: 6, internal: 7,
} as const;

type CommandName = "launch" | "submit" | "doctor";
type OutputStatus = "ok" | "invalid" | "not_found" | "unavailable" | "rejected" | "conflict" | "error";

export interface CliResult {
  schemaVersion: 1;
  command: CommandName;
  ok: boolean;
  status: OutputStatus;
  message: string;
  [key: string]: unknown;
}

export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface ResolvedInstance {
  client: Pick<AgentProducerClient, "manifest" | "submitAndWait">;
  instanceId: string;
  workspaceLabel: string;
  editorOrigin: string;
}

export interface ResolveOptions {
  workspace?: string;
  instance?: string;
  legacyContext?: string;
}

export type InstanceResolver = (options: ResolveOptions) => Promise<ResolvedInstance>;

export class InstanceResolutionError extends Error {
  constructor(readonly reason: "not_found" | "ambiguous" | "unavailable") { super(reason); }
}

export interface CliDependencies {
  resolveInstance?: InstanceResolver;
  launch?: (options: LaunchOptions, io: CliIo) => Promise<number>;
  nodeVersion?: string;
}

interface ParsedArguments {
  command?: CommandName;
  options: Map<string, string | true>;
  json: boolean;
  quiet: boolean;
  help: boolean;
  version: boolean;
}

export interface LaunchOptions {
  workspace: string;
  port: number;
  open: boolean;
  development: boolean;
  json?: boolean;
}

const HELP = `Usage: lineage-logo <command> [options]

Commands:
  launch --workspace <path> [--port <port>] [--no-open] [--json]
  submit --artifact <path> --proposal <path> [--workspace <path> | --instance <uuid>] [--json] [--include-svg]
  doctor [--workspace <path> | --instance <uuid>] [--json]

Global options:
  --help       Show command help
  --version    Print the installed version
  --json       Write one schemaVersion:1 result object to stdout
  --quiet      Suppress non-error progress on stderr
  --legacy-context <path>  Explicit deprecated single-instance context`;

class CliFailure extends Error {
  constructor(readonly exitCode: number, readonly status: OutputStatus, message: string) { super(message); }
}

function parse(argv: string[]): ParsedArguments {
  const options = new Map<string, string | true>();
  let command: CommandName | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      if (command || !["launch", "submit", "doctor"].includes(argument)) throw new CliFailure(EXIT.usage, "invalid", "Unknown command or positional argument.");
      command = argument as CommandName;
      continue;
    }
    const name = argument.slice(2);
    if (["json", "quiet", "help", "version", "no-open", "include-svg", "development"].includes(name)) {
      if (options.has(name)) throw new CliFailure(EXIT.usage, "invalid", `Duplicate option --${name}.`);
      options.set(name, true);
      continue;
    }
    if (!["workspace", "instance", "artifact", "proposal", "port", "legacy-context"].includes(name) || argv[index + 1] === undefined) {
      throw new CliFailure(EXIT.usage, "invalid", `Unsupported or incomplete option --${name}.`);
    }
    if (options.has(name)) throw new CliFailure(EXIT.usage, "invalid", `Duplicate option --${name}.`);
    options.set(name, argv[++index]);
  }
  return {
    command, options,
    json: options.has("json"), quiet: options.has("quiet"), help: options.has("help"), version: options.has("version"),
  };
}

function value(args: ParsedArguments, name: string): string | undefined {
  const result = args.options.get(name);
  return typeof result === "string" ? result : undefined;
}

function requireValue(args: ParsedArguments, name: string): string {
  const result = value(args, name);
  if (!result) throw new CliFailure(EXIT.usage, "invalid", `Missing required --${name}.`);
  return result;
}

function validateCommandOptions(args: ParsedArguments): void {
  if (!args.command) return;
  const global = new Set(["json", "quiet", "help", "version"]);
  const commandOptions: Record<CommandName, Set<string>> = {
    launch: new Set(["workspace", "port", "no-open", "development"]),
    submit: new Set(["artifact", "proposal", "workspace", "instance", "legacy-context", "include-svg"]),
    doctor: new Set(["workspace", "instance", "legacy-context"]),
  };
  for (const option of args.options.keys()) {
    if (!global.has(option) && !commandOptions[args.command].has(option)) {
      throw new CliFailure(EXIT.usage, "invalid", `Option --${option} is not valid for ${args.command}.`);
    }
  }
}

function output(io: CliIo, json: boolean, result: CliResult): void {
  io.stdout(json ? JSON.stringify(result) : result.message);
}

function progress(io: CliIo, quiet: boolean, message: string): void {
  if (!quiet) io.stderr(message);
}

function sanitizedSelection(instance: ResolvedInstance): string {
  const id = instance.instanceId.replace(/[^A-Za-z0-9-]/g, "").slice(0, 8) || "unknown";
  const label = path.basename(instance.workspaceLabel).replace(/[^A-Za-z0-9._ -]/g, "").slice(0, 80) || "workspace";
  return `${label} (${id})`;
}

async function defaultResolver(options: ResolveOptions): Promise<ResolvedInstance> {
  const module = await import("../producer/connection-context.js");
  const futureResolver = (module as unknown as { resolveAgentConnection?: InstanceResolver }).resolveAgentConnection;
  if (futureResolver) return await futureResolver(options);
  if (options.legacyContext) {
    const context = await module.readAgentConnectionContext(options.legacyContext);
    const api = new URL(context.apiOrigin);
    return {
      client: new AgentProducerClient({ context }),
      instanceId: `legacy-${context.pid}`,
      workspaceLabel: "legacy workspace",
      editorOrigin: `http://lineage-logo.localhost:${api.port}`,
    };
  }
  throw new CliFailure(EXIT.selection, "not_found", "No multi-instance resolver is available. Start an updated Lineage Logo editor.");
}

async function resolveSelected(resolver: InstanceResolver, options: ResolveOptions): Promise<ResolvedInstance> {
  try { return await resolver(options); }
  catch (error) {
    if (error instanceof CliFailure) throw error;
    const reason = (error as { reason?: unknown }).reason;
    if (reason === "unavailable") throw new CliFailure(EXIT.unavailable, "unavailable", "The selected editor is unavailable.");
    throw new CliFailure(EXIT.selection, "not_found", reason === "ambiguous" ? "Multiple editors match; select one explicitly." : "No matching live editor was found.");
  }
}

function parsePort(raw: string | undefined): number {
  const port = Number(raw ?? "4173");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new CliFailure(EXIT.usage, "invalid", "Port must be an integer between 1024 and 65535.");
  return port;
}

async function portIsAvailable(port: number): Promise<boolean> {
  return await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", (error: NodeJS.ErrnoException) => error.code === "EADDRINUSE" ? resolve(false) : reject(error));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

async function availablePort(start: number): Promise<number> {
  for (let port = start; port <= Math.min(65535, start + 100); port += 1) if (await portIsAvailable(port)) return port;
  throw new CliFailure(EXIT.unavailable, "unavailable", "No local port is available in the requested range.");
}

function executable(name: string): string {
  return path.resolve(`node_modules/.bin/${process.platform === "win32" ? `${name}.cmd` : name}`);
}

async function packageVersion(): Promise<string> {
  const manifestPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..", "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { version?: unknown };
  if (typeof manifest.version !== "string" || manifest.version.length > 128
    || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(manifest.version)) {
    throw new Error("invalid package version");
  }
  return manifest.version;
}

async function openBrowser(url: string): Promise<boolean> {
  const [command, args] = process.platform === "darwin" ? ["open", [url]] as const : ["xdg-open", [url]] as const;
  return await new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.once("error", () => resolve(false));
    child.once("spawn", () => { child.unref(); resolve(true); });
  });
}

function stopChild(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  try { process.platform === "win32" ? child.kill(signal) : process.kill(-child.pid, signal); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
}

export async function launchEditor(options: LaunchOptions, io: CliIo): Promise<number> {
  const workspace = await realpath(options.workspace).catch(() => { throw new CliFailure(EXIT.usage, "invalid", "Workspace is not readable."); });
  await access(workspace, constants.R_OK).catch(() => { throw new CliFailure(EXIT.usage, "invalid", "Workspace is not readable."); });
  const apiPort = await availablePort(options.port);
  const editorPort = options.development ? await availablePort(5173) : apiPort;
  const editorUrl = `http://lineage-logo.localhost:${editorPort}`;
  const environment = {
    ...process.env,
    LINEAGE_LOGO_CLIENT_PORT: String(editorPort),
    LINEAGE_LOGO_PORT: String(apiPort),
    LINEAGE_LOGO_EDITOR_ORIGIN: options.development ? `http://127.0.0.1:${editorPort}` : editorUrl,
  };
  const children = options.development
    ? [
      spawn(executable("vite"), ["--host", "127.0.0.1", "--port", String(editorPort), "--strictPort"], { detached: process.platform !== "win32", env: environment, stdio: ["ignore", "ignore", "pipe"] }),
      spawn(executable("tsx"), ["src/server/index.ts", "--workspace", workspace, "--port", String(apiPort)], { detached: process.platform !== "win32", env: environment, stdio: ["ignore", "ignore", "pipe"] }),
    ]
    : [spawn(process.execPath, [path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../server/index.js"), "--workspace", workspace, "--port", String(apiPort)], {
      detached: process.platform !== "win32", env: environment, stdio: ["ignore", "ignore", "pipe"],
    })];
  if (options.json) output(io, true, { schemaVersion: 1, command: "launch", ok: true, status: "ok", message: "Lineage Logo editor started.", url: editorUrl });
  else io.stdout(`Lineage Logo editor: ${editorUrl}`);
  if (options.open && !await openBrowser(editorUrl)) io.stderr(`Could not open a browser. Open ${editorUrl} manually.`);
  const shutdown = (signal: NodeJS.Signals) => children.forEach((child) => stopChild(child, signal));
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  const codes = await Promise.all(children.map((child) => new Promise<number>((resolve) => {
    child.stderr?.on("data", () => io.stderr("A Lineage Logo service reported an error."));
    child.once("error", () => resolve(EXIT.unavailable));
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 0 : EXIT.unavailable)));
  })));
  shutdown("SIGTERM");
  return codes.find((code) => code !== 0) ?? EXIT.success;
}

function selector(args: ParsedArguments): ResolveOptions {
  const workspace = value(args, "workspace");
  const instance = value(args, "instance");
  if (workspace && instance) throw new CliFailure(EXIT.usage, "invalid", "Use either --workspace or --instance, not both.");
  return { workspace, instance, legacyContext: value(args, "legacy-context") };
}

function outcomeExit(outcome: AgentProducerOutcome): { exitCode: number; status: OutputStatus; message: string } {
  if (outcome.status === "reverted") return { exitCode: EXIT.rejected, status: "rejected", message: "Proposal was rejected by the reviewer." };
  if (outcome.status === "rejected") return { exitCode: EXIT.usage, status: "invalid", message: "Proposal was rejected by validation." };
  if (outcome.status === "stale" || outcome.status === "conflict" || outcome.status === "timeout") return { exitCode: EXIT.conflict, status: "conflict", message: "Proposal expired or conflicted before it could be saved." };
  if (outcome.status === "unavailable" || outcome.status === "disconnected") return { exitCode: EXIT.unavailable, status: "unavailable", message: "The selected editor became unavailable." };
  const artifact = (outcome as { artifact?: { durablePath?: unknown; digest?: unknown } }).artifact;
  if (!artifact || typeof artifact.durablePath !== "string" || path.isAbsolute(artifact.durablePath)
    || artifact.durablePath.split(/[\\/]/).includes("..") || !/^[a-f0-9]{64}$/.test(String(artifact.digest))) {
    return { exitCode: EXIT.conflict, status: "conflict", message: "Changes were applied but no durable save receipt was returned." };
  }
  return { exitCode: EXIT.success, status: "ok", message: `Saved ${artifact.durablePath}.` };
}

async function runSubmit(args: ParsedArguments, io: CliIo, dependencies: CliDependencies): Promise<number> {
  const artifactPath = requireValue(args, "artifact");
  const proposalPath = requireValue(args, "proposal");
  const artifactSvg = await readFile(artifactPath, "utf8").catch(() => { throw new CliFailure(EXIT.usage, "invalid", "Artifact is not readable."); });
  try { validateCleanAgentSvg(artifactSvg); } catch { throw new CliFailure(EXIT.usage, "invalid", "Artifact is not a safe SVG."); }
  let transaction: AgentTransactionV1;
  try { transaction = parseAgentTransaction(JSON.parse(await readFile(proposalPath, "utf8")) as unknown); }
  catch { throw new CliFailure(EXIT.usage, "invalid", "Proposal is not a valid transaction."); }
  const instance = await resolveSelected(dependencies.resolveInstance ?? defaultResolver, selector(args));
  if (value(args, "legacy-context")) progress(io, args.quiet, "Warning: legacy context discovery is deprecated.");
  progress(io, args.quiet, `Selected ${sanitizedSelection(instance)}.`);
  progress(io, args.quiet, "Waiting for human review…");
  const outcome = await instance.client.submitAndWait(transaction).catch(() => ({ status: "unavailable", transactionId: transaction.transactionId, message: "Canvas is unavailable." }) as AgentProducerOutcome);
  const mapped = outcomeExit(outcome);
  const accepted = outcome.status === "accepted" ? outcome.artifact as unknown as { durablePath?: string; digest?: string; svg?: string } : undefined;
  output(io, args.json, {
    schemaVersion: 1, command: "submit", ok: mapped.exitCode === 0, status: mapped.status, message: mapped.message,
    ...(mapped.exitCode === 0 ? { artifact: { path: accepted!.durablePath, digest: accepted!.digest, ...(args.options.has("include-svg") ? { svg: accepted!.svg } : {}) } } : {}),
  });
  return mapped.exitCode;
}

async function runDoctor(args: ParsedArguments, io: CliIo, dependencies: CliDependencies): Promise<number> {
  const checks: Array<{ name: string; ok: boolean; message: string }> = [];
  const major = Number((dependencies.nodeVersion ?? process.versions.node).split(".")[0]);
  checks.push({ name: "runtime", ok: major >= 22, message: major >= 22 ? "Node.js runtime is supported." : "Node.js 22 or newer is required." });
  const cliPath = fileURLToPath(import.meta.url);
  const runtimeRoot = path.resolve(path.dirname(cliPath), "..");
  const packageRoot = path.resolve(runtimeRoot, "..");
  const sourceMode = path.extname(cliPath) === ".ts";
  const packageFiles = [
    path.join(packageRoot, "package.json"),
    path.join(packageRoot, "examples/seatify-constellation.svg"),
    path.join(runtimeRoot, "server", `index.${sourceMode ? "ts" : "js"}`),
    path.join(runtimeRoot, "client", "index.html"),
  ];
  const packageOk = await Promise.all(packageFiles.map((file) => access(file, constants.R_OK).then(() => true).catch(() => false)))
    .then((results) => results.every(Boolean));
  checks.push({ name: "package", ok: packageOk, message: packageOk ? "Package runtime is complete." : "Package runtime is incomplete; reinstall Lineage Logo." });
  const workspace = value(args, "workspace");
  if (workspace) {
    const readable = await realpath(workspace).then((target) => access(target, constants.R_OK).then(() => true)).catch(() => false);
    checks.push({ name: "workspace", ok: readable, message: readable ? "Workspace is readable." : "Workspace is not readable." });
  }
  try {
    const instance = await (dependencies.resolveInstance ?? defaultResolver)(selector(args));
    const origin = new URL(instance.editorOrigin);
    const originOk = origin.protocol === "http:" && origin.hostname.endsWith(".localhost") && !origin.username && !origin.password;
    checks.push({ name: "instance", ok: originOk, message: originOk ? `Authenticated editor ${sanitizedSelection(instance)} is available.` : "Editor identity is unsafe." });
  } catch {
    checks.push({ name: "instance", ok: false, message: "No matching authenticated editor is available." });
  }
  const ok = checks.every((check) => check.ok);
  const result: CliResult = { schemaVersion: 1, command: "doctor", ok, status: ok ? "ok" : "unavailable", message: ok ? "Lineage Logo is ready." : "Lineage Logo needs attention.", checks };
  output(io, args.json, result);
  if (!args.json) checks.forEach((check) => io.stdout(`${check.ok ? "PASS" : "FAIL"} ${check.message}`));
  return ok ? EXIT.success : EXIT.unavailable;
}

export async function runLineageCli(argv: string[], io: CliIo = {
  stdout: (line) => process.stdout.write(`${line}\n`), stderr: (line) => process.stderr.write(`${line}\n`),
}, dependencies: CliDependencies = {}): Promise<number> {
  let args: ParsedArguments;
  try { args = parse(argv); }
  catch (error) {
    const failure = error as CliFailure;
    if (argv.includes("--json")) {
      const command = argv.find((argument) => ["launch", "submit", "doctor"].includes(argument)) as CommandName | undefined;
      output(io, true, { schemaVersion: 1, command: command ?? "doctor", ok: false, status: failure.status ?? "invalid", message: failure.message });
    } else io.stderr(failure.message);
    return failure.exitCode ?? EXIT.internal;
  }
  if (args.version) {
    try { io.stdout(await packageVersion()); return EXIT.success; }
    catch { io.stderr("Installed package metadata is invalid."); return EXIT.internal; }
  }
  if (args.help || !args.command) { io.stdout(HELP); return args.help ? EXIT.success : EXIT.usage; }
  try {
    validateCommandOptions(args);
    if (args.command === "launch") {
      const workspace = requireValue(args, "workspace");
      const exitCode = await (dependencies.launch ?? launchEditor)({ workspace, port: parsePort(value(args, "port")), open: !args.options.has("no-open"), development: args.options.has("development"), json: args.json }, io);
      return exitCode;
    }
    if (args.command === "submit") return await runSubmit(args, io, dependencies);
    return await runDoctor(args, io, dependencies);
  } catch (error) {
    const failure = error instanceof CliFailure ? error : new CliFailure(EXIT.internal, "error", "Unexpected internal failure.");
    output(io, args.json, { schemaVersion: 1, command: args.command, ok: false, status: failure.status, message: failure.message });
    return failure.exitCode;
  }
}
