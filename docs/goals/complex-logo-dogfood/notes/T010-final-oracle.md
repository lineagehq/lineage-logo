# T010 final complex-logo oracle

Run date: 2026-08-27
Final client: `http://complex-seatify-final.localhost:5175/`
Clean-origin check: `http://complex-seatify-clean.localhost:5175/`
Disposable workspace: `/tmp/lineage-logo-complex-fix.Y6eMkW`
Final gate: 19 files / 341 tests passed; typecheck and production build passed.

`full_outcome_complete: true`

## Ten-step oracle transcript

1. **Complex structure:** The final bundle opened the 42-layer source fixture with meaningful names and the six-level `Venue logo / Venue mark / Seating map / Table clusters / West table cluster / West north seat` ancestry. A separately named clean browser origin opened with no document, 100% zoom, Grid background, both sidebars expanded, disabled history/save controls, and no console error.
2. **Navigation:** Layer search for `seat` returned the expected table/seat rows; clearing search restored all 42 layers. Seating disclosure collapsed and expanded. Exact nested selection and ancestry navigation remained clean. Three adjacent west seats could be multi-selected and Group was enabled.
3. **Representative edits:** The final surface repeated all 18 documented atomic checkpoints: two wrapper nudges, three west-cluster moves, rotation, exact scale, fill, opacity, text, duplicate, reorder, alignment, group, rename, ungroup, hide, and show. Every edit enabled Undo/Reset/Save and disabled Redo.
4. **History:** All 18 undo and redo boundaries passed. At exact origin, Undo/Reset/Save were disabled and Redo enabled. At the redone endpoint, Undo/Reset/Save were enabled and Redo disabled. Every intermediate boundary exposed both Undo and Redo without paint or hierarchy loss.
5. **SVG resources and fidelity:** The final edited values matched the prior exact checkpoint. `url(#venue-gradient)`, `url(#ticket-gradient)`, `url(#ticket-ribbon-clip)`, and `url(#ticket-stub-mask)` survived history, save, reload, and restart. The visible stage, tables, aisles, clipped ribbon, masked stub, and wordmark rendered coherently. Saved SVG contained no selection handles, reserved transient attributes, or Lineage metadata.
6. **Agent review boundary:** A public adapter `set-paint` proposal for the existing `Seatify tagline` staged in Agent review on the final document. Revert returned transaction `final-qa-final` as `reverted`; the original fill, three-layer manual selection, manual dirty state, and full edited SVG remained intact. No layer insertion was requested.
7. **Save and reopen:** Save created `iterations/iteration-1.svg`, advanced the next target to iteration-2, reopened a clean 43-layer document, and left the copied source fixture byte-identical. Undo/Reset/Save were disabled. Local gradients, clip, mask, transforms, text, and duplicate identity remained present.
8. **Reload and server restart restoration:** On the saved iteration, the browser selected `West north seat`, set 125% zoom and Dark preview, and collapsed both sidebars. A page reload restored the document, all 43 layers, the complete nested selection/ancestry, 125%, Dark, and both collapsed panels without dirtying. The QA server was then fully stopped and restarted on the same descriptive origin and disposable workspace; reloading again restored the same document, selection, zoom, background, and sidebar states. Save/Reset/Undo remained disabled and the console remained clean.
9. **Stale target fallback:** With the saved active document and nested selection persisted, the disposable iteration was changed to omit `west-seat-north`. Reload opened the SVG, selected the nearest surviving `West table cluster` ancestor, retained 125% and Dark, and remained completely clean with no console error. The temporary file was then restored from its QA backup. Schema mismatch, invalid values, unsafe paths, missing files, and unavailable storage also have focused automated coverage in `tests/session-restoration.test.ts`.
10. **Final quality gate:** Browser warning/error output was empty across clean load, editing, agent review, save, reload, restart, and stale-target fallback. The source fixture remained byte-identical. `npm run check` passed typecheck, all 341 tests in 19 files, and the production Vite build.

## Evidence map and remaining limitations

- The exact 18-boundary namespace-order regression is independently recorded in `T015-browser-recheck.md`.
- The duplicate-label and accept/revert agent boundary are independently recorded in `T012-browser-reqa.md`; the final run re-proved the reject path after restoration changes.
- Session schema, bounds, and fallbacks are documented in `session-restoration-v1.md`.
- Cross-tab agent ownership transfer and agent-driven insertion of entirely new SVG layers remain explicitly deferred. Neither is required by this goal.

No unresolved high-confidence goal-owned defect remains.
