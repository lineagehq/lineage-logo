# T012 terminal-before-file-response oracle

The 2026-08-24 oracle ran through Vite, the real local server, authenticated
public logo-designer adapter, streamed SSE staging, review UI, and application
file-open lifecycle. A local pass-through held each real SVG response after Vite
received it; response bytes were not mocked.

- An open from `concept-1.svg` to `concept-2.svg` was held while transaction
  `t012-accept-before-release` entered review and was accepted by keyboard.
- Releasing the old response left the accepted canonical SVG byte-identical,
  selected on `concept-1.svg`, dirty, save-enabled, and undoable. Producer status
  converged to `accepted`.
- A fresh explicit switch displayed the normal dirty-document discard dialog.
  Dismissing it preserved the accepted paint; accepting a second fresh dialog
  allowed `concept-2.svg` to open.
- An open back to `concept-1.svg` was held while transaction
  `t012-revert-before-release` entered review and was reverted by keyboard.
- Releasing that old response left the original `concept-2.svg` canonical bytes,
  clean dirty state, zero undo history, selected file, and review state unchanged.
  Producer status converged to `reverted`.
- Browser warnings and console errors: zero.

Deterministic real-session tests cover accept-before-release and
revert-before-release with canonical SVG, dirty, session, revision, selection,
file UI, manifest, editor-load, review, and history assertions. The T010
pending-at-release and out-of-order regressions remain in the same suite.
