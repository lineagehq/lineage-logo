import type {
  AgentAcceptedArtifact, AgentDocumentManifest, AgentTerminalDecision, AgentTransactionResult, AgentTransactionStatus, AgentTransactionV1,
} from "../../shared/agent-protocol";
import { isAgentErrorCode, parseAgentTransaction, validateCleanAgentSvg } from "../../shared/agent-protocol";
import type { StagedAgentTransaction } from "./transaction";

export interface AgentCanvasTransportOptions {
  onTransaction: (transaction: AgentTransactionV1) => StagedAgentTransaction | undefined;
  onTerminalState?: (state: AgentTerminalState) => void;
  onServerReplacement?: (previousServerInstanceId: string, serverInstanceId: string) => void;
  onStateChange?: (state: "connected" | "disconnected", message: string) => void;
  fetch?: typeof fetch;
  connect?: boolean;
  streamTimeoutMs?: number;
  editorId?: string;
}

export interface AgentTerminalState {
  transactionId: string;
  status: "accepted" | "reverted" | "rejected" | "stale";
}

export interface AgentRecoveryIdentity {
  transactionId: string;
  sessionId: string;
  sourcePath: string;
  revision: number;
}

export type AgentRecoveryState =
  | { serverInstanceId: string; transactionId: string; status: "unknown" }
  | { serverInstanceId: string; transaction: AgentTransactionV1; state: AgentTransactionStatus & { status: "pending_review" | "accepted" | "reverted" | "rejected" | "stale" } };

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SERVER_INSTANCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EDITOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Module evaluation is scoped to one browser tab. Multiple transport helpers
// in that tab therefore share one lease, while a second tab receives a fresh ID.
const DEFAULT_EDITOR_ID = crypto.randomUUID();

function exactJson(data: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(data) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

function serverInstance(data: string): string | undefined {
  const value = exactJson(data);
  if (!value || Object.keys(value).length !== 1 || typeof value.serverInstanceId !== "string" || !SERVER_INSTANCE_ID.test(value.serverInstanceId)) return undefined;
  return value.serverInstanceId;
}

function terminalState(data: string): AgentTerminalState | undefined {
  const value = exactJson(data);
  if (!value || Object.keys(value).length !== 2 || typeof value.transactionId !== "string" || !IDENTIFIER.test(value.transactionId)
    || (value.status !== "accepted" && value.status !== "reverted" && value.status !== "rejected" && value.status !== "stale")) return undefined;
  return value as unknown as AgentTerminalState;
}

export class AgentDecisionError extends Error {
  readonly state?: AgentTransactionStatus;
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean, state?: AgentTransactionStatus) {
    super(message);
    this.name = "AgentDecisionError";
    this.retryable = retryable;
    this.state = state;
  }
}

export class AgentRecoveryError extends Error {
  readonly terminal: boolean;
  constructor(message: string, terminal: boolean) {
    super(message);
    this.name = "AgentRecoveryError";
    this.terminal = terminal;
  }
}

