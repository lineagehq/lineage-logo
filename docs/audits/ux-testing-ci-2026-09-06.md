# Logo creation, manual editing, testing, and CI audit

Date: 2026-09-06. Audited commit: `fbfa870c0f7fb174c58fbb34e3fa0531e8971770` (current fetched `origin/main`). Audit branch: `codex/ux-testing-ci-audit`.

The original checkout was on `feat/precision-transforms-snapping`, 36 commits behind main with no unique commits. This fresh worktree was fast-forwarded to main; the original checkout and its untracked goal documents were not changed. This is an assessment, not an implementation change or a formal PR review.

## Assessment

The strongest part of Lineage Logo is its correction and transaction machinery. It already has substantial geometric editing, strict SVG validation, detached agent review, stale-revision protection, durable accepted artifacts, and meaningful automated tests. Keeping clean SVG as the document format is a valuable product decision.

The weakest part is the continuity of the design experience. The product asks users to understand files, SVG groups, selection modes, and proposal plumbing before they can comfortably iterate. Common actions also behave inconsistently: saving a manual edit resets editing context, while accepting an agent edit preserves undo; collective transforms work, while collective color changes and deletion are disabled. The app is more mature as a guarded correction engine than as an approachable agent-assisted logo creation workspace.

I would prioritize continuity, truthful previews, and a simpler agent handoff before adding more transform sophistication or turning the app into a general vector editor.

## Evidence and limits

