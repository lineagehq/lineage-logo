# Agent-to-Canvas Integration

## Objective

Connect agent-authored SVG changes to the manual correction canvas so users can receive live, structured layer updates, inspect exactly what changed, accept or revert those changes, continue editing with coherent undo/redo, and export a clean faithful SVG.

## Original Request

Create a detailed GoalBuddy Prep plan to implement the agent command contract, live canvas updates, undo/redo integration, agent-change review, and the end-to-end generate-refine-adjust-export workflow.

## Intake Summary

- Input shape: `existing_plan`
- Audience: Logo designers using the lineage-logo manual correction canvas with an agentic logo-generation workflow
- Authority: `requested`
- Proof type: `demo`
- Completion proof: A repeatable browser walkthrough and automated suite prove an agent can add and update SVG layers in the open canvas, the user can review and accept/revert the change, undo/redo remains coherent, and the exported SVG is clean and faithful.
- Goal oracle: A fixture-backed end-to-end agent-to-canvas workflow that runs generate/load → agent add/update → review → accept/revert → undo/redo → manual refinement → export/reopen, with exact assertions and a clean browser console.
- Likely misfire: Shipping a command API or simulated demo that bypasses the real editor, loses unsupported SVG content, breaks history, silently trusts stale agent edits, or requires the user to reload.
- Blind spots considered: command identity and versioning, stale-base conflicts, atomicity, trust/review boundaries, transport lifecycle, large payloads, sanitization, unsupported SVG constructs, history semantics, selection restoration, accessibility, offline/reconnect behavior, export cleanliness, and skill integration ownership.
- Existing plan facts: Define a small command contract; connect the logo-designer skill for live changes; preserve undo/redo; show an agent-change review state with accept/revert; prove the full generate → manually refine → targeted agent adjustment → export workflow; keep manual vector creation out of the MVP UI.

## Goal Oracle

The oracle for this goal is:

`A real browser session and automated integration suite demonstrate that versioned agent commands modify the currently open SVG without reload, render an accurate review diff, support accept/revert and coherent undo/redo, survive save/reopen, and export SVG with no editor or protocol artifacts.`

The PM must keep comparing task receipts to this oracle. Planning, discovery, a passing tiny slice, or a clean-looking board is not enough. The goal finishes only when a final Judge/PM audit maps receipts and verification back to this oracle and records `full_outcome_complete: true`.

## Goal Kind

`existing_plan`

## Current Tranche

Continuously implement and verify the complete local agent-to-canvas MVP: validate the integration boundary; establish a versioned, atomic command model and transport; apply agent transactions through the editor's fidelity and history systems; add a clear accessible review experience; connect the logo-designer skill or a faithful local adapter; and complete the full oracle walkthrough. Stop only at a genuine risk/ambiguity boundary or after final audit proves the full outcome.

## Non-Negotiable Constraints

- Preserve SVG source fidelity, IDs, references, unsupported attributes/elements, transforms, and hierarchy unless an explicit validated command targets them.
- Agent-authored changes must be transactional, validated, attributable, reviewable, and reversible; partial application is a failure.
- Stale or ambiguous commands must not silently overwrite newer manual edits.
- Accept, revert, undo, and redo semantics must be explicit and covered by tests.
- Exported SVG must contain no editor, review, transport, or agent-protocol metadata.
- The manual UI remains focused on correction and inspection; freehand/path authoring is out of scope for this tranche.
- Use the existing verification gate (`npm run check`) and add focused contract, history, fidelity, transport, and browser coverage.
- Keep the integration local-first and avoid requiring production credentials or hosted infrastructure for the oracle.
- Preserve current manual-correction behavior, keyboard accessibility, responsive layout, and preview lifecycle resilience.
- Do not execute this plan during Goal Prep; implementation begins only through the GoalBuddy run command.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete.

Do not stop after planning, discovery, or Judge selection if the user asked for working software or automation and a safe Worker task can be activated.

Do not stop after a single verified Worker package when the broader owner outcome still has safe local follow-up work. Advance the board to the next highest-leverage safe Worker package and continue unless a phase, risk, rejected-verification, ambiguity, or final-completion review is due.

Do not create one Worker/Judge pair per repeated file, table, route, or helper. Put repeated same-shape work into one Worker package and review the package as a whole.

## Slice Sizing

Safe means bounded, explicit, verified, and reversible. It does not mean tiny.

A good task is the largest safe useful slice. Each Worker package should deliver a coherent vertical capability: protocol foundation, editor transaction path, live transport, review workflow, skill integration, or oracle hardening.

Do not stop because a slice needs owner input, credentials, production access, destructive operations, or policy decisions. Mark that exact slice blocked with a receipt, create the smallest safe follow-up or workaround task, and continue all local, non-destructive work that can still move the goal toward the full outcome.

## Board Health

The PM owns board health. If the board looks stale, misleading, offline, or inconsistent, run:

```bash
node /Users/neonwatty/.codex/plugins/cache/goalbuddy/goalbuddy/0.4.3/skills/goal-prep/scripts/check-goal-state.mjs docs/goals/agent-canvas-integration
```

## Canonical Board

Machine truth lives at:

`docs/goals/agent-canvas-integration/state.yaml`

If this charter and `state.yaml` disagree, `state.yaml` wins for task status, active task, receipts, verification freshness, and completion truth.

## Run Command

```text
Codex: /goal Follow docs/goals/agent-canvas-integration/goal.md.
Claude Code: /goalbuddy Follow docs/goals/agent-canvas-integration/goal.md.
```

## PM Loop

On every `/goal` continuation:

1. Read this charter and the GoalBuddy execution contract.
2. Read `state.yaml`; work only on its active task.
3. Re-check the intake, existing-plan facts, likely misfire, and oracle.
4. Assign the task according to its Scout, Judge, Worker, or PM role.
5. Record a compact receipt and update board truth.
6. Run the task's verification and compare the result to the oracle.
7. Advance immediately to the next largest safe useful slice unless a real phase, risk, ambiguity, failed-verification, or approval boundary requires review.
8. Before ending, run the GoalBuddy stop checker. Finish only when final audit records `full_outcome_complete: true` or validates an exact terminal approval wait.
