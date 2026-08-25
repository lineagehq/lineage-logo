import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import {
  buildLogoDesignerReceipt, buildLogoDesignerTransaction, extractLayerArtifact,
  LOGO_DESIGNER_RECEIPT_KIND, LOGO_DESIGNER_RECEIPT_VERSION, runLogoDesignerAdapter,
} from "../scripts/logo-designer-adapter";
import { evaluateAgentTransaction } from "../src/client/agent/transaction";
import type { AgentProducerClient } from "../src/producer/agent-client";
import { validateCleanAgentSvg, type AgentDocumentManifest } from "../src/shared/agent-protocol";

const fixture = new URL("./fixtures/agent/logo-designer-output.svg", import.meta.url);
const manifest: AgentDocumentManifest = {
  sessionId: "adapter-session", sourcePath: "concept.svg", revision: 3,
  layers: [{ sessionKey: "logo-key", name: "logo", type: "g", locked: false }],
};

describe("logo-designer public protocol adapter", () => {
  it("extracts a nested transformed gradient/text layer with its referenced resources", async () => {
    const source = await readFile(fixture, "utf8");
    expect(() => validateCleanAgentSvg(source)).not.toThrow();
    const fragment = extractLayerArtifact(source, "#logo");
    expect(fragment).toContain('transform="translate(12 10)"');
    expect(fragment).toContain("linearGradient");
    expect(fragment).toContain('href="#agent-spark"');
    expect(fragment).toContain("<text");
    expect(fragment).toContain("<title");
  });

  it.each(["image", "use"])("rejects top-level <%s> artifacts that the canvas cannot edit", (tag) => {
    expect(() => extractLayerArtifact(`<svg><${tag} id="asset" /></svg>`, "#asset"))
      .toThrow("Selector must match one selectable SVG layer");
  });

  it("turns a produced artifact into the same strict transaction contract and stages it detached", async () => {
    const transaction = await buildLogoDesignerTransaction({
      mode: "replace", artifact: fileURLToPath(fixture),
      selector: "#logo", targetName: "logo", transactionId: "adapter-fixture",
    }, manifest);
    const window = new Window();
    window.document.body.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg"><g id="logo" data-lineage-key="logo-key"><path d="M0 0h1"/></g></svg>';
    const canonical = window.document.querySelector("svg") as unknown as SVGSVGElement;
    const before = canonical.outerHTML;
    const staged = evaluateAgentTransaction(canonical, transaction, { sessionId: manifest.sessionId, sourcePath: manifest.sourcePath, revision: manifest.revision });
    expect(staged.result.status).toBe("staged");
    expect(staged.candidate?.querySelector("#wordmark")?.textContent).toBe("Lineage");
    expect(staged.candidate?.querySelector("#agent-gradient")).not.toBeNull();
    expect(canonical.outerHTML).toBe(before);
  });

  it("builds targeted adjustments without reading or importing editor internals", async () => {
    const transaction = await buildLogoDesignerTransaction({
      mode: "set-paint", targetName: "logo",
      property: "fill", value: "#0ea5e9", transactionId: "targeted",
    }, manifest);
    expect(transaction.operations).toEqual([{ type: "setPaint", operationId: "targeted-paint", target: { sessionKey: "logo-key" }, property: "fill", value: "#0ea5e9" }]);
  });

  it("versions the secret-free stdout receipt and binds every accepted identity", async () => {
    const transaction = await buildLogoDesignerTransaction({
      mode: "set-paint", targetName: "logo", transactionId: "receipt-transaction",
    }, manifest);
    const receipt = buildLogoDesignerReceipt(transaction, {
      status: "accepted",
      transactionId: transaction.transactionId,
      artifact: { sourcePath: manifest.sourcePath, revision: manifest.revision + 1, svg: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>" },
    });
    expect(receipt).toEqual({
      receiptVersion: LOGO_DESIGNER_RECEIPT_VERSION,
      kind: LOGO_DESIGNER_RECEIPT_KIND,
      transaction: {
        transactionId: "receipt-transaction", sessionId: manifest.sessionId,
        sourcePath: manifest.sourcePath, baseRevision: manifest.revision,
      },
      outcome: {
        status: "accepted", transactionId: "receipt-transaction",
        artifact: { sourcePath: manifest.sourcePath, revision: 4, svg: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>" },
      },
    });
    expect(JSON.stringify(receipt)).not.toMatch(/token|apiOrigin|contextPath/);
  });

  it("refuses to emit receipts whose outcome or accepted artifact identity diverges", async () => {
    const transaction = await buildLogoDesignerTransaction({
      mode: "set-paint", targetName: "logo", transactionId: "receipt-transaction",
    }, manifest);
    expect(() => buildLogoDesignerReceipt(transaction, { status: "reverted", transactionId: "other" }))
      .toThrow("Producer outcome transaction identity");
    expect(() => buildLogoDesignerReceipt(transaction, {
      status: "accepted", transactionId: transaction.transactionId,
      artifact: { sourcePath: "other.svg", revision: 4, svg: "<svg></svg>" },
    })).toThrow("Accepted artifact identity");
  });

  it("uses strict preflight envelopes without fabricating transaction or document identity", async () => {
    const invalidArguments = await runLogoDesignerAdapter(["--token", "do-not-echo"]);
    expect(invalidArguments).toEqual({
      exitCode: 64,
      receipt: {
        receiptVersion: 1, kind: LOGO_DESIGNER_RECEIPT_KIND,
        outcome: { status: "invalid", diagnostic: "invalid_arguments" },
      },
    });
    expect(JSON.stringify(invalidArguments)).not.toContain("do-not-echo");

    const unavailableClient = { manifest: async () => { throw new Error("secret diagnostic"); } } as unknown as AgentProducerClient;
    const unavailable = await runLogoDesignerAdapter(["--mode", "set-paint", "--target-name", "logo"], unavailableClient);
    expect(unavailable).toEqual({
      exitCode: 24,
      receipt: {
        receiptVersion: 1, kind: LOGO_DESIGNER_RECEIPT_KIND,
        outcome: { status: "unavailable", diagnostic: "canvas_unavailable" },
      },
    });
    expect(JSON.stringify(unavailable)).not.toContain("secret diagnostic");
  });

  it("normalizes failures after manifest discovery into consumable receipts", async () => {
    const invalidArtifactClient = { manifest: async () => manifest } as unknown as AgentProducerClient;
    await expect(runLogoDesignerAdapter(["--mode", "replace", "--target-name", "logo"], invalidArtifactClient))
      .resolves.toMatchObject({ exitCode: 64, receipt: { outcome: { status: "invalid", diagnostic: "invalid_artifact" } } });

    const submissionClient = {
      manifest: async () => manifest,
      submitAndWait: async () => { throw new Error("token=must-not-escape"); },
    } as unknown as AgentProducerClient;
    const submitted = await runLogoDesignerAdapter(["--mode", "set-paint", "--target-name", "logo", "--transaction-id", "bounded"], submissionClient);
    expect(submitted).toMatchObject({
      exitCode: 0,
      receipt: { transaction: { transactionId: "bounded" }, outcome: { status: "unavailable", message: "Canvas is unavailable." } },
    });
    expect(JSON.stringify(submitted)).not.toContain("must-not-escape");
  });

  it("prints one versioned secret-free stdout receipt for invalid and unavailable CLI preflight", async () => {
    const execute = promisify(execFile);
    const tsx = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
    const script = fileURLToPath(new URL("../scripts/logo-designer-adapter.ts", import.meta.url));
    for (const invocation of [
      { args: [script, "--token", "cli-secret"], code: 64, status: "invalid" },
      { args: [script, "--context", "/definitely/missing/lineage-context.json", "--mode", "set-paint", "--target-name", "logo"], code: 24, status: "unavailable" },
    ]) {
      let failure: { code?: number; stdout?: string; stderr?: string } | undefined;
      try { await execute(tsx, invocation.args); }
      catch (error) { failure = error as typeof failure; }
      expect(failure?.code).toBe(invocation.code);
      expect(failure?.stderr).toBe("");
      const lines = failure?.stdout?.trim().split("\n") ?? [];
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed).toMatchObject({ receiptVersion: 1, kind: LOGO_DESIGNER_RECEIPT_KIND, outcome: { status: invocation.status } });
      expect(lines[0]).not.toContain("cli-secret");
      expect(parsed).not.toHaveProperty("transaction");
    }
  });

  it("reproduces the durable saved/reopened oracle hash and explicit structural delta", async () => {
    const saved = await readFile(new URL("../docs/oracle/artifacts/T009-final.svg", import.meta.url), "utf8");
    expect(() => validateCleanAgentSvg(saved)).not.toThrow();
    expect(Buffer.byteLength(saved)).toBe(1406);
    expect(createHash("sha256").update(saved).digest("hex")).toBe("9780ec8650c8255cac66e4579bf97388d2876dad5c186105cd34f67146463f56");
    const window = new Window();
    window.document.body.innerHTML = saved;
    const root = window.document.querySelector("svg")!;
    expect(root.getAttribute("viewBox")).toBe("0 0 512 512");
    expect(["accent", "round-clip", "cutout", "soft-shadow", "logo", "agent-gradient", "agent-spark", "wordmark"].every((id) => root.querySelector(`#${id}`))).toBe(true);
    expect(root.querySelector("#icon")).toBeNull();
    expect(root.querySelector("#logo")?.getAttribute("fill")).toBe("#14b8a6");
    expect(saved).not.toMatch(/data-(?:lineage|agent|review|transport)-|lineage-logo-edit|transactionId/);
  });

  it("permanently reproduces the genuine T006 skill lifecycle artifacts and continuation delta", async () => {
    const artifacts = [
      ["proposal", "../docs/oracle/artifacts/T006-skill-proposal.svg", 509, "59652c363192a5a70c5f668c67c5115b3e302ef0cfe03a027cf08463fbca5112"],
      ["accepted", "../docs/oracle/artifacts/T006-skill-accepted.svg", 588, "eb7556d2ec1c9f4d1396cf217d38c44a72a42b9453cbadffdb7edcef24963284"],
      ["continued", "../docs/oracle/artifacts/T006-skill-continued.svg", 602, "c7b86d04f958c2b13f73eba15d5812b58c7b2243e642d1e9e87b6a668de04b5b"],
    ] as const;
    const loaded = new Map<string, string>();
    for (const [name, path, bytes, hash] of artifacts) {
      const svg = await readFile(new URL(path, import.meta.url), "utf8");
      loaded.set(name, svg);
      expect(() => validateCleanAgentSvg(svg), name).not.toThrow();
      expect(Buffer.byteLength(svg), name).toBe(bytes);
      expect(createHash("sha256").update(svg).digest("hex"), name).toBe(hash);
      expect(svg, name).not.toMatch(/data-(?:lineage|agent|review|transport)-|lineage-logo-edit|transactionId|apiOrigin|token/);
    }
    const parse = (svg: string) => {
      const window = new Window();
      window.document.body.innerHTML = svg;
      return window.document.querySelector("svg")!;
    };
    const accepted = parse(loaded.get("accepted")!);
    const continued = parse(loaded.get("continued")!);
    const stableIds = ["logo", "shield", "prism", "signal", "focus", "horizon"];
    expect(stableIds.every((id) => accepted.querySelector(`#${id}`) && continued.querySelector(`#${id}`))).toBe(true);
    expect(accepted.querySelector("title")?.textContent).not.toBe(continued.querySelector("title")?.textContent);
    expect(accepted.querySelector("#shield")?.getAttribute("fill")).toBe("#172554");
    expect(continued.querySelector("#shield")?.getAttribute("fill")).toBe("#0f172a");
    expect(accepted.querySelector("#signal")?.getAttribute("fill")).toBe("#fb7185");
    expect(continued.querySelector("#signal")?.getAttribute("fill")).toBe("#f43f5e");
    expect(accepted.querySelector("#focus")?.getAttribute("r")).toBe("28");
    expect(continued.querySelector("#focus")?.getAttribute("r")).toBe("32");
    expect(accepted.querySelector("#horizon")?.getAttribute("d")).not.toBe(continued.querySelector("#horizon")?.getAttribute("d"));
    expect(accepted.querySelector("#prism")?.outerHTML).toBe(continued.querySelector("#prism")?.outerHTML);
  });
});

function fileURLToPath(url: URL): string {
  return decodeURIComponent(url.pathname);
}
