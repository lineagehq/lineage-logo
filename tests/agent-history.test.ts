import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { AgentSession, type AgentSessionEditor } from "../src/client/agent/session";
import type { AgentSelectionIntent, StagedAgentTransaction } from "../src/client/agent/transaction";
import { History } from "../src/client/history/history";
import { parseAgentTransaction, type AgentTransactionV1 } from "../src/shared/agent-protocol";

interface FakeSnapshot { markup: string; selection?: AgentSelectionIntent }

class FakeEditor implements AgentSessionEditor {
  readonly history = new History();
  blocked = false;
  acceptCalls = 0;
  appliedSelection?: AgentSelectionIntent;
  next?: StagedAgentTransaction;
  state: FakeSnapshot;

  constructor(markup: string, selection?: AgentSelectionIntent) { this.state = { markup, selection }; }
  stageAgentTransaction(): StagedAgentTransaction | undefined { return this.next; }
  setAgentMutationBlocked(blocked: boolean): void { this.blocked = blocked; }
  applyAgentSelection(selection?: AgentSelectionIntent): void { this.appliedSelection = selection; }
  beginAgentAcceptance(candidate: SVGSVGElement, selection?: AgentSelectionIntent): unknown {
    const checkpoint = JSON.stringify(this.state);
    this.acceptCalls += 1;
    this.state = { markup: candidate.outerHTML, selection };
    return checkpoint;
  }
  finalizeAgentAcceptance(checkpoint: unknown): void {
    this.history.checkpoint(String(checkpoint));
  }
  rollbackAgentAcceptance(checkpoint: unknown): void {
    this.state = JSON.parse(String(checkpoint)) as FakeSnapshot;
  }
  undo(): boolean {
    const previous = this.history.undo(JSON.stringify(this.state));
    if (!previous) return false;
    this.state = JSON.parse(previous) as FakeSnapshot;
    return true;
  }
  redo(): boolean {
    const next = this.history.redo(JSON.stringify(this.state));
    if (!next) return false;
    this.state = JSON.parse(next) as FakeSnapshot;
    return true;
  }
}

function transaction(id = "tx", revision = 0): AgentTransactionV1 {
  return parseAgentTransaction({
    protocolVersion: 1, transactionId: id, producer: { kind: "test", name: "history" },
    document: { sessionId: "session", sourcePath: "concept.svg", baseRevision: revision },
    operations: [{ type: "renameLayer", operationId: "rename", target: { sessionKey: "b" }, name: "Changed" }],
  });
}

function candidate(): SVGSVGElement {
  const window = new Window();
  window.document.body.innerHTML = '<svg><g id="group" data-lineage-key="group"><path id="a" data-lineage-key="a"/><path id="b" data-lineage-key="b" aria-label="Changed"/></g></svg>';
  return window.document.querySelector("svg") as unknown as SVGSVGElement;
}

const initialMarkup = '<svg><g id="group" data-lineage-key="group"><path id="a" data-lineage-key="a"/><path id="b" data-lineage-key="b"/></g></svg>';
const initialSelection: AgentSelectionIntent = { targetSessionKeys: ["a", "b"], primarySessionKey: "a", scopeSessionKey: "group" };
const acceptedSelection: AgentSelectionIntent = { targetSessionKeys: ["a", "b"], primarySessionKey: "b", scopeSessionKey: "group" };

