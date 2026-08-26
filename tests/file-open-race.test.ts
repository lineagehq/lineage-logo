import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";
import { AgentSession, type AgentSessionEditor } from "../src/client/agent/session";
import { evaluateAgentTransaction, type AgentSelectionIntent } from "../src/client/agent/transaction";
import {
  commitAuthorizedFileSwitch,
  commitLatestFileOpen,
  FileOpenCoordinator,
} from "../src/client/file-open";
import { History } from "../src/client/history/history";
import { parseAgentTransaction } from "../src/shared/agent-protocol";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function transaction() {
  return parseAgentTransaction({
    protocolVersion: 1,
    transactionId: "pending-race",
    producer: { kind: "test", name: "file-open-race" },
    document: { sessionId: "original-session", sourcePath: "concepts/original.svg", baseRevision: 0 },
    operations: [{ type: "renameLayer", operationId: "rename", target: { sessionKey: "logo" }, name: "Pending name" }],
  });
}

describe("atomic file-open commit lifecycle", () => {
  it("preserves every pending document state when staging occurs before the delayed response commits", async () => {
    const window = new Window();
    window.document.body.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path id="logo" data-lineage-key="logo" /></svg>';
    const canonical = window.document.querySelector("svg") as unknown as SVGSVGElement;
    const editor: AgentSessionEditor = {
      stageAgentTransaction: (value, context) => evaluateAgentTransaction(canonical, value, context),
      beginAgentAcceptance: () => { throw new Error("Delayed open test must not accept"); },
      finalizeAgentAcceptance: () => undefined,
      rollbackAgentAcceptance: () => undefined,
      applyAgentSelection: () => undefined,
      setAgentMutationBlocked: () => undefined,
    };
    const session = new AgentSession(editor);
    session.open("original-session", "concepts/original.svg");
    const state = {
      selectedFile: "concepts/original.svg",
      fileUi: "original-selected",
      dom: canonical.outerHTML,
      editorLoads: 0,
      dirty: true,
      review: "none",
      manifest: session.manifest([{ sessionKey: "logo", name: "logo", type: "path", locked: false }]),
    };
    const response = deferred<string>();
    const coordinator = new FileOpenCoordinator();
    const opening = commitLatestFileOpen({
      coordinator,
      load: () => response.promise,
      isPending: () => Boolean(session.pending),
      commit: (markup) => {
        state.selectedFile = "concepts/delayed.svg";
        state.fileUi = "delayed-selected";
        state.dom = markup;
        state.editorLoads += 1;
        state.dirty = false;
        state.review = "cleared";
        session.open("delayed-session", "concepts/delayed.svg");
        state.manifest = session.manifest([]);
      },
    });

    const staged = session.stage(transaction());
    expect(staged?.result.status).toBe("staged");
    state.review = "pending-race";
    state.manifest = session.manifest([{ sessionKey: "logo", name: "logo", type: "path", locked: false }]);
    const pendingState = structuredClone(state);
    response.resolve('<svg viewBox="0 0 20 20"><circle /></svg>');

    expect(await opening).toBe(false);
    expect(state).toEqual(pendingState);
    expect(session.pending?.transaction.transactionId).toBe("pending-race");
    expect(session.context).toEqual({ sessionId: "original-session", sourcePath: "concepts/original.svg", revision: 0 });
  });

  it("commits only the latest eligible response when concurrent opens resolve out of order", async () => {
    const coordinator = new FileOpenCoordinator();
    const first = deferred<string>();
    const second = deferred<string>();
    const commits: string[] = [];
    const openFirst = commitLatestFileOpen({ coordinator, load: () => first.promise, isPending: () => false, commit: (value) => commits.push(value) });
    const openSecond = commitLatestFileOpen({ coordinator, load: () => second.promise, isPending: () => false, commit: (value) => commits.push(value) });
    second.resolve("newer.svg");
    expect(await openSecond).toBe(true);
    first.resolve("stale.svg");
    expect(await openFirst).toBe(false);
    expect(commits).toEqual(["newer.svg"]);
  });

  for (const decision of ["accept", "revert"] as const) {
    it(`permanently invalidates a delayed response when review reaches ${decision} before release`, async () => {
      const window = new Window();
      window.document.body.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path id="logo" data-lineage-key="logo" /></svg>';
      let canonical = window.document.querySelector("svg") as unknown as SVGSVGElement;
      const history = new History();
      let dirty = false;
      let selection: AgentSelectionIntent | undefined = { targetSessionKeys: ["logo"], primarySessionKey: "logo" };
      const editor: AgentSessionEditor = {
        stageAgentTransaction: (value, context) => evaluateAgentTransaction(canonical, value, context),
        beginAgentAcceptance: (candidate, nextSelection) => {
          const checkpoint = canonical.outerHTML;
          canonical.replaceWith(candidate);
          canonical = candidate;
          dirty = true;
          selection = nextSelection;
          return checkpoint;
        },
        finalizeAgentAcceptance: (checkpoint) => { history.checkpoint(String(checkpoint)); },
        rollbackAgentAcceptance: () => undefined,
        applyAgentSelection: (nextSelection) => { selection = nextSelection; },
        setAgentMutationBlocked: () => undefined,
      };
      const session = new AgentSession(editor);
      session.open("original-session", "concepts/original.svg");
      const coordinator = new FileOpenCoordinator();
      const response = deferred<string>();
      const fileUi = { selected: "concepts/original.svg", label: "original.svg" };
      let editorLoads = 0;
      let review = "none";
      let manifest = session.manifest([{ sessionKey: "logo", name: "logo", type: "path", locked: false }]);
      const opening = commitLatestFileOpen({
        coordinator,
        load: () => response.promise,
        isPending: () => Boolean(session.pending),
        commit: (markup) => {
          fileUi.selected = "concepts/delayed.svg";
          fileUi.label = "delayed.svg";
          canonical.outerHTML = markup;
          editorLoads += 1;
          dirty = false;
          review = "cleared";
          session.open("delayed-session", "concepts/delayed.svg");
          manifest = session.manifest([]);
        },
      });

      const staged = session.stage(transaction());
      expect(staged?.result.status).toBe("staged");
      if (staged?.result.status === "staged") coordinator.invalidate();
      review = "pending-race";
      if (decision === "accept") {
        expect(session.beginAccept()).toBe(true);
        expect(session.finalizeAccept("pending-race")).toBe(true);
      }
      else expect(session.revert()).toBe(true);
      review = decision === "accept" ? "accepted" : "reverted";
      manifest = session.manifest([{ sessionKey: "logo", name: decision === "accept" ? "Pending name" : "logo", type: "path", locked: false }]);
      const terminalState = {
        canonical: canonical.outerHTML,
        dirty,
        editorLoads,
        fileUi: structuredClone(fileUi),
        history: history.checkpointCount,
        manifest: structuredClone(manifest),
        review,
        revision: session.revision,
        selection: structuredClone(selection),
        session: structuredClone(session.context),
      };

      response.resolve('<svg viewBox="0 0 20 20"><circle /></svg>');
      expect(await opening).toBe(false);
      expect({
        canonical: canonical.outerHTML,
        dirty,
        editorLoads,
        fileUi,
        history: history.checkpointCount,
        manifest,
        review,
        revision: session.revision,
        selection,
        session: session.context,
      }).toEqual(terminalState);
      if (decision === "accept") {
        expect(canonical.querySelector("#logo")?.getAttribute("aria-label")).toBe("Pending name");
        expect(dirty).toBe(true);
        expect(history.checkpointCount).toBe(1);
        expect(session.revision).toBe(1);
      } else {
        expect(canonical.querySelector("#logo")?.hasAttribute("aria-label")).toBe(false);
        expect(dirty).toBe(false);
        expect(history.checkpointCount).toBe(0);
        expect(session.revision).toBe(0);
      }
    });
  }
});

