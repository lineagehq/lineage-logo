import type {
  AgentDocumentManifest, AgentTerminalDecision, AgentTransactionResult, AgentTransactionStatus, AgentTransactionV1,
} from "../../shared/agent-protocol";
import type { StagedAgentTransaction } from "./transaction";

export interface AgentCanvasTransportOptions {
  onTransaction: (transaction: AgentTransactionV1) => StagedAgentTransaction | undefined;
  onStateChange?: (state: "connected" | "disconnected", message: string) => void;
}

export class AgentCanvasTransport {
  readonly #abort = new AbortController();
  readonly #options: AgentCanvasTransportOptions;
  #closed = false;
  #lastEventId = 0;
  readonly #received = new Map<string, StagedAgentTransaction>();

  constructor(options: AgentCanvasTransportOptions) {
    this.#options = options;
    void this.#connect();
  }

  async publishDocument(manifest: AgentDocumentManifest): Promise<void> {
    const response = await fetch("/api/agent/document", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(manifest),
    });
    if (!response.ok) throw new Error(`Document synchronization failed (${response.status}).`);
  }

  close(): void { this.#closed = true; this.#abort.abort(); }

  async decide(transactionId: string, status: AgentTerminalDecision["status"]): Promise<AgentTransactionStatus> {
    const response = await fetch(`/api/agent/transactions/${encodeURIComponent(transactionId)}/ack`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionId, status } satisfies AgentTerminalDecision),
    });
    const state = await response.json() as AgentTransactionStatus & { error?: string };
    if (!response.ok) throw new Error(state.error ?? `Agent decision failed (${response.status}).`);
    if (state.status !== status) throw new Error(`Agent decision did not converge to ${status}.`);
    return state;
  }

  decideOnUnload(transactionId: string): boolean {
    const url = `/api/agent/transactions/${encodeURIComponent(transactionId)}/ack`;
    const body = JSON.stringify({ transactionId, status: "reverted" } satisfies AgentTerminalDecision);
    const queued = navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    if (!queued) {
      void fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => undefined);
    }
    return queued;
  }

  async #connect(): Promise<void> {
    while (!this.#closed) {
      try {
        const response = await fetch("/api/agent/events", {
          headers: this.#lastEventId ? { "Last-Event-ID": String(this.#lastEventId) } : undefined,
          signal: this.#abort.signal,
        });
        if (!response.ok || !response.body) throw new Error(`Agent event stream failed (${response.status}).`);
        this.#options.onStateChange?.("connected", "Agent connection ready");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffered = "";
        while (!this.#closed) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffered += decoder.decode(chunk.value, { stream: true }).replaceAll("\r", "");
          let boundary: number;
          while ((boundary = buffered.indexOf("\n\n")) >= 0) {
            const block = buffered.slice(0, boundary);
            buffered = buffered.slice(boundary + 2);
            if (block.startsWith(":")) continue;
            const fields = new Map(block.split("\n").map((line) => {
              const split = line.indexOf(":");
              return [line.slice(0, split), line.slice(split + 1).trimStart()];
            }));
            const id = Number(fields.get("id"));
            if (fields.get("event") === "transaction" && fields.has("data") && Number.isSafeInteger(id)) {
              await this.#receive(fields.get("data")!, id);
            }
          }
        }
        // Vite may end a well-formed proxied SSE response after one event. A
        // clean EOF is an expected reconnect boundary, not a user-visible
        // disconnection; failures still report disconnected below.
      } catch (error) {
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
    const response = await fetch(`/api/agent/transactions/${encodeURIComponent(transaction.transactionId)}/ack`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
}
