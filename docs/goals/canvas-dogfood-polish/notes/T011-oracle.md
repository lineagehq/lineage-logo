# T011 integrated BleepThat release oracle

## Run identity

- UTC window: `2026-08-25T23:19:59Z`–`2026-08-25T23:33:32Z`
- Host: macOS `26.4.1` (`25E253`), Node `v22.22.3`, npm `10.9.8`
- Browser: Codex In-app Browser, Codex Framework/Chromium `151.0.7922.137`, production build flavor
- Toolchain: Vite `8.2.2`, Vitest `4.1.11`
- Editor/API: `http://127.0.0.1:5173/` / `http://127.0.0.1:4273/`
- Isolated workspace: `/tmp/lineage-t011-oracle.HPt0mW/logos`
- BleepThat source: exact copy of `iterations/iteration-13.svg`
- BleepThat proposal: exact copy of `iterations/iteration-17.svg`
- Browser metadata: `{ "name": "Codex In-app Browser", "type": "iab", "codexAppBuildFlavor": "prod" }`

The oracle used a fresh temporary workspace, an explicit owner-private connection
descriptor, the real local server/Vite proxy, the public `logo-designer-skill` adapter,
SSE delivery, the production review UI, the production editor, and the workspace save
endpoint. No production code or user BleepThat artwork was changed. The only durable
repository output from T011 is this note; no regression test was missing from the
already-integrated 277-test suite.

## Fresh release gates

```text
$ npm run check
Test Files  16 passed (16)
Tests       277 passed (277)
tsc --noEmit: pass
vite v8.2.2 production build: pass (27 modules)

$ npm audit
found 0 vulnerabilities

$ npm test -- --run tests/agent-connection-context.test.ts tests/agent-history.test.ts tests/agent-producer-client.test.ts tests/agent-protocol.test.ts tests/agent-reconnect.test.ts tests/agent-review.test.ts tests/agent-transaction.test.ts tests/agent-transport.test.ts tests/client-ux.test.ts tests/editor-interactions.test.ts tests/editor-serialization.test.ts tests/fidelity.test.ts tests/file-open-race.test.ts tests/history.test.ts tests/logo-designer-adapter.test.ts tests/workspace.test.ts
Test Files  16 passed (16)
Tests       277 passed (277)
Duration    21.00s
```

The integrated client UX tests exercise the `prefers-reduced-motion: reduce` branch;
the shipped production CSS uses `200ms ease` for shell/toggle motion and the reduced
branch sets those transition durations to `0.01ms !important`. The live browser
collapse/settle captures were visually stable and layout-only. The SVG transform,
text, selection, history availability, and dirty state remained exact through every
layout transition.

## Submit, pending reconnect, exactly-once Accept, and recovered Revert

The accepted transaction was `t011-accept`, bound to session
`902f6d2c-2f19-4748-9d8f-5055bab65ff9`, source
`concepts/concept-1.svg`, and revision `0`. Before reload the authenticated status was:

```json
{"transactionId":"t011-accept","status":"pending_review","result":{"transactionId":"t011-accept","status":"staged","impact":[{"operationId":"logo-artifact","affectedSessionKeys":["element-1"],"resultSessionKey":"element-1"}]}}
```

A full page reload disconnected the original stream. Recovery republished exactly the
same session, source, revision, transaction, affected root, and candidate. The raw
accessibility excerpt before and after reload was identical:

```text
- region "Agent review":
  - generic: Agent review
  - strong: pending
  - paragraph:
    - strong: Editing locked.
    - text: Accept or revert before editing.
  - status: lineage-logo-adapter proposed 1 change affecting 1 layer. Accept or revert before editing.
  - button "Show proposed preview"
  - list "Layers changed by agent":
    - button "Locate logo, g":
      - strong: logo
      - generic: g · logo-artifact
  - button "Revert"
  - button "Accept all" [active]
```

`Accept all` was activated once. The producer returned `accepted`, transaction
`t011-accept`, source `concepts/concept-1.svg`, revision `1`, and the exact BLEEPED!
candidate. One Undo restored BLEEPED with Undo and Save disabled; one Redo restored
BLEEPED! with Redo disabled. This proves one application and one checkpoint rather
than duplicate recovery history.

A separate transaction, `t011-revert`, was submitted at revision `3`, reached pending,
survived another full reload, and was reverted once. The producer returned exactly:

```json
{"transaction":{"transactionId":"t011-revert","sessionId":"902f6d2c-2f19-4748-9d8f-5055bab65ff9","sourcePath":"concepts/concept-1.svg","baseRevision":3},"outcome":{"status":"reverted","transactionId":"t011-revert"}}
```

The accepted BLEEPED! canvas remained unchanged, Undo/Save stayed disabled across the
recovered Revert, and no candidate checkpoint was added.

## Group transform and bounded text fidelity

