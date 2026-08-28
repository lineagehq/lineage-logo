# T014 targeted browser recheck

Date: 2026-08-27

Target: `http://constellation.localhost:5180/`

## Current-state proof

- Reloaded the updated implementation before testing.
- The workspace restored at 149% zoom with Undo and Save disabled.
- Meta-click selected `Seatify title` precisely without dirtying the document.
- T012's behavioral regression covers a Meta-modified 30x25 drag beginning on `.svg_select_shape`; it proves propagation never reaches the mutation listener, clean SVG bytes remain exact, selection remains unchanged, and no undo checkpoint is created.
- Fresh review confirmed `.svg_select_shape` and `.svg_select_shape_pointSelect` resolve to the current selected object, while true resize and rotation handles are excluded from this interception.

## Browser-driver limitation

The in-app browser drag helper did not carry Meta through the pointer sequence. `Meta`, `META`, and `CMD` drag-key spellings all produced the same ordinary 30x25 title movement, even though Meta-click was delivered correctly and performed precise selection. Each movement was immediately undone.

This result is not treated as evidence that the fixed application path failed because the event reaching the app was an ordinary drag rather than a Meta-modified drag. It is also not treated as full manual proof of the modifier-drag fix. Final completion must retain a human manual check: select an object, hold Cmd, drag from inside its selection box, and confirm the object does not move or dirty history.

## Regression checks passed in the live canvas

- Ordinary drag from the selection bounding shape still moved the selected title and enabled Undo/Save; Undo restored the exact original markup and clean controls.
- The rotation handle remained interactive and produced a rotation transform; Undo restored exact original markup and clean controls.
- A resize handle remained interactive and changed text geometry; Undo restored exact original markup and clean controls.
- At 100% zoom, a stage-padding marquee selected all three direct children of `Seatify wordmark` (two secondary outlines plus one primary handle set).
- Meta-click away from the selection overlay removed one exact child from that multi-selection.
- Those selection-only actions kept Undo and Save disabled.
- Browser console warnings/errors remained empty.

## Decision

Proceed with T006 preferences because the implementation, behavioral regression, adversarial review, and all surrounding live-browser paths are green. Do not mark the overall goal complete until the final browser QA includes the human Cmd-drag confirmation above.
