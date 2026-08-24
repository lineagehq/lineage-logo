import type { AgentTransactionV1 } from "../../shared/agent-protocol";
import type { StagedAgentTransaction } from "./transaction";

export type AgentReviewStatus = "pending" | "accepted" | "reverted" | "failed" | "stale" | "disconnected";

export interface AgentReviewLayer {
  sessionKey: string;
  name: string;
  type: string;
  hidden: boolean;
  locked: boolean;
  operationIds: string[];
}

export interface AgentReviewModel {
  status: AgentReviewStatus;
  transactionId?: string;
  producer?: string;
  summary: string;
  layers: AgentReviewLayer[];
}

const SELECTABLE = "g, path, rect, circle, ellipse, polygon, polyline, line, text";

function isEffectivelyHidden(node: SVGGraphicsElement | undefined, root: SVGSVGElement): boolean {
  let current: Element | null | undefined = node;
  while (current) {
    if (current.getAttribute("display") === "none") return true;
    if (current === root) break;
    current = current.parentElement;
  }
  return false;
}

export function buildPendingReview(
  transaction: AgentTransactionV1,
  staged: StagedAgentTransaction,
  lockedKeys: ReadonlySet<string>,
): AgentReviewModel {
  if (staged.result.status !== "staged" || !staged.candidate) throw new Error("Pending review requires a staged candidate.");
  const operationsByKey = new Map<string, string[]>();
  for (const item of staged.result.impact) for (const key of item.affectedSessionKeys) {
    const ids = operationsByKey.get(key) ?? [];
    if (!ids.includes(item.operationId)) ids.push(item.operationId);
    operationsByKey.set(key, ids);
  }
  const layers = Array.from(operationsByKey, ([sessionKey, operationIds]) => {
    const node = Array.from(staged.candidate!.querySelectorAll<SVGGraphicsElement>(SELECTABLE))
      .find((candidate) => candidate.dataset.lineageKey === sessionKey);
    return {
      sessionKey,
      name: node?.getAttribute("aria-label")?.trim() || node?.id || `${node?.localName ?? "layer"} ${sessionKey}`,
      type: node?.localName ?? "removed layer",
      hidden: isEffectivelyHidden(node, staged.candidate!),
      locked: lockedKeys.has(sessionKey),
      operationIds,
    };
  });
  const mutationCount = transaction.operations.filter((operation) => operation.type !== "selectFocus").length;
  return {
    status: "pending",
    transactionId: transaction.transactionId,
    producer: transaction.producer.name,
    summary: `${transaction.producer.name} proposed ${mutationCount} change${mutationCount === 1 ? "" : "s"} affecting ${layers.length} layer${layers.length === 1 ? "" : "s"}.`,
    layers,
  };
}

export function outcomeReview(status: Exclude<AgentReviewStatus, "pending">, transactionId?: string, message?: string): AgentReviewModel {
  const defaults: Record<Exclude<AgentReviewStatus, "pending">, string> = {
    accepted: "Agent changes were accepted as one undoable edit.",
    reverted: "Agent changes were reverted without changing the document.",
    failed: "The agent transaction failed validation and was not applied.",
    stale: "The agent transaction was based on an older document revision and was not applied.",
    disconnected: "The agent connection was interrupted. The accepted document remains unchanged.",
  };
  return { status, transactionId, summary: message ?? defaults[status], layers: [] };
}
