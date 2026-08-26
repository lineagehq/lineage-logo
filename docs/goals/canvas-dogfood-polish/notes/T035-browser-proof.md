# T035 raw headed-browser proof — BleepThat iteration 13/17

- Chrome timestamp: `2026-08-25T21:08:23.260Z`
- Chrome: headed Google Chrome `151.0.7922.174`
- Chromium timestamp: `2026-08-25T21:09:26.555Z`
- Chromium: headed extension-free Chromium `147.0.7727.15`
- Editor/API: `http://127.0.0.1:5174/` / `http://127.0.0.1:4373/`
- Workspace: `/Users/neonwatty/Desktop/bleepthat-logo-dogfood/logos`
- Source/proof artifact: `iterations/iteration-13.svg` / `iterations/iteration-17.svg`

Both browsers were launched non-persistently by Playwright. Chromium used the bundled executable with no extension or user-data profile. The snapshots below are direct `locator.ariaSnapshot()` and console-event output, not reconstructed from source.

## Raw headed Chrome disclosure/accessibility transcript

```json
{
  "browser": "headed Google Chrome",
  "version": "151.0.7922.174",
  "transitions": [
    {
      "label": "all-open single",
      "open": [true, true, true, true, true],
      "summaries": ["text", "Select 2+", "Fill inherited · stroke inherited", "BLEEPED · 96", "Opacity 1 · stroke default"],
      "aria": "- group:\n  - text: Organization\n  - button \"Lock\"\n  - button \"Send backward\" [disabled]\n  - button \"Bring forward\"\n  - button \"Group\" [disabled]\n  - button \"Ungroup\" [disabled]\n- group:\n  - text: Alignment\n  - button \"Left\" [disabled]\n  - button \"Center\" [disabled]\n  - button \"Right\" [disabled]\n  - button \"Top\" [disabled]\n  - button \"Middle\" [disabled]\n  - button \"Bottom\" [disabled]\n- group:\n  - text: Paint Fill\n- group:\n  - text: Text Content\n  - textbox \"Content\": BLEEPED\n  - text: Font size\n  - spinbutton \"Font size\": \"96\"\n- group:\n  - text: Geometry Stroke width"
    },
    {
      "label": "all-open multi",
      "open": [true, true, true, true, true],
      "summaries": ["2 layers", "2 selected", "Fill #FFD600 · stroke inherited", "Unavailable", "Opacity 1 · stroke default"],
      "aria": "- group:\n  - text: Organization\n  - button \"Lock\" [disabled]\n  - button \"Group\"\n- group:\n  - text: Alignment\n  - button \"Left\"\n  - button \"Center\"\n  - button \"Right\"\n  - button \"Top\"\n  - button \"Middle\"\n  - button \"Bottom\"\n- group:\n  - text: Paint Fill\n- group:\n  - text: Text Content\n  - textbox \"Content\" [disabled]\n- group:\n  - text: Geometry Stroke width"
    },
    {
      "label": "all-closed multi",
      "open": [false, false, false, false, false],
      "summaries": ["2 layers", "2 selected", "Fill #FFD600 · stroke inherited", "Unavailable", "Opacity 1 · stroke default"],
      "aria": "- group: Organization 2 layers\n- group: Alignment 2 selected\n- group: \"Paint Fill #FFD600 · stroke inherited\"\n- group: Text Unavailable\n- group: Geometry Opacity 1 · stroke default"
    },
    {
      "label": "all-closed single",
      "open": [false, false, false, false, false],
      "summaries": ["text", "Select 2+", "Fill inherited · stroke inherited", "BLEEPED · 96", "Opacity 1 · stroke default"],
      "aria": "- group: Organization text\n- group: Alignment Select 2+\n- group: Paint Fill inherited · stroke inherited\n- group: Text BLEEPED · 96\n- group: Geometry Opacity 1 · stroke default"
    }
  ],
  "consoleMessages": [
    {"type": "debug", "text": "[vite] connecting..."},
    {"type": "debug", "text": "[vite] connected."}
  ],
  "pageErrors": []
}
```

The same five native `details` elements remained open across single→multi and closed across multi→single. Summary content changed through the production selection callback; the browser never received a disclosure-state mutation from summary rendering.

## Raw extension-free Chromium accessibility/preview/console transcript

