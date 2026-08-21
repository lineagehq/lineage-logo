export class History {
  readonly #past: string[] = [];
  readonly #future: string[] = [];

  checkpoint(snapshot: string): void {
    if (this.#past.at(-1) !== snapshot) {
      this.#past.push(snapshot);
    }
    this.#future.length = 0;
  }

  undo(currentSnapshot: string): string | undefined {
    const previous = this.#past.pop();
    if (previous === undefined) return undefined;
    this.#future.push(currentSnapshot);
    return previous;
  }

  redo(currentSnapshot: string): string | undefined {
    const next = this.#future.pop();
    if (next === undefined) return undefined;
    this.#past.push(currentSnapshot);
    return next;
  }

  reset(): void {
    this.#past.length = 0;
    this.#future.length = 0;
  }

  get canUndo(): boolean {
    return this.#past.length > 0;
  }

  get canRedo(): boolean {
    return this.#future.length > 0;
  }
}
