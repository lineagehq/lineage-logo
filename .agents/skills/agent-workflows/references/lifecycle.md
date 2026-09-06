# Training and lifecycle operations

Use the same Ready discovery and stable product words for the candidate lifecycle:

```text
workflow train --journey "<selected journey words>" --platform desktop-web [--root PATH] [--config PATH] [--store PATH] --json
workflow replay candidate --journey "<selected journey words>" --platform desktop-web [--root PATH] [--config PATH] [--store PATH] --json
workflow promote --journey "<selected journey words>" --replay RUN_ID [--root PATH] [--config PATH] [--store PATH] --json
```

The positional `train PATH`, `replay candidate PATH`, and `promote PATH` forms remain compatibility interfaces only for existing automation that already holds a trusted definition path. After any restart, rerun `workflow status` with the same product words and consume `data.snapshot.lifecycle` internally. That read-only projection recovers the exact latest promotion, qualifications, evaluation group, and member identities and routes; never ask the person to recover them, scan files, or reconstruct them. A verified group identity has `outcome: "not-asserted"` and does not mean its evaluations passed. Immutable follow-on commands such as promoted replay, qualification, evaluation finalize/inspect, and acceptance may use the IDs and revisions recovered from JSON internally.

Keep the authority sequence explicit. The agent may discover, start commands, operate leased Browser work, finalize completed replay/evaluation records, and reread status. A human at the attached terminal must personally answer the CLI-generated boundary for candidate or promoted replay launch, promotion, each platform qualification, both evaluation-member launches, and acceptance. The agent may say that the terminal is waiting, but must never relay, paste, retype, or answer any challenge. Each later phase uses fresh reverified truth; no earlier approval, evaluation result, Browser state, or chat statement carries authority forward.

## Phase approvals and proof

- A retry, guidance/intervention, pause/resume, emergency stop, reconciliation, handoff, unexpected state, uncertainty, deviation, or capability gap invalidates lifecycle proof. Stop and use a fresh run identity.
- Expect new replay/evaluation launch approval text to repeat `human-approved-codex-browser-v1`, `120/300/90`, and policy hash `sha256:8d811677611c1e86e02f7c9f6bd44695260416e99dedc4c062ab7fd816399717`. Expect promotion and qualification approval prompts only after the runner has reverified the complete replay. Qualification text must repeat workflow ID, revision, platform, effective hash, and replay run ID. Evaluation member approval requires an already durable immutable group; refusal leaves the run awaiting approval.

The attached-terminal human alone may type qualification text. Before handing over, verify that the challenge identifies the exact workflow, revision, platform, effective hash, and replay run. The agent may explain that input is needed but must never type, relay, or answer the challenge. Verify the immutable evaluation group is inspectable before either member's human approval.

For Browser execution, read [protocol.md](protocol.md). Use only the selected workflow's supported platform. Set the manifest viewport on the retained capture session before navigation: desktop-web is 1440×900; mobile-web is 393×852. Before advertising mobile screenshot capability, capture `fullPage: false` on that same session and require `inspectScreenshotBytes` to derive exactly 393×852 from the unmodified bytes. If the probe fails, omit that proof capability and stop the lifecycle run. Never crop, resize, convert, or switch sessions to manufacture proof.

Resume and acceptance records use [run-controls.md](run-controls.md). Acceptance independently reverifies the exact latest revision, content hash, evaluation group, members, receipts, qualifications, runs, and artifacts before the human prompt and immediately before append-only commit. On a capability gap or uncertain outcome, read [recovery.md](recovery.md); invalid lifecycle proof requires a fresh run identity.
