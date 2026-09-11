# Change-based CI

CI always classifies the complete Git diff, then runs the selected jobs. Mixed
changes combine categories. Unknown paths and empty comparisons run the full
application suite. Deletions are included; renames are treated as delete/add pairs.

| Changes | Validation |
| --- | --- |
| Root documentation and Markdown under docs/ | Local Markdown links and image references |
| site/ | Local HTML, CSS, image and video references; Pages validates before deployment |
| README.md and docs/public-beta/ | npm dry-run packaging check without lifecycle scripts |
| All other paths, including source, fixtures, dependencies, tests and workflows | Full application CI plus content checks |

The content checker checks local file existence, not remote URL availability,
Markdown style, fragment anchors, or browser rendering. Packaging validation proves
tracked public-beta documents are included; it does not replace release installation
tests. Publish beta still runs its complete release gates.

`CI passed` rejects failed, cancelled, missing, or unexpectedly skipped selected
jobs. Configure it as a required status check after this workflow has landed.
Existing required `verify` and `browser-qa` jobs retain their names and are
intentionally skipped on documentation-only changes. Keep those protections until
the aggregate check is available, then require `CI passed` as well.

GitHub-managed CodeQL default setup is independent of these workflows and continues
running under its current repository settings. Scheduled extended quality evidence
and manually dispatched registry/publish workflows are unchanged.

Validate routing with `node --test scripts/ci/changes.test.mjs`. Validate references
with `python3 scripts/ci/content.py` and package documentation with
`npm pack --dry-run --ignore-scripts --json | python3 scripts/ci/package-content.py`.
