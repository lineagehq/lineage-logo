# Lineage Logo

An experimental visual correction canvas for AI-generated SVG logos.

The project explores a hybrid workflow: AI generates structured SVG concepts,
a person makes precise visual corrections in a browser, and the corrected SVG
returns to the AI iteration loop without being converted into a proprietary
canvas format.

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
`iterations/` and embeds a small provenance note identifying its source.

Run the full validation suite with:

```bash
npm run check
```
