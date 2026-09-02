# Codex host protocol

Package: `@lineagehq/workflows@0.2.0-rc.1`

Protocol: `1.0`

Use `workflow agent <command> --store <path>` and send one JSON request on standard input. Every request uses schema `agent-workflow-protocol-request/v1`, `protocolVersion: "1.0"`, a unique `req_...` ID, the run ID, the stable host actor, an ISO timestamp, and the exact command payload. Every mutation includes the latest `expectedRevision`.

## Project discovery and navigation

Translate ordinary product language through `workflow list|status|runs|pending [terms...] --binding current|latest --root PATH --config PATH --json`. Options may be omitted when their documented defaults are intended. A successful response carries the one shared `DiscoverySnapshot` at `data.snapshot`; do not independently resolve project paths or scan workflow files.

Branch on the complete state before operating Browser:

1. `empty`: report that no journey matches. No identity or route is available.
2. invalid: a failed CLI response, stale freshness, degraded integrity, or unverified inventory is unavailable truth. Stop instead of guessing or falling back.
3. ready: only a fresh, verified snapshot with `selection.status: "selected"` identifies one journey. Keep every ID and encoded route internal.
4. `ambiguous`: show the human exactly `selection.question`, once. The question already distinguishes candidates in product language. Never expose or ask for `candidateWorkflowIds` and never select the first candidate.

For a ready selection, start Studio with the same `--root`/`--config` context and verify that the CLI-printed
origin uses `workflows.localhost`. A workflow `list` or `status` request consumes `selection.route`; a `runs`
request consumes the matching verified `activity[].route`; a `pending` request consumes the matching verified
`pendingAttention[].route`. If that exact entity or route is absent, stop. Append only the consumed route and give
Browser only that combined target. Never synthesize a route from an ID, reconstruct one from another DTO,
substitute another candidate, or treat a visible Studio page as identity proof.

Discovery and evaluation do not grant authority. Browser actions, agent messages, review intents, operational requests, evaluation status, and passing proof cannot become `actorKind: "human"`, `authority: "trusted"`, or acceptance. Only the exact attached-terminal challenge at a runner-defined boundary supplies human authority.

Use stable matcher vocabulary from Ready discovery for `workflow train --journey "shared fictional card" --platform PLATFORM`, `workflow replay candidate --journey "shared fictional card" --platform PLATFORM`, and `workflow promote --journey "shared fictional card" --replay RUN_ID`. Their positional PATH forms remain compatibility only for automation that already holds a trusted path; never ask a human for one. After restart, rerun `workflow status shared fictional card --json` and consume `snapshot.lifecycle` to recover exact promotion, qualification, group, member, and route identities internally. Never scan, guess, ask for IDs, or reconstruct them. Verified group identity reports `outcome: "not-asserted"`; it is not a passed evaluation. Immutable lineage commands may use recovered IDs and revisions internally.

The agent drives discovery, command startup, leased Browser execution, replay/evaluation finalization, and status rereads. The attached-terminal human alone answers the fresh CLI challenge for candidate or promoted replay launch, promotion, each desktop/mobile qualification, both evaluation-member launches, and acceptance. The agent may announce that the terminal is waiting but must never relay, paste, retype, or answer a challenge. Every boundary reverifies its own durable truth; authority never flows from an earlier prompt, evaluation result, Browser state, or chat.

## Collaboration transactions

Use `review-intent record|list|show`, `acceptance record|list|show`, and `run pause|stop|emergency-stop|resume` only after ordinary product words resolve to a ready shared snapshot. Keep exact identities in JSON and CLI arguments internal; human summaries must remain ID-free. Every mutation reads a strict JSON file. Neutral review and run-control requests require the current expected revision plus an opaque `req_...` idempotency key and receive server-owned neutral provenance.

`run resume` and `acceptance record` always read a fresh command-generated challenge from real attached stdin/stderr TTYs, even in JSON mode. No request field, `--approve` flag, environment value, redirected stdin, Browser/Studio action, evaluation result, agent callback, or chat message can answer it. The agent may start the command and explain that the terminal is waiting, but must never relay or answer the challenge. Acceptance independently reverifies the exact latest revision, content hash, evaluation group, members, receipts, qualifications, runs, and artifacts before the prompt and again immediately before append-only commit.