The selected `#icon` group was dragged in the production canvas, then resized to 110%
through the production Geometry control. Only the selected root transform changed:

```text
accepted root: matrix(0.974651,0.734452,-0.734452,0.974651,221.770715,-104.65202)
after drag:    matrix(0.974651,0.734452,-0.734452,0.974651,247.946901,-91.563928)
after resize:  matrix(1.0721161000000001,0.8078972000000001,-0.8078972000000001,1.0721161000000001,244.72175959999998,-133.11360880000007)
```

`#icon-background x` remained exactly `56`; every descendant, child order, hierarchy,
ID, and safe attribute stayed unchanged. Undo twice produced the post-drag transform
then the accepted transform. Redo twice produced the post-drag transform then the
post-resize transform, proving one checkpoint per effective operation.

For `#wordmark-primary`, temporary content `TEMPORARY` plus Escape restored `BLEEPED!`.
The invalid family `url(https://example.com/font.woff)` retained `Arial, sans-serif`.
Re-entering `BLEEPED!` was a no-op. The effective edit `BLEEPED!!` undid to `BLEEPED!`
and redid to `BLEEPED!!`; font size `100` independently undid to `96` and redid to
`100`. Selection and the group root transform remained exact. Automated coverage in
the fresh targeted set additionally proves invalid/cancel/no-op byte equality and
history invariants for every bounded text property.

The exact proposal-to-manual-save diff was:

```diff
@@
-    <g id="icon" transform="matrix(0.974651,0.734452,-0.734452,0.974651,221.770715,-104.65202)">
+    <g id="icon" transform="matrix(1.0721161000000001,0.8078972000000001,-0.8078972000000001,1.0721161000000001,244.72175959999998,-133.11360880000007)">
@@
-      <text id="wordmark-primary" x="442" y="238" font-size="96" font-weight="800" letter-spacing="-3" font-family="Arial, sans-serif" text-anchor="middle">BLEEPED!</text>
+      <text id="wordmark-primary" x="442" y="238" font-size="100" font-weight="800" letter-spacing="-3" font-family="Arial, sans-serif" text-anchor="middle">BLEEPED!!</text>
```

## Previews and inspector disclosure

`#icon`, explicit `#wordmark`, missing `#missing`, and return to `#icon` all rendered
exact `64×64`, `32×32`, and `16×16` images. Status strings were respectively
`Previewing #icon.`, `Previewing #wordmark.`, and
`Whole SVG fallback: #missing is missing.`. Every switch retained the exact root
transform, text, Undo state, and dirty state. The BleepThat fixture contains no local
paint references; the same fresh `fidelity.test.ts` run proves referenced resources
are retained for targeted previews.

All five production inspector disclosures were opened with one selected text layer,
and remained open after Shift-selecting the adjacent highlight. They then remained
closed across multi-to-single selection. Raw collapsed summaries were:

```text
multi:  Organization 2 layers | Alignment 2 selected | Paint Fill #FFD600 · stroke inherited | Text Unavailable | Geometry Opacity 1 · stroke default
single: Organization text | Alignment Select 2+ | Paint Fill inherited · stroke inherited | Text BLEEPED!! · 100 | Geometry Opacity 1 · stroke default
```

## Responsive, sidebars, focus, and unsaved decisions

At 1440px the two panels collapsed independently into rails, with
`aria-expanded=false` on each. Unmodified `[` and `]` on a non-form toolbar control
restored them independently. A saved left-collapsed/right-expanded preference survived
a full reload exactly. Responsive auto-collapse did not overwrite it; returning from
760px to 1440px restored both intended wide states. A pending `t011-badge` transaction
auto-revealed the Inspector. Collapsing it during review produced this raw tree:

```text
- complementary "Layers and inspector":
  - button "Expand layers and inspector panel" [active]:
    - generic: ›
    - generic: Inspect
    - generic "Pending agent review": "!"
```

The unsaved dialog exposed an accessible `dialog "Unsaved corrections"`, heading,
alert, and named Save/Discard/Cancel buttons at all four required widths. Cancel kept
the dirty `BLEEPED!!!` document and restored focus to the requested `concept-2` button.
Making the temporary iterations directory read-only forced a real Save failure; the
dialog retained the document and announced:

```text
- alert: The iteration could not be saved. Your current document is unchanged; try Save again or Cancel.
- button "Cancel"
- button "Discard"
- button "Save" [active]
```

After restoring permissions, Discard opened the requested target without saving.
A later successful Save wrote `iteration-2.svg` before opening `iteration-1.svg`.
Semantic keyboard sidebar shortcuts passed live; dialog focus/keyboard activation and
focus trapping are also exercised in the fresh `client-ux.test.ts` release gate.

Viewport and dialog captures are identified by exact SHA-256 so the observations are
durably distinguishable without adding out-of-scope binary files:

