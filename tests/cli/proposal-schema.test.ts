import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { PUBLIC_PROPOSAL_SCHEMA, PROPOSAL_EXAMPLES } from "../../src/cli/proposal-schema";
import { validateLocalProposal } from "../../src/cli/proposal-validation";
import { parsePublicAgentProposal } from "../../src/shared/agent-protocol";

const ajv = new Ajv2020({ allErrors: true });
ajv.addKeyword("x-maxEncodedBytes");
ajv.addKeyword("x-maxUtf16CodeUnits");
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


describe("v1 Unicode text bounds", () => {
  const exactAjv = new Ajv2020({ allErrors: true });
  exactAjv.addKeyword("x-maxEncodedBytes");
  exactAjv.addKeyword({
    keyword: "x-maxUtf16CodeUnits", type: "string", schemaType: "number",
    validate: (limit: number, value: string) => value.length <= limit,
  });
  const exactValidate = exactAjv.compile(PUBLIC_PROPOSAL_SCHEMA);
  const cases = [
    { label: "producer.kind", limit: 128, set: (p: any, text: string) => { p.producer.kind = text; } },
    { label: "producer.name", limit: 128, set: (p: any, text: string) => { p.producer.name = text; } },
    { label: "producer.version", limit: 128, set: (p: any, text: string) => { p.producer.version = text; } },
    { label: "intent", limit: 1024, set: (p: any, text: string) => { p.intent = text; } },
    { label: "rename.name", limit: 512, set: (p: any, text: string) => { p.operations[0].name = text; } },
  ];
  it.each(cases)("matches runtime at BMP, astral and mixed boundaries for $label", ({ limit, set }) => {
    for (const text of ["a".repeat(limit), "a".repeat(limit + 1), "😀".repeat(limit / 2), "😀".repeat(limit / 2 + 1), "😀".repeat(limit / 2 - 1) + "ab", "😀".repeat(limit / 2) + "a"]) {
      const proposal = clone(PROPOSAL_EXAMPLES[2]); set(proposal, text);
      const valid = text.length <= limit;
      expect(exactValidate(proposal), JSON.stringify(exactValidate.errors)).toBe(valid);
      if (valid) expect(() => parsePublicAgentProposal(proposal)).not.toThrow();
      else expect(() => parsePublicAgentProposal(proposal)).toThrow();
    }
  });
  it("annotates every bounded non-ASCII text field including SVG and paint", () => {
    const fields: Array<Record<string, unknown>> = [];
    const visit = (node: unknown) => {
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      if (record.type === "string" && typeof record.maxLength === "number" && !record.pattern) fields.push(record);
      Object.values(record).forEach(visit);
    };
    visit(PUBLIC_PROPOSAL_SCHEMA);
    expect(fields).toHaveLength(8); // Three producer fields, intent, two fragments, rename and paint.
    for (const field of fields) {
      expect(field["x-maxUtf16CodeUnits"]).toBe(field.maxLength);
      expect(field.description).toContain("lineage-logo validate");
    }
  });
  it("exposes the plain JSON Schema limitation instead of claiming astral conformance", () => {
    const proposal = clone(PROPOSAL_EXAMPLES[2]);
    proposal.operations[0].name = "😀".repeat(300);
    expect(validate(proposal)).toBe(true); // 300 codepoints, but 600 UTF-16 units.
    expect(exactValidate(proposal)).toBe(false);
    expect(() => validateLocalProposal(JSON.stringify(proposal))).toThrow();
    expect(PUBLIC_PROPOSAL_SCHEMA.description).toContain("not full v1 text conformance");
  });
});
