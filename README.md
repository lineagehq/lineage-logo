# Lineage Logo

A shared visual canvas where you and your agent create and fine-tune SVG logos together.

Found a logo you like? Fine-tune shape, size, color, and spacing together with your agent - without constantly regenerating the whole logo.

Make precise edits by hand, review and accept your agent’s proposed changes, and save editable SVG versions that either of you can continue from. The canvas runs locally with your logo files.

## See it in action

Move and resize layers, change colors, adjust spacing, and review an agent’s finishing touches. This condensed demo shows manual edits followed by an agent polish. Select the preview to watch with captions.

[![Fine-tune logo layers and review agent polish](site/assets/polishing/audio-readme.gif)](https://lineagehq.github.io/lineage-logo/#polish)

Move, resize, rotate, recolor, align, and edit text. Undo changes, check the logo at favicon sizes, and export SVG or PNG. Saving creates a new numbered SVG iteration, leaving your original file intact.

## Get started

Requires Node.js 22+ on macOS or Linux.

Put your SVG in the `concepts/` subfolder of a logo workspace, then run:

```bash
npx lineage-logo@0.1.0-beta.4 launch --workspace /absolute/path/to/logos
```

Replace the path with your workspace. Open the `lineage-logo.localhost` address printed by the launcher and keep the terminal running while you edit.

[Try the included example](docs/public-beta/seatify-quickstart.md) · [Connect your agent](docs/public-beta/agent-proposals.md)

## Learn more

- [Manual editing walkthrough](https://github.com/neonwatty/logo-designer-skill/blob/main/docs/manual-tweaks.md)
- [Agent integration](docs/agent-canvas.md)
- [Development and technical reference](docs/technical-reference.md)
- [Public beta release notes](docs/public-beta/release-notes-beta.4.md)
- [Support and feedback](SUPPORT.md)

Lineage Logo is in public beta. [Report a bug or suggest an improvement](https://github.com/lineagehq/lineage-logo/issues).
