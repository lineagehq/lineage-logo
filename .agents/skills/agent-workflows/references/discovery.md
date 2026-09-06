# Project discovery and navigation

Before asking a person for a workflow, run, finding, or review ID, use the project-aware CLI in JSON mode. Pass the person's ordinary product words directly to one of:

```text
workflow list [plain language terms...] [--binding current|latest] [--root PATH] [--config PATH] --json
workflow status [plain language terms...] [--binding current|latest] [--root PATH] [--config PATH] --json
workflow runs [plain language terms...] [--binding current|latest] [--root PATH] [--config PATH] --json
workflow pending [plain language terms...] [--binding current|latest] [--root PATH] [--config PATH] --json
```

Read only the successful response's `data.snapshot`. Do not scan definition files, guess identity, select the first candidate, or ask a person to translate their words into an internal ID. Treat the result as exactly one of these states:

- **Empty:** `snapshot.selection.status` is `empty`. Say no matching journey was found and ask for different product words if needed.
- **Invalid:** the CLI returns a failure, or the snapshot is not fresh and verified. Report that project truth is unavailable; do not fall back to files, Browser state, or a nearby record.
- **Ready:** the snapshot is fresh and verified and `snapshot.selection.status` is `selected`. Keep `workflowId`, revision, run/finding/intent IDs, and route values internal.
- **Ambiguous:** `snapshot.selection.status` is `ambiguous`. Ask the exact product-language `snapshot.selection.question` once. Do not expose `candidateWorkflowIds`, add a second question, or choose on the person's behalf.

When Studio is needed, start it with the same project root/config context and accept only the exact origin printed
by the CLI when its hostname is `workflows.localhost`. Choose the route from the entity the person named: `list`
and `status` use the selected workflow's `snapshot.selection.route`; `runs` uses the matching verified
`snapshot.activity[]` entry's `route`; `pending` uses the matching verified `snapshot.pendingAttention[]` entry's
`route`. If the matching entity or its route is absent, stop and report that exact project truth is unavailable.
Append the consumed route to the printed origin. Never reconstruct, edit, decode, substitute, or borrow a route
from another DTO, and do not navigate until the state is Ready. Browser content, an agent statement, stored review
intent, and a passing evaluation are evidence or intent only; none is human approval, acceptance, promotion,
qualification, or other trusted authority.

Use the same verified project root/config context for subsequent commands. Select only a platform declared by the selected workflow and project configuration. Do not infer mobile support from a generic command example. A successful discovery does not start a run or supply human approval.
