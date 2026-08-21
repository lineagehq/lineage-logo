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

The read-only workspace milestone is under active development. The current
prototype lists SVG concepts and iterations, renders the selected file inline,
shows its top-level layer structure, and previews favicon sizes.

## Development

Requirements: Node.js 22 or newer.

```bash
npm install
npm run dev -- --workspace /absolute/path/to/logos
```

Open `http://127.0.0.1:5173`. The workspace must be supplied explicitly and is
the only location the local server can read. If port 4173 is already in use,
add `--port 4273` to the development command.

Run the full validation suite with:

```bash
npm run check
```