```json
{
  "browser": "headed extension-free Chromium",
  "version": "147.0.7727.15",
  "closed": {
    "open": [false, false, false, false, false],
    "summaries": ["text", "Select 2+", "Fill inherited · stroke inherited", "BLEEPED! · 96", "Opacity 1 · stroke default"],
    "aria": "- group: Organization text\n- group: Alignment Select 2+\n- group: Paint Fill inherited · stroke inherited\n- group: Text BLEEPED! · 96\n- group: Geometry Opacity 1 · stroke default"
  },
  "opened": {
    "open": [true, true, true, true, true],
    "summaries": ["text", "Select 2+", "Fill inherited · stroke inherited", "BLEEPED! · 96", "Opacity 1 · stroke default"],
    "aria": "- group:\n  - text: Organization\n  - button \"Lock\"\n  - button \"Send backward\" [disabled]\n  - button \"Bring forward\"\n  - button \"Group\" [disabled]\n  - button \"Ungroup\" [disabled]\n- group:\n  - text: Alignment\n  - button \"Left\" [disabled]\n  - button \"Center\" [disabled]\n  - button \"Right\" [disabled]\n  - button \"Top\" [disabled]\n  - button \"Middle\" [disabled]\n  - button \"Bottom\" [disabled]\n- group:\n  - text: Paint Fill\n- group:\n  - text: Text Content\n  - textbox \"Content\": BLEEPED!\n- group:\n  - text: Geometry Stroke width"
  },
  "preview": [
    {"target": "#wordmark", "status": "Previewing #wordmark.", "sizes": [[64,64],[32,32],[16,16]], "alts": ["64px #wordmark preview","32px #wordmark preview","16px #wordmark preview"]},
    {"target": "#icon", "status": "Previewing #icon.", "sizes": [[64,64],[32,32],[16,16]], "alts": ["64px #icon preview","32px #icon preview","16px #icon preview"]},
    {"target": "#missing", "status": "Whole SVG fallback: #missing is missing.", "sizes": [[64,64],[32,32],[16,16]], "alts": ["64px whole SVG fallback preview","32px whole SVG fallback preview","16px whole SVG fallback preview"]}
  ],
  "state": {"saveDisabled": true, "undoDisabled": true, "redoDisabled": true},
  "consoleMessages": [
    {"type": "debug", "text": "[vite] connecting..."},
    {"type": "debug", "text": "[vite] connected."}
  ],
  "pageErrors": []
}
```

## Exact durable artifact hashes and diff

Raw disk SHA-256:

```text
e597a6e56b195284a2a73052be87174770f19f3d36fd3c4ae041bc5957b142fa  iteration-13.svg
d9772e614199281e1351b337b2b5ebf345e295ecc792dfffa23094b5799b0b72  iteration-17.svg
```

Raw `/api/svg` SHA-256 returned the identical pair:

```text
e597a6e56b195284a2a73052be87174770f19f3d36fd3c4ae041bc5957b142fa  iterations/iteration-13.svg
d9772e614199281e1351b337b2b5ebf345e295ecc792dfffa23094b5799b0b72  iterations/iteration-17.svg
```

Raw unified diff (the sole changed line):

```diff
-      <text id="wordmark-primary" x="442" y="238" font-size="96" font-weight="800" letter-spacing="-3" font-family="Arial, sans-serif" text-anchor="middle">BLEEPED</text>
+      <text id="wordmark-primary" x="442" y="238" font-size="96" font-weight="800" letter-spacing="-3" font-family="Arial, sans-serif" text-anchor="middle">BLEEPED!</text>
```

## Automated evidence at the same implementation

- `npm run check` — pass: 277 tests, typecheck, production build.
- `npm test -- --run tests/editor-serialization.test.ts tests/fidelity.test.ts tests/client-ux.test.ts` — pass before the final editor-path family-fixture strengthening; rerun recorded in the T035 receipt.
- `git diff --check` — pass before the proof note; final rerun recorded in the T035 receipt.
- The retained matrix covers structured text, numeric/keyword/family no-ops, external fonts, fixed-point references, hidden/collapsed/calculated fallback, disclosure, undo/history/dirty/selection/scope, and source fidelity. T035 adds browser-equivalent escaped/commented family commits through the real editor path, used-only custom-property paths, bounded `var()` display/visibility/opacity fallback, and direct production inspector rendering.
