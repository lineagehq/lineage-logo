import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AGENT_MAX_PAYLOAD_BYTES, AgentProtocolError, parseAgentTransaction,
  type AgentAcknowledgement, type AgentDocumentManifest, type AgentErrorCode, type AgentTerminalDecision, type AgentTransactionResult, type AgentTransactionStatus,
  type AgentTransactionV1,
} from "../shared/agent-protocol.js";
import { HttpError, readBody, readJsonBody, requireOrigin, sendJson } from "./http.js";

interface RegistryEntry {
  hash: string;
  transaction: AgentTransactionV1;
  state: AgentTransactionStatus;
  eventId?: number;
  timer?: ReturnType<typeof setTimeout>;
}
interface EventRecord { id: number; transactionId: string; data: string }

const AGENT_ERROR_CODES = new Set<AgentErrorCode>([
  "invalid_payload", "payload_too_large", "unsupported_version", "unknown_operation", "unknown_field",
  "invalid_reference", "stale_document", "missing_target", "ambiguous_target", "locked_target", "invalid_svg",
  "unsafe_svg", "id_conflict", "reference_damage", "invalid_paint", "no_op", "pending_transaction",
]);

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
  deliveryTimeoutMs?: number;
  reviewTimeoutMs?: number;
  heartbeatMs?: number;
  maxRegistry?: number;
  maxBacklog?: number;
}

export class AgentTransport {
  readonly #token: Buffer;
  readonly #editorOrigin: string;
  readonly #deliveryTimeoutMs: number;
  readonly #reviewTimeoutMs: number;
  readonly #heartbeatMs: number;
  readonly #maxRegistry: number;
  readonly #maxBacklog: number;
  readonly #registry = new Map<string, RegistryEntry>();
  readonly #events: EventRecord[] = [];
  readonly #clients = new Set<ServerResponse>();
  #document?: AgentDocumentManifest;
  #nextEventId = 1;

  constructor(options: AgentTransportOptions) {
    if (!options.token) throw new Error("Agent bearer token must not be empty.");
    this.#token = Buffer.from(options.token);
    this.#editorOrigin = options.editorOrigin;
    this.#deliveryTimeoutMs = options.deliveryTimeoutMs ?? 15_000;
    this.#reviewTimeoutMs = options.reviewTimeoutMs ?? 30 * 60_000;
    // Stay below the shortest common five-second development proxy/HTTP idle
    // timeout so the browser does not reconnect while a producer submits.
    this.#heartbeatMs = options.heartbeatMs ?? 2_000;
    this.#maxRegistry = options.maxRegistry ?? 500;
    this.#maxBacklog = options.maxBacklog ?? 200;
  }

  get size(): number { return this.#registry.size; }

  async route(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith("/api/agent/")) return false;
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
      const value = await readJsonBody(request, 1024 * 1024) as AgentDocumentManifest;
      if (!value || typeof value.sessionId !== "string" || typeof value.sourcePath !== "string" || !Number.isSafeInteger(value.revision) || !Array.isArray(value.layers)) {
        throw new HttpError(400, "Document manifest is invalid.");
      }
      this.#document = value;
      sendJson(response, 200, { status: "synchronized" });
      return true;
    }
    if (request.method === "GET" && url.pathname === "/api/agent/events") {
      requireOrigin(request, this.#editorOrigin);
      this.#connect(request, response);
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
      await this.#acknowledge(decodeURIComponent(match[1]), request, response);
      return true;
    }
    throw new HttpError(404, "Unknown agent endpoint.");
  }

