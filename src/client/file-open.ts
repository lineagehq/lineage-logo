export interface FileOpenRequest { generation: number }

export class FileOpenCoordinator {
  #generation = 0;

  begin(): FileOpenRequest {
    this.#generation += 1;
    return { generation: this.#generation };
  }

  /** Permanently makes every request begun before this call ineligible. */
  invalidate(): void {
    this.#generation += 1;
  }

  canCommit(request: FileOpenRequest, pending: boolean): boolean {
    return !pending && request.generation === this.#generation;
  }
}

export interface AtomicFileOpenOptions<T> {
  coordinator: FileOpenCoordinator;
  load: () => Promise<T>;
  isPending: () => boolean;
  commit: (value: T) => void;
  onEligibleError?: (error: unknown) => void;
}

/** Performs all asynchronous work before one final synchronous commit gate. */
export async function commitLatestFileOpen<T>(options: AtomicFileOpenOptions<T>): Promise<boolean> {
  const request = options.coordinator.begin();
  let value: T;
  try {
    value = await options.load();
  } catch (error) {
    if (options.coordinator.canCommit(request, options.isPending())) options.onEligibleError?.(error);
    return false;
  }
  if (!options.coordinator.canCommit(request, options.isPending())) return false;
  options.commit(value);
  return true;
}
