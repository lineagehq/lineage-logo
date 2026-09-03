# Seatify public-beta quickstart

This path uses the published beta package on Node.js 22 or newer for macOS and Linux. It is local-only: do not include credentials, private paths, SVG bytes, or browser/session secrets in proposals, issues, or logs.

Create a fresh local install project and a separate empty Seatify workspace, then
install only the published registry package selected by `@beta`. The fixed root
must not already exist; `set -e` stops rather than reusing it.
The install project and Seatify workspace are separate directories.

```bash
set -eu
walkthrough_root="/tmp/lineage-logo-seatify-walkthrough"
test ! -e "$walkthrough_root"
mkdir -p "$walkthrough_root/install" "$walkthrough_root/seatify-workspace"
cd "$walkthrough_root/install"
npm init -y
npm install --save-exact lineage-logo@beta
npx lineage-logo --version
npx lineage-logo example seatify --workspace "$walkthrough_root/seatify-workspace"
npx lineage-logo launch --workspace "$walkthrough_root/seatify-workspace"
```

Immediately record the exact version printed by `lineage-logo --version` (for example,
`0.1.0-beta.2`). `@beta` is only the install selector; the receipt must use the exact
installed prerelease version, never the mutable tag.

Open the descriptive `lineage-logo.localhost` address printed by `launch` and open `concepts/seatify-constellation.svg`. In another terminal, retrieve the public, short-lived proposal context:

```bash
cd /tmp/lineage-logo-seatify-walkthrough/install
npx lineage-logo context --workspace /tmp/lineage-logo-seatify-walkthrough/seatify-workspace --json
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
cd /tmp/lineage-logo-seatify-walkthrough/install
npx lineage-logo submit --workspace /tmp/lineage-logo-seatify-walkthrough/seatify-workspace --artifact /tmp/lineage-logo-seatify-walkthrough/seatify-workspace/concepts/seatify-constellation.svg --proposal proposal.json --json
```

The command refuses an ambiguous or stale editor context, malformed proposal, unsafe SVG, and any proposal containing an unexpected field such as `sourcePath`. It waits for a person to review the proposal. The person must explicitly choose **Accept all** in the editor. In this beta, that established action atomically accepts and durably saves the iteration; it counts only when the CLI returns an `iterations/...svg` path and digest.

For the persistence check, close the editor process after that saved receipt,
start it again with the same concrete workspace, and reopen the saved iteration:

```bash
cd /tmp/lineage-logo-seatify-walkthrough/install
npx lineage-logo launch --workspace /tmp/lineage-logo-seatify-walkthrough/seatify-workspace
```

Confirm the accepted change remains and that
`concepts/seatify-constellation.svg` is unchanged. If the command reports a
conflict or stale context, fetch fresh context and create a new proposal; never
reuse or edit a prior transaction ID.

Re-running `example seatify` is safe only while its exact starter files remain intact. It refuses a workspace with other files rather than merging, replacing, or deleting anything.
