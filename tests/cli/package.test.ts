import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

describe("public package contract", () => {
  it("publishes built runtime, public-beta instructions, and the canonical example", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
    expect(packageJson).not.toHaveProperty("private");
    expect(packageJson.bin).toEqual({ "lineage-logo": "dist/cli/bin.js" });
    expect(packageJson.engines).toEqual({ node: ">=22" });
    expect(packageJson.files).toEqual(["dist/**", "README.md", "examples/seatify-constellation.svg", "docs/public-beta/**"]);
    expect(JSON.stringify(packageJson)).not.toContain("file:..");
  });

  it("includes every linked public-beta document in npm pack contents", async () => {
    const { stdout } = await promisify(execFile)("npm", ["pack", "--dry-run", "--json"], { cwd: process.cwd() });
    const packed = JSON.parse(stdout.slice(stdout.indexOf("[\n"))) as Array<{ files: Array<{ path: string }> }>;
    expect(packed).toHaveLength(1);
    const paths = packed[0].files.map((file) => file.path);
    expect(paths).toEqual(expect.arrayContaining([
      "docs/public-beta/seatify-quickstart.md",
      "docs/public-beta/cohort-protocol.md",
      "docs/public-beta/walkthrough-receipt.schema.json",
      "docs/public-beta/walkthrough-receipt.example.json",
      "docs/public-beta/distinct-user-attestation.schema.json",
      "docs/public-beta/distinct-user-attestation.example.json",
      "docs/public-beta/invitation.md",
      "docs/public-beta/triage.md",
    ]));
  });
});
