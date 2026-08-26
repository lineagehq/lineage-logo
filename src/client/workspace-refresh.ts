export interface WorkspaceRevision {
  nextIterationPath: string;
}

export interface WorkspaceRefreshOptions {
  delaysMs?: readonly number[];
  wait?: (delayMs: number) => Promise<void>;
}

const DEFAULT_DELAYS_MS = [0, 100, 250, 500, 1_000, 2_000, 4_000] as const;

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function waitForWorkspaceAdvance<T extends WorkspaceRevision>(
  baselineNextIterationPath: string,
  read: () => Promise<T | undefined>,
  options: WorkspaceRefreshOptions = {},
): Promise<T | undefined> {
  const delays = options.delaysMs ?? DEFAULT_DELAYS_MS;
  const pause = options.wait ?? wait;
  for (const delayMs of delays) {
    if (delayMs > 0) await pause(delayMs);
    const workspace = await read();
    if (workspace && workspace.nextIterationPath !== baselineNextIterationPath) return workspace;
  }
  return undefined;
}
