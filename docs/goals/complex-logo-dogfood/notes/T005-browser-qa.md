# T005 adversarial browser QA

Run date: 2026-08-27T17:36:24Z
Commit: `2581057c545f9e71d63f28ba0e2e839387dae8f5`
Editor URL: `http://complex-seatify.localhost:5173/`
Disposable workspace: `/tmp/lineage-logo-complex-qa.fZzN3e`
Source SHA-256: `c374e51fee2094d46a3cb44bc308062a1dde4d94cc31ee46d6e892188e80f0f8`
Saved iteration: `/tmp/lineage-logo-complex-qa.fZzN3e/iterations/iteration-1.svg`
Saved SHA-256: `2ab6514a9d1b373d0224ebdb7f994b108fd44c05fbdac4dab6a3a7aadf9a61fd`

`full_outcome_complete: false` — versioned reload/server-restart restoration remains a later goal task.

## Walkthrough transcript

| Checkpoint | Result | Evidence |
| --- | --- | --- |
| Load and structure | Pass | The editor loaded 42 selectable, meaningfully named layers. The six-level `Venue logo / Venue mark / Seating map / Table clusters / West table cluster / West north seat` ancestry was visible and selectable. |
| Layer search | Pass | `seat` exposed seating and Seatify substring matches; `ticket` exposed the ticket branch and both stars after duplication; `aisle` exposed the three named aisle paths. Clearing search restored the full tree. |
| Tree disclosure/navigation | Pass | Venue, seating, ticket, and wordmark branches collapsed and expanded without changing serialized SVG markup. |
| Exact deep selection | Pass | `West north seat` selected exactly and exposed its full ancestry, fill `#21183e`, stroke `#fff`, opacity `1`, and stroke width `4`. |
| Sibling multi-select | Pass | Shift-selecting west north/east/south produced `3 layers`; alignment and grouping enabled. Adding `East north seat` was rejected with `Shift-select is limited to direct siblings in the active scope`; the seating subtree remained byte-identical. |
| Resource-backed leaves | Pass | `Clipped ticket ribbon` and `Masked ticket stub` were selectable with zero direct transform boxes, as designed. Their wrapper groups each exposed a transform box and accepted a nudge. `url(#ticket-ribbon-clip)`, `url(#ticket-gradient)`, and `url(#ticket-stub-mask)` remained intact. |
| Move | Pass | `West table cluster` moved 12 units using Shift+Right, Right, Right. Keyboard granularity created three history entries. |
| Rotate | Pass | Dragging the visible rotation control produced exactly 4 degrees: `matrix(0.997564,0.069756,-0.069756,0.997564,470,334)`. |
| Resize | Pass with walkthrough adjustment | Dragging the corner handle produced a proportional `0.973381` scale. Exact 96% is available through the collapsed Geometry / Scale % field; future exact walkthrough runs should use that field rather than estimate with the pointer. |
| Paint and opacity | Pass | `stage-light-left` became `#ff9f1c`; `aisle-center` opacity became `0.55`. Paint applies live; text commits on Enter/change. |
| Text | Pass | `venue-caption` committed as `Venue plan · doors 7:30 PM`. |
| Duplicate and reorder | Pass with UX finding | The copy received unique ID `accent-star-copy-43` and moved one sibling earlier. Both rows retained the same visible/accessibility label, `Ticket accent star`. |
| Align/group/rename/ungroup | Pass | Vertical-middle alignment added reversible transforms; grouping preserved three child IDs and order; the neutral group renamed to `West priority seats`; ungroup restored `west-seat-north`, `west-seat-east`, `west-seat-south` in relative order. |
| Hide/show | Pass | `Entrance left marker` hid and showed through the inspector and remained present. |
| Undo to origin | Functional pass; dirty-state defect | Nineteen undo checkpoints restored all sampled original transforms, paint, opacity, text, star count, clip, and mask references. Undo disabled and Redo enabled at origin, but Save and Reset edits incorrectly remained enabled. |
| Full redo | Pass | Nineteen redo checkpoints restored the post-edit state exactly. No resource reference was stripped or retargeted. |
| Save/reopen | Pass | Save created only `iterations/iteration-1.svg`; the source copy retained its original SHA-256. Reopen produced 43 layers, unique IDs, preserved hierarchy, edits, labels, and all local resources. The saved file contains no `data-lineage-*`, agent/review/transport metadata, transaction IDs, API origins, or tokens. |
| Agent reject/accept/manual correction | Blocked by safe-recovery UX | This QA tab reported `Another Lineage tab owns the agent connection. Close that tab before retrying here.` The owning Seatify tab had unsaved edits and a disconnected preview, so closing/reloading it would risk user work. No unsafe takeover was attempted. |
| Page reload (pre-restoration baseline) | Expected fail | Before reload: `iteration-1`, `Venue caption`, 125% zoom, Dark background, left panel collapsed, right panel open, clean state. After reload: no document, no selection, 100% zoom, Grid background; left/right panel preferences persisted. This is the known absence that T009 must solve. |

