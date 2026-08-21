# Lineage Logo MVP

## Product premise

AI is good at proposing logo directions and applying broad feedback. People are
better at noticing and correcting a shape that is a few pixels off. Lineage Logo
connects those two modes without flattening or replacing the generated SVG.

The MVP is a focused correction canvas, not a general-purpose vector design app.

## Primary workflow

1. A logo-generation skill creates structured SVG concepts and iterations.
2. The user launches Lineage Logo against the generated `logos/` directory.
3. The app lists available concepts and iterations.
4. The user opens one SVG and makes precise visual corrections.
5. The app saves the result as the next file in `logos/iterations/`.
6. The AI can read that ordinary SVG and continue refining or export it.

## MVP scope

### Workspace and files

- Start a local server bound to `127.0.0.1`.
- Accept a user-selected logo workspace as the only writable root.
- List SVG files from `concepts/` and `iterations/`.
- Open a selected SVG without rasterizing or converting it.
- Save edits as the next numbered iteration; never overwrite the source by
  default.
- Show the destination filename before saving.

### Canvas

- Render the SVG inline on a pan-and-zoomable artboard.
- Select top-level elements and named groups such as `icon`, `wordmark`, and
  `tagline`.
- Drill into a group to select an individual child element.
- Move, resize, and rotate a selection using direct-manipulation handles.
- Support keyboard nudging with a larger modified step.
- Display selection bounds and the active element or group name.
- Offer optional grid and snapping controls.

### Inspector

- Edit fill color.
- Edit stroke color and stroke width.
- Edit opacity.
- Edit numeric position, scale, and rotation values.
- Hide, show, duplicate, and delete a selection.
- Preserve unsupported attributes and SVG nodes through a load/save cycle.

### History and review

- Undo and redo within the current editing session.
- Reset to the file's initially loaded state.
- Preview the current result at 64, 32, and 16 pixels.
- Switch the preview between light, dark, and checkerboard backgrounds.
- Clearly indicate unsaved changes.

### Saving and interoperability

- Serialize a standards-compliant, self-contained SVG.
- Preserve the original `viewBox` and named group IDs.
- Save an ordinary SVG that the logo-designer skill can immediately read.
- Include a small metadata note identifying the source iteration and Lineage
  Logo version without requiring a sidecar project file.

## Explicit non-goals

- Pen-tool path creation or node-by-node Bezier editing
- Typography discovery, font installation, or text-to-path conversion
- Boolean path operations
- Multi-page brand systems
- Real-time collaboration or cloud persistence
- AI generation inside the canvas
- PNG, ICO, or app-icon export; the existing logo skill owns export
- Replacing Figma, Illustrator, or Inkscape

## Proposed architecture

### Browser editor

- TypeScript with a lightweight Vite build
- Inline SVG as the source of truth
- SVG.js for SVG manipulation and serialization
- SVG.js select, resize, draggable, and pan/zoom plugins where they preserve
  source structure cleanly
- A small command-based history layer for undo and redo
- No application database and no proprietary document model

### Local companion server

- Node.js with built-in HTTP and filesystem APIs where practical
- Bound to `127.0.0.1` only
- Workspace-root path containment on every read and write
- Endpoints to list SVGs, read one SVG, and create the next iteration
- Atomic saves using a temporary sibling file followed by rename
- SVG size limits and validation before persistence

### Repository shape

```text
src/
  client/
    canvas/
    inspector/
    history/
    workspace/
  server/
    api/
    files/
tests/
fixtures/
```

## Safety requirements

- Never accept a writable root implicitly from the current working directory.
- Reject path traversal, absolute file paths in API requests, and symlink escapes.
- Do not overwrite an existing iteration.
- Reject SVGs containing scripts, event-handler attributes, `foreignObject`, or
  external resource references.
- Set a conservative request and SVG document size limit.
- Apply a restrictive Content Security Policy to the editor.
- Keep all network listening local to the user's machine.

## Milestones

### 0. Fidelity spike

Prove that representative logo-designer SVGs survive load, move, resize, color
change, and save without losing gradients, masks, IDs, or viewBox information.

Exit criterion: fixture-based structural comparisons pass for simple and complex
sample logos.

### 1. Read-only workspace

Implement the local server, workspace selection, file gallery, inline canvas,
layers list, background switcher, and favicon previews.

Exit criterion: a user can launch the app against an existing `logos/` folder
and inspect every SVG without editing it.

### 2. Core correction tools

Add selection, group drill-down, move, resize, rotate, keyboard nudging, basic
appearance controls, duplicate, visibility, and delete.

Exit criterion: the user can make the common small corrections without editing
SVG markup by hand.

### 3. Safe iteration saves

Add undo/redo, dirty state, reset, validation, next-iteration naming, atomic save,
and post-save gallery refresh.

Exit criterion: clicking save creates exactly one new SVG iteration, preserves
the source file, and makes the new iteration immediately available to the AI
workflow.

### 4. Logo-designer integration experiment

Document a launch command for the logo-designer skill and update its refinement
phase to offer the canvas when a user asks for manual adjustment.

Exit criterion: one end-to-end session moves from AI concept to manual correction
to further AI refinement and final export.

## MVP acceptance criteria

- Works on current Chrome, Safari, and Firefox through localhost.
- Opens both 512x512 icons and 1024x512 combination marks.
- A no-op load/save retains visual fidelity and important SVG structure.
- A selected group can be moved, resized, rotated, recolored, and undone.
- Keyboard nudging supports 1-unit and 10-unit steps.
- Favicon previews update live at 64, 32, and 16 pixels.
- Saving `iteration-7.svg` creates `iteration-8.svg` without modifying the
  source iteration.
- A newly saved iteration can be opened by the editor and parsed by the existing
  logo generation and export workflow.
- File APIs cannot read or write outside the explicitly selected workspace.

## First technical experiments

1. Collect a fixture set covering paths, nested groups, text, gradients, masks,
   clip paths, filters, and transforms.
2. Measure SVG.js round-trip fidelity for each fixture.
3. Decide whether transformations should remain as `transform` attributes or be
   baked into geometry for MVP interoperability.
4. Prototype group selection and drill-down behavior on a complex logo.
5. Test atomic next-iteration saves and path-containment checks on macOS, Linux,
   and Windows.

## Open questions

- Should the canvas select only named groups by default or all top-level nodes?
- Should manual-edit metadata use an SVG `metadata` element or a namespaced data
  attribute on the root?
- Should save normalize formatting, or preserve original whitespace when
  possible?
- Is point-level path editing valuable enough for the first post-MVP milestone?
