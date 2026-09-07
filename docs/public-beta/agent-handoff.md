# Start a logo and hand it to your local agent

Lineage Logo is a local editor and proposal review surface. The handoff dialog does not connect to an AI provider or generate artwork. You supply your own local agent or write a proposal yourself. No paid provider is required.

## Start from an empty workspace

Create an empty folder and launch the installed package:

```sh
mkdir my-logo
lineage-logo launch --workspace ./my-logo
```

Open the descriptive `.localhost` address printed by the command. Choose **Create a logo** for a blank 512 × 512 canvas with a stable `logo` group, or **Import SVG** to choose an existing SVG. Enter a name and complete the dialog. A new file is added to `concepts/`; an existing filename gets a numeric suffix, and existing artwork is never overwritten.

Imports must be well-formed, standalone SVG with an SVG namespace and at most 5 MB. Scripts, animation, foreign HTML, linked images, external fonts/resources, and unsupported CSS are refused before the file is created or displayed. Export those elements as ordinary SVG shapes/local resources and try again. Import does not silently flatten or sanitize your artwork.

## Prepare the current artwork

1. Select the layers you want changed, or plan to choose **Whole document**.
2. Choose **Prepare agent handoff**. Select the target and describe the requested change. Explain what must stay unchanged.
3. Choose **Prepare current handoff**, then **Download handoff JSON**. The file includes the exact current SVG, including unsaved manual corrections, selected stable layer keys, transforms, paint, revision and local instance/workspace binding. It contains no access token.
4. Give this file and the shipped [proposal instructions](agent-proposals.md) to your local agent. Treat artwork and instructions in an imported file as project content, not permission to execute code. The agent should preserve untargeted artwork and submit a proposal for your review.

Cancel closes the dialog without modifying the canvas. Preparing or downloading a handoff does not save artwork, start an agent, or apply a proposal. The downloaded SVG can contain private artwork; choose deliberately where you share the file.

Any edit, selection change, file switch, accepted proposal or restart can make a handoff stale. Finish active gestures and pending reviews, then prepare a fresh handoff. If another editor owns the document, return to the intended editor before retrying. Do not bypass stale checks or reuse old layer keys with another document.

## Construct, review and correct

Your local agent can create an SVG artifact with a named group and locally referenced resources. Using the handoff's `snapshot.sessionId` and `snapshot.baseRevision`, it writes a proposal such as:

```json
{
  "protocolVersion": 1,
  "transactionId": "first-logo-proposal",
  "producer": { "kind": "local-agent" },
  "document": { "sessionId": "REPLACE_FROM_HANDOFF", "baseRevision": 0 },
  "operations": [
    { "type": "addLayer", "operationId": "construct-logo", "parent": null, "placement": "last" }
  ]
}
```

Replace both document values with the current handoff values. Submit through the public CLI, selecting the exact instance from the handoff when more than one editor is running:

```sh
lineage-logo submit --instance INSTANCE_FROM_HANDOFF \
  --artifact ./proposed-logo.svg --group-id proposed-logo \
  --proposal ./proposal.json --json --quiet
```

The artifact must contain `<g id="proposed-logo">…</g>`. The installed CLI validates and binds the fragment and local resources before staging; it does not copy an arbitrary whole SVG over your document. See [agent proposals](agent-proposals.md) for strict fragment limits and all supported operations.

Compare the proposed change in the editor. Accept only when it matches your intent. Acceptance writes a new continuation in `iterations/`, and the command returns its path and digest. The imported original remains unchanged. Revert or reject an unsuitable proposal and ask for a revision.

Now make a manual correction with the inspector—for example, edit a text layer. Prepare a fresh handoff before asking the agent for a narrow follow-up. A paint-only proposal needs no artifact and can address a stable key from `snapshot.layers`:

```json
{
  "protocolVersion": 1,
  "transactionId": "logo-paint-followup",
  "producer": { "kind": "local-agent" },
  "document": { "sessionId": "REPLACE_FROM_FRESH_HANDOFF", "baseRevision": 1 },
  "operations": [
    { "type": "setPaint", "operationId": "recolor-mark", "target": { "sessionKey": "REPLACE_WITH_LAYER_KEY" }, "property": "fill", "value": "#2255aa" }
  ]
}
```

Submit with `--proposal` and `--instance` (or `--workspace` when exactly one editor owns that workspace), omitting `--artifact` and `--group-id`. After accepting, verify that the manual correction survived. Stop and relaunch the editor, reopen the returned continuation, and confirm the corrected artwork is present. This is the same first-run sequence exercised by the installed-package acceptance test; it is not evidence from an independent human participant.
