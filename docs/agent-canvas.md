# Logo-designer skill adapter

The adapter is deliberately a protocol client, not an editor plugin. It reads an SVG
artifact produced by the [logo-designer skill](https://github.com/neonwatty/logo-designer-skill),
selects one stable layer, embeds any root-level SVG resources that layer references,
reads the open document manifest, posts protocol v1 JSON to the authenticated local
API, waits for a terminal review outcome, and returns the exact clean accepted SVG
receipt. It does not import canvas, history, workspace, or browser modules.

The upstream skill writes complete SVG concepts and iterations, keeps meaningful group
IDs stable while refining, and produces a clean final `logo.svg`. Use one of those IDs as
the adapter selector and manifest layer name. Start the editor normally:

```bash
npm run dev -- --workspace /absolute/path/to/logos
```

Submit a generated or refined layer to the open document. The token value does not
appear in these commands, their argument lists, or URLs:

```bash
npm --silent run agent:submit -- \
  --mode replace \
  --artifact /absolute/path/to/logos/iterations/iteration-2.svg \
  --selector '#logo' \
  --target-name logo
```

The server publishes its active loopback origin and bearer capability to a private,
owner-only runtime descriptor. The adapter discovers and validates that regular file;
credentials never appear in command arguments, URLs, logs, examples, or output errors.
Set `LINEAGE_LOGO_CONTEXT_FILE` on both processes only when an alternate descriptor path
is needed. The proposal arrives in Agent review and remains isolated until accepted.
`--mode add`
uses the same artifact/selector pair and accepts an optional `--parent-name` or
`--parent-key`. A narrow follow-up adjustment can use the public paint operation:

```bash
npm --silent run agent:submit -- \
  --mode set-paint --target-name logo --property fill --value '#0ea5e9'
```

Layer names must resolve exactly once in the current manifest. Session keys can instead
be passed as `--target-key` or `--parent-key`. The adapter binds every transaction to the
manifest session, source path, and monotonic revision returned immediately before the
submission. Authentication, payload limits, dedupe, SSE delivery, detached evaluation,
review, accept/revert, history, and clean serialization therefore remain the canvas's
existing public boundaries.

The command remains active for a bounded wait and every invocation prints exactly one
versioned, secret-free `lineage.logo-designer.adapter-receipt` JSON object on stdout,
without diagnostic logging. Invalid arguments/artifacts and an unavailable canvas use
strict pre-transaction envelopes with no fabricated transaction or document identity.
Once a manifest exists, the receipt
binds the transaction ID, session ID, source path, base revision, and typed accepted,
reverted, rejected, stale, unavailable, conflict, or timeout outcome. A temporary editor
disconnect is non-terminal: the producer keeps its bounded wait active because the server
can redeliver that same transaction after reconnect. An accepted
mutating result contains the transaction-bound `sourcePath`, next `revision`, and clean
`svg`. The upstream skill's explicit-opt-in `lineage-handoff.mjs` consumes that receipt
only on stdin; it does not locate or spawn Lineage and accepts no credential or API
origin. It atomically publishes accepted bytes as the next collision-safe numbered
iteration, rereads and byte-compares the published file, hashes it, and emits only
metadata. The consumer accepts protocol-v1's full 4096-character source path and a
JSON-encoded envelope large enough for a maximally sized clean artifact. File data and
supported containing-directory metadata are synchronized before the verified receipt
allows continuation. Callers continue from that verified iteration path. Non-accepted or malformed
receipts create no file and provide fixed stop/retry guidance; timeout and conflict never
resubmit automatically. Standalone `logos/preview.html` remains the default workflow.
Every manifest, status, result, impact entry, error code, and decision response is
validated at runtime against protocol v1 and the submitted transaction. Accepted SVG is
parsed without repair as one complete standalone root and rejected for malformed XML,
multiple roots, active/external content, editor handles, reserved metadata, or protocol
attributes. The shared policy also enforces XML 1.0 legal literal characters and numeric
references, permits only the SVG and legacy XLink namespaces, and denies scripts,
foreign content, links, style/CSS, event handlers, animation, `set`, `discard`, external
references, URL-bearing attributes, and equivalent post-parse activation paths. One
exported adversarial conformance corpus runs unchanged at shared validation, server
acknowledgement, browser decision, and producer outcome boundaries. Unknown states and
error codes fail closed as conflicts. Current logo-designer fixtures and the clean saved
oracle artifact are compatibility-tested against the same policy.

The grammar gate is the shared strict, namespace-aware `saxes` parser pinned exactly to
6.0.0. It runs in XML 1.0 document mode in both Node and the Vite browser bundle. Any
parser error aborts validation before semantic events can produce acceptance; DTDs,
entity declarations, and non-declaration processing instructions are rejected, and no
external entity resolver or recovery path is installed. The dependency is ISC-licensed
and its only transitive package is MIT-licensed `xmlchars` 2.2.0. Lock integrity,
production audit, single-copy installation, and browser bundle ceilings are verified as
part of the integration gate.

Accepted decision bodies use a fixed `2 × 5 MiB + 128 KiB` encoded-envelope ceiling.
Strict clean XML can at most double when JSON escapes its raw SVG characters; the
remaining allowance conservatively covers the bounded source path, transaction ID,
revision, and exact acknowledgement keys. This larger bound applies only to the
exact-origin acknowledgement route. Transaction submissions remain capped at 5 MiB,
document synchronization remains capped at 1 MiB, and accepted SVG validation still
enforces the independent raw 5 MiB limit before lifecycle state can change.

Accept and revert are exact-origin terminal acknowledgements. Accept first applies the
detached candidate provisionally, advances the document revision, serializes the clean
SVG, and only then records the artifact receipt. The transaction remains pending and
all document mutation, history, saving, and file switching stay locked until that exact
receipt converges. A lost response is retried idempotently with the same receipt. A
definitive server revert, rejection, stale result, or conflicting accepted receipt
restores the exact pre-accept document, selection, revision, and history; a matching
already-accepted receipt finalizes the provisional edit. A mutating transaction cannot
become observably accepted without its receipt. Undo and redo remain both functionally
and visibly disabled during every provisional snapshot transition. The browser advances its
SSE cursor only after staging acknowledgement succeeds; an unacknowledged frame is
replayed from cached evaluation without duplicating review or editor effects. Pending
review blocks document switching. Each stream begins with a strict, secret-free UUID
server-instance event. Ordinary reconnects retain that identity and replay cursor;
an inactivity watchdog crosses proxy-held dead streams before reconnecting. Server
replacement resets the cursor and clears only a detached matching review. Strict
terminal events contain only transaction ID plus `accepted`, `reverted`, `rejected`, or `stale`,
and reconcile only that exact pending transaction. If replacement loses the authority
for a provisional acceptance, the canvas stays locked and labels an explicit “Restore
previous document” action; it never guesses whether the missing server accepted it.
That action rolls back only the exact provisional checkpoint before unlocking. Ordinary
same-tab disconnects and reloads do not decide on the user's behalf. While review is
pending, the browser keeps the exact clean base SVG plus transaction-bound session,
source path, and revision in tab-scoped storage. Before restoring those bytes, it uses
an exact-origin recovery request carrying all four identity fields. The response is
strictly validated and returns the original transaction plus authoritative pending or
terminal state, or a secret-free unknown result. An accepted receipt restores only its
exact clean artifact as one history checkpoint. Reverted, timed-out, rejected, and stale
states apply nothing. Unknown, mismatched, and replacement-server records are cleared
and the workspace file is opened without restoring stale tab bytes. Transient recovery
failure opens or changes nothing and retains the record for retry. The server retains the original
transaction frame while it is pending and replays it only when all three document
identity fields match; the browser reconstructs the same detached candidate and sends
an idempotent staged acknowledgement. Explicit Accept and Revert transitions also append
a strict, retained terminal SSE event. This closes the snapshot/subscription race: when
recovery returns pending but the prior page's decision commits before the replacement
stream subscribes, the retained event causes the new page to query the authoritative
artifact/state and converge it. Concurrent duplicate terminal delivery is coalesced; a
second accepted notification cannot apply again or add history. Malformed or truncated
HTTP 200 recovery bodies are retryable and preserve the exact tab record without opening
or mutating a document; authoritative unknown and exact 4xx identity mismatch remain the
only terminal stale-record paths. Accept or Revert remains a fresh explicit,
keyboard-accessible decision after recovery. The review lock is announced and mutation,
history, saving, and switching stay unavailable until terminal convergence. The server
automatically reverts an abandoned pending review after 30 minutes. If tab storage cannot
persist and reread the exact base record, the browser rejects staging before pending
review begins, unlocks editing, and returns an explicit rejected outcome to the producer.

Representative input covering nested groups, transforms, gradients, referenced symbols,
text, and safe unsupported SVG descendants lives in
`tests/fixtures/agent/logo-designer-output.svg`.
