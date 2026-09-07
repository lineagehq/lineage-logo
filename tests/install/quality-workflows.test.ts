import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parse } from "yaml";

const ci = parse(readFileSync(".github/workflows/ci.yml", "utf8"));
const extended = parse(readFileSync(".github/workflows/quality-gates.yml", "utf8"));
const runs = (job: { steps: Array<{ run?: string }> }): string[] => job.steps.flatMap(step => step.run ? [step.run] : []);

test("PR and main retain every existing job and newer LTS is explicit", () => {
  expect(Object.keys(ci.on).sort()).toEqual(["pull_request", "push"]);
  expect(ci.on.push.branches).toEqual(["main"]);
  expect(Object.keys(ci.jobs).sort()).toEqual(["browser-qa", "clean-install", "critical-browsers", "newer-lts", "verify"]);
  expect(ci.jobs["clean-install"].strategy.matrix.os).toEqual(["ubuntu-latest", "macos-latest"]);
  expect(ci.jobs["critical-browsers"].strategy.matrix.browser).toEqual(["firefox", "webkit"]);
  expect(ci.jobs["newer-lts"].steps.find((step: { uses?: string }) => step.uses?.startsWith("actions/setup-node")).with["node-version"]).toBe("24.20.0");
  expect(runs(ci.jobs.verify)).toContain("npm audit --omit=dev --audit-level=high");
  expect(runs(ci.jobs["clean-install"])).toContain("npx tsx scripts/release-check.ts --candidate-receipt");
  expect(runs(ci.jobs["browser-qa"])).toContain("npm run test:e2e -- --project=chromium");
});

test("extended corpus and measurements are dispatched and scheduled without publishing privileges", () => {
  expect(Object.keys(extended.on).sort()).toEqual(["schedule", "workflow_dispatch"]);
  expect(extended.on.schedule).toEqual([{ cron: "17 8 * * 1" }]);
  expect(extended.permissions).toEqual({ contents: "read" });
  expect(Object.keys(extended.jobs).sort()).toEqual(["full-corpus", "performance-measurement"]);
  expect(runs(extended.jobs["full-corpus"])).toContain("npm run test:e2e:corpus");
  expect(runs(extended.jobs["performance-measurement"])).toContain("npx tsx scripts/ux-performance-gate.ts --measure-only --output performance-measurement.json");
  for (const job of Object.values(extended.jobs) as Array<{ environment?: string; steps: Array<{ run?: string }> }>) {
    expect(job.environment).toBeUndefined();
    expect(runs(job).some(command => /npm publish|registry-release-check/.test(command))).toBe(false);
  }
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  expect(pkg.scripts["test:e2e:corpus"]).toBe("LINEAGE_LOGO_FULL_CORPUS=1 playwright test tests/e2e/release/svg-corpus.spec.ts --project=chromium");
});
