import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test, expect, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { SaxesParser } from 'saxes';
const exec = promisify(execFile);
const resourceSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 160"><defs><linearGradient id="paint"><stop stop-color="#246bfd"/><stop offset="1" stop-color="#44ccaa"/></linearGradient><mask id="cut"><rect width="320" height="160" fill="white"/></mask><path id="star" d="M0 0L12 0L6 10Z"/></defs><g id="mark" aria-label="Brand mark" transform="translate(20 20)" mask="url(#cut)"><rect width="80" height="60" fill="url(#paint)"/><use href="#star" x="20" y="20" fill="white"/></g><g id="wordmark" aria-label="Brand wordmark"><text id="words" aria-label="Brand words" x="110" y="90" font-family="sans-serif" font-size="24">Original brand</text></g></svg>';
function validate(svg: string) {
  const parser = new SaxesParser({ xmlns: true }); const ids = new Set<string>(), refs: string[] = [];
  parser.on('opentag', tag => { for (const attribute of Object.values(tag.attributes)) {
    if (attribute.local === 'id') { expect(ids.has(attribute.value)).toBe(false); ids.add(attribute.value); }
    for (const match of attribute.value.matchAll(/url\(#([^)]*)\)/g)) refs.push(match[1]);
    if (attribute.local === 'href' && attribute.value.startsWith('#')) refs.push(attribute.value.slice(1));
  }}); parser.write(svg).close(); refs.forEach(ref => expect(ids.has(ref)).toBe(true));
}
async function stop(child: ChildProcess) { if (child.exitCode !== null || child.signalCode !== null) return; child.kill('SIGTERM'); await Promise.race([once(child,'exit'),new Promise(resolve=>setTimeout(resolve,3000))]); if(child.exitCode===null&&child.signalCode===null) child.kill('SIGKILL'); }
async function freePort() { const server=createServer(); server.listen(0,'127.0.0.1'); await once(server,'listening'); const port=(server.address() as {port:number}).port; server.close(); await once(server,'close'); return port; }
async function download(page: Page, file: string) { const wait=page.waitForEvent('download'); await page.getByRole('button',{name:'Download export',exact:true}).click(); await (await wait).saveAs(file); return readFile(file); }

test('installed named versions preserve history and exported SVG/PNG artifacts retain resources, bounds and alpha', async ({browser}) => {
  test.setTimeout(150000);
  const root=await mkdtemp(path.join(tmpdir(),'lineage-export-installed-')), workspace=path.join(root,'workspace'), consumer=path.join(root,'consumer'), pack=path.join(root,'pack');
  const children:ChildProcess[]=[]; const context=await browser.newContext({acceptDownloads:true}); context.setDefaultTimeout(15000);
  try {
    await Promise.all([path.join(workspace,'concepts'),consumer,pack].map(dir=>mkdir(dir,{recursive:true})));
    await writeFile(path.join(workspace,'concepts/resources.svg'),resourceSvg);
    for(const [name,width,height] of [['wide',400,100],['tall',100,400]] as const) await writeFile(path.join(workspace,`concepts/${name}.svg`),`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><rect id="white-mark" aria-label="White mark" width="${width}" height="${height}" fill="white"/></svg>`);
    await writeFile(path.join(workspace,'concepts/missing-font.svg'),'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="10" y="50" font-family="LineageMissingFont987654">Text</text></svg>');
    await exec('npm',['pack','--json','--pack-destination',pack],{maxBuffer:10*1024*1024});
    await writeFile(path.join(consumer,'package.json'),'{"private":true}');
    await exec('npm',['install','--ignore-scripts','--no-audit','--no-fund',path.join(pack,(await readdir(pack)).find(name=>name.endsWith('.tgz'))!)],{cwd:consumer});
    const bin=path.join(consumer,'node_modules/.bin/lineage-logo');
    const launch=async()=>{ const port=await freePort(),url=`http://lineage-logo.localhost:${port}`; const child=spawn(bin,['launch','--workspace',workspace,'--port',String(port),'--no-open'],{env:{...process.env,LINEAGE_LOGO_REGISTRY_DIR:path.join(root,'registry')},stdio:'ignore'});children.push(child);await expect.poll(async()=>fetch(url).then(r=>r.status).catch(()=>0),{timeout:20000}).toBe(200);return {url,child}; };
    const first=await launch(),page=await context.newPage();await page.goto(first.url);
    await page.getByRole('button',{name:'Save version / export',exact:true}).click();await expect(page.getByRole('dialog',{name:'Export unavailable'})).toBeVisible();await page.getByRole('button',{name:'Close',exact:true}).click();
    await page.locator('[data-path="concepts/resources.svg"]').click();
    await page.locator('.layer-button').filter({hasText:'Brand words'}).click();
    if(await page.locator('#text-group').getAttribute('open')===null)await page.locator('#text-group summary').click();
    await page.locator('#text-content').fill('Approved brand');await page.locator('#text-content').press('Enter');
    const selection=await page.locator('.layer-button[aria-pressed="true"]').textContent();
    await page.getByRole('button',{name:'Save version / export',exact:true}).click();
    let dialog=page.getByRole('dialog',{name:'Save a named version or export'});
    await dialog.getByRole('textbox',{name:'Version name',exact:true}).fill('Approved logo');await dialog.getByRole('button',{name:'Save named version',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('Named version saved:');
    const named=(await readdir(path.join(workspace,'iterations')))[0], namedBytes=await readFile(path.join(workspace,'iterations',named),'utf8');expect(namedBytes).toContain('Approved brand');validate(namedBytes);
    await dialog.getByRole('button',{name:'Save named version',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('already exists');
    await dialog.getByRole('textbox',{name:'Version name',exact:true}).fill('../escape');await dialog.getByRole('button',{name:'Save named version',exact:true}).click();await expect(dialog.getByRole('status')).not.toContainText('Preparing');expect(await readdir(path.join(workspace,'iterations'))).toEqual([named]);
    for(const [target,suffix] of [['','full'],['mark','mark'],['wordmark','wordmark']]) {
      await dialog.getByRole('combobox',{name:'Artwork',exact:true}).selectOption(target);
      const svg=(await download(page,path.join(root,`${suffix}.svg`))).toString();validate(svg);expect(svg).not.toContain('data-lineage-');
      if(target==='mark'){expect(svg).toContain('id="paint"');expect(svg).toContain('id="cut"');expect(svg).toContain('id="star"');expect(svg).not.toContain('Approved brand');}
      if(target==='wordmark'){expect(svg).toContain('Approved brand');expect(svg).not.toContain('id="mark"');}
    }
    await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(page.getByRole('button',{name:'Save version / export',exact:true})).toBeFocused();
    await expect(page.locator('.file-button[aria-current="true"]')).toHaveAttribute('data-path','concepts/resources.svg');await expect(page.locator('#lifecycle-state')).toHaveAttribute('data-state','dirty');expect(await page.locator('.layer-button[aria-pressed="true"]').textContent()).toBe(selection);
    await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('#artboard #words')).toHaveText('Original brand');await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.locator('#artboard #words')).toHaveText('Approved brand');
    expect(await readFile(path.join(workspace,'concepts/resources.svg'),'utf8')).toBe(resourceSvg);expect(await readFile(path.join(workspace,'iterations',named),'utf8')).toBe(namedBytes);
    await page.close();await stop(first.child);const restarted=await launch();const reopened=await context.newPage();await reopened.goto(restarted.url);await reopened.locator(`[data-path="iterations/${named}"]`).click();await expect(reopened.locator('#artboard #words')).toHaveText('Approved brand');
    await reopened.setViewportSize({width:760,height:720});
    await expect(reopened.locator('#toggle-left-sidebar')).toHaveAttribute('aria-expanded','false');
    for(const shape of ['wide','tall']) {
      if(await reopened.locator('#toggle-left-sidebar').getAttribute('aria-expanded')==='false')await reopened.locator('#toggle-left-sidebar').click();
      await reopened.locator(`[data-path="concepts/${shape}.svg"]`).click();await reopened.getByRole('button',{name:'Save version / export',exact:true}).click();dialog=reopened.getByRole('dialog',{name:'Save a named version or export'});
      await dialog.getByRole('combobox',{name:'Format',exact:true}).selectOption('png');
      for(const size of [16,32,64])for(const background of ['transparent','white','black']) {
        await dialog.getByRole('combobox',{name:'PNG size',exact:false}).selectOption(String(size));await dialog.getByRole('combobox',{name:'PNG background',exact:true}).selectOption(background);
        const png=PNG.sync.read(await download(reopened,path.join(root,`${shape}-${size}-${background}.png`)));expect([png.width,png.height]).toEqual([size,size]);
        const pixel=(x:number,y:number)=>Array.from(png.data.subarray((y*size+x)*4,(y*size+x)*4+4));
        expect(pixel(size/2,size/2)).toEqual([255,255,255,255]);expect(pixel(0,0)).toEqual(background==='transparent'?[0,0,0,0]:background==='white'?[255,255,255,255]:[0,0,0,255]);
        if(background==='transparent'){const opaque=Array.from({length:size*size},(_,i)=>png.data[i*4+3]).filter(a=>a===255).length;expect(opaque).toBe(size*size/4);}
      }
      await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(reopened.locator('#lifecycle-state')).not.toHaveAttribute('data-state','dirty');
    }
    if(await reopened.locator('#toggle-left-sidebar').getAttribute('aria-expanded')==='false')await reopened.locator('#toggle-left-sidebar').click();await reopened.locator('[data-path="concepts/missing-font.svg"]').click();await reopened.getByRole('button',{name:'Save version / export',exact:true}).click();await reopened.getByRole('button',{name:'Download export',exact:true}).click();await expect(reopened.getByRole('dialog').getByRole('status')).toContainText('unavailable locally');
  } finally { await context.close();await Promise.allSettled(children.map(stop));await rm(root,{recursive:true,force:true}); }
});
