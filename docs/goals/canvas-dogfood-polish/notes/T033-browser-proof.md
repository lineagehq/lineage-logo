# T033 headed-browser proof — BleepThat iteration 13/16

- Timestamp: `2026-08-25T20:54:25Z`
- Browser: headed Google Chrome `151.0.7922.174` on macOS; clean-console recheck in headed extension-free Chromium `138.0.7204.15`
- Editor/API: `http://127.0.0.1:5173/` / `http://127.0.0.1:4173/`
- Workspace: `/Users/neonwatty/Desktop/bleepthat-logo-dogfood/logos`
- Source: `iterations/iteration-13.svg`
- Saved proof artifact: `iterations/iteration-16.svg`

## Disclosure proof

The Chrome accessibility tree directly captured all four required transitions; none relies on source inspection:

1. With `wordmark-primary` singly selected, all five inspector details were opened. Organization, Alignment, Paint, Text, and Geometry each exposed their controls.
2. Shift+Enter on the adjacent `wordmark-highlight` layer created a two-layer selection. All five details remained open and Alignment changed to enabled multi-selection controls.
3. All five details were closed while the two-layer selection remained active. The tree showed exactly five collapsed summaries: `2 layers`, `2 selected`, `Fill #FFD600 · stroke inherited`, `Unavailable`, and `Opacity 1 · stroke default`.
4. A normal click restored single selection on `wordmark-primary`. All five details stayed closed while summaries updated to `text`, `Select 2+`, `Fill inherited · stroke inherited`, `BLEEPED · 96`, and `Opacity 1 · stroke default`.

The same revision has executable automated coverage for all-open/all-closed crossed with single/multi selection; it snapshots every `HTMLDetailsElement.open` bit before the selection-summary update and asserts byte-for-byte state equality afterward.

## Alias no-op, cancel, undo, and redo proof

On `wordmark-secondary`, Chrome committed the real control path from weight `800` to `bold`, then entered alias `700`. A single Undo returned directly to `800`, disabled Undo and Save, and enabled Redo, proving `700` did not create a second checkpoint. The same sequence with `normal` then `400` also returned directly to clean `800` after one Undo. Selection and the active wordmark drill scope remained intact.

Typing temporary content `TEMPORARY` and pressing Escape restored `THAT SH*T!` without enabling Undo or Save. On `wordmark-primary`, committing `BLEEPED!` created one checkpoint; Undo restored `BLEEPED` and a clean document, and Redo restored `BLEEPED!`. Saving created iteration 16 and automatically reopened it with Undo, Redo, and Save disabled. Explicitly reopening iteration 13 showed `BLEEPED`; explicitly reopening iteration 16 showed `BLEEPED!`.

## Target, fallback, hash, diff, and console proof

The live `#icon`, explicit `#wordmark`, and missing-target fallback each rendered accessible images at exactly 64, 32, and 16 px. Status text was respectively `Previewing #icon.`, `Previewing #wordmark.`, and `Whole SVG fallback: #missing is missing.`. Preview switching did not enable Undo or Save.

Disk and `/api/svg` SHA-256 values match exactly:

- iteration 13 disk/API: `e597a6e56b195284a2a73052be87174770f19f3d36fd3c4ae041bc5957b142fa`
- iteration 16 disk/API: `d9772e614199281e1351b337b2b5ebf345e295ecc792dfffa23094b5799b0b72`

The iteration 13 → 16 unified diff contains exactly one change: `wordmark-primary` text content `BLEEPED` → `BLEEPED!`.

The ordinary Chrome profile injected only its installed extension's `Unchecked runtime.lastError: Could not establish connection` messages; no Lineage exception or warning appeared. The final extension-free headed Chromium recheck repeated iteration-16 open, `bold`→`700` one-checkpoint Undo, and `#missing`→`#icon` 64/32/16 preview transitions. DevTools then reported `0 messages in console` with the app clean and Save disabled.

## Automated gates at the same revision

- `npm run check` — pass
- `npm test -- --run tests/editor-serialization.test.ts tests/fidelity.test.ts tests/client-ux.test.ts` — pass: 131 tests
- `git diff --check` — pass

The adversarial tests retain every earlier structured-text, numeric/case/quote/whitespace no-op, escaped/commented external-font, hidden/collapsed/calculated-zero fallback, transitive styled-reference, and disclosure regression. New cases cover both directions and signed/exponent spellings of `bold`/`700` and `normal`/`400`, real editor history/dirty/selection/scope invariants, and fixed-point custom-property references on every newly retained ancestor through the root while excluding unrelated branches.
