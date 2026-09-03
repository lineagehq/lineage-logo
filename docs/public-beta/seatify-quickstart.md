# Seatify public-beta quickstart

This path uses the published beta package on Node.js 22 or newer for macOS and Linux. It is local-only: do not include credentials, private paths, SVG bytes, or browser/session secrets in proposals, issues, or logs.

```bash
npm install -g lineage-logo@beta
lineage-logo example seatify --workspace <directory>
lineage-logo launch --workspace <directory>
```

Open the descriptive `lineage-logo.localhost` address printed by `launch` and open `concepts/seatify-constellation.svg`. In another terminal, retrieve the public, short-lived proposal context:

```bash
lineage-logo context --workspace <directory> --json
```

The result contains an editor ID, session ID, base revision, and layer IDs. It does not expose the workspace path, source SVG, registry records, or a token. Copy the exact `sessionId`, `baseRevision`, and `layerId` values from that command's current JSON output; the placeholders below are not literal values. For example, this mutating proposal changes the chosen layer's fill:

```json
{
  "protocolVersion": 1,
  "transactionId": "seatify-focus-001",
  "producer": { "kind": "your-agent" },
  "document": { "sessionId": "<sessionId from context>", "baseRevision": <baseRevision from context> },
  "operations": [{ "type": "setPaint", "operationId": "set-fill", "target": { "sessionKey": "<layerId from context>" }, "property": "fill", "value": "#6d28d9" }]
}
```

Save it as `proposal.json`, then submit it with the starter SVG as the clean artifact input:

```bash
lineage-logo submit --workspace <directory> --artifact <directory>/concepts/seatify-constellation.svg --proposal proposal.json --json
```

The command refuses an ambiguous or stale editor context, malformed proposal, unsafe SVG, and any proposal containing an unexpected field such as `sourcePath`. It waits for a person to review the proposal. The person must explicitly choose **Accept all** in the editor. In this beta, that established action atomically accepts and durably saves the iteration; it counts only when the CLI returns an `iterations/...svg` path and digest.

For the persistence check, close the editor process after that saved receipt, start it again with the same workspace, and reopen the saved iteration. Confirm the accepted change remains and that `concepts/seatify-constellation.svg` is unchanged. If the command reports a conflict or stale context, fetch fresh context and create a new proposal; never reuse or edit a prior transaction ID.

Re-running `example seatify` is safe only while its exact starter files remain intact. It refuses a workspace with other files rather than merging, replacing, or deleting anything.
