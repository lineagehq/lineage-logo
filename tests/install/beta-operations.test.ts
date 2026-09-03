import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = JSON.parse(readFileSync("docs/public-beta/walkthrough-receipt.schema.json", "utf8"));
const protocol = readFileSync("docs/public-beta/cohort-protocol.md", "utf8");
const triage = readFileSync("docs/public-beta/triage.md", "utf8");

describe("public beta cohort operating kit", () => {
  it("publishes a strict, versioned, privacy-minimal walkthrough receipt contract", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.required).toEqual(expect.arrayContaining(["receipt_version", "kind", "walkthrough_id", "product_version", "environment", "attempt_status", "milestones", "recovery", "issue_code"]));
    expect(schema.properties.receipt_version.const).toBe(1);
    expect(schema.properties.kind.const).toBe("lineage-logo.public-beta.walkthrough");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.environment.additionalProperties).toBe(false);
    expect(schema.properties.environment.properties.platform.enum).toEqual(["macos", "linux"]);
    expect(schema.properties.environment.properties.node_major.minimum).toBe(22);
    expect(schema.properties.environment.properties.browser.const).toBe("chromium");
    expect(schema.properties.milestones.required).toEqual(["fresh_install", "non_destructive_bootstrap", "proposal_comprehension", "review", "accept", "save", "clean_reopen"]);
    expect(schema.properties.issue_code.enum).toContain("safety_or_data_loss");
    expect(Object.keys(schema.properties)).not.toEqual(expect.arrayContaining([
      "name", "email", "credentials", "token", "private_path", "svg", "browser_session", "details",
    ]));
  });

  it("requires unaided published-registry walkthroughs and complete durable milestones", () => {
    expect(protocol).toContain("published, exact public-beta");
    expect(protocol).toContain("local tarballs");
    expect(protocol).toContain("must not coach");
    expect(protocol).toContain("Node.js 22 or newer, macOS or Linux, and Chromium");
    expect(protocol).toContain("non_destructive_bootstrap");
    expect(protocol).toContain("proposal_comprehension");
    expect(protocol).toContain("clean_reopen");
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
});
