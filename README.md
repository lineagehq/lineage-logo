# Lineage Logo - fine-tune your SVG without starting over

A local SVG logo editor for fine-tuning designs by hand or with your agent.

No need to regenerate your entire logo for small changes. Move, resize, rotate,
and recolor individual layers, then save a new iteration for you or your agent
to continue from.

Need a starting design? Use the [Logo Designer Skill](https://github.com/neonwatty/logo-designer-skill)
to explore SVG concepts, then bring the design you like into Lineage Logo for
precise adjustments.

[![Fine-tune logo layers and review agent polish](site/assets/polishing/audio-readme.gif)](https://lineagehq.github.io/lineage-logo/#polish)

## Get started

Requires Node.js 22+ on macOS or Linux.

Put your SVG in the `concepts/` subfolder of a logo workspace, then run:

```bash
npx lineage-logo@0.1.0-beta.4 launch --workspace /absolute/path/to/logos
```

Replace the path with your workspace. Open the `lineage-logo.localhost` address printed by the launcher and keep the terminal running while you edit.

[Try the included example](docs/public-beta/seatify-quickstart.md) · [Connect your agent](docs/public-beta/agent-proposals.md)

## Learn more

- [How to edit an AI-generated SVG logo without starting over](https://neonwatty.com/posts/edit-ai-generated-svg-logo/)
- [Manual editing walkthrough](https://github.com/neonwatty/logo-designer-skill/blob/main/docs/manual-tweaks.md)
- [Agent integration](docs/agent-canvas.md)
- [Development and technical reference](docs/technical-reference.md)
- [Public beta release notes](docs/public-beta/release-notes-beta.4.md)
- [Support and feedback](SUPPORT.md)
