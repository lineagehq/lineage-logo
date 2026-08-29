import { lstatSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import type { FullResult, Reporter } from "@playwright/test/reporter";

export default class FailureOnlyReporter implements Reporter {
  #passed = false;

  onEnd(result: FullResult): void {
    this.#passed = result.status === "passed";
  }

  async onExit(): Promise<void> {
    if (!this.#passed) return;
    const repositoryRoot = realpathSync(process.cwd());
    const outputDirectory = path.resolve(repositoryRoot, "test-results");
    if (path.dirname(outputDirectory) !== repositoryRoot || path.basename(outputDirectory) !== "test-results") {
      throw new Error(`Refusing to clean unexpected Playwright output: ${outputDirectory}`);
    }
    try {
      if (lstatSync(outputDirectory).isSymbolicLink()) {
        throw new Error(`Refusing to clean symlinked Playwright output: ${outputDirectory}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    rmSync(outputDirectory, { recursive: true });
  }
}
