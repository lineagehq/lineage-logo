/** Public-fixture baseline. Run: npx tsx scripts/ux-performance-baseline.ts
 * Uses the same Vite + API + Chromium mechanism as repository E2E on isolated ports.
 * No performance assertions: the receipt is evidence, never a fabricated gate pass.
 */
import { chromium } from '@playwright/test';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir, platform, release, cpus, totalmem } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
const root = process.cwd();
const port = (name: string, fallback: number) => {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error('Invalid performance port.');
  return value;
};
const apiPort = port('LINEAGE_LOGO_PERFORMANCE_API_PORT', 43217);
const clientPort = port('LINEAGE_LOGO_PERFORMANCE_CLIENT_PORT', 43218);
if (apiPort === clientPort) throw new Error('Performance ports must differ.');
const origin = `http://lineage-performance.localhost:${clientPort}`;
let workspace: string | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let browserLaunch: ReturnType<typeof chromium.launch> | undefined;
const children: ChildProcess[] = [];
const exited = new Map<ChildProcess, Promise<void>>();
let childFailure = false;
let stopping = false;
const abort = new AbortController();
let finishSetup!: () => void;
const setupDone = new Promise<void>(resolve => { finishSetup = resolve; });
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const assertRunning = () => { if (stopping || childFailure) throw new Error('Performance run stopped or an owned service exited.'); };
function signalChild(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) return;
  try { if (process.platform !== 'win32') process.kill(-child.pid, signal); else child.kill(signal); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
}
let cleaning: Promise<void> | undefined;
function cleanup(): Promise<void> {
  return cleaning ??= (async () => {
    stopping = true; abort.abort();
    await setupDone;
    for (const child of children) signalChild(child, 'SIGTERM');
    const allExited = Promise.all([...exited.values()]);
    const graceful = await Promise.race([allExited.then(() => true), delay(2000).then(() => false)]);
    // Kill process groups even if their leader exited: descendants may still hold ports.
    for (const child of children) signalChild(child, 'SIGKILL');
    if (!graceful && !await Promise.race([allExited.then(() => true), delay(2000).then(() => false)])) throw new Error('Performance child teardown timed out.');
    if (browserLaunch) {
      const closing = browserLaunch.then(opened => opened.close()).catch(() => {});
      await Promise.race([closing, delay(3000)]);
    }
    if (workspace) await rm(workspace, { recursive: true, force: true });
  })();
}
const cancel = (signal: NodeJS.Signals) => {
  stopping = true; abort.abort();
  void cleanup().then(() => process.exit(signal === 'SIGINT' ? 130 : 143), () => process.exit(1));
};
process.once('SIGINT', cancel);
process.once('SIGTERM', cancel);
async function checkPortAvailable(candidate: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error('Performance port is already occupied.')));
    probe.listen(candidate, '127.0.0.1', () => probe.close(error => error ? reject(error) : resolve()));
  });
}
function start(command: string, args: string[], env: NodeJS.ProcessEnv) {
  assertRunning();
  const child = spawn(command, args, { cwd: root, env, stdio: 'ignore', detached: process.platform !== 'win32' });
  children.push(child);
  exited.set(child, new Promise<void>(resolve => {
    child.once('error', () => { childFailure = true; resolve(); });
    child.once('exit', () => { childFailure = true; resolve(); });
  }));
}
const summarize = (samples: number[]) => { const s = [...samples].sort((a,b) => a-b); return { samplesMs: samples, count: s.length, medianMs: s[Math.floor(s.length / 2)], p95Ms: s[Math.ceil(s.length * .95)-1], minMs: s[0], maxMs: s.at(-1) }; };
try {
  try {
    await Promise.all([checkPortAvailable(apiPort), checkPortAvailable(clientPort)]);
    assertRunning();
    workspace = await mkdtemp(path.join(tmpdir(), 'lineage-ux-performance-'));
    assertRunning();
    await mkdir(path.join(workspace, 'concepts'));
    for (const n of [100, 500, 1000]) { assertRunning(); await cp(path.join(root, `tests/fixtures/ux-audit/layers-${n}.svg`), path.join(workspace, `concepts/layers-${n}.svg`)); }
    const env = { ...process.env, LINEAGE_LOGO_PORT: String(apiPort), LINEAGE_LOGO_CLIENT_PORT: String(clientPort), LINEAGE_LOGO_EDITOR_ORIGIN: `http://127.0.0.1:${clientPort}`, LINEAGE_LOGO_PUBLIC_EDITOR_ORIGIN: origin, LINEAGE_LOGO_REGISTRY_DIR: path.join(workspace, '.registry') };
    start(path.join(root, 'node_modules/.bin/vite'), ['--host', '127.0.0.1', '--port', String(clientPort), '--strictPort'], env);
    start(path.join(root, 'node_modules/.bin/tsx'), ['src/server/index.ts', '--workspace', workspace, '--port', String(apiPort)], env);
  } finally { finishSetup(); }
  for (let i = 0; ; i++) {
    assertRunning();
    if (i === 100) throw new Error('Isolated performance server failed to become ready');
    try {
      const response = await fetch(`http://127.0.0.1:${clientPort}/api/workspace`, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(500)]) });
      if (response.ok) {
        const state = await response.json() as { rootName?: string };
        assertRunning();
        if (state.rootName !== path.basename(workspace!)) throw new Error('Performance workspace identity mismatch.');
        break;
      }
    } catch (error) { assertRunning(); if (error instanceof Error && error.message === 'Performance workspace identity mismatch.') throw error; }
    await delay(200);
  }
  assertRunning();
  if (process.argv.includes('--lifecycle-probe')) {
    // Explicit test-only mode exercises real service ownership without benchmarking.
    console.log(JSON.stringify({ ready: true, workspace, pids: children.map(child => child.pid), apiPort, clientPort }));
    await new Promise<void>(resolve => abort.signal.addEventListener('abort', () => resolve(), {once:true}));
    assertRunning();
  }
  browserLaunch = chromium.launch();
  browser = await browserLaunch;
  assertRunning();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  // tsx preserves nested function names through this helper when serializing callbacks.
  await page.addInitScript('globalThis.__name = (target) => target');
  const results: Record<string, unknown> = {};
  for (const n of [100, 500, 1000]) {
    const open: number[] = [], selection: number[] = [], filter: number[] = [], preview: number[] = [];
    // Separate full-page startup from warmed document opens; each open starts on an empty editor.
    const startupStart = performance.now();
    await page.goto(origin);
    await page.locator(`[data-path="concepts/layers-${n}.svg"]`).waitFor();
    const startupMs = performance.now()-startupStart;
    for (let i = 0; i < 32; i++) {
      if (i) { await page.reload(); await page.locator(`[data-path="concepts/layers-${n}.svg"]`).waitFor(); }
      const elapsed = await page.evaluate(async (count) => {
        const start = performance.now();
        (document.querySelector(`[data-path="concepts/layers-${count}.svg"]`) as HTMLButtonElement).click();
        while (document.querySelectorAll('#artboard svg rect').length !== count || (document.querySelector('#layer-search') as HTMLInputElement).disabled) await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
        return performance.now()-start;
      }, n);
      if (i >= 2) open.push(elapsed);
    }
    for (let i = 0; i < 32; i++) {
      await page.locator('#layer-search').fill('');
      const elapsed = await page.evaluate(async (index) => {
        const start = performance.now();
        const button = Array.from(document.querySelectorAll<HTMLButtonElement>('.layer-button')).find(b => b.textContent?.includes(`Layer ${String(index%2).padStart(4,'0')}`));
        if (!button) throw new Error('Layer button missing'); button.click();
        if ((document.querySelector('#layer-name') as HTMLInputElement).value !== `Layer ${String(index%2).padStart(4,'0')}`) throw new Error('Selection inspector mismatch');
        await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
        return performance.now()-start;
      }, i);
      if (i >= 2) selection.push(elapsed);
      await page.locator('#layer-search').fill(i%2 ? 'Layer 0000' : '');
      const filtering = await page.evaluate(async (index) => {
        const input = document.querySelector<HTMLInputElement>('#layer-search')!;
        const start = performance.now(); input.value = index%2 ? '' : 'Layer 0000'; input.dispatchEvent(new Event('input',{bubbles:true}));
        await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
        if (index%2 === 0 && document.querySelectorAll('.layer-button').length !== 1) throw new Error('Filtering failed');
        return performance.now()-start;
      }, i);
      if (i >= 2) filter.push(filtering);
    }
    await page.locator('#layer-search').fill('');
    await page.locator('.layer-button').filter({ hasText: 'Layer 0000' }).click();
    for (let i = 0; i < 32; i++) {
      const elapsed = await page.evaluate(async (index) => {
        const input = document.querySelector<HTMLInputElement>('#fill')!;
        const before = document.querySelector('#favicon-preview')!.innerHTML;
        const start = performance.now(); input.value = index%2 ? '#ff7700' : '#2244ff'; input.dispatchEvent(new Event('input',{bubbles:true}));
        if (document.querySelector('#favicon-preview')!.innerHTML === before) throw new Error('Preview did not update');
        await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
        return performance.now()-start;
      }, i);
      if (i >= 2) preview.push(elapsed);
    }
    const drags: number[][] = [];
    for (let run = 0; run < 5; run++) {
      await page.evaluate(() => {
        const w = window as unknown as { uxFrames: number[]; uxFrameActive: boolean };
        w.uxFrames=[]; w.uxFrameActive=true;
        let last=performance.now(); const tick=(now:number) => { w.uxFrames.push(now-last);last=now;if(w.uxFrameActive)requestAnimationFrame(tick);}; requestAnimationFrame(tick);
      });
      const mark = page.locator('#artboard #layer-0000');
      const before = await mark.getAttribute('transform');
      const box = await mark.boundingBox(); if (!box) throw new Error('No draggable mark');
      await page.mouse.move(box.x+box.width/2, box.y+box.height/2);
      await mark.evaluate((node, box) => node.dispatchEvent(new MouseEvent('mousedown', {bubbles:true,cancelable:true,buttons:1,button:0,clientX:box.x+box.width/2,clientY:box.y+box.height/2})), box);
      for (let step = 1; step <= 30; step++) { await page.mouse.move(box.x+box.width/2+step,box.y+box.height/2+step); await page.evaluate(() => new Promise(requestAnimationFrame)); }
      await page.evaluate((box) => window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true,buttons:0,button:0,clientX:box.x+box.width/2+30,clientY:box.y+box.height/2+30})), box);
      if (await mark.getAttribute('transform') === before) throw new Error('Drag did not move selected mark');
      drags.push(await page.evaluate(() => { const w=window as unknown as {uxFrameActive:boolean;uxFrames:number[]};w.uxFrameActive=false;return w.uxFrames.slice(1); }));
    }
    results[String(n)] = { startupMs, open: summarize(open), selection: summarize(selection), filtering: summarize(filter), preview: summarize(preview), dragFrames: summarize(drags.flat()), dragRuns: drags };
    console.log(`Measured ${n} layers`);
  }
  const receipt = {
    schemaVersion: 1, measuredAt: new Date().toISOString(), commit: execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    environment: { platform: platform(), release: release(), cpu: cpus()[0]?.model, cpuCount: cpus().length, memoryBytes: totalmem(), node: process.version, browser: browser.version(), playwright: JSON.parse(await readFile('node_modules/@playwright/test/package.json','utf8')).version, viewport: {width:1440,height:1000}, reducedMotion:'reduce', headless:true, server:'Vite development server + repository API', origin },
    method: { warmups:2, repetitions:30, dragRuns:5, startup:'Navigation to workspace file locator ready; includes driver round trips.', discrete:'Browser performance.now immediately before DOM user-action event to two requestAnimationFrame callbacks after observable DOM update. Includes rendering opportunities, not a pixel paint or image decode guarantee. No driver time in discrete samples.', open:'Fresh empty page; file button click to exact rect count and enabled layer-search plus two animation frames. Startup separately recorded.', filtering:'Alternates exact single-row search and clearing search.', drag:'rAF intervals across 30 real pointer moves per drag (mousedown dispatched directly to SVG target, matching existing E2E gesture harness), one animation frame awaited per move; initial partial interval omitted. Driver-paced, not unthrottled input throughput.', limits:['Development-build baseline; production performance must be separately measured.','Headless Chromium only.','Host was not CPU-isolated; retain all outliers and remeasure on same idle host before regression judgment.','No heap trend claim; 20-cycle heap measurement remains D3 work.'] }, results,
  };
  await writeFile('docs/plans/logo-workflow-improvements/evidence/performance-baseline.json',JSON.stringify(receipt,null,2)+'\n');
} finally {
  await cleanup();
  process.removeListener('SIGINT', cancel);
  process.removeListener('SIGTERM', cancel);
}
