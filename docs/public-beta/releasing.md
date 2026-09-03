# Owner-run beta release

`Publish beta` is deliberately a manual, inert-until-owner-configured release
workflow. It publishes a single new `lineage-logo` beta version only after the
repository owner has configured the `npm-publish` GitHub environment and npm
trusted publisher for this repository and workflow. It uses GitHub OIDC and
`npm publish --provenance`; it never receives an npm token from this repository.

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
non-beta versions are refused. The workflow also asks npm whether that exact
version already exists and refuses version reuse.

Before any publish attempt it runs the complete local release gates: dependency
installation, `npm run check`, production audit, Chromium browser QA, the
narrow Firefox and WebKit critical smokes, and the isolated tarball release
check. GitHub actions use the repository-standard major-pinned
`actions/checkout@v7` and `actions/setup-node@v7` references; update them
together with the other repository workflows when upstream security guidance
requires it.

npm trusted publishing requires Node.js 22.14.0 or later and npm 11.5.1 or
later. This workflow pins Node.js 22.14.0 and installs the exact
`npm@11.5.1` client, then asserts both versions before it can publish. Package
manager caching is disabled in the release job so a prior dependency cache is
not part of protected publish execution.

## Publication and immutable follow-up

The only publish command is `npm publish --tag beta --provenance`, which assigns
the `beta` dist-tag to the newly published version. The workflow does not
publish or target `latest`, and it does not invoke a separate `npm dist-tag add`
or `npm dist-tag rm` repair. It captures npm's dist-tags before and after
publishing, requires `beta` to resolve to the exact new version, and fails if
any non-beta tag (including `latest`) changes. This intentionally reports the
npm first-package `latest` anomaly instead of trying to repair it.

After the exact published version and tag invariants pass, the workflow
dispatches **Public registry QA** with that exact immutable version. This
asynchronous `gh workflow run` call only starts the separate read-only
post-publication gate; it does not wait for or enforce registry-QA success.
Publication is immutable, so a registry-QA failure must be diagnosed and
corrected in a new beta version after the prepublish gates pass. Observe the
dispatched registry-QA run before claiming the registry artifact is validated; see
[Public registry QA](registry-qa.md) for its exact-version rules and coverage.
