# Public beta release checklist

This checklist separates evidence the repository currently produces from owner
decisions and external publication steps. A green local suite is necessary, but
it is not sufficient to publish a public beta.

## Automated gates

- `npm ci` succeeds without sibling repositories or local tarball dependencies.
- `npm run check` passes typechecking, unit/integration tests, and both builds.
- `npm run test:e2e` passes the complete Playwright Chromium suite.
- The release critical path passes in Playwright Chromium, Firefox, and WebKit.
  Firefox/WebKit results are critical-engine smoke only; WebKit is not Safari.
- `npm audit --omit=dev --audit-level=high` has no high-or-critical production
  findings at the time of release.
- `npx tsx scripts/release-check.ts` accepts only intended package files,
  installs the tarball in isolation, repeats installation of the same artifact,
  validates the installed CLI, redacts public output, and cleans up safely.
- The canonical Seatify fixture remains `examples/seatify-constellation.svg`;
  tests consume it directly or through an ephemeral byte-identical copy.

## Required observed evidence

- Observe successful Node 22 clean-install jobs on both Ubuntu and macOS. Workflow
  configuration alone is not a passing platform result.
- Preserve the passing full Chromium result and the narrower Firefox/WebKit
  critical-smoke results with the release candidate.
- Preserve the completed fresh-install Seatify evidence: the packed artifact
  launched two editors, failed closed on ambiguity, targeted workspace and
  instance explicitly, completed human Accept and Revert, durably saved clean
  accepted bytes to a source-specific continuation, preserved both sources,
  redacted output, and cleaned up. The installed walkthrough passed twice.
- Preserve the completed hosted publication and public-registry QA evidence for
  `lineage-logo@0.1.0-beta.2`, including its signed SLSA provenance. The package
  is published under `beta`; `latest` remains `0.1.0-beta.1`.

## Owner policy decisions

The owner selected the MIT license and GitHub Issues for best-effort support with
no SLA. Version `0.1.0-beta.2` is published under npm's `beta` dist-tag with
signed SLSA provenance; hosted publication and exact public-registry QA passed.
The `latest` dist-tag remains `0.1.0-beta.1`. These facts do not constitute
external-user validation: **0/3 independent walkthroughs** have been completed.
The owner also explicitly accepted releasing without a private
vulnerability-reporting channel. The beta cannot accept reports that require
confidentiality; public issues must not contain sensitive vulnerability details.
No external outreach is authorized by this checklist.

## Explicit initial limitations

- Node.js 22 or newer; macOS and Linux are the intended initial targets. Windows
  is not supported for the initial beta.
- The supported browser claim is Chromium. Firefox and WebKit have only one
  critical smoke workflow; native Safari has not been tested.
- Automated accessibility evidence covers a bounded keyboard and semantic-control
  smoke. It is not WCAG 2.2 AA conformance or an assistive-technology audit.
- The release check proves same-artifact reinstall, not migration from an older
  Lineage Logo version.
- Failure artifacts contain sanitized metadata only. Screenshots, traces, SVG
  bytes, credentials, registry details, and workspace paths are not collected.
- The application is local-only and sends no product telemetry or cloud traffic
  by default. Package-manager and browser behavior remains governed by those
  tools, not by Lineage Logo.
- No confidential vulnerability-reporting route is available. This is an
  accepted release risk and must remain conspicuous in `SECURITY.md`.

## Rollback

If any required gate or walkthrough fails, do not publish. If a beta is already
published, deprecate the affected version in the registry, identify the last
known-good version in the release notes, and issue a new version after the full
gate passes. Do not overwrite or reuse an npm version.
