import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { PUBLIC_PROPOSAL_SCHEMA, PROPOSAL_EXAMPLES } from "../../src/cli/proposal-schema";
import { validateLocalProposal } from "../../src/cli/proposal-validation";
import { parsePublicAgentProposal } from "../../src/shared/agent-protocol";

const ajv = new Ajv2020({ allErrors: true });
ajv.addKeyword("x-maxEncodedBytes");
const validate = ajv.compile(PUBLIC_PROPOSAL_SCHEMA);
const clone = (value: unknown): any => JSON.parse(JSON.stringify(value));

describe("independent Draft 2020-12 proposal schema conformance", () => {
  it.each(PROPOSAL_EXAMPLES.map((proposal) => [proposal.operations[0].type, proposal] as const))("accepts %s in AJV and both runtime boundaries", (_type, proposal) => {
    expect(validate(proposal), JSON.stringify(validate.errors)).toBe(true);
    expect(parsePublicAgentProposal(proposal)).toEqual(proposal);
    expect(validateLocalProposal(JSON.stringify(proposal))).toEqual(proposal);
  });
  it("rejects unknown fields at every object boundary in schema and runtime", () => {
    for (const example of PROPOSAL_EXAMPLES) {
      const paths = [[], ["producer"], ["document"], ["operations", 0]];
      if ("target" in example.operations[0]) paths.push(["operations", 0, "target"]);
      for (const keys of paths) {
        const proposal = clone(example);
        let object = proposal;
        for (const key of keys) object = object[key];
        object.unknown = "untrusted";
        expect(validate(proposal)).toBe(false);
        expect(() => parsePublicAgentProposal(proposal)).toThrow();
      }
    }
  });
  it("rejects missing required operation fields without rejecting optional focus fields", () => {
    for (const example of PROPOSAL_EXAMPLES) {
      for (const key of Object.keys(example.operations[0])) {
        const proposal = clone(example);
        delete proposal.operations[0][key];
        const optional = example.operations[0].type === "selectFocus" && ["primary", "scope"].includes(key);
        expect(validate(proposal)).toBe(optional);
        if (optional) expect(() => parsePublicAgentProposal(proposal)).not.toThrow();
        else expect(() => parsePublicAgentProposal(proposal)).toThrow();
      }
    }
  });
  it.each([
    { protocolVersion: 2 }, { transactionId: "" }, { intent: "x".repeat(1025) },
    { producer: { kind: "" } }, { document: { sessionId: "session", baseRevision: -1 } },
    { document: { sessionId: "session", baseRevision: 0.5 } },
    { document: { sessionId: "session", baseRevision: Number.MAX_SAFE_INTEGER + 1 } },
    { operations: [] }, { operations: Array(101).fill(PROPOSAL_EXAMPLES[0].operations[0]) },
  ])("rejects invalid root and bounds %j", (patch) => {
    const proposal = { ...PROPOSAL_EXAMPLES[0], ...patch };
    expect(validate(proposal)).toBe(false);
    expect(() => parsePublicAgentProposal(proposal)).toThrow();
  });
  it("documents semantic checks beyond JSON Schema and rejects them locally", () => {
    for (const operations of [
      [{ ...PROPOSAL_EXAMPLES[0].operations[0], svg: '<g onclick="bad()"/>' }],
      [PROPOSAL_EXAMPLES[0].operations[0], PROPOSAL_EXAMPLES[0].operations[0]],
      [{ ...PROPOSAL_EXAMPLES[4].operations[0], target: { operationId: "future" } }],
    ]) {
      const proposal = { ...PROPOSAL_EXAMPLES[0], operations };
      expect(validate(proposal)).toBe(true);
      expect(() => validateLocalProposal(JSON.stringify(proposal))).toThrow();
    }
  });
});
