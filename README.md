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

Open `http://127.0.0.1:5173`. The workspace must be supplied explicitly and is
the only location the local server can read. If port 4173 is already in use,
add `--port 4273` to the development command.

Select a logical group by clicking the canvas. Double-click or hold Alt while
clicking to select an element inside a group. Arrow keys nudge by one SVG unit;
Shift+Arrow nudges by ten. Standard Undo and Redo shortcuts are supported.

Saving never overwrites the loaded SVG. It creates the next available file in
`iterations/` and embeds a small provenance note identifying its source.

Run the full validation suite with:

```bash
npm run check
```
