# Structural proposals and preserving follow-ups

Use `lineage-logo snapshot --workspace /tmp/lineage-logo-workspace --json` to capture the accepted live SVG, including unsaved manual edits, session, revision and digest. Ordinary `context` remains redacted. See [live snapshots](live-snapshot.md).

## Construct from an artifact

Create a clean standalone SVG with one root-level group having a stable unique ID (for example `brand`). Put transforms inside/on that group; include needed resources in its subtree or root `defs`. The command copies the group and the transitive local gradients, masks, symbols and `use` dependencies it references. It does not copy unrelated artwork. Required outside resources must be direct children of `defs`. Missing/duplicate IDs, unsafe content and ancestors whose inherited presentation would be lost are rejected; choose a self-contained root group in those cases.

Write a public proposal using the snapshot's session and base revision. Omit `svg` on exactly one `addLayer` or `replaceLayer` operation:

```json
{
  "protocolVersion": 1,
  "transactionId": "construct-brand-1",
  "producer": { "kind": "local-producer" },
  "document": { "sessionId": "SESSION_FROM_SNAPSHOT", "baseRevision": 0 },
  "operations": [
    { "type": "addLayer", "operationId": "brand", "parent": null, "placement": "last" }
  ]
}
```

```sh
lineage-logo validate --proposal proposal.json --artifact brand.svg --group-id brand --json
lineage-logo submit --workspace /tmp/lineage-logo-workspace --proposal proposal.json --artifact brand.svg --group-id brand --json
```

For replacement, use `type: "replaceLayer"` and `target: {"sessionKey":"LAYER_ID_FROM_SNAPSHOT"}` instead of `parent`/`placement`. Artifact mode rejects multiple structural operations or conflicting explicit `svg`; all other operation fields are validated normally. Existing document ID collisions and damage to outside references reject the whole transaction. No artwork or file changes before the reviewer accepts. Accept and save creates one undo step and returns the durable file path and SHA-256 digest.

## Make a narrow correction

Obtain a fresh snapshot after the person's manual adjustments. Submit only the properties that need changing. Operation-only proposals need no artifact:

```json
[
  { "type": "translateLayer", "operationVersion": 1, "operationId": "move", "target": { "sessionKey": "ICON_LAYER_ID" }, "dx": 4, "dy": -2 },
  { "type": "setText", "operationVersion": 1, "operationId": "tagline", "target": { "sessionKey": "TEXT_LAYER_ID" }, "value": "Made for you" }
]
```

Put this array in the public proposal's `operations`, retaining its fresh session/revision and a new transaction ID, then run `lineage-logo submit --workspace /tmp/lineage-logo-workspace --proposal proposal.json --json`.

`translateLayer` precomposes a translation in the target parent's SVG coordinates, preserving its existing transform and descendant geometry. A parent scale/rotation affects the visible movement. Offsets must be finite, at most ±1,000,000,000 and are normalized to six decimals by the canvas transform validator. `setText` changes only plain unstructured `text` content using the manual editor's validator (2,048 characters, no markup/control characters). Structured `tspan` content is rejected. Typography, resources and other layers remain untouched. Both operations require `operationVersion: 1`; unknown versions/fields are rejected. Whole no-op transactions, stale revisions or locks reject without any partial changes or history step.

The six original transaction-v1 operations and legacy `--artifact` without `--group-id` remain compatible. That legacy flag only validates an SVG; it does **not** derive proposal content. Prefer omitting it for paint/focus/text/move changes and use explicit `--group-id` for artifact-driven content. `lineage-logo schema` includes all eight operations and executable examples. Artifact templates are preprocessed into this schema before delivery.
