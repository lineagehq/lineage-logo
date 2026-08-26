import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSession, type AgentSessionEditor } from "../src/client/agent/session";
import { AgentCanvasTransport, AgentRecoveryError } from "../src/client/agent/transport";
import { evaluateAgentTransaction, type AgentSelectionIntent } from "../src/client/agent/transaction";
import { History } from "../src/client/history/history";
import { AgentProducerClient } from "../src/producer/agent-client";
import { AgentTransport } from "../src/server/agent-transport";
import { HttpError, sendJson } from "../src/server/http";
import type { AgentDocumentManifest, AgentTransactionV1 } from "../src/shared/agent-protocol";

const token = "reconnect-test-secret";
const origin = "http://127.0.0.1:5173";
const editorId = "22222222-2222-4222-8222-222222222222";
const browserHeaders = { Origin: origin, "Content-Type": "application/json", "X-Lineage-Editor-ID": editorId };
const producerHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const running: Array<{ server: Server; transport: AgentTransport }> = [];

async function harness(options: { reviewTimeoutMs?: number } = {}) {
  const transport = new AgentTransport({ token, editorOrigin: origin, heartbeatMs: 60_000, ...options });
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

function browserFetch(base: string): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("Origin", origin);
    headers.set("X-Lineage-Editor-ID", editorId);
    return await fetch(new URL(String(input), base), { ...init, headers });
  }) as typeof fetch;
}

afterEach(async () => {
  for (const item of running.splice(0)) {
    item.transport.close();
    item.server.close();
    await once(item.server, "close");
  }
});

function transaction(id: string): AgentTransactionV1 {
  return {
    protocolVersion: 1,
    transactionId: id,
    producer: { kind: "test", name: "Reconnect producer" },
    document: { sessionId: "stable-session", sourcePath: "concepts/logo.svg", baseRevision: 3 },
    operations: [{ type: "renameLayer", operationId: "rename", target: { sessionKey: "logo" }, name: "Recovered logo" }],
  };
}

const manifest: AgentDocumentManifest = {
  sessionId: "stable-session",
  sourcePath: "concepts/logo.svg",
  revision: 3,
  layers: [{ sessionKey: "logo", name: "Logo", type: "path", locked: false }],
};

async function publish(base: string, value: AgentDocumentManifest) {
  return await fetch(`${base}/api/agent/document`, { method: "POST", headers: browserHeaders, body: JSON.stringify(value) });
}

async function acknowledge(base: string, id: string, value: unknown) {
  return await fetch(`${base}/api/agent/transactions/${encodeURIComponent(id)}/ack`, {
    method: "POST", headers: browserHeaders, body: JSON.stringify(value),
  });
}

async function submit(base: string, value: AgentTransactionV1) {
  return await fetch(`${base}/api/agent/transactions`, { method: "POST", headers: producerHeaders, body: JSON.stringify(value) });
}

