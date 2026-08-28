# Complex Seatify adversarial walkthrough v1

Version: 1.0
Fixture: `tests/fixtures/workspace/concepts/complex-seatify.svg`
Purpose: repeatable manual-and-agent browser proof for the complex-logo oracle. This document is an execution contract, not evidence that browser QA has already passed.

## Preconditions and evidence record

Copy the fixture into the disposable workspace used by the local server. Do not edit the canonical Seatify workspace. Open the editor on its descriptive `.localhost` URL, clear the browser console, and record the commit, browser, workspace path, source SVG hash, and start time. Capture screenshots before editing, after the mixed edit sequence, after full undo, after full redo, and after reload.

Record each checkpoint as `pass`, `fail`, or `blocked`, with selected layer IDs, dirty state, visible result, console errors, and the saved iteration path. A mismatch is a finding; do not silently revise this walkthrough to fit current behavior.

## Structure, navigation, and resource boundary

1. Open `complex-seatify.svg`. Confirm 42 selectable layers, meaningful labels, and the nested chain `venue-logo > venue-mark > seating-map > table-clusters > table-cluster-west > west-seat-north` (six meaningful levels).
2. Search for `seat`, `ticket`, and `aisle`; confirm the expected named results. Clear search and expand/collapse the venue, seating, ticket, and wordmark branches. Navigation alone must not dirty the document.
3. Select `west-seat-north` exactly, then use ancestry navigation to visit `table-cluster-west`, `table-clusters`, `seating-map`, and `venue-mark`. Return to the leaf and confirm its stroke and paint remain intact.
4. Multi-select adjacent siblings `west-seat-north`, `west-seat-east`, and `west-seat-south`. Confirm alignment and grouping are available. Then add `east-seat-north` and confirm same-parent organization is rejected without changing the SVG.
5. Select `ticket-ribbon` and `ticket-stub`. Confirm both leaves are selectable, visible, and retain their local clip/mask and paint references. Record that direct transform handles on these resource-backed leaves are intentionally unavailable. Nudge `ticket-ribbon-wrapper` and `ticket-stub-wrapper` right once each (two atomic history checkpoints), then verify both resources still render.

## Mixed edit sequence and history

Starting from the unmodified fixture, perform these operations in order and record the selected IDs and dirty state after every operation:

1. Move `table-cluster-west` 12 px right with Shift+Right, Right, Right (three atomic history checkpoints).
2. Rotate `table-cluster-east` by 4 degrees.
3. Expand Geometry and set the exact Scale field for `stage-zone` to `96%` (one atomic checkpoint); do not estimate 96% with the pointer handle.
4. Change `stage-light-left` fill to `#ff9f1c`.
5. Change `aisle-center` opacity to `0.55`.
6. Edit `venue-caption` text to `Venue plan · doors 7:30 PM`.
7. Duplicate `accent-star` and confirm the copy receives a distinct stable identity.
8. Reorder the duplicated star one position earlier among the `ticket-accent` children.
9. Align `west-seat-north`, `west-seat-east`, and `west-seat-south` on their vertical centers.
10. Group the same three adjacent west-seat siblings, then rename the neutral group `West priority seats` (two atomic checkpoints: group and rename).
11. Ungroup `West priority seats` and confirm the three named leaves return in the same relative order.
12. Hide `entrance-left`, then show it again (two atomic checkpoints).

The complete enumerated run creates 18 atomic checkpoints: two wrapper nudges, three west-cluster keyboard moves, and one each for rotation, exact Scale, paint, opacity, text, duplicate, reorder, alignment, group, rename, ungroup, hide, and show. Undo all 18 checkpoints one at a time. At the original state, compare exact clean serialization, hierarchy, labels, paint references, transforms, text, and rendering with the opening checkpoint; Undo, Save, and Reset edits must be disabled while Redo remains enabled. Redo all 18 checkpoints and compare with the post-edit checkpoint; Save and Reset must be enabled away from baseline. No undo or redo step may corrupt `url(#venue-gradient)`, `url(#ticket-gradient)`, `url(#ticket-ribbon-clip)`, or `url(#ticket-stub-mask)`.

## Agent review boundary

With the redone state active, ask the logo-designer agent for one bounded proposal: change `seatify-tagline` text to `EVERY GUEST CONNECTS` and change only its fill to `#33245f`. Confirm the proposal names the existing target and does not insert a new SVG layer.

Stage the proposal and inspect its diff. First reject it; selection, hierarchy, and the dirty state from the manual sequence must remain intact. Request the same bounded proposal again, accept it, and manually correct the text back to `EVERY SEAT CONNECTS` while retaining the proposed fill. Record proposal/session identity, staged target, reject outcome, accept outcome, selection after each outcome, and any console error.

## Save, reload, and comparison

1. Save an iteration and record its numbered path. Confirm the source fixture was not overwritten.
2. Reopen the saved iteration and compare the named selectable layer count, ID uniqueness, ancestry chains, aria-labels, transforms, text, and all four local resource references with the pre-save state.
3. Compare the rendered venue shell, tables, aisles, clipped ribbon, masked stub, and wordmark against the pre-save screenshot. Editor handles and `data-lineage-*` state must be absent from saved SVG.
4. Reload the page once. Record the active document, nested selection, zoom, preview background, sidebar states, dirty state, and console output. Restoration expectations belong to the later versioned-restoration package; for this pre-restoration run, record current behavior without treating the known absence of general restoration as an asset defect.

## Adversarial limitations and failure rules

- A resource-backed leaf without direct transform handles is expected; a missing leaf selection, broken rendering, stripped reference, or wrapper transform failure is not.
- Group/reorder/align rejection for mixed-parent selections is expected and must not mutate or dirty the document.
- Agent insertion of new layers is out of scope. Reject any proposal that attempts it.
- Stop destructive edits if the active file is outside the disposable workspace or if Save would overwrite a source file.
- Record a defect when selection/navigation dirties the document, a supported edit changes unrelated nodes, IDs collide, hierarchy changes unexpectedly, a local resource is stripped or retargeted, undo/redo diverges, the saved iteration differs structurally, or the console reports an editor-owned error.

## Completion record

The run is complete only when every section has evidence and all unexpected findings are linked to a bounded follow-up task. Record `full_outcome_complete: false` until later restoration QA also proves reload and clean local-server restart behavior, stale-target fallback, and the final `npm run check` gate.