## Defect and UX-friction matrix

### D1 — Undo-to-origin remains dirty

- Severity: High correctness/UX defect
- Reproduction: open the fixture; make the mixed edit sequence; undo until Undo disables.
- Expected: when the current SVG equals the opening snapshot, dirty state clears, Save disables, and Reset edits disables.
- Observed: sampled SVG state returned to the opening values and Undo disabled, but Save iteration and Reset edits remained enabled.
- Evidence: opening and fully-undone screenshots matched visually; restored values were west/east/stage original transforms, `#ffd166`, opacity `0.72`, original caption, one star, and intact resource references; the controls still advertised unsaved work.
- Candidate package: make dirty state derive from a stable baseline/history position rather than a one-way mutation flag; add editor and browser coverage for undo-to-baseline and redo-away-from-baseline.

### D2 — Agent connection ownership has no safe handoff

- Severity: High workflow blocker for agent/canvas dogfooding
- Reproduction: retain an older local editor tab with unsaved work, then open the disposable QA editor in a second tab.
- Expected: a non-destructive recovery option such as `Use this tab`, with explicit handling of the prior tab's unsaved/pending state, or a read-only explanation that identifies the owning session and preserves both documents.
- Observed: the new tab only says to close the other tab. The owner showed unsaved Seatify edits plus `Preview disconnected`, so obeying that instruction would risk losing work.
- Evidence: QA status text `Another Lineage tab owns the agent connection. Close that tab before retrying here.`; owner tab status `Agent connection ready` and disconnected preview/review state.
- Candidate package: bounded ownership-transfer UX and tests, or a scoped per-workspace/per-origin connection identity. Judge should decide whether this belongs in the current restoration slice or a follow-up.

### D3 — Duplicated layers are visually indistinguishable in the tree

- Severity: Medium UX friction
- Reproduction: select `Ticket accent star`, click Duplicate.
- Expected: the copy remains semantically related but can be distinguished without inspecting serialized IDs, for example `Ticket accent star copy`.
- Observed: IDs are safely unique (`accent-star`, `accent-star-copy-43`), but both tree rows and accessible names are `Ticket accent star`.
- Evidence: the post-duplicate ticket branch contained two identical visible labels while the DOM IDs differed.
- Candidate package: deterministic, collision-safe copy naming that updates `aria-label` without changing author-specified names unnecessarily; add duplicate-name tests.

### F1 — History granularity is technically correct but conceptually noisy

- Severity: Low UX friction
- Reproduction: create a 12-unit move with Shift+Right, Right, Right and include hide/show plus wrapper checks.
- Expected: the walkthrough's conceptual operations and Undo count are easy to reconcile.
- Observed: the run required 19 undo/redo checkpoints because keyboard nudges and hide/show are each independent history entries. State fidelity was exact.
- Candidate package: no required product fix. Update the walkthrough to record actual history checkpoints, or consider gesture coalescing only if user testing finds the current model surprising.

## Console and performance observations

- Browser warning/error log after the edit, save, reopen, and reload sequence: empty.
- No visible interaction lag, missed pointer gesture, corrupt repaint, or tree stall occurred at 42 layers or 43 layers after duplication.
- Vite reported ready in 78 ms. Browser timing APIs were not used as a release gate; the relevant oracle is interaction correctness under the stress asset.
- The duplicate-label ambiguity and collapsed inspector sections created more navigation cost than rendering performance did.

## Prioritized fix candidates

1. Fix baseline-aware dirty tracking (D1) as the first coherent Worker package.
2. Add deterministic duplicate naming (D3) in the same package only if Judge finds the shared selection/history surface safe; otherwise keep it as a separate small slice.
3. Judge the agent-ownership recovery boundary (D2) against the planned versioned restoration design before implementation; do not solve it by silently closing or overwriting another tab.
4. Amend the walkthrough to use Geometry / Scale % for exact 96% and to record actual history checkpoint count (F1).
