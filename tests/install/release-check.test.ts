import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isValidPackageVersion, parsePackResult, safeDiagnostic, validatePackedFiles } from "../../scripts/release-check";

describe("public release package enforcement", () => {
  it("accepts only the public package surface", () => {
    expect(() => validatePackedFiles([
      { path: "package.json" }, { path: "README.md" }, { path: "LICENSE" },
      { path: "examples/seatify-constellation.svg" }, { path: "dist/cli/bin.js" }, { path: "dist/client/index.html" },
    ])).not.toThrow();
    expect(() => validatePackedFiles([{ path: "package.json" }, { path: "dist/cli/bin.js" }, { path: "tests/private.test.ts" }])).toThrow();
  });

  it("accepts bounded semantic versions including prereleases", () => {
    expect(isValidPackageVersion("0.1.0-beta.1\n")).toBe(true);
    expect(isValidPackageVersion("0.1.0\n")).toBe(true);
    expect(isValidPackageVersion("version 0.1.0")).toBe(false);
    expect(isValidPackageVersion("0.1.0 && echo unsafe")).toBe(false);
  });

  it("bounds and redacts failure diagnostics", () => {
    const diagnostic = safeDiagnostic("Bearer abcdefghijklmnopqrstuvwxyz012345 /Users/person/private/workspace/file.svg <svg>secret</svg>");
    expect(diagnostic).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(diagnostic).not.toContain("/Users/person");
    expect(diagnostic).not.toContain("<svg");
    expect(diagnostic.length).toBeLessThanOrEqual(240);
  });

  it("extracts npm pack JSON after prepack build output", () => {
    expect(parsePackResult(`build output\n[{"filename":"lineage-logo.tgz","files":[]}]`)).toEqual([
      { filename: "lineage-logo.tgz", files: [] },
    ]);
  });

  it("keeps the Chromium CI job scoped to its installed browser", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(workflow).toContain("run: npm run test:e2e -- --project=chromium");
  });
});
