# T006 genuine logo-designer skill integration oracle

Date: 2026-08-24. This oracle used a fresh `mktemp` workspace at
`/tmp/lineage-t006-oracle.22wdFZ`; it did not read or modify user artwork.

## Genuine skill lifecycle before Lineage

The local upstream `logo-designer` skill was followed with an icon-only,
minimal/geometric brief and a navy, teal, coral, and sky palette. Explore produced
three distinct self-contained 512×512 concepts: linked orbit, oracle prism, and branch
monogram. Refine selected the prism, retained the meaningful `logo`, `shield`, `prism`,
`signal`, `focus`, and `horizon` IDs, enlarged the focus, and added a small-size
horizon. A standalone `logos/preview.html` showed all concepts, the refinement, and
64/32/16 px checks before Lineage was started. Chrome visibly rendered that preview.

The pre-Lineage proposal was 509 bytes with SHA-256
`59652c363192a5a70c5f668c67c5115b3e302ef0cfe03a027cf08463fbca5112`.
The durable copy is `artifacts/T006-skill-proposal.svg`.

## Protected setup and public handoff

Lineage started against only the temporary `logos` directory. The runtime context
directory was owner-only `0700` and its regular descriptor was owner-only `0600`.
Neither file contents nor the capability value were printed, copied, passed in argv,
placed in a URL, captured in receipts, or recorded here.

Use npm's silent mode so its lifecycle banner cannot precede the adapter's single JSON
stdout value:

```bash
npm --silent run agent:submit -- \
  --mode replace \
  --artifact /absolute/path/to/logos/iterations/iteration-1.svg \
  --selector '#logo' \
  --target-name logo | \
node /absolute/path/to/logo-designer/skills/logo-designer/scripts/lineage-handoff.mjs \
  --logos /absolute/path/to/logos
```

The adapter discovered the protected context internally. The handoff consumed stdin
only and emitted metadata-only receipts.

## Revert oracle

Transaction `t006-revert` targeted `concepts/concept-1.svg` at revision 0. Before the
decision, the canonical layer tree still showed `outer-ring`, `inner-field`, `link-a`,
and `link-b`; the isolated proposed preview instead showed the prism's five stable
children. Workspace switching, save, undo, redo, visibility, and history controls were
disabled while review was pending.

Chrome clicked Revert. The canonical tree returned unchanged, Undo stayed disabled,
the handoff exited 20 with status `reverted`, and the iteration count remained one.
No iteration or temporary reservation was created.

## Accept, persistence, history, and reopen oracle

Transaction `t006-accept` repeated the genuine proposal against the unchanged document.
Chrome clicked Accept all. The browser reported one accepted undoable edit and exposed
the accepted prism tree. The adapter/handoff receipt bound:

- transaction: `t006-accept`
- source: `concepts/concept-1.svg`
- revision: 1
- persisted path: `iterations/iteration-2.svg`
- bytes: 588
- SHA-256: `eb7556d2ec1c9f4d1396cf217d38c44a72a42b9453cbadffdb7edcef24963284`

Exactly one new handoff iteration appeared. Its bytes matched the receipt. Undo restored
the original linked-orbit children; Redo restored `shield`, `prism`, `signal`, `focus`,
and `horizon`. Saving allocated collision-safe `iteration-3.svg`; save/reopen bytes were
identical to iteration 2 at the same 588-byte hash. The durable accepted oracle is
`artifacts/T006-skill-accepted.svg`.

The accepted and reopened SVGs contain no `data-lineage-*`, `data-agent-*`,
`data-review-*`, `data-transport-*`, `transactionId`, or `lineage-logo-edit` metadata.

## Exact continuation by the skill

The real skill continued from the receipt's exact `iterationPath`, not from the proposal
or browser memory. The next refinement retained every stable geometry ID, deepened the
shield, strengthened the coral signal, enlarged the teal focus, and widened the sky
horizon. Only those explicit changes and the title differ from accepted iteration 2.
The continued artifact is 602 bytes with SHA-256
`c7b86d04f958c2b13f73eba15d5812b58c7b2243e642d1e9e87b6a668de04b5b` and is stored as
`artifacts/T006-skill-continued.svg`. The standalone preview was regenerated with the
continued iteration first and updated 64/32/16 px checks.

## Recovery oracle

The final convergence rerun added two deterministic races. The direct real-HTTP/session
harness used a short server review bound and consumed the exact `t006-timeout-proof`
reverted terminal event without a decision call; canonical SVG, revision, and history
stayed unchanged and the locks cleared. Reconnecting to the same server retained its
UUID identity and did not disturb review state. In connected Chrome, replacing the
server produced a new secret-free UUID: a detached proposal cleared safely, while an acceptance made
provisional immediately before replacement remained visibly locked as uncertain.
Chrome used the explicit **Restore previous document** action to roll back that exact
checkpoint, after which a new transaction completed normally. No SVG, capability,
origin, file path, or transaction payload appeared in either control event.

- `t006-timeout-proof` used a 25 ms bound. It exited 26 with status `timeout`, created
  no iteration, and said not to resubmit automatically. Its one pending browser review
  was explicitly reverted.
- The first `t006-duplicate` payload remained pending while a different payload reused
  that ID. The second exited 25 as `conflict` without a write or automatic retry; the
  original was explicitly reverted and exited 20.
- With Lineage stopped, a new invocation produced a pre-transaction `unavailable`
  envelope with no fabricated transaction, path, or revision and exited 24. The browser
  visibly reported disconnected while retaining the accepted document.
- Restarting the same temporary workspace reconnected automatically, listed all four
  iterations, reopened exact persisted iteration 2, and delivered `t006-reconnect`.
  Explicit Revert completed it at exit 20, proving no transaction was stranded.
- Focused HTTP/session tests corroborate stale-document handling, unsafe SVG rejection,
  exact duplicate dedupe, conflicting IDs and decisions, acknowledgement retry,
  disconnected delivery, pre-ack reconnect replay, and provisional rollback. These are
  exercised in `agent-producer-client.test.ts`, `agent-transport.test.ts`, and
  `agent-history.test.ts` by the required verification below.

Permanent adapter assertions reread all three durable T006 SVGs on every integration
run, validate the clean-SVG boundary, reproduce their 509/588/602-byte sizes and exact
SHA-256 values, verify the six stable IDs, confirm the accepted-to-continuation title,
paint, focus-radius, and horizon deltas, and reject editor/transport metadata.

Chrome's captured console contained no warnings or errors after recovery. All temporary
processes and the oracle workspace were removed after durable artifacts and this
secret-free transcript were recorded.
