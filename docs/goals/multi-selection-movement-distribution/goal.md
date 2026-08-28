# Multi-Selection Movement and Distribution

## Objective

Give Lineage Logo a predictable next step after multi-selection: move all selected SVG objects together by drag or keyboard nudge, then distribute or equal-space three or more selected objects, without corrupting nested transforms, weakening selection feedback, or introducing collective resize and rotation prematurely.

## Original Request

After merging marquee selection, perform a post-merge smoke test and build multi-selection movement and distribution. Keep collective resize and rotation out of the first tranche.

## Intake Summary

- Input shape: `existing_plan`
- Audience: Lineage Logo users correcting layered and nested SVG marks
- Authority: `requested`
- Proof type: `demo`
- Completion proof: the full repository gate passes and a recorded browser walkthrough on the saved complex Seatify constellation proves collective drag, keyboard nudge, undo/redo, horizontal and vertical distribution/spacing, cancellation, and SVG fidelity at 100% and non-default zoom
- Goal oracle: selected objects spanning different SVG parents preserve their visual relationships while moving by the same root-space delta, distribution produces deterministic geometry, one user action creates one reversible checkpoint, and selection/Layers/dirty state/export remain correct
- Likely misfire: add a convincing-looking primary box or toolbar controls while only one object moves, nested objects drift by different visual deltas, locked objects partially mutate, or multiple history checkpoints appear
- Blind spots considered: cross-parent coordinate conversion; nested transforms; root/viewBox zoom; drag threshold and cancellation; primary-only handle semantics; locked, hidden, resource-backed, and agent-blocked layers; same-parent versus cross-parent behavior; selection normalization; deterministic distribution anchors; zero-size objects; no-op history; serialization cleanliness; responsive sidebars; platform keyboard behavior; reduced motion; performance on 40+ layers
- Existing plan facts: first run a post-merge smoke test; then deliver collective drag and arrow nudge; then add horizontal/vertical distribution and spacing tools; keep the existing compact preferences dialog; defer collective resize/rotation and agent-driven layer insertion

## Goal Oracle

The oracle for this goal is:

`On the live saved Seatify constellation at 100% and at least 125% zoom, select three or more visible objects across different nested parents; drag any selected object and verify every selected object moves by the same root-space visual delta with selection feedback and Layers parity intact; undo and redo the entire drag as one checkpoint; repeat with Arrow and Shift+Arrow nudge; distribute horizontally and vertically and apply equal spacing with deterministic outer anchors; undo/redo each action; cancel/no-op a drag; exercise locked and agent-blocked boundaries; then confirm clean console, correct dirty controls, and exported SVG free of editor overlays or transient selection state.`

The PM must keep comparing task receipts to this oracle. Planning, unit-only geometry work, a same-parent demo, or a visually plausible toolbar is not enough. Completion requires a final Judge or PM audit that maps automated and real-browser evidence back to this oracle and records `full_outcome_complete: true`.

## Goal Kind

`existing_plan`

## Current Tranche

This tranche continuously advances through two working milestones:

1. Collective translation: dragging any selected object or using Arrow/Shift+Arrow moves every selected object by one consistent visual root-space delta, including cross-parent and nested-transform selections.
2. Distribution and spacing: three or more selected objects can be distributed horizontally or vertically and equal-spaced using a deterministic, review-approved anchor and ordering contract.

The post-merge smoke precedes new writes. A read-only Scout maps the coordinate, gesture, selection, history, and operation-gating seams. A Judge then defines the largest safe translation slice. After translation is implemented and audited at the phase boundary, the Judge defines the distribution slice. The PM finishes with the full live complex-logo walkthrough and a final Judge audit.

## Interaction Contract To Validate

- Multi-selected drag can begin from any selected object's normal drag surface; existing marquee, precise toggle, primary-only resize and rotation, Space-pan, and middle-pan precedence must remain intact.
- Every selected object moves by the same visual delta in the SVG root coordinate system even when authored under different transformed parents.
- Arrow moves by the existing one-unit visual step and Shift+Arrow by the existing larger step, subject to Scout/Judge confirmation of current behavior.
- A collective action is all-or-nothing. If any selected object is not safely movable because it or an ancestor is locked, hidden, disconnected, agent-blocked, or otherwise ineligible, the action must not partially move the set and must explain why.
- One completed drag is one undo checkpoint; one keyboard nudge is one checkpoint. Cancelled, below-threshold, invalid, or zero-delta work creates none.
- Selection order, primary identity, scope, individual halos, Layers rows, and count badge survive movement and history restoration.
- Distribution requires at least three eligible selected objects. The Judge must settle whether center distribution, equal edge gaps, or both are the safest useful controls and must define deterministic ordering, outer anchors, overlap behavior, zero-size geometry, and no-op rules before Worker execution.
- The existing primary-only handle model remains. Do not add resize or rotation to the whole selection in this tranche.

