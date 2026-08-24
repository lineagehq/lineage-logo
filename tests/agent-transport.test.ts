import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { AgentTransport, type AgentTransportOptions } from "../src/server/agent-transport";
import { HttpError, sendJson } from "../src/server/http";
import { AGENT_MAX_PAYLOAD_BYTES, type AgentTransactionV1 } from "../src/shared/agent-protocol";
import { evaluateAgentTransaction } from "../src/client/agent/transaction";
import { submitLogoDesignerTransaction } from "../scripts/logo-designer-adapter";
import { AgentSession, type AgentSessionEditor } from "../src/client/agent/session";
import { History } from "../src/client/history/history";

const token = "transport-test-secret";
const origin = "http://127.0.0.1:5173";
const running: Array<{ server: Server; transport: AgentTransport }> = [];
const runningVite: ViteDevServer[] = [];

async function harness(options: Partial<AgentTransportOptions> = {}, editorOrigin = origin) {
  const transport = new AgentTransport({ token, editorOrigin, heartbeatMs: 60_000, ...options });
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (!await transport.route(request, response, url)) sendJson(response, 404, { error: "not found" });
    } catch (error) {
      sendJson(response, error instanceof HttpError ? error.status : 500, { error: error instanceof Error ? error.message : "failed" });
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test address");
  running.push({ server, transport });
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  for (const vite of runningVite.splice(0)) await vite.close();
  for (const item of running.splice(0)) {
    item.transport.close();
    item.server.close();
    await once(item.server, "close");
  }
});

async function availablePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No available port");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

function payload(id: string, name = "Name") {
  return JSON.stringify({
    protocolVersion: 1,
    transactionId: id,
    producer: { kind: "test", name: "transport" },
    document: { sessionId: "session", sourcePath: "concept.svg", baseRevision: 0 },
    operations: [{ type: "renameLayer", operationId: "rename", target: { sessionKey: "layer" }, name }],
  });
}

const producerHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const browserHeaders = { Origin: origin, "Content-Type": "application/json" };

async function submit(base: string, body: string, headers: HeadersInit = producerHeaders) {
  return await fetch(`${base}/api/agent/transactions`, { method: "POST", headers, body });
}

async function acknowledge(base: string, id: string, body: unknown, headers: HeadersInit = browserHeaders) {
  return await fetch(`${base}/api/agent/transactions/${id}/ack`, { method: "POST", headers, body: JSON.stringify(body) });
}

