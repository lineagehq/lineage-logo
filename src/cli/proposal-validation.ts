import { SaxesParser } from "saxes";
import { AgentProtocolError, isAgentErrorCode, parsePublicAgentProposal, validateCleanAgentSvg, type AgentTransactionError, type PublicAgentProposalV1 } from "../shared/agent-protocol.js";

export interface SafeCliError { code: string; operationId?: string; field?: string; nextAction: string }
const knownFields = new Set("transaction proposal document producer operations protocolVersion transactionId sessionId baseRevision kind name version intent type operationId parent placement svg target property value targets primary scope before after sessionKey operationVersion dx dy artifact".split(" "));
export function safeError(detail: Partial<AgentTransactionError>, fallback = "invalid_payload"): SafeCliError {
  const code = isAgentErrorCode(detail.code) ? detail.code : fallback;
  // Never reflect arbitrary field names or remote messages: either may contain private data.
  const pieces = typeof detail.path === "string" ? detail.path.slice(0, 512).match(/[A-Za-z_][A-Za-z_0-9]*|\[\d+\]/g) ?? [] : [];
  const safe: string[] = [];
  for (const piece of pieces) {
    if (!knownFields.has(piece) && !/^\[\d{1,3}\]$/.test(piece)) break;
    safe.push(piece);
  }
  const field = safe.join(".").replace(/\.\[/g, "[").slice(0, 160);
  const operationId = typeof detail.operationId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(detail.operationId) ? detail.operationId : undefined;
  const guidance: Record<string, string> = {
    stale_document: "Refresh context and rebuild the proposal against the current revision.",
    timeout: "Inspect the editor and existing transaction outcome before retrying; do not blindly submit a duplicate.",
    conflict: "Inspect the existing transaction and resolve pending review before retrying.",
    pending_transaction: "Finish the pending review before submitting another proposal.",
    unavailable_editor: "Start or reconnect the selected editor, then refresh context.",
    reviewer_rejection: "Revise the proposal using reviewer feedback and fresh context with a new transaction identity.",
    unsupported_version: "Use protocolVersion 1 and supported operationVersion values from lineage-logo schema.",
    unsafe_svg: "Remove active content, external resources and reserved metadata, then validate again.",
    invalid_svg: "Supply one well-formed selectable SVG layer fragment, then validate again.",
    invalid_paint: "Use a supported color, none, currentColor or a local resource reference.",
    locked_target: "Choose an unlocked target or ask the reviewer to unlock it, then refresh context.",
    invalid_reference: "Use a current session key or the ID of an earlier operation.",
    reference_damage: "Keep local references intact. For artifact extraction, put resources inside the selected group with verified appearance, or move inherited group presentation onto artwork children.",
  };
  return { code, ...(operationId ? { operationId } : {}), ...(field ? { field } : {}), nextAction: guidance[code] ?? "Inspect lineage-logo schema, correct the indicated proposal field and run lineage-logo validate again." };
}

export function validateLocalProposal(payload: string): PublicAgentProposalV1 {
  let proposal: PublicAgentProposalV1;
  try { proposal = parsePublicAgentProposal(payload); }
  catch (error) {
    if (error instanceof AgentProtocolError) {
      const match = error.detail.path?.match(/^operations\[(\d+)\]/);
      if (match) {
        try { error.detail.operationId = JSON.parse(payload).operations?.[Number(match[1])]?.operationId; } catch { /* Malformed JSON has no safe operation identity. */ }
      }
    }
    throw error;
  }
  for (const [index, op] of proposal.operations.entries()) {
    const fail = (code: AgentTransactionError["code"], field: string): never => { throw new AgentProtocolError({ code, message: "Proposal failed local validation.", operationId: op.operationId, path: `operations[${index}].${field}` }); };
    if (op.type === "addLayer" || op.type === "replaceLayer") {
      const wrapped = `<svg xmlns="http://www.w3.org/2000/svg">${op.svg}</svg>`;
      const roots: string[] = [];
      let depth = 0;
      let unsupportedNamespace = false;
      const parser = new SaxesParser({ xmlns: true });
      parser.on("opentag", (tag) => {
        if (depth === 1) roots.push(tag.local);
        // Fragments use the editor evaluator's narrower namespace contract.
        // Standalone saved SVG permits xml:lang/space, but v1 fragments do not.
        if (tag.uri !== "http://www.w3.org/2000/svg" || Object.values(tag.attributes).some((attribute) =>
          !["", "http://www.w3.org/1999/xlink", "http://www.w3.org/2000/xmlns/"].includes(attribute.uri))) unsupportedNamespace = true;
        depth += 1;
      });
      parser.on("closetag", () => { depth -= 1; });
      try { parser.write(wrapped).close(); } catch { fail("invalid_svg", "svg"); }
      if (unsupportedNamespace) fail("unsafe_svg", "svg");
      if (roots.length !== 1 || !["g", "path", "rect", "circle", "ellipse", "polygon", "polyline", "line", "text"].includes(roots[0])) fail("invalid_svg", "svg");
      try { validateCleanAgentSvg(wrapped); } catch { fail("unsafe_svg", "svg"); }
    } else if (op.type === "setPaint" && op.value !== null) {
      const candidate = op.value.trim();
      if (!(candidate === "none" || candidate === "currentColor" || /^#[0-9a-f]{3,8}$/i.test(candidate)
        || /^(?:rgb|rgba|hsl|hsla)\([^;{}]+\)$/i.test(candidate) || /^[a-z]+$/i.test(candidate)
        || /^url\(\s*#[A-Za-z_][\w:.-]*\s*\)$/.test(candidate))) fail("invalid_paint", "value");
      const escaped = candidate.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      try { validateCleanAgentSvg(`<svg xmlns="http://www.w3.org/2000/svg"><rect fill="${escaped}"/></svg>`); }
      catch { fail("invalid_paint", "value"); }
    }
  }
  return proposal;
}
