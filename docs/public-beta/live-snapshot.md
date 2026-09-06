# Live artwork snapshot

Run `lineage-logo snapshot --workspace <directory> --json` to request the selected
editor's current accepted artwork, including unsaved manual edits. This command
returns artwork intentionally; ordinary `context` stays redacted and never calls
the snapshot endpoint. No external provider receives the result automatically.

The version-1 `snapshot` contains exact clean SVG bytes, their SHA-256 `digest`,
instance/workspace/editor/server identities, `sessionId`, and `baseRevision`.
`selectedLayerIds` and `primaryLayerId` use stable document layer keys, including
id-less elements. Each layer includes its optional SVG ID, element-child-index
`svgPath` into those exact bytes, parent key, explicit transform, root-relative
matrix, explicit/computed paint, effective visibility and inherited locks.
Geometry bounds are axis-aligned geometric `getBBox()` corners transformed into
root SVG coordinates, excluding stroke/filter/marker expansion; they are not a
painted-pixel extent. Hidden/unmeasurable geometry and missing viewBoxes carry an
explicit `unsupported` status instead of invented coordinates.

Capture is synchronous in the browser. A one-use server challenge binds it to the
current editor lease, server generation, session and revision. The server checks
those bindings again after the reply; stale results fail instead of mixing
revisions. Pending or provisional review refuses capture. Snapshot messages do
not enter transaction replay/history; capture does not select, edit, save, or
create an undo entry. Later edits can make a captured proposal context stale, so
submit using that snapshot's session/revision and request another after conflict.

Limits: 5 MiB SVG, 12 MiB response, 5,000 layers, eight simultaneous requests and a
five-second response deadline. Passive inline CSS/style rules and local fragment
resources are preserved. Active SVG, external references, CSS escapes and
at-rules are unsupported and fail without changing the document. No filesystem
source path, connection credential, or editor metadata is added to the response.
Authored SVG text and metadata are artwork and remain present in this explicit
export. Error output contains a safe code and a next action, never raw artwork.
