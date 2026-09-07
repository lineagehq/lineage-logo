# C5 integration handoff (stacked on C3)

This module package is stacked on C3 commit `8e57950`. It is not an integrated or accepted C5 receipt. Main, CSS and server route integration belong to the root integrator.

## Server wiring

Import `createWorkspaceLogo` from `./logo-creation.js`, `prepareAgentHandoff` from `./agent-handoff.js`, and `AgentProducerClient` from `../producer/agent-client.js`.

Create one in-process client after the existing identity/token initialization:

```ts
const handoffProducer = new AgentProducerClient({
  context: { protocolVersion: 1, apiOrigin: identity.apiOrigin, token: agentToken, pid: process.pid },
  binding: { instanceId, workspaceId: workspaceIdentity.workspaceId },
});
```

This object calls the existing server's public snapshot challenge/response contract; it does not create or register another server or reveal credentials.

Add these origin-checked routes before generic agent transport routing (which handles all other `/api/agent/*` paths), and before static routing:

```ts
if (request.method === "POST" && url.pathname === "/api/concepts") {
  validateRequestOrigin(request);
  const body = await readJsonBody(request, 5 * 1024 * 1024 + 16 * 1024);
  const file = await createWorkspaceLogo(workspaceRoot, body);
  sendJson(response, 201, { file });
  return;
}
if (request.method === "POST" && url.pathname === "/api/agent/handoff") {
  validateRequestOrigin(request);
  const body = await readJsonBody(request, 1024 * 1024);
  response.setHeader("Cache-Control", "no-store");
  sendJson(response, 200, await prepareAgentHandoff(body, handoffProducer));
  return;
}
```

## Main wiring

Allocate an explicit per-tab `const editorId = crypto.randomUUID()` and pass `editorId` to the existing `AgentCanvasTransport` constructor. Do not create a second transport. Instantiate `GuidedCreationController` after the existing editor and agent session/transport are initialized:

```ts
new GuidedCreationController({
  host: document.body,
  current: () => {
    if (!editor.svgNode || !agentSession || agentSession.pending || editor.hasProvisionalEdits) return undefined;
    return { editorId, ...agentSession.context,
      selectedLayerIds: editor.selectedNodes.map(node => node.dataset.lineageKey!).filter(Boolean) };
  },
  openCreated: async file => {
    // Refresh workspace choices and use the ordinary unsaved-work file-open guard.
    // This callback must also surface any opening failure through the existing app status.
  },
});
```

Expose visible buttons named **Create a logo**, **Import SVG** and **Prepare agent handoff**. The first two must remain discoverable after opening a document, and both must be visible in the empty state. Avoid duplicate simultaneously visible accessible names. Route clicks to `openCreate("create")`, `openCreate("import")` and `openHandoff()` respectively. The module creates its own accessible modal and safe text-only content.

Minimal CSS suggestion (root owns stylesheet):

```css
.guided-creation-dialog { width: min(36rem, calc(100vw - 2rem)); max-height: calc(100vh - 2rem); overflow: auto; }
.guided-creation-field { display: grid; gap: .4rem; margin-block: 1rem; }
.guided-creation-field input, .guided-creation-field select, .guided-creation-field textarea { box-sizing: border-box; width: 100%; min-width: 0; }
.guided-creation-dialog button { margin: .25rem; }
```

Link the shipped `docs/public-beta/agent-handoff.md` from the existing public quickstart/README entry point as appropriate.

## Acceptance evidence and remaining checks

At module checkpoint, `npm run check` passes: 697 unit tests in 41 files, type checking, and production build. Nine dedicated tests cover exact import bytes, empty creation, concurrent name collision, immutable existing files/symlinks, malformed/active/external/oversized import rejection, current snapshot binding, stale source/editor/session/revision/selection, and truthful producer-neutral instructions.

`tests/e2e/guided-creation-installed.spec.ts` is the actual UI/installed CLI acceptance journey. It packs/installs the package, reads shipped instructions, starts an empty workspace, cancels creation, creates a blank file, rejects a scripted import, safely imports a colliding filename, downloads a bound current handoff, submits a structural artifact through the installed CLI, accepts a durable continuation, makes an unsaved manual text correction, downloads a fresh selected-target handoff, submits and accepts a narrow paint follow-up, then restarts and verifies the continuation and both originals. It is type-checked but **not yet run**, because this module package intentionally does not edit root-owned UI/routes.

After integration run this installed test, all relevant browser acceptance (including narrow/keyboard reachability), request-origin rejection and review/CI gates. Do not mark C5/G3 accepted from module-only checks or call the scripted journey independent-human evidence.
