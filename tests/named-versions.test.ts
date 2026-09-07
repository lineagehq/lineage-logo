import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { saveNamedVersion } from "../src/server/named-versions";
import { versionFilename } from "../src/shared/version-name";
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
describe("named versions", () => {
  it.each(["", "../escape", "a/b", "a\\b", "CON", "nul", "COM1", "LPT9", " space", "tail ", "name.svg", "x".repeat(65)])("rejects invalid portable name %s", value => expect(() => versionFilename(value)).toThrow());
  it("atomically saves exactly one of concurrent same-name attempts, retaining original and leaving no temporary files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "logo-version-"));
    try {
      await mkdir(path.join(root, "concepts")); await writeFile(path.join(root, "concepts/source.svg"), svg);
      const results = await Promise.allSettled(Array.from({ length: 5 }, () => saveNamedVersion(root, "concepts/source.svg", "Final blue", svg)));
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(await readFile(path.join(root, "iterations/Final blue.svg"), "utf8")).toBe(svg);
      expect(await readFile(path.join(root, "concepts/source.svg"), "utf8")).toBe(svg);
      expect(await readdir(path.join(root, "iterations"))).toEqual(["Final blue.svg"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("leaves existing named content untouched when a different SVG collides", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "logo-version-"));
    try {
      await mkdir(path.join(root, "concepts")); await writeFile(path.join(root, "concepts/source.svg"), svg);
      await saveNamedVersion(root, "concepts/source.svg", "Final", svg);
      await expect(saveNamedVersion(root, "concepts/source.svg", "Final", svg.replace('width="10"', 'width="5"'))).rejects.toThrow(/already exists/);
      expect(await readFile(path.join(root, "iterations/Final.svg"), "utf8")).toBe(svg);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("refuses an iterations symlink without writing outside the workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "logo-version-")); const outside = await mkdtemp(path.join(tmpdir(), "logo-outside-"));
    try {
      await mkdir(path.join(root, "concepts")); await writeFile(path.join(root, "concepts/source.svg"), svg); await symlink(outside, path.join(root, "iterations"));
      await expect(saveNamedVersion(root, "concepts/source.svg", "Final", svg)).rejects.toThrow(/symbolic link/);
      expect(await readdir(outside)).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
  });
});
