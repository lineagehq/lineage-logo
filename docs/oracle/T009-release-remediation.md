# T009 release remediation oracle

The 2026-08-24 release oracle used the authenticated public adapter, real local server,
Vite proxy, streamed SSE client, `SvgEditor` detached transaction path, review UI,
history, and workspace save/reopen endpoints. No CORS allowance was enabled.

- Chromium viewports: 1280 × 720 and 980 × 720.
- A first staging acknowledgement was fault-injected before it reached the server.
  The delivered frame was requeued when the new authoritative Vite stream connected,
  replayed with the cached staged result, and produced one review/effect.
- Producer-visible decisions converged to reverted for the reconnect proposal,
  accepted for the artifact replacement, and accepted for the targeted adjustment.
- Every file button was disabled while review was pending and restored after its
  terminal decision. A pending reload emitted an exact-origin revert beacon and the
  producer status converged to reverted.
- Accept/revert and preview controls were operated by keyboard. Accepted replacement
  remained one undoable checkpoint; undo and redo restored the old/new structure.
- Manual refinement preceded the targeted public-adapter paint adjustment.
- The saved iteration was reopened through `/api/svg`; its bytes exactly matched
  [T009-final.svg](artifacts/T009-final.svg).
- SHA-256: `9780ec8650c8255cac66e4579bf97388d2876dad5c186105cd34f67146463f56`.
- Size: 1406 bytes. Browser warnings, console errors, and page errors: zero.
- Structural proof retains the original root viewBox plus unrelated accent, clip,
  mask, and filter resources. Explicit deltas replace `icon` with `logo`, embed
  `agent-gradient` and `agent-spark`, retain nested transforms/text/title/use, and set
  the accepted fill to `#14b8a6`.
- No reserved lineage, review, transaction, or transport metadata is present.

The automated artifact test reads these durable bytes, recomputes the hash, parses the
structure, checks the explicit delta set, and rejects reserved metadata deterministically.
