# Lineage Logo Public Beta Readiness

## Objective

Prepare and execute a phased, evidence-driven public-beta hardening program for Lineage Logo, beginning by promoting the Seatify constellation into a canonical repository test fixture.

## Original Request

Make sure the Seatify constellation logo is saved in the repository as a reusable test logo, and create a detailed phased plan with parallel-development opportunities managed through GoalBuddy and subagents.

## Intake Summary

- Input shape: `existing_plan`
- Audience: Lineage Logo maintainers, logo-designer agents, and public-beta users
- Authority: `requested`
- Proof type: `demo`
- Completion proof: From a clean checkout, a user can install and launch the product, open the canonical Seatify fixture, complete manual and agent-authored edits, understand and decide a proposal, persist a continuation without ambiguity, recover from supported failure modes, and pass the full release matrix.
- Goal oracle: Fresh-install Seatify release walkthrough plus automated unit, integration, security, browser, accessibility, concurrency, and packaging gates.
- Likely misfire: Shipping more canvas mechanics while the CLI, instance discovery, review comprehension, persistence lifecycle, or release proof remains unsuitable for public users.
- Blind spots considered: fixture drift, multiple local instances, terminal exit semantics, approval safety, provenance, saved-file ownership, cross-browser behavior, accessibility, upgrade behavior, diagnostics, support documentation, and global iteration naming.
- Existing plan facts: The preceding adversarial audit found a strong editor core and safety boundary, but identified public-beta blockers in packaging, agent discovery, review semantics, persistence state, browser coverage, and documentation consistency.

## Goal Oracle

The final oracle is a release-candidate walkthrough in which a freshly installed CLI launches a named `.localhost` editor, opens the canonical Seatify fixture, completes manual and agent-authored edits with understandable review evidence, safely persists a numbered continuation, survives concurrency and recovery scenarios, and passes the full automated release matrix.

## Goal Kind

`existing_plan`

## Current Tranche

Validate the audit-derived plan, land the canonical Seatify fixture first, then complete successive safe release-hardening phases until the public-beta oracle is satisfied.

## Phased Execution Plan

### Phase 0 — Establish the test oracle

Promote the Seatify constellation into an explicit canonical fixture contract. Decide whether `examples/seatify-constellation.svg` remains the single source of truth or whether the canonical copy moves under `tests/fixtures/`; prevent silent drift if both locations remain. Verify its expected layer count, IDs, gradients, nested transforms, text, dimensions, accessibility names, and clean serialization. Make all Seatify browser tests consume the canonical source.

Exit gate: one documented canonical path, drift protection, fixture-contract tests, and the existing full suite passing.

### Phase 1 — Discover and freeze public contracts

Use parallel read-only Scouts to map four independent surfaces:

1. CLI installation, commands, output modes, exit codes, diagnostics, and `.localhost` launch behavior.
2. Multi-instance discovery, workspace/session selection, lease ownership, restart, and context cleanup.
3. Human review comprehension, semantic diffs, producer intent, acceptance, persistence, and recovery.
4. Browser/accessibility/release verification gaps, including Firefox, WebKit, keyboard-only use, and clean-install testing.

A Judge synthesizes the findings into stable command, discovery, lifecycle, and review contracts before implementation begins.

Exit gate: accepted contracts, migration risks, exact Worker scopes, and verification commands.

### Phase 2 — Make the CLI and connection bridge beta-usable

Build a real distributable CLI with help/version support, human and JSON output, actionable diagnostics, meaningful exit codes, visible review-wait progress, and automatic opening of a descriptive `.localhost` URL. Replace the single global active-context descriptor with workspace-aware instance discovery and explicit ambiguity handling.

Parallel opportunity: CLI packaging/output and instance-registry implementation may run in parallel only after the Phase 1 Judge freezes their interface and proves disjoint write scopes. The PM must otherwise sequence them.

Exit gate: clean-install command tests, two-instance tests, stale-context cleanup tests, and an agent submission that deterministically reaches the selected Seatify workspace.

### Phase 3 — Make human approval informed and persistence unambiguous

Add semantic before/after descriptions for every supported operation, trustworthy producer and intent context, clear current-versus-proposed language, useful handling for large transactions, and an explicit policy for all-or-nothing versus partial acceptance. Unify Proposed → Accepted → Publishing → Saved lifecycle semantics so the browser and producer agree on whether and where an artifact is durable.

