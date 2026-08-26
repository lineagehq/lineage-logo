# T029 Chrome proof — BleepThat iteration 13

- Timestamp: `2026-08-25T20:19:48Z`
- Browser: real connected Google Chrome, session `🧪 BleepThat iteration 13 proof`
- Editor/API: `http://127.0.0.1:5173/` / `http://127.0.0.1:4173/`
- Workspace: `/Users/neonwatty/Desktop/bleepthat-logo-dogfood/logos`
- Source opened: `iterations/iteration-13.svg`

## Preview and state snapshots

Iteration 13 loaded cleanly with selection `None`, Undo/Redo/Save disabled, target `#icon`, and status `Previewing #icon.`. The accessible image labels were `64px #icon preview`, `32px #icon preview`, and `16px #icon preview`. Changing the target to `#wordmark` produced status `Previewing #wordmark.` and the corresponding 64/32/16 labels. Returning to `#icon` restored the original status and labels. Preview switching did not change selection or enable history.

For `wordmark-primary`, the numeric-normalized font-size no-op `096.000` against `96` left Undo disabled, selection `wordmark-primary`, preview state, and all inspector disclosure states unchanged. Invalid font size `-1` announced `Font size must be greater than 0 and at most 1000.` and left Undo disabled. Typing temporary content and pressing Escape restored `BLEEPED`, announced `Canceled the text edit`, and left Undo disabled.

## Inspector disclosure proof

All five inspector details (`organization`, `alignment`, `paint`, `text`, and `geometry`) were closed together. Changing from single `wordmark-primary` to single `wordmark-highlight` and then Shift-selecting the two siblings left every details element closed while summaries updated (`text` → `rect` → `2 layers`, `Select 2+` → `2 selected`, and text/paint values updated).

All five details were then opened together. Changing from the two-layer selection to single `wordmark-secondary` and back to a two-layer selection left every details element open while summaries again updated. No selection transition overrode disclosure state.

## Six-step undo and redo

Six separate committed text operations on `wordmark-primary` produced: content `BLEEPED!`, font size `97`, weight `700`, family `Arial Black, sans-serif`, anchor `end`, and letter spacing `-2`. Selection remained `wordmark-primary` throughout.

Six Undo clicks restored one field per click in reverse order:

1. spacing `-2` → `-3`
2. anchor `end` → `middle`
3. family `Arial Black, sans-serif` → `Arial, sans-serif`
4. weight `700` → `800`
5. size `97` → `96`
6. content `BLEEPED!` → `BLEEPED`

At the sixth undo, Undo was disabled and Redo enabled. Six Redo clicks reapplied the same six states in forward order, ending at the exact edited values with Redo disabled.

## Save, reopen, console, and artifact checks

The edited document saved as `iterations/iteration-14.svg`; the app reopened it automatically with history clean. Explicitly opening iteration 13 restored its exact original text values, and explicitly reopening iteration 14 restored the six edited values exactly. The `#icon` 64/32/16 preview remained active after save/reopen. Chrome console warnings/errors: `[]`.

Disk and `/api/svg` SHA-256 matched:

- iteration 13 disk/API: `e597a6e56b195284a2a73052be87174770f19f3d36fd3c4ae041bc5957b142fa`
- iteration 14 disk/API: `bc9608371c79abc182db6f77dbb260abe7f022e2b0c52e0250136974666a5dbe`

The iteration 12 → 13 diff remained expected-only: only `wordmark-primary` changed, from `BLEEP` at size `108`, weight `900`, spacing `-5` to `BLEEPED` at size `96`, weight `800`, spacing `-3`, local `Arial, sans-serif`, and anchor `middle`. No other SVG line changed.

Automated gates at the same revision: `npm run check` passed 246 tests, typecheck, and production build; the exact targeted gate passed 108 tests; `git diff --check` passed.
