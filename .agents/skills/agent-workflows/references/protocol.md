# Codex host protocol

Package: `@lineagehq/workflows@0.2.0-rc.1`; protocol: `1.0`.

Use `workflow agent <command> --store <path>` and send one JSON request on standard input. Every request uses schema `agent-workflow-protocol-request/v1`, `protocolVersion: "1.0"`, a unique `req_...` ID, the run ID, the stable host actor, an ISO timestamp, and the exact command payload. Every mutation includes the latest `expectedRevision`.

Use a stable `host_...` identity for the host session. When a command can require a human challenge, supply structured input through `--file` so stdin/stderr remain attached to the terminal. Only the human may answer that challenge. Use `agent.inspect`'s immutable `target.url`, never a reconstructed or substituted URL.

## Sequence

1. `inspect` with `{}`. It does not require `expectedRevision`.
2. `claim` with `{ "hostInstanceId": "host_..." }`.
3. `capabilities` with truthful capability records, including only available browser operations and evidence types and a finite `constraints.maxBytes`. For mobile lifecycle screenshot proof, perform the capability probe in [lifecycle.md](lifecycle.md) first.
4. For each step, `propose` one reversible action batch. Use only a returned lease whose decision is `allowed` and whose `expiresAt` has not passed.
   Verify its `leasePolicy` equals the inspection/manifest snapshot. Standard is rolling/hard/threshold 30/120/15 seconds; human-selected training-only `supervised-codex-browser` and runner-pinned routine `routine-codex-browser-v1` use 120/300/90. Lifecycle launch policy and approval checks are in [lifecycle.md](lifecycle.md). Agents cannot select or enlarge any policy.
5. Execute that batch with the installed Browser control skill. Never combine a later step into the current batch; stop mutation on unexpected state or expiry and read [recovery.md](recovery.md).

In a routine evaluation, only a proposal whose action descriptions, kinds, targets, exact requested capability IDs, order, and count match the current step's pinned batch can lease automatically. Input references and extra fields cannot match. The runner reconstructs those executor fields from the workflow; immediate outcome, stop conditions, and risk metadata are observational only. Secret input, unmatched actions, and credential, paid, destructive, externally visible, authentication, purchase, or production-mutation proposals require the exact attached-TTY allow-once challenge bound to request, proposal hash, step, run, and pre-approval revision. The lease must be the immediately following revision; any intervening event consumes the challenge. Supply the proposal via `--file`; redirected standard input, JSON fields, flags, environment, chat, callbacks, stale state, and replay are not approval authority.

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

The inspector performs the same canonical PNG/JFIF structural validation as registration and derives dimensions from the raw bytes. It does not transform them. Do not choose or modify `slot.stagingPath`, and do not stage a mismatch such as a 1552x832 capture for a 393x852 mobile slot. For every replay or evaluation, apply the manifest viewport before navigation and capture through that same retained session. Call the Browser viewport capability `reset()` during host cleanup. Lifecycle invalidation rules are in [lifecycle.md](lifecycle.md).

Then register the issued slot:

```json
{ "action": "register", "leaseId": "lease_...", "slotId": "slot_..." }
```

The runner validates the neutral slot and exact bytes as either conforming PNG (including clear chunk reserved bits) or bounded 8-bit baseline JFIF JPEG. JFIF permits only APP0(JFIF), DQT, SOF0, DHT, SOS, and EOI markers; extensions and other JPEG processes are rejected. The runner does not convert Browser output and alone derives canonical `mimeType` (`image/png` or `image/jpeg`) and the durable `.png` or `.jpg` extension. Do not infer format from `slot.stagingPath` or add an extension.

7. `commit` the lease result and complete step assessment. Set `artifacts` and every evidence reference to registered artifact ID strings only.
   Optional structured `notes` use `{ "kind": "observation|deviation|blocker", "text": "...", "evidence": [...] }` with evidence IDs registered in that same commit. Assess every expectation exactly once, in order. Never fabricate IDs, paths, hashes, sizes, timestamps, or evidence; never reuse slots or write outside the issued staging path.
8. Repeat from `inspect`. Release only when no lease is active.

Use only response `timing.runnerNow` and `timing.activeLease` for lease decisions. Heartbeat before expiry when `remainingSeconds` is at or below the pinned threshold or `heartbeatRecommended` is true. The runner derives the new expiry as `min(runnerNow + rollingSeconds, hardExpiresAt)`. At runner time `>= expiresAt`, do not heartbeat, issue/register evidence, or commit. An identical request that was already durable may be retried with the same request ID and replay the exact cached response, including its original timing, after expiry.

Inspect after each transaction and use its revision for the next mutation. On expiry, uncertain action outcome, ownership change, or revision conflict, follow [recovery.md](recovery.md) before further action.
