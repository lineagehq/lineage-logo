# Direct Logo-Designer Skill Integration

## Objective

Connect the real `logo-designer-skill` directly to Lineage Logo's public agent transaction protocol so a skill run can securely target the active local canvas, submit a structured SVG proposal, wait for the human's Accept or Revert decision, and continue its iteration loop from the accepted clean SVG revision.

## Original Request

"excellent - plan this out"

This refers to the agreed next milestone: package the existing adapter as a reusable producer client, securely discover the active canvas session, submit and await proposals from the real logo-designer skill, return accepted SVG revisions to the skill loop, prove the flow across both repositories with a genuine generated logo, and document the user workflow.

## Intake Summary

- Input shape: `existing_plan`
- Audience: people using the logo-designer skill with Lineage Logo, plus maintainers of both repositories
- Authority: `requested`
- Proof type: `demo`
- Completion proof: a real logo-designer skill run proposes a genuine SVG change to an open Lineage Logo canvas; the accepted SVG remains isolated until approval, Accept and Revert both converge back to the skill, an accepted clean saved revision is consumed by the next skill iteration, both repositories' required checks pass, and the workflow is reproducible from documentation without exposing credentials
- Goal oracle: a recorded two-repository end-to-end browser-and-producer walkthrough backed by automated contract tests and a clean saved SVG artifact
- Likely misfire: shipping another command-line wrapper or mock-only test that never connects the actual skill lifecycle to human review and continued iteration
- Blind spots considered: cross-repository ownership and instructions; token/session bootstrap without secret leakage; authoritative artifact and revision ownership; producer behavior while review waits; crash/reconnect and terminal decision recovery; compatibility and versioning; release/install boundaries; keeping per-operation approval and remote collaboration out of scope
- Existing plan facts: reuse the public protocol rather than editor internals; package the current adapter logic as a producer client; support secure active-session targeting; submit and wait for Accept/Revert; feed accepted SVG back into the skill iteration loop; test with a genuine generated logo across both repositories; document generate → review → correct → continue; defer per-operation acceptance

## Goal Oracle

The oracle for this goal is:

`From a documented clean setup, the real logo-designer skill submits a genuine structured SVG proposal to the active local Lineage Logo document through the public authenticated protocol; the canvas visibly preserves the accepted SVG until review, both Accept and Revert produce durable terminal results observable by the skill, an accepted clean saved SVG becomes the next skill input without editor metadata or fidelity loss, automated contract/E2E checks pass in both repositories, and a final Judge maps the demo transcript, artifacts, tests, security evidence, and docs back to every required outcome.`

The PM must keep comparing task receipts to this oracle. Planning, discovery, a passing tiny slice, or a clean-looking board is not enough. The goal finishes only when a final Judge/PM audit maps receipts and verification back to this oracle and records `full_outcome_complete: true`.

## Goal Kind

`existing_plan`

## Current Tranche

Continuously discover, validate, implement, and prove the complete local two-repository integration. The largest expected reversible packages are: architecture and security validation; a reusable producer/session client at the public Lineage Logo boundary; the actual logo-designer skill lifecycle integration; and a genuine cross-repository acceptance oracle with documentation and remediation. Do not stop after only one repository, a client library, mocked transport, or a proposal that cannot continue the skill loop.

## Non-Negotiable Constraints

- Keep the canvas correction-first; do not add general drawing tools or manual layer creation.
- Use Lineage Logo's public authenticated transaction/manifest/status boundary; the skill must not import canvas, history, workspace, browser, or other editor internals.
- Never place bearer tokens in URLs, committed files, process arguments, logs, fixtures, screenshots, or shell-history examples.
- Treat the accepted SVG and its monotonic document revision as authoritative; agent proposals remain detached until explicit human acceptance.
- Preserve structured SVG fidelity, IDs, transforms, resources, text, accessibility attributes, clean serialization, manual history, and save/reopen behavior.
- Accept, Revert, stale revision, duplicate submission, crash/reconnect, and unavailable-canvas paths must terminate predictably for the skill without silent overwrite or indefinite waiting.
- Respect each repository's instructions, dirty worktree, branch strategy, verification commands, and release/install conventions.
- Cross-repository changes must be independently useful, reversible, and committed through reviewable branches; do not publish packages, releases, or external messages without explicit authority.
- Per-operation acceptance, remote/multi-user transport, cloud hosting, proprietary formats, and a general-purpose SVG SDK are out of scope for this tranche.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete.

Do not stop after planning, discovery, or Judge selection if the user starts execution and a safe Worker task can be activated.

Do not stop after a single verified Worker package when the broader owner outcome still has safe local follow-up work. Advance the board to the next highest-leverage safe Worker package and continue unless a phase, risk, rejected-verification, ambiguity, or final-completion review is due.

If an exact human approval phrase is the only remaining blocker and no safe local work remains, ask once and preserve the approval-wait state exactly as required by GoalBuddy.

## Slice Sizing

Safe means bounded, explicit, verified, and reversible. It does not mean tiny. Prefer complete vertical slices: a usable producer/session boundary, a working skill proposal-and-wait loop, and a real cross-repository acceptance flow. Do not split repeated protocol fields, endpoints, commands, fixtures, or documentation paragraphs into separate Worker tasks.

## Board Health

The PM owns board health. If the board looks stale, misleading, offline, or inconsistent, run:

```bash
node /Users/neonwatty/.codex/plugins/cache/goalbuddy/goalbuddy/0.4.3/skills/goal-prep/scripts/check-goal-state.mjs docs/goals/logo-designer-skill-integration
```

## Canonical Board

Machine truth lives at:

`docs/goals/logo-designer-skill-integration/state.yaml`

## Run Command

```text
Codex: /goal Follow docs/goals/logo-designer-skill-integration/goal.md.
Claude Code: /goalbuddy Follow docs/goals/logo-designer-skill-integration/goal.md.
```

## PM Loop

On every execution continuation, read this charter and `state.yaml`, follow the GoalBuddy execution contract, work only the active task, require compact receipts, keep the oracle live, advance through safe useful packages, and run `check-can-stop.mjs` before ending. `state.yaml` wins on task status, receipts, verification freshness, and completion truth.
