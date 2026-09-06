# Workflow instruction cleanup

The workflow skill previously combined routine evaluation, lifecycle approvals, recovery, and setup in one entry point. It also used another product's journey vocabulary and contained conflicting instructions about who answers qualification challenges.

The entry point now routes to operation-specific references. Commands use words from the verified journey selection and only supported platforms. Lifecycle guidance consistently assigns terminal approval responses to the human. Shared execution guidance preserves runner-issued identities, exact screenshot bytes, lease timing, revision checks, optional-handler scope, and recovery boundaries.

The root skill decreased from 16,311 to 2,676 bytes. Repository AGENTS.md remains unchanged because its descriptive local-preview URL requirement is still applicable.

Validation: the skill validator passed, all local reference links resolve, and whitespace checks passed. The relocated constraints were checked against the previous skill and protocol. No application code or workflow runtime changed; this validation does not claim a live workflow run or fresh-model behavioral evaluation.
