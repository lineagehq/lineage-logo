import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/publish-beta.yml";
const releaseGuidePath = "docs/public-beta/releasing.md";

function read(path: string) {
  return readFileSync(path, "utf8");
}

function snapshotCommands(workflow: string) {
  return [...workflow.matchAll(/(npm (?:dist-tag ls|view) lineage-logo(?: dist-tags)? --json) > "\$RUNNER_TEMP\/dist-tags-(?:before|after)\.json"/g)]
    .map((match) => match[1]);
}

describe("manual beta trusted-publish workflow", () => {
  it("is a protected, manual OIDC beta-only release guarded by current main and an exact new package version", () => {
    const workflow = read(workflowPath);

    expect(workflow).toMatch(/^on:\n  workflow_dispatch:/m);
    expect(workflow).toMatch(/package_version:[\s\S]*?required: true[\s\S]*?type: string/);
    expect(workflow).toMatch(/id-token: write/);
    expect(workflow).toMatch(/actions: write/);
    expect(workflow).toMatch(/environment:\n\s+name: npm-publish/);
    expect(workflow).toContain('git fetch --no-tags origin main');
    expect(workflow).toContain('git rev-parse origin/main');
    expect(workflow).toMatch(/PACKAGE_VERSION/);
    expect(workflow).toMatch(/package\.json/);
    expect(workflow).toMatch(/npm view "lineage-logo@\$\{PACKAGE_VERSION\}" version/);
    expect(workflow).toContain('npm publish --tag beta --provenance');
    expect(workflow).not.toMatch(/npm publish[^\n]*--tag latest/);
    expect(workflow).not.toMatch(/npm dist-tag\s+(add|rm)/);
  });

  it("runs the complete local release gates, proves the published version, and hands its exact version to registry QA", () => {
    const workflow = read(workflowPath);

    for (const command of [
      "npm ci",
      "npm run check",
      "npm audit --omit=dev --audit-level=high",
      "npx tsx scripts/release-check.ts",
      "npx playwright test --project=chromium",
      "--project=firefox-critical",
      "--project=webkit-critical",
    ]) {
      expect(workflow).toContain(command);
    }

    expect(workflow).toMatch(/npm view "lineage-logo@\$\{PACKAGE_VERSION\}" version[\s\S]*?PACKAGE_VERSION/);
    expect(workflow).toContain("npm view lineage-logo dist-tags --json");
    expect(workflow).toContain("Only the beta dist-tag may change");
    expect(workflow).toContain("gh workflow run registry-qa.yml");
    expect(workflow).toMatch(/package_version=\$\{PACKAGE_VERSION\}/);
  });

  it("uses a machine-readable registry dist-tag snapshot that the invariant parser can consume", () => {
    const commands = snapshotCommands(read(workflowPath));

    expect(commands).toHaveLength(2);
    for (const command of commands) {
      const output = execFileSync("npm", command.slice("npm ".length).split(" "), { encoding: "utf8" });
      expect(() => JSON.parse(output)).not.toThrow();
    }
  });

  it("pins and verifies the npm trusted-publishing runtime before the publish command without release caching", () => {
    const workflow = read(workflowPath);
    const runtimeSetup = workflow.indexOf("node-version: 22.14.0");
    const npmInstall = workflow.indexOf("npm install --global npm@11.5.1");
    const nodeAssertion = workflow.indexOf('test "$(node --version)" = "v22.14.0"');
    const npmAssertion = workflow.indexOf('test "$(npm --version)" = "11.5.1"');
    const publish = workflow.indexOf("npm publish --tag beta --provenance");

    expect(workflow).toContain("package-manager-cache: false");
    expect(runtimeSetup).toBeGreaterThan(-1);
    expect(npmInstall).toBeGreaterThan(runtimeSetup);
    expect(nodeAssertion).toBeGreaterThan(npmInstall);
    expect(npmAssertion).toBeGreaterThan(npmInstall);
    expect(publish).toBeGreaterThan(npmAssertion);
  });

  it("documents the owner-only configuration and the immutable post-publication QA boundary honestly", () => {
    const guide = read(releaseGuidePath);

    expect(guide).toContain("npm-publish");
    expect(guide).toMatch(/trusted publisher/i);
    expect(guide).toMatch(/OIDC/);
    expect(guide).toMatch(/owner/i);
    expect(guide).toMatch(/not evidence[\s\S]*operational/i);
    expect(guide).toContain("Public registry QA");
    expect(guide).toMatch(/exact.*version/i);
    expect(guide).toMatch(/latest/i);
    expect(guide).toMatch(/dist-tag/i);
    expect(guide).toMatch(/assigns[\s\S]*beta`? dist-tag/i);
    expect(guide).toMatch(/does not invoke a separate[\s\S]*dist-tag/i);
    expect(guide).toMatch(/does not wait for or enforce registry-QA success/i);
    expect(guide).toMatch(/Node\.js 22\.14\.0/i);
    expect(guide).toMatch(/npm 11\.5\.1/i);
  });
});
