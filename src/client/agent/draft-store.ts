import { validateCleanAgentSvg } from "../../shared/agent-protocol";

export const AGENT_DRAFT_MAX_BYTES = 5 * 1024 * 1024;
export const AGENT_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const AGENT_DRAFT_KEY = "lineage.agent-draft.v1";

export interface AgentDraftV1 {
  version: 1;
  workspace: string;
  sourcePath: string;
  createdAt: string;
  sourceDigest: string;
  draftDigest: string;
  svg: string;
}

interface DraftStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeIdentity(workspace: string, sourcePath: string): boolean {
  return workspace.length > 0 && workspace.length <= 80 && !/[\\/]/.test(workspace)
    && /^(?:concepts|iterations)\/[A-Za-z0-9._-]+\.svg$/.test(sourcePath);
}

export async function writeAgentDraft(
  storage: DraftStorage,
  input: { workspace: string; sourcePath: string; sourceSvg: string; svg: string },
  now = new Date(),
): Promise<AgentDraftV1> {
  if (!safeIdentity(input.workspace, input.sourcePath)) throw new Error("Agent draft identity is invalid.");
  if (new TextEncoder().encode(input.svg).byteLength > AGENT_DRAFT_MAX_BYTES) throw new Error("Agent draft exceeds the 5 MiB limit.");
  validateCleanAgentSvg(input.svg);
  const draft: AgentDraftV1 = {
    version: 1, workspace: input.workspace, sourcePath: input.sourcePath, createdAt: now.toISOString(),
    sourceDigest: await digest(input.sourceSvg), draftDigest: await digest(input.svg), svg: input.svg,
  };
  storage.setItem(AGENT_DRAFT_KEY, JSON.stringify(draft));
  return draft;
}

export async function readAgentDraft(
  storage: DraftStorage,
  expected: { workspace: string; sourcePath: string; sourceSvg: string },
  now = new Date(),
): Promise<{ status: "none" | "mismatch" } | { status: "ready"; draft: AgentDraftV1 }> {
  try {
    const raw = storage.getItem(AGENT_DRAFT_KEY);
    if (!raw) return { status: "none" };
    if (new TextEncoder().encode(raw).byteLength > AGENT_DRAFT_MAX_BYTES + 4096) return { status: "mismatch" };
    const value = JSON.parse(raw) as Record<string, unknown>;
    const fields = ["version", "workspace", "sourcePath", "createdAt", "sourceDigest", "draftDigest", "svg"];
    if (!value || Object.keys(value).length !== fields.length || fields.some((field) => !(field in value))
      || value.version !== 1 || typeof value.workspace !== "string" || typeof value.sourcePath !== "string"
      || typeof value.createdAt !== "string" || typeof value.sourceDigest !== "string" || typeof value.draftDigest !== "string"
      || typeof value.svg !== "string" || !safeIdentity(value.workspace, value.sourcePath)
      || new TextEncoder().encode(value.svg).byteLength > AGENT_DRAFT_MAX_BYTES
      || !/^[a-f0-9]{64}$/.test(value.sourceDigest) || !/^[a-f0-9]{64}$/.test(value.draftDigest)
      || !Number.isFinite(Date.parse(value.createdAt)) || now.getTime() - Date.parse(value.createdAt) > AGENT_DRAFT_MAX_AGE_MS
      || now.getTime() < Date.parse(value.createdAt)) return { status: "mismatch" };
    validateCleanAgentSvg(value.svg);
    if (value.workspace !== expected.workspace || value.sourcePath !== expected.sourcePath
      || value.sourceDigest !== await digest(expected.sourceSvg) || value.draftDigest !== await digest(value.svg)) return { status: "mismatch" };
    return { status: "ready", draft: value as unknown as AgentDraftV1 };
  } catch {
    return { status: "mismatch" };
  }
}

export function discardAgentDraft(storage: DraftStorage): void { storage.removeItem(AGENT_DRAFT_KEY); }
