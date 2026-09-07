# Execution v1 — completion evidence in progress

**D1 is merged and verified. D2/G4 remain open; U1 has no participant results.** Standing execution and qualifying-merge approval remains active. This report requests no renewed merge permission and does not replace the acceptance criteria in `plan.md`.

The integrated application at `62b20a551d484b2b13820e1e4cca9c486a5cd113` passed the matched D3 timing gate and the installed package is SHA-256 `efb1a6d0dc2dd7fe68db7a50dcbbdcd11b8474bd25bc0605f78a17f52fa6a8cf`. The same package digest was independently produced by Node22 Ubuntu/macOS and Node24 CI, and by the combined installed agent/manual/export test. Later changes currently affect only tests and maintainer evidence, not packaged application behavior.

| Requirement | Executable evidence | Current boundary |
| --- | --- | --- |
| Create/import, structural proposal, exact revision feedback and preserving follow-up | `tests/e2e/guided-creation-installed.spec.ts`; `evidence/g4-installed.json` | Installed public CLI and UI passed on macOS and Linux. |
| Cross-parent manual edits, transforms, organization and saved-baseline undo | `tests/e2e/workspace/manual-tranche.spec.ts`, `tests/e2e/workspace/manual-save-continuity.spec.ts` | Included in integrated126-case macOS run. |
| Manual draft restoration, changed-source and wrong-workspace refusal | `tests/e2e/workspace/manual-drafts.spec.ts`, `tests/manual-draft-store.test.ts` | Browser recovery plus explicit source/workspace identity validation. |
| Rejection/reconnect and failed-save integrity | `tests/e2e/release/critical-path.spec.ts`, `tests/e2e/workspace/manual-save-continuity.spec.ts`, `tests/agent-transaction.test.ts` | Linux revealed an assertion ahead of browser highlight cleanup; exact preservation assertion now awaits UI settlement, five consecutive repetitions passed. Additional live agent fault coverage is being completed. |
| Named version, full/mark/wordmark SVG, PNG and process restart | `tests/e2e/installed-exports.spec.ts`, `tests/e2e/guided-creation-installed.spec.ts` | Independent XML/pixel checks;30 combined export hashes recorded. |
| Browser engines, corpus, zoom, accessibility and current LTS | `integration/d2.md`, `evidence/d2.json`, `evidence/d2-packages/` | PR38 final CI passed ate76bdea after the test-only synchronization fix. Real assistive-technology observation remains unverified. |
| Performance and repeated-cycle memory | `evidence/d3/README.md` and both raw JSON receipts | All15 timing comparisons and500-layer budgets passed; bounded heap trend independently reviewed. |
| Three independent people on the same accepted candidate | `usability-study/` | Preparation only; no ready candidate or participant outcomes asserted. |

VoiceOver, Full Keyboard Access and the on-screen Accessibility Keyboard were investigated through the desktop interface. The tools did not expose reliable screen-reader output or an operable assistive keyboard panel. No real assistive-technology pass is inferred from ordinary key events or AX text. The original off settings were restored and confirmed; dedicated test tabs were closed. A real observation remains required by D2.

PR37 (named versions and faithful exports) merged as `52655d2d1da785914a716f628b09b2cc23ab5636`; PR and postmerge main CI/CodeQL passed. PR38 holds the broader quality implementation. It must meet the remaining D2 acceptance requirements before merging, after which main CI and the extended workflow can be verified. The final evidence PR depends on that integration. No public publication, deployment, release approval change or participant outreach occurred.

The dependency graph remains authoritative in `graph.json`; each node links its acceptance contract in `plan.md`. G4 and the whole recommendation set stay incomplete until their explicit requirements pass. The real-participant study is distinct from agent-operated testing.