async function openEvents(base: string, lastEventId?: number) {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/agent/events`, {
    headers: { Origin: origin, ...(lastEventId === undefined ? {} : { "Last-Event-ID": String(lastEventId) }) },
    signal: controller.signal,
  });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  const next = async () => {
    while (!buffered.includes("\n\n")) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error("SSE ended");
      buffered += decoder.decode(chunk.value, { stream: true }).replaceAll("\r", "");
    }
    const boundary = buffered.indexOf("\n\n");
    const block = buffered.slice(0, boundary);
    buffered = buffered.slice(boundary + 2);
    if (block.startsWith(":")) return await next();
    const fields = Object.fromEntries(block.split("\n").map((line) => {
      const split = line.indexOf(":");
      return [line.slice(0, split), line.slice(split + 1).trimStart()];
    }));
    return { id: Number(fields.id), event: fields.event, data: JSON.parse(fields.data) as AgentTransactionV1 };
  };
  return { response, controller, next, closed: reader.closed };
}

describe("real HTTP agent transport", () => {
  it("enforces bearer authentication and exact dynamic browser origin while synchronizing the manifest", async () => {
    const base = await harness();
    expect((await submit(base, payload("auth"), { "Content-Type": "application/json" })).status).toBe(401);
    expect((await fetch(`${base}/api/agent/events`, { headers: { Origin: "http://127.0.0.1:9999" } })).status).toBe(403);
    const manifest = { sessionId: "session", sourcePath: "concept.svg", revision: 0, layers: [{ sessionKey: "layer", name: "Layer", type: "path", locked: false }] };
    expect((await fetch(`${base}/api/agent/document`, { method: "POST", headers: browserHeaders, body: JSON.stringify(manifest) })).status).toBe(200);
    const documentResponse = await fetch(`${base}/api/agent/document`, { headers: { Authorization: `Bearer ${token}` } });
    expect(await documentResponse.json()).toEqual(manifest);
  });

  it("delivers in order, acknowledges browser staging, deduplicates exact bytes, and rejects ID conflicts", async () => {
    const base = await harness();
    const events = await openEvents(base);
    expect((await submit(base, payload("tx-1"))).status).toBe(202);
    expect((await submit(base, payload("tx-2"))).status).toBe(202);
    expect((await events.next()).data.transactionId).toBe("tx-1");
    expect((await events.next()).data.transactionId).toBe("tx-2");
    const ack = { transactionId: "tx-1", status: "staged", impact: [] };
    const ackResponse = await fetch(`${base}/api/agent/transactions/tx-1/ack`, { method: "POST", headers: browserHeaders, body: JSON.stringify(ack) });
    expect((await ackResponse.json() as { status: string }).status).toBe("pending_review");
    expect((await submit(base, payload("tx-1"))).status).toBe(200);
    expect((await submit(base, payload("tx-1", "Different"))).status).toBe(409);
    events.controller.abort();
  });

  it("rejects malformed evaluator acknowledgements without cancelling delivery timeout", async () => {
    const base = await harness({ deliveryTimeoutMs: 25 });
    const events = await openEvents(base);
    await submit(base, payload("malformed-ack"));
    await events.next();
    expect((await acknowledge(base, "malformed-ack", {
      transactionId: "malformed-ack", status: "rejected", error: null,
    })).status).toBe(400);
    await new Promise((resolve) => setTimeout(resolve, 40));
    const state = await fetch(`${base}/api/agent/transactions/malformed-ack`, { headers: { Authorization: `Bearer ${token}` } });
    expect((await state.json() as { status: string }).status).toBe("rejected");
    events.controller.abort();
  });

  it("automatically reverts an abandoned pending review", async () => {
    const base = await harness({ reviewTimeoutMs: 25 });
    const events = await openEvents(base);
    await submit(base, payload("abandoned-review"));
    await events.next();
    expect((await acknowledge(base, "abandoned-review", {
      transactionId: "abandoned-review", status: "staged", impact: [],
    })).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 40));
    const state = await fetch(`${base}/api/agent/transactions/abandoned-review`, { headers: { Authorization: `Bearer ${token}` } });
    expect((await state.json() as { status: string }).status).toBe("reverted");
    events.controller.abort();
  });

  it("converges accepted decisions for producers idempotently and rejects conflicting terminal decisions", async () => {
    const base = await harness();
    const events = await openEvents(base);
    expect((await submit(base, payload("accept-http"))).status).toBe(202);
    await events.next();
    const staged = { transactionId: "accept-http", status: "staged", impact: [] };
    expect((await acknowledge(base, "accept-http", staged)).status).toBe(200);
    const accepted = await acknowledge(base, "accept-http", { transactionId: "accept-http", status: "accepted" });
    expect((await accepted.json() as { status: string }).status).toBe("accepted");
    expect((await submit(base, payload("accept-http"))).status).toBe(200);
    expect((await (await fetch(`${base}/api/agent/transactions/accept-http`, { headers: { Authorization: `Bearer ${token}` } })).json() as { status: string }).status).toBe("accepted");
    expect((await acknowledge(base, "accept-http", { transactionId: "accept-http", status: "accepted" })).status).toBe(200);
    expect((await acknowledge(base, "accept-http", { transactionId: "accept-http", status: "reverted" })).status).toBe(409);
    expect((await acknowledge(base, "accept-http", { transactionId: "accept-http", status: "accepted", extra: true })).status).toBe(400);
    expect((await acknowledge(base, "accept-http", { transactionId: "accept-http", status: "accepted" }, { Origin: "http://127.0.0.1:9999", "Content-Type": "application/json" })).status).toBe(403);
    events.controller.abort();
  });

  it("converges reverted decisions without applying a transaction", async () => {
    const base = await harness();
    const events = await openEvents(base);
    await submit(base, payload("revert-http"));
    const delivery = await events.next();
    const window = new Window();
    window.document.body.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg"><path id="mark" data-lineage-key="layer" /></svg>';
    const canonical = window.document.querySelector("svg") as unknown as SVGSVGElement;
    const before = canonical.outerHTML;
    const history = new History();
    const editor: AgentSessionEditor = {
      stageAgentTransaction: (transaction, context) => evaluateAgentTransaction(canonical, transaction, context),
      acceptAgentCandidate: (candidate) => { history.checkpoint(canonical.outerHTML); canonical.replaceWith(candidate); },
      applyAgentSelection: () => undefined,
      setAgentMutationBlocked: () => undefined,
    };
    const session = new AgentSession(editor);
    session.open("session", "concept.svg");
    const staged = session.stage(delivery.data)!;
    await acknowledge(base, "revert-http", staged.result);
    const reverted = await acknowledge(base, "revert-http", { transactionId: "revert-http", status: "reverted" });
    expect((await reverted.json() as { status: string }).status).toBe("reverted");
    expect(session.revert()).toBe(true);
    expect(canonical.outerHTML).toBe(before);
    expect(history.checkpointCount).toBe(0);
    expect(session.revision).toBe(0);
    expect((await (await fetch(`${base}/api/agent/transactions/revert-http`, { headers: { Authorization: `Bearer ${token}` } })).json() as { status: string }).status).toBe("reverted");
    events.controller.abort();
  });

  it("stages a real HTTP delivery through the T002 evaluator without reload or canonical mutation", async () => {
    const base = await harness();
    const events = await openEvents(base);
    const window = new Window();
    window.document.body.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg"><path id="mark" data-lineage-key="layer" /></svg>';
    const canonical = window.document.querySelector("svg") as unknown as SVGSVGElement;
    const before = canonical.outerHTML;
    expect((await submit(base, payload("live-stage"))).status).toBe(202);
    const delivery = await events.next();
    const staged = evaluateAgentTransaction(canonical, delivery.data, { sessionId: "session", sourcePath: "concept.svg", revision: 0 });
    expect(staged.result.status).toBe("staged");
    expect(canonical.outerHTML).toBe(before);
    expect(staged.candidate?.querySelector("#mark")?.getAttribute("aria-label")).toBe("Name");
    const acknowledged = await fetch(`${base}/api/agent/transactions/live-stage/ack`, {
      method: "POST", headers: browserHeaders, body: JSON.stringify(staged.result),
    });
    expect((await acknowledged.json() as { status: string }).status).toBe("pending_review");
    events.controller.abort();
  });

  it("adapts a representative logo-designer artifact through authenticated HTTP, SSE, and the editor evaluator", async () => {
    const base = await harness();
    const manifest = { sessionId: "skill-session", sourcePath: "concept.svg", revision: 2, layers: [{ sessionKey: "logo-key", name: "logo", type: "g", locked: false }] };
    expect((await fetch(`${base}/api/agent/document`, { method: "POST", headers: browserHeaders, body: JSON.stringify(manifest) })).status).toBe(200);
    const events = await openEvents(base);
    const submitted = await submitLogoDesignerTransaction({
      api: base, token, mode: "replace", artifact: new URL("./fixtures/agent/logo-designer-output.svg", import.meta.url).pathname,
      selector: "#logo", targetName: "logo", transactionId: "skill-e2e",
    });
    expect((submitted.response as { status: string }).status).toBe("delivered");
    const delivery = await events.next();
    const window = new Window();
    window.document.body.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg"><g id="logo" data-lineage-key="logo-key"><path d="M0 0h1" /></g></svg>';
    const canonical = window.document.querySelector("svg") as unknown as SVGSVGElement;
    const before = canonical.outerHTML;
    const staged = evaluateAgentTransaction(canonical, delivery.data, { sessionId: manifest.sessionId, sourcePath: manifest.sourcePath, revision: manifest.revision });
    expect(staged.result.status).toBe("staged");
    expect(staged.candidate?.querySelector("#wordmark")?.textContent).toBe("Lineage");
    expect(canonical.outerHTML).toBe(before);
    const acknowledged = await fetch(`${base}/api/agent/transactions/skill-e2e/ack`, { method: "POST", headers: browserHeaders, body: JSON.stringify(staged.result) });
    expect((await acknowledged.json() as { status: string }).status).toBe("pending_review");
    events.controller.abort();
  });

  it("replays queued events after Last-Event-ID, times out unacknowledged delivery, and marks disconnect", async () => {
    const base = await harness({ deliveryTimeoutMs: 25 });
    await submit(base, payload("queued-1"));
    await submit(base, payload("queued-2"));
    const replay = await openEvents(base, 1);
    const event = await replay.next();
    expect(event.id).toBe(2);
    expect(event.data.transactionId).toBe("queued-2");
    await new Promise((resolve) => setTimeout(resolve, 40));
    const timedOut = await fetch(`${base}/api/agent/transactions/queued-2`, { headers: { Authorization: `Bearer ${token}` } });
    expect((await timedOut.json() as { status: string }).status).toBe("rejected");
    await submit(base, payload("disconnect"));
    await replay.next();
    replay.controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const disconnected = await fetch(`${base}/api/agent/transactions/disconnect`, { headers: { Authorization: `Bearer ${token}` } });
    expect((await disconnected.json() as { status: string }).status).toBe("disconnected");
  });

  it("recovers a received but unacknowledged frame and accepts its cached staging result once", async () => {
    const base = await harness();
    const first = await openEvents(base);
    await submit(base, payload("pre-ack-reconnect"));
    const received = await first.next();
    expect(received.id).toBe(1);
    first.controller.abort();
    const reconnect = await openEvents(base, 0);
    const replayed = await reconnect.next();
    expect(replayed.id).toBe(1);
    expect(replayed.data.transactionId).toBe("pre-ack-reconnect");
    const result = { transactionId: "pre-ack-reconnect", status: "staged", impact: [] };
    expect((await acknowledge(base, "pre-ack-reconnect", result)).status).toBe(200);
    const duplicate = await acknowledge(base, "pre-ack-reconnect", result);
    expect((await duplicate.json() as { status: string }).status).toBe("pending_review");
    reconnect.controller.abort();
  });

  it("recovers the receive-before-ack window through a real Vite SSE proxy", async () => {
    const vitePort = await availablePort();
    const viteOrigin = `http://127.0.0.1:${vitePort}`;
    const base = await harness({}, viteOrigin);
    const vite = await createViteServer({
      configFile: false,
      logLevel: "silent",
      server: {
        host: "127.0.0.1", port: vitePort, strictPort: true,
        proxy: { "/api": { target: base, configure: (proxy) => proxy.on("proxyReq", (request) => request.setHeader("Origin", viteOrigin)) } },
      },
    });
    await vite.listen();
    runningVite.push(vite);
    const first = await openEvents(viteOrigin);
    await submit(base, payload("vite-pre-ack"));
    expect((await first.next()).data.transactionId).toBe("vite-pre-ack");
    first.controller.abort();
    const recovered = await openEvents(viteOrigin, 0);
    expect((await recovered.next()).data.transactionId).toBe("vite-pre-ack");
    const result = { transactionId: "vite-pre-ack", status: "staged", impact: [] };
    const acknowledged = await fetch(`${viteOrigin}/api/agent/transactions/vite-pre-ack/ack`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result),
    });
    expect((await acknowledged.json() as { status: string }).status).toBe("pending_review");
    expect((await acknowledge(base, "vite-pre-ack", result, { Origin: viteOrigin, "Content-Type": "application/json" })).status).toBe(200);
    recovered.controller.abort();
  });

  it("prunes acknowledged events from active backlog while retaining bounded terminal idempotency", async () => {
    const base = await harness({ maxBacklog: 1, maxRegistry: 2 });
    const events = await openEvents(base);
    await submit(base, payload("pruned-1"));
    await events.next();
    await acknowledge(base, "pruned-1", { transactionId: "pruned-1", status: "staged", impact: [] });
    await acknowledge(base, "pruned-1", { transactionId: "pruned-1", status: "reverted" });
    expect((await submit(base, payload("pruned-2"))).status).toBe(202);
    await events.next();
    await acknowledge(base, "pruned-2", { transactionId: "pruned-2", status: "staged", impact: [] });
    await acknowledge(base, "pruned-2", { transactionId: "pruned-2", status: "accepted" });
    expect((await submit(base, payload("pruned-3"))).status).toBe(202);
    expect((await submit(base, payload("pruned-2"))).status).toBe(200);
    events.controller.abort();
  });

  it("replaces a stale SSE subscriber so only the newest open editor receives delivery", async () => {
    const base = await harness();
    const stale = await openEvents(base);
    const current = await openEvents(base);
    expect((await submit(base, payload("newest-editor"))).status).toBe(202);
    expect((await current.next()).data.transactionId).toBe("newest-editor");
    current.controller.abort();
    stale.controller.abort();
  });

  it("requeues an unacknowledged delivered frame before a newer subscriber takes ownership", async () => {
    const base = await harness();
    const stale = await openEvents(base);
    await submit(base, payload("subscriber-handoff"));
    expect((await stale.next()).data.transactionId).toBe("subscriber-handoff");
    const current = await openEvents(base, 0);
    expect((await current.next()).data.transactionId).toBe("subscriber-handoff");
    const staged = { transactionId: "subscriber-handoff", status: "staged", impact: [] };
    expect((await acknowledge(base, "subscriber-handoff", staged)).status).toBe(200);
    current.controller.abort();
    stale.controller.abort();
  });

  it("keeps delivery connected after the streaming request side has finished", async () => {
    const base = await harness();
    const events = await openEvents(base);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await submit(base, payload("response-owned-lifecycle"))).status).toBe(202);
    expect((await events.next()).data.transactionId).toBe("response-owned-lifecycle");
    const state = await fetch(`${base}/api/agent/transactions/response-owned-lifecycle`, { headers: { Authorization: `Bearer ${token}` } });
    expect((await state.json() as { status: string }).status).toBe("delivered");
    events.controller.abort();
  });

  it("bounds backlog and encoded payload size", async () => {
    const base = await harness({ maxBacklog: 1 });
    expect((await submit(base, payload("first"))).status).toBe(202);
    expect((await submit(base, payload("overflow"))).status).toBe(503);
    const oversized = `{"padding":"${"x".repeat(AGENT_MAX_PAYLOAD_BYTES)}"}`;
    expect((await submit(base, oversized)).status).toBe(413);
  });
});