  close(): void {
    for (const entry of this.#registry.values()) if (entry.timer) clearTimeout(entry.timer);
    for (const client of this.#clients) client.end();
    this.#clients.clear();
  }

  #authenticate(request: IncomingMessage): void {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new HttpError(401, "A bearer token is required.");
    const supplied = Buffer.from(header.slice(7));
    if (supplied.length !== this.#token.length || !timingSafeEqual(supplied, this.#token)) throw new HttpError(401, "Bearer token is invalid.");
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
    if (this.#registry.size >= this.#maxRegistry || this.#events.length >= this.#maxBacklog) throw new HttpError(503, "Agent transaction backlog is full.");
    const entry: RegistryEntry = { hash, transaction, state: { transactionId: transaction.transactionId, status: "queued" } };
    this.#registry.set(transaction.transactionId, entry);
    const event: EventRecord = { id: this.#nextEventId++, transactionId: transaction.transactionId, data: JSON.stringify(transaction) };
    entry.eventId = event.id;
    this.#events.push(event);
    for (const client of this.#clients) this.#deliver(client, event, entry);
    sendJson(response, 202, entry.state);
  }

  #connect(request: IncomingMessage, response: ServerResponse): void {
    // The local MVP has one authoritative open editor. Development proxies can
    // retain an upstream SSE response briefly after its browser closes, so a
    // newer stream must replace older subscribers instead of letting a stale
    // response claim the one permitted transaction delivery.
    // A newer authoritative editor connection owns every frame that the old
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
    this.#clients.add(response);
    const lastIdHeader = request.headers["last-event-id"];
    const lastId = typeof lastIdHeader === "string" && /^\d+$/.test(lastIdHeader) ? Number(lastIdHeader) : 0;
    for (const entry of this.#registry.values()) if (entry.state.status === "disconnected") {
      entry.state = { transactionId: entry.transaction.transactionId, status: "queued" };
    }
    for (const event of this.#events) {
      const entry = this.#registry.get(event.transactionId);
      if (event.id > lastId && entry?.state.status === "queued") this.#deliver(response, event, entry);
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
    };
    // A proxy may finish its upstream request object as soon as the GET headers
    // have been forwarded while continuing to stream the response. The SSE
    // subscriber is gone only when the response closes.
    response.once("close", disconnect);
  }

  #deliver(response: ServerResponse, event: EventRecord, entry: RegistryEntry): void {
    if (entry.state.status !== "queued") return;
    if (entry.timer) clearTimeout(entry.timer);
    response.write(`id: ${event.id}\nevent: transaction\ndata: ${event.data}\n\n`);
    entry.state = { transactionId: event.transactionId, status: "delivered" };
    entry.timer = setTimeout(() => {
      if (entry.state.status === "delivered") entry.state = {
        transactionId: event.transactionId,
        status: "rejected",
        result: { transactionId: event.transactionId, status: "rejected", error: { code: "stale_document", message: "Editor did not acknowledge delivery before the timeout." } },
      };
    }, this.#deliveryTimeoutMs);
  }

  #pruneEvent(entry: RegistryEntry): void {
    if (entry.eventId === undefined) return;
    const index = this.#events.findIndex((event) => event.id === entry.eventId);
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

  #parseAcknowledgement(value: unknown, transactionId: string): AgentAcknowledgement {
    const input = exactObject(value, ["transactionId", "status", "error", "impact"], ["transactionId", "status"], "Acknowledgement");
    if (input.transactionId !== transactionId || typeof input.status !== "string") throw new HttpError(400, "Acknowledgement is invalid.");
    if (input.status === "accepted" || input.status === "reverted") {
      if (Object.keys(input).length !== 2) throw new HttpError(400, "Terminal decision contains unknown fields.");
      return { transactionId, status: input.status };
    }
    if (input.status === "rejected") {
      if (Object.keys(input).length !== 3) throw new HttpError(400, "Rejected acknowledgement has invalid fields.");
      const error = exactObject(input.error, ["code", "message", "operationId", "path"], ["code", "message"], "Acknowledgement error");
      if (typeof error.code !== "string" || !AGENT_ERROR_CODES.has(error.code as AgentErrorCode) || typeof error.message !== "string" || error.message.length === 0) {
        throw new HttpError(400, "Acknowledgement error is invalid.");
      }
      if ((error.operationId !== undefined && typeof error.operationId !== "string") || (error.path !== undefined && typeof error.path !== "string")) {
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
      return input as unknown as AgentTransactionResult;
    }
    throw new HttpError(400, "Acknowledgement status is invalid.");
  }

  async #acknowledge(transactionId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const entry = this.#registry.get(transactionId);
    if (!entry) throw new HttpError(404, "Unknown transaction ID.");
    const acknowledgement = this.#parseAcknowledgement(await readJsonBody(request, 1024 * 1024), transactionId);
    if (acknowledgement.status === "accepted" || acknowledgement.status === "reverted") {
      const decision = acknowledgement as AgentTerminalDecision;
      if (entry.state.status === decision.status) {
        sendJson(response, 200, entry.state);
        return;
      }
      if (entry.state.status === "accepted" || entry.state.status === "reverted") {
        throw new HttpError(409, `Transaction is already ${entry.state.status}.`);
      }
      if (entry.state.status !== "pending_review") throw new HttpError(409, `Cannot ${decision.status === "accepted" ? "accept" : "revert"} transaction from ${entry.state.status}.`);
      if (entry.timer) clearTimeout(entry.timer);
      entry.state = { ...entry.state, status: decision.status };
      this.#pruneEvent(entry);
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
    else if (result.status === "applied") status = "accepted";
    else if ("error" in result) status = result.error.code === "stale_document" ? "stale" : "rejected";
    else throw new HttpError(400, "Acknowledgement status is invalid.");
    entry.state = { transactionId, status, result };
    this.#pruneEvent(entry);
    if (status === "pending_review") {
      entry.timer = setTimeout(() => {
        if (entry.state.status === "pending_review") entry.state = { ...entry.state, status: "reverted" };
      }, this.#reviewTimeoutMs);
    }
    sendJson(response, 200, entry.state);
  }
}
