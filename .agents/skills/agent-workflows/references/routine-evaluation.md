# Routine candidate evaluation

After Ready discovery, use the same selected journey words:

```text
workflow evaluate desktop --journey "<selected journey words>" [--root PATH] [--config PATH] [--store PATH] --json
```

Use the mobile form only when the verified workflow supports it. Never substitute words from another product or ask the user to recover an internal ID.

For a bounded candidate loop, use `workflow evaluate desktop|mobile --journey "stable product words" --json` after Ready discovery. The positional forms `workflow evaluate desktop PATH` and `workflow evaluate mobile PATH` remain compatibility interfaces for existing automation that already holds a trusted definition path; they are not the human-to-agent handoff. The workflow must declare `execution.approvalPolicy.mode: risk-based` and exact `routineActionBatches` for every step; the fresh 1440x900 desktop or 393x852 mobile run starts without launch approval and pins runner-only `routine-codex-browser-v1`. After completion, use the returned run identity internally with `workflow report RUN_ID --store PATH`; never ask the person to copy it. The report and Studio report endpoint are restart-stable projections of durable events and reverified screenshots, not acceptance.

Read [protocol.md](protocol.md) before executing the run. Its automatic proposal and optional-handler rules apply to routine evaluation. Lifecycle launch challenges do not apply to this candidate loop.
