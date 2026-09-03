# Public registry QA

Run **Public registry QA** only after an immutable `lineage-logo` version is
published to npm. Enter the exact semantic version, such as `0.1.0-beta.1`.
Tags (`beta`, `latest`), ranges, and version prefixes are refused before the
workflow reads the registry. The workflow's single exact-SemVer preflight runs
without npm, and both registry-reading jobs depend on it; an invalid selector
therefore cannot reach `npm ci`, Playwright installation, or package install.

The workflow is read-only: it checks out this repository only as a test harness
and installs the selected package from `https://registry.npmjs.org`. It has no
publish, tag, release, credential, or registry-settings step.

The Linux Node 22 job is intentionally bounded to installed CLI help/version/
doctor behavior, the installed `node_modules/lineage-logo/examples/
seatify-constellation.svg` fixture, and public-output redaction. It is not a
browser-UX claim.

The macOS Node 22 Chromium job runs the two-editor Seatify bridge from the
selected registry bytes. Compatibility is determined only from the installed
package version, never from whether the package came from npm or a tarball.
`0.1.0-beta.1` is the one compatibility version: its bridge uses the installed
fixture and its legacy connection contract. Any later immutable version must
exercise the supported `example seatify`, `context`, and routed `submit`
commands, in addition to review, durable save, clean reopen, source
preservation, and revert behavior. Version output is checked against the
installed manifest rather than a hard-coded beta version.

The local-tarball bridge uses the same installed-version capability contract.
It remains the pre-publication gate and is never substituted for registry
bytes; it verifies that the selected artifact's supported behavior remains
reliable before publication.

If either job fails, keep the published version immutable. Diagnostics identify
the failing phase and next safe action while redacting tokens, filesystem paths,
and SVG content. Diagnose with a new version after a local-tarball
pre-publication gate and the registry gate both pass; never overwrite, retag as
a substitute, or reuse the failed version.
