import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { deriveArtifactProposal, extractArtifactGroup } from "../src/producer/artifact";
import { validateLocalProposal } from "../src/cli/proposal-validation";
import { evaluateAgentTransaction } from "../src/client/agent/transaction";
import { parseAgentTransaction, type AgentOperation } from "../src/shared/agent-protocol";

const artifact = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><defs><linearGradient id="base"><stop offset="0" stop-color="#05a"/></linearGradient><linearGradient id="paint" href="#base"/><mask id="cut"><rect width="100" height="100" fill="white"/></mask><path id="shape" d="M0 0 L20 0 L10 20 Z"/></defs><g id="logo" aria-label="Brand"><g transform="translate(4 8) rotate(15)"><use href="#shape" fill="url(#paint)" mask="url(#cut)"/></g><text x="40" y="30">Brand</text></g><g id="unrelated"/></svg>`;
const context = { sessionId: "s", sourcePath: "a.svg", revision: 2 };
function root() { const w = new Window(); w.document.body.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg"><g data-lineage-key="parent" transform="scale(2)"><g data-lineage-key="mark" transform="rotate(20)"><path d="M0 0L10 10"/></g><text data-lineage-key="text" fill="#manual">Manual</text></g></svg>'; return w.document.querySelector('svg') as unknown as SVGSVGElement; }
function tx(operations: AgentOperation[]) { return parseAgentTransaction({ protocolVersion: 1, transactionId: "t", producer: { kind: "test" }, document: { sessionId: "s", sourcePath: "a.svg", baseRevision: 2 }, operations }); }
const move: AgentOperation = { type: "translateLayer", operationVersion: 1, operationId: "move", target: { sessionKey: "mark" }, dx: 4, dy: -2 };
const text: AgentOperation = { type: "setText", operationVersion: 1, operationId: "text", target: { sessionKey: "text" }, value: "Fresh" };
describe("artifact structural handoff", () => {
  it("derives nested artwork plus exactly its transitive local resources", () => {
    const svg = extractArtifactGroup(artifact, "logo");
    expect(svg).toContain('transform="translate(4 8) rotate(15)"');
    for (const id of ["base", "paint", "cut", "shape"]) expect(svg).toContain(`id="${id}"`);
    expect(svg).not.toContain('id="unrelated"');
    const payload = JSON.stringify({ protocolVersion: 1, transactionId: "t", producer: { kind: "test" }, document: { sessionId: "s", baseRevision: 2 }, operations: [{ type: "addLayer", operationId: "add", parent: null, placement: "last" }] });
    const proposal = validateLocalProposal(deriveArtifactProposal(payload, artifact, "logo"));
    const canonical = root(); const before = canonical.outerHTML;
    const staged = evaluateAgentTransaction(canonical, tx(proposal.operations), context);
    expect(staged.result.status).toBe("staged");
    expect(staged.candidate?.querySelector('#logo use')?.getAttribute('href')).toBe('#shape');
    expect(canonical.outerHTML).toBe(before);
    expect(evaluateAgentTransaction(staged.candidate!, tx(proposal.operations), context).result).toMatchObject({ status: "rejected", error: { code: "id_conflict" } });
  });
  it("replaces the selected artifact group and resources atomically while preserving outside content", () => {
    const canonical = root();
    const first = evaluateAgentTransaction(canonical, tx([{ type: 'addLayer', operationId: 'add', parent: null, placement: 'last', svg: extractArtifactGroup(artifact, 'logo') }]), context).candidate!;
    const group = first.querySelector('#logo')!;
    const operation: AgentOperation = { type: 'replaceLayer', operationId: 'replace', target: { sessionKey: group.getAttribute('data-lineage-key')! }, svg: extractArtifactGroup(artifact.replace('Brand</text>', 'Revised</text>'), 'logo') };
    const before = first.outerHTML;
    const result = evaluateAgentTransaction(first, tx([operation]), context);
    expect(result.result.status).toBe('staged');
    expect(result.candidate?.querySelector('#logo text')?.textContent).toBe('Revised');
    expect(result.candidate?.querySelector('[data-lineage-key="parent"]')?.outerHTML).toBe(first.querySelector('[data-lineage-key="parent"]')?.outerHTML);
    expect(first.outerHTML).toBe(before);
    const broken = { ...operation, svg: '<g id="logo"><path/></g>' };
    first.querySelector('[data-lineage-key="mark"]')!.setAttribute('fill', 'url(#paint)');
    expect(evaluateAgentTransaction(first, tx([broken]), context).result).toMatchObject({ status: 'rejected', error: { code: 'reference_damage' } });
  });
  it("fails missing, duplicate, inherited-context, broken references, active and inconsistent inputs", () => {
    expect(() => extractArtifactGroup(artifact, "absent")).toThrow();
    expect(() => extractArtifactGroup(artifact.replace('id="unrelated"', 'id="logo"'), "logo")).toThrow();
    expect(() => extractArtifactGroup(artifact.replace('id="shape"', 'id="other"'), "logo")).toThrow();
    expect(() => extractArtifactGroup(artifact.replace('<g id="logo"', '<g onclick="run()" id="logo"'), "logo")).toThrow();
    expect(() => extractArtifactGroup('<svg xmlns="http://www.w3.org/2000/svg"><g transform="scale(2)"><g id="logo"/></g></svg>', 'logo')).toThrow();
    expect(() => deriveArtifactProposal(JSON.stringify({ operations: [{ type: "addLayer", svg: '<g/>' }] }), artifact, 'logo')).toThrow();
    expect(() => deriveArtifactProposal(JSON.stringify({ operations: [{ type: "setPaint" }] }), artifact, 'logo')).toThrow();
  });
  it("preserves unrelated manual paint and nested authored transforms in narrow edits", () => {
    const canonical = root(); const before = canonical.outerHTML;
    const staged = evaluateAgentTransaction(canonical, tx([move, text]), context);
    expect(staged.result.status).toBe('staged');
    expect(staged.candidate?.querySelector('[data-lineage-key="mark"]')?.getAttribute('transform')).toBe('matrix(1,0,0,1,4,-2) rotate(20)');
    expect(staged.candidate?.querySelector('text')?.getAttribute('fill')).toBe('#manual');
    expect(staged.candidate?.querySelector('text')?.textContent).toBe('Fresh');
    expect(canonical.outerHTML).toBe(before);
  });
  it("rejects the whole batch on locked, stale, structured-text and no-op cases", () => {
    const canonical = root(); const before = canonical.outerHTML;
    expect(evaluateAgentTransaction(canonical, tx([move, text]), context, new Set(['text'])).result).toMatchObject({ status: 'rejected', error: { code: 'locked_target' } });
    expect(evaluateAgentTransaction(canonical, tx([move]), { ...context, revision: 3 }).result).toMatchObject({ status: 'rejected', error: { code: 'stale_document' } });
    expect(evaluateAgentTransaction(canonical, tx([{ ...move, dx: 0, dy: 0 }]), context).result).toMatchObject({ status: 'rejected', error: { code: 'no_op' } });
    expect(canonical.outerHTML).toBe(before);
    canonical.querySelector('text')!.innerHTML = '<tspan>Structured</tspan>';
    expect(evaluateAgentTransaction(canonical, tx([move, text]), context).result).toMatchObject({ status: 'rejected', error: { code: 'invalid_payload' } });
  });
  it("rejects unknown operation versions, invalid text and unbounded transforms locally", () => {
    for (const operation of [{ ...move, operationVersion: 2 }, { ...move, dx: 1e10 }, { ...text, value: '<tag>' }, { ...text, value: 'x'.repeat(2049) }]) expect(() => tx([operation as AgentOperation])).toThrow();
  });
});