The review and persistence packages are intentionally sequential because they share transaction state and user-facing lifecycle language.

Exit gate: adversarial proposal tests cover subtle paint changes, structural replacements, multi-operation transactions, rejection, timeout, restart, and successful durable continuation without duplicate saves.

### Phase 4 — Repair workspace information architecture

Choose a useful small-size preview target automatically for the canonical Seatify fixture instead of defaulting to a missing `#icon`. Define concept-aware iteration naming or explicit lineage metadata so multiple concepts cannot produce misleading flat `iteration-N.svg` histories. Improve prominent conflict, unsaved, accepted, and disconnected states without expanding the product into a general vector editor.

Parallel opportunity: the browser/accessibility test-matrix Worker can run beside this package after selectors and status vocabulary are frozen, because its initial write scope is limited to test and CI files.

Exit gate: multi-concept Seatify workspace walkthrough, correct preview selection, no ambiguous continuation, and responsive/keyboard verification.

### Phase 5 — Expand release evidence and public documentation

Run Chromium, Firefox, and WebKit coverage proportional to supported behavior; add accessibility assertions, clean-install/package smoke tests, upgrade and stale-context tests, and failure diagnostics. Reconcile README/MVP contradictions and add installation, troubleshooting, privacy/telemetry, security reporting, support boundaries, changelog, license, and beta-known-limitations material.

Documentation can be drafted in parallel with the stable test harness, but final wording waits for frozen CLI and lifecycle contracts.

Exit gate: CI enforces the release matrix and every advertised claim maps to an automated check or explicit documented limitation.

### Phase 6 — Release-candidate oracle and adversarial audit

Perform the complete fresh-install Seatify walkthrough from outside the repository, exercise two simultaneous editors, accept and reject representative proposals, verify durable SVG bytes, and audit every receipt against the original outcome. Fix remaining safe gaps and repeat until the final Judge records `full_outcome_complete: true`.

## Subagent Operating Model

- PM owns `state.yaml`, chooses the single active board task, and integrates receipts.
- Scouts are read-only and should run concurrently when their evidence surfaces are independent.
- Judges gate the initial plan, shared interface freezes, risky lifecycle transitions, and final completion.
- Workers own explicit files, complete one coherent vertical slice, run their listed verification, and never revert unrelated changes.
- Concurrent write Workers are allowed only after a Judge proves non-overlapping file scopes and a stable shared contract; the PM must record that decision before dispatch.
- Every completed, blocked, or escalated task leaves a receipt. Planning or a passing narrow test never counts as completion.

## Non-Negotiable Constraints

- Preserve ordinary, self-contained SVG interoperability and existing safety validation.
- Keep servers loopback-only and credentials out of browser-visible state, arguments, URLs, logs, and receipts.
- Never overwrite a source SVG; persistence must be collision-safe and recoverable.
- Use descriptive `.localhost` URLs for every user-facing editor or board link.
- Preserve user changes in dirty worktrees and isolate test/runtime context from real editor instances.
- Do not claim Safari/Firefox, accessibility, packaging, or recovery support without evidence.
- Keep the correction-canvas scope; do not turn the release program into a general vector-design rewrite.

## Stop Rule

Stop only when a final Judge audit proves the full original public-beta outcome, including the canonical Seatify fixture, and records `full_outcome_complete: true`.

## Slice Sizing

Each Worker package should deliver a usable vertical outcome such as a canonical fixture contract, installable CLI path, multi-instance connection registry, comprehensible review flow, unambiguous persistence lifecycle, or enforceable release matrix. Avoid helper-only tasks unless they directly unblock one of those outcomes.

## Board Health

Check the board with:

```bash
node "$GOALBUDDY_SKILL/scripts/check-goal-state.mjs" docs/goals/lineage-logo-public-beta-readiness
```

## Canonical Board

Each GoalBuddy run keeps machine truth in a local, uncommitted `state.yaml`
alongside this portable charter. Receipts remain local unless they are deliberately
sanitized for publication.

## Run Command

```text
Codex: /goal Follow docs/goals/lineage-logo-public-beta-readiness/goal.md.
Claude Code: /goalbuddy Follow docs/goals/lineage-logo-public-beta-readiness/goal.md.
```

## PM Loop

On every continuation, read this charter and the local `state.yaml`, execute only the active task, use installed GoalBuddy role agents, attach local receipts, verify against the oracle, and continue to the next largest safe slice. Before stopping, run the GoalBuddy stop checker and honor its result.
