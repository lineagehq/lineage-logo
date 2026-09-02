import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AGENT_ERROR_CODES, AGENT_MAX_ACKNOWLEDGEMENT_BYTES, AGENT_MAX_PAYLOAD_BYTES, AGENT_MAX_SOURCE_PATH_CHARACTERS, AgentProtocolError, parseAgentTransaction, validateCleanAgentSvg,
  type AgentAcceptedArtifact, type AgentAcknowledgement, type AgentDocumentManifest, type AgentErrorCode, type AgentTerminalDecision, type AgentTransactionResult, type AgentTransactionStatus,
  type AgentTransactionV1,
} from "../shared/agent-protocol.js";
import type { AgentInstanceIdentity } from "../shared/instance-registry.js";
import { HttpError, readBody, readJsonBody, requireEventStreamOrigin, requireOrigin, sendJson } from "./http.js";
import { saveAgentContinuation } from "./workspace.js";

interface RegistryEntry {
  hash: string;
  transaction: AgentTransactionV1;
  state: AgentTransactionStatus;
  eventId?: number;
  timer?: ReturnType<typeof setTimeout>;
}
type EventRecord =
  | { id: number; kind: "transaction"; transactionId: string; data: string }
  | { id: number; kind: "terminal"; transactionId: string; data: string };

function exactObject(value: unknown, allowed: string[], required: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, `${label} is invalid.`);
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !allowed.includes(key)) || required.some((key) => !(key in input))) {
    throw new HttpError(400, `${label} has invalid fields.`);
  }
  return input;
}

export interface AgentTransportOptions {
  token: string;
  editorOrigin: string;
  identity?: AgentInstanceIdentity;
  allowUnboundProducer?: boolean;
  deliveryTimeoutMs?: number;
  reviewTimeoutMs?: number;
  heartbeatMs?: number;
  maxRegistry?: number;
  maxBacklog?: number;
  editorReleaseMs?: number;
  workspaceRoot?: string;
}

const EDITOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EDITOR_ID_HEADER = "x-lineage-editor-id";

export class AgentTransport {
  readonly #token: Buffer;
  readonly #editorOrigin: string;
  readonly #identity?: AgentInstanceIdentity;
  readonly #allowUnboundProducer: boolean;
  readonly #deliveryTimeoutMs: number;
  readonly #reviewTimeoutMs: number;
  readonly #heartbeatMs: number;
  readonly #maxRegistry: number;
  readonly #maxBacklog: number;
  readonly #editorReleaseMs: number;
  readonly #workspaceRoot?: string;
  readonly #registry = new Map<string, RegistryEntry>();
  readonly #events: EventRecord[] = [];
  readonly #clients = new Set<ServerResponse>();
  readonly #serverInstanceId = randomUUID();
  #document?: AgentDocumentManifest;
  #editorId?: string;
  #editorReleaseTimer?: ReturnType<typeof setTimeout>;
  #nextEventId = 1;

  constructor(options: AgentTransportOptions) {
    if (!options.token) throw new Error("Agent bearer token must not be empty.");
    this.#token = Buffer.from(options.token);
    this.#editorOrigin = options.editorOrigin;
    this.#identity = options.identity;
    this.#allowUnboundProducer = options.allowUnboundProducer ?? false;
    this.#deliveryTimeoutMs = options.deliveryTimeoutMs ?? 15_000;
    this.#reviewTimeoutMs = options.reviewTimeoutMs ?? 30 * 60_000;
    // Stay below the shortest common five-second development proxy/HTTP idle
    // timeout so the browser does not reconnect while a producer submits.
    this.#heartbeatMs = options.heartbeatMs ?? 2_000;
    this.#maxRegistry = options.maxRegistry ?? 500;
    this.#maxBacklog = options.maxBacklog ?? 200;
    this.#editorReleaseMs = options.editorReleaseMs ?? 500;
    const workspaceArgument = process.argv.indexOf("--workspace");
    this.#workspaceRoot = options.workspaceRoot ?? (workspaceArgument >= 0 ? process.argv[workspaceArgument + 1] : undefined);
  }

