# T027 live browser QA

## Environment

- URL: `http://constellation.localhost:5180/`
- Workspace: `lineage-logo-complex-fix.Y6eMkW`
- Fixture: 44-layer complex Seatify constellation
- Final check: `npm run check` passed 20 test files and 384 tests, typecheck, and production build.

## Passed live checks

- Refreshed the page and confirmed the default persistent hint and shortcut copy both describe physical left Control, start-over-artwork/empty-canvas drag, Shift-add, and Control-click exact toggle.
- Built a three-object selection from line layers: the canvas rendered three independent violet halos, Layers exposed three `aria-pressed=true` rows with two secondary rows and one stronger primary row, exactly one blue primary handle set remained, and the sidebar-independent badge read `3 objects selected`.
- With both sidebars collapsed, the complete `3 objects selected` badge remained visible and high contrast.
- At 125% zoom, all three halos, the one primary handle set, and the count badge remained synchronized.
- Turning Enhanced selection outlines off retained three minimal halos. Selecting M updated both shortcut and persistent hint copy. Restore defaults immediately returned both copies to Left Control while preserving clean selection feedback.
- Reload preserved 125% zoom and the restored Left Control preference. Selection-only work left Undo and Save disabled.
- Axis-aligned connection lines visibly retained violet selection feedback.
- Browser logs contained only Vite connection debug entries; there were no warnings or errors.
- Final browser state is reset to 100%, both sidebars collapsed, and zero selection so the owner can perform the physical-key check immediately.

## Driver limitation / required human proof

The in-app browser driver can attach a generic Control modifier to a click or drag, but it does not emit the physical `KeyboardEvent.code === "ControlLeft"` event required by the approved contract. Generic automated Control attempts correctly did not arm the selector. The physical left-Control path is covered by 194 focused tests and independent T029 source review, but the original oracle still requires one real physical-key walkthrough.

Required owner check:

1. Hold the physical left Control key and drag a rectangle around several seats or connection lines, beginning over artwork.
2. Release the pointer before releasing Control.
3. Confirm every enclosed object receives a violet halo, one object retains blue handles, and the badge reports the same count.
4. Repeat while holding Shift to add another region.
5. Confirm ordinary dragging without Control still moves only the chosen object and no native context menu appears during the Control gestures.

Reply exactly `Control-left marquee QA passed` if all five checks pass. If any check fails, report what happened instead so the board can reopen a bounded remediation.
