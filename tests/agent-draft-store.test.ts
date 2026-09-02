import { describe, expect, it } from "vitest";
import { AGENT_DRAFT_KEY, discardAgentDraft, readAgentDraft, writeAgentDraft } from "../src/client/agent/draft-store";

function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
}

describe("bounded agent draft recovery", () => {
  it("stores one credential-free draft and restores only an exact source digest within seven days", async () => {
    const store = storage();
    const sourceSvg = '<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle/></svg>';
    await writeAgentDraft(store, { workspace: "Seatify", sourcePath: "concepts/logo.svg", sourceSvg, svg }, new Date("2026-01-01"));
    expect(store.values.get(AGENT_DRAFT_KEY)).not.toMatch(/token|authorization|\/Users\//i);
    await expect(readAgentDraft(store, { workspace: "Seatify", sourcePath: "concepts/logo.svg", sourceSvg }, new Date("2026-01-07")))
      .resolves.toMatchObject({ status: "ready", draft: { svg } });
    await expect(readAgentDraft(store, { workspace: "Seatify", sourcePath: "concepts/logo.svg", sourceSvg: sourceSvg.replace("path", "rect") }, new Date("2026-01-07")))
      .resolves.toEqual({ status: "mismatch" });
    await expect(readAgentDraft(store, { workspace: "Seatify", sourcePath: "concepts/logo.svg", sourceSvg }, new Date("2026-01-09")))
      .resolves.toEqual({ status: "mismatch" });
    discardAgentDraft(store);
    expect(store.values.has(AGENT_DRAFT_KEY)).toBe(false);
  });

  it("rejects oversized, unsafe, tampered, and path-bearing drafts", async () => {
    const store = storage();
    await expect(writeAgentDraft(store, { workspace: "Seatify", sourcePath: "/tmp/logo.svg", sourceSvg: "<svg/>", svg: "<svg/>" })).rejects.toThrow();
    await expect(writeAgentDraft(store, { workspace: "Seatify", sourcePath: "concepts/logo.svg", sourceSvg: "<svg/>", svg: `<svg><text>${"x".repeat(5 * 1024 * 1024)}</text></svg>` })).rejects.toThrow();
    store.setItem(AGENT_DRAFT_KEY, JSON.stringify({ version: 1, token: "secret" }));
    await expect(readAgentDraft(store, { workspace: "Seatify", sourcePath: "concepts/logo.svg", sourceSvg: "<svg/>" })).resolves.toEqual({ status: "mismatch" });
  });
});
