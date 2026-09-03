import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = JSON.parse(readFileSync("docs/public-beta/walkthrough-receipt.schema.json", "utf8"));
const protocol = readFileSync("docs/public-beta/cohort-protocol.md", "utf8");
const triage = readFileSync("docs/public-beta/triage.md", "utf8");
const invitation = readFileSync("docs/public-beta/invitation.md", "utf8");
const quickstart = readFileSync("docs/public-beta/seatify-quickstart.md", "utf8");
const readme = readFileSync("README.md", "utf8");
const exampleReceipt = JSON.parse(readFileSync("docs/public-beta/walkthrough-receipt.example.json", "utf8"));

function validates(value: unknown, rule: any, root = schema): boolean {
  if (rule.$ref) return validates(value, rule.$ref.split("/").slice(1).reduce((node: any, key: string) => node[key], root), root);
  if (rule.const !== undefined && value !== rule.const) return false;
  if (rule.enum && !rule.enum.includes(value)) return false;
  if (rule.type === "object" && (!value || typeof value !== "object" || Array.isArray(value))) return false;
  if (rule.type === "string" && typeof value !== "string") return false;
  if (rule.type === "integer" && (!Number.isInteger(value))) return false;
  if (rule.pattern && (typeof value !== "string" || !(new RegExp(rule.pattern).test(value)))) return false;
  if (rule.minimum !== undefined && (typeof value !== "number" || value < rule.minimum)) return false;
  if (rule.maximum !== undefined && (typeof value !== "number" || value > rule.maximum)) return false;
  if (rule.required && rule.required.some((key: string) => !(key in (value as Record<string, unknown>)))) return false;
  if (rule.properties && value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    if (rule.additionalProperties === false && Object.keys(object).some((key) => !(key in rule.properties))) return false;
    if (Object.entries(rule.properties).some(([key, propertyRule]) => key in object && !validates(object[key], propertyRule, root))) return false;
  }
  if (rule.allOf && rule.allOf.some((part: any) => !validates(value, part, root))) return false;
  if (rule.oneOf && rule.oneOf.filter((part: any) => validates(value, part, root)).length !== 1) return false;
  if (rule.not && validates(value, rule.not, root)) return false;
  if (rule.if && validates(value, rule.if, root) && rule.then && !validates(value, rule.then, root)) return false;
  if (rule.if && !validates(value, rule.if, root) && rule.else && !validates(value, rule.else, root)) return false;
  return true;
}

function validReceipt() {
  return {
    receipt_version: 1, kind: "lineage-logo.public-beta.walkthrough", walkthrough_id: "W-ABC123", participant_slot: "P-001",
    installed_version: "0.1.0-beta.1", environment: { platform: "macos", node_major: 22, browser: "chromium" },
    attempt_status: "valid",
    milestones: {
      fresh_install: { status: "pass", duration_seconds: 30, friction_code: "none" }, non_destructive_bootstrap: { status: "pass", duration_seconds: 20, friction_code: "none" },
      proposal_comprehension: { status: "pass", duration_seconds: 30, friction_code: "none" }, review: { status: "pass", duration_seconds: 45, friction_code: "none" },
      accept_and_durable_save: { status: "pass", duration_seconds: 10, friction_code: "none" }, clean_reopen: { status: "pass", duration_seconds: 25, friction_code: "none" },
    },
    recovery: { action: "none", result: "not_needed" }, issue_code: "none",
  };
}

function triagePolicy() {
  const match = triage.match(/```json\n([\s\S]*?)\n```/);
  if (!match) throw new Error("missing machine-readable triage precedence");
  return JSON.parse(match[1]) as { precedence: Array<{ signal: string; issue_code: string }> };
}

function selectIssueCode(signals: string[]) {
  return triagePolicy().precedence.find((entry) => signals.includes(entry.signal))?.issue_code ?? "none";
}

