# Multi-Selection Editing Browser QA

## Objective

Extend the repository-owned Chromium QA from marquee selection into the complete multi-selection correction loop: collective drag and keyboard nudge, undo/redo, alignment, distribution, equal spacing, cancellation and rejection boundaries, selection fidelity, and clean SVG serialization on the complex Seatify fixture.

## Original Request

Plan automated browser QA for multi-selection editing after completing marquee-preview QA.

## Intake Summary

- Input shape: `existing_plan`
- Audience: Lineage Logo maintainers and users manually correcting layered SVG logos
- Authority: `approved`
- Proof type: `test`
- Completion proof: A clean-checkout Chromium run exercises real UI input on the complex Seatify fixture, proves exact geometry/history/selection/serialization outcomes across the full scenario matrix, passes ten consecutive repetitions, and passes the protected `browser-qa` CI job without weakening existing gates.
- Goal oracle: A real browser selects nested and cross-parent objects, moves and arranges them through the public UI, and demonstrates exact root-space geometry, one reversible history checkpoint per action, all-or-nothing rejection, stable Layers/primary identity, and editor-metadata-free SVG output at default and non-default layout states.
- Likely misfire: Add method-level geometry assertions or happy-path screenshots that never manipulate a real multi-selection, cannot distinguish partial movement, or miss extra history checkpoints and serialized runtime metadata.
- Blind spots considered: cross-parent transforms; drag from non-primary objects; pointer thresholds and cancellation; keyboard focus; root-space versus parent-space deltas; deterministic anchors/order; lock, hidden, disconnected, and agent-review gates; no-op actions; primary identity; sidebars and zoom; clean temporary-workspace lifecycle; CI duration and repeat stability.
- Existing plan facts: Reuse the complex Seatify fixture and deterministic Playwright server; use real keyboard and pointer input; derive coordinates from live geometry; cover collective drag, Arrow/Shift+Arrow, undo/redo, alignment, distribution, equal spacing, locked/invalid all-or-nothing behavior, 125% zoom, collapsed sidebars, Layers parity, clean serialization, and protected CI.

## Goal Oracle

The oracle for this goal is:

`On a byte-exact temporary copy of the complex Seatify fixture, Chromium uses the public canvas, Layers, toolbar, inspector, lock, and history controls to select three or more labeled objects—including nested and cross-parent cases—then proves collective drag from a non-primary object and Arrow/Shift+Arrow nudge apply one identical root-space delta to every selected object; Undo/Redo restore exact before/after geometry and selection in one checkpoint; align/distribute/space operations produce deterministic exact geometry; cancel, below-threshold, locked, hidden, disconnected, ineligible, and agent-blocked cases produce no partial mutation or history; 100%/125% zoom and collapsed sidebars preserve behavior; and the authored SVG contains only intended transforms with no selection, halo, handle, preference, or test metadata.`

The PM must keep comparing task receipts to this oracle. Planning, helper coverage, unit-only geometry, a same-parent demo, or count-only selection assertions are not enough. Completion requires a final Judge receipt with `full_outcome_complete: true` backed by repeatable local and protected-CI evidence.

## Goal Kind

`existing_plan`

## Current Tranche

This tranche delivers two coherent browser-automation milestones:

1. Collective translation and history: real marquee/layer selection, drag from a selected non-primary object, Arrow/Shift+Arrow, exact shared root-space deltas, one-step Undo/Redo, cancellation/no-op, and all-or-nothing eligibility gates.
2. Arrangement and fidelity: alignment, center distribution, equal edge spacing, deterministic anchors/order, selection and inspector continuity, zoom/sidebar variants, and editor-metadata-free serialization.

The first Judge validates the existing harness and interaction contracts before any test Worker writes. Workers extend the existing suite rather than adding product behavior unless a narrowly justified testability seam is separately approved. The PM finishes with ten-repeat, clean-checkout, diagnostics, runtime, and protected-CI proof before a final Judge audit.

## Scenario Contract

