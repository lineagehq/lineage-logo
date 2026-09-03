import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/publish-beta.yml";
const releaseGuidePath = "docs/public-beta/releasing.md";

function read(path: string) {
  return readFileSync(path, "utf8");
}

function job(workflow: string, name: string) {
  const match = workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z_]+:|(?![\\s\\S]))`, "m"));
  expect(match, `missing ${name} job`).not.toBeNull();
  return match![0];
}

function runCandidatePackParser(output: string) {
  const candidate = job(read(workflowPath), "candidate");
  const match = candidate.match(/TARBALL_NAME="\$\(node --input-type=module -e '([^']+)' "\$pack_json"\)"/);
  expect(match, "missing candidate npm-pack parser").not.toBeNull();
  return spawnSync(process.execPath, ["--input-type=module", "-e", match![1], output], { encoding: "utf8" });
}

function classifyVersionLookup(stdout: string, exitCode: number): { absent: true } | { absent: false; diagnostic: string } {
  if (exitCode === 0) return { absent: false, diagnostic: "npm registry lookup did not prove exact-version absence (success); failing closed" };
  try {
    const payload = JSON.parse(stdout) as { error?: { code?: unknown } };
    if (payload.error?.code === "E404") return { absent: true };
    const code = typeof payload.error?.code === "string" && /^[A-Z0-9_]+$/.test(payload.error.code)
      ? payload.error.code
      : "unknown";
    return { absent: false, diagnostic: `npm registry lookup did not prove exact-version absence (${code}); failing closed` };
  } catch {
    return { absent: false, diagnostic: "npm registry lookup did not prove exact-version absence (invalid-json); failing closed" };
  }
}

function assertDistTagInvariant(before: Record<string, string>, after: Record<string, string>, version: string): void {
  if (after.beta !== version) throw new Error("beta dist-tag did not point to the exact published version");
  for (const tag of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (tag !== "beta" && before[tag] !== after[tag]) {
      throw new Error(`Only the beta dist-tag may change; ${tag} changed unexpectedly`);
    }
  }
}

describe("manual beta trusted-publish workflow", () => {
  it("accepts only beta SemVer numeric identifiers without leading zeroes", () => {
    const preflight = job(read(workflowPath), "preflight");
    const pattern = preflight.match(/if \(!\/(\^.*\$)\/\.test\(version/);
    expect(pattern, "missing package_version beta SemVer validation").not.toBeNull();
    const betaVersion = new RegExp(pattern![1]);

    for (const version of ["0.0.0-beta.0", "1.2.3-beta.4", "10.20.30-beta.40"]) {
      expect(betaVersion.test(version), `${version} should be accepted`).toBe(true);
    }
    for (const version of [
      "00.1.0-beta.1",
      "0.01.0-beta.1",
      "0.1.00-beta.1",
      "0.1.0-beta.01",
      "0.1.0-beta.-1",
      "0.1.0-beta.1.0",
    ]) {
      expect(betaVersion.test(version), `${version} should be rejected`).toBe(false);
    }
  });

  it("classifies only structured E404 lookup failures as absence without echoing unsafe diagnostics", () => {
    expect(classifyVersionLookup(JSON.stringify({ error: { code: "E404", summary: "not found" } }), 1)).toEqual({ absent: true });
    for (const [stdout, exitCode] of [
      [JSON.stringify({ version: "0.1.0-beta.2" }), 0],
      [JSON.stringify({ error: { code: "E404" } }), 0],
      [JSON.stringify({ error: { code: "E401", summary: "Bearer secret-value" } }), 1],
      [JSON.stringify({ error: { code: "ETIMEDOUT", detail: "/Users/example/.npm/_logs/private" } }), 1],
      ["{not json", 1],
      ["", 1],
    ] as const) {
      const result = classifyVersionLookup(stdout, exitCode);
      expect(result.absent).toBe(false);
      if (!result.absent) {
        expect(result.diagnostic).not.toContain("/Users/");
        expect(result.diagnostic).not.toMatch(/secret|Bearer/i);
      }
    }
  });

  it("fails closed unless npm reports structured E404 for the exact requested specifier", () => {
    const preflight = job(read(workflowPath), "preflight");
    expect(preflight).toContain('npm view "lineage-logo@${PACKAGE_VERSION}" version --json');
    expect(preflight).toContain('payload.error?.code !== "E404"');
    expect(preflight).toContain('JSON.parse(readFileSync(process.argv[2], "utf8"))');
    expect(preflight).toContain("npm registry lookup did not prove exact-version absence");
    expect(preflight).toContain('>"$RUNNER_TEMP/version-lookup.json" 2>/dev/null');
    expect(preflight).not.toContain("version-lookup.err");
  });

  it("allows only the requested beta change in before/after dist-tag maps", () => {
    const before = { beta: "0.1.0-beta.2", latest: "0.1.0-beta.1", canary: "0.1.0-beta.1" };
    expect(() => assertDistTagInvariant(before, { ...before, beta: "0.1.0-beta.3" }, "0.1.0-beta.3")).not.toThrow();
    expect(() => assertDistTagInvariant(before, { ...before, beta: "0.1.0-beta.3", latest: "0.1.0-beta.3" }, "0.1.0-beta.3"))
      .toThrow("latest changed unexpectedly");
    expect(() => assertDistTagInvariant(before, { ...before, beta: "0.1.0-beta.3", next: "0.1.0-beta.3" }, "0.1.0-beta.3"))
      .toThrow("next changed unexpectedly");
    expect(() => assertDistTagInvariant(before, { beta: "0.1.0-beta.3", latest: "0.1.0-beta.1" }, "0.1.0-beta.3"))
      .toThrow("canary changed unexpectedly");
  });

  it("gives each job only the permission needed for its responsibility", () => {
    const workflow = read(workflowPath);
    const preflight = job(workflow, "preflight");
    const candidate = job(workflow, "candidate");
    const publish = job(workflow, "publish");
    const handoff = job(workflow, "registry_qa_handoff");
    for (const restricted of [preflight, candidate]) {
      expect(restricted).toMatch(/permissions:\n\s+contents: read/);
      expect(restricted).not.toMatch(/(?:actions|id-token): write/);
    }
    expect(publish).toMatch(/permissions:\n\s+contents: read\n\s+id-token: write/);
    expect(publish).not.toMatch(/actions: write/);
    expect(handoff).toMatch(/permissions:\n\s+actions: write\n\s+contents: read/);
    expect(handoff).not.toMatch(/id-token: write/);
  });

  it("checks the exact trusted-publisher identity and public package contract before publishing", () => {
    const workflow = read(workflowPath);
    expect(workflow).toContain('const expectedRepository = "git+https://github.com/lineagehq/lineage-logo.git";');
    expect(workflow).toContain('process.env.GITHUB_REPOSITORY !== "lineagehq/lineage-logo"');
    expect(workflow).toContain('process.env.GITHUB_WORKFLOW !== "Publish beta"');
    expect(workflow).toContain('process.env.GITHUB_WORKFLOW_REF !== "lineagehq/lineage-logo/.github/workflows/publish-beta.yml@refs/heads/main"');
    expect(workflow).toContain('pkg.repository?.type !== "git"');
    expect(workflow).toContain('pkg.repository?.url !== expectedRepository');
    expect(workflow).toContain('publishConfig?.access !== "public"');
    expect(workflow).toContain('pkg.publishConfig?.tag !== "beta"');
    expect(workflow).toContain('Object.prototype.hasOwnProperty.call(pkg.publishConfig ?? {}, "registry")');
  });

  it("tests and records one exact tarball, then publishes that verified file without repacking", () => {
    const workflow = read(workflowPath);
    const candidate = job(workflow, "candidate");
    const publish = job(workflow, "publish");
    expect(candidate).toContain("npm pack --json");
    expect(candidate).toContain("sha512sum");
    expect(candidate).toContain("npm install --ignore-scripts --no-audit --no-fund --package-lock=false \"$TARBALL_PATH\"");
    expect(candidate).toContain('"$CANDIDATE_ROOT/node_modules/.bin/lineage-logo" --version');
    expect(candidate).toContain("actions/upload-artifact@v7");
    expect(publish).toContain("actions/download-artifact@v7");
    expect(publish).toContain('test "$ACTUAL_SHA512" = "${{ needs.candidate.outputs.tarball_sha512 }}"');
    expect(publish).toContain('npm publish "$TARBALL_PATH" --tag beta --provenance');
    expect(publish).not.toMatch(/npm publish --tag beta/);
    const distTagSnapshot = publish.indexOf("Capture machine-readable dist-tags immediately before publication");
    const publishStep = publish.indexOf("Publish only the beta tag from the exact verified tarball");
    expect(distTagSnapshot).toBeGreaterThan(-1);
    expect(publishStep).toBeGreaterThan(distTagSnapshot);
    expect(publish).toMatch(
      /- name: Publish only the beta tag from the exact verified tarball[\s\S]*?run: \|\n\s+git fetch --no-tags origin main\n\s+test "\$GITHUB_SHA" = "\$\(git rev-parse origin\/main\)"\n\s+npm publish "\$TARBALL_PATH" --tag beta --provenance/,
    );
    expect(publish).not.toContain("- name: Recheck current main before publication");
  });

  it("parses one terminal npm-pack array after colored prepack output and fails closed otherwise", () => {
    const prefix = [
      "\u001b[36m> lineage-logo@0.1.0-beta.3 prepack\u001b[0m",
      "\u001b[36m> npm run build\u001b[0m",
      "\u001b[32m✓ built in 1.23s\u001b[0m",
    ].join("\n");
    const packed = JSON.stringify([{ filename: "lineage-logo-0.1.0-beta.3.tgz" }], null, 2);

    const valid = runCandidatePackParser(`${prefix}\n${packed}\n`);
    expect(valid.status).toBe(0);
    expect(valid.stdout).toBe("lineage-logo-0.1.0-beta.3.tgz");

    for (const output of [
      "",
      prefix,
      `${prefix}\n[{ malformed`,
      `${prefix}\n${JSON.stringify({ filename: "lineage-logo-0.1.0-beta.3.tgz" })}`,
      `${prefix}\n${packed}\n${packed}`,
    ]) {
      const invalid = runCandidatePackParser(output);
      expect(invalid.status, `unexpectedly accepted ${JSON.stringify(output)}`).not.toBe(0);
      expect(invalid.stdout).toBe("");
    }
  });

  it("retries postpublish verification and always attempts exact-version registry QA after a successful publish", () => {
    const workflow = read(workflowPath);
    const postpublish = job(workflow, "postpublish");
    const handoff = job(workflow, "registry_qa_handoff");
    expect(postpublish).toContain("for attempt in 1 2 3 4 5");
    expect(postpublish).toContain("sleep $((attempt * 5))");
    expect(workflow).toContain("dist_tags_before: ${{ steps.dist_tags_before.outputs.dist_tags_before }}");
    expect(postpublish).toContain("DIST_TAGS_BEFORE: ${{ needs.publish.outputs.dist_tags_before }}");
    expect(postpublish).toContain("Only the beta dist-tag may change");
    expect(handoff).toContain("always() && needs.publish.result == 'success'");
    expect(handoff).toContain(
      'gh workflow run registry-qa.yml --repo lineagehq/lineage-logo --ref main -f "package_version=${PACKAGE_VERSION}"',
    );
  });

  it("honestly documents the unproven owner configuration and exact trusted-publisher identity", () => {
    const guide = read(releaseGuidePath);
    expect(guide).toMatch(/lineagehq\/lineage-logo/);
    expect(guide).toMatch(/publish-beta\.yml/);
    expect(guide).toContain("workflow filename `publish-beta.yml`");
    expect(guide).toContain("npm-publish");
    expect(guide).toContain("environment `npm-publish`");
    expect(guide).toMatch(/trusted publisher/i);
    expect(guide).toMatch(/OIDC/);
    expect(guide).toMatch(/owner/i);
    expect(guide).toMatch(/not evidence[\s\S]*operational/i);
    expect(guide).toMatch(/public package/i);
    expect(guide).toMatch(/repository\.url/i);
    expect(guide).toMatch(/allowed action[^.]*`npm publish`/i);
    expect(guide).toMatch(/unproven/i);
    expect(guide).toMatch(/does not wait for or enforce registry-QA\s+success/i);
    expect(guide).toMatch(/Node\.js 22\.14\.0/i);
    expect(guide).toMatch(/npm 11\.5\.1/i);
  });
});
