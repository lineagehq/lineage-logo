import { expect, test } from '@playwright/test';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

test('saved continuation and unchanged original survive a complete local server restart', async ({ page }) => {
  test.setTimeout(120_000);
  // Exercise the built frontend through the real server, including browser restoration.
  await promisify(execFile)(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: process.cwd(), timeout: 60_000 });
  const workspace = await mkdtemp(path.join(tmpdir(), 'lineage-save-restart-'));
  await mkdir(path.join(workspace, 'concepts'));
  const source = path.join(workspace, 'concepts', 'logo.svg');
  await copyFile('examples/seatify-constellation.svg', source);
  const original = await readFile(source, 'utf8');
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  const origin = `http://save-restart.localhost:${port}`;
  let child: ChildProcess | undefined;
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const timer = setTimeout(() => child?.kill('SIGKILL'), 3_000);
    try { await exited; } finally { clearTimeout(timer); }
  }
  async function start() {
    child = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts', '--workspace', workspace, '--port', String(port)], {
      cwd: process.cwd(), stdio: 'ignore', env: {
        ...process.env, LINEAGE_LOGO_EDITOR_ORIGIN: origin, LINEAGE_LOGO_PUBLIC_EDITOR_ORIGIN: origin,
        LINEAGE_LOGO_REGISTRY_DIR: path.join(workspace, '.registry'),
      },
    });
    await expect.poll(async () => {
      if (child!.exitCode !== null) throw new Error('Restart fixture server exited before becoming ready.');
      try { return (await page.request.get(`${origin}/api/workspace`)).ok(); } catch { return false; }
    }).toBe(true);
  }
  try {
    await start();
    await page.goto(origin);
    await page.locator('[data-path="concepts/logo.svg"]').click();
    await expect(page.locator('#artboard svg')).toBeVisible();
    const board = await page.locator('#artboard').boundingBox();
    expect(board!.width / board!.height).toBeCloseTo(1024 / 640, 3);
    await page.locator('[data-background="dark"].background-button').click();
    await expect(page.locator('#artboard')).toHaveCSS('background-color', 'rgb(39, 39, 38)');
    await page.locator('.layer-button').filter({ hasText: /^textSeatify title$/ }).click();
    await page.locator('#layer-name').fill('Restart-safe title');
    await page.locator('#layer-name').press('Enter');
    const savedPath = (await page.locator('#save-iteration').getAttribute('title'))!.replace('Create ', '');
    await page.locator('#save-iteration').click();
    await expect(page.locator('#save-iteration')).toBeDisabled();
    await expect(page.locator('.file-button[aria-current="true"]')).toHaveAttribute('data-path', savedPath);
    const saved = await readFile(path.join(workspace, savedPath), 'utf8');
    expect(saved).toContain('aria-label="Restart-safe title"');
    expect(await readFile(source, 'utf8')).toBe(original);
    await expect(page.locator('#layer-name')).toHaveValue('Restart-safe title');
    await page.locator('#layer-name').fill('Later correction');
    await page.locator('#layer-name').press('Enter');
    await page.locator('#undo').click();
    await expect(page.locator('#layer-name')).toHaveValue('Restart-safe title');
    await expect(page.locator('#save-iteration')).toBeDisabled();
    await page.locator('#undo').click();
    await expect(page.locator('#layer-name')).toHaveValue('Seatify title');
    await expect(page.locator('#save-iteration')).toBeEnabled();
    await page.locator('#redo').click();
    await expect(page.locator('#save-iteration')).toBeDisabled();
    await page.locator('#redo').click();
    await expect(page.locator('#layer-name')).toHaveValue('Later correction');
    await expect(page.locator('#save-iteration')).toBeEnabled();
    await page.locator('#undo').click();
    await expect(page.locator('#save-iteration')).toBeDisabled();
    await expect(page.locator('#lifecycle-state')).toHaveAttribute('data-state', 'saved');
    expect(await readFile(path.join(workspace, savedPath), 'utf8')).toBe(saved);
    const firstPid = child!.pid;
    await stop();
    await start();
    expect(child!.pid).not.toBe(firstPid);
    await page.reload();
    await expect(page.locator('.file-button[aria-current="true"]')).toHaveAttribute('data-path', savedPath);
    await expect(page.locator('#artboard [aria-label="Restart-safe title"]')).toHaveCount(1);
    await expect(page.locator('#save-iteration')).toBeDisabled();
    expect(await readFile(path.join(workspace, savedPath), 'utf8')).toBe(saved);
    expect(await readFile(source, 'utf8')).toBe(original);
  } finally {
    await page.goto('about:blank');
    await stop();
    await rm(workspace, { recursive: true, force: true });
  }
});