After fresh, verified Ready discovery, use `workflow evaluate desktop --journey "shared fictional card" --json` or its `mobile` form with the same stable product words. Consume its JSON internally; never request a definition path or ID from the human, scan files, guess a selection, or reconstruct a route. Terms must come from visible matcher vocabulary, not hidden route details. The CLI reuses one configured catalog and launches its exact verified selected source. Positional `workflow evaluate desktop PATH` and `workflow evaluate mobile PATH` remain compatibility only for callers already holding a trusted definition path. Use `workflow report RUN_ID --store PATH` internally for the durable report. Routine launch has no approval event, and a passing evaluation remains evidence rather than acceptance. Every step pins exact `routineActionBatches`; the `routine-codex-browser-v1` policy is 120/300/90 and cannot be selected by an agent. `agent.inspect` returns the immutable effective and canonical target URLs; never invent or substitute another URL.

## Sequence

1. `inspect` with `{}`. It does not require `expectedRevision`.
2. `claim` with `{ "hostInstanceId": "host_..." }`.
3. `capabilities` with truthful capability records. Before a mobile lifecycle run advertises Codex Browser screenshot evidence, retain one Browser tab/session handle, apply `set({ width: 393, height: 852 })` to that handle, and capture a `fullPage: false` probe from the same handle. Pass the raw probe bytes to `inspectScreenshotBytes` and include `browser.control`, adapter identity, supported browser operations, `evidenceTypes: ["screenshot"]`, and a finite `constraints.maxBytes` only when the inspector derives exactly 393x852. Otherwise omit the screenshot capability and stop the lifecycle run. Never substitute a tab/session, trust reported viewport values, or crop, resize, convert, or otherwise change the probe bytes.
4. For each step, `propose` one reversible action batch. Use only a returned lease whose decision is `allowed` and whose `expiresAt` has not passed.
   Verify its `leasePolicy` equals the inspection/manifest snapshot. Standard is rolling/hard/threshold 30/120/15 seconds; a human-selected training-only `supervised-codex-browser` run is 120/300/90. New replay/evaluation launches are human-approved `human-approved-codex-browser-v1` 120/300/90 with hash `sha256:8d811677611c1e86e02f7c9f6bd44695260416e99dedc4c062ab7fd816399717`. Agents cannot select or enlarge any policy.
5. Execute that batch with the installed Browser control skill.

In a routine evaluation, only a proposal whose action descriptions, kinds, targets, exact requested capability IDs, order, and count match the current step's pinned batch can lease automatically. Input references and extra fields cannot match. The runner reconstructs those executor fields from the workflow; immediate outcome, stop conditions, and risk metadata are observational only. Secret input, unmatched actions, and mandatory-sensitive proposals require the exact attached-TTY allow-once challenge bound to request, proposal hash, step, run, and pre-approval revision. The lease must be the immediately following revision. Supply the proposal via `--file`; redirected standard input, JSON fields, flags, environment, chat, callbacks, stale state, and replay are not approval authority.

For a referenced routine dismissal, issue its exact before-state screenshot with `optionalHandlerId` set to the attached handler, then register it under the automatic parent lease. Ordinary evidence omits this field; shared checkpoint text does not make artifacts interchangeable. Authorize with parent lease, handler, and evidence IDs only; the runner returns the pinned named-dialog/Close scope and contract hash. Apply exactly that scope and complete it at the immediately next revision using the authorization ID and identical IDs. Include the handler evidence in commit. Generic Close/Escape, extra capabilities, caller-authored executor fields, stale or replayed authority, and second application fail closed.
6. For a screenshot requirement, call `evidence` with:

```json
{
  "action": "issue",
  "leaseId": "lease_...",
  "stepId": "current-step",
  "checkpoint": "declared-checkpoint",
  "capabilityId": "browser.control",
  "type": "screenshot"
}
```

Using the retained tab handle from the same Browser Node session that applied the viewport, capture and inspect the bytes before any staging write:

```js
const screenshotOutput = await tab.screenshot({ fullPage: false });
if (
  !ArrayBuffer.isView(screenshotOutput) ||
  screenshotOutput.BYTES_PER_ELEMENT !== 1 ||
  Object.prototype.toString.call(screenshotOutput) !== "[object Uint8Array]"
) throw new Error("Browser screenshot did not return bytes");
const screenshotBytes = new Uint8Array(
  screenshotOutput.buffer,
  screenshotOutput.byteOffset,
  screenshotOutput.byteLength,
);
const { inspectScreenshotBytes } = await import("@lineagehq/workflows");
const screenshot = inspectScreenshotBytes(screenshotBytes);
if (screenshot.width !== slot.viewport.width || screenshot.height !== slot.viewport.height) {
  throw new Error(
    `Browser screenshot ${screenshot.width}x${screenshot.height} does not match ${slot.viewport.width}x${slot.viewport.height}`,
  );
}
const { writeFile } = await import("node:fs/promises");
await writeFile(slot.stagingPath, screenshotBytes, { flag: "wx" });
```

