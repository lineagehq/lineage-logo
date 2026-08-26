import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { serializeSvg } from "../src/client/canvas/editor";
import { AgentTransport, type AgentTransportOptions } from "../src/server/agent-transport";
import { HttpError, sendJson } from "../src/server/http";
import {
  AGENT_MAX_ACKNOWLEDGEMENT_BYTES, AGENT_MAX_PAYLOAD_BYTES, CLEAN_AGENT_SVG_REJECTION_CORPUS,
  validateCleanAgentSvg, type AgentTransactionV1,
} from "../src/shared/agent-protocol";
import { evaluateAgentTransaction } from "../src/client/agent/transaction";
import { submitLogoDesignerTransaction } from "../scripts/logo-designer-adapter";
import { AgentProducerClient } from "../src/producer/agent-client";
import { AgentSession, type AgentSessionEditor } from "../src/client/agent/session";
import { AgentCanvasTransport, AgentDecisionError } from "../src/client/agent/transport";
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

function accepted(id: string, baseRevision = 0, sourcePath = "concept.svg") {
  return { transactionId: id, status: "accepted", artifact: { sourcePath, revision: baseRevision + 1, svg: '<svg xmlns="http://www.w3.org/2000/svg" />' } };
}

function staged(id: string) {
  return { transactionId: id, status: "staged" as const, impact: [{ operationId: "rename", affectedSessionKeys: ["layer"] }] };
}

function exactCleanSvg(bytes: number): string {
  const prefix = '<svg xmlns="http://www.w3.org/2000/svg"><text>';
  const suffix = "</text></svg>";
  const remaining = bytes - Buffer.byteLength(prefix) - Buffer.byteLength(suffix);
  if (remaining < 0) throw new Error("Requested SVG size is too small.");
  const quoteHeavy = '"\\'.repeat(Math.ceil(remaining / 2)).slice(0, remaining);
  const svg = `${prefix}${quoteHeavy}${suffix}`;
  if (Buffer.byteLength(svg) !== bytes) throw new Error("SVG fixture size is not exact.");
  return svg;
}

function browserFetch(base: string): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("Origin", origin);
    return await fetch(new URL(String(input), base), { ...init, headers });
  }) as typeof fetch;
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
  const nextFrame = async (): Promise<{ id: number; event: string; data: Record<string, unknown> }> => {
    while (!buffered.includes("\n\n")) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error("SSE ended");
      buffered += decoder.decode(chunk.value, { stream: true }).replaceAll("\r", "");
    }
    const boundary = buffered.indexOf("\n\n");
    const block = buffered.slice(0, boundary);
    buffered = buffered.slice(boundary + 2);
    if (block.startsWith(":")) return await nextFrame();
    const fields = Object.fromEntries(block.split("\n").map((line) => {
      const split = line.indexOf(":");
      return [line.slice(0, split), line.slice(split + 1).trimStart()];
    }));
    return { id: Number(fields.id), event: fields.event, data: JSON.parse(fields.data) as Record<string, unknown> };
  };
  const next = async (): Promise<{ id: number; event: string; data: AgentTransactionV1 }> => {
    const frame = await nextFrame();
    return frame.event === "server-instance" ? await next() : frame as unknown as { id: number; event: string; data: AgentTransactionV1 };
  };
  return { response, controller, next, nextFrame, closed: reader.closed };
}

