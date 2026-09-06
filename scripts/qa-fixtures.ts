import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

/** Explicit public corpus. Rejection fixtures must never enter automatic screenshot runs. */
export const publicFixtureNames = [
  'seatify-44.svg', 'seatify-transformed.svg', 'wide.svg', 'tall.svg',
  'transparent-white.svg', 'transparent-dark.svg', 'authored-background.svg',
  'inherited-paint.svg', 'resources.svg', 'text-heavy.svg', 'unnamed.svg',
  'empty.svg', 'layers-100.svg', 'layers-500.svg', 'layers-1000.svg',
] as const;
export interface PublicFixture { source: string; destination: string; sha256: string }
export async function validatedPublicFixtures(root: string): Promise<PublicFixture[]> {
  const manifest = JSON.parse(await readFile(path.join(root, 'docs/plans/logo-workflow-improvements/evidence/baseline-fixtures.json'), 'utf8')) as { algorithm: string; fixtures: Array<{path:string;sha256:string}> };
  if (manifest.algorithm !== 'sha256') throw new Error('Invalid public fixture manifest.');
  return await Promise.all(publicFixtureNames.map(async name => {
    const relative = `tests/fixtures/ux-audit/${name}`;
    const matches = manifest.fixtures.filter(f => f.path === relative);
    if (matches.length !== 1 || !/^[a-f0-9]{64}$/.test(matches[0].sha256)) throw new Error('Invalid public fixture identity.');
    const source = path.join(root, relative);
    if (!(await lstat(source)).isFile() || (await lstat(source)).isSymbolicLink()) throw new Error('Invalid public fixture file.');
    if (createHash('sha256').update(await readFile(source)).digest('hex') !== matches[0].sha256) throw new Error('Public fixture integrity mismatch.');
    return { source, destination: `ux-${name}`, sha256: matches[0].sha256 };
  }));
}
