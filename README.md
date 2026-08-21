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

Planning and technical validation.
