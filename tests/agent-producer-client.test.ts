import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AgentProducerClient } from "../src/producer/agent-client";
import { CLEAN_AGENT_SVG_REJECTION_CORPUS, type AgentTransactionV1 } from "../src/shared/agent-protocol";

const context = { protocolVersion: 1 as const, apiOrigin: "http://127.0.0.1:4567", token: randomBytes(32).toString("base64url"), pid: process.pid };
const transaction: AgentTransactionV1 = {
  protocolVersion: 1, transactionId: "producer-client", producer: { kind: "test", name: "producer" },
  document: { sessionId: "session", sourcePath: "concept.svg", baseRevision: 4 },
  operations: [{ type: "renameLayer", operationId: "rename", target: { sessionKey: "logo" }, name: "Accepted" }],
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const stagedResult = {
  transactionId: transaction.transactionId,
  status: "staged" as const,
  impact: [{ operationId: "rename", affectedSessionKeys: ["logo"] }],
};

describe("public agent producer client", () => {
  it("submits, waits through review, and returns the exact accepted artifact", async () => {
    const artifact = { sourcePath: "concept.svg", revision: 5, svg: '<svg xmlns="http://www.w3.org/2000/svg"><g id="logo" /></svg>' };
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ transactionId: transaction.transactionId, status: "queued" }, 202))
      .mockResolvedValueOnce(json({ transactionId: transaction.transactionId, status: "pending_review", result: stagedResult }))
      .mockResolvedValueOnce(json({ transactionId: transaction.transactionId, status: "accepted", result: stagedResult, artifact }));
    const client = new AgentProducerClient({ context, fetch: request, pollIntervalMs: 1, timeoutMs: 100 });
    await expect(client.submitAndWait(transaction)).resolves.toEqual({ status: "accepted", transactionId: transaction.transactionId, artifact });
    expect(request.mock.calls.every((call) => (call[1]?.headers as Record<string, string>).Authorization === `Bearer ${context.token}`)).toBe(true);
  });

  it("fails closed on accepted mutations without a receipt and reports terminal/recovery outcomes", async () => {
    const missing = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ transactionId: transaction.transactionId, status: "queued" }, 202))
      .mockResolvedValueOnce(json({ transactionId: transaction.transactionId, status: "accepted", result: stagedResult }));
    await expect(new AgentProducerClient({ context, fetch: missing }).submitAndWait(transaction))
      .resolves.toEqual({ status: "conflict", transactionId: transaction.transactionId, message: "Transaction status is malformed." });

    for (const status of ["reverted", "stale"] as const) {
      const request = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(json({ transactionId: transaction.transactionId, status: "queued" }, 202))
        .mockResolvedValueOnce(json({
          transactionId: transaction.transactionId,
          status,
          ...(status === "stale" ? { result: { transactionId: transaction.transactionId, status: "rejected", error: { code: "stale_document", message: "stale" } } } : {}),
          ...(status === "reverted" ? { result: stagedResult } : {}),
        }));
      await expect(new AgentProducerClient({ context, fetch: request }).submitAndWait(transaction)).resolves.toEqual({ status, transactionId: transaction.transactionId });
    }

    const artifact = { sourcePath: "concept.svg", revision: 5, svg: '<svg xmlns="http://www.w3.org/2000/svg" />' };
    const reconnecting = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ transactionId: transaction.transactionId, status: "queued" }, 202))
      .mockResolvedValueOnce(json({ transactionId: transaction.transactionId, status: "disconnected" }))
      .mockResolvedValueOnce(json({ transactionId: transaction.transactionId, status: "queued" }))
      .mockResolvedValueOnce(json({ transactionId: transaction.transactionId, status: "accepted", result: stagedResult, artifact }));
    await expect(new AgentProducerClient({ context, fetch: reconnecting, pollIntervalMs: 1 }).submitAndWait(transaction))
      .resolves.toEqual({ status: "accepted", transactionId: transaction.transactionId, artifact });
  });

  it("bounds waiting and distinguishes unavailable and duplicate-ID conflict", async () => {
    const pending = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => init?.method === "POST"
      ? json({ transactionId: transaction.transactionId, status: "queued" }, 202)
      : json({ transactionId: transaction.transactionId, status: "queued" }));
    await expect(new AgentProducerClient({ context, fetch: pending, pollIntervalMs: 1, timeoutMs: 2 }).submitAndWait(transaction))
      .resolves.toMatchObject({ status: "timeout" });
    const unavailable = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    await expect(new AgentProducerClient({ context, fetch: unavailable }).submitAndWait(transaction)).resolves.toEqual({
      status: "unavailable", transactionId: transaction.transactionId, message: "Canvas is unavailable.",
    });
    const conflict = vi.fn<typeof fetch>().mockResolvedValue(json({}, 409));
    await expect(new AgentProducerClient({ context, fetch: conflict }).submitAndWait(transaction)).resolves.toMatchObject({ status: "conflict" });
  });

  it("normalizes rejected and malformed-response diagnostics to bounded secret-free outcomes", async () => {
    const rejected = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ transactionId: transaction.transactionId, status: "queued" }, 202))
      .mockResolvedValueOnce(json({
        transactionId: transaction.transactionId,
        status: "rejected",
        result: {
          transactionId: transaction.transactionId,
          status: "rejected",
          error: { code: "invalid_payload", message: "token=server-secret", operationId: "rename", path: "operations[0]" },
        },
      }));
    const outcome = await new AgentProducerClient({ context, fetch: rejected }).submitAndWait(transaction);
    expect(outcome).toEqual({
      status: "rejected",
      transactionId: transaction.transactionId,
      error: {
        transactionId: transaction.transactionId,
        status: "rejected",
        error: { code: "invalid_payload", message: "Canvas rejected the transaction.", operationId: "rename", path: "operations[0]" },
      },
    });
    expect(JSON.stringify(outcome)).not.toContain("server-secret");

    const malformed = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ transactionId: transaction.transactionId, status: "queued" }, 202))
      .mockResolvedValueOnce(json({ transactionId: "other", status: "accepted", diagnostic: "token=server-secret" }));
    await expect(new AgentProducerClient({ context, fetch: malformed }).submitAndWait(transaction)).resolves.toEqual({
      status: "conflict", transactionId: transaction.transactionId, message: "Transaction status is malformed.",
    });
  });

  it("validates manifest identity, layer shape, and unexpected fields at runtime", async () => {
    const valid = { sessionId: "session", sourcePath: "concept.svg", revision: 4, layers: [{ sessionKey: "logo", name: "Logo", type: "g", locked: false }] };
    await expect(new AgentProducerClient({ context, fetch: vi.fn<typeof fetch>().mockResolvedValue(json(valid)) }).manifest()).resolves.toEqual(valid);
    for (const malformed of [
      { ...valid, revision: -1 },
      { ...valid, extra: true },
      { ...valid, layers: [{ ...valid.layers[0], locked: "no" }] },
      { ...valid, layers: [valid.layers[0], valid.layers[0]] },
    ]) {
      await expect(new AgentProducerClient({ context, fetch: vi.fn<typeof fetch>().mockResolvedValue(json(malformed)) }).manifest()).rejects.toThrow();
    }
  });

  it("fails closed for malformed status identity, vocabulary, fields, results, and accepted artifacts", async () => {
    const artifact = { sourcePath: "concept.svg", revision: 5, svg: '<svg xmlns="http://www.w3.org/2000/svg" />' };
    const malformed = [
      { transactionId: "other", status: "queued" },
      { transactionId: transaction.transactionId, status: "mystery" },
      { transactionId: transaction.transactionId, status: "accepted", result: stagedResult, artifact, extra: true },
      { transactionId: transaction.transactionId, status: "accepted", result: stagedResult, artifact: { ...artifact, sourcePath: "other.svg" } },
      { transactionId: transaction.transactionId, status: "accepted", result: stagedResult, artifact: { ...artifact, revision: 6 } },
      { transactionId: transaction.transactionId, status: "accepted", result: stagedResult, artifact: { ...artifact, svg: "not svg" } },
      { transactionId: transaction.transactionId, status: "accepted", result: stagedResult, artifact: { ...artifact, svg: "<svg" } },
      { transactionId: transaction.transactionId, status: "accepted", result: stagedResult, artifact: { ...artifact, svg: "<svg></svg><svg></svg>" } },
      { transactionId: transaction.transactionId, status: "accepted", result: stagedResult, artifact: { ...artifact, svg: '<svg data-lineage-key="leak"></svg>' } },
      { transactionId: transaction.transactionId, status: "pending_review" },
      { transactionId: transaction.transactionId, status: "rejected", result: { transactionId: transaction.transactionId, status: "rejected", error: null } },
      { transactionId: transaction.transactionId, status: "rejected", result: { transactionId: transaction.transactionId, status: "rejected", error: { code: "invented_error", message: "bad" } } },
      { transactionId: transaction.transactionId, status: "pending_review", result: { ...stagedResult, impact: [{ operationId: "other", affectedSessionKeys: [] }] } },
    ];
    for (const state of malformed) {
      const request = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(json({ transactionId: transaction.transactionId, status: "queued" }, 202))
        .mockResolvedValueOnce(json(state));
      await expect(new AgentProducerClient({ context, fetch: request }).submitAndWait(transaction)).resolves.toMatchObject({ status: "conflict" });
    }
  });

  it("rejects the authoritative clean-SVG adversarial corpus at the producer outcome boundary", async () => {
    for (const entry of CLEAN_AGENT_SVG_REJECTION_CORPUS) {
      const request = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(json({ transactionId: transaction.transactionId, status: "queued" }, 202))
        .mockResolvedValueOnce(json({
          transactionId: transaction.transactionId,
          status: "accepted",
          result: stagedResult,
          artifact: { sourcePath: "concept.svg", revision: 5, svg: entry.svg },
        }));
      await expect(new AgentProducerClient({ context, fetch: request }).submitAndWait(transaction), entry.name)
        .resolves.toMatchObject({ status: "conflict" });
    }
  });
});