| Viewport | Shell screenshot SHA-256 | Dialog screenshot SHA-256 | Observed responsive state |
| --- | --- | --- | --- |
| 1440×900 | `d56d012c752231369e21572872e30d8547c7409cf1ae02088950ea7546ae7da2` | `7bb3c91b749c383f3809dfdac0a8d08770c2382619e98785d02a3bd90dfc2c24` | both panels usable; independent rails |
| 1024×900 | `e5237907e296f77241c1f9c2259b7e59b9cd959cbce73c7dd68828947103cd95` | `10d02ea1b26092a3e14ae25bfc95fc7e57678d38223b050de0184c82efd28223` | workspace temporarily collapsed; inspector and toolbar reachable |
| 980×900 | `87827aee676e3ca525c2b214e406fd2d2450768f581d0cdeee1fa08f2e65a138` | `00be534e9d4a2d7cc936564797d8ccb76d1393c24f92e04930d7a641d95a5807` | workspace temporarily collapsed; inspector and toolbar reachable |
| 760×900 | `a6c3da8aa9a0eeb77aa727cb34673f43c5a8b898032f9b9adcc2ffd74e32afe0` | `7a07d36a080bc2866bcef6953a1b298210de70460c5b5cff1f681719740c9c34` | both rails visible; Inspector opens with preview/controls reachable |

The manually opened 760px Inspector capture is
`7f23717fc6cb07e70535b73b6009dd1d562843800f4b4e64bc72b240ca446de5`;
the pending-badge capture is
`73cfa82a866dd408e16ffa24cd84fb8a36ca34c4ac86917d31ce0d91eb563286`.
Throughout the matrix the root transform, `BLEEPED!!`, Undo, and Save states were exact.

## Clean save/reopen and exact skill continuation

The base, accepted proposal, manual save, and continuation hashes were:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| BleepThat iteration 13 base | 1578 | `e597a6e56b195284a2a73052be87174770f19f3d36fd3c4ae041bc5957b142fa` |
| BleepThat iteration 17 accepted proposal | 1579 | `d9772e614199281e1351b337b2b5ebf345e295ecc792dfffa23094b5799b0b72` |
| manual save/reopen `iteration-1.svg` | 1638 | `34a25d716cce9e23ff48d24a6a0f69aa38233b4684e165b34a6e3f0d8c3e7041` |
| skill continuation/save/reopen `iteration-3.svg` | 1638 | `f586836a347c5efa8ce0fa4e963af28c3453e055731fc15a505b8bbe4979f419` |

The real adapter continued from open, clean `iterations/iteration-1.svg` as transaction
`t011-continue`, session `fd50462e-6201-46ef-9e54-8f513210a56d`, revision `0`. It
proposed exactly one bounded paint adjustment on `censor-block`, was explicitly
accepted once, and returned authoritative revision `1`. Saving created and reopened
`iteration-3.svg` with Undo, Redo, and Save disabled.

Disk, `/api/svg`, and authenticated producer artifact values matched exactly:

```json
{"disk":{"bytes":1638,"sha256":"f586836a347c5efa8ce0fa4e963af28c3453e055731fc15a505b8bbe4979f419"},"api":{"bytes":1638,"sha256":"f586836a347c5efa8ce0fa4e963af28c3453e055731fc15a505b8bbe4979f419"},"producer":{"status":"accepted","sourcePath":"iterations/iteration-1.svg","revision":1,"bytes":1638,"sha256":"f586836a347c5efa8ce0fa4e963af28c3453e055731fc15a505b8bbe4979f419"}}
```

The exact continuation diff was:

```diff
@@
-      <rect id="censor-block" x="86" y="216" width="280" height="62" rx="12" fill="#d9362b"></rect>
+      <rect id="censor-block" x="86" y="216" width="280" height="62" rx="12" fill="#c72f2f"></rect>
```

No `data-lineage-*`, `data-agent-*`, `data-review-*`, `data-transport-*`,
`transactionId`, `lineage-logo-edit`, script, or external resource metadata is present.
Final production reopen screenshot SHA-256:
`eb6b94a479ab02f9be0b920a1db74c425fc05552f1f19a4ea1230a9d6a9ad58e`.

## Raw final console transcript

A fresh final browser tab opened `iteration-3.svg` after all work. Its complete console
transcript was:

```json
[
  {
    "level": "debug",
    "message": "[vite] connecting...",
    "timestamp": "2026-08-25T23:32:00.699Z",
    "url": "http://127.0.0.1:5173/@vite/client"
  },
  {
    "level": "debug",
    "message": "[vite] connected.",
    "timestamp": "2026-08-25T23:32:00.703Z",
    "url": "http://127.0.0.1:5173/@vite/client"
  }
]
```

There were zero warnings and zero errors. Security, identity, revision, and transaction
binding stayed strict. The integrated run also exposed long floating-point coefficients
in the grouped Scale control; T037 subsequently corrected that production path and
reproved the saved artifact with bounded six-decimal matrices.
