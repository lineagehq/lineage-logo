import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("public registry release enforcement", () => {
  it("refuses mutable package selectors before attempting a registry install", () => {
    let output = "";
    let status = 0;
    try {
      execFileSync("npx", ["tsx", "scripts/registry-release-check.ts"], {
        cwd: process.cwd(),
        env: { ...process.env, REGISTRY_PACKAGE_VERSION: "beta" },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      status = failure.status ?? 1;
      output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
    }
    expect(status).toBe(1);
    expect(output).toContain("REGISTRY_PACKAGE_VERSION must be an exact semantic version");
  });
});