  get size(): number { return this.#registry.size; }

  async route(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith("/api/agent/")) return false;
    if (request.method === "GET" && url.pathname === "/api/agent/identity") {
      this.#authenticate(request, false);
      if (!this.#identity) throw new HttpError(404, "Instance identity is unavailable.");
      sendJson(response, 200, this.#identity);
      return true;
    }
    if (request.method === "POST" && url.pathname === "/api/agent/transactions") {
      this.#authenticate(request);
      await this.#submit(request, response);
      return true;
    }
    if (request.method === "GET" && url.pathname === "/api/agent/document") {
      this.#authenticate(request);
      if (!this.#document) throw new HttpError(404, "No SVG document is open in the editor.");
      sendJson(response, 200, this.#document);
      return true;
    }
    if (request.method === "POST" && url.pathname === "/api/agent/document") {
      requireOrigin(request, this.#editorOrigin);
      this.#claimEditor(request);
      const value = await readJsonBody(request, 1024 * 1024) as AgentDocumentManifest;
      if (!value || typeof value.sessionId !== "string" || typeof value.sourcePath !== "string" || !Number.isSafeInteger(value.revision) || !Array.isArray(value.layers)) {
        throw new HttpError(400, "Document manifest is invalid.");
      }
      this.#document = value;
      sendJson(response, 200, { status: "synchronized" });
      return true;
    }
    if (request.method === "POST" && url.pathname === "/api/agent/recovery") {
      requireOrigin(request, this.#editorOrigin);
      this.#claimEditor(request);
      await this.#recover(request, response);
      return true;
    }
    if (request.method === "GET" && url.pathname === "/api/agent/events") {
      requireEventStreamOrigin(request, this.#editorOrigin);
      const editorId = this.#claimEditor(request);
      this.#connect(request, response, editorId);
      return true;
    }
    const match = /^\/api\/agent\/transactions\/([^/]+)(?:\/ack)?$/.exec(url.pathname);
    if (match && request.method === "GET" && !url.pathname.endsWith("/ack")) {
      this.#authenticate(request);
      const entry = this.#registry.get(decodeURIComponent(match[1]));
      if (!entry) throw new HttpError(404, "Unknown transaction ID.");
      sendJson(response, 200, entry.state);
      return true;
    }
    if (match && request.method === "POST" && url.pathname.endsWith("/ack")) {
      requireOrigin(request, this.#editorOrigin);
      this.#claimEditor(request);
      await this.#acknowledge(decodeURIComponent(match[1]), request, response);
      return true;
    }
    throw new HttpError(404, "Unknown agent endpoint.");
  }

  close(): void {
    if (this.#editorReleaseTimer) clearTimeout(this.#editorReleaseTimer);
    for (const entry of this.#registry.values()) if (entry.timer) clearTimeout(entry.timer);
    for (const client of this.#clients) client.end();
    this.#clients.clear();
  }

  #claimEditor(request: IncomingMessage): string {
    const editorId = request.headers[EDITOR_ID_HEADER];
    if (typeof editorId !== "string" || !EDITOR_ID.test(editorId)) throw new HttpError(400, "Editor tab identity is invalid.");
    if (this.#editorId && this.#editorId !== editorId) {
      throw new HttpError(409, "Another Lineage tab owns the agent connection. Close that tab before retrying here.");
    }
    this.#editorId = editorId;
    if (this.#editorReleaseTimer) {
      clearTimeout(this.#editorReleaseTimer);
      this.#editorReleaseTimer = undefined;
    }
    return editorId;
  }

  #authenticate(request: IncomingMessage, requireBinding = true): void {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new HttpError(401, "A bearer token is required.");
    const supplied = Buffer.from(header.slice(7));
    if (supplied.length !== this.#token.length || !timingSafeEqual(supplied, this.#token)) throw new HttpError(401, "Bearer token is invalid.");
    if (requireBinding && this.#identity && !this.#allowUnboundProducer) {
      if (request.headers["x-lineage-instance-id"] !== this.#identity.instanceId
        || request.headers["x-lineage-workspace-id"] !== this.#identity.workspaceId) {
        throw new HttpError(409, "Agent request identity does not match this editor instance.");
      }
    }
  }

  async #recover(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const input = exactObject(await readJsonBody(request, AGENT_MAX_SOURCE_PATH_CHARACTERS * 4 + 1024),
      ["transactionId", "sessionId", "sourcePath", "revision"],
      ["transactionId", "sessionId", "sourcePath", "revision"], "Recovery identity");
    if (typeof input.transactionId !== "string" || typeof input.sessionId !== "string"
      || typeof input.sourcePath !== "string" || !Number.isSafeInteger(input.revision)) {
      throw new HttpError(400, "Recovery identity is invalid.");
    }
    const entry = this.#registry.get(input.transactionId);
    if (!entry) {
      sendJson(response, 200, { serverInstanceId: this.#serverInstanceId, transactionId: input.transactionId, status: "unknown" });
      return;
    }
    if (entry.transaction.document.sessionId !== input.sessionId
      || entry.transaction.document.sourcePath !== input.sourcePath
      || entry.transaction.document.baseRevision !== input.revision) {
      throw new HttpError(409, "Recovery identity does not match the recorded transaction.");
    }
    if (!new Set(["pending_review", "accepted", "reverted", "rejected", "stale"]).has(entry.state.status)) {
      throw new HttpError(409, `Transaction cannot be recovered from ${entry.state.status}.`);
    }
    sendJson(response, 200, {
      serverInstanceId: this.#serverInstanceId,
      transaction: entry.transaction,
      state: entry.state,
    });
  }

  async #submit(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const contentType = request.headers["content-type"] ?? "";
    if (!contentType.toLowerCase().startsWith("application/json")) throw new HttpError(415, "Request body must use application/json.");
    const raw = await readBody(request, AGENT_MAX_PAYLOAD_BYTES);
    const hash = createHash("sha256").update(raw).digest("hex");
    let transaction: AgentTransactionV1;
    try { transaction = parseAgentTransaction(raw.toString("utf8")); }
    catch (error) {
      if (error instanceof AgentProtocolError) throw new HttpError(error.detail.code === "payload_too_large" ? 413 : 400, error.detail.message);
      throw error;
    }
    const existing = this.#registry.get(transaction.transactionId);
    if (existing) {
      if (existing.hash !== hash) throw new HttpError(409, "Transaction ID was already used with a different payload.");
      sendJson(response, 200, existing.state);
      return;
    }
    this.#pruneRegistry();
    if (this.#registry.size >= this.#maxRegistry || this.#events.filter((event) => event.kind === "transaction").length >= this.#maxBacklog) {
      throw new HttpError(503, "Agent transaction backlog is full.");
    }
    const entry: RegistryEntry = { hash, transaction, state: { transactionId: transaction.transactionId, status: "queued" } };
    this.#registry.set(transaction.transactionId, entry);
    const event: EventRecord = { id: this.#nextEventId++, kind: "transaction", transactionId: transaction.transactionId, data: JSON.stringify(transaction) };
    entry.eventId = event.id;
    this.#events.push(event);
    for (const client of this.#clients) this.#deliver(client, event, entry);
    sendJson(response, 202, entry.state);
  }

  #connect(request: IncomingMessage, response: ServerResponse, editorId: string): void {
    // The local MVP has one authoritative open editor. Development proxies can
    // retain an upstream SSE response briefly after its browser closes, so a
    // newer same-tab stream must replace older subscribers instead of letting a
    // stale response claim the one permitted transaction delivery.
    // A newer same-tab connection owns every frame that the old
    // response had not acknowledged. Requeue before ending old responses;
    // their asynchronous close events may run after this client is installed.
    for (const entry of this.#registry.values()) {
      if (entry.state.status !== "delivered") continue;
      if (entry.timer) clearTimeout(entry.timer);
      entry.state = { transactionId: entry.transaction.transactionId, status: "queued" };
    }
    for (const client of this.#clients) client.end();
    this.#clients.clear();
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no",
    });
    response.flushHeaders();
    response.write(": connected\nretry: 50\n\n");
    response.write(`event: server-instance\ndata: ${JSON.stringify({ serverInstanceId: this.#serverInstanceId })}\n\n`);
    this.#clients.add(response);
    const lastIdHeader = request.headers["last-event-id"];
    const lastId = typeof lastIdHeader === "string" && /^\d+$/.test(lastIdHeader) ? Number(lastIdHeader) : 0;
    for (const entry of this.#registry.values()) if (entry.state.status === "disconnected") {
      entry.state = { transactionId: entry.transaction.transactionId, status: "queued" };
    }
    for (const event of this.#events) {
      const entry = this.#registry.get(event.transactionId);
      if (event.id <= lastId || !entry) continue;
      if (event.kind === "transaction" && entry.state.status === "queued") this.#deliver(response, event, entry);
      else if (event.kind === "transaction" && entry.state.status === "pending_review" && this.#matchesOpenDocument(entry.transaction)) {
        // A fresh browser transport has no SSE cursor or detached candidate.
        // Replay the original, byte-identical transaction without moving the
        // authoritative lifecycle out of pending_review. Its duplicate staged
        // acknowledgement is accepted only when it exactly matches the first.
        this.#writeEvent(response, event);
      }
      else if (event.kind === "terminal" && entry.state.status === JSON.parse(event.data).status) this.#writeEvent(response, event);
    }
    const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), this.#heartbeatMs);
    const disconnect = () => {
      clearInterval(heartbeat);
      this.#clients.delete(response);
      if (this.#clients.size === 0) for (const entry of this.#registry.values()) {
        if (entry.state.status === "delivered") {
          if (entry.timer) clearTimeout(entry.timer);
          entry.state = { transactionId: entry.transaction.transactionId, status: "queued" };
          entry.timer = setTimeout(() => {
            if (this.#clients.size === 0 && entry.state.status === "queued") {
              entry.state = { transactionId: entry.transaction.transactionId, status: "disconnected" };
            }
          }, 250);
        }
      }
      if (this.#clients.size === 0 && this.#editorId === editorId) {
        if (this.#editorReleaseTimer) clearTimeout(this.#editorReleaseTimer);
        this.#editorReleaseTimer = setTimeout(() => {
          if (this.#clients.size === 0 && this.#editorId === editorId) {
            this.#editorId = undefined;
            this.#document = undefined;
          }
          this.#editorReleaseTimer = undefined;
        }, this.#editorReleaseMs);
      }
    };
    // A proxy may finish its upstream request object as soon as the GET headers
    // have been forwarded while continuing to stream the response. The SSE
    // subscriber is gone only when the response closes.
    response.once("close", disconnect);
  }

  #matchesOpenDocument(transaction: AgentTransactionV1): boolean {
    return this.#document?.sessionId === transaction.document.sessionId
      && this.#document.sourcePath === transaction.document.sourcePath
      && this.#document.revision === transaction.document.baseRevision;
  }

  #writeEvent(response: ServerResponse, event: EventRecord): void {
    response.write(`id: ${event.id}\nevent: ${event.kind === "transaction" ? "transaction" : "transaction-terminal"}\ndata: ${event.data}\n\n`);
  }

  #deliver(response: ServerResponse, event: Extract<EventRecord, { kind: "transaction" }>, entry: RegistryEntry): void {
    if (entry.state.status !== "queued") return;
    if (entry.timer) clearTimeout(entry.timer);
    this.#writeEvent(response, event);
    entry.state = { transactionId: event.transactionId, status: "delivered" };
    entry.timer = setTimeout(() => {
      if (entry.state.status === "delivered") {
        entry.state = {
          transactionId: event.transactionId,
          status: "rejected",
          result: { transactionId: event.transactionId, status: "rejected", error: { code: "stale_document", message: "Editor did not acknowledge delivery before the timeout." } },
        };
        this.#pruneEvent(entry);
        this.#emitTerminal(event.transactionId, "rejected");
      }
    }, this.#deliveryTimeoutMs);
  }

  #emitTerminal(transactionId: string, status: "accepted" | "reverted" | "rejected" | "stale"): void {
    const event: EventRecord = {
      id: this.#nextEventId++, kind: "terminal", transactionId,
      data: JSON.stringify({ transactionId, status }),
    };
    this.#events.push(event);
    while (this.#events.filter((item) => item.kind === "terminal").length > this.#maxBacklog) {
      const terminalIndex = this.#events.findIndex((item) => item.kind === "terminal");
      if (terminalIndex < 0) break;
      this.#events.splice(terminalIndex, 1);
    }
    for (const client of this.#clients) this.#writeEvent(client, event);
  }

  #pruneEvent(entry: RegistryEntry): void {
    if (entry.eventId === undefined) return;
    const index = this.#events.findIndex((event) => event.kind === "transaction" && event.id === entry.eventId);
    if (index >= 0) this.#events.splice(index, 1);
  }

  #pruneRegistry(): void {
    if (this.#registry.size < this.#maxRegistry) return;
    const terminal = new Set(["accepted", "reverted", "rejected", "stale"]);
    for (const [id, entry] of this.#registry) {
      if (!terminal.has(entry.state.status)) continue;
      if (entry.timer) clearTimeout(entry.timer);
      this.#pruneEvent(entry);
      this.#registry.delete(id);
      if (this.#registry.size < this.#maxRegistry) return;
    }
  }

  #parseAcknowledgement(value: unknown, transaction: AgentTransactionV1): AgentAcknowledgement {
    const transactionId = transaction.transactionId;
    const operationIds = new Set(transaction.operations.map((operation) => operation.operationId));
    const input = exactObject(value, ["transactionId", "status", "error", "impact", "artifact"], ["transactionId", "status"], "Acknowledgement");
    if (input.transactionId !== transactionId || typeof input.status !== "string") throw new HttpError(400, "Acknowledgement is invalid.");
    if (input.status === "accepted") {
      if (Object.keys(input).length !== 3) throw new HttpError(400, "Accepted decision requires an artifact receipt.");
      const artifact = exactObject(input.artifact, ["sourcePath", "revision", "svg"], ["sourcePath", "revision", "svg"], "Accepted artifact");
      if (typeof artifact.sourcePath !== "string" || !Number.isSafeInteger(artifact.revision)
        || typeof artifact.svg !== "string" || artifact.svg.length === 0
        || new TextEncoder().encode(artifact.svg).byteLength > AGENT_MAX_PAYLOAD_BYTES) {
        throw new HttpError(400, "Accepted artifact is invalid.");
      }
      try { validateCleanAgentSvg(artifact.svg); }
      catch { throw new HttpError(400, "Accepted artifact SVG is not a clean standalone document."); }
      return { transactionId, status: "accepted", artifact: artifact as unknown as AgentAcceptedArtifact };
    }
    if (input.status === "reverted") {
      if (Object.keys(input).length !== 2) throw new HttpError(400, "Reverted decision contains unknown fields.");
      return { transactionId, status: "reverted" };
    }
    if (input.status === "rejected") {
      if (Object.keys(input).length !== 3) throw new HttpError(400, "Rejected acknowledgement has invalid fields.");
      const error = exactObject(input.error, ["code", "message", "operationId", "path"], ["code", "message"], "Acknowledgement error");
      if (typeof error.code !== "string" || !AGENT_ERROR_CODES.has(error.code as AgentErrorCode) || typeof error.message !== "string" || error.message.length === 0) {
        throw new HttpError(400, "Acknowledgement error is invalid.");
      }
      if ((error.operationId !== undefined && (typeof error.operationId !== "string" || !operationIds.has(error.operationId))) || (error.path !== undefined && typeof error.path !== "string")) {
        throw new HttpError(400, "Acknowledgement error is invalid.");
      }
      return input as unknown as AgentTransactionResult;
    }
    if (input.status === "staged" || input.status === "applied") {
      if (Object.keys(input).length !== 3 || !Array.isArray(input.impact)) throw new HttpError(400, "Acknowledgement impact is invalid.");
      for (const value of input.impact) {
        const item = exactObject(value, ["operationId", "affectedSessionKeys", "resultSessionKey"], ["operationId", "affectedSessionKeys"], "Acknowledgement impact");
        if (typeof item.operationId !== "string" || !Array.isArray(item.affectedSessionKeys)
          || item.affectedSessionKeys.some((key) => typeof key !== "string")
          || (item.resultSessionKey !== undefined && typeof item.resultSessionKey !== "string")) {
          throw new HttpError(400, "Acknowledgement impact is invalid.");
        }
      }
      if (input.impact.length !== transaction.operations.length
        || input.impact.some((value, index) => (value as { operationId?: unknown }).operationId !== transaction.operations[index]?.operationId)
        || input.status !== (transaction.operations.some((operation) => operation.type !== "selectFocus") ? "staged" : "applied")) {
        throw new HttpError(400, "Acknowledgement impact does not match the submitted transaction.");
      }
      return input as unknown as AgentTransactionResult;
    }
    throw new HttpError(400, "Acknowledgement status is invalid.");
  }

  async #acknowledge(transactionId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const entry = this.#registry.get(transactionId);
    if (!entry) throw new HttpError(404, "Unknown transaction ID.");
    const acknowledgement = this.#parseAcknowledgement(await readJsonBody(request, AGENT_MAX_ACKNOWLEDGEMENT_BYTES), entry.transaction);
    if (acknowledgement.status === "accepted" || acknowledgement.status === "reverted") {
      const decision = acknowledgement as AgentTerminalDecision;
      if (entry.state.status === decision.status) {
        if (decision.status === "accepted" && (!entry.state.artifact
          || entry.state.artifact.sourcePath !== decision.artifact.sourcePath
          || entry.state.artifact.revision !== decision.artifact.revision
          || entry.state.artifact.svg !== decision.artifact.svg)) {
          sendJson(response, 409, { ...entry.state, error: "Accepted artifact conflicts with the recorded receipt." });
          return;
        }
        sendJson(response, 200, entry.state);
        return;
      }
      if (entry.state.status === "accepted" || entry.state.status === "reverted") {
        sendJson(response, 409, { ...entry.state, error: `Transaction is already ${entry.state.status}.` });
        return;
      }
      if (entry.state.status !== "pending_review") {
        sendJson(response, 409, { ...entry.state, error: `Cannot ${decision.status === "accepted" ? "accept" : "revert"} transaction from ${entry.state.status}.` });
        return;
      }
      if (decision.status === "accepted"
        && (decision.artifact.sourcePath !== entry.transaction.document.sourcePath
          || decision.artifact.revision !== entry.transaction.document.baseRevision + 1)) {
        throw new HttpError(409, "Accepted artifact does not match the transaction document revision.");
      }
      if (entry.timer) clearTimeout(entry.timer);
      let artifact = decision.status === "accepted" ? decision.artifact : undefined;
      if (decision.status === "accepted" && this.#identity) {
        if (!this.#workspaceRoot) throw new HttpError(503, "Durable agent persistence is unavailable.");
        try {
          const saved = await saveAgentContinuation(this.#workspaceRoot, {
            instanceId: this.#identity.instanceId, transactionId,
            sourcePath: decision.artifact.sourcePath, revision: decision.artifact.revision, svg: decision.artifact.svg,
          });
          artifact = { ...decision.artifact, durablePath: saved.path, digest: saved.digest };
        } catch {
          throw new HttpError(503, "The applied proposal could not be saved. Retry or undo it in the editor.");
        }
      }
      entry.state = {
        ...entry.state,
        status: decision.status,
        ...(artifact ? { artifact } : {}),
      };
      this.#pruneEvent(entry);
      this.#emitTerminal(transactionId, decision.status);
      sendJson(response, 200, entry.state);
      return;
    }
    const result = acknowledgement as AgentTransactionResult;
    if (entry.state.status !== "delivered") {
      if (entry.state.result && JSON.stringify(entry.state.result) === JSON.stringify(result)) {
        sendJson(response, 200, entry.state);
        return;
      }
      throw new HttpError(409, `Cannot acknowledge delivery from ${entry.state.status}.`);
    }
    if (entry.timer) clearTimeout(entry.timer);
    let status: AgentTransactionStatus["status"];
    if (result.status === "staged") status = "pending_review";
    else if (result.status === "applied") {
      if (entry.transaction.operations.some((operation) => operation.type !== "selectFocus")) {
        throw new HttpError(400, "A mutating transaction cannot be accepted without an artifact receipt.");
      }
      status = "accepted";
    }
    else if ("error" in result) status = result.error.code === "stale_document" ? "stale" : "rejected";
    else throw new HttpError(400, "Acknowledgement status is invalid.");
    entry.state = { transactionId, status, result };
    if (status === "pending_review") {
      entry.timer = setTimeout(() => {
        if (entry.state.status === "pending_review") {
          entry.state = { ...entry.state, status: "reverted" };
          this.#pruneEvent(entry);
          this.#emitTerminal(transactionId, "reverted");
        }
      }, this.#reviewTimeoutMs);
    } else if (status === "rejected" || status === "stale") {
      this.#pruneEvent(entry);
      this.#emitTerminal(transactionId, status);
    } else {
      this.#pruneEvent(entry);
    }
    sendJson(response, 200, entry.state);
  }
}