function decisionState(value: unknown, transactionId: string): (AgentTransactionStatus & { error?: string }) | undefined {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const input = value as Record<string, unknown>;
    if (Object.keys(input).some((key) => !["transactionId", "status", "result", "artifact", "error"].includes(key))
      || input.transactionId !== transactionId || typeof input.status !== "string"
      || !["accepted", "reverted", "rejected", "stale", "pending_review"].includes(input.status)
      || (input.error !== undefined && typeof input.error !== "string")) return undefined;
    let result: AgentTransactionResult | undefined;
    if (input.result !== undefined) {
      if (!input.result || typeof input.result !== "object" || Array.isArray(input.result)) return undefined;
      const raw = input.result as Record<string, unknown>;
      if (raw.transactionId !== transactionId || typeof raw.status !== "string") return undefined;
      if (raw.status === "rejected") {
        if (Object.keys(raw).some((key) => !["transactionId", "status", "error"].includes(key)) || !raw.error || typeof raw.error !== "object" || Array.isArray(raw.error)) return undefined;
        const detail = raw.error as Record<string, unknown>;
        if (Object.keys(detail).some((key) => !["code", "message", "operationId", "path"].includes(key))
          || !isAgentErrorCode(detail.code) || typeof detail.message !== "string" || !detail.message
          || (detail.operationId !== undefined && typeof detail.operationId !== "string")
          || (detail.path !== undefined && typeof detail.path !== "string")) return undefined;
      } else if (raw.status === "staged" || raw.status === "applied") {
        if (Object.keys(raw).some((key) => !["transactionId", "status", "impact"].includes(key)) || !Array.isArray(raw.impact)) return undefined;
        for (const value of raw.impact) {
          if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
          const impact = value as Record<string, unknown>;
          if (Object.keys(impact).some((key) => !["operationId", "affectedSessionKeys", "resultSessionKey"].includes(key))
            || typeof impact.operationId !== "string" || !Array.isArray(impact.affectedSessionKeys)
            || impact.affectedSessionKeys.some((key) => typeof key !== "string")
            || (impact.resultSessionKey !== undefined && typeof impact.resultSessionKey !== "string")) return undefined;
        }
      } else return undefined;
      result = raw as unknown as AgentTransactionResult;
    }
    let artifact: AgentAcceptedArtifact | undefined;
    if (input.artifact !== undefined) {
      if (!input.artifact || typeof input.artifact !== "object" || Array.isArray(input.artifact)) return undefined;
      const raw = input.artifact as Record<string, unknown>;
      if (Object.keys(raw).some((key) => !["sourcePath", "revision", "svg", "durablePath", "digest"].includes(key))
        || typeof raw.sourcePath !== "string" || !Number.isSafeInteger(raw.revision) || typeof raw.svg !== "string") return undefined;
      if ((raw.durablePath !== undefined || raw.digest !== undefined)
        && (typeof raw.durablePath !== "string" || !/^iterations\/[A-Za-z0-9._-]+\.svg$/.test(raw.durablePath)
          || typeof raw.digest !== "string" || !/^[a-f0-9]{64}$/.test(raw.digest))) return undefined;
      validateCleanAgentSvg(raw.svg);
      artifact = raw as unknown as AgentAcceptedArtifact;
    }
    if (input.status === "accepted" && !artifact) return undefined;
    if (input.status !== "accepted" && artifact) return undefined;
    if (input.status === "pending_review" && result?.status !== "staged") return undefined;
    if ((input.status === "rejected" || input.status === "stale") && result?.status !== "rejected") return undefined;
    if (input.status === "reverted" && result?.status !== "staged") return undefined;
    return { transactionId, status: input.status as AgentTransactionStatus["status"], ...(result ? { result } : {}), ...(artifact ? { artifact } : {}), ...(typeof input.error === "string" ? { error: input.error } : {}) };
  } catch { return undefined; }
}

export class AgentCanvasTransport {
  readonly #options: AgentCanvasTransportOptions;
  readonly #editorId: string;
  #closed = false;
  #connectionAbort?: AbortController;
  #lastEventId = 0;
  #serverInstanceId?: string;
  readonly #received = new Map<string, StagedAgentTransaction>();