| Check | Result |
| --- | --- |
| Fresh dependency install | Passed; npm reported zero vulnerabilities at install time |
| `npm run check`, Node 22.22.3 on this Mac | Typecheck, 548 tests across 29 files, and production build passed |
| Full Chromium suite | Passed, exit 0; 48 scenarios across 12 files |
| Firefox and WebKit critical projects | Both passed, exit 0; one existing smoke scenario per engine |
| Current main CI | All six jobs passed in [run 34046429173](https://github.com/lineagehq/lineage-logo/actions/runs/34046429173) |
| Interactive app | Tested through `http://lineage-logo.localhost:5173`, using copied public Seatify fixtures in an isolated temporary workspace |
| Manual/agent continuation | Changed wordmark text manually, saved, submitted a CLI paint proposal, previewed and accepted it, verified saved digest and unchanged original, and reloaded the saved iteration |
| Window sizes | Inspected default 1280×720, 1024×768, and 760×720 layouts; temporary viewport override restored |

The saved continuation contained both `seatify audit` and the requested purple fill. Its SHA-256 matched the CLI receipt, and the original fixture remained byte-identical. The interactive check used the current source build, not a fresh public-registry install. The existing installed-CLI browser scenario also ran as part of the Chromium suite. Browser reload was checked interactively; process-restart coverage comes from the installed-CLI test, not an additional manual restart in this audit.

No independent participants were observed and no claim is made about actual onboarding conversion, design quality across model providers, native Safari, screen-reader conformance, or large-document performance. Priority and effort below are engineering judgments. “Reproduced” means observed in the live app; “source evidence” means established by code inspection; proposed changes are not implemented.

## Recommended changes, in order

### 1. Preserve editing context when saving a manual iteration

**High priority; reproduced; medium effort.** Select Seatify title, edit its text, commit, and Save. The saved file opens, Selection becomes None, and Undo/Redo become disabled. Source inspection shows locks and editing scope are also reset by this path. This interrupts precisely the repeated correction workflow the app is meant to support.

`src/client/main.ts:2081` calls `loadWorkspace(result.file.path)` after saving. Document loading calls `editor.load`, which deselects, resets history, clears locks, and resets scope (`src/client/canvas/editor.ts:1333`). Agent acceptance already has a separate continuation path that preserves undo (`src/client/main.ts:905`).

**Change:** Treat saving as advancing the saved baseline and active path without reloading the editor. Preserve selection, scope, locks, history, and viewport. Make “Reset edits” explicitly mean return to the most recent saved baseline, and keep dirty-state comparison correct across Undo and Redo.

**Acceptance test:** Edit → save → continue editing → undo across the save boundary → redo. Check selection and locks survive, the saved file stays unchanged by Undo, and dirty/clean status agrees with the current saved baseline. Existing workspace-save tests assert saved bytes and the selected file, but not continuity of editing state.

### 2. Make the canvas and previews tell the truth

**High priority; reproduced; small-to-medium effort.** “Dark” changes the surrounding stage to `rgb(39,39,38)` while the board behind the SVG remains white. A user cannot use that control to judge transparent artwork on dark. The canonical 1024×640 SVG is also presented inside a square board with fixed padding. The SVG is not necessarily distorted, but the board misrepresents its output boundary and wastes working space.

Evidence: `src/client/styles.css:109`–125 and `src/client/main.ts:2063`. [Screenshot](ux-testing-ci-assets/dark-preview.png) shows the dark surround, white board, and contradictory saved status described below.

**Change:** Use the SVG's actual aspect ratio and visibly distinguish document bounds from the pasteboard. Apply Light/Dark/Transparency to the preview surface behind transparent SVG content, including small-size previews. Explain when an authored background rectangle covers that surface. Separate “Fit document” from “Fit artwork”; avoid suggesting that 100% means native SVG pixels unless it actually does.

**Acceptance test:** Transparent white and dark marks, wide and tall SVGs, and an SVG with an explicit background. Verify both the rendered result and unchanged exported bytes. Add full-surface visual checks, not just CSS class assertions.

### 3. Complete the common multi-selection actions

**High priority; reproduced; medium effort.** Select Seatify title and Shift-select Seatify tagline: the inspector says “2 layers,” but Fill, Delete, Duplicate, and Hide are disabled. Opacity and stroke-width controls are also single-selection-only in source. Collective movement, resize, and rotation already exist, so these restrictions are surprising.

Evidence: `src/client/canvas/editor.ts:3393`; [two-layer selection](ux-testing-ci-assets/multi-selection.png).

**Change:** Add atomic bulk fill/stroke/opacity, delete, duplicate, and visibility actions. Show “Mixed” when values differ. Preserve the existing all-or-nothing protection for locked targets and pending review. Do not silently recolor a group's descendants when the intended operation is to set an inherited group attribute; make that distinction visible.

**Acceptance test:** Two siblings, selections spanning transformed parents, mixed inherited/explicit paint, and a selection containing a locked node. Each successful action is one undo step, and rejection changes nothing. Follow with a save/reopen check.

### 4. Give agents a complete, usable creation-and-correction handoff

**High priority; source evidence and exercised CLI; medium-to-large effort.** The public contract is provider-neutral, but it requires an existing open SVG, fresh context, an artifact file, and hand-authored operation JSON. The initial UI only tells people to choose an SVG. There is no visible start-a-logo or send-this-selection-to-my-agent flow.

The public context contains layer IDs, names, types, and locks, but no hierarchy, selection, geometry, paint, or current unsaved SVG. The private manifest is similarly sparse. A producer reading the source file can therefore miss manual corrections in the live document. `src/shared/agent-protocol.ts:140` and `src/cli/index.ts:167` establish the available context.

There is a second contract trap: `submit --artifact` validates the artifact, but only the proposal operations determine the delivered edit. The artifact's contents are not automatically inserted or compared to the proposal (`src/cli/index.ts:330`). A perfectly valid generated SVG can accompany a proposal that changes something entirely different. This is a usability/contract concern, not evidence of bypassed transaction validation.

**Change:** Offer a clear entry path: create/import a concept → connect an agent → select a target and state intent → review → continue from the saved result. Provide a versioned machine-readable operation schema and local proposal validation with examples. Make artifact-driven submission explicit, for example by selecting and validating a named group to add/replace, or clarify/remove the redundant artifact requirement for operations such as paint.

Add an explicitly requested local snapshot export bound to the current revision, including selected IDs and hierarchy, so an agent can preserve unsaved work. Keep ordinary context redacted and keep credentials out of it. Add bounded transform/text operations so “move this 4 units” or “change the tagline” does not require replacing a whole subtree. Retain stale-revision checks.

**Acceptance test:** A provider-neutral producer constructs a nontrivial named group with local resources; the human adjusts it; the producer reads an authorized current snapshot and makes a narrow follow-up without erasing that adjustment; accept/save/restart/reopen proves the final result. Do not count a rename-only proposal as coverage of logo construction.

### 5. Make review a visual decision and support useful rejection feedback

**Medium-high priority; reproduced/source evidence; medium effort.** Isolated preview and computed operation evidence are good foundations. Today comparison requires toggling accepted/proposed surfaces, and the only terminal choices are Revert and Accept all. There is no structured “keep the shape, revise the lettering” handoff. A mutation also locks editing until the decision resolves.

**Change:** Provide synchronized before/after or overlay comparison, consistent small-size checks, a compact visual change summary, and an obvious “Reject and request revision” action. Keep detailed protocol evidence expandable. Label the mutating approval “Accept and save,” since that is what it does. Keep atomic acceptance initially; arbitrary partial acceptance of dependent SVG operations is a much larger design problem.

The CLI also flattens validation failures to generic messages and combines stale/conflict/timeout (`src/cli/index.ts:317`). Preserve safe structured error codes and operation IDs, with bounded suggested recovery, so producers can correct a proposal without guessing or resubmitting blindly.

**Acceptance test:** Judge a real geometry change, not eleven renames of one layer; reject with a reason; preserve the accepted document; receive a revised proposal against fresh context. Verify review and cancel/recovery controls remain reachable in narrow windows.

### 6. Unify saved, dirty, connection, and recovery messaging

**Medium-high priority; reproduced; small-to-medium effort.** After the successful agent acceptance, the lifecycle banner said Saved, Save was disabled, and the footer said “Unsaved manual corrections.” The result was durably saved and digest-verified; the problem is inconsistent UI reporting.

`finishAgentReview` updates the saved baseline and lifecycle banner without consistently replacing the footer status left by intermediate editor callbacks (`src/client/main.ts:905`). The screenshot under item 2 captures the contradiction.

**Change:** Derive the persistent document status from one state model. Separate transient operation messages from persistent saved/dirty/connection state. Include a concise saved version name and reveal the full path only on demand.

**Acceptance test:** After manual save, agent accept, Undo, Redo, failed save, and reconnect, every visible status and enabled action agrees. Extend the existing durable-save browser scenario, which currently checks the review status and Save button but misses the footer.

### 7. Reduce selection and inspector friction

**Medium priority; observed layout/source evidence; medium effort.** At 1280×720, long accessible layer names wrap into tall rows, while the layer list is capped at 34vh/260px. Layers, selection controls, and previews share a scrolling sidebar; important paint/text/geometry controls and small-size checks move below the fold. The toolbar wraps to two rows. Responsive panels do work at the inspected smaller sizes, but that is not the same as efficient editing.

**Change:** Use resizable panels, compact layer rows with the full name available on focus/hover, and clearer hierarchy navigation. Give selection and relevant properties a stable location. Use plain X/Y/Width/Height/Rotation labels, with coordinate-frame details in help. Move stroke width and opacity into appearance controls. Surface selection mode and snapping near the canvas, instead of relying on remembering left Control/M/Alt/group-scope rules. Keep advanced shortcuts available.

**Acceptance test:** Find one seat in a 44-layer mark, select three seats, recolor and align, edit the tagline, and inspect at 16px without losing the selection or repeatedly opening help. Include keyboard-only operation, long names, 200% browser zoom, and both expanded and collapsed panels.

### 8. Preserve manual drafts and help users finish a usable logo

**Medium priority; source evidence; separate medium-sized increments.** Ordinary workspace restoration stores UI state, not unsaved manual SVG. `beforeunload` warns, while pending agent proposals have much richer recovery; `writeAgentDraft` is used for failed provisional agent acceptance. This leaves a weaker recovery story for manual work. Evidence: `src/client/session-restoration.ts:1`, `src/client/main.ts:1005`, `src/client/main.ts:2047`.

Add bounded local manual-draft recovery with clear restore/discard choices, source identity checks, and no silent overwrite. Test crash/reload recovery and a changed source file.

Separately, add a finishing flow for named SVG versions, mark-only and wordmark variants, light/dark checks, and PNG/favicon exports. The present small-size previews and save-as-iteration are useful but do not constitute a finished asset-delivery workflow. Start with named versions and export of existing selected content; defer path drawing, Boolean operations, font outlining, and a full asset-management system until user evidence supports them.

## Testing and CI: preserve the strengths, close the blind spots

The pipeline is substantial. PR/main CI checks type safety, unit/integration behavior, build, production dependency audit, Chromium, Firefox/WebKit smoke paths, and clean package installation on Ubuntu/macOS. Publishing has candidate validation, a protected publish stage, postpublish checks, and dispatch of exact-version registry QA. The current observed run is green. Do not replace this with a smaller cosmetic smoke suite.

The gaps are about what success means:

| Gap | Concrete improvement | Gate placement |
| --- | --- | --- |
| Feature assertions can miss editing continuity | Add manual save/undo continuity and the complete manual→agent→manual journey | Every PR |
| Main browser coverage centers on Seatify fixtures | Add a small curated corpus: monochrome, wide/tall, inherited styles, gradients/masks/use, text-heavy, unnamed layers, empty and unsupported input | Small representative set on PRs; broader corpus periodically |
| Only one screenshot assertion exists, on a selection halo | Add canonical canvas/inspector/review/light-dark visual assertions with pinned fonts and fixed viewports | Every PR for the small deterministic set |
| Installed CLI scenario primarily focuses/renames | Exercise structural add/replace with resources, manual correction, second proposal, and durable reopen | Every PR or candidate gate if cost warrants |
| Firefox/WebKit smoke only opens, renames, and undoes | Add drag, resize/rotate, text/paint, save, and review/reconnect critical journeys | Candidate gate; broaden PR set based on support policy |
| Accessibility smoke checks names and labels, not complete usability | Add an established automated accessibility check plus focus order, keyboard layers, dialog escape/focus return, zoom and contrast checks | Automated subset on PRs; manual assistive-technology checks for releases |
| Some tests inspect source strings or disconnected snapshots | Replace behavior-critical examples in `tests/client-ux.test.ts:116` and `:466` with mounted behavior/browser assertions | Incrementally when modifying those features |
| Browser diagnostics only report title/project/status | Keep redacted default reporting; add durations/counts and safe error categories, plus opt-in rich artifacts strictly for the public-fixture harness | CI harness improvement |
| No measured large-document interaction budget found | Measure load, selection, drag, layer filtering, and preview update costs on 100/500/1000-layer fixtures before setting thresholds | Periodic benchmark initially |
| UI coordination is concentrated in two large files | Extract save/lifecycle and layer/inspector rendering seams while implementing the above fixes | Alongside feature changes, not a rewrite |

`tests/client-ux.test.ts` contains both useful controller tests and weaker source-string checks. One “does not alter an editor-state snapshot” test compares a standalone object the controller never receives. This is not proof that the real editor preserves state. Do not treat all 548 tests as equally strong evidence of UX quality.

The browser reporters intentionally suppress rich diagnostics. `playwright.config.ts` disables traces/screenshots; `tests/e2e/release/sanitized-reporter.ts` records failure title/project/status; successful outputs are removed. This protects sensitive local content but makes failures harder to diagnose. Rich artifacts should remain unavailable for arbitrary user workspaces. A public-fixture-only, explicit diagnostic mode can improve debuggability without collecting private logos or credentials.

CI currently uses Node 22 even though the package declares `>=22`. Add a supported newer-Node compatibility job once the intended support range is agreed. Cancellation of superseded PR CI runs is a reasonable efficiency improvement; sharding, blanket retries, and broad coverage-percentage targets are not the highest-value next work. No branch-protection configuration was inspected, so green jobs here are not evidence that all jobs are required for merging.

## Suggested delivery sequence

1. **Trust and continuity:** manual save preserves history/context; one consistent saved/dirty status; true light/dark/transparency previews and correct document bounds. Add behavioral and visual regressions with each fix.
2. **Everyday correction:** atomic multi-selection appearance/actions; stable inspector and compact layers; clearer selection controls. Keep the existing geometric safety invariants.
3. **Agent iteration:** schema/validation and actionable errors; deliberate current-document snapshot handoff; artifact-driven structural submission; visual comparison and revision feedback. Gate a complete mixed human/agent journey.
4. **Finish and learn:** manual recovery, named versions/exports, broader SVG corpus, performance measurements, and independent usability evaluation.

Measure task completion, unaided time to first accepted saved concept, number of selection retries, manual corrections accidentally replaced by a follow-up proposal, and successful reopen/export. Set targets after obtaining a baseline. The existing cohort protocol checks a narrow install/review/save path; extend evaluation to real design corrections and logo construction rather than inferring usability from protocol success. No participant outreach or feedback collection was performed for this audit.

The first deliverable should be sequence item 1. It directly addresses reproduced problems, is bounded, and makes every subsequent manual and agent workflow easier to trust.
