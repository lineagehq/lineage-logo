import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { bindAgentHandoff, parseHandoffRequest, type HandoffRequest } from "../src/shared/agent-handoff";
import { prepareAgentHandoff } from "../src/server/agent-handoff";
import type { AgentSnapshot } from "../src/shared/agent-snapshot";

const id = "11111111-1111-4111-8111-111111111111";
const request: HandoffRequest = { intent: "Make the mark rounder; preserve the wordmark.", target: "selection", editorId: id, sessionId: "current-session", revision: 4, sourcePath: "concepts/logo.svg", selectedLayerIds: ["mark"] };
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect id="mark" fill="#ff0000" width="30" height="20"/></svg>';
const paint = { explicit: "#ff0000", computed: "rgb(255, 0, 0)" };
function snapshot(): AgentSnapshot {
  return { schemaVersion: 1, requestId: id, instanceId: id, serverInstanceId: id, editorId: id, workspaceId: "a".repeat(64), sessionId: request.sessionId, baseRevision: request.revision, svg, digest: createHash("sha256").update(svg).digest("hex"),
    documentBounds: { status: "unsupported", reason: "no-viewbox" }, selectedLayerIds: ["mark"], primaryLayerId: "mark",
    layers: [{ layerId: "mark", svgId: "mark", svgPath: [0], parentLayerId: null, type: "rect", name: "mark", hidden: false, locked: false, transform: null, matrix: [1,0,0,1,0,0], bounds: { status: "available", x: 0, y: 0, width: 30, height: 20 }, paint: { fill: paint, stroke: paint, strokeWidth: paint, opacity: paint } }] };
}
const manifest = () => ({ sessionId: request.sessionId, revision: request.revision, sourcePath: request.sourcePath, layers: [] });
it("hands off exact current unsaved bytes, scope and public binding without inventing a connected producer", async () => {
  const handoff = await prepareAgentHandoff(request, { manifest: async () => manifest(), snapshot: async () => snapshot() });
  expect(handoff.snapshot.svg).toBe(svg); expect(handoff.snapshot.digest).toBe(createHash("sha256").update(svg).digest("hex"));
  expect(handoff.intent).toBe(request.intent); expect(handoff.target).toBe("selection");
  expect(handoff.instructions).toContain("No agent was invoked");
  expect(JSON.stringify(handoff)).not.toMatch(/Bearer|private-token|apiOrigin/);
});
it("rejects wrong editor, stale revisions, another session and changed selection", () => {
  for (const change of [{ editorId: "22222222-2222-4222-8222-222222222222" }, { baseRevision: 5 }, { sessionId: "another-session" }, { selectedLayerIds: [], primaryLayerId: null }]) {
    expect(() => bindAgentHandoff(request, { ...snapshot(), ...change })).toThrow("fresh handoff");
  }
});
it("rejects source switches before and after snapshot capture", async () => {
  const capture = vi.fn(async () => snapshot());
  await expect(prepareAgentHandoff(request, { snapshot: capture, manifest: async () => ({ ...manifest(), sourcePath: "concepts/another.svg" }) })).rejects.toThrow("fresh handoff");
  expect(capture).not.toHaveBeenCalled();
  const read = vi.fn().mockResolvedValueOnce(manifest()).mockResolvedValueOnce({ ...manifest(), revision: 5 });
  await expect(prepareAgentHandoff(request, { snapshot: capture, manifest: read })).rejects.toThrow("fresh handoff");
  expect(capture).toHaveBeenCalledOnce();
});
it("rejects missing intent, invalid scope and missing selected targets", () => {
  for (const change of [{ intent: " " }, { intent: "x".repeat(4001) }, { target: "invented" }, { selectedLayerIds: [] }, { selectedLayerIds: ["mark", "mark"] }, { sourcePath: "../outside.svg" }, { token: "secret" }]) {
    expect(() => parseHandoffRequest({ ...request, ...change })).toThrow();
  }
  expect(parseHandoffRequest({ ...request, target: "document", selectedLayerIds: [] }).target).toBe("document");
});
