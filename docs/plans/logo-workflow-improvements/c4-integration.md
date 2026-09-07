# Visual review integration

C4 is stacked on C3. This document records the module contract, not a completed acceptance receipt.

`AgentVisualReview` in `src/client/agent/visual-review.ts` receives clean accepted and proposed SVG strings. It renders two passive SVG images, clearly labeled Accepted and Proposed, plus 16/32/64 pixel versions. Both versions share one union frame and one background control. A requested target is isolated only if valid in both versions; otherwise both use the whole document. Geometry changes are not independently fit to conceal movement/scale. Unsupported comparison is explicitly reported; existing operation evidence remains available.

Mount a dedicated host before operation details. Instantiate the controller once with an async callback to the existing reverted-decision lifecycle. The callback must pass the exact reason as the fourth argument to `agentTransport.decide(id, "reverted", undefined, reason)` and must reject on unsuccessful transmission. It must never directly mutate/revert the editor before the existing acknowledgement reconciliation. Thread this optional reason through `decideAgentReview`; do not swallow its failure for this callback. Retain existing revert-without-feedback behavior and save rollback/recovery handling.

Call `update({ transactionId, acceptedSvg, proposedSvg, target? })` when a proposal is pending. Cache clean accepted SVG before provisional acceptance so a failed save does not relabel provisionally applied content as accepted. The visual controller preserves its input/images for the same transaction ID. Call `setBusy` with the existing decision in-flight state. Call `restoreFocus` with a reachable inspector or canvas control after a terminal decision, before hiding the host via `update(undefined)`. Use a focusable fallback with the sidebar open at narrow widths.

CSS: use two `minmax(0,1fr)` grid columns and an 8px gap on `.agent-comparison-images`, zero-margin/min-width-zero figures, block images with `max-width:100%` and `background:var(--comparison-background)`. First figure image fills column width with square aspect ratio; later images retain their nominal 16/32/64 sizes. Textarea width 100%, border-box; review actions wrap. Existing scrollable review container keeps all decisions reachable at narrow widths.

## Public feedback contract

A reverted decision/status may include `revisionRequest`, a nonempty plain-text string of at most 1000 UTF-16 code units. Disallowed control characters are rejected. Markup is permitted only as literal data; UI uses text content/value and image content remains passive. The exact string is returned by the public producer client's reverted outcome. Existing v1 decisions without the optional field remain unchanged. Ordinary manifests and terminal SSE events do not carry feedback.

An exact repeated decision returns its existing receipt. Changing or omitting a previously recorded reason conflicts, as does changing the payload under an existing transaction ID. A producer must obtain a fresh manifest or bound snapshot and submit a new transaction ID for a revision; this undergoes full normal staging/review. No partial acceptance is introduced.

## Remaining integration verification

Run `visual-feedback.spec.ts` after main/CSS integration at 1280 and 760 widths. Run the existing semantic-review, durable-save, reconnect, lease and installed structural journey tests. Check actual narrow pointer reachability, keyboard focus restoration, disconnect/reload/failed-save recovery, source-file/history integrity and saved receipt digest. Capture approved public-fixture visual evidence. Focused module/protocol results alone do not satisfy C4/G3.
