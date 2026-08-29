# Collective Multi-Selection Transforms

## Objective

Implement, dogfood, and rigorously verify a shared transform experience that lets a user resize or rotate a multi-selection as one coherent temporary group without changing the SVG hierarchy.

## Original Request

"Agreed. Let's continue with that now."

This approves the previously recommended next feature: collective resize and rotation for multi-selection.

## Intake Summary

- Input shape: `specific`
- Audience: people manually correcting layered SVG logos in the Lineage Logo canvas
- Authority: `approved`
- Proof type: `test`
- Completion proof: the shared transform flow passes exact unit and Chromium coverage on a clean checkout, survives adversarial local dogfood with the complex Seatify fixture, preserves atomic Undo/Redo, and leaves the authored SVG free of editor metadata
- Goal oracle: on the complex Seatify fixture, select three or more eligible objects—including nested and cross-parent objects—and use one shared box to resize and rotate them while exact relative geometry, selection identity, history, serialization, and safety behavior remain correct
- Likely misfire: draw a convincing shared box but transform only the primary object, approximate cross-parent geometry incorrectly, create multiple history entries, leak UI state into SVG, or regress existing single-selection and collective-movement workflows
- Blind spots considered: transformed ancestors; root-space versus parent-space matrices; union bounds and pivot choice; primary versus member feedback; modifier conventions; pointer thresholds and cancellation; locked, hidden, disconnected, and ineligible members; agent-review blocking; zoom; collapsed sidebars; save/reload; deterministic browser gestures; flake resistance
- Existing plan facts: build on the merged marquee-selection and collective-movement foundation; use a shared union transform box; preserve member spacing and proportions; make each gesture one Undo/Redo checkpoint; dogfood with the complex Seatify logo; follow with snapping and guides only after this feature is proven

## Goal Oracle

The oracle for this goal is:

`On a byte-exact temporary copy of the complex Seatify fixture, Chromium selects at least three labeled eligible objects, including a nested or cross-parent case, and exercises shared-box resize and rotation from non-primary members at 100% and 125% zoom; every member follows one mathematically coherent root-space transform around the documented union pivot, relative layout is preserved, the primary identity remains deterministic, one gesture creates exactly one history checkpoint, Undo/Redo and save/reload reproduce exact before/after geometry, Escape/pointer cancel/below-threshold/no-op/locked/hidden/disconnected/ineligible/agent-blocked cases make no partial mutation or history, existing single-selection/move/align/distribute behavior remains green, and serialized SVG contains only intended transforms with no selection, handle, aura, preference, or test metadata.`

The PM must keep comparing task receipts to this oracle. A rendered box, happy-path demo, or one passing focused test is not enough. The goal finishes only when a final Judge or PM audit maps current exact-SHA evidence to every clause and records `full_outcome_complete: true`.

## Goal Kind

`specific`

## Current Tranche

Continuously discover the relevant architecture, settle the observable transform contract, implement the largest safe vertical slice, add exact unit and Chromium regression coverage, dogfood it on the complex Seatify fixture, repair every in-scope defect, and complete only after the full oracle passes on the final tree.

The intended product behavior is:

- A multi-selection of two or more eligible objects presents one visually unambiguous union box with shared resize handles and a recognizable rotation handle.
- Dragging a shared resize handle applies one coherent transform to every selected member around the documented anchor or center; relative positions and shape proportions follow the same transform.
- Dragging the shared rotation handle rotates every selected member around the union pivot while preserving their constellation.
- The interaction does not insert a temporary or permanent wrapper group and does not reorder or rename SVG layers.
- Existing platform modifier conventions and single-selection semantics are preserved unless the architecture review demonstrates a conflict and Judge records a safer contract.
- Every committed gesture is one atomic history action; cancel, no-op, and rejected gestures are zero history actions.
- Selection aura, primary identity, Layers feedback, and shared handles remain legible during preview and after commit.
- The behavior is deterministic across supported zoom and sidebar states and serializes only the intended SVG geometry.

