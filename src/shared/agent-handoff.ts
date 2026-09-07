import { parseAgentSnapshot, type AgentSnapshot } from "./agent-snapshot.js";

export interface HandoffRequest {
  intent: string;
  target: "document" | "selection";
  editorId: string;
  sessionId: string;
  revision: number;
  sourcePath: string;
  selectedLayerIds: string[];
}
export interface AgentHandoff {
  schemaVersion: 1;
  kind: "lineage-logo-agent-handoff";
  intent: string;
  target: "document" | "selection";
  sourcePath: string;
  snapshot: AgentSnapshot;
  instructions: string;
}
export const HANDOFF_REFRESH_MESSAGE = "The canvas changed or another editor owns the document. Return to this document, finish any gesture or review, and prepare a fresh handoff.";

export function parseHandoffRequest(value: unknown): HandoffRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid handoff request.");
  const input = value as Record<string, unknown>;
  const keys = ["intent", "target", "editorId", "sessionId", "revision", "sourcePath", "selectedLayerIds"];
  if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))
    || typeof input.intent !== "string" || !input.intent.trim() || input.intent.length > 4000
    || !["document", "selection"].includes(String(input.target))
    || typeof input.editorId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.editorId)
    || typeof input.sessionId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.sessionId)
    || !Number.isSafeInteger(input.revision) || Number(input.revision) < 0
    || typeof input.sourcePath !== "string" || !/^(concepts|iterations)\/[^/\\\u0000-\u001f]+\.svg$/i.test(input.sourcePath)
    || !Array.isArray(input.selectedLayerIds) || input.selectedLayerIds.length > 5000
    || input.selectedLayerIds.some(key => typeof key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key))
    || new Set(input.selectedLayerIds).size !== input.selectedLayerIds.length) throw new Error("Enter an instruction of up to 4,000 characters and choose a current document or selection.");
  if (input.target === "selection" && !input.selectedLayerIds.length) throw new Error("Select at least one layer, or choose the whole document.");
  return input as unknown as HandoffRequest;
}

export function bindAgentHandoff(value: unknown, rawSnapshot: unknown): AgentHandoff {
  const request = parseHandoffRequest(value);
  const snapshot = parseAgentSnapshot(rawSnapshot);
  if (snapshot.editorId !== request.editorId || snapshot.sessionId !== request.sessionId || snapshot.baseRevision !== request.revision
    || snapshot.selectedLayerIds.length !== request.selectedLayerIds.length
    || snapshot.selectedLayerIds.some((id, index) => id !== request.selectedLayerIds[index])) throw new Error(HANDOFF_REFRESH_MESSAGE);
  return { schemaVersion: 1, kind: "lineage-logo-agent-handoff", intent: request.intent.trim(), target: request.target,
    sourcePath: request.sourcePath, snapshot,
    instructions: "No agent was invoked. Give this file to your local agent using the shipped agent-handoff instructions. Use the snapshot's exact instance, workspace, session, revision and stable layer keys. Preserve untargeted artwork. Submit a proposal for human review through the public CLI. Refresh the handoff after any edit, selection change, accepted proposal, reopened document or server restart. The snapshot contains current unsaved artwork; no credentials are included." };
}
