# Make Manual Logo Corrections Clear and Complete

## Objective

Deliver a correction-first Lineage Logo canvas in which a person can understand
selection scope, edit nested SVG objects, organize existing layers, align and
style selections, and safely save ordinary SVG iterations without needing SVG
markup knowledge.

## Original Request

Plan and implement the correction UX first, including clear selection,
layer organization, alignment, color controls, and grouping, while leaving new
layer creation and drawing to the later agentic connection.

## Intake Summary

- Input shape: `existing_plan`
- Audience: people manually correcting AI-generated SVG logos
- Authority: `approved`
- Proof type: `demo`
- Completion proof: the automated gate passes and a recorded browser walkthrough demonstrates the complete correction workflow on representative nested SVGs.
- Goal oracle: an end-to-end browser walkthrough covering nested selection, hierarchy editing, multi-selection, alignment, appearance editing, history, safe saving, and SVG fidelity.
- Likely misfire: shipping controls that technically mutate SVGs but leave selection confusing, corrupt hierarchy references, or pass tests without being usable in the real canvas.
- Blind spots considered: transforms and referenced IDs during grouping, gradients/masks/clip paths, multi-select history semantics, responsive toolbar layout, invalid colors, no-op history entries, and development port handling.
- Existing plan facts: correction UX precedes the agent bridge; include breadcrumbs, drill-in/out, hover targeting, rename, lock, reorder, group/ungroup, multi-select, alignment, and validated color controls; do not add manual drawing tools.

## Goal Oracle

The oracle for this goal is:

`A recorded browser walkthrough on representative SVG fixtures proves that a user can confidently select nested objects, organize and group existing layers, multi-select and align them, edit validated appearance values, undo/reset, and save/reopen a structurally valid iteration; npm run check also passes.`

The PM must keep comparing task receipts to this oracle. Planning, discovery, a
passing tiny slice, or a clean-looking board is not enough. The goal finishes
only when a final Judge or PM audit maps receipts and verification back to this
oracle and records `full_outcome_complete: true`.

## Goal Kind

`existing_plan`

## Current Tranche

Complete the manual correction and organization experience. Start by validating
the selection/context contract, then deliver the largest safe vertical slices
for selection clarity, layer organization and grouping, multi-select alignment,
appearance controls, remaining QA polish, and the final browser proof. Continue
through the tranche rather than stopping after the first feature slice.

## Non-Negotiable Constraints

- Keep inline standards-compliant SVG as the document source of truth.
- Never overwrite the source SVG; saves create immutable numbered iterations.
- Preserve viewBox, IDs, gradients, masks, clip paths, filters, transforms, and references through supported edits.
- Keep the server local-only with existing containment and SVG safety checks.
- Include manual group and ungroup support, with fidelity tests for hierarchy-sensitive SVG features.
- Do not add shape drawing, pen tools, text creation, node editing, boolean operations, or agent integration in this tranche.
- Do not introduce a proprietary project or canvas format.
- Preserve existing working behavior for drag, resize, rotate, keyboard nudging, duplicate, visibility, delete, undo/redo, reset, panning, previews, and saving.
- Treat `npm run check` as the automated gate and the browser walkthrough as the decisive interaction oracle.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete.

Do not stop after planning, discovery, or Judge selection while a safe Worker
task can advance the correction UX. Do not stop after one verified feature slice
while another required slice remains queued.

If an exact human approval phrase is the only remaining blocker and no safe
local work remains, preserve that phrase in the blocked receipt and stop in the
GoalBuddy terminal approval-wait shape.

## Slice Sizing

Use the largest bounded vertical slice that produces a coherent user-visible
improvement and can be verified with focused tests plus the running canvas.
Avoid isolated helpers unless they unlock a larger slice or contain meaningful
SVG fidelity risk.

## Board Health

Machine truth lives in `docs/goals/manual-correction-ux/state.yaml`. If the
board looks stale or inconsistent, run:

```bash
node /Users/neonwatty/.codex/plugins/cache/goalbuddy/goalbuddy/0.4.3/skills/goal-prep/scripts/check-goal-state.mjs docs/goals/manual-correction-ux
```

## Canonical Board

`docs/goals/manual-correction-ux/state.yaml`

## Run Command

```text
Codex: /goal Follow docs/goals/manual-correction-ux/goal.md.
Claude Code: /goalbuddy Follow docs/goals/manual-correction-ux/goal.md.
```

## PM Loop

On every execution continuation, read this charter and `state.yaml`, follow the
GoalBuddy execution contract, work only on the active task, record a receipt,
advance to the next largest safe slice, and run the GoalBuddy stop checker before
ending. Completion requires the final audit and `full_outcome_complete: true`.
