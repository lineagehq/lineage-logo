import type { AgentDocumentManifest, AgentTransactionV1 } from "../../shared/agent-protocol";
import type { AgentDocumentContext, AgentSelectionIntent, StagedAgentTransaction } from "./transaction";

export interface AgentSessionEditor {
  stageAgentTransaction(transaction: AgentTransactionV1, context: AgentDocumentContext): StagedAgentTransaction | undefined;
  acceptAgentCandidate(candidate: SVGSVGElement, selection?: AgentSelectionIntent): void;
  applyAgentSelection(selection?: AgentSelectionIntent): void;
  setAgentMutationBlocked(blocked: boolean): void;
}

export interface PendingAgentTransaction {
  transaction: AgentTransactionV1;
  staged: StagedAgentTransaction & { candidate: SVGSVGElement };
}

export class AgentSession {
  readonly #editor: AgentSessionEditor;
  #sessionId = "";
  #sourcePath = "";
  #revision = 0;
  #pending?: PendingAgentTransaction;
  #suppressDocumentChange = false;
  readonly #onRevisionChange?: () => void;

  constructor(editor: AgentSessionEditor, onRevisionChange?: () => void) {
    this.#editor = editor;
    this.#onRevisionChange = onRevisionChange;
  }

  open(sessionId: string, sourcePath: string): boolean {
    if (this.#pending) return false;
    this.#editor.setAgentMutationBlocked(false);
    this.#sessionId = sessionId;
    this.#sourcePath = sourcePath;
    this.#revision = 0;
    this.#pending = undefined;
    return true;
  }

  get revision(): number { return this.#revision; }
  get pending(): PendingAgentTransaction | undefined { return this.#pending; }
  get context(): AgentDocumentContext { return { sessionId: this.#sessionId, sourcePath: this.#sourcePath, revision: this.#revision }; }

  documentChanged(): void {
    if (this.#suppressDocumentChange) return;
    this.#revision += 1;
    this.#onRevisionChange?.();
  }

  stage(transaction: AgentTransactionV1): StagedAgentTransaction | undefined {
    if (this.#pending?.transaction.transactionId === transaction.transactionId) return this.#pending.staged;
    const staged = this.#editor.stageAgentTransaction(transaction, this.context);
    if (!staged || staged.result.status === "rejected") return staged;
    if (staged.result.status === "applied") {
      this.#editor.applyAgentSelection(staged.selection);
      return staged;
    }
    if (this.#pending) {
      return {
        result: {
          transactionId: transaction.transactionId,
          status: "rejected",
          error: { code: "pending_transaction", message: `Transaction ${this.#pending.transaction.transactionId} is already pending review.` },
        },
      };
    }
    if (!staged.candidate) throw new Error("A staged mutating transaction must include a detached candidate.");
    this.#pending = { transaction, staged: staged as StagedAgentTransaction & { candidate: SVGSVGElement } };
    this.#editor.setAgentMutationBlocked(true);
    return staged;
  }

  accept(): boolean {
    const pending = this.#pending;
    if (!pending) return false;
    this.#pending = undefined;
    this.#editor.setAgentMutationBlocked(false);
    this.#suppressDocumentChange = true;
    try { this.#editor.acceptAgentCandidate(pending.staged.candidate, pending.staged.selection); }
    finally { this.#suppressDocumentChange = false; }
    this.#revision += 1;
    this.#onRevisionChange?.();
    return true;
  }

  revert(): boolean {
    if (!this.#pending) return false;
    this.#pending = undefined;
    this.#editor.setAgentMutationBlocked(false);
    return true;
  }

  manifest(layers: AgentDocumentManifest["layers"]): AgentDocumentManifest {
    return { sessionId: this.#sessionId, sourcePath: this.#sourcePath, revision: this.#revision, layers };
  }
}
