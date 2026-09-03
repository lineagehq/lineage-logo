# Owner-run beta release

`Publish beta` is deliberately a manual, inert-until-owner-configured release
workflow. It publishes a single new public `lineage-logo` beta version only after
the repository owner has configured the `npm-publish` GitHub environment and npm
trusted publisher for this repository and workflow. It uses GitHub OIDC and
`npm publish --provenance`; it never receives an npm token from this repository.

The intended npm trusted-publisher identity is exact: GitHub repository
`lineagehq/lineage-logo`, workflow filename `publish-beta.yml`, environment `npm-publish`,
npm package `lineage-logo`, and allowed action exactly `npm publish`. The public package
contract requires `repository.type` to be
`git`, `repository.url` to be
`git+https://github.com/lineagehq/lineage-logo.git`, `publishConfig.access` to
be `public`, `publishConfig.tag` to be `beta`, and no `publishConfig.registry`.
The workflow checks those observable repository, workflow, package, and publish
values immediately before publishing. Owner configuration at npm and GitHub is
still **unproven** until an explicitly authorized hosted run succeeds.
Do not configure a broader, staged, or other npm action as a substitute.

That configuration and a successful hosted run are owner-only actions. This
repository workflow is not evidence that trusted publishing or provenance is
operational. Do not dispatch it, register a trusted publisher, alter the
environment, authenticate, or publish until the owner explicitly authorizes the
live validation.

## Preconditions enforced by the workflow

Run the workflow only from the current `main` commit. It fetches `origin/main`
and rejects a manually selected ref or SHA that is not exactly current main.
Enter a new exact version matching `package.json`, in the form
`0.1.0-beta.N`. Every major, minor, patch, and beta numeric identifier must be
either `0` or start with `1`–`9`; leading-zero versions such as
`00.1.0-beta.1`, `0.01.0-beta.1`, `0.1.00-beta.1`, and `0.1.0-beta.01` are
refused. Tags such as `beta` or `latest`, version ranges, prefixes, and non-beta
versions are also refused. The workflow accepts version absence only when
npm returns its exact `E404` result for the fully specified `lineage-logo@version`
lookup. Network, timeout, DNS, authentication, and other registry failures fail
closed with bounded safe diagnostics; they are never interpreted as absence.

Before any publish attempt it runs the complete local release gates: dependency
installation, `npm run check`, production audit, Chromium browser QA, and the
narrow Firefox and WebKit critical smokes. Only after those pass it creates one
tarball, records its path and SHA-512 digest, and meaningfully checks that exact
file in an isolated install (installed CLI version and help). The publish job
downloads that single artifact and verifies its recorded path and digest before
calling `npm publish` on the tarball path, so npm cannot repack the checkout.
GitHub actions use the repository-standard major-pinned
`actions/checkout@v7` and `actions/setup-node@v7` references; update them
together with the other repository workflows when upstream security guidance
requires it.

npm trusted publishing requires Node.js 22.14.0 or later and npm 11.5.1 or
later. This workflow pins Node.js 22.14.0 and installs the exact
`npm@11.5.1` client, then asserts both versions before it can publish. Package
manager caching is disabled in the release job so a prior dependency cache is
not part of protected publish execution.

## Publication and immutable follow-up

The only publish command is `npm publish <verified-tarball> --tag beta --provenance`, which assigns
the `beta` dist-tag to the newly published version. After the dist-tag snapshot,
the same shell step re-fetches `origin/main`, asserts the workflow SHA is still
current main immediately before that publish command, and publishes the verified
tarball. The workflow does not
publish or target `latest`, and it does not invoke a separate `npm dist-tag add`
or `npm dist-tag rm` repair. It requires `beta` to resolve to the exact new
version after publication. It captures a machine-readable dist-tag map
immediately before publish and compares it after publish: only `beta` may
change, and it must point to the requested exact version. Every other tag,
including `latest`, must remain byte-for-byte unchanged; addition, removal, or
replacement fails the postpublish invariant. It intentionally reports the npm
first-package `latest` anomaly instead of trying to repair it.

After a successful publish, exact-version and beta-tag visibility are checked
with a bounded retry. A separate always/conditional handoff job attempts to
dispatch **Public registry QA** to the fixed `lineagehq/lineage-logo` repository
on `--ref main` with the exact immutable version whenever publishing
succeeded—even if those later diagnostics fail. The explicit repository target
keeps this dispatch executable on the handoff job's fresh runner, which has no
checkout from which GitHub CLI could infer a repository. This
asynchronous `gh workflow run` call only attempts to start the separate
read-only post-publication gate; it does not wait for or enforce registry-QA
success, and a successful handoff does not claim registry QA completed.
Publication is immutable, so a registry-QA failure must be diagnosed and
corrected in a new beta version after the prepublish gates pass. Observe the
dispatched registry-QA run before claiming the registry artifact is validated; see
[Public registry QA](registry-qa.md) for its exact-version rules and coverage.
