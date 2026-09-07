import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { chromium } from '@playwright/test';
import { expect, it } from 'vitest';
import { disablePerformanceRestoration, prepareEmptyPerformanceOpen, measurePerformanceOpen } from '../scripts/ux-performance-open';
const bind = () => new Promise<Server>((resolve,reject) => { const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server)); });
const close = (server:Server) => new Promise<void>(resolve=>server.close(()=>resolve()));
function ready(child:ChildProcess) {
  return new Promise<void>((resolve,reject)=>{
    let output='';const deadline=setTimeout(()=>reject(new Error('Readiness timeout')),15000);
    child.once('exit',()=>{clearTimeout(deadline);reject(new Error('Services exited before readiness'));});
    child.stdout!.on('data',chunk=>{output+=chunk;const line=output.split('\n').find(line=>line.startsWith('{'));if(line){try{if(JSON.parse(line).ready){clearTimeout(deadline);resolve();}}catch{}}});
  });
}
// Opt-in: unit-only CI does not install browsers; this starts isolated real services.
it.runIf(process.env.LINEAGE_LOGO_PERFORMANCE_OPEN_REGRESSION === '1')('timed opens include delayed SVG responses after prior document restoration',async()=>{
  const a=await bind(),b=await bind();
  const apiPort=(a.address() as {port:number}).port, clientPort=(b.address() as {port:number}).port;
  await Promise.all([close(a),close(b)]);
  const child=spawn(process.execPath,['--import','tsx','scripts/ux-performance-baseline.ts','--lifecycle-probe'],{env:{...process.env,LINEAGE_LOGO_PERFORMANCE_API_PORT:String(apiPort),LINEAGE_LOGO_PERFORMANCE_CLIENT_PORT:String(clientPort)},stdio:['ignore','pipe','pipe']});
  const ended=new Promise<void>(resolve=>child.once('exit',()=>resolve()));
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await ready(child);
    browser=await chromium.launch();
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    await page.addInitScript('globalThis.__name = (target) => target');
    await page.goto(`http://lineage-performance.localhost:${clientPort}`);
    await page.locator('[data-path="concepts/layers-100.svg"]').click();
    await page.locator('#artboard #layer-0099').waitFor();
    // Prove the realistic precondition: this app restores the previously opened SVG.
    await page.reload();
    await page.locator('#artboard #layer-0099').waitFor();
    await expect(measurePerformanceOpen(page,100)).rejects.toThrow('confirmed empty editor');
    await disablePerformanceRestoration(page);
    for (let run=0;run<2;run++) {
      await prepareEmptyPerformanceOpen(page,100);
      let requested!:()=>void;
      const requestStarted=new Promise<void>(resolve=>{requested=resolve;});
      let release!:()=>void;
      const held=new Promise<void>(resolve=>{release=resolve;});
      await page.route('**/api/svg?*',async route=>{requested();await held;await route.continue();});
      let settled=false;
      const sample=measurePerformanceOpen(page,100).finally(()=>{settled=true;});
      try {
        await requestStarted;
        await new Promise(resolve=>setTimeout(resolve,1600));
        expect(settled).toBe(false);
        expect(await page.locator('#artboard svg').count()).toBe(0);
      } finally {release();}
      expect(await sample).toBeGreaterThanOrEqual(1500);
      expect(await page.locator('#artboard svg rect').count()).toBe(100);
      await page.unroute('**/api/svg?*');
    }
  } finally {
    await browser?.close();child.kill('SIGTERM');await ended;
  }
},40000);