The inspector performs the same canonical PNG/JFIF structural validation as registration and derives dimensions from the raw bytes. It does not transform them. Do not choose or modify `slot.stagingPath`, and do not stage a mismatch such as a 1552x832 capture for a 393x852 mobile slot. Then call `evidence` with:

For every replay or evaluation, call the Browser viewport capability before navigation on the retained capture tab/session using the manifest value: desktop-web is `set({ width: 1440, height: 900 })`; mobile-web is `set({ width: 393, height: 852 })`. Never capture through a different handle. The runner binds the slot to that viewport and independently derives PNG/JFIF dimensions from bytes; it rejects mismatches. Call `reset()` during host cleanup. If the run retries or receives intervention, guidance, pause/resume, emergency stop, reconciliation, handoff, unexpected state, uncertainty, deviation, or a capability gap, do not finalize it; start a fresh run.

Lifecycle human prompts follow complete replay verification. Type qualification text only when it includes the exact workflow ID, revision, platform, effective hash, and replay run ID. For evaluation, verify the immutable group is inspectable before approving either fresh member; refusal must leave the member awaiting approval.

```json
{ "action": "register", "leaseId": "lease_...", "slotId": "slot_..." }
```

The runner validates the neutral slot and exact bytes as either conforming PNG (including clear chunk reserved bits) or bounded 8-bit baseline JFIF JPEG. JFIF permits only APP0(JFIF), DQT, SOF0, DHT, SOS, and EOI markers; extensions and other JPEG processes are rejected. The runner does not convert Browser output and alone derives canonical `mimeType` (`image/png` or `image/jpeg`) and the durable `.png` or `.jpg` extension. Do not infer format from `slot.stagingPath` or add an extension.

7. `commit` the lease result and complete step assessment. Set `artifacts` and every evidence reference to registered artifact ID strings only.
   Optional structured `notes` have a `kind`, `text`, and same-commit evidence IDs.
8. Repeat from `inspect`. Release only when no lease is active.

Use only response `timing.runnerNow` and `timing.activeLease` for lease decisions. Heartbeat before expiry when `remainingSeconds` is at or below the pinned threshold or `heartbeatRecommended` is true. The runner derives the new expiry as `min(runnerNow + rollingSeconds, hardExpiresAt)`. At runner time `>= expiresAt`, do not heartbeat, issue/register evidence, or commit. An identical request that was already durable may be retried with the same request ID and replay the exact cached response, including its original timing, after expiry.

## Honest capability boundary

Training preflight can report `missingCapabilities` while remaining active. Continue only through steps whose evidence can be proven. At the first step requiring a recorded gap, propose only the capabilities needed to execute the bounded browser action; do not falsely request the unavailable proof capability. After the action lease is issued, commit the following assessment fragment with the full committed result:

```json
{
  "assessment": {
    "stepId": "inspect-preview",
    "expectations": [
      {
        "expectation": "Exact workflow expectation",
        "outcome": "blocked",
        "observation": "Not assessable because media-inspection is unavailable.",
        "evidence": []
      }
    ],
    "proposedOutcome": "blocked",
    "block": {
      "code": "capability_unavailable",
      "capability": "media-inspection"
    }
  },
  "artifacts": []
}
```

Include every expectation exactly once. The runner rejects this block unless the run is training, preflight recorded the named gap, and the current step requires it. Descendants become dependency-blocked and cleanup still runs.

## Recovery

- On `REVISION_CONFLICT`, inspect and rebuild the request against current state; do not reuse the request ID with changed input.
- Retry an identical evidence request with the same request ID after interrupted response delivery. The runner reconstructs the exact response.
- On `LEASE_EXPIRED`, stop browser mutation and inspect. The first fresh request at or after the exact expiry durably records the runner-owned expiry; this never asserts whether the external action executed. If that request is inspect, it returns the reconciliation state. Any other command records expiry, returns `LEASE_EXPIRED`, and must be followed by inspect. Lease-scoped evidence slots and optional authority are invalidated. Reconcile the named uncertain lease, then use a fresh lifecycle run rather than retrying the possibly executed action.
- On ownership or reconciliation errors, do not claim success from visible state alone.

## Fresh-agent handoff

Before a production run, start a new Codex agent in the repository root. Ask it to report whether `agent-workflows` appears in the skill catalog supplied to that fresh session and to read the installed contract through `$agent-workflows`. Keep that report with the readiness audit. Do not treat a directory listing or the installer test as runtime discovery evidence.
