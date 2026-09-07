# 0.1.0-beta.4 — logo workflow improvements

This beta contains the logo workflow improvements merged through September 7, 2026. These notes describe the release candidate; publication and registry verification must be confirmed from the release workflow and npm metadata.

- Create or import a logo, hand the current document to an agent, and review substantive structural proposals with explicit acceptance or revision feedback. Narrow follow-up proposals preserve manual corrections.
- Adjust multiple objects with consistent selection, layer controls, transforms and inspector behavior. Saved-baseline undo and recoverable manual drafts improve continuity across editing and reopening.
- Save named versions without replacing the active document. Export full artwork, a mark or a wordmark as SVG, and generate sized PNG assets with transparent, white or black backgrounds.
- Receive explicit refusals for stale or locked proposal targets and recover from an interrupted save or offline review without silently losing manual work.

The integrated source passed installed CLI/UI workflows, independent SVG parsing and PNG pixel checks, 129 browser cases across Chromium and critical Firefox/WebKit journeys, a 15-fixture corpus, and matched interaction-performance checks. The publishing workflow revalidates this version's candidate before publication; exact-version public registry QA follows publication.

Node.js 22 or newer on macOS and Linux remains the initial target. Firefox and WebKit coverage is limited to the defined critical journeys; WebKit is not native Safari. Automated accessibility, keyboard and focus checks do not establish blanket WCAG conformance. Real VoiceOver observation is deferred and unverified. Independent usability-study results remain pending.

Install the published beta in your project with `npm install --save-exact lineage-logo@beta`, or select this immutable version with `npm install --save-exact lineage-logo@0.1.0-beta.4` once publication is verified. Use the [Seatify quickstart](seatify-quickstart.md) to start the local editor. This release updates the `beta` channel; `latest` remains a separate tag.
