# D3 performance evidence contract

This harness measures the approved 100/500/1000-layer workloads. A timing pass is one part of D3; it does not mark D3, G4, or the plan complete. Final acceptance also requires review of the heap trend, a repeat of any apparent regression on the idle matched host, correctness checks after measured optimizations, and measurements of the integrated G3 + D1 candidate.

## Commands and output

Install the lockfile dependencies with `npm ci` and Chromium with `npx playwright install --with-deps chromium`. On the original B0 host, reserve an idle measurement lease; do not run another browser suite, benchmark, or build concurrently. Default ports are 43217/43218; environment overrides are `LINEAGE_LOGO_PERFORMANCE_API_PORT` and `LINEAGE_LOGO_PERFORMANCE_CLIENT_PORT`. The visible URL uses `lineage-performance.localhost`.

Capture historical source using the new harness, with an independently prepared clean worktree at the B0 commit `fbfa870c0f7fb174c58fbb34e3fa0531e8971770` and that worktree's own installed lockfile dependencies:

```sh
npx tsx scripts/ux-performance-gate.ts --target-root /absolute/path/to/b0-worktree --measure-only --output /absolute/path/to/b0-remeasurement.json
npx tsx scripts/ux-performance-gate.ts --baseline /absolute/path/to/b0-remeasurement.json --output /absolute/path/to/candidate-measurement.json
```

The runner refuses tracked changes in its target and refuses to replace an existing output file or the historical B0 receipt. Its harness and fixture hashes identify the measurement implementation independently of the target app commit. Always use the identical harness for the baseline and candidate. `--target-root` selects app sources and dependencies, while the running harness supplies its pinned Chromium and fixtures. Startup is recorded separately from warmed discrete actions. Two warmups are excluded, all 30 measured repetitions retained, and five independent drag traces retained. No outlier is deleted.

JSON output schema version 2 contains `commit`, `harnessSha256`, `fixtures`, `environment`, `method`, `results`, `heap`, and `gate`. Each discrete metric contains raw samples plus median/p95/min/max/count; each size also contains startup duration and all five drag traces. The comparison recomputes p95 from raw samples, rejects incomplete evidence and mismatched environments, and enforces >20% p95 regression plus the approved 500-layer absolute budgets (100ms selection/filter/preview, 33ms drag frame, 2000ms open).

- Exit 0 with `gate.status=pass`: comparable **timing** budgets passed.
- Exit 1 with `gate.status=fail`: at least one timing budget failed. An execution error also exits nonzero without a complete receipt; never treat a missing artifact as success.
- Exit 2 with `gate.status=incomparable`: missing baseline, invalid evidence, or an environment/harness/fixture mismatch. Investigate or remeasure; this is not a pass.
- Explicit `--measure-only` exits 0 with `gate.status=measured`, never `pass`. Scheduled Linux measurement can use this mode and archive evidence, but cannot satisfy the B0 comparison requirement.

## Why historical evidence needs remeasurement

The original `evidence/performance-baseline.json` is immutable historical evidence. It records macOS 25.4.0, Apple M5 Max, 18 CPUs, 137438953472 bytes RAM, Node v22.22.3, Playwright 1.62.1, Chromium 151.0.7922.34, headless 1440×1000, reduced motion, and Vite plus repository API. Measurements on different configurations are explicitly incomparable.

The original drag sampler reused a global active flag; a callback queued at the end of one run could resume when the next run set that flag. Its retained traces include duplicated intervals. Version 2 cancels the prior animation frame and gives every run its own array. Version 2 also dispatches the committed paint change, and adds missing heap evidence. These methodological changes prevent claiming the historical receipt itself is directly comparable. Remeasure the immutable B0 app commit with this same harness; do not rewrite or silently substitute the historical receipt.

## Heap and investigation

Twenty cycles open the 500-layer document, select and edit its first layer, then unload it by opening an empty document and explicitly discarding unsaved changes if requested. All cycles keep the same browser renderer alive; closing a browser page would conceal retained editor state. After each cycle the harness requests garbage collection and records used JavaScript heap bytes. The complete samples, first/last values, and delta remain available for trend review. This is supporting evidence, not a proof that all leaks are absent. There is no invented heap threshold or automatic exemption: investigate sustained growth, preserve every attempt, and document findings before D3 acceptance.

No measurements or performance improvement claims are supplied by this implementation document. Measurement must occur under the lease after integration; optimize only confirmed bottlenecks and retain the functional/visual correctness receipts for affected behavior.

## Harness implementation verification

At the preparation stage on base `04d633d85cea0b992ce004e5dceaa3b6171c6757`, repository type checking passed and all six focused `tests/ux-performance-metrics.test.ts` tests passed. They exercise inclusive budget boundaries, retained outliers, recomputation from raw samples, absolute budgets, incomplete evidence, and environment/harness incompatibility. No browser or benchmark was run during preparation; the exclusive measurement lease and integrated candidate remain pending.

### Open-sampler regression repair

The timed open now clears the isolated origin's session and local storage before app initialization, reloads before every repetition, and confirms an empty artboard with disabled layer search before starting the clock. The timed function refuses an already loaded document. Its completion predicate therefore observes a new document load rather than stale geometry from restoration. Setup and reload remain outside the discrete interval; startup remains separately recorded. The sampler helper is included in the harness hash, so before/after comparison requires historical remeasurement with this exact repaired harness.

`tests/ux-performance-open.test.ts` runs the real repository app on two ephemeral ports. It first proves a loaded 100-layer document is restored by ordinary reload, verifies that the sampler rejects that stale starting state, and then holds each of two SVG fetches for 1600ms after the repaired empty setup. Neither measurement resolves while the response is held; both include at least 1500ms and end with all 100 rects loaded. Repository type checking and all seven focused open/comparison tests passed. This is a correctness regression test, not a benchmark result or a budget change.

The browser regression is explicitly opt-in so unit-only CI does not unexpectedly require a browser installation. Run `LINEAGE_LOGO_PERFORMANCE_OPEN_REGRESSION=1 npx vitest run tests/ux-performance-open.test.ts tests/ux-performance-metrics.test.ts` after installing Chromium, under a browser-test lease. The ordinary unit run still executes the six pure comparison tests and reports the browser regression as skipped.
