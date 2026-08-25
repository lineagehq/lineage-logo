import { readAgentConnectionContext, type AgentConnectionContext } from "./connection-context.js";
import {
  AGENT_MAX_PAYLOAD_BYTES,
  isAgentErrorCode, validateCleanAgentSvg,
  type AgentAcceptedArtifact, type AgentDocumentManifest, type AgentTransactionStatus, type AgentTransactionV1,
} from "../shared/agent-protocol.js";

export type AgentProducerOutcome =
  | { status: "accepted"; transactionId: string; artifact?: AgentAcceptedArtifact }
  | { status: "reverted" | "stale" | "disconnected"; transactionId: string }
  | { status: "rejected"; transactionId: string; error?: AgentTransactionStatus["result"] }
  | { status: "unavailable" | "timeout" | "conflict"; transactionId: string; message: string };

export interface AgentProducerClientOptions {
  context?: AgentConnectionContext;
  contextPath?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

function isMutating(transaction: AgentTransactionV1): boolean {
  return transaction.operations.some((operation) => operation.type !== "selectFocus");
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is malformed.`);
  return value as Record<string, unknown>;
}

function exact(input: Record<string, unknown>, allowed: string[], required: string[], label: string): void {
  if (Object.keys(input).some((key) => !allowed.includes(key)) || required.some((key) => !(key in input))) {
    throw new Error(`${label} has unexpected fields.`);
  }
}

function parseManifest(value: unknown): AgentDocumentManifest {
  const input = object(value, "Canvas manifest");
  exact(input, ["sessionId", "sourcePath", "revision", "layers"], ["sessionId", "sourcePath", "revision", "layers"], "Canvas manifest");
  if (typeof input.sessionId !== "string" || !input.sessionId || typeof input.sourcePath !== "string" || !input.sourcePath
    || !Number.isSafeInteger(input.revision) || Number(input.revision) < 0 || !Array.isArray(input.layers)) throw new Error("Canvas manifest is malformed.");
  const layers = input.layers.map((value, index) => {
    const layer = object(value, `Canvas manifest layer ${index}`);
    exact(layer, ["sessionKey", "name", "type", "locked"], ["sessionKey", "name", "type", "locked"], `Canvas manifest layer ${index}`);
    if (typeof layer.sessionKey !== "string" || !layer.sessionKey || typeof layer.name !== "string" || typeof layer.type !== "string" || typeof layer.locked !== "boolean") {
      throw new Error(`Canvas manifest layer ${index} is malformed.`);
    }
    return layer as unknown as AgentDocumentManifest["layers"][number];
  });
  if (new Set(layers.map((layer) => layer.sessionKey)).size !== layers.length) throw new Error("Canvas manifest contains duplicate session keys.");
  return { sessionId: input.sessionId, sourcePath: input.sourcePath, revision: Number(input.revision), layers };
}

function parseResult(value: unknown, transaction: AgentTransactionV1): AgentTransactionStatus["result"] {
  const result = object(value, "Transaction result");
  if (result.transactionId !== transaction.transactionId || typeof result.status !== "string") throw new Error("Transaction result identity is malformed.");
  const operationIds = new Set(transaction.operations.map((operation) => operation.operationId));
  if (result.status === "rejected") {
    exact(result, ["transactionId", "status", "error"], ["transactionId", "status", "error"], "Rejected transaction result");
    const error = object(result.error, "Transaction error");
    exact(error, ["code", "message", "operationId", "path"], ["code", "message"], "Transaction error");
    if (!isAgentErrorCode(error.code) || typeof error.message !== "string" || !error.message
      || (error.operationId !== undefined && (typeof error.operationId !== "string" || !operationIds.has(error.operationId)))
      || (error.path !== undefined && (typeof error.path !== "string" || error.path.length > 4096))) throw new Error("Transaction error is malformed.");
    return {
      transactionId: transaction.transactionId,
      status: "rejected",
      error: {
        code: error.code,
        message: "Canvas rejected the transaction.",
        ...(error.operationId === undefined ? {} : { operationId: error.operationId }),
        ...(error.path === undefined ? {} : { path: error.path }),
      },
    };
  } else if (result.status === "staged" || result.status === "applied") {
    exact(result, ["transactionId", "status", "impact"], ["transactionId", "status", "impact"], "Transaction result");
    if (!Array.isArray(result.impact)) throw new Error("Transaction result impact is malformed.");
    for (const [index, value] of result.impact.entries()) {
      const impact = object(value, `Transaction impact ${index}`);
      exact(impact, ["operationId", "affectedSessionKeys", "resultSessionKey"], ["operationId", "affectedSessionKeys"], `Transaction impact ${index}`);
      if (typeof impact.operationId !== "string" || !Array.isArray(impact.affectedSessionKeys)
        || impact.affectedSessionKeys.some((key) => typeof key !== "string")
        || (impact.resultSessionKey !== undefined && typeof impact.resultSessionKey !== "string")) throw new Error(`Transaction impact ${index} is malformed.`);
    }
    if (result.impact.length !== transaction.operations.length
      || result.impact.some((value, index) => (value as { operationId?: unknown }).operationId !== transaction.operations[index]?.operationId)) {
      throw new Error("Transaction impact does not match the submitted operation sequence.");
    }
    if ((isMutating(transaction) ? "staged" : "applied") !== result.status) throw new Error("Transaction result status does not match submitted operation semantics.");
  } else throw new Error("Transaction result status is malformed.");
  return result as unknown as AgentTransactionStatus["result"];
}

function parseArtifact(value: unknown, transaction: AgentTransactionV1): AgentAcceptedArtifact {
  const artifact = object(value, "Accepted artifact");
  exact(artifact, ["sourcePath", "revision", "svg"], ["sourcePath", "revision", "svg"], "Accepted artifact");
  if (artifact.sourcePath !== transaction.document.sourcePath || artifact.revision !== transaction.document.baseRevision + 1
    || typeof artifact.svg !== "string"
    || new TextEncoder().encode(artifact.svg).byteLength > AGENT_MAX_PAYLOAD_BYTES) {
    throw new Error("Accepted artifact does not match the submitted document revision.");
  }
  validateCleanAgentSvg(artifact.svg);
  return artifact as unknown as AgentAcceptedArtifact;
}

function parseStatus(value: unknown, transaction: AgentTransactionV1): AgentTransactionStatus {
  const input = object(value, "Transaction status");
  exact(input, ["transactionId", "status", "result", "artifact"], ["transactionId", "status"], "Transaction status");
  if (input.transactionId !== transaction.transactionId || typeof input.status !== "string"
    || !["queued", "delivered", "pending_review", "accepted", "reverted", "rejected", "stale", "disconnected"].includes(input.status)) {
    throw new Error("Transaction status identity or state is malformed.");
  }
  const result = input.result === undefined ? undefined : parseResult(input.result, transaction);
  const artifact = input.artifact === undefined ? undefined : parseArtifact(input.artifact, transaction);
  if (input.status === "accepted" && isMutating(transaction) && !artifact) throw new Error("Accepted mutation has no transaction-bound artifact receipt.");
  if (input.status !== "accepted" && artifact) throw new Error("A non-accepted status cannot include an artifact receipt.");
  if (input.status === "pending_review" && result?.status !== "staged") throw new Error("Pending review status requires a staged result.");
  if ((input.status === "rejected" || input.status === "stale") && result?.status !== "rejected") throw new Error(`${input.status} status requires a rejected result.`);
  if ((input.status === "queued" || input.status === "delivered" || input.status === "disconnected") && result) throw new Error(`${input.status} status cannot include a result.`);
  if (input.status === "accepted" && result?.status !== (isMutating(transaction) ? "staged" : "applied")) throw new Error("Accepted status result does not match submitted operation semantics.");
  if (input.status === "reverted" && result?.status !== "staged") throw new Error("Reverted status requires a staged result.");
  return {
    transactionId: transaction.transactionId,
    status: input.status as AgentTransactionStatus["status"],
    ...(result ? { result } : {}),
    ...(artifact ? { artifact } : {}),
  };
}

export class AgentProducerClient {
  readonly #options: AgentProducerClientOptions;
  constructor(options: AgentProducerClientOptions = {}) { this.#options = options; }

  async #context(): Promise<AgentConnectionContext> {
    return this.#options.context ?? await readAgentConnectionContext(this.#options.contextPath);
  }

  async #request(context: AgentConnectionContext, pathname: string, init: RequestInit = {}): Promise<Response> {
    const request = this.#options.fetch ?? fetch;
    return await request(`${context.apiOrigin}${pathname}`, {
      ...init,
      headers: { Authorization: `Bearer ${context.token}`, ...init.headers },
    });
  }

  async manifest(): Promise<AgentDocumentManifest> {
    const context = await this.#context();
    const response = await this.#request(context, "/api/agent/document");
    if (!response.ok) throw new Error(response.status === 404 ? "No active canvas document is available." : `Canvas manifest request failed (${response.status}).`);
    return parseManifest(await response.json());
  }

  async submitAndWait(transaction: AgentTransactionV1): Promise<AgentProducerOutcome> {
    const context = await this.#context();
    let response: Response;
    try {
      response = await this.#request(context, "/api/agent/transactions", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(transaction),
      });
    } catch (error) {
      return { status: "unavailable", transactionId: transaction.transactionId, message: "Canvas is unavailable." };
    }
    if (response.status === 409) return { status: "conflict", transactionId: transaction.transactionId, message: "Transaction ID conflicts with an existing payload." };
    if (!response.ok) return { status: "unavailable", transactionId: transaction.transactionId, message: `Transaction submission failed (${response.status}).` };
    try { parseStatus(await response.json(), transaction); }
    catch { return { status: "conflict", transactionId: transaction.transactionId, message: "Transaction submission response is malformed." }; }

    const deadline = Date.now() + (this.#options.timeoutMs ?? 30 * 60_000 + 20_000);
    while (Date.now() <= deadline) {
      let state: AgentTransactionStatus;
      let statusResponse: Response;
      try {
        statusResponse = await this.#request(context, `/api/agent/transactions/${encodeURIComponent(transaction.transactionId)}`);
      } catch (error) {
        return { status: "unavailable", transactionId: transaction.transactionId, message: "Canvas is unavailable." };
      }
      if (!statusResponse.ok) return { status: "unavailable", transactionId: transaction.transactionId, message: `Transaction status failed (${statusResponse.status}).` };
      try { state = parseStatus(await statusResponse.json(), transaction); }
      catch { return { status: "conflict", transactionId: transaction.transactionId, message: "Transaction status is malformed." }; }
      if (state.status === "accepted") return { status: "accepted", transactionId: transaction.transactionId, ...(state.artifact ? { artifact: state.artifact } : {}) };
      if (state.status === "reverted" || state.status === "stale") return { status: state.status, transactionId: transaction.transactionId };
      if (state.status === "rejected") return { status: "rejected", transactionId: transaction.transactionId, error: state.result };
      await new Promise((resolve) => setTimeout(resolve, this.#options.pollIntervalMs ?? 100));
    }
    return { status: "timeout", transactionId: transaction.transactionId, message: "Timed out waiting for canvas review." };
  }
}