describe("real HTTP agent transport", () => {
  it("retries a lost accepted response with byte-identical receipt and exposes definitive terminal conflict state", async () => {
    const artifact = { sourcePath: "concept.svg", revision: 1, svg: '<svg xmlns="http://www.w3.org/2000/svg" />' };
    const acceptedState = { transactionId: "lost-ack", status: "accepted", artifact };
    const request = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(new Response(JSON.stringify(acceptedState), { status: 200, headers: { "Content-Type": "application/json" } }));
    const canvas = new AgentCanvasTransport({ onTransaction: () => undefined, connect: false, fetch: request });
    await expect(canvas.decide("lost-ack", "accepted", artifact)).resolves.toEqual(acceptedState);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[1]?.body).toBe(request.mock.calls[1]?.[1]?.body);

    const reverted = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      transactionId: "timed-out", status: "reverted", result: { transactionId: "timed-out", status: "staged", impact: [] }, error: "Transaction is already reverted.",
    }), { status: 409, headers: { "Content-Type": "application/json" } }));
    const conflicted = new AgentCanvasTransport({ onTransaction: () => undefined, connect: false, fetch: reverted });
    await expect(conflicted.decide("timed-out", "accepted", artifact)).rejects.toMatchObject({
      name: "AgentDecisionError", retryable: false, state: { transactionId: "timed-out", status: "reverted" },
    } satisfies Partial<AgentDecisionError>);
  });

  it("never finalizes or rolls back from malformed browser decision responses", async () => {
    const artifact = { sourcePath: "concept.svg", revision: 1, svg: '<svg xmlns="http://www.w3.org/2000/svg" />' };
    const malformed = [
      { transactionId: "other", status: "accepted", artifact },
      { transactionId: "decision", status: "mystery", artifact },
      { transactionId: "decision", status: "accepted", artifact: { ...artifact, svg: "<svg" } },
      { transactionId: "decision", status: "accepted", artifact, extra: true },
      { transactionId: "decision", status: "reverted" },
      { transactionId: "decision", status: "rejected", result: { transactionId: "decision", status: "rejected", error: { code: "invented", message: "bad" } } },
      { transactionId: "decision", status: "pending_review", result: { transactionId: "decision", status: "staged", impact: [{ operationId: 4, affectedSessionKeys: [] }] } },
    ];
    for (const value of malformed) {
      const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } }));
      const canvas = new AgentCanvasTransport({ onTransaction: () => undefined, connect: false, fetch: request });
      await expect(canvas.decide("decision", "accepted", artifact)).rejects.toMatchObject({ name: "AgentDecisionError", retryable: false });
    }
    for (const entry of CLEAN_AGENT_SVG_REJECTION_CORPUS) {
      const value = { transactionId: "decision", status: "accepted", artifact: { ...artifact, svg: entry.svg } };
      const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } }));
      const canvas = new AgentCanvasTransport({ onTransaction: () => undefined, connect: false, fetch: request });
      await expect(canvas.decide("decision", "accepted", artifact), entry.name).rejects.toMatchObject({ name: "AgentDecisionError", retryable: false });
    }
  });

  it("enforces bearer authentication and exact dynamic browser origin while synchronizing the manifest", async () => {
    const base = await harness();
    expect((await submit(base, payload("auth"), { "Content-Type": "application/json" })).status).toBe(401);
    expect((await fetch(`${base}/api/agent/events`, { headers: { Origin: "http://127.0.0.1:9999" } })).status).toBe(403);
    const manifest = { sessionId: "session", sourcePath: "concept.svg", revision: 0, layers: [{ sessionKey: "layer", name: "Layer", type: "path", locked: false }] };
    expect((await fetch(`${base}/api/agent/document`, { method: "POST", headers: browserHeaders, body: JSON.stringify(manifest) })).status).toBe(200);
    const documentResponse = await fetch(`${base}/api/agent/document`, { headers: { Authorization: `Bearer ${token}` } });
    expect(await documentResponse.json()).toEqual(manifest);
    const recoveryBody = JSON.stringify({ transactionId: "unknown", sessionId: "session", sourcePath: "concept.svg", revision: 0 });
    expect((await fetch(`${base}/api/agent/recovery`, { method: "POST", headers: { Origin: "http://127.0.0.1:9999", "Content-Type": "application/json" }, body: recoveryBody })).status).toBe(403);
    const recovery = await fetch(`${base}/api/agent/recovery`, { method: "POST", headers: browserHeaders, body: recoveryBody });
    expect(await recovery.json()).toEqual({
      serverInstanceId: expect.stringMatching(/^[0-9a-f-]{36}$/), transactionId: "unknown", status: "unknown",
    });
    const longPath = "a".repeat(4096);
    const longRecovery = await fetch(`${base}/api/agent/recovery`, {
      method: "POST",
      headers: browserHeaders,
      body: JSON.stringify({ transactionId: "unknown-long", sessionId: "session", sourcePath: longPath, revision: 0 }),
    });
    expect(longRecovery.status).toBe(200);
    expect(await longRecovery.json()).toMatchObject({ transactionId: "unknown-long", status: "unknown" });
  });

  it("delivers in order, acknowledges browser staging, deduplicates exact bytes, and rejects ID conflicts", async () => {
    const base = await harness();
    const events = await openEvents(base);
    expect((await submit(base, payload("tx-1"))).status).toBe(202);
    expect((await submit(base, payload("tx-2"))).status).toBe(202);
    expect((await events.next()).data.transactionId).toBe("tx-1");
    expect((await events.next()).data.transactionId).toBe("tx-2");
    const ack = staged("tx-1");
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
    expect((await acknowledge(base, "malformed-ack", {
      transactionId: "malformed-ack", status: "rejected", error: { code: "invented_error", message: "bad" },
    })).status).toBe(400);
    expect((await acknowledge(base, "malformed-ack", {
      transactionId: "malformed-ack", status: "staged", impact: [{ operationId: "other", affectedSessionKeys: [] }],
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
    expect((await acknowledge(base, "abandoned-review", staged("abandoned-review"))).status).toBe(200);
    const terminal = await events.nextFrame();
    expect(terminal).toMatchObject({ event: "transaction-terminal", data: { transactionId: "abandoned-review", status: "reverted" } });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const state = await fetch(`${base}/api/agent/transactions/abandoned-review`, { headers: { Authorization: `Bearer ${token}` } });
    expect((await state.json() as { status: string }).status).toBe("reverted");
    events.controller.abort();
  });

  it("emits a strict secret-free stable server identity and changes it only after replacement", async () => {
    const firstBase = await harness();
    const first = await openEvents(firstBase);
    const firstIdentity = await first.nextFrame();
    expect(firstIdentity.event).toBe("server-instance");
    expect(firstIdentity.id).toBeNaN();
    expect(firstIdentity.data).toEqual({ serverInstanceId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(JSON.stringify(firstIdentity.data)).not.toMatch(/token|secret|svg|transaction|path/i);
    first.controller.abort();

    const same = await openEvents(firstBase);
    expect((await same.nextFrame()).data).toEqual(firstIdentity.data);
    same.controller.abort();

    const replacementBase = await harness();
    const replacement = await openEvents(replacementBase);
    const replacementIdentity = await replacement.nextFrame();
    expect(replacementIdentity.data.serverInstanceId).not.toBe(firstIdentity.data.serverInstanceId);
    replacement.controller.abort();
  });

  it("converges accepted decisions for producers idempotently and rejects conflicting terminal decisions", async () => {
    const base = await harness();
    const events = await openEvents(base);
    expect((await submit(base, payload("accept-http"))).status).toBe(202);
    await events.next();
    const stagedResult = staged("accept-http");
    expect((await acknowledge(base, "accept-http", stagedResult)).status).toBe(200);
    const acceptedResponse = await acknowledge(base, "accept-http", accepted("accept-http"));
    expect(await acceptedResponse.json()).toMatchObject({ status: "accepted", artifact: { sourcePath: "concept.svg", revision: 1 } });
    expect((await submit(base, payload("accept-http"))).status).toBe(200);
    expect((await (await fetch(`${base}/api/agent/transactions/accept-http`, { headers: { Authorization: `Bearer ${token}` } })).json() as { status: string }).status).toBe("accepted");
    expect((await acknowledge(base, "accept-http", accepted("accept-http"))).status).toBe(200);
    expect((await acknowledge(base, "accept-http", { ...accepted("accept-http"), artifact: { sourcePath: "concept.svg", revision: 1, svg: '<svg xmlns="http://www.w3.org/2000/svg" id="different" />' } })).status).toBe(409);
    expect((await acknowledge(base, "accept-http", { transactionId: "accept-http", status: "reverted" })).status).toBe(409);
    expect((await acknowledge(base, "accept-http", { ...accepted("accept-http"), extra: true })).status).toBe(400);
    expect((await acknowledge(base, "accept-http", accepted("accept-http"), { Origin: "http://127.0.0.1:9999", "Content-Type": "application/json" })).status).toBe(403);
    events.controller.abort();
  });

  it("cannot expose accepted for a mutating review without its exact post-apply artifact", async () => {
    const base = await harness();
    const events = await openEvents(base);
    await submit(base, payload("artifact-required"));
    await events.next();
    await acknowledge(base, "artifact-required", staged("artifact-required"));
    expect((await acknowledge(base, "artifact-required", { transactionId: "artifact-required", status: "accepted" })).status).toBe(400);
    for (const entry of CLEAN_AGENT_SVG_REJECTION_CORPUS) {
      expect((await acknowledge(base, "artifact-required", {
        ...accepted("artifact-required"), artifact: { sourcePath: "concept.svg", revision: 1, svg: entry.svg },
      })).status, entry.name).toBe(400);
    }
    expect((await acknowledge(base, "artifact-required", accepted("artifact-required", 2))).status).toBe(409);
    const pending = await fetch(`${base}/api/agent/transactions/artifact-required`, { headers: { Authorization: `Bearer ${token}` } });
    expect((await pending.json() as { status: string }).status).toBe("pending_review");
    expect((await acknowledge(base, "artifact-required", accepted("artifact-required"))).status).toBe(200);
    events.controller.abort();
  });

  it("accepts 1.1 MiB through the browser decision path and exact 5 MiB quote-heavy SVG through HTTP and producer", async () => {
    for (const [id, bytes, useCanvasTransport] of [
      ["accepted-1-1-mib", Math.ceil(1.1 * 1024 * 1024), true],
      ["accepted-exact-5-mib", AGENT_MAX_PAYLOAD_BYTES, false],
    ] as const) {
      const base = await harness();
      const events = await openEvents(base);
      const transaction = JSON.parse(payload(id)) as AgentTransactionV1;
      const producer = new AgentProducerClient({
        context: { protocolVersion: 1, apiOrigin: base, token, pid: process.pid }, pollIntervalMs: 1, timeoutMs: 10_000,
      });
      const producerOutcome = producer.submitAndWait(transaction);
      const delivery = await events.next();
      expect(delivery.data.transactionId).toBe(id);
      expect((await acknowledge(base, id, staged(id))).status).toBe(200);
      const svg = exactCleanSvg(bytes);
      expect(() => validateCleanAgentSvg(svg)).not.toThrow();
      const artifact = { sourcePath: "concept.svg", revision: 1, svg };
      if (useCanvasTransport) {
        let blocked = false;
        let historyEntries = 0;
        const window = new Window();
        window.document.body.innerHTML = "<svg><path /></svg>";
        const candidate = window.document.querySelector("svg") as unknown as SVGSVGElement;
        const session = new AgentSession({
          stageAgentTransaction: () => ({ candidate, result: staged(id) }),
          beginAgentAcceptance: () => "checkpoint",
          finalizeAgentAcceptance: () => { historyEntries += 1; },
          rollbackAgentAcceptance: () => undefined,
          applyAgentSelection: () => undefined,
          setAgentMutationBlocked: (value) => { blocked = value; },
        });
        session.open("session", "concept.svg");
        session.stage(transaction);
        session.beginAccept();
        expect(blocked).toBe(true);
        const canvas = new AgentCanvasTransport({ onTransaction: () => undefined, connect: false, fetch: browserFetch(base) });
        await expect(canvas.decide(id, "accepted", artifact)).resolves.toMatchObject({ status: "accepted", artifact });
        expect(session.finalizeAccept(id)).toBe(true);
        expect(blocked).toBe(false);
        expect(historyEntries).toBe(1);
        expect(session.revision).toBe(1);
      } else {
        expect((await acknowledge(base, id, { transactionId: id, status: "accepted", artifact })).status).toBe(200);
      }
      await expect(producerOutcome).resolves.toEqual({ status: "accepted", transactionId: id, artifact });
      events.controller.abort();
    }
  }, 30_000);

  it("rejects raw SVG and encoded acknowledgement overflow without changing pending review state", async () => {
    const base = await harness();
    const events = await openEvents(base);
    await submit(base, payload("decision-bounds"));
    await events.next();
    expect((await acknowledge(base, "decision-bounds", staged("decision-bounds"))).status).toBe(200);

    const oversizedSvg = exactCleanSvg(AGENT_MAX_PAYLOAD_BYTES + 1);
    let blocked = false;
    let historyEntries = 0;
    const window = new Window();
    window.document.body.innerHTML = "<svg><path /></svg>";
    const candidate = window.document.querySelector("svg") as unknown as SVGSVGElement;
    const session = new AgentSession({
      stageAgentTransaction: () => ({ candidate, result: staged("decision-bounds") }),
      beginAgentAcceptance: () => "checkpoint",
      finalizeAgentAcceptance: () => { historyEntries += 1; },
      rollbackAgentAcceptance: () => undefined,
      applyAgentSelection: () => undefined,
      setAgentMutationBlocked: (value) => { blocked = value; },
    });
    session.open("session", "concept.svg");
    session.stage(JSON.parse(payload("decision-bounds")) as AgentTransactionV1);
    session.beginAccept();
    const canvas = new AgentCanvasTransport({ onTransaction: () => undefined, connect: false, fetch: browserFetch(base) });
    await expect(canvas.decide("decision-bounds", "accepted", {
      sourcePath: "concept.svg", revision: 1, svg: oversizedSvg,
    })).rejects.toMatchObject({ name: "AgentDecisionError" });
    expect(session.pending?.transaction.transactionId).toBe("decision-bounds");
    expect(session.revision).toBe(1);
    expect(historyEntries).toBe(0);
    expect(blocked).toBe(true);

    const malformed = await acknowledge(base, "decision-bounds", {
      transactionId: "decision-bounds", status: "accepted",
      artifact: { sourcePath: "concept.svg", revision: 1, svg: "<svg" },
    });
    expect(malformed.status).toBe(400);

    const encodedOverflow = await fetch(`${base}/api/agent/transactions/decision-bounds/ack`, {
      method: "POST", headers: browserHeaders,
      body: JSON.stringify({ padding: "x".repeat(AGENT_MAX_ACKNOWLEDGEMENT_BYTES) }),
    });
    expect(encodedOverflow.status).toBe(413);
    const pending = await fetch(`${base}/api/agent/transactions/decision-bounds`, { headers: { Authorization: `Bearer ${token}` } });
    expect(await pending.json()).toMatchObject({ transactionId: "decision-bounds", status: "pending_review", result: staged("decision-bounds") });
    expect(session.pending?.transaction.transactionId).toBe("decision-bounds");
    expect(session.revision).toBe(1);
    expect(historyEntries).toBe(0);
    expect(blocked).toBe(true);
    events.controller.abort();
  }, 30_000);

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
      beginAgentAcceptance: (candidate) => { const checkpoint = canonical.outerHTML; canonical.replaceWith(candidate); return checkpoint; },
      finalizeAgentAcceptance: (checkpoint) => { history.checkpoint(String(checkpoint)); },
      rollbackAgentAcceptance: () => undefined,
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
    const submission = submitLogoDesignerTransaction({
      client: new AgentProducerClient({ context: { protocolVersion: 1, apiOrigin: base, token, pid: process.pid }, pollIntervalMs: 1, timeoutMs: 1_000 }),
      mode: "replace", artifact: new URL("./fixtures/agent/logo-designer-output.svg", import.meta.url).pathname,
      selector: "#logo", targetName: "logo", transactionId: "skill-e2e",
    });
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
    const acceptedSvg = serializeSvg(staged.candidate!, true);
    canonical.replaceWith(staged.candidate!);
    expect((await acknowledge(base, "skill-e2e", {
      transactionId: "skill-e2e", status: "accepted",
      artifact: { sourcePath: "concept.svg", revision: 3, svg: acceptedSvg },
    })).status).toBe(200);
    const submitted = await submission;
    expect(submitted.outcome).toMatchObject({ status: "accepted", artifact: { revision: 3, sourcePath: "concept.svg", svg: acceptedSvg } });
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
    const terminal = await replay.nextFrame();
    expect(terminal).toMatchObject({ event: "transaction-terminal", data: { transactionId: "queued-2", status: "rejected" } });
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
    const result = staged("pre-ack-reconnect");
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
    const result = staged("vite-pre-ack");
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
    await acknowledge(base, "pruned-1", staged("pruned-1"));
    await acknowledge(base, "pruned-1", { transactionId: "pruned-1", status: "reverted" });
    expect((await submit(base, payload("pruned-2"))).status).toBe(202);
    await events.next();
    await acknowledge(base, "pruned-2", staged("pruned-2"));
    await acknowledge(base, "pruned-2", accepted("pruned-2"));
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
    const stagedResult = staged("subscriber-handoff");
    expect((await acknowledge(base, "subscriber-handoff", stagedResult)).status).toBe(200);
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