## Non-Negotiable Constraints

- Preserve all existing single-selection transform, marquee selection, collective movement/nudge, align/distribute/spacing, Layers, history, save, and agent-review behavior.
- Compute collective geometry in a coordinate space that is correct for nested and cross-parent selections; do not assume a shared parent transform.
- Do not alter SVG hierarchy merely to implement temporary multi-selection behavior.
- Do not partially transform a selection. If any required precondition fails, reject safely before mutation or follow an explicitly reviewed eligible-member policy that is consistently represented in the UI and tests.
- Keep selection overlays, handles, previews, preferences, test identifiers, and editor-only state out of the saved SVG.
- Use one atomic Undo/Redo checkpoint per committed pointer gesture.
- Respect locked, hidden, disconnected, structurally unsafe, and agent-review-gated states.
- Meet existing accessibility conventions for focus, labels, hit targets, keyboard cancellation, and reduced motion.
- Start any local product server on a named `.localhost` subdomain, never raw localhost.
- Keep changes scoped to collective resize/rotation and their proof. Do not add snapping, guides, auto-layout, new settings, agent-driven insertion, touch gestures, hierarchy editing, or unrelated UI redesign.
- Preserve user work and unrelated dirty changes. Use reversible edits and exact target paths.

## Verification Baseline

The repository exposes these verification commands; Scout and Judge must refine focused commands and distinguish goal-owned failures from pre-existing repository health:

```text
npm run typecheck
npm run test
npm run build
npm run test:e2e -- --project=chromium
```

Final evidence must include focused deterministic geometry assertions, relevant regression coverage, full unit/type/build gates, Chromium coverage against a temporary fixture copy, repeat runs sufficient to expose flakiness, and a clean-checkout run on the exact final SHA.

## Explicit Non-Goals

- Snapping, smart guides, constraints, or auto-layout
- New selection gestures or marquee preferences
- Agent-authored layer insertion or protocol expansion
- Touch-specific transform UX
- Permanent grouping, ungrouping, or hierarchy mutation
- Broad canvas restyling or settings-page work
- Supporting additional browsers unless existing policy already requires them

## Stop Rule

Stop only when a final audit proves the full original outcome is complete.

Do not stop after planning, architecture discovery, a visual shared-box prototype, a happy-path unit test, or one verified Worker package while safe in-scope work remains.

If adversarial QA finds a defect, create the smallest coherent recovery Worker package, fix it, and rerun affected plus full exact-SHA gates before final audit.

If an exact human approval phrase is the only remaining blocker and no safe local work remains, record the required phrase in a blocked receipt and wait once.

## Slice Sizing

Safe means bounded, explicit, verified, and reversible. It does not mean tiny. Prefer a vertical implementation package that delivers shared controls, correct geometry, history integration, serialization safety, and focused tests together. Split only at a genuine architectural or risk boundary.

## Board Health

Machine truth lives at `docs/goals/multi-selection-collective-transforms/state.yaml`. If the charter and board disagree about task status, receipts, verification freshness, or completion, `state.yaml` wins.

Run the checker when the board appears stale or before a phase transition:

```bash
node /Users/neonwatty/.codex/plugins/cache/goalbuddy/goalbuddy/0.4.3/skills/goal-prep/scripts/check-goal-state.mjs docs/goals/multi-selection-collective-transforms
```

## Run Command

```text
Codex: /goal Follow docs/goals/multi-selection-collective-transforms/goal.md.
Claude Code: /goalbuddy Follow docs/goals/multi-selection-collective-transforms/goal.md.
```

## PM Loop

On every `/goal` continuation:

1. Read this charter, the canonical board, and GoalBuddy's execution contract.
2. Work only on the active task and use its assigned role.
3. Record a compact receipt, update the board, and advance to the next largest safe task.
4. Review at architecture, risk, rejected-verification, adversarial-QA, and final-completion boundaries.
5. Run the oracle after each Worker package and on the exact final tree.
6. Before ending, run `check-can-stop.mjs`; continue while safe work remains.
