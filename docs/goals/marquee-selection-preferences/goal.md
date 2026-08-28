# Marquee Selection and Preferences

## Objective

Give Lineage Logo a predictable, professional multi-object selection workflow for complex SVGs: drag a marquee over objects, add to a selection, precisely toggle individual objects, see every selected object clearly, and control the few meaningful selection preferences without destabilizing pan, drag, history, or serialization.

## Original Request

Save the improved Seatify constellation logo as an example, then plan a selector where dragging highlights multiple objects, a modifier-click selects or removes an individual object, and users can control that hotkey and other useful options in settings.

The Seatify constellation example has already been saved. This goal covers the selection and preferences feature.

## Intake Summary

- Input shape: `specific`
- Audience: Lineage Logo users editing layered, nested SVG marks
- Authority: `requested`
- Proof type: `demo`
- Completion proof: automated checks plus real-browser QA on the complex Seatify constellation at multiple zoom levels
- Goal oracle: the user can complete the full selection workflow on the live complex example, reload preferences, and continue editing without an incorrect selection, lost pan gesture, document mutation, or console error
- Likely misfire: the marquee looks correct at 100% zoom but selects the wrong nested SVG nodes, selects both parents and children, steals pan gestures, or creates dirty/history state
- Blind spots considered: SVG/viewBox geometry, zoom, nested transforms, selection normalization, platform modifiers, drag thresholds, pointer cancellation, locked/hidden layers, layer-tree parity, accessibility, reduced motion, malformed persisted settings, and no-op history
- Existing plan facts: Shift-click already toggles selection; Alt-click and double-click already drill into exact elements; Space-drag and middle-drag already pan; overlays are editor-only and must never serialize; preferences should be a compact dialog rather than a full page

## Goal Oracle

The oracle for this goal is:

`On the live complex Seatify constellation at 100% and a non-default zoom, hold the physical left Control key and drag from either artwork or empty canvas to select every intended visible object, Shift-Control-drag to add more, Control-click to precisely toggle one object, Escape to clear, pan with Space-drag and middle-drag, change each bounded selection preference, reload, and confirm the canvas, selection-count badge, and Layers panel all show the same selection while the SVG, dirty state, history, and console remain clean.`

The PM must keep comparing task receipts to this oracle. Unit tests alone, a visually plausible rectangle, or a clean-looking board is not enough. The final Judge must record `full_outcome_complete: true` only after automated and real-browser evidence cover the complete workflow.

## Goal Kind

`specific`

## Current Tranche

This tranche delivers selection, not generalized group transformation:

1. Marquee selection on physical left Control + primary-button drag, using zoom- and transform-correct geometry. The gesture may begin over ordinary artwork or empty canvas, but never over transform handles. Ordinary unmodified press-and-drag must not activate the region selector.
2. Additive marquee selection with Shift.
3. Precise object toggling with the platform accelerator (Cmd on macOS, Ctrl elsewhere) plus a bounded preference for the modifier.
4. Clear visual feedback for every selected object, with the primary selection visually stronger and solely responsible for handles.
5. A compact, accessible “Preferences & shortcuts” dialog with versioned global persistence.
6. Automated verification and hands-on browser QA using the saved complex Seatify example.

The revised gesture contract is:

- Physical left Control + primary drag: after a 4 CSS-pixel threshold, marquee-select every deepest eligible visible object in the region. The gesture may begin on artwork or empty canvas.
- Shift + physical left Control + primary drag: add every matching object to the current selection.
- Physical left Control + exact object click below the movement threshold: toggle that exact object without moving it.
- Right Control does not arm the region selector. Key release, blur, visibility loss, Escape, pointer cancellation, and lost capture disarm or cancel cleanly.
- Ordinary object drag: keep the existing object-move behavior.
- Space + drag or middle-button drag: pan.
- Escape: clear selection or cancel an in-progress marquee.
- Alt-click and double-click: retain compatible exact-selection drill-in behavior.

The default marquee rule is fully enclosed objects. A preference may switch to touching/intersecting objects. The bounded activation preference is Left Control (default) or M (legacy alternative); this is not an arbitrary keybinding editor. Selection normalization must prevent simultaneous ancestor-and-descendant results. A region spanning nested artwork selects every deepest eligible visible object that matches the region rather than collapsing the result to a single wrapper group. Cross-parent multi-selection is allowed for inspection and individual feedback; generalized cross-parent transformation remains out of scope.

The feedback contract is:

- Salmon remains hover-only and disappears once a region gesture begins.
- Every selected object receives a crisp violet outline/halo that remains legible at non-default zoom and on objects that already carry SVG filters.
- The primary object additionally retains the blue selection box and transform handles; secondary objects never receive handles.
- A persistent, accessible `N objects selected` badge is visible whenever more than one object is selected, including while both sidebars are collapsed.
- The Layers panel expands the ancestor paths for every selected object and visibly marks every selected row, with the primary row stronger than secondary rows.
- Do not add a union bounding box, numbering, or collective transform affordance in this tranche.

## Preferences Surface

Use a small modal or popover titled “Preferences & shortcuts,” reachable from the existing shortcuts/help surface and a discoverable settings control. It should include only:

- Precise-selection modifier: Cmd/Ctrl (default) or Alt/Option.
- Region-selection activation: Left Control (default) or M.
- Marquee match: fully enclosed (default) or touching.
- Default click depth: logical group (default) or exact object.
- Show individual selection outlines: on by default.
- Restore defaults.

