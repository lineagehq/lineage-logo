import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import {
  boundedSelectionPath,
  readWorkspaceSession,
  resolveSelectionPath,
  validateWorkspaceSession,
  WORKSPACE_SESSION_KEY,
  writeWorkspaceSession,
  type WorkspaceSessionV1,
} from "../src/client/session-restoration";

function validState(overrides: Partial<WorkspaceSessionV1> = {}): WorkspaceSessionV1 {
  return {
    version: 1,
    workspace: "seatify-logo",
    activePath: "concepts/complex-seatify.svg",
    selectionPath: ["venue-logo", "venue-mark", "west-seat-north"],
    zoom: 1.25,
    previewBackground: "dark",
    leftCollapsed: true,
    rightCollapsed: false,
    ...overrides,
  };
}

function memoryStorage(initial?: unknown) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(WORKSPACE_SESSION_KEY, typeof initial === "string" ? initial : JSON.stringify(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe("versioned workspace session restoration", () => {
  it("round trips only the bounded v1 workspace and UI identity schema", () => {
    const storage = memoryStorage();
    const state = validState();
    expect(writeWorkspaceSession(storage, state)).toBe(true);
    expect(readWorkspaceSession(storage, "seatify-logo")).toEqual(state);
    expect(Object.keys(JSON.parse(storage.values.get(WORKSPACE_SESSION_KEY)!)).sort()).toEqual([
      "activePath", "leftCollapsed", "previewBackground", "rightCollapsed",
      "selectionPath", "version", "workspace", "zoom",
    ]);
  });

  it("accepts server-supported dotted filenames and bounds producer selection identities", () => {
    expect(validateWorkspaceSession(validState({ activePath: "concepts/logo..draft.svg" }), "seatify-logo"))
      .toEqual(validState({ activePath: "concepts/logo..draft.svg" }));
    expect(boundedSelectionPath(["venue", "x".repeat(161), ...Array.from({ length: 18 }, (_, index) => `layer-${index}`)]))
      .toEqual(Array.from({ length: 16 }, (_, index) => `layer-${index + 2}`));
  });

  it.each([
    validState({ version: 2 as 1 }),
    validState({ workspace: "another-workspace" }),
    validState({ activePath: "../secret.svg" }),
    validState({ activePath: "concepts/nested/file.svg" }),
    validState({ selectionPath: Array.from({ length: 17 }, (_, index) => `layer-${index}`) }),
    validState({ selectionPath: ["x".repeat(161)] }),
    validState({ zoom: 0.1 }),
    validState({ zoom: Number.NaN }),
    validState({ previewBackground: "transparent" as "dark" }),
    { ...validState(), unsavedSvg: "<svg/>" },
  ])("rejects and removes invalid, mismatched, or unbounded state", (candidate) => {
    const storage = memoryStorage(candidate);
    expect(readWorkspaceSession(storage, "seatify-logo")).toBeUndefined();
    expect(storage.values.has(WORKSPACE_SESSION_KEY)).toBe(false);
  });

  it("falls back from a missing leaf to the nearest surviving eligible ancestor", () => {
    const window = new Window();
    window.document.body.innerHTML = '<svg><g id="venue-logo"><g id="venue-mark"><path id="seat"/></g></g></svg>';
    const root = window.document.querySelector("svg") as unknown as SVGSVGElement;
    const eligible = (element: Element): element is SVGGraphicsElement => ["g", "path"].includes(element.localName);
    expect(resolveSelectionPath(root, ["venue-logo", "venue-mark", "removed-seat"], eligible)?.id).toBe("venue-mark");
    expect(resolveSelectionPath(root, ["removed"], eligible)).toBeUndefined();
  });

  it("fails closed when storage is corrupt or unavailable", () => {
    const corrupt = memoryStorage("not-json");
    expect(readWorkspaceSession(corrupt, "seatify-logo")).toBeUndefined();
    const blocked = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    expect(readWorkspaceSession(blocked, "seatify-logo")).toBeUndefined();
    expect(writeWorkspaceSession(blocked, validState())).toBe(false);
    expect(validateWorkspaceSession(null, "seatify-logo")).toBeUndefined();
  });
});
