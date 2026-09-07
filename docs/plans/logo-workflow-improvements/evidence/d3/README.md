# D3 matched historical and integrated candidate measurement

Historical app: `fbfa870c0f7fb174c58fbb34e3fa0531e8971770`. Integrated G3 + D1 + D2 candidate: `62b20a551d484b2b13820e1e4cca9c486a5cd113`. Both runs used the exact candidate harness `c59057ba9167ec62ab1bc6a6c87f563a5bf51c126aec9ce6979fff665c960317`, with matching fixture hashes and environment. No implementation optimization was made.

The timing gate passed all 15 size/metric comparisons. The largest measured p95 increase was 10.84% (500-layer preview), below the approved greater-than-20% regression guardrail. All five 500-layer absolute budgets passed. Every raw sample and outlier is retained in the JSON receipts; these are development-build measurements, not production-build claims.

| Layers | Metric | B0 median / p95 (ms) | Candidate median / p95 (ms) | p95 change |
| --- | --- | ---: | ---: | ---: |
| 100 | open | 25.25 / 26.80 | 20.85 / 22.20 | -17.16% |
| 100 | selection | 12.30 / 14.40 | 12.85 / 15.10 | +4.86% |
| 100 | filtering | 11.75 / 14.20 | 12.15 / 14.80 | +4.23% |
| 100 | preview | 15.95 / 16.70 | 16.00 / 17.10 | +2.40% |
| 100 | dragFrames | 8.30 / 8.70 | 8.30 / 9.60 | +10.34% |
| 500 | open | 64.85 / 66.80 | 68.45 / 71.00 | +6.29% |
| 500 | selection | 12.60 / 16.20 | 12.50 / 17.40 | +7.41% |
| 500 | filtering | 14.70 / 18.40 | 14.30 / 15.40 | -16.30% |
| 500 | preview | 53.60 / 65.50 | 60.60 / 72.60 | +10.84% |
| 500 | dragFrames | 8.30 / 8.80 | 8.30 / 9.70 | +10.23% |
| 1000 | open | 173.40 / 181.50 | 178.85 / 187.10 | +3.09% |
| 1000 | selection | 14.00 / 17.10 | 12.30 / 17.00 | -0.58% |
| 1000 | filtering | 19.55 / 31.60 | 21.85 / 33.10 | +4.75% |
| 1000 | preview | 155.45 / 169.50 | 162.10 / 181.60 | +7.14% |
| 1000 | dragFrames | 8.30 / 9.50 | 8.30 / 9.80 | +3.16% |

## Configuration and noise

macOS 25.4.0, Apple M5 Max, 18 CPUs, 137438953472 bytes RAM, Node v22.22.3, Chromium 151.0.7922.34, Playwright 1.62.1, headless 1440×1000, reduced motion, Vite + repository API, `lineage-performance.localhost:43218`. This matches original B0 configuration exactly. Both target repositories were verified clean before measurements; the historical worktree had its own lockfile dependencies.

An exclusive project browser/build/test lease covered these sequential runs. The machine was not CPU-isolated: sampled background WindowServer CPU was about 68% during B0 and 65% during candidate; application background processes remained active. This makes small differences unsuitable for precise improvement claims. No greater-than-20% p95 regression appeared, so no regression-triggered repeat or optimization was required. Startup is separate; all 30 measured discrete repetitions after two warmups, five independent drag traces per size, and every outlier remain available.

The immutable original `../performance-baseline.json` was preserved. Its flawed reload starting condition, overlapping drag callback sampler, and absent heap evidence make it methodologically incomparable to the repaired harness. `b0-attempt-01.json` remeasures the immutable historical app with the exact same repaired harness as candidate; it does not rewrite that original receipt.

## Heap trend review

| Evidence | First bytes | Last bytes | Delta bytes | First five median | Last five median | Last ten slope (bytes/cycle) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| B0 | 5849620 | 6224164 | 374544 | 5964164 | 6176828 | 10340.02 |
| Candidate | 6647100 | 7033748 | 386648 | 6777348 | 7014364 | 5242.64 |

Twenty cycles kept the same renderer alive while opening the 500-layer document, editing it, explicitly discarding if requested, and unloading to the empty document. Heap was sampled after explicit garbage collection. Candidate retains a larger steady working set, but its total growth differs from B0 by only 12104 bytes and its latter-half slope is lower. Both traces rise primarily during warmup and then substantially flatten; there is no observed candidate-specific acceleration. This supports the bounded trend check; twenty observations cannot establish mathematical absence of unbounded growth or all leak classes. No invented heap budget was used.

## Outcome and evidence identity

D3 timing acceptance is satisfied for candidate `62b20a551d484b2b13820e1e4cca9c486a5cd113`, with the supporting heap review above. This does not mark G4 or the full plan complete, substitute for functional/visual/CI evidence, or establish acceptance of later code changes. No measured bottleneck justified optimization. Both owned servers and browser were cleaned up and the benchmark lease released.

- `b0-attempt-01.json` SHA-256: `bb73101798f29aa4ae32f09a8b30c1c60441bf0071911ce6caab49a25f5b5933`.
- `candidate-attempt-01.json` SHA-256: `fe09419137de88bf7f499cb5422858dfcbc1c0b5d5f6e0e61cd215bc72655a44`.
