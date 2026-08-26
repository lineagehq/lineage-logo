import { describe, expect, it, vi } from "vitest";
import { waitForWorkspaceAdvance } from "../src/client/workspace-refresh";

describe("accepted-handoff workspace refresh", () => {
  it("returns the first snapshot whose next iteration advances", async () => {
    const read = vi.fn()
      .mockResolvedValueOnce({ nextIterationPath: "iterations/iteration-4.svg", files: ["iteration-3.svg"] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ nextIterationPath: "iterations/iteration-5.svg", files: ["iteration-3.svg", "iteration-4.svg"] });
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(waitForWorkspaceAdvance("iterations/iteration-4.svg", read, {
      delaysMs: [0, 100, 250], wait,
    })).resolves.toEqual({
      nextIterationPath: "iterations/iteration-5.svg",
      files: ["iteration-3.svg", "iteration-4.svg"],
    });
    expect(read).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[100], [250]]);
  });

  it("stops after the bounded retry window when no handoff writes a file", async () => {
    const read = vi.fn().mockResolvedValue({ nextIterationPath: "iterations/iteration-4.svg" });
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(waitForWorkspaceAdvance("iterations/iteration-4.svg", read, {
      delaysMs: [0, 50, 100], wait,
    })).resolves.toBeUndefined();
    expect(read).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[50], [100]]);
  });
});
