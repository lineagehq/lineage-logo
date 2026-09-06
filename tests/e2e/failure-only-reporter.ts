import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FullResult, Reporter } from '@playwright/test/reporter';

/** Keep only the bounded receipt and explicitly validated public capture after failures. */
export default class FailureOnlyReporter implements Reporter {
  #passed = false;
  onEnd(result: FullResult): void { this.#passed = result.status === 'passed'; }
  async onExit(): Promise<void> {
    const repositoryRoot = realpathSync(process.cwd());
    const outputDirectory = path.resolve(repositoryRoot, 'test-results');
    if (path.dirname(outputDirectory) !== repositoryRoot || path.basename(outputDirectory) !== 'test-results') throw new Error('Refusing unexpected Playwright output cleanup.');
    try { if (lstatSync(outputDirectory).isSymbolicLink()) throw new Error('Refusing symlinked Playwright output cleanup.'); }
    catch(error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    const retained = new Map<string,Buffer>();
    if (!this.#passed) {
      const receipt = path.join(outputDirectory,'release-diagnostics.json');
      if (lstatSync(receipt).isSymbolicLink()) throw new Error('Refusing symlinked diagnostics receipt.');
      retained.set('release-diagnostics.json',readFileSync(receipt));
      if (process.env.LINEAGE_LOGO_QA_DIAGNOSTICS === 'public-fixtures') {
        try {
          const directory = path.join(outputDirectory,'public-fixtures');
          if (lstatSync(directory).isSymbolicLink()) throw new Error('Invalid public artifact.');
          for (const name of ['surface.png','manifest.json']) if (lstatSync(path.join(directory,name)).isSymbolicLink()) throw new Error('Invalid public artifact.');
          const png = readFileSync(path.join(directory,'surface.png'));
          const metadata = readFileSync(path.join(directory,'manifest.json'));
          const manifest = JSON.parse(metadata.toString());
          if (manifest.schemaVersion !== 1 || manifest.source !== 'ux-wide.svg' || manifest.sha256 !== createHash('sha256').update(png).digest('hex')) throw new Error('Invalid public artifact.');
          retained.set('public-fixtures/surface.png',png);
          retained.set('public-fixtures/manifest.json',Buffer.from(JSON.stringify({schemaVersion:1,source:'ux-wide.svg',sha256:manifest.sha256})+'\n'));
        } catch { /* Missing or invalid rich evidence is discarded; sanitized receipt survives. */ }
      }
    }
    rmSync(outputDirectory,{recursive:true});
    for (const [name,bytes] of retained) { const output=path.join(outputDirectory,name);mkdirSync(path.dirname(output),{recursive:true});writeFileSync(output,bytes,{mode:0o600}); }
  }
}