Persist this as a bounded, versioned global preference record separate from workspace SVG/session data. Invalid or future-version data must fail safely to defaults. Do not build an arbitrary keybinding editor.

## Non-Negotiable Constraints

- Preserve existing user work and unrelated dirty files.
- Do not persist selection rectangles, highlights, handles, or settings into exported SVG.
- Selection-only gestures must not mark the document dirty or create undo entries.
- Preserve Space-drag and middle-button pan, wheel zoom, ordinary object drag, Shift layer-tree selection, and existing exact-selection access. Ordinary unmodified empty-canvas drag must not start a marquee.
- Resolve Control gesture precedence before object movement: below threshold is a precise toggle; at or above threshold is a marquee. Suppress the macOS Control-click context menu only for this canvas interaction.
- Coordinate math must work through zoom, viewBox changes, nested SVG transforms, and collapsed sidebars.
- Use pointer capture/cancellation defensively; a cancelled gesture must not leave a stuck marquee.
- Hidden objects must not be selected through invisible bounds. Locked objects may be selected for inspection but must remain non-mutating.
- Canvas and layer-tree selection state must stay synchronized.
- Every selected object receives visible feedback; only the primary object receives transform handles.
- Respect keyboard focus, accessible naming, focus return, Escape behavior, and reduced-motion preferences.
- Keep persistent preferences versioned and independent of the workspace/session restoration schema.
- Use a descriptive localhost subdomain for manual QA.
- `npm run check` must pass before completion.

## Explicit Non-Goals

- A full settings page or general-purpose keybinding editor.
- Snapping, grids, nudge-distance configuration, alignment tools, or auto-layout.
- Lasso/freeform selection.
- Canvas auto-scroll while marquee-dragging.
- Agent-driven SVG insertion or generation changes.
- A unified multi-object transform box, cross-parent group movement, or arbitrary multi-object resize/rotate. These require a separate coordinate-space design and should follow once selection itself is proven.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete.

Do not stop after planning, discovery, the first passing Worker package, or automated tests if real-browser proof remains. If browser QA finds a defect, create the smallest coherent remediation task and continue through re-verification.

Do not create one Worker/Judge pair per control or test. Each Worker owns a complete vertical slice.

If exact owner input becomes the only remaining blocker and no safe local work remains, record the required reply in the board and stop once. Otherwise continue safe local work.

## Slice Sizing

Safe means bounded, explicit, verified, and reversible. It does not mean tiny.

The intended execution sequence is:

1. Scout the current gesture/selection/geometry/persistence seams.
2. Judge and lock the interaction contract and largest safe file-bounded slice.
3. Implement the complete marquee and multi-selection engine with tests.
4. Review and manually QA that interaction on the complex example.
5. Implement the preferences surface and persistence as a complete slice.
6. Perform integrated review, full browser QA, remediation if needed, and final audit.

## Browser QA Matrix

The PM’s browser QA must cover at minimum:

- Left-Control drag below and above the movement threshold, beginning over both artwork and empty canvas; verify ordinary unmodified drag never starts a marquee and right Control does not arm it.
- Fully enclosed and touching rules.
- Replace selection and Shift-add selection, proving every expected deepest object is selected rather than only one wrapper or leaf.
- Precise modifier toggle on and off, including changing the configured modifier.
- Ordinary click, Alt-click, double-click, layer-tree click, and layer-tree Shift-click parity.
- Parent/child nesting without duplicate ancestor-descendant selection, with every deepest matching visible object selected across nested groups.
- Locked and hidden layers.
- Dragging an already selected object without accidentally starting a marquee.
- Escape during and after a marquee; pointer leaving the canvas; pointer cancellation.
- Space-drag and middle-button pan; wheel zoom.
- 100% and at least one non-default zoom; resized viewport and collapsed sidebars.
- Salmon hover versus violet selected state, primary-selection emphasis, all selected Layers rows, persistent selection-count badge with collapsed sidebars, handles, and reduced-motion behavior.
- Dialog keyboard navigation, labels, focus return, restore defaults, reload persistence, and corrupted-storage fallback.
- Dirty indicator, undo/redo history, exported SVG, and browser console after selection-only actions.

## Board Health

The PM owns board health. If the board looks stale, misleading, offline, or inconsistent, run:

```bash
node /Users/neonwatty/.codex/plugins/cache/goalbuddy/goalbuddy/0.4.3/skills/goal-prep/scripts/check-goal-state.mjs docs/goals/marquee-selection-preferences
```

Canonical task truth lives at `docs/goals/marquee-selection-preferences/state.yaml`.

## Run Command

```text
Codex: /goal Follow docs/goals/marquee-selection-preferences/goal.md.
Claude Code: /goalbuddy Follow docs/goals/marquee-selection-preferences/goal.md.
```

## PM Loop

On every continuation:

1. Read this charter, `state.yaml`, and the GoalBuddy execution contract.
2. Run the GoalBuddy update check when available.
3. Work only on the active task and preserve one active task.
4. Record a compact evidence receipt and update the board.
5. Advance immediately to the next largest safe task unless a phase/risk/final review is due.
6. Use real browser QA as the product oracle, not as a cosmetic afterthought.
7. Before stopping, run the GoalBuddy stop checker; finish only when it validates a receipt-backed final audit with `full_outcome_complete: true`.
