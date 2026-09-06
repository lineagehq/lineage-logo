/** A save response may only advance the document that authorized its request. */
export class SaveAuthority {
  #generation = 0;
  #active?: number;

  begin(): number | undefined {
    if (this.#active !== undefined) return undefined;
    this.#active = ++this.#generation;
    return this.#active;
  }

  invalidate(): void { this.#generation += 1; }
  owns(request: number): boolean { return request === this.#generation && request === this.#active; }
  finish(request: number): void { if (this.#active === request) this.#active = undefined; }
  get saving(): boolean { return this.#active !== undefined; }
}
