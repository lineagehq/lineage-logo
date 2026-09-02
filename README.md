# Lineage Logo

An experimental visual correction canvas for AI-generated SVG logos.

## Examples

- [`examples/seatify-constellation.svg`](examples/seatify-constellation.svg) — the canonical 44-layer Seatify constellation test fixture, built from six abstract seats arranged around a circular table. Unit tests read this file directly; browser QA uses only a byte-identical temporary workspace copy.

The project explores a hybrid workflow: AI generates structured SVG concepts,
a person makes precise visual corrections in a browser, and the corrected SVG
returns to the AI iteration loop without being converted into a proprietary
canvas format.

## Agent transaction protocol

The canvas has a strict local protocol boundary for agent-authored changes. Protocol v1
transactions identify the producer and exact document session, source path, and base
revision, then contain 1–100 ordered operations. Supported operations add or replace a
layer, rename or reorder a layer, set fill or stroke, and select/focus layers. Layer
references use either an editor session key or the result of an earlier structural
operation in the same transaction.

Transactions are limited to 5 MiB. The evaluator applies every operation to a detached
SVG clone and exposes a candidate only after all targets, locks, SVG safety rules, IDs,
local references, paint values, and selection intent pass. Unknown fields, versions,
operations, forward references, stale revisions, unsafe or external SVG content,
reference damage, and all-no-op mutations return a structured rejection without
changing the open document.

The local server now exposes that boundary at `POST /api/agent/transactions` and
authenticated producer reads at `GET /api/agent/document` and
`GET /api/agent/transactions/:id`. It prints a high-entropy bearer token at startup
(or accepts `LINEAGE_LOGO_AGENT_TOKEN`) and never sends that secret to the browser.
The browser uses exact-origin-protected manifest, SSE, and acknowledgement routes.
Delivery is ordered, bounded, timed out after 15 seconds, replay-aware through SSE
event IDs, and deduplicated by transaction ID plus exact payload hash. A successful
mutating delivery is staged through the detached evaluator without reloading or
mutating the accepted canvas; review and acceptance happen in the Agent review panel.
The first canvas tab to publish its manifest owns a short-lived editor lease. Its
same-tab reconnect replaces any older upstream stream retained by the development
proxy, but another tab receives an explicit conflict instead of silently taking over
the manifest or proposal stream. Closing the owner releases the lease after the proxy
stream settles, allowing another open tab to reconnect as the sole authoritative editor.

When a mutating transaction arrives, the Agent review panel lists every impacted
layer and identifies hidden or locked targets. Layer actions locate the impact in
the hierarchy and canvas. `Show proposed preview` renders a separate candidate
surface; the accepted SVG and exported serialization remain unchanged until
`Accept all`. Accept creates one undoable edit, while Revert discards the candidate.
The panel announces pending, accepted, reverted, failed, stale, and disconnected
states, and all review controls expose keyboard-focusable names and pressed state.
Accepted and reverted decisions converge back to the authenticated producer. Exact
duplicates are idempotent, conflicting decisions are rejected, and an unacknowledged
delivered frame is replayed without duplicating review or history. A staged proposal
also survives a same-tab reload: Lineage restores the exact base SVG, document session,
source path, and revision from tab-scoped storage, republishes that manifest, and the
browser first reconciles it through an exact-origin, identity-bound recovery request.
The server either replays the matching pending transaction, returns its authoritative
accepted/reverted/failed state, or reports it unknown without exposing producer credentials.
Every explicit Accept or Revert also records a retained terminal stream event. If a reload
first observes pending and the old decision commits before the replacement stream subscribes,
that event makes the new page re-read and converge the authoritative state. Duplicate events
are coalesced and cannot add another application or checkpoint.
An already-accepted artifact is restored once as one undoable edit; a terminal non-accept
restores no candidate; an unknown or replacement-server record is discarded without
overwriting the workspace file. The recovered pending candidate still requires a fresh
explicit Accept or Revert decision. If tab storage is unavailable, staging is rejected
immediately so the producer receives a terminal outcome instead of waiting on a review
that cannot survive reload. File switching and every mutation
remain disabled while review is pending, the review panel announces that lock, focuses
an action, and returns focus to the editing surface after the decision.
If a proposal arrives while the unsaved-file dialog is open or its Save is still
in flight, review preempts that switch: the dialog closes, no delayed decision or
save or workspace-refresh response can update workspace metadata, open the target,
or rebuild file controls, and the exact current editor and recovery state remains
in place until Accept or Revert completes.
Malformed or truncated successful recovery responses are treated as transient: Lineage keeps
the exact recovery record, opens or mutates nothing, and retries on the next reload. Only an
authoritative unknown result or exact 4xx identity conflict discards stale tab state.

