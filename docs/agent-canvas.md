# Logo-designer skill adapter

The adapter is deliberately a protocol client, not an editor plugin. It reads an SVG
artifact produced by the [logo-designer skill](https://github.com/neonwatty/logo-designer-skill),
selects one stable layer, embeds any root-level SVG resources that layer references,
reads the open document manifest, and posts protocol v1 JSON to the authenticated local
API. It does not import canvas, history, workspace, or browser modules.

The upstream skill writes complete SVG concepts and iterations, keeps meaningful group
IDs stable while refining, and produces a clean final `logo.svg`. Use one of those IDs as
the adapter selector and manifest layer name. Read a token without echoing it, export it,
then start the editor:

```bash
read -s "LINEAGE_LOGO_AGENT_TOKEN?Agent token: " && echo
export LINEAGE_LOGO_AGENT_TOKEN
npm run dev -- --workspace /absolute/path/to/logos
```

Submit a generated or refined layer to the open document. The token value does not
appear in these commands, their argument lists, or URLs:

```bash
npm run agent:submit -- \
  --api http://127.0.0.1:4173 \
  --mode replace \
  --artifact /absolute/path/to/logos/iterations/iteration-2.svg \
  --selector '#logo' \
  --target-name logo
```

The proposal arrives in Agent review and remains isolated until accepted. `--mode add`
uses the same artifact/selector pair and accepts an optional `--parent-name` or
`--parent-key`. A narrow follow-up adjustment can use the public paint operation:

```bash
npm run agent:submit -- \
  --api http://127.0.0.1:4173 \
  --mode set-paint --target-name logo --property fill --value '#0ea5e9'
```

Layer names must resolve exactly once in the current manifest. Session keys can instead
be passed as `--target-key` or `--parent-key`. The adapter binds every transaction to the
manifest session, source path, and monotonic revision returned immediately before the
submission. Authentication, payload limits, dedupe, SSE delivery, detached evaluation,
review, accept/revert, history, and clean serialization therefore remain the canvas's
existing public boundaries.

Accept and revert are exact-origin terminal acknowledgements. The same decision is
idempotent and a conflicting terminal decision is rejected. The browser advances its
SSE cursor only after staging acknowledgement succeeds; an unacknowledged frame is
replayed from cached evaluation without duplicating review or editor effects. Pending
review blocks document switching. Page unload queues a reverted decision, falls back to
a keepalive request when the browser rejects the beacon, and the server automatically
reverts abandoned pending reviews after 30 minutes.

Representative input covering nested groups, transforms, gradients, referenced symbols,
text, and safe unsupported SVG descendants lives in
`tests/fixtures/agent/logo-designer-output.svg`.
