# T031 Chrome proof — BleepThat iteration 13/15

- Timestamp: `2026-08-25T20:38:38Z`
- Post-final-code HMR revalidation: `2026-08-25T20:40:17Z`
- Browser: headed Google Chrome `151.0.0.0` on macOS (`MacIntel`), Playwright session `t031`
- Editor/API: `http://127.0.0.1:5173/` / `http://127.0.0.1:4173/`
- Workspace: `/Users/neonwatty/Desktop/bleepthat-logo-dogfood/logos`
- Source: `iterations/iteration-13.svg`
- Saved proof artifact: `iterations/iteration-15.svg`
- Durable evidence: the observed accessibility labels, state transitions, console totals, hashes, and exact diff are recorded below. Generated Playwright scratch snapshots are intentionally excluded from version control.

## Target and fallback evidence

Iteration 13 opened clean with `#icon` selected and status `Previewing #icon.`. The rendered image boxes and accessible labels were exactly:

- `64px #icon preview` — `64 × 64`
- `32px #icon preview` — `32 × 32`
- `16px #icon preview` — `16 × 16`

Changing to `#wordmark` produced `Previewing #wordmark.` and exact `64 × 64`, `32 × 32`, and `16 × 16` boxes labelled for `#wordmark`. Changing to `#missing` produced `Whole SVG fallback: #missing is missing.` and the same exact box sizes labelled `64px whole SVG fallback preview`, `32px whole SVG fallback preview`, and `16px whole SVG fallback preview`. Returning to `#icon` restored the original status and labels. No preview switch dirtied the document or enabled history.

## Effective no-op, cancel, disclosure, undo, and redo evidence

With `wordmark-primary` selected, a real control-path sequence committed `font-size: 9.6e1`, `font-weight: +8e2`, `font-family: " Arial ,  sans-serif "`, `text-anchor: middle`, and `letter-spacing: -3e0` over the effective values `96`, `800`, `Arial, sans-serif`, `middle`, and `-3`.

The live SVG SHA-256 was identical before and after: `1a4b21f79e903a5259d7c5dfa38ca280c8f099699bdc993a1c2d4420b33a3270`. Undo, Redo, and Save all remained disabled; selection remained `wordmark-primary`. Every disclosure bit remained unchanged: organization open, alignment closed, paint open, text closed, geometry closed. Automated coverage additionally exercises all-open and all-closed disclosure states across single and multiple selection.

Typing temporary content `TEMPORARY` and pressing Escape restored both the control and SVG text to `BLEEPED`, retained the selection, and left Undo and Save disabled.

Committing `BLEEPED!` enabled Undo and Save. Undo restored `BLEEPED`, restored the original live SVG hash `1a4b21f79e903a5259d7c5dfa38ca280c8f099699bdc993a1c2d4420b33a3270`, disabled Undo and Save, and enabled Redo. Redo restored `BLEEPED!`, enabled Undo and Save, and disabled Redo. The differing raw live-DOM hash after redo reflects editor-only interaction attributes; the clean saved artifact comparison below proves the intended single text delta.

## Save, reopen, console, and durable hashes

Save created iteration 15 and automatically reopened it cleanly with Undo and Save disabled. An explicit asynchronous reopen of iteration 13 restored `BLEEPED`; an explicit reopen of iteration 15 restored `BLEEPED!`. Both retained `Previewing #icon.` and the exact 64/32/16 preview sizes. The iteration 13 → 15 disk diff contains exactly one change: `wordmark-primary` text content `BLEEPED` → `BLEEPED!`.

Disk and `/api/svg` SHA-256 values match exactly:

- iteration 13 disk/API: `e597a6e56b195284a2a73052be87174770f19f3d36fd3c4ae041bc5957b142fa`
- iteration 15 disk/API: `d9772e614199281e1351b337b2b5ebf345e295ecc792dfffa23094b5799b0b72`

Final Chrome console query: `Total messages: 2 (Errors: 0, Warnings: 0)`, with zero messages at warning level.

## Automated gates at the same revision

- `npm run check` — pass: 256 tests, typecheck, production build
- `npm test -- --run tests/editor-serialization.test.ts tests/fidelity.test.ts tests/client-ux.test.ts` — pass: 118 tests
- `git diff --check` — pass

The adversarial tests at this revision cover signed/exponent CSS-number equivalence through the real editor path, escaped `@font-face` family/source and `@import`, local-only font acceptance, fixed-point style/reference closure for newly retained nodes, complex `:is(...)` selectors, calculated-zero opacity, escaped selectors/properties/keywords, ancestor/inline/stylesheet hiding, and disclosure preservation.
