# Lineage Logo

An experimental visual correction canvas for AI-generated SVG logos.

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
The newest same-origin SSE connection replaces any older upstream stream retained
by the development proxy, matching the MVP's single authoritative open editor and
preventing a stale response from claiming delivery.

When a mutating transaction arrives, the Agent review panel lists every impacted
layer and identifies hidden or locked targets. Layer actions locate the impact in
the hierarchy and canvas. `Show proposed preview` renders a separate candidate
surface; the accepted SVG and exported serialization remain unchanged until
`Accept all`. Accept creates one undoable edit, while Revert discards the candidate.
The panel announces pending, accepted, reverted, failed, stale, and disconnected
states, and all review controls expose keyboard-focusable names and pressed state.
Accepted and reverted decisions converge back to the authenticated producer. Exact
duplicates are idempotent, conflicting decisions are rejected, and an unacknowledged
delivered frame is replayed without duplicating review or history. File switching
remains disabled while review is pending.

SVGs produced by the logo-designer skill can enter this same public boundary through
the thin local adapter. See [docs/agent-canvas.md](docs/agent-canvas.md) for the artifact
contract and authenticated invocation. The adapter extracts a stable SVG group and its
referenced resources, then uses only the manifest and transaction endpoints; it never
imports editor internals or bypasses review.

## MVP

The first release focuses on a deliberately small editing surface:

- Open an SVG from a local logo workspace
- Select logical SVG groups or individual elements
- Move, resize, rotate, duplicate, hide, and delete selections
- Adjust fill, stroke, stroke width, and opacity
- Undo and redo edits
- Inspect the result at favicon sizes
- Save the correction as the next numbered SVG iteration

The detailed scope and acceptance criteria are in [docs/MVP.md](docs/MVP.md).

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

Open the editor address printed by the launcher (normally
`http://127.0.0.1:5173`). The workspace must be supplied explicitly and is the
only location the local server can read. The launcher uses port 4173 for the
local API when available and automatically selects the next available API or
editor port when either default is occupied. Pass `--port 4273` to request a
different starting API port.

Hover the canvas to preview exactly which layer a normal click will select.
Use `Edit inside` to make a selected group the active scope, `Back to group` to
move out one level, or the selection breadcrumb to return to an ancestor.
Double-click or hold Alt while clicking to select the exact element under the
pointer. The canvas, breadcrumb, and Layers panel share the same selection.
Groups in Layers can be collapsed, hidden layers are visibly marked and can be
shown again from the layer row, and a canvas selection automatically reveals
its corresponding layer. Use Search layers to filter larger documents by SVG
element type or layer name.
Shift-click adjacent siblings in the canvas or Layers panel to build a selection
for grouping or block reordering; the most recently selected layer is primary
and drives the inspector. Layer names are stored as standard `aria-label`
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
undone, redone, or cleared with Reset edits.
Fill and stroke accept standard SVG paint values, including `none`, CSS colors,
`currentColor`, and paint references such as `url(#gradient)`. An empty value
removes the presentation attribute so the paint is inherited. Invalid values
are explained without changing the SVG or adding an undo step; the adjacent
color picker provides an accessible shortcut for choosing a solid color.
The inspector keeps Duplicate, Hide, and Delete available near the selection
header while Organization, Alignment, Paint, and Geometry can be collapsed.
Arrow keys nudge by one SVG unit; Shift+Arrow nudges by ten. Delete removes a
selection; Cmd/Ctrl+D duplicates, Cmd/Ctrl+G groups, Cmd/Ctrl+Shift+G ungroups,
F fits the artboard, Shift+F fits the selected layer, and Escape clears the
selection or leaves the current group scope. The `?` control lists every
shortcut without changing the current selection. Standard
Undo and Redo shortcuts restore the selection context as well as the SVG. Drag the
canvas background, middle-drag, or hold Space while dragging to pan.

During local development, a disconnected preview displays an explicit restart
message and a Try again action instead of leaving a stale editor that appears
live.

`Reset edits` restores the SVG to the state in which it was opened, while the
`100%` control resets only the zoom level. The editor asks before switching
files when the current SVG has unsaved corrections.

Saving never overwrites the loaded SVG. It creates the next available file in
`iterations/` without injecting editor provenance or review metadata. Explicit root
`width` and `height`, unrelated metadata, IDs and references, resources, transforms,
text, custom attributes, and safe unsupported elements remain part of the clean SVG.
Legacy `metadata#lineage-logo-edit` is removed during clean editor serialization.

Run the full validation suite with:

```bash
npm run check
```