- Build the selection through real UI interactions; do not call editor methods.
- Select at least three uniquely labeled visible objects, including transformed nested and cross-parent objects where the operation contract allows it.
- Start collective drag from a selected object that is not primary and prove every selected object moves by the same root-space visual delta while unselected anchors remain fixed.
- Prove Arrow and Shift+Arrow apply the documented one-unit and ten-unit visual steps without losing selection or primary identity.
- Prove one completed drag or nudge creates one Undo checkpoint; Undo and Redo restore exact geometry, Layers selection, primary identity, inspector context, and dirty controls.
- Prove canceled, below-threshold, zero-delta, rejected, and no-op work creates no mutation and no history checkpoint.
- Prove an ineligible member blocks the entire collective operation; never accept a test that only observes the primary object or silently skips a member.
- Exercise alignment on eligible sibling selections and center distribution/equal spacing on eligible three-plus selections, using exact geometry with deterministic outer anchors and ordering.
- Cover 100% and 125% zoom plus both collapsed sidebars using live geometry-derived input.
- Verify authored SVG and any save/export boundary exclude halos, transform handles, selection markers, preferences, test hooks, and other `data-lineage-*` runtime state.
- Preserve the existing marquee-preview suite as a required regression gate.

## Non-Negotiable Constraints

- Use Chromium only for this tranche and keep the existing descriptive `.localhost` origin.
- Reuse the deterministic strict-port server and byte-exact temporary fixture workspace; never write to checked-in fixtures.
- Use real Playwright keyboard, pointer, and named-control interactions, not direct editor or geometry mutation calls.
- Derive pointer coordinates and expected positions from live labeled geometry; no hard-coded viewport pixels or fixed sleeps.
- Assert exact selected identities, geometry, primary identity, history, controls, inspector, and serialized SVG—not counts or screenshots alone.
- Keep existing unit/build/audit gates and the protected `verify` and `browser-qa` checks intact.
- Do not introduce collective resize/rotation, snapping, guides, auto-layout, agent-driven layer insertion, new settings, or unrelated canvas workflows.
- Product behavior changes require a Judge-approved, minimal testability or correctness seam; default ownership is tests, harness, CI, and documentation.
- Preserve user work and keep at most one write Worker active.

## Explicit Non-Goals

- Collective resize or rotation and a shared union handle box.
- Firefox, WebKit, mobile, or touch-device browser matrices.
- New selection gestures, snapping, alignment guides, constraints, or auto-layout.
- Agent-driven creation or insertion of SVG layers.
- Save-flow redesign or unrelated manual-editor polish.
- Replacing focused deterministic assertions with broad screenshot testing.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete.

Do not stop after harness discovery, translation-only coverage, a single green run, or local-only proof while arrangement, rejection, repeatability, cleanup, or protected-CI evidence remains.

If actual CI execution requires a review branch and pull request, treat branch/commit/push/PR creation as a separate authority boundary unless the user explicitly approves it during the `/goal` run. Complete all safe local proof first.

## Slice Sizing

Safe means bounded, explicit, verified, and reversible. It does not mean tiny.

The translation Worker should complete the whole collective movement/history workflow. The arrangement Worker should complete the whole alignment/distribution/spacing/fidelity workflow. Do not create one task per shortcut, button, or fixture object.

## Board Health

```bash
node /Users/neonwatty/.codex/plugins/cache/goalbuddy/goalbuddy/0.4.3/skills/goal-prep/scripts/check-goal-state.mjs docs/goals/multi-selection-editing-e2e-qa
```

## Canonical Board

Machine truth lives at `docs/goals/multi-selection-editing-e2e-qa/state.yaml`.

## Run Command

```text
Codex: /goal Follow docs/goals/multi-selection-editing-e2e-qa/goal.md.
Claude Code: /goalbuddy Follow docs/goals/multi-selection-editing-e2e-qa/goal.md.
```

## PM Loop

1. Read this charter, the GoalBuddy execution contract, and `state.yaml`.
2. Validate existing harness and product contracts before authorizing writes.
3. Work only on the active role-tagged task and record its receipt.
4. Keep one write Worker active and enforce `allowed_files`, `verify`, and `stop_if`.
5. Compare every Worker receipt with the goal oracle.
6. Review only at the initial contract, milestone boundary, rejected verification, CI remediation, and final audit.
7. Continue through both milestones, repeatability, cleanup, and CI evidence while safe work remains.
8. Finish only when `check-can-stop.mjs` passes with a final receipt containing `full_outcome_complete: true`.