## Non-Negotiable Constraints

- Preserve existing user work and keep product edits inside explicitly approved Worker files.
- Run the post-merge smoke against merged `main` before new feature implementation.
- Use the saved complex Seatify example as the primary live stress surface.
- Preserve Control-left marquee, exact modifier toggle, M activation, Space/middle pan, ordinary single-object drag, resize, rotation, and selection preferences.
- Preserve clean SVG bytes except for intended authored transforms from successful movement or distribution.
- Never serialize halos, handles, selection state, settings, or temporary collective-gesture metadata.
- Avoid rewriting descendants when a safe root transform composition is sufficient.
- Preserve local resource references, IDs, labels, filters, masks, clips, text, and authored group structure.
- Do not silently skip an ineligible selected object or move only the primary.
- Do not introduce a unified collective resize/rotation box, lasso, snapping, grids, auto-layout, arbitrary settings, or agent-driven insertion of new SVG layers.
- Use a descriptive `.localhost` subdomain for every manual QA server.
- `npm run check` must pass before final completion.

## Explicit Non-Goals

- Collective resize or rotation.
- A shared union bounding box with corner handles.
- Persistent groups created merely to move a temporary selection.
- Snapping, grids, alignment guides, auto-layout, collision avoidance, or constraint solving.
- Arbitrary nudge-distance or distribution preferences.
- Agent-driven creation/insertion of new SVG layers.
- A dedicated settings page.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete.

Do not stop after the smoke test, discovery, coordinate helpers, collective translation alone, or a same-parent distribution demo while safe goal-owned work remains. Continue through both milestones, live QA, and the final audit.

Do not stop because one optional edge requires owner input. Record the exact boundary, complete all safe local work, and request human confirmation only when it is the sole remaining oracle gap.

## Slice Sizing

Safe means bounded, explicit, verified, and reversible. It does not mean tiny.

The translation Worker should deliver the entire coherent movement workflow—drag, nudge, cross-parent coordinate correctness, history, cancellation, eligibility gates, selection preservation, tests, and user-facing guidance—rather than a chain of helper-only tasks.

The distribution Worker should deliver the complete Judge-approved distribution/spacing surface and its geometry, gating, history, tests, and guidance as one coherent slice.

## Board Health

The PM owns board health. If the board looks stale or inconsistent, run:

```bash
node /Users/neonwatty/.codex/plugins/cache/goalbuddy/goalbuddy/0.4.3/skills/goal-prep/scripts/check-goal-state.mjs docs/goals/multi-selection-movement-distribution
```

## Canonical Board

Machine truth lives at:

`docs/goals/multi-selection-movement-distribution/state.yaml`

If this charter and `state.yaml` disagree, `state.yaml` wins for task status, active task, receipts, verification freshness, and completion truth.

## Run Command

```text
Codex: /goal Follow docs/goals/multi-selection-movement-distribution/goal.md.
Claude Code: /goalbuddy Follow docs/goals/multi-selection-movement-distribution/goal.md.
```

## PM Loop

On every `/goal` continuation:

1. Read this charter, the GoalBuddy execution contract, and `state.yaml`.
2. Re-check the original outcome, oracle, likely misfire, and explicit non-goals.
3. Work only on the active task with the assigned PM, Scout, Judge, or Worker role.
4. Record a compact durable receipt and update board truth.
5. Keep at most one write Worker active.
6. Run the oracle-relevant checks after each Worker package.
7. Review only at the translation phase boundary, distribution-risk boundary, rejected verification, ambiguity, or final completion.
8. Continue to the next safe task while the stop gate says work remains.
9. Before ending, run `check-can-stop.mjs`; finish only when the final audit records `full_outcome_complete: true` or the exact terminal approval-wait shape is valid.