describe("public beta cohort operating kit", () => {
  it("publishes a strict, versioned, privacy-minimal walkthrough receipt contract", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.required).toEqual(expect.arrayContaining(["receipt_version", "kind", "walkthrough_id", "participant_slot", "installed_version", "environment", "attempt_status", "milestones", "recovery", "issue_code"]));
    expect(schema.properties.receipt_version.const).toBe(1);
    expect(schema.properties.kind.const).toBe("lineage-logo.public-beta.walkthrough");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.environment.additionalProperties).toBe(false);
    expect(schema.properties.environment.properties.platform.enum).toEqual(["macos", "linux", "windows", "other"]);
    expect(schema.properties.environment.properties.node_major.minimum).toBe(0);
    expect(schema.properties.environment.properties.browser.enum).toEqual(["chromium", "firefox", "webkit", "other"]);
    expect(schema.properties.participant_slot.pattern).toBe("^P-(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,})$");
    expect(schema.properties.milestones.required).toEqual(["fresh_install", "non_destructive_bootstrap", "proposal_comprehension", "review", "accept_and_durable_save", "clean_reopen"]);
    expect(schema.$defs.milestoneEvidence.required).toEqual(["status", "duration_seconds", "friction_code"]);
    expect(schema.$defs.milestoneEvidence.properties.duration_seconds.maximum).toBe(3600);
    expect(schema.properties.issue_code.enum).toContain("safety_or_data_loss");
    expect(Object.keys(schema.properties)).not.toEqual(expect.arrayContaining([
      "name", "email", "credentials", "token", "private_path", "svg", "browser_session", "details", "reidentification_map",
    ]));
  });

  it("accepts a complete supported receipt but rejects unsupported or incoherent valid claims", () => {
    expect(validates(validReceipt(), schema)).toBe(true);
    expect(validates({ ...validReceipt(), attempt_status: "valid", environment: { platform: "windows", node_major: 20, browser: "firefox" } }, schema)).toBe(false);
    expect(validates({ ...validReceipt(), milestones: { ...validReceipt().milestones, accept_and_durable_save: { status: "blocked", duration_seconds: 10, friction_code: "save" } } }, schema)).toBe(false);
  });

  it("records unsupported environments as validating, non-counting invalid receipts", () => {
    const receipt = {
      ...validReceipt(), attempt_status: "invalid", issue_code: "unsupported_environment",
      environment: { platform: "windows", node_major: 20, browser: "firefox" },
      milestones: Object.fromEntries(schema.properties.milestones.required.map((key: string) => [key, { status: "not_attempted", duration_seconds: 0, friction_code: "none" }])),
      recovery: { action: "stop", result: "not_attempted" },
    };
    expect(validates(receipt, schema)).toBe(true);
  });

  it("allows only coherent recovery action and result pairs", () => {
    expect(validates({ ...validReceipt(), attempt_status: "incomplete", recovery: { action: "retry_same_step_once", result: "passed" } }, schema)).toBe(true);
    expect(validates({ ...validReceipt(), attempt_status: "incomplete", recovery: { action: "none", result: "failed" } }, schema)).toBe(false);
    expect(validates({ ...validReceipt(), attempt_status: "incomplete", recovery: { action: "stop", result: "passed" } }, schema)).toBe(false);
  });

  it("requires unaided published-registry walkthroughs and complete durable milestones", () => {
    expect(protocol).toContain("published, exact public-beta");
    expect(protocol).toContain("local tarballs");
    expect(protocol).toContain("must not coach");
    expect(protocol).toContain("Node.js 22 or newer, macOS or Linux, and Chromium");
    expect(protocol).toContain("non_destructive_bootstrap");
    expect(protocol).toContain("proposal_comprehension");
    expect(protocol).toContain("accept_and_durable_save");
    expect(protocol).toContain("durable path and digest");
    expect(protocol).toContain("exact resolved installed version");
    expect(protocol).toContain("participant slot");
    expect(triage).toContain("accept_and_durable_save");
    expect(protocol).toContain("every required milestone is `pass`");
    expect(protocol).toContain("does not count");
  });

  it("makes recovery, invalidation, and local triage deterministic without external promises", () => {
    expect(protocol).toContain("retry_same_step_once");
    expect(protocol).toContain("restart_from_fresh_install");
    expect(protocol).toContain("attempt_status` to `invalid`");
    expect(protocol).toMatch(/neither\s+confidential handling nor a response-time commitment/);
    for (const issueCode of schema.properties.issue_code.enum) expect(triage).toContain(`\`${issueCode}\``);
    expect(triage).toContain("does not create an issue");
    expect(triage).toContain("There is no confidential-reporting channel or SLA");
  });

  it("selects one deterministic issue code when receipt signals overlap", () => {
    expect(selectIssueCode(["unsupported_environment", "install_failure"])).toBe("unsupported_environment");
    expect(selectIssueCode(["bootstrap_safety", "safety_or_data_loss"])).toBe("safety_or_data_loss");
    expect(selectIssueCode(["accept_and_durable_save", "reopen_or_persistence"])).toBe("reopen_or_persistence");
    expect(selectIssueCode([])).toBe("none");
  });

  it("ships a schema-valid non-counting receipt starter with deterministic participant validation", () => {
    expect(validates(exampleReceipt, schema)).toBe(true);
    expect(exampleReceipt.attempt_status).toBe("incomplete");
    expect(exampleReceipt.installed_version).toBe("0.1.0-beta.2");
    expect(JSON.stringify(exampleReceipt)).not.toMatch(/name|email|detail|feedback|path|svg|token|session/i);
    expect(protocol).toContain("walkthrough-receipt.example.json");
    expect(protocol).toContain("ajv-cli@5.0.0 validate --spec=draft2020 --strict=false");
    expect(protocol).toContain("Do not transmit a receipt unless validation reports `valid`");
  });

  it("permits transmission of controlled receipt JSON only through owner-approved private handling", () => {
    for (const document of [protocol, invitation]) {
      expect(document).toContain("only the schema-valid JSON receipt");
      expect(document).toContain("owner-approved privacy-safe");
      expect(document).toMatch(/no (?:name-to-slot map|identity linkage)/i);
      expect(document).toMatch(/no free[- ]text/i);
    }
    expect(invitation).not.toMatch(/issue tracker|github\.com\/[^\s)]+\/issues|non-sensitive issues/i);
  });

  it("uses one concrete workspace path and no shell-active angle placeholders in runnable commands", () => {
    for (const document of [readme, quickstart]) {
      const shellBlocks = [...document.matchAll(/```bash\n([\s\S]*?)\n```/g)].map((match) => match[1]);
      const betaBlocks = shellBlocks.filter((block) => block.includes("lineage-logo"));
      expect(betaBlocks.length).toBeGreaterThan(0);
      for (const block of betaBlocks) expect(block).not.toMatch(/<[^>]+>/);
    }
    expect(quickstart).toContain('walkthrough_root="/tmp/lineage-logo-seatify-walkthrough"');
    expect(quickstart).toContain('--workspace "$walkthrough_root/seatify-workspace"');
    expect(quickstart).toContain("--workspace /tmp/lineage-logo-seatify-walkthrough/seatify-workspace");
    expect(quickstart).toContain("--artifact /tmp/lineage-logo-seatify-walkthrough/seatify-workspace/concepts/seatify-constellation.svg");
    expect(quickstart).toContain("The install project and Seatify workspace are separate directories");
  });
});
