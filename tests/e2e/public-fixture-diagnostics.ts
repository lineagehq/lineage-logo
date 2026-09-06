import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { validatedPublicFixtures } from '../../scripts/qa-fixtures';

export type WorkspaceReader = { get(url: string): Promise<{ok():boolean; json():Promise<unknown>; body():Promise<Buffer>}> };
/** Validate every server-visible file before any pixel capture. Unknown outputs fail closed. */
export async function assertPublicWorkspace(request: WorkspaceReader, origin: string): Promise<void> {
  if (origin !== 'http://marquee-qa.localhost:43118') throw new Error('Rich capture refused: unknown origin.');
  const fixtures = await validatedPublicFixtures(process.cwd());
  const allowed = new Map(fixtures.map(f => [`concepts/${f.destination}`,f.sha256]));
  allowed.set('concepts/complex-seatify.svg', fixtures.find(f => f.destination === 'ux-seatify-transformed.svg')!.sha256);
  allowed.set('concepts/seatify-constellation.svg', fixtures.find(f => f.destination === 'ux-seatify-44.svg')!.sha256);
  const response = await request.get('/api/workspace');
  if (!response.ok()) throw new Error('Rich capture refused: workspace unavailable.');
  const workspace = await response.json() as {files?:Array<{path:string}>};
  if (!Array.isArray(workspace.files) || workspace.files.length !== allowed.size || new Set(workspace.files.map(f => f.path)).size !== allowed.size) throw new Error('Rich capture refused: unknown workspace.');
  for (const file of workspace.files) {
    const expected = allowed.get(file.path);
    if (!expected) throw new Error('Rich capture refused: unknown fixture.');
    const content = await request.get(`/api/svg?path=${encodeURIComponent(file.path)}`);
    if (!content.ok() || createHash('sha256').update(await content.body()).digest('hex') !== expected) throw new Error('Rich capture refused: fixture integrity mismatch.');
  }
}
export async function capturePublicSurface(page: Page): Promise<void> {
  if (process.env.LINEAGE_LOGO_QA_DIAGNOSTICS !== 'public-fixtures') return;
  await assertPublicWorkspace(page.request, new URL(page.url()).origin);
  // Require the only open file and visible canvas to be a manifest-bound public fixture.
  const selected = await page.locator('.file-button[aria-current="true"]').getAttribute('data-path');
  if (selected !== 'concepts/ux-wide.svg') throw new Error('Rich capture refused: unknown active document.');
  await mkdir('test-results/public-fixtures',{recursive:true});
  const bytes = await page.screenshot({ fullPage:true, animations:'disabled' });
  await writeFile('test-results/public-fixtures/surface.png',bytes,{mode:0o600});
  await writeFile('test-results/public-fixtures/manifest.json',JSON.stringify({schemaVersion:1,source:'ux-wide.svg',sha256:createHash('sha256').update(bytes).digest('hex')})+'\n',{mode:0o600});
}
