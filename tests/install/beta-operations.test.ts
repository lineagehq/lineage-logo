import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const schema = JSON.parse(readFileSync("docs/public-beta/walkthrough-receipt.schema.json", "utf8"));
const protocol = readFileSync("docs/public-beta/cohort-protocol.md", "utf8");
const triage = readFileSync("docs/public-beta/triage.md", "utf8");
const invitation = readFileSync("docs/public-beta/invitation.md", "utf8");
const quickstart = readFileSync("docs/public-beta/seatify-quickstart.md", "utf8");
const readme = readFileSync("README.md", "utf8");
const betaReadme = readFileSync("docs/public-beta/README.md", "utf8");
const exampleReceipt = JSON.parse(readFileSync("docs/public-beta/walkthrough-receipt.example.json", "utf8"));
const attestationSchema = JSON.parse(readFileSync("docs/public-beta/distinct-user-attestation.schema.json", "utf8"));
const attestationExample = JSON.parse(readFileSync("docs/public-beta/distinct-user-attestation.example.json", "utf8"));
const attestationVerifier = "docs/public-beta/validate-distinct-user-attestation.mjs";

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
    receipt_version: 1, kind: "lineage-logo.public-beta.walkthrough", walkthrough_id: "W-0123456789ABCDEF0123456789ABCDEF", participant_slot: "P-FEDCBA9876543210FEDCBA9876543210",
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

