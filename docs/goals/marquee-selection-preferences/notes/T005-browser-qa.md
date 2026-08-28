# T005 browser QA — marquee selection

Date: 2026-08-27

Target: `http://constellation.localhost:5180/`

Fixture: saved Seatify constellation example (44 visible layers)

## Passed checks

- Reloaded the current implementation before testing.
- At 99% zoom, a primary drag from blank SVG space fully enclosing the top-level combination mark selected that direct-scope layer and displayed the standard transform box.
- Double-clicking the center point entered the nested `Circular table` selection scope.
- A stage-padding marquee in that scope selected `Table aura`, `Table surface`, and `Optimized center point` without selecting ancestors.
- Every selected layer appeared selected in the layer tree; the two secondary layers had `data-lineage-secondary`, while only the primary had handles.
- Meta-click away from the handle overlay precisely removed `Table surface` from the three-layer selection.
- Shift-marquee re-added `Table surface` and preserved the existing same-scope selection.
- Selection-only marquee, additive, exact-toggle, locking, and Escape actions left Undo and Save disabled.
- At 149% zoom with both sidebars collapsed, the same nested marquee selected all three circular-table children using transformed client bounds.
- Selecting and locking `Optimized center point` produced one visible blue `data-lineage-primary-fallback` marker and no transform handles; unlocking restored handles.
- Meta-clicking `Seatify title` from the circular-table scope replaced selection and reset to the wordmark scope without dirtying the SVG.
- Escape cleared selection without enabling Undo or Save.
- Browser console contained no warnings or errors.

## Failed check — precise-modifier drag over the selection overlay

At 149% zoom, with `Seatify title` already selected:

1. Begin a Meta-drag near the middle of the selected title, where the svg.js `.svg_select_shape` overlay receives the pointer.
2. Drag from approximately `(620, 535)` to `(650, 560)`.
3. The title moves by approximately `(30, 25)` pixels.
4. Undo and Save become enabled.

Expected: a precise-modifier pointer sequence over the selected object is selection-only; movement beyond the threshold cancels without selecting or mutating.

Observed cause boundary: the capture-phase precise-selection guard excludes editor handles. The svg.js bounding selection shape is therefore allowed to reach the plugin drag handler even though the gesture began visually on the selected object.

The QA movement was immediately undone. The title returned to its original client position, and Undo and Save returned to disabled.

## Decision

T006 preferences work must not begin yet. Add one bounded remediation for precise-modifier drag suppression when the target is the selection bounding shape, followed by read-only review and a targeted real-browser recheck.

Space-drag, middle-drag, active-marquee Escape, and lost-capture behavior retain substantive automated coverage. The available browser driver did not expose separate pointer-down/up control needed to reproduce every in-progress lifecycle path manually; the targeted recheck should focus on the confirmed overlay path and repeat core marquee behavior after the fix.
