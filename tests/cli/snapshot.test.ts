import { expect, it, vi } from "vitest";
import { runLineageCli, EXIT, type ResolvedInstance } from "../../src/cli/index";
import { SnapshotError } from "../../src/shared/agent-snapshot";

it("only explicit snapshot calls the artwork endpoint; default context remains redacted", async () => {
  const snapshot = vi.fn().mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', digest: "a".repeat(64) });
  const instance = { instanceId: "public-instance", workspaceLabel: "/private/workspace", editorOrigin: "http://lineage-logo.localhost", client: { snapshot, manifest: vi.fn().mockResolvedValue({ sessionId: "session", sourcePath: "/private/logo.svg", revision: 2, layers: [] }) } } as unknown as ResolvedInstance;
  const stdout: string[] = []; const io = { stdout: (s: string) => stdout.push(s), stderr: () => {} };
  const dependencies = { resolveInstance: async () => instance };
  expect(await runLineageCli(["context", "--json"], io, dependencies)).toBe(EXIT.success);
  expect(snapshot).not.toHaveBeenCalled(); expect(stdout.join("")).not.toMatch(/private|sourcePath|<svg/);
  stdout.length = 0;
  expect(await runLineageCli(["snapshot", "--json"], io, dependencies)).toBe(EXIT.success);
  expect(JSON.parse(stdout[0])).toMatchObject({ command: "snapshot", ok: true, snapshot: { svg: expect.stringContaining("<svg") } });
});
it.each(["pending_review", "stale_snapshot", "snapshot_timeout", "snapshot_unavailable", "unsupported_snapshot"] as const)("returns safe actionable %s without raw error details", async code => {
  const instance = { client: { snapshot: async () => { throw new SnapshotError(code); } } } as unknown as ResolvedInstance;
  const stdout: string[] = [];
  const exit = await runLineageCli(["snapshot", "--json"], { stdout: s => stdout.push(s), stderr: () => {} }, { resolveInstance: async () => instance });
  expect(exit).not.toBe(0); expect(stdout.join("")).toContain(code); expect(stdout.join("")).toContain("nextAction");
});
