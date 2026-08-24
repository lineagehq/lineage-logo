import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { buildLogoDesignerTransaction, extractLayerArtifact } from "../scripts/logo-designer-adapter";
import { evaluateAgentTransaction } from "../src/client/agent/transaction";
import type { AgentDocumentManifest } from "../src/shared/agent-protocol";

const fixture = new URL("./fixtures/agent/logo-designer-output.svg", import.meta.url);
const manifest: AgentDocumentManifest = {
  sessionId: "adapter-session", sourcePath: "concept.svg", revision: 3,
  layers: [{ sessionKey: "logo-key", name: "logo", type: "g", locked: false }],
};

describe("logo-designer public protocol adapter", () => {
  it("extracts a nested transformed gradient/text layer with its referenced resources", async () => {
    const fragment = extractLayerArtifact(await readFile(fixture, "utf8"), "#logo");
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
      api: "http://unused", token: "secret", mode: "replace", artifact: fileURLToPath(fixture),
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
      api: "http://unused", token: "secret", mode: "set-paint", targetName: "logo",
      property: "fill", value: "#0ea5e9", transactionId: "targeted",
    }, manifest);
    expect(transaction.operations).toEqual([{ type: "setPaint", operationId: "targeted-paint", target: { sessionKey: "logo-key" }, property: "fill", value: "#0ea5e9" }]);
  });

  it("reproduces the durable saved/reopened oracle hash and explicit structural delta", async () => {
    const saved = await readFile(new URL("../docs/oracle/artifacts/T009-final.svg", import.meta.url), "utf8");
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
});

function fileURLToPath(url: URL): string {
  return decodeURIComponent(url.pathname);
}
