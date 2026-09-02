import { mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getNextIterationPath,
  continuationStem,
  listSvgFiles,
  readWorkspaceSvg,
  saveAgentContinuation,
  saveNextIteration,
  validateSvg,
} from "../src/server/workspace.js";

const fixtureRoot = path.resolve("tests/fixtures/workspace");

describe("logo workspace", () => {
  it("lists supported collections with natural ordering", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lineage-logo-"));
    await mkdir(path.join(root, "concepts"));
    await mkdir(path.join(root, "iterations"));
    await writeFile(path.join(root, "concepts", "concept-10.svg"), "<svg/>");
    await writeFile(path.join(root, "concepts", "concept-2.svg"), "<svg/>");
    await writeFile(path.join(root, "iterations", "iteration-1.svg"), "<svg/>");
    await writeFile(path.join(root, "iterations", "notes.txt"), "ignore");

    await expect(listSvgFiles(root)).resolves.toEqual([
      { collection: "concepts", name: "concept-2.svg", path: "concepts/concept-2.svg" },
      { collection: "concepts", name: "concept-10.svg", path: "concepts/concept-10.svg" },
      { collection: "iterations", name: "iteration-1.svg", path: "iterations/iteration-1.svg" },
    ]);
  });

  it("returns an approved SVG byte-for-byte", async () => {
    const expected = await readWorkspaceSvg(await realpath(fixtureRoot), "concepts/concept-1.svg");
    expect(expected).toContain('viewBox="0 0 512 512"');
    expect(expected).toContain('id="accent"');
    expect(expected).toContain('id="round-clip"');
    expect(expected).toContain('id="cutout"');
    expect(expected).toContain('id="soft-shadow"');
    expect(expected).toContain('id="icon"');
    expect(expected).toContain('transform="rotate(8 256 256)"');
  });

  it("rejects traversal and symlink escapes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lineage-logo-"));
    const outside = await mkdtemp(path.join(tmpdir(), "lineage-logo-outside-"));
    await mkdir(path.join(root, "concepts"));
    await writeFile(path.join(outside, "outside.svg"), "<svg/>");
    await symlink(path.join(outside, "outside.svg"), path.join(root, "concepts", "outside.svg"));

    await expect(readWorkspaceSvg(root, "../outside.svg")).rejects.toThrow();
    await expect(readWorkspaceSvg(root, "concepts/outside.svg")).rejects.toThrow("escapes");
  });

  it("rejects active and external SVG content", () => {
    expect(() => validateSvg('<svg onload="alert(1)"/>')).toThrow();
    expect(() => validateSvg("<svg><script/></svg>")).toThrow();
    expect(() => validateSvg('<svg><image href="https://example.com/a.png"/></svg>')).toThrow();
    expect(() => validateSvg('<svg><image href="file:///tmp/a.png"/></svg>')).toThrow();
    expect(() => validateSvg('<svg><path fill="url(https://example.com/a.svg#paint)"/></svg>')).toThrow();
    expect(() => validateSvg("<svg><foreignObject/></svg>")).toThrow();
    expect(() => validateSvg('<svg><path fill="url(#accent)"/></svg>')).not.toThrow();
  });

  it("saves complete, numbered iterations without overwriting the source", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lineage-logo-"));
    await mkdir(path.join(root, "concepts"));
    const source = '<svg viewBox="0 0 512 512"><path id="mark" fill="#fff"/></svg>';
    await writeFile(path.join(root, "concepts", "concept-1.svg"), source);
    const resolvedRoot = await realpath(root);

    await expect(getNextIterationPath(resolvedRoot)).resolves.toBe("iterations/iteration-1.svg");
    await expect(getNextIterationPath(resolvedRoot, "concepts/concept-1.svg")).resolves.toBe("iterations/concept-1-iteration-1.svg");
    const first = await saveNextIteration(
      resolvedRoot,
      "concepts/concept-1.svg",
      source.replace("#fff", "#00ff00"),
    );
    const second = await saveNextIteration(
      resolvedRoot,
      first.path,
      source.replace("#fff", "#ff00ff"),
    );

    expect(first.path).toBe("iterations/concept-1-iteration-1.svg");
    expect(second.path).toBe("iterations/concept-1-iteration-2.svg");
    expect(await readFile(path.join(root, "concepts", "concept-1.svg"), "utf8")).toBe(source);
    const saved = await readFile(path.join(root, first.path), "utf8");
    expect(saved).not.toContain('id="lineage-logo-edit"');
    expect(saved).toContain('fill="#00ff00"');
    await expect(getNextIterationPath(resolvedRoot)).resolves.toBe("iterations/iteration-1.svg");
    await expect(getNextIterationPath(resolvedRoot, second.path)).resolves.toBe("iterations/concept-1-iteration-3.svg");
  });

  it("allocates sanitized continuation ordinals per concept while preserving legacy flat reads", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lineage-logo-concepts-"));
    await mkdir(path.join(root, "concepts"));
    await mkdir(path.join(root, "iterations"));
    await writeFile(path.join(root, "concepts", "Seatify Final!.svg"), "<svg/>");
    await writeFile(path.join(root, "concepts", "Other.svg"), "<svg/>");
    await writeFile(path.join(root, "iterations", "iteration-8.svg"), "<svg></svg>");
    await writeFile(path.join(root, "iterations", "Seatify-Final-iteration-2.svg"), "<svg/>");
    await writeFile(path.join(root, "iterations", "Other-iteration-7.svg"), "<svg/>");
    const resolvedRoot = await realpath(root);

    expect(continuationStem("concepts/Seatify Final!.svg")).toBe("Seatify-Final");
    expect(continuationStem("iterations/Seatify-Final-iteration-2.svg")).toBe("Seatify-Final");
    expect(continuationStem("iterations/iteration-8.svg")).toBe("legacy-iteration-8");
    await expect(getNextIterationPath(resolvedRoot)).resolves.toBe("iterations/iteration-9.svg");
    await expect(getNextIterationPath(resolvedRoot, "concepts/Seatify Final!.svg")).resolves.toBe("iterations/Seatify-Final-iteration-3.svg");
    await expect(getNextIterationPath(resolvedRoot, "concepts/Other.svg")).resolves.toBe("iterations/Other-iteration-8.svg");
    await expect(readWorkspaceSvg(resolvedRoot, "iterations/iteration-8.svg")).resolves.toBe("<svg></svg>");
  });

  it("saves one transaction-bound continuation idempotently and rejects conflicting retry bytes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lineage-logo-agent-save-"));
    await mkdir(path.join(root, "concepts"));
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#111"/></svg>';
    await writeFile(path.join(root, "concepts", "seatify-logo.svg"), source);
    const binding = {
      instanceId: "22222222-2222-4222-8222-222222222222", transactionId: "save-once",
      sourcePath: "concepts/seatify-logo.svg", revision: 1,
      svg: source.replace("#111", "#fff"),
    };
    const first = await saveAgentContinuation(root, binding);
    const retry = await saveAgentContinuation(root, binding);
    expect(retry).toEqual(first);
    expect(first.path).toMatch(/^iterations\/seatify-logo-agent-[a-f0-9]{16}\.svg$/);
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile(path.join(root, binding.sourcePath), "utf8")).toBe(source);
    await expect(saveAgentContinuation(root, { ...binding, svg: source.replace("#111", "#f00") }))
      .rejects.toThrow("conflicts");
    const other = await saveAgentContinuation(root, { ...binding, transactionId: "save-other", svg: source.replace("#111", "#f00") });
    expect(other.path).not.toBe(first.path);
  });

  it("saves clean input exactly without injecting or replacing unrelated metadata", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lineage-logo-clean-"));
    await mkdir(path.join(root, "concepts"));
    const source = '<svg width="20" height="10"><metadata id="author">keep</metadata><path id="mark"/></svg>';
    await writeFile(path.join(root, "concepts", "concept-1.svg"), source);
    const resolvedRoot = await realpath(root);
    const saved = await saveNextIteration(resolvedRoot, "concepts/concept-1.svg", source);
    expect(await readFile(path.join(root, saved.path), "utf8")).toBe(source);
  });

  it("strips legacy reserved edit metadata while preserving unrelated metadata on save", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lineage-logo-legacy-"));
    await mkdir(path.join(root, "concepts"));
    const source = '<svg><metadata id="lineage-logo-edit">legacy</metadata><metadata id="author">keep</metadata><path/></svg>';
    await writeFile(path.join(root, "concepts", "concept-1.svg"), source);
    const resolvedRoot = await realpath(root);
    const saved = await saveNextIteration(resolvedRoot, "concepts/concept-1.svg", source);
    const output = await readFile(path.join(root, saved.path), "utf8");
    expect(output).not.toContain("lineage-logo-edit");
    expect(output).toContain('<metadata id="author">keep</metadata>');
  });

  it("refuses to save through an iterations-directory symlink", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lineage-logo-"));
    const outside = await mkdtemp(path.join(tmpdir(), "lineage-logo-outside-"));
    await mkdir(path.join(root, "concepts"));
    const source = "<svg></svg>";
    await writeFile(path.join(root, "concepts", "concept-1.svg"), source);
    await symlink(outside, path.join(root, "iterations"));
    const resolvedRoot = await realpath(root);

    await expect(
      saveNextIteration(resolvedRoot, "concepts/concept-1.svg", source),
    ).rejects.toThrow("escapes");
  });
});
