import { describe, expect, it, vi } from "vitest";
import { recoverAfterTabClose } from "../src/client/agent/recovery-retry";
import { AgentRecoveryError } from "../src/client/agent/transport";

describe("tab-close recovery lease overlap", () => {
  it("retries transient ownership loss with a bounded delay and returns the authoritative result", async () => {
    const recover = vi.fn().mockRejectedValueOnce(new AgentRecoveryError("ownership", false, true)).mockResolvedValue({ status: "pending_review" });
    const wait = vi.fn().mockResolvedValue(undefined);
    expect(await recoverAfterTabClose(recover, () => true, wait)).toEqual({ status: "pending_review" });
    expect(wait).toHaveBeenCalledWith(100);
    expect(recover).toHaveBeenCalledTimes(2);
  });
  it("never loops indefinitely while a different tab still owns the editor", async () => {
    const error = new AgentRecoveryError("ownership", false, true);
    const recover = vi.fn().mockRejectedValue(error), wait = vi.fn().mockResolvedValue(undefined);
    await expect(recoverAfterTabClose(recover, () => true, wait)).rejects.toBe(error);
    expect(recover).toHaveBeenCalledTimes(4);
    expect(wait.mock.calls).toEqual([[100], [250], [500]]);
  });
  it.each([new AgentRecoveryError("identity mismatch", true), new AgentRecoveryError("malformed", false), new Error("offline")])("does not retry unrelated or terminal errors", async error => {
    const recover = vi.fn().mockRejectedValue(error), wait = vi.fn();
    await expect(recoverAfterTabClose(recover, () => true, wait)).rejects.toBe(error);
    expect(recover).toHaveBeenCalledTimes(1); expect(wait).not.toHaveBeenCalled();
  });
  it("does not open a stale result after another file open or pending proposal supersedes it", async () => {
    let eligible = true;
    expect(await recoverAfterTabClose(async () => { eligible = false; return "stale"; }, () => eligible)).toBeUndefined();
    const recover = vi.fn().mockRejectedValue(new AgentRecoveryError("ownership", false, true));
    eligible = true;
    expect(await recoverAfterTabClose(recover, () => eligible, async () => { eligible = false; })).toBeUndefined();
    expect(recover).toHaveBeenCalledTimes(1);
  });
});
