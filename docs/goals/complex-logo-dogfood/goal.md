# Complex Logo Dogfood and Session Restoration

## Objective

Prove the Lineage Logo canvas against a deliberately complex, structurally meaningful Seatify SVG; fix the concrete defects revealed by adversarial manual-and-agent editing; and make the active workspace restore reliably across reloads and local server restarts.

## Original Request

Plan a more complex logo with more layers and objects, battle-test the canvas with it, fix what the stress test reveals, and then add session restoration.

## Intake Summary

- Input shape: `existing_plan`
- Audience: Lineage Logo users and logo-designer agents
- Authority: `approved`
- Proof type: `demo`
- Completion proof: A complex Seatify artifact, passing repository gate suite, and a recorded browser walkthrough that completes representative manual and agent edits, undo/redo, save/reload, and restart restoration without unresolved goal-owned defects.
- Goal oracle: The complex Seatify SVG completes the versioned adversarial walkthrough and returns to the expected document, selection, zoom, background, and sidebar state after both reload and server restart.
- Likely misfire: Produce an attractive complicated SVG and declare victory without exercising difficult hierarchy, transform, serialization, agent-handoff, and restoration behavior.
- Blind spots considered: complexity that is decorative rather than structurally useful; unsupported SVG resources; performance under large layer trees; selection causing dirty state; restoration of stale or missing elements; cross-tab agent ownership; corrupt or incompatible persisted state; production-logo aesthetics being confused with stress-fixture requirements.
- Existing plan facts: Create the stress logo first; run an adversarial editing session; fix revealed defects; add session restoration; defer agent-driven insertion of entirely new SVG layers until the editor is proven against complex documents.

## Goal Oracle

The oracle for this goal is:

`A 30–50-layer Seatify venue/event mark with meaningful nested groups completes the documented manual-and-agent editing walkthrough, passes npm run check, preserves clean SVG fidelity, and restores the expected active document plus safe UI state after reload and a clean local-server restart.`

The oracle walkthrough must include:

1. Load the complex asset and inspect at least 30 editable, meaningfully named layers across at least four hierarchy depths.
2. Exercise layer search, disclosure, visibility, exact nested selection, multi-selection, and ancestry navigation.
3. Move, rotate, resize, duplicate, reorder, group or ungroup where supported, and align representative nested elements.
4. Complete a mixed sequence of at least ten edits, then undo and redo across different operation types without hierarchy or paint corruption.
5. Exercise gradients or other bounded `defs` resources, paths, text, opacity, strokes, transforms, and a clipped or masked region if current capability evidence permits it.
6. Stage and review at least one agent-proposed change, then manually correct or reject it without losing selection or document fidelity.
7. Save an iteration, reload it, and compare structure and rendered output against the expected result.
8. Set a non-default active document, nested selection, zoom, preview background, and both sidebar states; verify safe restoration after page reload and local server restart.
9. Verify missing, renamed, or structurally changed persisted targets fall back safely rather than blocking the canvas.
10. Finish with no console errors, no unexpected dirty state, no unresolved high-confidence goal-owned defect, and a clean `npm run check`.

The PM must keep comparing task receipts to this oracle. Planning, asset generation, isolated unit tests, or a single successful edit are not enough. Completion requires a final Judge or PM audit that records `full_outcome_complete: true`.

## Goal Kind

`existing_plan`

## Current Tranche

Execute continuously through four phases:

1. Map current complex-SVG and restoration behavior, validate the stress-asset specification, and identify exact verification seams.
2. Add a deterministic complex Seatify stress asset plus structural assertions and a repeatable walkthrough contract.
3. Run adversarial browser QA, convert confirmed findings into the largest safe coherent fix package or packages, and re-run the oracle after each package.
4. Implement versioned session restoration for the active document and safe UI state, then complete the full reload-and-restart oracle walkthrough.

This tranche is complete only when the whole owner outcome is proven. If the stress test exposes additional safe local fixes, the PM adds bounded Worker tasks and continues rather than stopping after the first package.

## Non-Negotiable Constraints

- Preserve user-authored workspace files and unrelated worktree changes.
- Use a copied or repository-owned stress fixture for destructive QA; do not mutate the canonical Seatify source without an explicit save step in the walkthrough.
- Keep SVG serialization deterministic and exclude editor-only overlays from saved output.
- Selection, navigation, zooming, and sidebar changes must not mark the document dirty.
- Persist only bounded, versioned, non-sensitive workspace state. Do not persist unsaved SVG contents as part of this goal unless evidence proves it is necessary and Judge approves the scope change.
- Restoration must tolerate stale documents, renamed or deleted element identifiers, invalid values, and schema-version changes with safe fallbacks.
- Keep reduced-motion support intact and retain keyboard and pointer accessibility.
- Present local QA on descriptive `.localhost` subdomains, never raw localhost or `127.0.0.1`.
- `npm run check` is the repository gate suite. Targeted tests may accelerate iteration but do not replace the final gate.
- Only one write Worker may be active. Scout and Judge tasks are read-only.
- Agent-driven creation or insertion of entirely new SVG layers is a later goal and must not silently enter this tranche.
- Publishing, PR creation, or merge is not implied by goal completion; ask the operator when a verified implementation is ready for external handoff.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete.

Do not stop after asset creation, discovery, the first QA pass, or one verified fix package while safe work remains. If a finding requires a meaningful product decision, record the exact decision and continue all other safe work.

If an exact human approval phrase is the only remaining blocker and no safe local work remains, preserve it in a blocked receipt, set `waiting_for_user_approval: true`, set the goal blocked, and ask once.

## Slice Sizing

The preferred Worker slices are vertical outcomes: a complete stress asset and verification contract; a coherent confirmed-defect package; and a complete versioned restoration path with tests. Avoid one task per layer, control, persistence field, or defect unless isolation or risk makes a smaller slice necessary.

## Board Health

Machine truth lives at `docs/goals/complex-logo-dogfood/state.yaml`.

When board health is uncertain, run:

```bash
node /Users/neonwatty/.codex/plugins/cache/goalbuddy/goalbuddy/0.4.3/skills/goal-prep/scripts/check-goal-state.mjs docs/goals/complex-logo-dogfood
```

## Canonical Board

`docs/goals/complex-logo-dogfood/state.yaml`

## Run Command

```text
Codex: /goal Follow docs/goals/complex-logo-dogfood/goal.md.
Claude Code: /goalbuddy Follow docs/goals/complex-logo-dogfood/goal.md.
```

## PM Loop

On every execution continuation:

1. Read this charter and the GoalBuddy execution contract.
2. Read `state.yaml`; it is task-status and receipt truth.
3. Work only on the active task and use its assigned role.
4. Preserve the existing plan, but validate evidence and risks before writes.
5. Prefer the largest safe useful Worker package and verify it with the task commands.
6. Write a compact receipt and update the board after every completed, blocked, or escalated task.
7. Re-run the relevant oracle slice after each Worker package.
8. Continue to the next safe task until final audit proves the full outcome.
9. Before ending, run the GoalBuddy stop checker; a nonzero result means safe work remains.