describe("unsaved file-switch authority", () => {
  for (const decision of ["accept", "revert"] as const) {
    it(`rejects a deferred post-Save workspace response through ${decision} without any partial commit`, async () => {
      const coordinator = new FileOpenCoordinator();
      const request = coordinator.begin();
      const workspace = deferred<{ rootName: string; files: string[]; nextIterationPath: string }>();
      let pending = false;
      const state = {
        workspaceName: "BleepThat",
        fileCount: 2,
        nextIterationPath: "iterations/iteration-3.svg",
        fileControls: ["concepts/original.svg", "iterations/iteration-2.svg"],
        currentFile: "concepts/original.svg",
        svg: '<svg viewBox="0 0 10 10"><path id="logo" /></svg>',
        dirty: true,
        history: ["rename"],
        selection: ["logo"],
        drillScope: "mark",
        zoom: 1.75,
        recovery: "pending-race",
        fileControlsEnabled: true,
        inspectorRevealed: false,
        reviewFocus: "none",
        targetOpens: 0,
        fileListRebuilds: 0,
      };
      const before = structuredClone(state);
      const refresh = (async () => {
        const response = await workspace.promise;
        return commitAuthorizedFileSwitch({
          coordinator,
          request,
          isPending: () => pending,
        }, () => {
          state.workspaceName = response.rootName;
          state.fileCount = response.files.length;
          state.nextIterationPath = response.nextIterationPath;
          state.fileControls = [...response.files];
          state.fileListRebuilds += 1;
          state.targetOpens += 1;
        });
      })();

      pending = true;
      coordinator.invalidate();
      state.fileControlsEnabled = false;
      state.inspectorRevealed = true;
      state.reviewFocus = "accept";
      workspace.resolve({
        rootName: "Late workspace",
        files: ["iterations/iteration-3.svg"],
        nextIterationPath: "iterations/iteration-4.svg",
      });

      expect(await refresh).toBe(false);
      expect(state).toEqual({
        ...before,
        fileControlsEnabled: false,
        inspectorRevealed: true,
        reviewFocus: "accept",
      });
      pending = false;
      state.fileControlsEnabled = true;
      state.reviewFocus = decision;
      expect(state.targetOpens).toBe(0);
      expect(state.fileListRebuilds).toBe(0);
    });
  }

  for (const saved of [true, false]) {
    for (const decision of ["accept", "revert"] as const) {
      it(`blocks a ${saved ? "successful" : "failed"} in-flight Save after review reaches ${decision}`, async () => {
        const coordinator = new FileOpenCoordinator();
        const request = coordinator.begin();
        const save = deferred<boolean>();
        const state = {
          currentFile: "concepts/original.svg",
          svg: '<svg viewBox="0 0 10 10"><path id="logo" /></svg>',
          dirty: true,
          history: ["rename"],
          selection: ["logo"],
          drillScope: "mark",
          zoom: 1.75,
          recovery: "pending-race",
          fileControlsEnabled: true,
          dialogOpen: true,
          targetOpens: 0,
          fileListRebuilds: 0,
          discardFallthroughs: 0,
          reviewFocus: "none",
        };
        const before = structuredClone(state);
        const switching = (async () => {
          const result = await save.promise;
          if (!coordinator.canCommit(request, true)) return false;
          if (!result) state.dialogOpen = true;
          else state.fileListRebuilds += 1;
          state.targetOpens += 1;
          return true;
        })();

        coordinator.invalidate();
        state.dialogOpen = false;
        state.fileControlsEnabled = false;
        state.reviewFocus = "accept";
        save.resolve(saved);

        expect(await switching).toBe(false);
        expect(state).toEqual({
          ...before,
          dialogOpen: false,
          fileControlsEnabled: false,
          reviewFocus: "accept",
        });
        state.fileControlsEnabled = true;
        state.reviewFocus = decision;
        expect(state.targetOpens).toBe(0);
        expect(state.fileListRebuilds).toBe(0);
        expect(state.discardFallthroughs).toBe(0);
      });
    }
  }

  it("blocks a dialog decision that resolves in the same turn as review staging", async () => {
    const coordinator = new FileOpenCoordinator();
    const request = coordinator.begin();
    const decision = deferred<"discard">();
    const state = { targetOpens: 0, discardFallthroughs: 0, reviewFocus: "none" };
    const switching = (async () => {
      const result = await decision.promise;
      if (!coordinator.canCommit(request, true)) return false;
      if (result === "discard") state.discardFallthroughs += 1;
      state.targetOpens += 1;
      return true;
    })();
    coordinator.invalidate();
    state.reviewFocus = "accept";
    decision.resolve("discard");
    expect(await switching).toBe(false);
    expect(state).toEqual({ targetOpens: 0, discardFallthroughs: 0, reviewFocus: "accept" });
  });
});
