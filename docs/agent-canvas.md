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

## Local proposal schema and validation (v1)

The installed CLI ships a provider-neutral JSON Schema and six complete examples,
including add, replace, rename, reorder, paint and focus. No running editor or
connection token is needed to inspect or validate these inputs:

```sh
lineage-logo schema > proposal-v1.schema.json
lineage-logo schema --json
lineage-logo validate --proposal proposal.json --json
lineage-logo validate --proposal proposal.json --artifact logo.svg --json
```

Without `--json`, `schema` emits the JSON Schema document directly. With `--json`,
it returns the usual result envelope with a `schema` property. Each `examples`
entry is a complete proposal: replace its session/revision and layer keys using
fresh `context` before submission. Existing protocolVersion 1 producers and
`submit --artifact ... --proposal ...` syntax remain supported.

Schema validation describes all allowed fields and code-point bounds, but standard
JSON Schema alone does **not** enforce every v1 string bound. V1 counts UTF-16
code units, while JSON Schema `maxLength` counts Unicode code points. Every bounded
text field therefore also carries `x-maxUtf16CodeUnits`: for example, 300 emoji
have 600 UTF-16 code units and exceed the 512-unit rename bound even though a
standard validator permits 300 code points. Consumers must enforce this annotation
or run the local validator before delivery. An AJV keyword can implement it with
`type: "string", schemaType: "number", validate: (limit, value) => value.length <= limit`.
The local validator additionally enforces UTF-16 string bounds, encoded payload limits, unique operation IDs,
earlier-operation references, SVG fragment structure/safety and paint policy.
Unknown versions, operations and fields fail closed. Add/replace fragments must
contain exactly one selectable layer. V1 fragments allow only SVG elements and
unqualified, XLink or namespace-declaration attributes: `xml:lang` and `xml:space`
are rejected by the fragment evaluator even though standalone artifact SVG allows
them. This existing v1 distinction also applies during local validation.
Embedded active content, external resources
and reserved metadata fail before editor discovery or delivery. Local validation
is read-only and creates no workspace files or review. Document-dependent target,
lock, resource collision, stale revision and no-op evaluation still occurs in the
editor; local success does not promise that a proposal can be accepted.

Errors keep stable exit codes and add a machine-readable `error` object containing
`code`, optional `operationId`, bounded `field`, and `nextAction`. Messages do not
reflect raw parser exceptions, arbitrary field names, SVG or private paths.
`stale_document`, `timeout`, `conflict`, `unavailable_editor`, `reviewer_rejection`
and protocol validation codes are distinct. On timeout inspect the editor and
existing transaction outcome first; never blindly create a duplicate submission.
After reviewer rejection or stale context, obtain fresh context and create a
revised proposal with a new transaction identity.