describe("agent transaction history and revision", () => {
  it("keeps failed and reverted candidates outside canonical state and history", () => {
    const editor = new FakeEditor(initialMarkup, initialSelection);
    const session = new AgentSession(editor);
    session.open("session", "concept.svg");
    editor.next = { result: { transactionId: "bad", status: "rejected", error: { code: "missing_target", message: "missing" } } };
    expect(session.stage(transaction("bad"))?.result.status).toBe("rejected");
    expect(editor.history.checkpointCount).toBe(0);
    expect(editor.state.markup).toBe(initialMarkup);

    editor.next = { candidate: candidate(), selection: acceptedSelection, result: { transactionId: "tx", status: "staged", impact: [] } };
    expect(session.stage(transaction())?.result.status).toBe("staged");
    expect(editor.blocked).toBe(true);
    expect(editor.state.markup).toBe(initialMarkup);
    expect(session.revert()).toBe(true);
    expect(editor.blocked).toBe(false);
    expect(editor.history.checkpointCount).toBe(0);
    expect(session.revision).toBe(0);
  });

  it("accepts as one checkpoint and restores hierarchy, scope, and multi-selection through monotonic undo/redo", () => {
    const editor = new FakeEditor(initialMarkup, initialSelection);
    let revisionNotifications = 0;
    const session = new AgentSession(editor, () => { revisionNotifications += 1; });
    session.open("session", "concept.svg");
    editor.next = { candidate: candidate(), selection: acceptedSelection, result: { transactionId: "tx", status: "staged", impact: [] } };
    session.stage(transaction());
    expect(session.beginAccept()).toBe(true);
    expect(editor.blocked).toBe(true);
    expect(editor.history.checkpointCount).toBe(0);
    expect(session.finalizeAccept("tx")).toBe(true);
    expect(editor.acceptCalls).toBe(1);
    expect(editor.history.checkpointCount).toBe(1);
    expect(editor.state.markup).toContain('aria-label="Changed"');
    expect(editor.state.selection).toEqual(acceptedSelection);
    expect(session.revision).toBe(1);

    expect(editor.undo()).toBe(true);
    session.documentChanged();
    expect(editor.state.markup).toBe(initialMarkup);
    expect(editor.state.selection).toEqual(initialSelection);
    expect(session.revision).toBe(2);

    expect(editor.redo()).toBe(true);
    session.documentChanged();
    expect(editor.state.markup).toContain('aria-label="Changed"');
    expect(editor.state.selection).toEqual(acceptedSelection);
    expect(session.revision).toBe(3);
    expect(revisionNotifications).toBe(3);
  });

  it("applies navigation immediately without history/revision and rejects a second pending mutation", () => {
    const editor = new FakeEditor(initialMarkup);
    const session = new AgentSession(editor);
    session.open("session", "concept.svg");
    editor.next = { selection: acceptedSelection, candidate: candidate(), result: { transactionId: "nav", status: "applied", impact: [] } };
    expect(session.stage(transaction("nav"))?.result.status).toBe("applied");
    expect(editor.appliedSelection).toEqual(acceptedSelection);
    expect(session.revision).toBe(0);

    editor.next = { selection: acceptedSelection, candidate: candidate(), result: { transactionId: "one", status: "staged", impact: [] } };
    session.stage(transaction("one"));
    const second = session.stage(transaction("two"));
    expect(second?.result.status).toBe("rejected");
    expect(second?.result.status === "rejected" && second.result.error.code).toBe("pending_transaction");
    expect(editor.history.checkpointCount).toBe(0);
  });

  it("caches a replayed pending transaction and prevents document-session replacement until terminal", () => {
    const editor = new FakeEditor(initialMarkup);
    const session = new AgentSession(editor);
    session.open("session", "concept.svg");
    editor.next = { candidate: candidate(), selection: acceptedSelection, result: { transactionId: "replay", status: "staged", impact: [] } };
    const first = session.stage(transaction("replay"));
    const replay = session.stage(transaction("replay"));
    expect(replay).toBe(first);
    expect(session.open("new-session", "other.svg")).toBe(false);
    expect(session.context).toEqual({ sessionId: "session", sourcePath: "concept.svg", revision: 0 });
    expect(editor.acceptCalls).toBe(0);
    expect(session.beginAccept()).toBe(true);
    expect(session.beginAccept()).toBe(true);
    expect(editor.acceptCalls).toBe(1);
    expect(session.finalizeAccept("replay")).toBe(true);
    expect(session.beginAccept()).toBe(false);
    expect(editor.history.checkpointCount).toBe(1);
    expect(session.revision).toBe(1);
    expect(session.open("new-session", "other.svg")).toBe(true);
    expect(session.context.sourcePath).toBe("other.svg");
  });

  it("restores an exact persisted document revision and rejects invalid recovery identity", () => {
    const editor = new FakeEditor(initialMarkup);
    const session = new AgentSession(editor);
    expect(session.open("persisted-session", "concept.svg", 7)).toBe(true);
    expect(session.context).toEqual({ sessionId: "persisted-session", sourcePath: "concept.svg", revision: 7 });
    expect(session.open("", "concept.svg", 7)).toBe(false);
    expect(session.open("persisted-session", "", 7)).toBe(false);
    expect(session.open("persisted-session", "concept.svg", -1)).toBe(false);
    expect(session.open("persisted-session", "concept.svg", 1.5)).toBe(false);
    expect(session.context).toEqual({ sessionId: "persisted-session", sourcePath: "concept.svg", revision: 7 });
  });

  it("keeps provisional acceptance locked and restores exact state, revision, and history after acknowledgement conflict", () => {
    const editor = new FakeEditor(initialMarkup, initialSelection);
    const session = new AgentSession(editor);
    session.open("session", "concept.svg");
    editor.next = { candidate: candidate(), selection: acceptedSelection, result: { transactionId: "rollback", status: "staged", impact: [] } };
    session.stage(transaction("rollback"));
    expect(session.beginAccept()).toBe(true);
    expect(editor.blocked).toBe(true);
    expect(editor.state.markup).toContain("Changed");
    expect(session.revision).toBe(1);
    expect(editor.history.checkpointCount).toBe(0);
    expect(session.open("other", "other.svg")).toBe(false);

    expect(session.rollbackAccept("rollback")).toBe(true);
    expect(editor.state).toEqual({ markup: initialMarkup, selection: initialSelection });
    expect(editor.blocked).toBe(false);
    expect(editor.history.checkpointCount).toBe(0);
    expect(session.revision).toBe(0);
    expect(session.pending).toBeUndefined();
  });

  it("converges a conflicting authoritative acceptance as one checkpoint without reverting", () => {
    const editor = new FakeEditor(initialMarkup, initialSelection);
    const session = new AgentSession(editor);
    session.open("session", "concept.svg");
    editor.next = { candidate: candidate(), selection: acceptedSelection, result: { transactionId: "authoritative", status: "staged", impact: [] } };
    session.stage(transaction("authoritative"));
    expect(session.beginAccept()).toBe(true);
    const authoritative = candidate();
    authoritative.querySelector("#b")?.setAttribute("aria-label", "Authoritative");

    expect(session.convergeAcceptedArtifact("authoritative", authoritative)).toBe(true);
    expect(editor.state.markup).toContain('aria-label="Authoritative"');
    expect(editor.blocked).toBe(false);
    expect(editor.history.checkpointCount).toBe(1);
    expect(session.revision).toBe(1);
    expect(session.pending).toBeUndefined();
    expect(editor.undo()).toBe(true);
    expect(editor.state).toEqual({ markup: initialMarkup, selection: initialSelection });
  });

  it("recovers an already-authoritative acceptance as one application and one checkpoint", () => {
    const editor = new FakeEditor(initialMarkup, initialSelection);
    const session = new AgentSession(editor);
    session.open("session", "concept.svg");
    editor.next = { candidate: candidate(), selection: acceptedSelection, result: { transactionId: "recovered-accept", status: "staged", impact: [] } };
    const authoritative = candidate();
    authoritative.querySelector("#b")?.setAttribute("aria-label", "Recovered authoritative");

    expect(session.recoverAcceptedArtifact(transaction("recovered-accept"), authoritative)).toBe(true);
    expect(editor.acceptCalls).toBe(1);
    expect(editor.history.checkpointCount).toBe(1);
    expect(editor.state.markup).toContain('aria-label="Recovered authoritative"');
    expect(editor.blocked).toBe(false);
    expect(session.pending).toBeUndefined();
    expect(session.revision).toBe(1);
    expect(session.recoverAcceptedArtifact(transaction("recovered-accept"), authoritative)).toBe(false);
    expect(editor.acceptCalls).toBe(1);
    expect(editor.history.checkpointCount).toBe(1);
  });

  it("reconciles only an exact automatic terminal event and leaves canonical history unchanged", () => {
    const editor = new FakeEditor(initialMarkup, initialSelection);
    const session = new AgentSession(editor);
    session.open("session", "concept.svg");
    editor.next = { candidate: candidate(), selection: acceptedSelection, result: { transactionId: "timeout", status: "staged", impact: [] } };
    session.stage(transaction("timeout"));
    expect(session.reconcileTerminal("other", "reverted")).toBe(false);
    expect(session.pending?.transaction.transactionId).toBe("timeout");
    expect(editor.blocked).toBe(true);
    expect(session.reconcileTerminal("timeout", "reverted")).toBe(true);
    expect(session.pending).toBeUndefined();
    expect(editor.blocked).toBe(false);
    expect(editor.state).toEqual({ markup: initialMarkup, selection: initialSelection });
    expect(editor.history.checkpointCount).toBe(0);
    expect(session.revision).toBe(0);
  });

  it("clears detached state on server replacement but requires explicit exact restore for provisional uncertainty", () => {
    const editor = new FakeEditor(initialMarkup, initialSelection);
    const session = new AgentSession(editor);
    session.open("session", "concept.svg");
    editor.next = { candidate: candidate(), selection: acceptedSelection, result: { transactionId: "detached", status: "staged", impact: [] } };
    session.stage(transaction("detached"));
    expect(session.serverReplaced()).toBe("detached-cleared");
    expect(session.pending).toBeUndefined();
    expect(editor.blocked).toBe(false);

    editor.next = { candidate: candidate(), selection: acceptedSelection, result: { transactionId: "uncertain", status: "staged", impact: [] } };
    session.stage(transaction("uncertain"));
    session.beginAccept();
    expect(session.serverReplaced()).toBe("provisional-uncertain");
    expect(session.recoveryRequired).toBe(true);
    expect(editor.blocked).toBe(true);
    expect(editor.state.markup).toContain("Changed");
    expect(session.restoreAfterServerReplacement("other")).toBe(false);
    expect(editor.blocked).toBe(true);
    expect(session.restoreAfterServerReplacement("uncertain")).toBe(true);
    expect(editor.state).toEqual({ markup: initialMarkup, selection: initialSelection });
    expect(editor.history.checkpointCount).toBe(0);
    expect(session.revision).toBe(0);
  });
});
