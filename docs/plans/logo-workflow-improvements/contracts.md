# Execution contracts

These contracts implement the approved plan. They are frozen before downstream implementation; changes require a documented compatibility reason and updated regression tests.

## Document state and save

- An accepted document has a session ID, source path, monotonic revision, clean SVG, and last durable baseline. Selection, scope, session locks, undo/redo and viewport are editing context, not file content.
- Manual save captures clean SVG plus session/source/revision. At most one normal save is in flight. A late response may advance the baseline to the captured bytes only while the same document remains authoritative and no pending agent proposal has preempted it. Later edits remain dirty against those saved bytes.
- Save does not reload artwork or reset context/history. Advancing the source path must preserve the session revision and publish the new manifest. Save failure preserves edits and prior baseline.
- Reset returns to the latest durable baseline and clears editing context and history, matching the existing destructive-reset interaction; its label/help must explain this. Undo/Redo after ordinary Save remain available and never modify the saved file.
- Persistent saved/dirty/review/connection indicators derive from authoritative state; transient action descriptions cannot contradict it. Pending/provisional acceptance remains locked until a durable terminal receipt converges.

## Bulk operations

- Normalize selected ancestors and descendants to a disjoint target set. Never mutate a descendant twice. One atomic change yields one history checkpoint; invalid/no-op results yield none.
- Setting a group's paint changes its own presentation attribute, not explicit descendant attributes. Mixed and inherited paint must be described accurately. Locked ancestors, unsafe reference damage or pending review reject the entire edit.
- Duplicate local IDs collision-safely and rewrite copied local references; preserve unaffected references and paint order. Cross-parent operations preserve visual geometry and hierarchy.

## Preview and export

- Document bounds use the SVG viewBox/aspect ratio. Fit document includes document bounds; Fit artwork uses visible artwork bounds. At 100%, one root SVG unit is one CSS pixel when a valid viewBox exists; fallback behavior is explicit.
- Background modes affect the surface behind transparent SVG content, never authored SVG attributes. Opaque authored backgrounds remain opaque. Preview, framing, background and export actions do not change history or saved bytes.
- Subset export includes required local resources; requested hidden/missing/invalid targets fail clearly. SVG/PNG is the bounded output scope; do not imply PNG files are native ICO files.

## Producer compatibility

- Existing v1 operations remain accepted. New operations use explicit version/schema support and strict known-field validation. Unknown input never silently becomes a different action.
- Default context remains redacted. A user-requested local snapshot is an atomic accepted-document projection bound to editor/session/revision/digest, with no token. Pending review exposes no candidate as accepted state.
- Structural artifact mode explicitly extracts the selected artifact group and referenced resources. Operation-only mode has no unrelated artifact requirement. Narrow text/transform operations reuse validation and atomic evaluator semantics.
- Reviewer feedback remains escaped bounded data. Reject-and-request-revision never changes accepted artwork. A retry obtains fresh context and uses an appropriate new transaction identity; exact duplicate delivery retains idempotence.

## Recovery

- Draft identity uses an opaque server-issued workspace identity rather than folder basename alone, plus source path/hash and revision. Recovery offers a choice; no draft can silently overwrite source or accept an agent proposal.
- Normal manual recovery and pending/provisional agent recovery have explicit precedence. Storage failure is visible and preserves normal save availability.

## Integration ownership

- Root integrator owns main.ts, styles.css, editor.ts integration, graph/receipts and PR/merge actions.
- Fixture owner owns new ux-audit fixtures, performance harness and baseline measurement evidence.
- Preview, producer and QA owners use separate worktrees and dedicated modules/tests; shared-file changes are serialized or explicitly leased.
- Existing fixed-port E2E suites run one at a time on this host. No performance measurement runs concurrently with other browser suites.

## Repository merge policy observed

At execution start main requires up-to-date `verify` and `browser-qa` checks, enforces protections for administrators, requires conversation resolution, and disallows force pushes/deletion. No required approval count or additional ruleset was returned by GitHub. The execution policy still waits for all six configured CI jobs and independent review evidence. This observation does not authorize weakening repository policy.
