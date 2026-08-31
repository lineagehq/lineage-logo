# Precision Transforms And Snapping

## Objective

Make single- and multi-object transforms feel precise and predictable by adding modifier-based rotation snapping, smart alignment guides and snapping during direct manipulation, and numeric transform controls, with rigorous automated QA against the complex Seatify constellation.

## Original Request

"Excellent - plan this out thoroughly" following agreement to implement precision transforms and snapping: Shift-based 15-degree rotation snapping, smart guides, snapping to the canvas and nearby objects, numeric X/Y/width/height/rotation controls, explicit mixed-value behavior, and automated Seatify constellation QA.

## Intake Summary

- Input shape: `existing_plan`
- Audience: Logo-canvas users making manual corrections to generated SVG artwork.
- Authority: `requested`
- Proof type: `test`
- Completion proof: Automated unit, interaction, serialization, and browser tests plus a successful manual walkthrough demonstrate precise snapping and numeric edits on the Seatify constellation without transform, history, selection, serialization, or agent-review regressions.
- Goal oracle: A repeatable Chromium walkthrough on the real Seatify constellation proves snapped and unsnapped transforms, live guides, numeric edits, Undo/Redo, zoom independence, sidebar independence, and clean saved SVG.
- Likely misfire: Shipping attractive guide lines or inspector fields that do not use exact document-space geometry, behave differently at non-100% zoom, corrupt authored transform structure, or create multiple history checkpoints for one gesture.
- Blind spots considered: screen-space tolerance across zoom, resize-handle semantics, modifier conflicts, mixed-value editing, negative or zero sizes, locked/hidden selections, nested transforms and mixed parents, rotated selections, agent-pending state, keyboard accessibility, history atomicity, guide occlusion, serialization cleanliness, and browser/platform modifier differences.
- Existing plan facts: Shift snaps rotation to 15-degree increments; direct manipulation can snap to canvas center/edges and nearby objects; live alignment guides explain the snap target; numeric X, Y, width, height, and rotation controls support multi-selection and mixed values; complex Seatify constellation QA is required; persistent Group/Ungroup follows later and is not part of this goal.

## Goal Oracle

The oracle for this goal is:

`A deterministic Chromium test and matching manual walkthrough load the real complex Seatify constellation, select one or several objects, exercise free and snapped move/resize/rotation plus numeric X/Y/width/height/rotation edits, observe correct live guides and mixed-value feedback, verify one-step Undo/Redo and cancellation, repeat at 125% zoom with both sidebars collapsed, save/reload clean SVG, and show no regression in the complete repository check and browser suites.`

The PM must keep comparing task receipts to this oracle. Planning, discovery, a passing tiny slice, or a clean-looking board is not enough. The goal finishes only when a final Judge/PM audit maps receipts and verification back to this oracle and records `full_outcome_complete: true`.

## Goal Kind

`existing_plan`

## Current Tranche

Validate the existing product plan against the current editor architecture, define exact interaction and geometry semantics, implement snapping/guides as one coherent vertical slice, implement numeric precision controls as a second coherent vertical slice, harden both with the real Seatify fixture and adversarial browser QA, then perform a final completion audit. The goal is locally complete and PR-ready when the oracle passes; creating or merging a pull request requires separate owner authorization.

## Non-Negotiable Constraints

- Preserve freeform transforms; snapping is assistance, not a permanent constraint.
- During rotation, Shift snaps to 15-degree increments and releasing Shift returns to free rotation without starting a new gesture.
- Snap tolerance must be defined in screen pixels and converted consistently so behavior remains perceptually stable across canvas zoom.
- Live guides must correspond exactly to the target that the transform math actually uses; never show a guide for an unapplied snap.
- Snap candidates must include canvas horizontal/vertical center and edges, plus eligible nearby visible/unlocked objects; candidate priority and tie-breaking must be deterministic.
- Single- and multi-selection transformations must remain atomic: one completed gesture or committed numeric edit creates at most one history checkpoint; cancel and no-op create none.
- Existing selection, marquee, collective translation/resize/rotation, alignment/distribution, Undo/Redo, Reset, agent acceptance/rollback, sidebar collapse, and zoom behavior must not regress.
- Numeric fields must clearly represent exact values versus mixed values and must never silently collapse distinct multi-selection geometry.
- Numeric edits need explicit validation and safe handling for empty, invalid, negative, zero, and out-of-range input.
- Preserve authored SVG structure and clean serialization; editor-only guides, state, metadata, and controls must never leak into saved or agent-submitted SVG.
- Locked, hidden, incompatible-parent, or agent-pending selections must remain all-or-nothing and must not partially mutate.
- Use the checked-in complex Seatify constellation fixture for the principal E2E oracle, not a toy-only SVG.
- Persistent Group/Ungroup, arbitrary pivot editing, grid/ruler systems, and structural SVG normalization are out of scope.
- Do not create, merge, or publish a pull request without explicit owner authorization.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete.

Do not stop after planning, discovery, or Judge selection if the user asked for working software or automation and a safe Worker task can be activated.

Do not stop after a single verified Worker package when the broader owner outcome still has safe local follow-up work. Advance the board to the next highest-leverage safe Worker package and continue unless a phase, risk, rejected-verification, ambiguity, or final-completion review is due.

Do not create one Worker/Judge pair per helper or field. Implement and review coherent vertical slices.

## Slice Sizing

Safe means bounded, explicit, verified, and reversible. It does not mean tiny. The snapping engine, live guide rendering, preference behavior, and direct-manipulation integration form one vertical slice. Numeric inspector semantics, commit behavior, validation, and history form a second vertical slice. Test-only hardening may be a third package if it crosses many feature paths.

## Board Health

The PM owns board health. If the board looks stale or inconsistent, run:

```bash
node /Users/neonwatty/.codex/plugins/cache/goalbuddy/goalbuddy/0.4.3/skills/goal-prep/scripts/check-goal-state.mjs docs/goals/precision-transforms-snapping
```

## Canonical Board

Machine truth lives at:

`docs/goals/precision-transforms-snapping/state.yaml`

## Run Command

```text
Codex: /goal Follow docs/goals/precision-transforms-snapping/goal.md.
Claude Code: /goalbuddy Follow docs/goals/precision-transforms-snapping/goal.md.
```

## PM Loop

On every `/goal` continuation, read this charter and `state.yaml`, follow GoalBuddy's execution contract, work only on the active task, record a receipt, keep the oracle current, and continue through the next largest safe slice until the final audit proves the complete outcome.
