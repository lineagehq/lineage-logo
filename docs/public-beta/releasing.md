# Owner-run beta release

`Publish beta` is deliberately a manual, inert-until-owner-configured release
workflow. It publishes a single new public `lineage-logo` beta version only after
the repository owner has configured the `npm-publish` GitHub environment and npm
trusted publisher for this repository and workflow. It uses GitHub OIDC and
`npm publish --provenance`; it never receives an npm token from this repository.

The intended trusted-publisher identity is exact: GitHub repository
`lineagehq/lineage-logo`, workflow file `.github/workflows/publish-beta.yml`,
environment `npm-publish`, npm package `lineage-logo`, and a public package
whose observable `package.json` `repository.url` is
`git+https://github.com/lineagehq/lineage-logo.git`. The workflow checks those
observable repository, workflow, package, public-access, and `repository.url`
values immediately before publishing. Owner configuration at npm and GitHub is
still **unproven** until an explicitly authorized hosted run succeeds.
The trusted publisher's allowed action must be exactly `npm publish`; do not
configure a broader, staged, or other npm action as a substitute.

That configuration and a successful hosted run are owner-only actions. This
repository workflow is not evidence that trusted publishing or provenance is
operational. Do not dispatch it, register a trusted publisher, alter the
environment, authenticate, or publish until the owner explicitly authorizes the
live validation.

## Preconditions enforced by the workflow

Run the workflow only from the current `main` commit. It fetches `origin/main`
and rejects a manually selected ref or SHA that is not exactly current main.
Enter a new exact version matching `package.json`, in the form
`0.1.0-beta.N`. Tags such as `beta` or `latest`, version ranges, prefixes, and
non-beta versions are refused. The workflow accepts version absence only when
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
the `beta` dist-tag to the newly published version. The workflow does not
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
dispatch **Public registry QA** with the exact immutable version and commit
whenever publishing succeeded—even if those later diagnostics fail. This
asynchronous `gh workflow run` call only attempts to start the separate
read-only post-publication gate; it does not wait for or enforce registry-QA
success, and a successful handoff does not claim registry QA completed.
Publication is immutable, so a registry-QA failure must be diagnosed and
corrected in a new beta version after the prepublish gates pass. Observe the
dispatched registry-QA run before claiming the registry artifact is validated; see
[Public registry QA](registry-qa.md) for its exact-version rules and coverage.
