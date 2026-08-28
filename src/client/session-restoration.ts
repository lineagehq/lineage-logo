export type PreviewBackground = "checker" | "light" | "dark";

export interface WorkspaceSessionV1 {
  version: 1;
  workspace: string;
  activePath: string;
  selectionPath: string[];
  zoom: number;
  previewBackground: PreviewBackground;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const WORKSPACE_SESSION_KEY = "lineage.workspace-session.v1";
const EXACT_KEYS = [
  "activePath", "leftCollapsed", "previewBackground", "rightCollapsed",
  "selectionPath", "version", "workspace", "zoom",
].sort();

function validBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function validWorkspacePath(value: unknown): value is string {
  return validBoundedString(value, 320)
    && /^(?:concepts|iterations)\/[^/\\]{1,255}\.svg$/i.test(value);
}

export function boundedSelectionPath(ids: readonly string[]): string[] {
  return ids.filter((id) => validBoundedString(id, 160)).slice(-16);
}

export function validateWorkspaceSession(value: unknown, workspace: string): WorkspaceSessionV1 | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<WorkspaceSessionV1>;
  if (Object.keys(candidate).sort().join("\0") !== EXACT_KEYS.join("\0")
    || candidate.version !== 1
    || candidate.workspace !== workspace
    || !validBoundedString(candidate.workspace, 160)
    || !validWorkspacePath(candidate.activePath)
    || !Array.isArray(candidate.selectionPath)
    || candidate.selectionPath.length > 16
    || !candidate.selectionPath.every((id) => validBoundedString(id, 160))
    || typeof candidate.zoom !== "number" || !Number.isFinite(candidate.zoom)
    || candidate.zoom < 0.25 || candidate.zoom > 4
    || !(["checker", "light", "dark"] as unknown[]).includes(candidate.previewBackground)
    || typeof candidate.leftCollapsed !== "boolean"
    || typeof candidate.rightCollapsed !== "boolean") return undefined;
  return candidate as WorkspaceSessionV1;
}

export function readWorkspaceSession(storage: SessionStorageLike, workspace: string): WorkspaceSessionV1 | undefined {
  try {
    const raw = storage.getItem(WORKSPACE_SESSION_KEY);
    if (!raw) return undefined;
    const parsed = validateWorkspaceSession(JSON.parse(raw), workspace);
    if (!parsed) storage.removeItem(WORKSPACE_SESSION_KEY);
    return parsed;
  } catch {
    try { storage.removeItem(WORKSPACE_SESSION_KEY); } catch { /* storage remains unavailable */ }
    return undefined;
  }
}

export function writeWorkspaceSession(storage: SessionStorageLike, state: WorkspaceSessionV1): boolean {
  try {
    const serialized = JSON.stringify(state);
    storage.setItem(WORKSPACE_SESSION_KEY, serialized);
    return storage.getItem(WORKSPACE_SESSION_KEY) === serialized;
  } catch {
    return false;
  }
}

export function resolveSelectionPath<T extends Element>(
  root: SVGSVGElement,
  path: readonly string[],
  eligible: (element: Element) => element is T,
): T | undefined {
  const candidates = new Map(Array.from(root.querySelectorAll("[id]")).map((element) => [element.id, element]));
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const candidate = candidates.get(path[index]);
    if (candidate && eligible(candidate)) return candidate;
  }
  return undefined;
}
