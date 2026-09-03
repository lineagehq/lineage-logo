# Public agent proposal contract

Lineage Logo accepts provider-neutral, human-reviewed proposal files through the installed `lineage-logo` CLI. No named-provider adapter or editor plugin is required.

Start from the public context projection:

```bash
lineage-logo context --workspace <directory> --json
```

It returns protocol version 1 plus only an ephemeral editor ID, session ID, base revision, and layer IDs with their visible names/types/lock state. It never prints an API token, registry descriptor, source path, SVG bytes, or browser secret. The proposal schema is also version 1 and must contain `protocolVersion`, `transactionId`, `producer`, `document.sessionId`, `document.baseRevision`, and one to 100 ordered operations. Its document object must not contain `sourcePath` or any other field.

Submit a clean SVG artifact and proposal with:

```bash
lineage-logo submit --workspace <directory> --artifact <artifact.svg> --proposal <proposal.json> --json
```

The CLI obtains the private source binding only from the selected live editor. Before delivery it validates the proposal schema, the artifact's strict clean SVG policy, and that the submitted session/revision exactly match the live manifest. Missing, stale, ambiguous, malformed, or unavailable context fails closed; a producer must obtain fresh public context and issue a new transaction.

The editor evaluates a proposal separately, then a human explicitly chooses **Accept all** or **Revert**. For mutations, success is reported only after an explicit saved iteration receipt is present. Reopen that iteration after a clean editor restart and verify the source SVG remains unchanged before treating the handoff as complete.
