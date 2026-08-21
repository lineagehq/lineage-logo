import { describe, expect, it } from "vitest";
import { History } from "../src/client/history/history";

describe("editor history", () => {
  it("moves snapshots through undo and redo", () => {
    const history = new History();
    history.checkpoint("one");
    history.checkpoint("two");

    expect(history.canUndo).toBe(true);
    expect(history.undo("three")).toBe("two");
    expect(history.undo("two")).toBe("one");
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
    expect(history.redo("one")).toBe("two");
    expect(history.redo("two")).toBe("three");
  });

  it("drops duplicate checkpoints and clears redo after a new correction", () => {
    const history = new History();
    history.checkpoint("one");
    history.checkpoint("one");
    expect(history.undo("two")).toBe("one");
    expect(history.undo("one")).toBeUndefined();

    history.checkpoint("fresh");
    expect(history.canRedo).toBe(false);
  });

  it("resets both stacks", () => {
    const history = new History();
    history.checkpoint("one");
    history.undo("two");
    history.reset();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });
});
