# Public registry QA

Run **Public registry QA** only after an immutable `lineage-logo` version is
published to npm. Enter the exact semantic version, such as `0.1.0-beta.1`.
Tags (`beta`, `latest`), ranges, and version prefixes are refused before the
workflow reads the registry.

The workflow is read-only: it checks out this repository only as a test harness
and installs the selected package from `https://registry.npmjs.org`. It has no
publish, tag, release, credential, or registry-settings step.

The Linux Node 22 job is intentionally bounded to installed CLI help/version/
doctor behavior, the installed `node_modules/lineage-logo/examples/
seatify-constellation.svg` fixture, and public-output redaction. It is not a
browser-UX claim.

The macOS Node 22 Chromium job runs the full two-editor Seatify bridge from the
selected registry bytes. For beta versions that predate newer onboarding
commands, the test creates its disposable workspaces by copying the installed
fixture byte-for-byte and exercises that version’s available bridge commands.
The local-tarball path remains the pre-publication test: it continues to cover
the newer bootstrap/context behavior and is never substituted for this registry
gate.

If either job fails, keep the published version immutable. Diagnose with a new
version after a local-tarball pre-publication gate and the registry gate both
pass; never overwrite, retag as a substitute, or reuse the failed version.
