import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { access, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
const bind = (port=0) => new Promise<Server>((resolve,reject) => { const server=createServer();server.once('error',reject);server.listen(port,'127.0.0.1',()=>resolve(server)); });
const close = (server:Server) => new Promise<void>(resolve=>server.close(()=>resolve()));
const portOf = (server:Server) => (server.address() as {port:number}).port;
const exit = (child:ChildProcess) => new Promise<number|null>(resolve=>child.once('exit',resolve));
async function freePorts() { const a=await bind(),b=await bind();const ports=[portOf(a),portOf(b)];await Promise.all([close(a),close(b)]);return ports; }
function launch(ports:number[]) { return spawn(process.execPath,['--import','tsx','scripts/ux-performance-baseline.ts','--lifecycle-probe'], {env:{...process.env,LINEAGE_LOGO_PERFORMANCE_API_PORT:String(ports[0]),LINEAGE_LOGO_PERFORMANCE_CLIENT_PORT:String(ports[1])},stdio:['ignore','pipe','pipe']}); }
function ready(child:ChildProcess) { return new Promise<{workspace:string;pids:number[]}>((resolve,reject)=>{let output='';const deadline=setTimeout(()=>reject(new Error('Probe readiness timeout')),15000);child.once('exit',()=>{clearTimeout(deadline);reject(new Error('Probe exited before readiness'));});child.stdout!.on('data',chunk=>{output+=chunk;const line=output.split('\n').find(line=>line.startsWith('{'));if(line){try{const value=JSON.parse(line);if(value.ready){clearTimeout(deadline);resolve(value);}}catch{}}});}); }
it.each(['SIGINT','SIGTERM'] as const)('cleans real owned services and fixture workspace after %s',async signal=>{
 const baseline='docs/plans/logo-workflow-improvements/evidence/performance-baseline.json';const digest=createHash('sha256').update(await readFile(baseline)).digest('hex');
 const ports=await freePorts();const child=launch(ports);const ended=exit(child);let evidence:Awaited<ReturnType<typeof ready>>|undefined;
 try{evidence=await ready(child);child.kill(signal);expect(await ended).toBe(signal==='SIGINT'?130:143);await expect(access(evidence.workspace)).rejects.toThrow();for(const pid of evidence.pids)expect(()=>process.kill(pid,0)).toThrow();for(const port of ports)await close(await bind(port));expect(createHash('sha256').update(await readFile(baseline)).digest('hex')).toBe(digest);}
 finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await ended;}}
},20000);
it('refuses an occupied performance port without touching its existing listener',async()=>{
 const occupied=await bind();const other=await bind();const ports=[portOf(occupied),portOf(other)];await close(other);const child=launch(ports);let output='';child.stderr!.on('data',chunk=>output+=chunk);
 try{expect(await exit(child)).toBe(1);expect(output).toContain('Performance port is already occupied');expect(occupied.listening).toBe(true);await close(await bind(ports[1]));}finally{child.kill('SIGTERM');await close(occupied);}
},10000);
