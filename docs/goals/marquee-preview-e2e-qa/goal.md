# Marquee Preview Browser QA Automation

## Objective

Build deterministic, repository-owned Chromium automation that exercises the marquee-preview feature through real left-Control keyboard state and real pointer movement, proves live preview behavior before release, proves the committed selection matches the preview, and runs reliably both locally and in CI.

## Original Request

Plan implementation of automated marquee-preview QA using GoalBuddy Prep.

## Intake Summary

- Input shape: `existing_plan`
- Audience: Lineage Logo maintainers and users relying on marquee selection
- Authority: `requested`
- Proof type: `test`
- Completion proof: The complete browser scenario matrix passes repeatedly and in a dedicated CI job without flakes, repository mutation, or false success.
- Goal oracle: A clean-checkout Playwright run on the complex Seatify fixture holds real left Control through real pointer drags and proves live entry/exit, preview-to-commit parity, additive and canceled gestures, contain/touch behavior, zoom/sidebar variants, and non-mutation.
- Likely misfire: Add method-level tests or screenshot-only checks that never exercise pointer capture and physical modifier state, or create a timing-dependent browser suite that can pass while preview and commit diverge.
- Blind spots considered: deterministic ports and readiness; descriptive `.localhost` origin; exact temporary-workspace cleanup; geometry-derived input; transient preview identity; Layers parity; pointer capture and Escape; history/dirty/serialization invariants; failure diagnostics; browser installation; runtime budget; repeat-run flake proof; clean-checkout reproduction.
- Existing plan facts: Chromium-only MVP; existing complex Seatify fixture; temporary workspace; real keyboard and mouse input; DOM/state assertions as the primary oracle; one focused visual assertion; live entry/exit, commit parity, Shift additive, Escape, contain/touch, zoom, collapsed sidebars, and non-mutation; a separate browser CI job that preserves the fast existing check.

## Goal Oracle

The oracle for this goal is:

`From a clean checkout, npm run test:e2e starts Lineage Logo at a descriptive marquee-qa.localhost URL against a temporary copy of the complex Seatify fixture, uses Chromium keyboard and mouse input to drive the complete marquee-preview scenario matrix, leaves the repository and workspace unchanged, passes ten consecutive repeats without flakes, and is enforced by a green dedicated CI job with failure-only traces/screenshots.`

The PM must keep comparing task receipts to this oracle. Planning, one passing smoke test, direct calls to `previewMarquee`, or a screenshot that merely looks purple are not enough. The goal finishes only when a final Judge/PM audit maps receipts and verification back to this oracle and records `full_outcome_complete: true`.

## Goal Kind

`existing_plan`

## Current Tranche

Validate the agreed browser-QA architecture, deliver a working deterministic Playwright harness and core real-input preview proof, extend it through the full behavior/layout/non-mutation matrix and CI, then run repeated flake and cleanup verification. This tranche ends when the automation—not the marquee feature implementation itself—is complete and trustworthy.

## Non-Negotiable Constraints

- This prepared board does not execute implementation. Execution begins only from the explicit `/goal` or `/goalbuddy` command.
- Preserve the current uncommitted marquee-preview feature as the system under test. Do not discard, overwrite, reformat, or silently broaden that product diff.
- Exercise the real UI through Chromium keyboard and pointer APIs. Direct editor-method calls cannot satisfy the browser oracle.
- The physical activation proof must use the left-Control path expected by the product and verify that the ready state is actually armed before dragging.
- Derive drag coordinates from live accessible target geometry. Do not depend on absolute screen pixels or fixed sleeps.
- Use the existing complex Seatify fixture through an isolated temporary workspace. Do not save into or mutate checked-in fixtures.
- Present and test the editor through a descriptive `.localhost` subdomain, never raw localhost or 127.0.0.1.
- Keep Chromium as the only browser in this tranche. Firefox, WebKit/Safari, broad screenshot matrices, save workflows, and unrelated canvas automation are non-goals.
- Keep `npm run check` as the fast existing gate; add browser QA as a separately runnable command and dedicated CI proof.
- Prefer accessible labels, transient preview markers, selected Layers state, controls, and serialization/history state over pixel assertions. Permit one narrowly cropped visual assertion only if it is stable across clean runs.
- Capture traces, screenshots, and reports on failure, not on every green run.
- Product changes beyond the current marquee preview are disallowed unless the Judge proves a minimal editor-only testability seam is necessary, bounds it explicitly, and requires serialization/non-mutation proof.
- Temporary-directory deletion must validate the exact created path and stop on cleanup failure.

## Planned Scenario Contract

The final suite must cover:

1. Live entry: purple preview halos appear before pointer release as the region encloses Seatify objects.
2. Live exit: halos disappear immediately when the pointer contracts the region past those objects.
3. Preview/commit parity: the final selected count and pressed Layers rows match the last visible preview.
4. Shift-additive behavior: existing selection remains in the preview union while new matching objects enter and leave.
5. Escape cancellation: preview and overlay clear, the pre-gesture selection/primary return, and the successor click is suppressed.
6. Contain versus touch: the same partial overlap is excluded in contain mode and included in touch mode through the preferences UI.
7. Layout resilience: the core proof passes at 125% zoom and with each sidebar collapsed.
8. Non-mutation: preview and selection commit create no SVG byte change, dirty state, undo checkpoint, Reset/Save enablement, or unintended inspector change.
9. Visual affordance: one focused check proves the transient halo uses the expected purple selection treatment and prior blue handles/orange hover do not compete while active.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete.

Do not stop after installing Playwright, starting a browser, or passing one smoke scenario. Continue through the complete behavior matrix, repeat-run stability, CI enforcement, cleanup proof, and final audit while safe local work remains.

If browser installation, CI availability, or another external dependency blocks one slice, record the exact blocker and continue all safe local harness, scenario, and verification work that remains.

## Slice Sizing

The first Worker should deliver a genuinely working vertical slice: deterministic isolated startup plus a real left-Control/pointer test that observes live entry/exit and commits the matching selection. Do not split configuration, server startup, and the first useful test into separate tiny tasks.

The second Worker should complete the remaining scenario and CI package coherently. Repeated same-shape scenarios belong together; do not create one Worker/Judge pair per case.

## Board Health

Machine truth lives at:

`docs/goals/marquee-preview-e2e-qa/state.yaml`

Check it with:

```bash
node /Users/neonwatty/.codex/plugins/cache/goalbuddy/goalbuddy/0.4.3/skills/goal-prep/scripts/check-goal-state.mjs docs/goals/marquee-preview-e2e-qa
```

The live local board is:

`http://goalbuddy.localhost:41737/marquee-preview-e2e-qa/`

## Run Command

```text
Codex: /goal Follow docs/goals/marquee-preview-e2e-qa/goal.md.
Claude Code: /goalbuddy Follow docs/goals/marquee-preview-e2e-qa/goal.md.
```

## PM Loop

On every `/goal` continuation:

1. Read this charter and the GoalBuddy execution contract.
2. Read `state.yaml`; it wins for task and completion truth.
3. Recheck the existing marquee-preview diff and its recorded dirty fingerprint before any Worker write.
4. Work only on the active task and preserve the one-active-task invariant.
5. Require Scout/Judge evidence for ambiguous runtime, cleanup, assertion, or CI choices.
6. Give each Worker exact `allowed_files`, verification commands, and stop conditions.
7. Record compact receipts and advance immediately while safe required work remains.
8. Run the GoalBuddy stop checker before ending execution.
9. Complete only through a final audit that maps the browser evidence, repeat runs, CI proof, and cleanup state back to the oracle with `full_outcome_complete: true`.
