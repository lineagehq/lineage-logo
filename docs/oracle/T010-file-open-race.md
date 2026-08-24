# T010 atomic file-open race oracle

The 2026-08-24 oracle ran the editor through Vite with the real local server,
authenticated public logo-designer adapter, streamed SSE staging, review UI, and
file-open lifecycle. A local pass-through held the real `concept-2.svg` response
after Vite received it; the response bytes were not mocked.

- `concept-1.svg` was the visible canonical document when the delayed open began.
- While that response was held, transaction `t010-delayed-revert` was submitted
  through the public adapter and reached `pending_review` through SSE.
- Releasing the response left the selected file, file controls, canonical SVG,
  document size, save/dirty state, pending review, and producer state unchanged.
- Revert was operated by keyboard and converged to producer status `reverted`.
  A subsequent open committed `concept-2.svg` successfully.
- A second public transaction was accepted by keyboard on `concept-2.svg` and
  converged to producer status `accepted`. The dirty-document confirmation was
  then accepted and a subsequent open committed `concept-1.svg` successfully.
- Browser warnings and console errors: zero.

The deterministic regression uses the same extracted commit coordinator as the
application, real `AgentSession.stage`, and the T002 transaction evaluator. It
also resolves two eligible file loads out of order and proves that only the
newest response commits.
