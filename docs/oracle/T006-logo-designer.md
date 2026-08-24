# T006 logo-designer browser oracle

Run against the authenticated local API and the real Chromium editor on 2026-08-24.
The browser used the same-origin Vite SSE route and the production editor transaction,
review, history, and workspace-save paths; no mock transport or editor was used.

- Viewports: 1440 × 1000 and 1024 × 768
- Flow: receive and preview → locate impacted layer → revert → resend and accept →
  undo → redo → manual fill refinement → targeted agent paint adjustment → accept →
  save iteration → open concept → reopen saved iteration
- Review preview remained isolated from the accepted canvas and save serialization.
- Preview and accept controls were operated from keyboard focus; impact and hierarchy
  controls were locatable by accessible name.
- Browser warnings, console errors, and uncaught page errors: 0
- Saved bytes: 1406
- Saved SHA-256: `9924cc41da04b412345b0db459ca3d5db6dec72e47a752f72c9180ca822a0a25`
- Structural checks retained the source root viewBox and unrelated accent, clip, mask,
  and filter resources. The explicit replacement introduced `logo`, `agent-gradient`,
  `agent-spark`, and `wordmark`; the targeted explicit delta set `fill="#0ea5e9"`.
- Saved bytes exactly matched the reopened `/api/svg` response.
- No `data-lineage-*`, `metadata#lineage-logo-edit`, agent-review, transaction, or
  transport metadata was present in the saved SVG.
