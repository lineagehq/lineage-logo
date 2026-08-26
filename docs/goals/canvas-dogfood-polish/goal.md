# Canvas Dogfood Polish

## Objective

Turn the BleepThat dogfood findings into a reliable, calm manual-editing experience: resilient agent review, faithful grouped transforms, responsive collapsible sidebars, an accessible unsaved-changes flow, practical text editing, and useful icon-scale previews.

## Original Request

Implement the agreed manual-QA improvements, including independently collapsible left and right sidebars with smooth animations.

## Intake Summary

- Input shape: `existing_plan`
- Audience: logo designers using the Lineage canvas directly or through the logo-designer skill
- Authority: `approved`
- Proof type: `demo`
- Completion proof: automated checks plus a real BleepThat skill-to-canvas walkthrough covering reconnect, review, manual edit, undo/redo, save, reopen, and continuation from the exact accepted/saved SVG
- Goal oracle: a pending BleepThat proposal survives a canvas reconnect and completes the full skill/canvas loop; the responsive and accessibility walkthrough passes at desktop and narrow widths with no console errors or SVG fidelity regressions
- Likely misfire: polishing the shell while leaving review reconnects, terminal-state convergence, or grouped SVG transforms unreliable
- Blind spots considered: stale or duplicate proposal delivery, review-only affordance clarity, persistence of layout preferences, reduced motion, keyboard access, narrow-window overflow, clean SVG serialization, undo checkpoint granularity, text safety, and usefulness at favicon sizes
- Existing plan facts: correctness precedes visual polish; both sidebars collapse independently; the canvas recenters smoothly; preferences persist; pending review reveals the right panel; native unsaved confirmation is replaced; group operations preserve hierarchy; text editing and icon-targeted previews are in scope

## Goal Oracle

The oracle for this goal is:

`Using the BleepThat iteration as the representative artifact, submit a real skill proposal, disconnect and reopen the canvas while review is pending, recover the same transaction, accept it, make grouped and text edits, exercise undo/redo, collapse and expand both sidebars at 1440/1024/980/760 widths, save, reopen, and continue the skill from the exact accepted/saved clean SVG. The workflow must terminate predictably, keep selection/history/document state coherent, render useful icon previews, and produce no console errors.`

The PM must keep comparing task receipts to this oracle. Planning, discovery, a passing tiny slice, or a clean-looking board is not enough. The goal finishes only when a final Judge/PM audit maps receipts and verification back to this oracle and records `full_outcome_complete: true`.

## Goal Kind

`existing_plan`

## Current Tranche

Complete the whole agreed post-dogfood tranche through successive bounded slices. Start by establishing exact baselines and contracts, then fix agent-review continuity and review-lock communication, implement the responsive collapsible shell and accessible unsaved-changes dialog, repair grouped-transform fidelity, add focused text editing and icon preview targeting, and finish with integrated automated and real-browser/real-skill proof. Do not stop after the first polished surface if correctness or oracle work remains.

## Non-Negotiable Constraints

- Keep SVG clean, self-contained, and round-trip safe; preserve unsupported attributes, hierarchy, IDs, and references unless the user explicitly changes them.
- A grouped drag or resize must apply a coherent transform at the selected root instead of distributing noisy coordinates or matrices through descendants.
- Undo/redo must use one checkpoint per user operation and restore the exact prior serialized state.
- A pending agent proposal must either reattach after reconnect or terminate with explicit recoverable guidance; it must never leave the producer waiting indefinitely.
- Review-only state must clearly explain why mutation controls are unavailable and how to resume editing.
- Left and right sidebars collapse independently into usable rails, animate around 200 ms, expose accessible toggles and keyboard shortcuts, persist preference, and respect `prefers-reduced-motion`.
- Narrow windows must remain operable without horizontal loss of the inspector or essential toolbar actions.
- A pending agent proposal auto-reveals the review panel; a collapsed right rail shows an unmistakable pending badge.
- Collapsing, expanding, or responsive auto-collapse must not mutate the SVG, dirty flag, selection, zoom, or history.
- Replace native `window.confirm` with an accessible in-app Save / Discard / Cancel decision that restores focus and is keyboard operable.
- Text editing is bounded to content, font size, weight, family, alignment, and letter spacing, with safe validation and normal history behavior.
- Small-size previews must support the `#icon` mark (or another explicit selectable preview target) rather than forcing the full combination mark at 16 px.
- Preserve the already-verified core editing behaviors and the agent/skill security boundary.
- Avoid unrelated redesign, broad SVG-engine rewrites, or external dependencies unless a Judge records why they are required.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete.

Do not stop after planning, discovery, or Judge selection if the user asked for working software and a safe Worker task can be activated.

Do not stop after a single verified Worker package when the broader owner outcome still has safe local follow-up work. Advance the board to the next highest-leverage safe Worker package and continue unless a phase, risk, rejected-verification, ambiguity, or final-completion review is due.

Do not create one Worker/Judge pair per repeated file, control, breakpoint, or SVG primitive. Put repeated same-shape work into one coherent Worker package and review the package as a whole.

If an exact human approval phrase is the only remaining blocker and no safe local work remains, ask once and stop. Preserve the exact phrase in the blocked receipt as `required_reply`, set `waiting_for_user_approval: true`, set `goal.status: blocked`, and set `active_task: null`.

## Slice Sizing

Safe means bounded, explicit, verified, and reversible. It does not mean tiny. Each Worker owns the largest coherent vertical slice that can be implemented and verified without crossing an unresolved risk boundary.

## Board Health

The PM owns board health. If the board looks stale, misleading, offline, or inconsistent, run:

```bash
node /Users/neonwatty/.codex/plugins/cache/goalbuddy/goalbuddy/0.4.3/skills/goal-prep/scripts/check-goal-state.mjs docs/goals/canvas-dogfood-polish
```

If the local board is running, compare `state.yaml` to the live board API. Repair only GoalBuddy control files unless an active Worker or PM task explicitly allows product-file edits.

## Canonical Board

Machine truth lives at:

`docs/goals/canvas-dogfood-polish/state.yaml`

If this charter and `state.yaml` disagree, `state.yaml` wins for task status, active task, receipts, verification freshness, and completion truth.

## Run Command

```text
Codex: /goal Follow docs/goals/canvas-dogfood-polish/goal.md.
Claude Code: /goalbuddy Follow docs/goals/canvas-dogfood-polish/goal.md.
```

## PM Loop

On every `/goal` continuation:

1. Read this charter, `state.yaml`, and the GoalBuddy execution contract.
2. Run the bundled update checker and mention a newer version without blocking.
3. Re-check the original request, existing plan facts, likely misfire, and oracle.
4. Work only on the active board task with the assigned Scout, Judge, Worker, or PM role.
5. Write a compact receipt, update the board, and advance to the next largest safe package while work remains.
6. Review at phase, risk, rejected-verification, ambiguity, and final-completion boundaries—not after every minor edit.
7. Before ending, run `check-can-stop.mjs`; finish only when it passes and a final audit records `full_outcome_complete: true`, or the exact terminal approval-wait shape is valid.
