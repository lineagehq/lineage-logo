import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";

interface SafeFailure {
  project: string;
  status: string;
  test: string;
}

export default class SanitizedReporter implements Reporter {
  readonly #failures: SafeFailure[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status === "passed" || result.status === "skipped") return;
    this.#failures.push({
      project: test.parent.project()?.name ?? "unknown",
      status: result.status,
      test: test.titlePath().slice(1).join(" > ").replace(/[\r\n]/g, " ").slice(0, 240),
    });
  }

  onEnd(): void {
    if (this.#failures.length === 0) return;
    const output = path.resolve("test-results", "release-diagnostics.json");
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify({ schemaVersion: 1, failures: this.#failures }, null, 2)}\n`, { mode: 0o600 });
    for (const failure of this.#failures) process.stderr.write(`[${failure.project}] ${failure.test}: ${failure.status}\n`);
  }
}
