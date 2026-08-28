# T015 post-fix browser recheck

Run date: 2026-08-27
Client: current T014 bundle at `http://complex-seatify-fix.localhost:5175/`
Disposable workspace: `/tmp/lineage-logo-complex-fix.Y6eMkW`
Fixture: `concepts/complex-seatify.svg` (42 named layers)

`full_outcome_complete: false` — T015 proves the dirty-comparison repair; restoration and the final oracle remain later tasks.

## Exact edit sequence

The browser repeated T012's 18 atomic mutations in order: ribbon wrapper +1, stub wrapper +1, west cluster +10/+1/+1, east cluster rotation 4°, stage scale 96%, stage-left fill `#ff9f1c`, center-aisle opacity `0.55`, caption `Venue plan · doors 7:30 PM`, star duplicate, copy one position backward, west-seat middle alignment, group, rename `West priority seats`, ungroup, entrance-left hide, and entrance-left show.

After each edit checkpoint 1–18, Undo, Reset edits, and Save were enabled while Redo was disabled. The edited values were exact:

- East transform: `matrix(0.9975640502598242,0.0697564737441253,-0.0697564737441253,0.9975640502598242,470,334)`
- Stage transform: `matrix(0.96,0,0,0.96,161.76,101.84)`
- Light fill / aisle opacity / caption: `#ff9f1c` / `0.55` / `Venue plan · doors 7:30 PM`
- Duplicate count: 1; clipped ribbon and masked stub references remained `url(#ticket-ribbon-clip)` and `url(#ticket-stub-mask)`.

## All 18 undo boundaries

For undo boundaries 1–17, Undo, Redo, Reset edits, and Save were all enabled. At undo boundary 18, the exact state was:

| Boundary | Undo | Redo | Reset | Save |
| --- | --- | --- | --- | --- |
| 18 / origin | disabled | enabled | disabled | disabled |

Origin values matched the opening fixture: west/east/stage transforms returned to `translate(226 334)`, `translate(470 334)`, and `translate(154 100)`; fill returned to `#ffd166`; opacity returned to `0.72`; caption returned to `Venue plan · doors 7 PM`; and the duplicate count returned to zero. All gradient, clip, and mask references remained intact.

After removing only the transient selection overlay and `data-lineage-key` attributes, the opening and undo-origin live SVG serializations were both 7,077 characters. Their SVG bodies were byte-identical, their non-namespace root attributes remained in the same order, and both `xmlns:xlink` declarations had the same URI. The sole byte difference was the position of that root namespace declaration. The repaired comparator therefore correctly treated the origin as clean without changing saved bytes.

## All 18 redo boundaries

For redo boundaries 1–17, Undo, Redo, Reset edits, and Save were all enabled. At redo boundary 18, the exact state was:

| Boundary | Undo | Redo | Reset | Save |
| --- | --- | --- | --- | --- |
| 18 / edited | enabled | disabled | enabled | enabled |

The redone transform, paint, opacity, text, duplicate count, clip reference, and mask reference exactly matched the captured post-edit checkpoint.

## Diagnostics and residual findings

The tab reported no warning or error console entries; only Vite connection debug messages were present. No duplicate-label, resource-reference, history, selection, or dirty-control regression appeared. The namespace-order false dirty state is fixed in the real browser. T012's already-passing agent boundary was not reopened because T014 did not modify proposal or transport behavior.
