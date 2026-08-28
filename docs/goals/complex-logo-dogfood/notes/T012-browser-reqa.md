# T012 targeted browser re-QA

Run date: 2026-08-27
Client: current T011 bundle on `http://complex-seatify-qa.localhost:5174/`
Disposable workspace: `/tmp/lineage-logo-complex-qa2.83hTAY`
Fixture SHA-256: `c374e51fee2094d46a3cb44bc308062a1dde4d94cc31ee46d6e892188e80f0f8`
Agent session: `49fe4eb9-8853-4335-9655-4d6ecd0da81b`

`full_outcome_complete: false` — a real-browser dirty-state defect remains and must be fixed before restoration.

## Clean setup

A second disposable server was started while the older unsaved Seatify tab remained untouched. The new editor selected port 5174 and API port 4283. It reported `Agent connection ready`, proving a clean single-owner session without closing, reloading, or overwriting the user's older tab.

Opening state was exact and clean: Undo, Redo, Reset edits, and Save iteration-1 were all disabled. The live SVG baseline was captured with transient `data-lineage-key` attributes excluded from comparison.

## Complete 18-checkpoint sequence

The browser executed these atomic mutations in order:

1. Nudge ticket ribbon wrapper right 1.
2. Nudge ticket stub wrapper right 1.
3. Nudge west table cluster right 10.
4. Nudge west table cluster right 1.
5. Nudge west table cluster right 1.
6. Set east table cluster Rotation to exactly 4 degrees.
7. Set stage zone Scale to exactly 96% through Geometry / Scale %.
8. Set left stage light fill to `#ff9f1c`.
9. Set center aisle opacity to `0.55`.
10. Set venue caption to `Venue plan · doors 7:30 PM`.
11. Duplicate the ticket accent star.
12. Move the copy one paint-order position earlier.
13. Align the three selected west seats on their vertical middle.
14. Group those seats.
15. Rename the group `West priority seats`.
16. Ungroup it.
17. Hide the left entrance marker.
18. Show the left entrance marker.

After every edit, Undo, Reset edits, and Save were enabled and Redo was disabled. The exact transforms were `matrix(0.9975640502598242,0.0697564737441253,-0.0697564737441253,0.9975640502598242,470,334)` and `matrix(0.96,0,0,0.96,161.76,101.84)` for rotation and scale respectively.

## Undo/redo and dirty controls

- Undo steps 1–17: Undo, Redo, Reset, and Save were enabled, as expected while edits remained.
- Undo step 18: Undo disabled and Redo enabled, but Reset and Save incorrectly remained enabled.
- Clearing nested selection/scope with Escape did not alter the dirty controls.
- Redo steps 1–17: Undo, Redo, Reset, and Save were enabled.
- Redo step 18: Undo, Reset, and Save remained enabled; Redo disabled.

The origin divergence is exact and bounded. After selection handles were removed, the origin and opening live SVG strings were both 7,077 characters. They differed only in root namespace attribute order:

- Opening: `xmlns`, `viewBox`, `role`, `aria-label`, `version`, `xmlns:xlink`
- Undo origin: `xmlns`, `xmlns:xlink`, `viewBox`, `role`, `aria-label`, `version`

Reordering only `xmlns:xlink` in the detached comparison string made the documents exactly equal. Thus the browser's snapshot restore reparses the root and changes namespace attribute order, while the dirty comparator treats that serialization-only order change as a document edit. This explains why the happy-dom regression passed and the real browser stayed dirty.

## Duplicate-label proof

T011's duplicate naming passed in the browser:

- Original: `accent-star` / `Ticket accent star`
- Copy: `accent-star-copy-43` / `Ticket accent star copy`

Undo to origin removed the copy. Redo checkpoint 11 restored the same distinct label and ID; redo checkpoint 12 restored the earlier paint order. The source label was unchanged.

## Agent review proof

Using the public logo-designer adapter and the clean single-owner session:

1. `qa-reject-1` proposed replacing only `Seatify tagline` with text `EVERY GUEST CONNECTS` and fill `#33245f`. The review named one affected layer. Revert returned producer outcome `reverted`; the existing text, fill, manual caption, and manual dirty state remained unchanged.
2. `qa-accept-1` staged the same bounded proposal. Accept all returned producer outcome `accepted` with authoritative revision 55. The tagline became `EVERY GUEST CONNECTS` with fill `#33245f`.
3. Manual correction changed the text back to `EVERY SEAT CONNECTS` while retaining fill `#33245f`. Undo and Save remained available and status reported `Updated text content`.

No insertion operation was requested or accepted. Console warning/error output was empty.

## Residual defect matrix

### R1 — Namespace attribute reordering keeps undo origin dirty

- Severity: High correctness/UX defect
- Reproduction: load the complex fixture in a real browser, complete the 18 checkpoints, undo all 18.
- Expected: exact semantic origin clears dirty state and disables Save/Reset.
- Observed: the browser restore moves `xmlns:xlink` earlier in root attribute order; Undo disables but Save/Reset stay enabled.
- Evidence: equal 7,077-character live SVG strings become byte-identical when only the namespace declaration order is normalized.
- Required fix boundary: make baseline dirty comparison insensitive to semantically irrelevant XML namespace declaration order, or preserve canonical root attribute order through snapshot restore. Do not ignore other attribute order or hide actual SVG divergence without explicit deterministic serialization proof.

No residual duplicate-label, history-loss, selection, resource-reference, agent-review, or console defect was found in this targeted pass.
