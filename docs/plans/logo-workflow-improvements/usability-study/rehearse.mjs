import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir, release, platform } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chromium, expect } from '@playwright/test';
import { SaxesParser } from 'saxes';
import { PNG } from 'pngjs';
const exec = promisify(execFile), dir = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(dir, '../../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const expectedPackage = process.env.STUDY_PACKAGE_SHA256 ?? '0adc32402cd59d2ca0b588707a21dfb16024325a7d57563bad452e4c25190361';
const output = process.argv[2];
if (!output) throw new Error('Supply a new local JSON receipt path.');
const root = await mkdtemp(path.join(tmpdir(), 'logo-study-rehearsal-'));
const children = [], milestones = [];
let browser;
const receipt = { schema_version: 1, kind: 'non-counting-maintainer-rehearsal', status: 'failed', package_version: '0.1.0-beta.4', package_sha256: expectedPackage, milestones, participant_results: 0, package_source: process.env.STUDY_TARBALL ? 'unpublished-local-candidate' : 'published-registry' };
function start(bin, args, env) {
  const child = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(child);
  let stdout = '', stderr = ''; child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
  child.on('error', () => {});
  return { child, stdout: () => stdout, stderr: () => stderr };
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM'); await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 3000))]);
  if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); }
}
function inspect(svg) {
  const parser = new SaxesParser({ xmlns: true }), result = {}, refs = [], stack = [];
  parser.on('opentag', tag => {
    const attrs = Object.fromEntries(Object.values(tag.attributes).map(a => [a.name, a.value]));
    assert(!Object.keys(attrs).some(name => name.startsWith('data-lineage-')));
    const entry = { tag: tag.local, attrs, text: '' }; stack.push(entry);
    if (attrs.id) { assert(!result[attrs.id]); result[attrs.id] = entry; }
    for (const value of Object.values(attrs)) for (const match of value.matchAll(/url\(#([^)]*)\)/g)) refs.push(match[1]);
    if (attrs.href?.startsWith('#')) refs.push(attrs.href.slice(1));
  });
  parser.on('text', value => { if (stack.length) stack.at(-1).text += value.trim(); });
  parser.on('closetag', () => stack.pop()); parser.write(svg).close();
  for (const id of refs) assert(result[id]);
  return result;
}
try {
  const consumer = path.join(root, 'consumer'), workspace = path.join(root, 'workspace');
  await mkdir(consumer); await mkdir(workspace);
  if (!process.env.STUDY_TARBALL) await exec('npm', ['pack', 'lineage-logo@0.1.0-beta.4', '--json', '--pack-destination', root], { cwd: consumer });
  const tarball = process.env.STUDY_TARBALL ?? path.join(root, 'lineage-logo-0.1.0-beta.4.tgz'); assert.equal(hash(await readFile(tarball)), expectedPackage);
  await writeFile(path.join(consumer, 'package.json'), '{"private":true}');
  await exec('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], { cwd: consumer });
  const bin = path.join(consumer, 'node_modules/.bin/lineage-logo');
  assert.equal((await exec(bin, ['--version'])).stdout.trim(), receipt.package_version);
  const env = { ...process.env, LINEAGE_LOGO_REGISTRY_DIR: path.join(root, 'registry') };
  browser = await chromium.launch(); const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  context.setDefaultTimeout(15000); const page = await context.newPage();
  const launch = async () => {
    const net = createServer(); net.listen(0, '127.0.0.1'); await once(net, 'listening'); const port = net.address().port; net.close(); await once(net, 'close');
    const url = `http://lineage-logo.localhost:${port}`, run = start(bin, ['launch', '--workspace', workspace, '--port', String(port), '--no-open'], env);
    await expect.poll(() => fetch(url).then(r => r.status).catch(() => 0), { timeout: 20000 }).toBe(200); await page.goto(url); return run;
  };
  let server = await launch();
  const fixture = await readFile(path.join(repo, 'tests/fixtures/ux-audit/seatify-44.svg'));
  assert.equal(hash(fixture), '0ce112d615c992b7e079527da731d98e55a3f176983172ebe25d9caaa21757f3');
  await page.getByRole('button', { name: 'Import SVG', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Import an SVG', exact: true });
  await dialog.getByLabel('SVG file (up to 5 MB)', { exact: true }).setInputFiles({ name: 'study-seatify.svg', mimeType: 'image/svg+xml', buffer: fixture });
  await dialog.getByRole('button', { name: 'Import SVG', exact: true }).click(); await expect(page.locator('#artboard #constellation-logo')).toHaveCount(1);
  const original = path.join(workspace, 'concepts/study-seatify.svg'); assert.equal(hash(await readFile(original)), hash(fixture)); milestones.push('create_import');
  let handoffCounter = 0;
  async function handoff(intent) {
    await page.getByRole('button', { name: 'Prepare agent handoff', exact: true }).click();
    const d = page.getByRole('dialog', { name: 'Prepare an agent handoff', exact: true });
    await d.getByRole('combobox', { name: 'Target', exact: true }).selectOption({ label: 'Whole document' });
    await d.getByLabel('What should change?', { exact: true }).fill(intent); await d.getByRole('button', { name: 'Prepare current handoff', exact: true }).click();
    const download = page.waitForEvent('download'); await d.getByRole('button', { name: 'Download handoff JSON', exact: true }).click();
    const file = path.join(root, `handoff-${++handoffCounter}.json`); await (await download).saveAs(file); await d.getByRole('button', { name: 'Cancel', exact: true }).click();
    const data = JSON.parse(await readFile(file, 'utf8')); if (handoffCounter === 1) receipt.initial_handoff_digest = data.snapshot.digest; return { file, data };
  }
  async function submit(stage, binding, accept) {
    const run = start(process.execPath, [path.join(dir, 'producer.mjs'), stage, binding.file, path.join(root, `proposal-${stage}.json`), bin], env);
    try { await expect(page.locator('#agent-accept')).toBeVisible({ timeout: 15000 }); } catch (error) { console.error(run.stdout(), run.stderr()); throw error; }
    if (accept) await page.locator('#agent-accept').click();
    else { await page.getByRole('textbox', { name: 'Revision request', exact: true }).fill('Make the gold diamond smaller, keeping everything else unchanged.'); await page.getByRole('button', { name: 'Reject and request revision', exact: true }).click(); }
    await expect.poll(() => run.child.exitCode, { timeout: 20000 }).not.toBeNull();
    const result = JSON.parse(run.stdout());
    if (accept) { assert.equal(run.child.exitCode, 0); const saved = await readFile(path.join(workspace, result.artifact.path), 'utf8'); assert.equal(hash(saved), result.artifact.digest); return { result, saved }; }
    assert.equal(result.revisionRequest, 'Make the gold diamond smaller, keeping everything else unchanged.'); await expect(page.locator('#agent-accept')).not.toBeVisible(); return result;
  }
  await submit('draft', await handoff('Add a gold diamond above the wordmark.'), false);
  await expect(page.locator('#artboard #study-diamond')).toHaveCount(0); assert.equal(hash(await readFile(original)), hash(fixture)); milestones.push('review_reject');
  const accepted = await submit('corrected', await handoff('Make the gold diamond smaller, keeping everything else unchanged.'), true);
  const acceptedMap = inspect(accepted.saved); assert.equal(acceptedMap['study-diamond'].attrs.points, '220,-118 238,-100 220,-82 202,-100'); milestones.push('review_accept');
  const names = ['North seat base', 'Northeast seat base', 'Southeast seat base'];
  await page.locator('.layer-button').filter({ has: page.locator('.layer-name', { hasText: /^Seatify constellation combination mark$/ }) }).click();
  await page.locator('#zoom-fit').click();
  for (const [index, name] of names.entries()) {
    const box = await page.locator(`#artboard [aria-label="${name}"]`).boundingBox(); assert(box);
    const pad = Math.min(box.width, box.height) * 0.08;
    await page.mouse.move(box.x - pad, box.y - pad); await page.keyboard.down('ControlLeft'); if (index) await page.keyboard.down('ShiftLeft');
    await page.mouse.down(); await page.mouse.move(box.x + box.width + pad, box.y + box.height + pad, { steps: 8 }); await page.mouse.up();
    if (index) await page.keyboard.up('ShiftLeft'); await page.keyboard.up('ControlLeft');
  }
  await expect(page.locator('.layer-button[aria-pressed="true"]')).toHaveCount(3);
  await page.locator('#fill').fill('#d14468'); await page.locator('#fill').press('Enter'); if (await page.locator('#alignment-group').getAttribute('open') === null) await page.locator('#alignment-group summary').click(); await page.locator('#align-left').click();
  const aligned = await handoff('Check current manual alignment.');
  const bases = ['seat-north-base', 'seat-northeast-base', 'seat-southeast-base'];
  const x = bases.map(id => aligned.data.snapshot.layers.find(layer => layer.svgId === id).bounds.x);
  assert(Math.max(...x) - Math.min(...x) <= 0.5); for (const id of bases) assert.equal(inspect(aligned.data.snapshot.svg)[id].attrs.fill, '#d14468'); milestones.push('select_recolor_align');
  await page.locator('.layer-button').filter({ has: page.locator('.layer-name', { hasText: /^Seatify tagline$/ }) }).click();
  if (await page.locator('#text-group').getAttribute('open') === null) await page.locator('#text-group summary').click();
  await page.locator('#text-content').fill('A better seat for everyone'); await page.locator('#text-content').press('Enter'); await expect(page.locator('#lifecycle-state')).toHaveAttribute('data-state', 'dirty'); milestones.push('edit_tagline');
  const before = await handoff('Change only Seat orbit fill to #e6f4ef, preserving manual changes.');
  const expected = inspect(before.data.snapshot.svg); assert.equal(expected['constellation-tagline'].text, 'A better seat for everyone');
  const manualExpected = structuredClone(acceptedMap);
  for (const id of bases) { manualExpected[id].attrs.fill = '#d14468'; if (expected[id].attrs.transform === undefined) delete manualExpected[id].attrs.transform; else manualExpected[id].attrs.transform = expected[id].attrs.transform; }
  manualExpected['constellation-tagline'].text = 'A better seat for everyone'; assert.deepEqual(expected, manualExpected);
  const final = await submit('followup', before, true); expected['seat-orbit'].attrs.fill = '#e6f4ef'; assert.deepEqual(inspect(final.saved), expected); milestones.push('preserving_followup');
  await expect(page.locator('.file-button[aria-current="true"]')).toHaveAttribute('data-path', final.result.artifact.path);
  await stop(server.child); server = await launch(); await page.locator(`.file-button[data-path="${final.result.artifact.path}"]`).click();
  const reopened = await handoff('Verify the reopened document.'); assert.deepEqual(inspect(reopened.data.snapshot.svg), inspect(final.saved)); assert.equal(hash(await readFile(original)), hash(fixture)); milestones.push('save_restart_reopen');
  const exports = {}, exportSvgs = [];
  await page.getByRole('button', { name: 'Save version / export', exact: true }).click(); dialog = page.getByRole('dialog', { name: 'Save a named version or export', exact: true });
  for (const [target, name] of [['constellation-mark', 'mark'], ['constellation-wordmark', 'wordmark']]) {
    await dialog.getByRole('combobox', { name: 'Artwork', exact: true }).selectOption(target); await dialog.getByRole('combobox', { name: 'Format', exact: true }).selectOption('svg');
    const download = page.waitForEvent('download'); await dialog.getByRole('button', { name: 'Download export', exact: true }).click();
    const file = path.join(root, `${name}.svg`); await (await download).saveAs(file); const svg = await readFile(file, 'utf8'), map = inspect(svg);
    assert(map[target]); assert(name === 'mark' ? !map['constellation-tagline'] : !map['seat-north-base']); exports[name] = hash(svg); exportSvgs.push(svg);
  }
  await dialog.getByRole('button', { name: 'Close', exact: true }).click(); assert.equal(hash(await readFile(path.join(workspace, final.result.artifact.path))), hash(final.saved)); milestones.push('export_mark_wordmark');
  // Independent render controls establish visible proposal differences at normal and small sizes.
  const viewer = await context.newPage();
  const variants = [fixture.toString(), await readFile(path.join(dir, 'assets/proposal.svg'), 'utf8'), await readFile(path.join(dir, 'assets/corrected-proposal.svg'), 'utf8')];
  for (const size of [64, 512]) {
    const pixels = [];
    await viewer.setViewportSize({ width: size, height: size });
    for (const svg of variants) { inspect(svg); await viewer.setContent(`<style>body{margin:0}svg{width:${size}px;height:${size}px}</style>${svg}`); pixels.push(PNG.sync.read(await viewer.screenshot()).data); }
    assert(!pixels[0].equals(pixels[1])); assert(!pixels[1].equals(pixels[2]));
  }
  for (const svg of exportSvgs) {
    await viewer.setContent(`<style>body{margin:0}svg{width:512px;height:512px}</style>${svg}`);
    const bytes = PNG.sync.read(await viewer.screenshot()).data;
    assert(Array.from(bytes).some((value, index) => index % 4 !== 3 && value < 240));
  }
  receipt.status = 'passed'; receipt.environment = { os: platform(), kernel: release(), node: process.version, browser: browser.version(), viewport: '1440x1000', zoom_percent: 100 };
  receipt.artifacts = { original_sha256: hash(fixture), accepted_sha256: hash(accepted.saved), final_saved_sha256: hash(final.saved), exports };
  receipt.scope = 'Programmatic maintainer rehearsal through installed public CLI and UI. Not human usability, unaided completion, state comprehension or assistive-technology evidence.';
} finally {
  for (const child of children) await stop(child);
  if (browser) await browser.close();
  await writeFile(output, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await rm(root, { recursive: true, force: true });
}