  constructor(options: AgentCanvasTransportOptions) {
    this.#options = options;
    this.#editorId = options.editorId ?? DEFAULT_EDITOR_ID;
    if (!EDITOR_ID.test(this.#editorId)) throw new Error("Agent editor ID is invalid.");
    if (options.connect !== false) void this.#connect();
  }

  start(): void {
    if (this.#closed || this.#connectionAbort) return;
    void this.#connect();
  }

  async publishDocument(manifest: AgentDocumentManifest): Promise<void> {
    const response = await (this.#options.fetch ?? fetch)("/api/agent/document", {
      method: "POST",
      headers: this.#headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(manifest),
    });
    if (!response.ok) {
      const value = await response.json().catch(() => undefined) as { error?: unknown } | undefined;
      throw new Error(typeof value?.error === "string" ? value.error : `Document synchronization failed (${response.status}).`);
    }
  }

  async recover(identity: AgentRecoveryIdentity): Promise<AgentRecoveryState> {
    const requestIdentity: AgentRecoveryIdentity = {
      transactionId: identity.transactionId,
      sessionId: identity.sessionId,
      sourcePath: identity.sourcePath,
      revision: identity.revision,
    };
    const response = await (this.#options.fetch ?? fetch)("/api/agent/recovery", {
      method: "POST",
      headers: this.#headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(requestIdentity),
    });
    const value = await response.json().catch(() => undefined) as unknown;
    if (!response.ok) {
      const error = value && typeof value === "object" && !Array.isArray(value) && typeof (value as { error?: unknown }).error === "string"
        ? (value as { error: string }).error : undefined;
      const terminal = response.status === 409 && error === "Recovery identity does not match the recorded transaction.";
      throw new AgentRecoveryError(error ?? `Agent recovery failed (${response.status}).`, terminal);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new AgentRecoveryError("Agent recovery response is malformed.", false);
    const input = value as Record<string, unknown>;
    if (typeof input.serverInstanceId !== "string" || !SERVER_INSTANCE_ID.test(input.serverInstanceId)) {
      throw new AgentRecoveryError("Agent recovery server identity is malformed.", false);
    }
    if (input.status === "unknown") {
      if (Object.keys(input).length !== 3 || input.transactionId !== identity.transactionId) throw new AgentRecoveryError("Unknown recovery response is malformed.", false);
      this.#adoptServerInstance(input.serverInstanceId);
      return input as unknown as AgentRecoveryState;
    }
    if (Object.keys(input).length !== 3 || !input.transaction || !input.state) throw new AgentRecoveryError("Agent recovery response is malformed.", false);
    let transaction: AgentTransactionV1;
    try { transaction = parseAgentTransaction(JSON.stringify(input.transaction)); }
    catch { throw new AgentRecoveryError("Recovered transaction is malformed.", false); }
    if (transaction.transactionId !== identity.transactionId
      || transaction.document.sessionId !== identity.sessionId
      || transaction.document.sourcePath !== identity.sourcePath
      || transaction.document.baseRevision !== identity.revision) {
      throw new AgentRecoveryError("Recovered transaction identity does not match the stored review.", false);
    }
    const state = decisionState(input.state, identity.transactionId);
    if (!state || !["pending_review", "accepted", "reverted", "rejected", "stale"].includes(state.status)) {
      throw new AgentRecoveryError("Recovered transaction state is malformed.", false);
    }
    if ((state.status === "pending_review" || state.status === "accepted" || state.status === "reverted")
      && (state.result?.status !== "staged"
        || state.result.impact.length !== transaction.operations.length
        || state.result.impact.some((impact, index) => impact.operationId !== transaction.operations[index]?.operationId))) {
      throw new AgentRecoveryError("Recovered transaction result does not match its operation sequence.", false);
    }
    if (state.status === "accepted"
      && (state.artifact?.sourcePath !== identity.sourcePath || state.artifact.revision !== identity.revision + 1)) {
      throw new AgentRecoveryError("Recovered accepted artifact does not match the stored document revision.", false);
    }
    this.#adoptServerInstance(input.serverInstanceId);
    return {
      serverInstanceId: input.serverInstanceId,
      transaction,
      state: state as AgentTransactionStatus & { status: "pending_review" | "accepted" | "reverted" | "rejected" | "stale" },
    };
  }

  close(): void { this.#closed = true; this.#connectionAbort?.abort(); }

  #adoptServerInstance(serverInstanceId: string): void {
    if (this.#serverInstanceId && this.#serverInstanceId !== serverInstanceId) {
      const previous = this.#serverInstanceId;
      this.#lastEventId = 0;
      this.#received.clear();
      this.#options.onServerReplacement?.(previous, serverInstanceId);
    }
    this.#serverInstanceId = serverInstanceId;
  }

  async decide(transactionId: string, status: AgentTerminalDecision["status"], artifact?: AgentAcceptedArtifact): Promise<AgentTransactionStatus> {
    const decision: AgentTerminalDecision = status === "accepted"
      ? { transactionId, status, artifact: artifact ?? (() => { throw new Error("Accepted decisions require an artifact receipt."); })() }
      : { transactionId, status };
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await (this.#options.fetch ?? fetch)(`/api/agent/transactions/${encodeURIComponent(transactionId)}/ack`, {
          method: "POST",
          headers: this.#headers({ "Content-Type": "application/json" }),
          body: JSON.stringify(decision),
        });
        const value = await response.json().catch(() => undefined) as unknown;
        const state = decisionState(value, transactionId);
        if (!response.ok) {
          const message = value && typeof value === "object" && typeof (value as { error?: unknown }).error === "string"
            ? (value as { error: string }).error : `Agent decision failed (${response.status}).`;
          throw new AgentDecisionError(message, response.status >= 500 || !state, state);
        }
        if (!state || state.status !== status) throw new AgentDecisionError(`Agent decision did not converge to ${status}.`, false, state);
        if (status === "accepted" && (!artifact || state.artifact?.sourcePath !== artifact.sourcePath
          || state.artifact.revision !== artifact.revision || state.artifact.svg !== artifact.svg)) {
          throw new AgentDecisionError("Accepted artifact receipt does not match the applied candidate.", false, state);
        }
        return state;
      } catch (error) {
        if (error instanceof AgentDecisionError && !error.retryable) throw error;
        lastError = error;
      }
    }
    throw new AgentDecisionError(lastError instanceof Error ? lastError.message : "Agent decision acknowledgement was lost.", true);
  }

  async #connect(): Promise<void> {
    while (!this.#closed) {
      try {
        const connectionAbort = new AbortController();
        this.#connectionAbort = connectionAbort;
        const response = await (this.#options.fetch ?? fetch)("/api/agent/events", {
          headers: this.#headers(this.#lastEventId ? { "Last-Event-ID": String(this.#lastEventId) } : undefined),
          signal: connectionAbort.signal,
        });
        if (!response.ok || !response.body) throw new Error(`Agent event stream failed (${response.status}).`);
        this.#options.onStateChange?.("connected", "Agent connection ready");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffered = "";
        let replaced = false;
        while (!this.#closed) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const chunk = await Promise.race([
            reader.read(),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => reject(new Error("Agent event stream heartbeat timed out.")), this.#options.streamTimeoutMs ?? 7_000);
            }),
          ]).finally(() => { if (timer) clearTimeout(timer); });
          if (chunk.done) break;
          buffered += decoder.decode(chunk.value, { stream: true }).replaceAll("\r", "");
          let boundary: number;
          while ((boundary = buffered.indexOf("\n\n")) >= 0) {
            const block = buffered.slice(0, boundary);
            buffered = buffered.slice(boundary + 2);
            if (block.startsWith(":")) continue;
            const pairs = block.split("\n").map((line) => {
              const split = line.indexOf(":");
              if (split <= 0) throw new Error("Agent event stream contained a malformed field.");
              return [line.slice(0, split), line.slice(split + 1).trimStart()];
            }) as Array<[string, string]>;
            const fields = new Map(pairs);
            if (fields.size !== pairs.length || Array.from(fields.keys()).some((key) => !["id", "event", "data"].includes(key))) {
              throw new Error("Agent event stream contained invalid fields.");
            }
            const event = fields.get("event");
            const id = Number(fields.get("id"));
            if (event === "server-instance" && fields.size === 2 && fields.has("data") && !fields.has("id")) {
              const nextServerInstanceId = serverInstance(fields.get("data")!);
              if (!nextServerInstanceId) throw new Error("Agent server identity event is invalid.");
              if (this.#serverInstanceId && this.#serverInstanceId !== nextServerInstanceId) {
                const previous = this.#serverInstanceId;
                this.#serverInstanceId = nextServerInstanceId;
                this.#lastEventId = 0;
                this.#received.clear();
                this.#options.onServerReplacement?.(previous, nextServerInstanceId);
                replaced = true;
                await reader.cancel();
                break;
              }
              this.#serverInstanceId = nextServerInstanceId;
            } else if (event === "transaction" && fields.size === 3 && fields.has("data") && Number.isSafeInteger(id) && id > 0) {
              await this.#receive(fields.get("data")!, id);
            } else if (event === "transaction-terminal" && fields.size === 3 && fields.has("data") && Number.isSafeInteger(id) && id > 0) {
              const state = terminalState(fields.get("data")!);
              if (!state) throw new Error("Agent terminal event is invalid.");
              this.#lastEventId = Math.max(this.#lastEventId, id);
              this.#received.delete(state.transactionId);
              this.#options.onTerminalState?.(state);
            } else {
              throw new Error("Agent event stream contained an unknown event.");
            }
          }
          if (replaced) break;
        }
        if (replaced) continue;
        // Vite may end a well-formed proxied SSE response after one event. A
        // clean EOF is an expected reconnect boundary, not a user-visible
        // disconnection; failures still report disconnected below.
      } catch (error) {
        this.#connectionAbort?.abort();
        if (!this.#closed) this.#options.onStateChange?.("disconnected", error instanceof Error ? error.message : "Agent connection interrupted; reconnecting");
      }
      if (!this.#closed) await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async #receive(data: string, eventId: number): Promise<void> {
    let transaction: AgentTransactionV1;
    try { transaction = JSON.parse(data) as AgentTransactionV1; }
    catch { return; }
    const staged = this.#received.get(transaction.transactionId) ?? this.#options.onTransaction(transaction);
    if (!staged) return;
    this.#received.set(transaction.transactionId, staged);
    const response = await (this.#options.fetch ?? fetch)(`/api/agent/transactions/${encodeURIComponent(transaction.transactionId)}/ack`, {
      method: "POST",
      headers: this.#headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(staged.result),
    });
    if (!response.ok) throw new Error(`Agent acknowledgement failed (${response.status}).`);
    const state = await response.json() as AgentTransactionStatus;
    if (!["pending_review", "accepted", "reverted", "rejected", "stale"].includes(state.status)) {
      throw new Error(`Agent acknowledgement did not converge (${state.status}).`);
    }
    this.#lastEventId = Math.max(this.#lastEventId, eventId);
    this.#received.delete(transaction.transactionId);
    this.#options.onStateChange?.("connected", `Agent transaction ${state.transactionId}: ${state.status}`);
  }

  #headers(extra: Record<string, string> = {}): Record<string, string> {
    return { "X-Lineage-Editor-ID": this.#editorId, ...extra };
  }
}
