import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

const statuses = new Set(['passed','failed','timedOut','skipped','interrupted']);
const overallStatuses = new Set(['passed', 'failed', 'timedout', 'interrupted']);
const projects = new Set(['chromium','firefox-critical','webkit-critical']);
interface SafeResult { id: string; project: string; status: string; durationMs: number }
/** Titles, errors, stdout, attachments and paths are untrusted and never serialized. */
export default class SanitizedReporter implements Reporter {
  readonly #results: SafeResult[] = [];
  onTestEnd(test: TestCase, result: TestResult): void {
    this.#results.push({
      id: createHash('sha256').update(test.id).digest('hex').slice(0,16),
      project: projects.has(test.parent.project()?.name ?? '') ? test.parent.project()!.name : 'unknown',
      status: statuses.has(result.status) ? result.status : 'unknown',
      durationMs: Number.isFinite(result.duration) ? Math.max(0, Math.round(result.duration)) : 0,
    });
  }
  onEnd(result: FullResult): void {
    const counts = Object.fromEntries([...statuses].map(status => [status, this.#results.filter(r => r.status === status).length]));
    const receipt = { schemaVersion: 2, status: overallStatuses.has(result.status) ? result.status : 'unknown', durationMs: Number.isFinite(result.duration) ? Math.max(0,Math.round(result.duration)) : 0, counts, tests: this.#results };
    const output = path.resolve('test-results', 'release-diagnostics.json');
    for (const target of [path.dirname(output), output]) {
      if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error('Refusing symlinked diagnostics output.');
    }
    mkdirSync(path.dirname(output), {recursive:true});
    writeFileSync(output, `${JSON.stringify(receipt,null,2)}\n`, {mode:0o600});
    process.stdout.write(`Browser QA (${receipt.status}): ${counts.passed} passed, ${counts.failed} failed, ${counts.timedOut} timed out, ${counts.skipped} skipped, ${counts.interrupted} interrupted; ${receipt.durationMs}ms.\n`);
    for (const item of this.#results.filter(r => r.status !== 'passed' && r.status !== 'skipped')) process.stderr.write(`[${item.project}] test-${item.id}: ${item.status}\n`);
  }
}