SVGs produced by the logo-designer skill can enter this same public boundary through
the thin local adapter. See the [agent canvas guide](https://github.com/lineagehq/lineage-logo/blob/main/docs/agent-canvas.md) for the artifact
contract and authenticated invocation. The adapter extracts a stable SVG group and its
referenced resources, then uses only the manifest and transaction endpoints; it never
imports editor internals or bypasses review.
After an accepted producer handoff persists its numbered continuation, the open
canvas refreshes the workspace list and next-save target without reopening or
changing the current document, history, selection, or dirty state.

## MVP

The first release focuses on a deliberately small editing surface:

- Open an SVG from a local logo workspace
- Select logical SVG groups or individual elements
- Move, resize, rotate, duplicate, hide, and delete selections
- Adjust fill, stroke, stroke width, and opacity
- Undo and redo edits
- Inspect the result at favicon sizes
- Save the correction as the next numbered SVG iteration

The detailed scope and acceptance criteria are in the [MVP document](https://github.com/lineagehq/lineage-logo/blob/main/docs/MVP.md).

## Status

The current prototype lists SVG concepts and iterations, renders the selected
file inline, exposes its editable layer structure, and previews favicon sizes.
It supports direct move, resize, and rotate corrections; appearance and numeric
controls; duplicate, hide, and delete actions; undo and redo; and safe saves to
the next numbered SVG iteration.

## Development

Requirements: Node.js 22 or newer.

```bash
npm install
npm run dev -- --workspace /absolute/path/to/logos
```

Open the editor address printed by the launcher through a descriptive local
hostname (for example, `http://lineage-logo.localhost:5173`). The workspace must be supplied explicitly and is the
only location the local server can read. The launcher uses port 4173 for the
local API when available and automatically selects the next available API or
editor port when either default is occupied. Pass `--port 4273` to request a
different starting API port.

## Public beta CLI

The public executable is `lineage-logo`. Until a package is published to a
registry, build and install a reviewed repository artifact rather than assuming
that `npm install -g lineage-logo` is available:

```bash
npm ci
npm pack
npm install -g ./lineage-logo-0.1.0-beta.1.tgz
lineage-logo --help
lineage-logo doctor
lineage-logo launch --workspace /absolute/path/to/logos
```

`launch` stays attached to the local editor process and prints a descriptive
`lineage-logo.localhost` address. The server listens on loopback only. Use
`--no-open` when a browser should not open automatically. `doctor`, `launch`,
and `submit` support a versioned `--json` result; normal progress is written to
stderr and does not include bearer tokens, absolute registry paths, or SVG
contents. `submit` omits accepted SVG bytes unless `--include-svg` is explicit.

The initial beta target is Node.js 22 or newer on macOS and Linux. The complete
browser suite is exercised with Playwright Chromium. Firefox and Playwright
WebKit currently receive one critical keyboard and semantic-control smoke path;
that is not evidence of full Firefox support, native Safari compatibility, or
WCAG conformance. Windows is not an initial beta target.

The repository release check packs the exact npm artifact, enforces its file
allowlist, installs it in an isolated temporary project, repeats installation of
the same artifact, and exercises the installed help, version, and doctor paths.
It does not prove a public npm-registry install or an upgrade from an older
version. Before publishing a beta, observe the configured Ubuntu and macOS CI
jobs and complete the [repository public beta checklist](https://github.com/lineagehq/lineage-logo/blob/main/docs/public-beta/README.md).

Public beta issues and usage questions belong in the
[GitHub issue tracker](https://github.com/lineagehq/lineage-logo/issues) and are
handled on a best-effort basis without a response-time SLA. Do not use public
issues for confidential vulnerability details. The beta intentionally provides
no private security-reporting channel, so reports that require confidentiality
cannot currently be accepted. Non-sensitive hardening discussions may use the
public tracker with secrets, private paths, and exploit details omitted.

Run the focused Chromium marquee QA with:

```bash
npx playwright install chromium # once per machine
npm run test:e2e -- --grep 'live marquee preview'
```

Run the collective movement and history milestone on the same real-Chromium
harness with:

```bash
npm run test:e2e -- --grep 'collective translation'
```

The command reserves dedicated strict ports, opens
`http://marquee-qa.localhost:43118`, and copies the distinct complex Seatify
geometry fixture plus the canonical `examples/seatify-constellation.svg`
byte-for-byte into a validated `mkdtemp` workspace. It removes that exact
workspace and both child-process groups when Playwright stops. Successful runs
retain no trace or screenshot. Failures retain only a private-permission,
sanitized JSON summary under `test-results/`; it contains the engine, static
test title, and result status, not workspace paths, SVG contents, screenshots,
or traces.
The Chromium suite covers live preview entry/exit and exact Layers parity,
Shift-additive and Escape cancellation behavior, contain/touch preferences,
125% zoom, collapsed sidebars, visual affordance styling, and document/history
non-mutation. It also covers cross-parent collective drag from a non-primary
layer, one- and ten-unit keyboard nudges, named Undo/Redo, gesture cancellation,
locked/hidden/Agent-review rejection, named Save, and clean saved SVG bytes.
Every gesture is derived from live SVG transforms rather than viewport
coordinates. CI runs it as a separate `browser-qa` job and uploads
`test-results/` only when that job fails.

For a failing browser run, inspect `test-results/release-diagnostics.json` for
the bounded metadata summary, then reproduce the named test locally. Rich visual
failure artifacts are intentionally not collected in the current beta gate.

Hover the canvas to preview exactly which layer a normal click will select.
Use `Edit inside` to make a selected group the active scope, `Back to group` to
move out one level, or the selection breadcrumb to return to an ancestor.
Double-click or hold Alt while clicking to select the exact element under the
pointer. The canvas, breadcrumb, and Layers panel share the same selection.
Hold physical left `Control` while dragging from artwork or empty canvas to
region-select visible leaf-most objects in the current scope; hold Shift at
pointerdown to add them. A sub-threshold Control-click toggles the exact object;
on empty canvas it clears without Shift and preserves with Shift. Preferences
can switch activation to `M`, where a sub-threshold gesture is a no-op. Releasing
the activation key cancels unfinished selection. Middle-drag or Space-drag pans.
Groups in Layers can be collapsed, hidden layers are visibly marked and can be
shown again from the layer row, and a canvas selection automatically reveals
its corresponding layer. Use Search layers to filter larger documents by SVG
element type or layer name.
Shift-click adjacent siblings in the canvas or Layers panel to build a selection
for grouping or block reordering; the most recently selected layer is primary
and drives the inspector. While region-selecting, matching objects preview with
the same purple selection halos before the gesture is committed. Drag any
selected object or use Arrow/Shift+Arrow to
move the entire selection by one shared visual SVG delta, including selections
that span transformed parents. A locked, hidden, disconnected, or Agent-blocked
member prevents the whole move instead of allowing a partial edit. Resize and
rotation handles remain primary-only. Layer names are stored as standard `aria-label`
attributes and can be cleared; pressing Enter commits a name and Escape cancels
the field edit. Locks are session-only. The organization controls send a layer
or adjacent block one position backward or forward in SVG paint order, create a
neutral `<g>`, or safely ungroup a neutral group. Ungrouping a named neutral
group explicitly warns that its wrapper name will be removed. Documents
with `<style>` elements and groups with source attributes stay intact and show
why the unsafe operation is unavailable.
With two or more sibling layers selected, use Left, Center, Right, Top, Middle,
or Bottom to align their geometric bounding boxes within their shared parent.
Alignment preserves hierarchy and source attributes, and each action can be
undone, redone, or cleared with Reset edits. With three or more eligible layers,
use Distribute H/V to space visual centers evenly or Space H/V to equalize edge
gaps. These cross-parent operations keep the two outer visual anchors fixed and
commit as one undoable edit.
Fill and stroke accept standard SVG paint values, including `none`, CSS colors,
`currentColor`, and paint references such as `url(#gradient)`. An empty value
removes the presentation attribute so the paint is inherited. Invalid values
are explained without changing the SVG or adding an undo step; the adjacent
color picker provides an accessible shortcut for choosing a solid color.
Selecting an SVG `<text>` layer exposes a bounded Text group for plain content,
font size, weight, local font-family lists, start/middle/end alignment, and letter
spacing. Edits commit as one undo step; Escape cancels, while invalid or unchanged
values leave the SVG and history untouched. Markup, CSS injection, font URLs, and
general-purpose style editing are intentionally unsupported.
The inspector keeps Duplicate, Hide, and Delete available near the selection
header while Organization, Alignment, Paint, Text, and Geometry can be collapsed.
Collapsed groups retain a concise selection-relevant value or availability summary
without changing the user's disclosure choices.
Arrow keys nudge by one SVG unit; Shift+Arrow nudges by ten. Delete removes a
selection; Cmd/Ctrl+D duplicates, Cmd/Ctrl+G groups, Cmd/Ctrl+Shift+G ungroups,
F fits the artboard, Shift+F fits the selected layer, and Escape clears the
selection or leaves the current group scope. The `?` control lists every
shortcut without changing the current selection. Standard
Undo and Redo shortcuts restore the selection context as well as the SVG.
Middle-drag or hold Space while dragging to pan.

The Workspace and Inspector sidebars collapse independently into visible rails.
Use their named rail controls or unmodified `[` and `]` when focus is outside a
form field or dialog. Preferences persist locally; narrower windows temporarily
collapse panels without replacing those preferences, and reduced-motion settings
remove the layout animation. A pending agent review reveals the Inspector without
changing its saved preference and leaves a pending badge on its rail if collapsed.

During local development, a disconnected preview displays an explicit restart
message and a Try again action instead of leaving a stale editor that appears
live.

Small-size checks render detached clean-SVG clones at 64, 32, and 16 px. They
default to a usable `#icon`, allow another eligible ID to be selected, preserve
local defs and references, and announce a whole-SVG fallback when the requested
target is absent, hidden, invalid, or has no visible bounds. Previewing never
changes the live document, selection, history, zoom, dirty state, or saved bytes.

`Reset edits` restores the SVG to the state in which it was opened, while the
`100%` control resets only the zoom level. Switching files with unsaved corrections
opens an in-app Save, Discard, or Cancel dialog. Cancel and failed saves keep the
current document intact; successful Save writes the current iteration before the
requested file opens.

Saving never overwrites the loaded SVG. It creates the next available file in
`iterations/` without injecting editor provenance or review metadata. Explicit root
`width` and `height`, unrelated metadata, IDs and references, resources, transforms,
text, custom attributes, and safe unsupported elements remain part of the clean SVG.
Legacy `metadata#lineage-logo-edit` is removed during clean editor serialization.

Run the full validation suite with:

```bash
npm run check
```
