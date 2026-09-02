import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("public package contract", () => {
  it("publishes only built runtime, documentation, and the canonical example", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
    expect(packageJson).not.toHaveProperty("private");
    expect(packageJson.bin).toEqual({ "lineage-logo": "dist/cli/bin.js" });
    expect(packageJson.engines).toEqual({ node: ">=22" });
    expect(packageJson.files).toEqual(["dist/**", "README.md", "examples/seatify-constellation.svg"]);
    expect(JSON.stringify(packageJson)).not.toContain("file:..");
  });
});
