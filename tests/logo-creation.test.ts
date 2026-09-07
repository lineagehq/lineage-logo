import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { createWorkspaceLogo } from "../src/server/logo-creation";
import { BLANK_LOGO_SVG, LOGO_IMPORT_MAX_BYTES, validateLogoImport } from "../src/shared/logo-creation";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function workspace() { const root = await mkdtemp(path.join(tmpdir(), "logo-create-")); roots.push(root); return root; }
it("creates an editable stable logo group in an empty workspace", async () => {
  const root = await workspace();
  expect(await createWorkspaceLogo(root, { name: "My logo" })).toEqual({ collection: "concepts", name: "My-logo.svg", path: "concepts/My-logo.svg" });
  expect(await readFile(path.join(root, "concepts/My-logo.svg"), "utf8")).toBe(BLANK_LOGO_SVG);
});
it("preserves exact safe import bytes and existing files under concurrent collisions", async () => {
  const root = await workspace(); await mkdir(path.join(root, "concepts"));
  const original = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>';
  await writeFile(path.join(root, "concepts/logo.svg"), original);
  const imported = '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="paint"><stop stop-color="red"/></linearGradient></defs><rect fill="url(#paint)" width="10" height="20"/></svg>\n';
  const entries = await Promise.all(Array.from({ length: 8 }, () => createWorkspaceLogo(root, { name: "logo.svg", svg: imported })));
  expect(new Set(entries.map(entry => entry.path)).size).toBe(8);
  expect(await readFile(path.join(root, "concepts/logo.svg"), "utf8")).toBe(original);
  for (const entry of entries) expect(await readFile(path.join(root, entry.path), "utf8")).toBe(imported);
  expect((await readdir(path.join(root, "concepts"))).length).toBe(9);
});
it("rejects linked collection folders and filename escapes without writing", async () => {
  const root = await workspace(), outside = await workspace();
  await symlink(outside, path.join(root, "concepts"));
  await expect(createWorkspaceLogo(root, { name: "logo" })).rejects.toThrow("real folder");
  expect(await readdir(outside)).toEqual([]);
  for (const name of ["../escape.svg", "a/b.svg", "a\\b.svg", "..", "bad\u0000name", "a".repeat(257)]) {
    await expect(createWorkspaceLogo(root, { name })).rejects.toThrow();
  }
});
it("rejects malformed, active, external and oversized SVG before any directory is created", async () => {
  const root = await workspace();
  const wrap = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
  for (const svg of ["", "<svg>", wrap("<g></svg>"), wrap('<script>alert(1)</script>'), wrap('<rect onload="x"/>'), wrap('<animate attributeName="href"/>'), wrap('<image href="https://example.com/a.svg"/>'), wrap('<style>@import "https://example.com/font";</style>'), wrap('<rect fill="url(data:image/svg+xml,x)"/>'), wrap('<foreignObject/>'), '<!DOCTYPE svg [<!ENTITY x "bad">]>' + wrap("&x;"), wrap(" ".repeat(LOGO_IMPORT_MAX_BYTES))]) {
    await expect(createWorkspaceLogo(root, { name: "logo", svg })).rejects.toThrow();
  }
  expect(await readdir(root)).toEqual([]);
  expect(() => validateLogoImport(BLANK_LOGO_SVG)).not.toThrow();
});
it("does not follow an existing destination symlink", async () => {
  const root = await workspace(), outside = await workspace(); await mkdir(path.join(root, "concepts"));
  await writeFile(path.join(outside, "keep.svg"), "keep");
  await symlink(path.join(outside, "keep.svg"), path.join(root, "concepts/logo.svg"));
  expect((await createWorkspaceLogo(root, { name: "logo" })).name).toBe("logo-2.svg");
  expect(await readFile(path.join(outside, "keep.svg"), "utf8")).toBe("keep");
});
