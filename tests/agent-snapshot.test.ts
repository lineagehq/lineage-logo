import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterEach, expect, it } from "vitest";
import { AgentProducerClient } from "../src/producer/agent-client";
import { AgentTransport } from "../src/server/agent-transport";
import { HttpError, sendJson } from "../src/server/http";
import { parseSnapshotProjection, validateSnapshotSvg, type AgentSnapshotProjection, type AgentSnapshotRequest } from "../src/shared/agent-snapshot";

const editorId = "11111111-1111-4111-8111-111111111111";
const instanceId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "a".repeat(64);
const origin = "http://lineage-logo.localhost:5173";
const browserHeaders = { Origin: origin, "Content-Type": "application/json", "X-Lineage-Editor-ID": editorId };
const producerHeaders = { Authorization: "Bearer private-token", "Content-Type": "application/json", "X-Lineage-Instance-ID": instanceId, "X-Lineage-Workspace-ID": workspaceId };
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
function projection(): AgentSnapshotProjection {
  const paint = { explicit: null, computed: "none" };
  return { schemaVersion: 1, sessionId: "session", baseRevision: 3,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="2" width="30" height="20"/></svg>',
    documentBounds: { status: "available", x: 0, y: 0, width: 100, height: 100 }, selectedLayerIds: ["stable-rect"], primaryLayerId: "stable-rect",
    layers: [{ layerId: "stable-rect", svgId: null, svgPath: [0], parentLayerId: null, type: "rect", name: "Rectangle", hidden: false, locked: false, transform: null, matrix: [1, 0, 0, 1, 0, 0], bounds: { status: "available", x: 2, y: 0, width: 30, height: 20 }, paint: { fill: paint, stroke: paint, strokeWidth: paint, opacity: paint } }],
  };
}
async function harness(timeout = 500) {
  const transport = new AgentTransport({ token: "private-token", editorOrigin: origin, heartbeatMs: 60000, snapshotTimeoutMs: timeout, identity: { schemaVersion: 1, protocolVersion: 1, instanceId, workspaceId, apiOrigin: origin, editorOrigin: origin } });
  const server: Server = createServer(async (req, res) => {
    try { if (!await transport.route(req, res, new URL(req.url!, origin))) sendJson(res, 404, {}); }
    catch (error) { sendJson(res, error instanceof HttpError ? error.status : 500, { error: error instanceof Error ? error.message : "failed" }); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  cleanup.push(async () => { transport.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (route: string, body: unknown, headers: HeadersInit = browserHeaders) => fetch(base + route, { method: "POST", headers, body: JSON.stringify(body) });
  const manifest = (revision = 3) => post("/api/agent/document", { sessionId: "session", sourcePath: "/private/customer/logo.svg", revision, layers: [{ sessionKey: "stable-rect", type: "rect", name: "Rectangle", locked: false }] });
  await manifest();
  const abort = new AbortController();
  const stream = await fetch(base + "/api/agent/events", { headers: browserHeaders, signal: abort.signal });
  const reader = stream.body!.getReader();
  let buffer = "";
  async function challenge(): Promise<AgentSnapshotRequest> {
    while (true) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary >= 0) {
        const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        if (frame.includes("event: snapshot-request")) { expect(frame).not.toContain("\nid:"); return JSON.parse(frame.split("data: ")[1]); }
      } else { const item = await reader.read(); if (item.done) throw new Error("stream ended"); buffer += new TextDecoder().decode(item.value); }
    }
  }
  const request = () => post("/api/agent/snapshots", { schemaVersion: 1 }, producerHeaders);
  const reply = (request: AgentSnapshotRequest, value: unknown = projection()) => post(`/api/agent/snapshots/${request.requestId}/reply`, { request, projection: value });
  return { base, post, manifest, request, reply, challenge, abort };
}
it("validates stable id-less SVG paths, selection, geometry and strict redaction fields", () => {
  expect(parseSnapshotProjection(projection())).toEqual(projection());
  for (const mutate of [
    (p: any) => { p.sourcePath = "/private/leak"; },
    (p: any) => { p.layers[0].svgPath = [1]; },
    (p: any) => { p.selectedLayerIds = ["missing"]; },
    (p: any) => { p.layers[0].matrix[0] = Infinity; },
    (p: any) => { p.layers[0].parentLayerId = "stable-rect"; },
    (p: any) => { p.layers.push(p.layers[0]); },
  ]) { const p = projection(); mutate(p); expect(() => parseSnapshotProjection(p)).toThrow(); }
});
it("returns exact unsaved bytes and computed digest without credentials, source path or transaction history", async () => {
  const h = await harness(); const response = h.request(); const challenge = await h.challenge();
  expect((await h.reply(challenge)).status).toBe(200);
  const result = await response; expect(result.status).toBe(200);
  const snapshot = await result.json();
  expect(snapshot).toMatchObject({ ...projection(), instanceId, workspaceId, editorId, digest: createHash("sha256").update(projection().svg).digest("hex") });
  expect(JSON.stringify(snapshot)).not.toMatch(/private-token|private\/customer|sourcePath/);
  const transaction = await fetch(`${h.base}/api/agent/transactions/${challenge.requestId}`, { headers: producerHeaders });
  expect(transaction.status).toBe(404);
  expect((await h.reply(challenge)).status).toBe(409);
});
it("rejects an intervening revision instead of mixing metadata and SVG", async () => {
  const h = await harness(); const response = h.request(); const challenge = await h.challenge();
  await h.manifest(4); expect((await h.reply(challenge)).status).toBe(409);
  expect(await (await response).json()).toEqual({ error: "stale_snapshot" });
});
it("rejects incorrect nonce and instance/workspace binding", async () => {
  const h = await harness();
  const mismatch = await h.post("/api/agent/snapshots", { schemaVersion: 1 }, { ...producerHeaders, "X-Lineage-Workspace-ID": "b".repeat(64) });
  expect(mismatch.status).toBe(409);
  const response = h.request(); const challenge = await h.challenge();
  await h.reply({ ...challenge, baseRevision: 2 });
  expect(await (await response).json()).toEqual({ error: "stale_snapshot" });
});
it("times out, rejects late replies and permits a fresh request", async () => {
  const h = await harness(40); const first = h.request(); const old = await h.challenge();
  expect(await (await first).json()).toEqual({ error: "snapshot_timeout" });
  expect((await h.reply(old)).status).toBe(409);
  const second = h.request(); await h.reply(await h.challenge()); expect((await second).status).toBe(200);
});
it("cancels waiting capture when the editor disconnects", async () => {
  const h = await harness(); const response = h.request(); await h.challenge(); h.abort.abort();
  expect(await (await response).json()).toEqual({ error: "snapshot_unavailable" });
});
it("refuses pending review and does not deliver a snapshot event", async () => {
  const h = await harness();
  const transaction = { protocolVersion: 1, transactionId: "pending", producer: { kind: "test", name: "test" }, document: { sessionId: "session", sourcePath: "/private/customer/logo.svg", baseRevision: 3 }, operations: [{ type: "renameLayer", operationId: "rename", target: { sessionKey: "stable-rect" }, name: "Candidate" }] };
  expect((await h.post("/api/agent/transactions", transaction, producerHeaders)).status).toBe(202);
  expect(await (await h.request()).json()).toEqual({ error: "pending_review" });
});

it("allows passive CSS and local resource references while rejecting active or external document content", () => {
  const wrap = (content: string) => `<svg xmlns="http://www.w3.org/2000/svg">${content}</svg>`;
  expect(() => validateSnapshotSvg(wrap('<style>/* local paint */ .mark {fill:url(#paint);stroke:red}</style><defs><linearGradient id="paint"/></defs><rect class="mark" style="opacity:.5"/>'))).not.toThrow();
  for (const content of ['<script/>', '<rect onclick="alert(1)"/>', '<style>@import "remote.css";</style>', '<style>rect{fill:url(https://example.com/p)}</style>', '<image href="file:///private/image"/>', '<rect style="fill:url(data:image/svg+xml,bad)"/>', '<foreignObject/>']) {
    expect(() => validateSnapshotSvg(wrap(content))).toThrow();
  }
});
it("isolates other editor tabs and cancels capture on same-tab stream replacement", async () => {
  const h = await harness(); const result = h.request(); const challenge = await h.challenge();
  const wrongEditor = await h.post(`/api/agent/snapshots/${challenge.requestId}/reply`, { request: challenge, projection: projection() }, { ...browserHeaders, "X-Lineage-Editor-ID": "33333333-3333-4333-8333-333333333333" });
  expect(wrongEditor.status).toBe(409);
  const replacement = await fetch(h.base + "/api/agent/events", { headers: browserHeaders });
  expect(replacement.status).toBe(200);
  expect(await (await result).json()).toEqual({ error: "snapshot_unavailable" });
  expect((await h.reply(challenge)).status).toBe(409);
  await replacement.body!.cancel();
});
it("rejects mismatched layer keys and non-finite geometry before returning bytes", async () => {
  const h = await harness(); const result = h.request(); const challenge = await h.challenge();
  const value = projection(); value.layers[0].layerId = "wrong"; value.selectedLayerIds = ["wrong"]; value.primaryLayerId = "wrong";
  await h.reply(challenge, value); expect(await (await result).json()).toEqual({ error: "stale_snapshot" });
});

it("producer independently verifies SHA-256 and target instance binding", async () => {
  const snapshot = { ...projection(), requestId: editorId, instanceId, workspaceId, editorId, serverInstanceId: editorId, digest: createHash("sha256").update(projection().svg).digest("hex") };
  const client = (body: unknown) => new AgentProducerClient({ context: { protocolVersion: 1, apiOrigin: origin, token: "private-token", pid: 1 }, binding: { instanceId, workspaceId }, fetch: async () => Response.json(body) });
  expect(await client(snapshot).snapshot()).toEqual(snapshot);
  await expect(client({ ...snapshot, svg: snapshot.svg.replace('x="2"', 'x="9"') }).snapshot()).rejects.toThrow("invalid_snapshot");
  await expect(client({ ...snapshot, workspaceId: "b".repeat(64) }).snapshot()).rejects.toThrow("invalid_snapshot");
  await expect(client({ ...snapshot, sourcePath: "/private/leak" }).snapshot()).rejects.toThrow("invalid_snapshot");
});
it("enforces bounded layers, metadata and serialized bytes", () => {
  const many = projection(); many.layers = Array.from({ length: 5001 }, () => many.layers[0]);
  expect(() => parseSnapshotProjection(many)).toThrow("snapshot_too_large");
  const text = projection(); text.layers[0].name = "x".repeat(513);
  expect(() => parseSnapshotProjection(text)).toThrow("invalid_snapshot");
  const huge = projection(); huge.svg = "x".repeat(12 * 1024 * 1024);
  expect(() => parseSnapshotProjection(huge)).toThrow("snapshot_too_large");
});