async function openEvents(base: string) {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/agent/events`, { headers: { Origin: origin, "X-Lineage-Editor-ID": editorId }, signal: controller.signal });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  const next = async (): Promise<{ event: string; data: Record<string, unknown> }> => {
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
    if (fields.event === "server-instance") return await next();
    return { event: fields.event, data: JSON.parse(fields.data) as Record<string, unknown> };
  };
  return { controller, next };
}

function editorFixture() {
  const window = new Window();
  window.document.body.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path id="logo" data-lineage-key="logo" aria-label="Logo" /></svg>';
  let canonical = window.document.querySelector("svg") as unknown as SVGSVGElement;
  const initial = canonical.outerHTML;
  const history = new History();
  let blocked = false;
  let applyCalls = 0;
  let selection: AgentSelectionIntent | undefined;
  const editor: AgentSessionEditor = {
    stageAgentTransaction: (value, context) => evaluateAgentTransaction(canonical, value, context),
    beginAgentAcceptance: (candidate, nextSelection) => {
      applyCalls += 1;
      const checkpoint = canonical;
      canonical.replaceWith(candidate);
      canonical = candidate;
      selection = nextSelection;
      return checkpoint;
    },
    finalizeAgentAcceptance: (checkpoint) => history.checkpoint((checkpoint as SVGSVGElement).outerHTML),
    rollbackAgentAcceptance: (checkpoint) => {
      canonical.replaceWith(checkpoint as SVGSVGElement);
      canonical = checkpoint as SVGSVGElement;
    },
    applyAgentSelection: (nextSelection) => { selection = nextSelection; },
    setAgentMutationBlocked: (value) => { blocked = value; },
  };
  return {
    editor, history, initial,
    get applyCalls() { return applyCalls; },
    get blocked() { return blocked; },
    get canonical() { return canonical; },
    get selection() { return selection; },
  };
}

async function stageFromEvent(base: string, id: string, session: AgentSession) {
  const events = await openEvents(base);
  const delivery = await events.next();
  expect(delivery.event).toBe("transaction");
  expect(delivery.data).toEqual(transaction(id));
  const staged = session.stage(delivery.data as unknown as AgentTransactionV1)!;
  expect(staged.result.status).toBe("staged");
  const response = await acknowledge(base, id, staged.result);
  expect(response.status).toBe(200);
  events.controller.abort();
  return staged;
}

describe("pending review reconnect recovery", () => {
  for (const decision of ["accepted", "reverted"] as const) {
    it(`reattaches the identical revision-bound proposal and converges ${decision} exactly once`, async () => {
      const base = await harness();
      await publish(base, manifest);
      const id = `reload-${decision}`;
      const submitted = transaction(id);
      const producer = new AgentProducerClient({
        context: { protocolVersion: 1, apiOrigin: base, token, pid: process.pid }, pollIntervalMs: 1,
      }).submitAndWait(submitted);

      const firstFixture = editorFixture();
      const firstSession = new AgentSession(firstFixture.editor);
      expect(firstSession.open(manifest.sessionId, manifest.sourcePath, manifest.revision)).toBe(true);
      const firstStaged = await stageFromEvent(base, id, firstSession);
      expect(firstFixture.blocked).toBe(true);

      const recoveredFixture = editorFixture();
      const recoveredSession = new AgentSession(recoveredFixture.editor);
      expect(recoveredSession.open(manifest.sessionId, manifest.sourcePath, manifest.revision)).toBe(true);
      const recoveredStaged = await stageFromEvent(base, id, recoveredSession);
      expect(recoveredStaged.result).toEqual(firstStaged.result);
      expect(recoveredStaged.candidate?.outerHTML).toBe(firstStaged.candidate?.outerHTML);
      expect(recoveredFixture.applyCalls).toBe(0);
      expect(recoveredFixture.history.checkpointCount).toBe(0);

      if (decision === "accepted") {
        expect(recoveredSession.beginAccept()).toBe(true);
        const accepted = recoveredFixture.canonical.cloneNode(true) as SVGSVGElement;
        for (const node of [accepted, ...Array.from(accepted.querySelectorAll("*"))]) node.removeAttribute("data-lineage-key");
        const artifact = { sourcePath: manifest.sourcePath, revision: 4, svg: accepted.outerHTML };
        const firstDecision = await acknowledge(base, id, { transactionId: id, status: "accepted", artifact });
        expect(firstDecision.status).toBe(200);
        expect(recoveredSession.finalizeAccept(id)).toBe(true);
        expect((await acknowledge(base, id, { transactionId: id, status: "accepted", artifact })).status).toBe(200);
        expect(recoveredFixture.applyCalls).toBe(1);
        expect(recoveredFixture.history.checkpointCount).toBe(1);
        expect(recoveredFixture.canonical.querySelector("#logo")?.getAttribute("aria-label")).toBe("Recovered logo");
        await expect(producer).resolves.toEqual({ status: "accepted", transactionId: id, artifact });
      } else {
        expect((await acknowledge(base, id, { transactionId: id, status: "reverted" })).status).toBe(200);
        expect(recoveredSession.revert()).toBe(true);
        expect((await acknowledge(base, id, { transactionId: id, status: "reverted" })).status).toBe(200);
        expect(recoveredFixture.applyCalls).toBe(0);
        expect(recoveredFixture.history.checkpointCount).toBe(0);
        expect(recoveredFixture.canonical.outerHTML).toBe(recoveredFixture.initial);
        await expect(producer).resolves.toEqual({ status: "reverted", transactionId: id });
      }
      expect(recoveredFixture.blocked).toBe(false);
    });
  }

  for (const decision of ["accepted", "reverted"] as const) {
    it(`converges ${decision} when recovery snapshots pending before the old decision commits and the new stream subscribes`, async () => {
      const base = await harness();
      await publish(base, manifest);
      const id = `interleaved-${decision}`;
      const submitted = transaction(id);
      const producer = new AgentProducerClient({
        context: { protocolVersion: 1, apiOrigin: base, token, pid: process.pid }, pollIntervalMs: 1,
      }).submitAndWait(submitted);
      const originalFixture = editorFixture();
      const originalSession = new AgentSession(originalFixture.editor);
      originalSession.open(manifest.sessionId, manifest.sourcePath, manifest.revision);
      await stageFromEvent(base, id, originalSession);

      const canvas = new AgentCanvasTransport({ onTransaction: () => undefined, connect: false, fetch: browserFetch(base) });
      const pendingSnapshot = await canvas.recover({ transactionId: id, sessionId: manifest.sessionId, sourcePath: manifest.sourcePath, revision: manifest.revision });
      expect("state" in pendingSnapshot && pendingSnapshot.state.status).toBe("pending_review");

      let artifact: { sourcePath: string; revision: number; svg: string } | undefined;
      if (decision === "accepted") {
        originalSession.beginAccept();
        const accepted = originalFixture.canonical.cloneNode(true) as SVGSVGElement;
        for (const node of [accepted, ...Array.from(accepted.querySelectorAll("*"))]) node.removeAttribute("data-lineage-key");
        artifact = { sourcePath: manifest.sourcePath, revision: 4, svg: accepted.outerHTML };
      }
      expect((await acknowledge(base, id, decision === "accepted"
        ? { transactionId: id, status: decision, artifact }
        : { transactionId: id, status: decision })).status).toBe(200);

      const replacementStream = await openEvents(base);
      await expect(replacementStream.next()).resolves.toEqual({
        event: "transaction-terminal", data: { transactionId: id, status: decision },
      });
      replacementStream.controller.abort();

      const authoritative = await canvas.recover({ transactionId: id, sessionId: manifest.sessionId, sourcePath: manifest.sourcePath, revision: manifest.revision });
      if (!("state" in authoritative)) throw new Error("Expected authoritative state");
      const freshFixture = editorFixture();
      const freshSession = new AgentSession(freshFixture.editor);
      freshSession.open(manifest.sessionId, manifest.sourcePath, manifest.revision);
      if (decision === "accepted") {
        const window = new Window();
        window.document.body.innerHTML = authoritative.state.artifact!.svg;
        const accepted = window.document.querySelector("svg") as unknown as SVGSVGElement;
        expect(freshSession.recoverAcceptedArtifact(authoritative.transaction, accepted)).toBe(true);
        expect(freshSession.recoverAcceptedArtifact(authoritative.transaction, accepted)).toBe(false);
        expect(freshFixture.applyCalls).toBe(1);
        expect(freshFixture.history.checkpointCount).toBe(1);
        await expect(producer).resolves.toEqual({ status: "accepted", transactionId: id, artifact });
      } else {
        expect(freshFixture.canonical.outerHTML).toBe(freshFixture.initial);
        expect(freshFixture.applyCalls).toBe(0);
        expect(freshFixture.history.checkpointCount).toBe(0);
        await expect(producer).resolves.toEqual({ status: "reverted", transactionId: id });
      }

      const duplicateStream = await openEvents(base);
      await expect(duplicateStream.next()).resolves.toEqual({
        event: "transaction-terminal", data: { transactionId: id, status: decision },
      });
      duplicateStream.controller.abort();
      expect(freshFixture.applyCalls).toBe(decision === "accepted" ? 1 : 0);
      expect(freshFixture.history.checkpointCount).toBe(decision === "accepted" ? 1 : 0);
    });
  }

  it("treats malformed and truncated successful recovery responses as retryable and later recovers the live pending state", async () => {
    const base = await harness();
    await publish(base, manifest);
    const id = "transient-malformed";
    await submit(base, transaction(id));
    const fixture = editorFixture();
    const session = new AgentSession(fixture.editor);
    session.open(manifest.sessionId, manifest.sourcePath, manifest.revision);
    await stageFromEvent(base, id, session);
    const realFetch = browserFetch(base);
    let attempts = 0;
    const transientFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      attempts += 1;
      if (attempts === 1) return new Response('{"serverInstanceId":', { status: 200, headers: { "Content-Type": "application/json" } });
      if (attempts === 2) return new Response(JSON.stringify({ serverInstanceId: "not-a-uuid", transactionId: id, status: "unknown" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
      return await realFetch(input, init);
    }) as typeof fetch;
    const canvas = new AgentCanvasTransport({ onTransaction: () => undefined, connect: false, fetch: transientFetch });
    const identity = { transactionId: id, sessionId: manifest.sessionId, sourcePath: manifest.sourcePath, revision: manifest.revision };
    await expect(canvas.recover(identity)).rejects.toMatchObject({ name: "AgentRecoveryError", terminal: false });
    await expect(canvas.recover(identity)).rejects.toMatchObject({ name: "AgentRecoveryError", terminal: false });
    await expect(canvas.recover(identity)).resolves.toMatchObject({ state: { transactionId: id, status: "pending_review" } });
    expect(fixture.applyCalls).toBe(0);
    expect(fixture.history.checkpointCount).toBe(0);
    expect(session.pending?.transaction.transactionId).toBe(id);
  });

  it("uses the recovered server identity to detect a restart before the first event stream opens", async () => {
    const first = "11111111-1111-4111-8111-111111111111";
    const second = "22222222-2222-4222-8222-222222222222";
    const replacements: Array<[string, string]> = [];
    const request = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes("/recovery")) {
        return new Response(JSON.stringify({ serverInstanceId: first, transactionId: "unknown", status: "unknown" }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`event: server-instance\ndata: {"serverInstanceId":"${second}"}\n\n`));
          controller.close();
        },
      }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
    });
    const canvas = new AgentCanvasTransport({
      onTransaction: () => undefined,
      onServerReplacement: (previous, next) => replacements.push([previous, next]),
      connect: false,
      fetch: request,
    });
    await expect(canvas.recover({ transactionId: "unknown", sessionId: "session", sourcePath: "concept.svg", revision: 0 }))
      .resolves.toMatchObject({ serverInstanceId: first, status: "unknown" });
    canvas.start();
    await vi.waitFor(() => expect(replacements).toEqual([[first, second]]));
    canvas.close();
  });

  it("keeps queued and delivered recovery conflicts retryable while identity mismatches are terminal", async () => {
    const base = await harness();
    await publish(base, manifest);
    const id = "live-recovery-conflict";
    await submit(base, transaction(id));
    const canvas = new AgentCanvasTransport({ onTransaction: () => undefined, connect: false, fetch: browserFetch(base) });
    const identity = { transactionId: id, sessionId: manifest.sessionId, sourcePath: manifest.sourcePath, revision: manifest.revision };
    await expect(canvas.recover(identity)).rejects.toMatchObject({ name: "AgentRecoveryError", terminal: false });

    const events = await openEvents(base);
    await expect(events.next()).resolves.toMatchObject({ event: "transaction", data: { transactionId: id } });
    await expect(canvas.recover(identity)).rejects.toMatchObject({ name: "AgentRecoveryError", terminal: false });
    await expect(canvas.recover({ ...identity, sessionId: "wrong" }))
      .rejects.toMatchObject({ name: "AgentRecoveryError", terminal: true });
    events.controller.abort();
  });

  for (const decision of ["accepted", "reverted"] as const) {
    it(`reconciles an authoritative ${decision} after its browser response is lost and reload follows`, async () => {
      const base = await harness();
      await publish(base, manifest);
      const id = `lost-${decision}`;
      const submitted = transaction(id);
      const producer = new AgentProducerClient({
        context: { protocolVersion: 1, apiOrigin: base, token, pid: process.pid }, pollIntervalMs: 1,
      }).submitAndWait(submitted);
      const originalFixture = editorFixture();
      const originalSession = new AgentSession(originalFixture.editor);
      originalSession.open(manifest.sessionId, manifest.sourcePath, manifest.revision);
      await stageFromEvent(base, id, originalSession);

      let artifact: { sourcePath: string; revision: number; svg: string } | undefined;
      if (decision === "accepted") {
        originalSession.beginAccept();
        const accepted = originalFixture.canonical.cloneNode(true) as SVGSVGElement;
        for (const node of [accepted, ...Array.from(accepted.querySelectorAll("*"))]) node.removeAttribute("data-lineage-key");
        artifact = { sourcePath: manifest.sourcePath, revision: 4, svg: accepted.outerHTML };
      }
      // The server commits, but the old page never observes this response and
      // therefore neither finalizes nor clears its persisted recovery record.
      expect((await acknowledge(base, id, decision === "accepted"
        ? { transactionId: id, status: decision, artifact }
        : { transactionId: id, status: decision })).status).toBe(200);

      const canvas = new AgentCanvasTransport({ onTransaction: () => undefined, connect: false, fetch: browserFetch(base) });
      const recovered = await canvas.recover({ transactionId: id, sessionId: manifest.sessionId, sourcePath: manifest.sourcePath, revision: manifest.revision });
      expect("state" in recovered && recovered.state.status).toBe(decision);
      if (!("state" in recovered)) throw new Error("Expected authoritative recovery state");

      const freshFixture = editorFixture();
      const freshSession = new AgentSession(freshFixture.editor);
      freshSession.open(manifest.sessionId, manifest.sourcePath, manifest.revision);
      if (decision === "accepted") {
        const window = new Window();
        window.document.body.innerHTML = recovered.state.artifact!.svg;
        const authoritative = window.document.querySelector("svg") as unknown as SVGSVGElement;
        expect(freshSession.recoverAcceptedArtifact(recovered.transaction, authoritative)).toBe(true);
        expect(freshFixture.applyCalls).toBe(1);
        expect(freshFixture.history.checkpointCount).toBe(1);
        expect(freshFixture.canonical.outerHTML).toBe(authoritative.outerHTML);
        await expect(producer).resolves.toEqual({ status: "accepted", transactionId: id, artifact });
      } else {
        expect(freshFixture.canonical.outerHTML).toBe(freshFixture.initial);
        expect(freshFixture.applyCalls).toBe(0);
        expect(freshFixture.history.checkpointCount).toBe(0);
        await expect(producer).resolves.toEqual({ status: "reverted", transactionId: id });
      }
      expect(freshFixture.blocked).toBe(false);
    });
  }

  it("terminates timeout and replacement-server records explicitly without restoring stale state", async () => {
    const timedBase = await harness({ reviewTimeoutMs: 20 });
    await publish(timedBase, manifest);
    const timedId = "timed-recovery";
    await submit(timedBase, transaction(timedId));
    const fixture = editorFixture();
    const session = new AgentSession(fixture.editor);
    session.open(manifest.sessionId, manifest.sourcePath, manifest.revision);
    await stageFromEvent(timedBase, timedId, session);
    await new Promise((resolve) => setTimeout(resolve, 35));
    const timedCanvas = new AgentCanvasTransport({ onTransaction: () => undefined, connect: false, fetch: browserFetch(timedBase) });
    const timed = await timedCanvas.recover({ transactionId: timedId, sessionId: manifest.sessionId, sourcePath: manifest.sourcePath, revision: manifest.revision });
    expect("state" in timed && timed.state.status).toBe("reverted");

    const replacementBase = await harness();
    const replacementCanvas = new AgentCanvasTransport({ onTransaction: () => undefined, connect: false, fetch: browserFetch(replacementBase) });
    await expect(replacementCanvas.recover({ transactionId: timedId, sessionId: manifest.sessionId, sourcePath: manifest.sourcePath, revision: manifest.revision }))
      .resolves.toMatchObject({ transactionId: timedId, status: "unknown" });
    await expect(replacementCanvas.recover({ transactionId: "different", sessionId: manifest.sessionId, sourcePath: manifest.sourcePath, revision: manifest.revision }))
      .resolves.toMatchObject({ transactionId: "different", status: "unknown" });

    await publish(timedBase, manifest);
    const mismatched = new AgentCanvasTransport({ onTransaction: () => undefined, connect: false, fetch: browserFetch(timedBase) });
    await expect(mismatched.recover({ transactionId: timedId, sessionId: "wrong", sourcePath: manifest.sourcePath, revision: manifest.revision }))
      .rejects.toMatchObject({ name: "AgentRecoveryError", terminal: true } satisfies Partial<AgentRecoveryError>);
  });

  it("does not reattach across mismatched session, source, revision, or transaction identity", async () => {
    const base = await harness();
    await publish(base, manifest);
    const id = "identity-bound";
    await submit(base, transaction(id));
    const fixture = editorFixture();
    const session = new AgentSession(fixture.editor);
    session.open(manifest.sessionId, manifest.sourcePath, manifest.revision);
    await stageFromEvent(base, id, session);

    for (const mismatch of [
      { ...manifest, sessionId: "other-session" },
      { ...manifest, sourcePath: "concepts/other.svg" },
      { ...manifest, revision: 4 },
    ]) {
      await publish(base, mismatch);
      const events = await openEvents(base);
      await expect(Promise.race([
        events.next().then(() => "reattached"),
        new Promise<string>((resolve) => setTimeout(() => resolve("quiet"), 25)),
      ])).resolves.toBe("quiet");
      events.controller.abort();
      const state = await fetch(`${base}/api/agent/transactions/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      expect(await state.json()).toMatchObject({ transactionId: id, status: "pending_review" });
    }
    expect((await acknowledge(base, "other-transaction", { transactionId: "other-transaction", status: "reverted" })).status).toBe(404);
  });
});
