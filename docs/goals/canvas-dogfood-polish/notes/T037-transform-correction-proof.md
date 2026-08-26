# T037 grouped Geometry Scale correction proof

## Run identity

- UTC completion window: `2026-08-25T23:42Z`–`2026-08-25T23:47Z`
- Host: macOS `26.4.1`, Node `v22.22.3`, npm `10.9.8`
- Browser: Codex In-app Browser (Chromium production surface)
- Isolated workspace: `/tmp/lineage-t037-oracle.DTmtDv/logos`
- BleepThat source: exact copy of T011's clean skill continuation, SHA-256 `f586836a347c5efa8ce0fa4e963af28c3453e055731fc15a505b8bbe4979f419`

## Correction and automated contract

Grouped Scale % input now composes a uniform local scale about the selected
group's original bounding-box center with its focus-start root matrix. Every
coefficient passes through the existing six-decimal bound before it is written.
All intermediate input values compose from that same original matrix, so an
input stream cannot accumulate floating-point or rounding growth. The output
formatter emits plain decimal matrix coefficients, normalizes negative zero,
and rejects non-finite, degenerate, or coefficient-growing results.

The production `SvgEditor` Scale control regression matrix covers translated,
scaled, rotated, and skewed nested groups. For each case it sends multiple
input values through the real focus/input/change control path and proves:

- only the selected group root `transform` and editor-only scale state change;
- descendants, hierarchy, child order, IDs, paint references, masks, clip paths,
  selection and active nested scope remain exact;
- one effective focus-scoped commit creates exactly one history checkpoint;
- one Undo and one Redo restore the exact clean before and after SVG and context;
- invalid, zero, negative, excessive, normalized-equivalent (`100.0`, `+1e2`),
  no-op, and Escape-canceled inputs preserve exact SVG and history;
- saved/reparsed clean SVG retains every reference without reserved editor state.

The direct coefficient cases include the following 110% results around a
`0 0 20 20` local box:

```text
translated: matrix(1.1,0,0,1.1,3,4)
scaled:     matrix(2.2,0,0,3.3,2,2)
rotated:    matrix(0,1.1,-1.1,0,5,4)
skewed:     matrix(1.1,0.275,0.55,1.1,2.5,3.75)
```

## Real BleepThat Scale, save/reopen, and continuation

The isolated editor opened the exact prior BleepThat continuation and selected
the nested `#icon` group through the production Layers UI. Geometry Scale % was
changed through the production spinbutton. Multiple live input values produced
one completed 120% checkpoint. The only clean artifact delta was the root
matrix:

```diff
-    <g id="icon" transform="matrix(1.0721161000000001,0.8078972000000001,-0.8078972000000001,1.0721161000000001,244.72175959999998,-133.11360880000007)">
+    <g id="icon" transform="matrix(1.286539,0.969477,-0.969477,1.286539,237.626449,-224.522907)">
```

The browser compared `#icon.innerHTML` before and after and found exact equality.
One Undo restored the original long-float matrix with Undo then disabled; one
Redo restored the bounded matrix with Redo then disabled. Selection remained
`#icon`. Save created and reopened `iteration-1.svg` with Undo, Redo, and Save
disabled.

A real public `logo-designer-skill` adapter continuation then submitted one
`set-paint` operation for `#censor-block`. Explicit production review acceptance
returned transaction `ac746805-6ca7-4044-aba0-433632d9245c`, source
`iterations/iteration-1.svg`, and revision `1`. The accepted artifact retained
the exact bounded icon matrix. Save created and reopened `iteration-2.svg` with
all history/save controls disabled.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| BleepThat input | 1,638 | `f586836a347c5efa8ce0fa4e963af28c3453e055731fc15a505b8bbe4979f419` |
| scaled save/reopen `iteration-1.svg` | 1,582 | `c8e6d87c0f1208cd7163adc2d70ae2ef9e7d4e61ad380725944b2082f6454795` |
| continuation save/reopen `iteration-2.svg` | 1,582 | `2cf1fdbc8c9a195537429d42f83fab3dc66e69c82ff7f30da55f40bd5a4befc1` |
| continuation `/api/svg` response | 1,582 | `2cf1fdbc8c9a195537429d42f83fab3dc66e69c82ff7f30da55f40bd5a4befc1` |

The exact continuation diff was only:

```diff
-      <rect id="censor-block" x="86" y="216" width="280" height="62" rx="12" fill="#c72f2f"></rect>
+      <rect id="censor-block" x="86" y="216" width="280" height="62" rx="12" fill="#b82b35"></rect>
```

The final browser console contained only Vite's two debug connection messages;
there were zero warnings and zero errors.

## Release gates

```text
npm run check
  Test Files  16 passed (16)
  Tests       286 passed (286)
  tsc --noEmit: pass
  vite production build: pass (27 modules)

npm audit
  found 0 vulnerabilities

complete 16-file targeted cross-slice suite
  Test Files  16 passed (16)
  Tests       286 passed (286)

git diff --check
  pass
```

No descendant/reference rewrite, workspace or serialization-contract change,
dependency, disabled transform affordance, or out-of-scope production file was
required.