function verifyAttestation(mutator?: (attestation: any, receipts: any[]) => boolean | void) {
  const directory = mkdtempSync(join(tmpdir(), "lineage-logo-attestation-"));
  try {
    const receipts = [1, 2, 3].map((index) => ({
      ...validReceipt(),
      walkthrough_id: `W-${String(index).padStart(32, "0")}`,
      participant_slot: `P-${String(index).padStart(32, "0")}`,
      installed_version: "0.1.0-beta.3",
    }));
    const receiptPaths = receipts.map((receipt, index) => {
      const path = join(directory, `receipt-${index + 1}.json`);
      writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
      return path;
    });
    const attestation = structuredClone(attestationExample);
    attestation.accepted_receipts = receiptPaths.map((path, index) => ({
      participant_id: receipts[index].participant_slot,
      walkthrough_id: receipts[index].walkthrough_id,
      receipt_sha256: createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase(),
    }));
    const rewriteReceipts = mutator?.(attestation, receipts);
    if (rewriteReceipts) {
      receiptPaths.forEach((path, index) => {
        writeFileSync(path, `${JSON.stringify(receipts[index], null, 2)}\n`);
        attestation.accepted_receipts[index].receipt_sha256 = createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
      });
    }
    const attestationPath = join(directory, "attestation.json");
    writeFileSync(attestationPath, `${JSON.stringify(attestation, null, 2)}\n`);
    return spawnSync(process.execPath, [attestationVerifier, attestationPath, ...receiptPaths], { encoding: "utf8" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
  it("keeps immutable beta.3 release copy durable and registry-authoritative", () => {
    for (const document of [readme, betaReadme]) {
      expect(document).toContain("As of 2026-09-03 UTC");
      expect(document).toContain("`lineage-logo@0.1.0-beta.2`");
      expect(document).toMatch(/signed\s+SLSA provenance/);
      expect(document).toContain("`latest`");
      expect(document).toContain("`0.1.0-beta.1`");
      expect(document).toContain("`lineage-logo@0.1.0-beta.3`");
      expect(document).toMatch(/publication,\s+provenance,\s+and registry-QA status[^.]*current\s+npm registry\s+metadata/i);
      expect(document).toMatch(/never inferred from (?:the )?package(?:'s)? own text/i);
      expect(document).toMatch(/At\s+preparation time on 2026-09-03 UTC/);
      expect(document).toContain("**0/3 independent walkthroughs**");
      expect(document).not.toMatch(/beta\.3`? is (?:an? )?(?:unpublished|published)/i);
      expect(document).not.toMatch(/beta\.3[^.\n]*has (?:no |signed )?provenance/i);
      expect(document).not.toMatch(/beta\.3[^.\n]*has not been published/i);
    }
  });

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
    expect(schema.properties.participant_slot.pattern).toBe("^P-[A-F0-9]{32}$");
    expect(schema.properties.walkthrough_id.pattern).toBe("^W-[A-F0-9]{32}$");
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
    expect(protocol).toContain("participant_slot");
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
    expect(exampleReceipt.installed_version).toBe("0.1.0-beta.3");
    expect(JSON.stringify(exampleReceipt)).not.toMatch(/name|email|detail|feedback|path|svg|token|session/i);
    expect(protocol).toContain("walkthrough-receipt.example.json");
    expect(protocol).toContain("ajv-cli@5.0.0 validate --spec=draft2020 --strict=false");
    expect(protocol).toContain("Do not transmit a receipt unless validation reports `valid`");
  });

  it("uses participant-generated 128-bit receipt identifiers without identity claims", () => {
    expect(protocol).toContain('randomBytes(16)');
    expect(protocol).toContain('toString("hex").toUpperCase()');
    expect(protocol).toContain("identifiers distinguish receipts, not humans");
    expect(protocol).not.toContain("invitation-supplied");
  });

  it("keeps the retained invitation generic and freezes bounded intake handling", () => {
    expect(invitation).not.toMatch(/<RECIPIENT>|<OWNER_APPROVED_CHANNEL>|<P-NNN>|<W-/);
    expect(protocol).toContain("at most 14 days");
    expect(protocol).toContain("private authenticated-sender");
    expect(protocol).toMatch(/at most one counting receipt\s+per sender/);
    expect(protocol).toContain("within 24 hours");
    expect(protocol).toContain("transiently compare");
    expect(protocol).toContain("no identity mapping");
    expect(protocol).toContain("no provider deletion or anonymity claim");
  });

  it("ships a bounded three-receipt aggregate attestation contract", () => {
    expect(attestationSchema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(attestationSchema.additionalProperties).toBe(false);
    expect(attestationSchema.properties.accepted_receipts.minItems).toBe(3);
    expect(attestationSchema.properties.accepted_receipts.maxItems).toBe(3);
    expect(attestationSchema.properties.accepted_count.const).toBe(3);
    expect(attestationSchema.properties.channel_class.const).toBe("owner_approved_private_authenticated_deletable");
    expect(attestationSchema.properties.collection_window_days.maximum).toBe(14);
    expect(attestationSchema.properties.statement.const).toContain("three distinct owner-approved authenticated human senders");
    expect(attestationSchema.properties.limitation.const).toContain("not cryptographic or independently re-auditable identity proof");
    expect(attestationExample.accepted_receipts).toHaveLength(3);
    expect(attestationExample.accepted_receipts.every((entry: any) => /^P-[A-F0-9]{32}$/.test(entry.participant_id) && /^W-[A-F0-9]{32}$/.test(entry.walkthrough_id) && /^[A-F0-9]{64}$/.test(entry.receipt_sha256))).toBe(true);
    for (const field of ["participant_id", "walkthrough_id", "receipt_sha256"] as const) {
      expect(new Set(attestationExample.accepted_receipts.map((entry: any) => entry[field])).size).toBe(3);
    }
    expect(Object.values(attestationExample.fixed_statements)).toEqual([true, true, true, true, true, true]);
    expect(Object.keys(attestationExample.rejection_counts)).toEqual(["schema_invalid", "duplicate_identifier", "duplicate_sender", "prohibited_data", "unsupported_attempt", "non_passing"]);
    const duplicateIdentifier = structuredClone(attestationExample);
    duplicateIdentifier.accepted_receipts[1].participant_id = duplicateIdentifier.accepted_receipts[0].participant_id;
    expect(new Set(duplicateIdentifier.accepted_receipts.map((entry: any) => entry.participant_id)).size).not.toBe(3);
    const duplicateDigest = structuredClone(attestationExample);
    duplicateDigest.accepted_receipts[1].receipt_sha256 = duplicateDigest.accepted_receipts[0].receipt_sha256;
    expect(new Set(duplicateDigest.accepted_receipts.map((entry: any) => entry.receipt_sha256)).size).not.toBe(3);
  });

  it("semantically verifies exactly three unique digest-bound counting receipts", () => {
    const valid = verifyAttestation();
    expect(valid.status).toBe(0);
    expect(valid.stdout.trim()).toBe('{"ok":true,"code":"ATTESTATION_VALID"}');
    expect(valid.stderr).toBe("");

    const rejectionCases: Array<[string, (attestation: any, receipts: any[]) => boolean | void]> = [
      ["duplicate participant ID", (value) => { value.accepted_receipts[1].participant_id = value.accepted_receipts[0].participant_id; }],
      ["duplicate walkthrough ID", (value) => { value.accepted_receipts[1].walkthrough_id = value.accepted_receipts[0].walkthrough_id; }],
      ["duplicate digest", (value) => { value.accepted_receipts[1].receipt_sha256 = value.accepted_receipts[0].receipt_sha256; }],
      ["digest mismatch", (value) => { value.accepted_receipts[0].receipt_sha256 = "A".repeat(64); }],
      ["participant identifier mismatch", (value) => { value.accepted_receipts[0].participant_id = `P-${"A".repeat(32)}`; }],
      ["walkthrough identifier mismatch", (value) => { value.accepted_receipts[0].walkthrough_id = `W-${"A".repeat(32)}`; }],
      ["wrong accepted count", (value) => { value.accepted_count = 2; }],
      ["wrong receipt count", (value) => { value.accepted_receipts.pop(); }],
      ["impossible date", (value) => { value.collection_window_start = "2026-02-30"; }],
      ["reversed dates", (value) => { value.collection_window_start = "2026-01-15"; value.collection_window_end = "2026-01-14"; }],
      ["inconsistent duration", (value) => { value.collection_window_days = 13; }],
      ["attestation before window end", (value) => { value.attestation_date = "2026-01-13"; }],
      ["non-counting receipt", (_value, receipts) => { receipts[0].attempt_status = "invalid"; return true; }],
    ];
    for (const [name, mutate] of rejectionCases) {
      const result = verifyAttestation(mutate);
      expect(result.status, name).toBe(1);
      expect(result.stdout, name).toBe("");
      expect(result.stderr, name).toMatch(/^\{"ok":false,"code":"[A-Z_]+"\}\n$/);
      expect(result.stderr, name).not.toMatch(/receipt-|attestation\.json|P-|W-/);
    }
  });

  it("permits transmission of controlled receipt JSON only through owner-approved private handling", () => {
    for (const document of [protocol, invitation]) {
      expect(document).toMatch(/only (?:the )?schema-valid (?:controlled )?(?:JSON receipt|receipt JSON)/);
      expect(document).toContain("private authenticated-sender");
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
