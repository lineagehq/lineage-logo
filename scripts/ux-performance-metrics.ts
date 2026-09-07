/** Pure D3 evidence validation; no browser or filesystem side effects. */
export function summarize(samples: number[]) {
  if (!samples.length || samples.some(n => !Number.isFinite(n) || n < 0)) throw new Error('Invalid performance samples');
  const sorted = [...samples].sort((a,b) => a-b);
  return { samplesMs:samples, count:samples.length, medianMs: sorted.length % 2 ? sorted[Math.floor(sorted.length/2)] : (sorted[sorted.length/2-1]+sorted[sorted.length/2])/2, p95Ms:sorted[Math.ceil(sorted.length*.95)-1], minMs:sorted[0], maxMs:sorted.at(-1)! };
}
const metrics = ['open','selection','filtering','preview','dragFrames'] as const;
const sizes = ['100','500','1000'];
type Receipt = Record<string, any>;
export type PerformanceGate = {status:'pass'|'fail'|'incomparable'; reasons:string[]; comparisons?:Record<string, {baselineP95Ms:number;candidateP95Ms:number;ratio:number}>};
function validate(receipt: Receipt): string[] {
  const errors: string[] = [];
  if (receipt?.schemaVersion !== 2 || receipt?.method?.version !== 2 || receipt?.method?.warmups !== 2 || receipt?.method?.repetitions !== 30 || receipt?.method?.dragRuns !== 5) return ['Requires a complete version-2 measurement, including corrected drag sampler and heap cycles.'];
  if (!/^[a-f0-9]{40}$/.test(receipt.commit ?? '') || !/^[a-f0-9]{64}$/.test(receipt.harnessSha256 ?? '')) errors.push('Missing immutable commit or harness hash.');
  for (const size of sizes) {
    if (!/^[a-f0-9]{64}$/.test(receipt.fixtures?.[size] ?? '')) errors.push(`Missing fixture ${size} hash.`);
    if (!Number.isFinite(receipt.results?.[size]?.startupMs) || receipt.results[size].startupMs < 0) errors.push(`Missing ${size} startup.`);
    for (const metric of metrics) {
      const values = receipt.results?.[size]?.[metric]?.samplesMs;
      if (!Array.isArray(values) || values.length < (metric === 'dragFrames' ? 1 : 30) || values.some((n:unknown) => typeof n !== 'number' || !Number.isFinite(n) || n < 0)) errors.push(`Invalid ${size}/${metric} raw samples.`);
    }
    const runs = receipt.results?.[size]?.dragRuns;
    if (!Array.isArray(runs) || runs.length !== 5 || runs.some((r:unknown) => !Array.isArray(r) || r.length < 30) || JSON.stringify(runs.flat()) !== JSON.stringify(receipt.results?.[size]?.dragFrames?.samplesMs)) errors.push(`Incomplete ${size} drag runs.`);
  }
  const heap = receipt.heap?.samplesBytes;
  if (!Array.isArray(heap) || heap.length !== 20 || heap.some((n:unknown) => typeof n !== 'number' || !Number.isFinite(n) || n <= 0)) errors.push('Requires 20 valid heap samples.');
  return errors;
}
export function assessPerformance(candidate: Receipt, baseline?: Receipt): PerformanceGate {
  const errors = validate(candidate);
  if (!baseline) return {status:'incomparable', reasons:[...errors,'No comparable baseline supplied.']};
  errors.push(...validate(baseline).map(e => `Baseline: ${e}`));
  const keys = ['platform','release','cpu','cpuCount','memoryBytes','node','browser','playwright','viewport','reducedMotion','headless','server'];
  for (const key of keys) if (candidate.environment?.[key] === undefined || JSON.stringify(candidate.environment[key]) !== JSON.stringify(baseline.environment?.[key])) errors.push(`Environment differs or is missing: ${key}.`);
  if (candidate.harnessSha256 !== baseline.harnessSha256) errors.push('Harness differs; remeasure historical source with this harness.');
  for (const size of sizes) if (candidate.fixtures?.[size] !== baseline.fixtures?.[size]) errors.push(`Fixture ${size} differs.`);
  if (errors.length) return {status:'incomparable', reasons:errors};
  const reasons: string[] = [];
  const comparisons: NonNullable<PerformanceGate['comparisons']> = {};
  const budgets: Record<typeof metrics[number],number> = {open:2000,selection:100,filtering:100,preview:100,dragFrames:33};
  for (const size of sizes) for (const metric of metrics) {
    // Recompute summaries from raw values; never trust caller-supplied percentile labels.
    const before = summarize(baseline.results[size][metric].samplesMs).p95Ms;
    const after = summarize(candidate.results[size][metric].samplesMs).p95Ms;
    comparisons[`${size}/${metric}`] = {baselineP95Ms:before,candidateP95Ms:after,ratio:before ? after/before : after ? Infinity : 1};
    if (after > before*1.2) reasons.push(`${size}/${metric} p95 exceeds baseline by more than 20%; repeat on the idle matched host and investigate all outliers.`);
    if (size === '500' && after > budgets[metric]) reasons.push(`500/${metric} p95 exceeds ${budgets[metric]}ms.`);
  }
  // Heap is supporting evidence, not an invented numerical budget. A pass in timing
  // does not fulfill D3's independent trend investigation or final integration gate.
  return {status:reasons.length ? 'fail' : 'pass', reasons, comparisons};
}
