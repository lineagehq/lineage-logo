# T008 integrated browser QA

## Environment

- Live saved complex Seatify constellation example on `http://constellation.localhost:5180/`.
- 44 selectable layers with nested groups, transformed seats, resource-backed table geometry, and wordmark text.
- Tested at 100% and 150% zoom with collapsed and expanded inspector states.

## Preferences and accessibility

- Toolbar gear and `?` opened the labelled **Preferences & shortcuts** dialog.
- Initial focus landed on **Precise-selection modifier**; Escape closed the dialog and returned focus to the toolbar invoker.
- Defaults were Command/Control, Fully enclosed, Logical group, and Individual outlines on.
- All four alternate values were set; the exact-selection shortcut copy changed to Option/Alt; all four values survived a full reload.
- Restore defaults changed all four controls immediately and the defaults survived another full reload.
- Strict malformed/future-version and storage-failure fallback is covered by `tests/selection-preferences.test.ts`; browser policy forbids direct local-storage inspection or mutation, so no false manual claim is made.
- Focus-loop boundaries, backdrop/invoker variants, and reduced-motion behavior are covered by the approved integration review and automated UX suite.

## Selection semantics

- From the root scope, the same nested table click selected **Seatify constellation combination mark** in Logical-group mode and **Optimized center point** in Exact-object mode. The layer tree and inspector matched the canvas selection.
- In Fully-enclosed mode, a stage-padding marquee ending over only the edge of **Table aura** produced no match and cleared the previous selection.
- With the same geometry in Touching mode, the marquee selected **Table aura**. The same touching probe passed at 150% zoom.
- A Shift-click in the layer tree added **Table surface**, yielding synchronized two-layer selection.
- With outlines on, the selection exposed one secondary marker plus one primary fallback for the resource-heavy primary. Turning outlines off removed both markers without changing the two selected layer rows; turning it back on restored both.
- Prior T005/T014 live probes cover nested/root marquees, Shift-union, stage-padding start, precise Meta-click, ordinary overlay drag, resize, rotation, cancellation, and restored clean state. The T006 integration review and behavioral suites re-prove those gesture boundaries after preference wiring.

## History, serialization, and console

- Selection-only and preference-only actions left Undo, Redo, and Save disabled.
- Selection feedback remained editor-only; clean SVG stripping and byte-stability are covered by the serialization and interaction suites.
- Browser warning/error console was empty at the final state.
- Final state was restored to 100% zoom and all chartered preference defaults.
- `npm run check` passed: 20 test files, 371 tests, typecheck, and production build.

## Remaining exact-human gate

The in-app browser drag helper cannot carry Command through pointer movement. A human must select the Seatify title, hold Command, and drag from inside the blue selection box. The title must not move, Undo and Save must remain disabled, and selection must not change. This is the only unclaimed oracle item.
