import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FullResult, TestCase, TestResult } from '@playwright/test/reporter';
import SanitizedReporter from './e2e/release/sanitized-reporter';
import FailureOnlyReporter from './e2e/failure-only-reporter';
import { assertPublicWorkspace } from './e2e/public-fixture-diagnostics';
import { validatedPublicFixtures } from '../scripts/qa-fixtures';
const canary='QA_TOKEN_CANARY /private/QA_PATH_CANARY <svg>QA_CONTENT_CANARY</svg>';
const root=process.cwd();
const temporary:string[]=[];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for(const dir of temporary.splice(0))rmSync(dir,{recursive:true,force:true}); });
function fixtureDirectory() {const dir=mkdtempSync(path.join(tmpdir(),'lineage-qa-policy-'));temporary.push(dir);vi.spyOn(process,'cwd').mockReturnValue(dir);return dir;}
function failedReporter() {
 const reporter=new SanitizedReporter();
 reporter.onTestEnd({id:canary,title:canary,parent:{project:()=>({name:canary})},titlePath:()=>[canary]} as unknown as TestCase,{status:'failed',duration:12,error:{message:canary},stdout:[canary]} as unknown as TestResult);
 reporter.onEnd({status:'failed',duration:15} as FullResult);
 return reporter;
}
describe('QA diagnostic privacy',()=>{
 it('retains bounded failure counts and durations while discarding all seeded private fields and artifacts',async()=>{
  const dir=fixtureDirectory();const stdout=vi.spyOn(process.stdout,'write').mockReturnValue(true);const stderr=vi.spyOn(process.stderr,'write').mockReturnValue(true);
  failedReporter();writeFileSync(path.join(dir,'test-results','private-artifact.txt'),canary);
  const cleanup=new FailureOnlyReporter();cleanup.onEnd({status:'failed'} as FullResult);await cleanup.onExit();
  const receipt=readFileSync(path.join(dir,'test-results/release-diagnostics.json'),'utf8');
  expect(receipt+JSON.stringify(stdout.mock.calls)+JSON.stringify(stderr.mock.calls)).not.toMatch(/QA_TOKEN_CANARY|QA_PATH_CANARY|QA_CONTENT_CANARY/);
  expect(JSON.parse(receipt)).toMatchObject({schemaVersion:2,status:'failed',counts:{failed:1},tests:[{project:'unknown',durationMs:12}]});
  expect(readdirSync(path.join(dir,'test-results'))).toEqual(['release-diagnostics.json']);
 });
 it('retains digest-bound public screenshot evidence only in explicit mode',async()=>{
  const dir=fixtureDirectory();vi.spyOn(process.stdout,'write').mockReturnValue(true);vi.spyOn(process.stderr,'write').mockReturnValue(true);vi.stubEnv('LINEAGE_LOGO_QA_DIAGNOSTICS','public-fixtures');failedReporter();
  const publicDir=path.join(dir,'test-results/public-fixtures');mkdirSync(publicDir);const bytes=Buffer.from('public screenshot fixture');writeFileSync(path.join(publicDir,'surface.png'),bytes);writeFileSync(path.join(publicDir,'manifest.json'),JSON.stringify({schemaVersion:1,source:'ux-wide.svg',sha256:createHash('sha256').update(bytes).digest('hex'),untrusted:canary}));
  const cleanup=new FailureOnlyReporter();cleanup.onEnd({status:'failed'} as FullResult);await cleanup.onExit();
  expect(readFileSync(path.join(publicDir,'surface.png'))).toEqual(bytes);expect(readFileSync(path.join(publicDir,'manifest.json'),'utf8')).not.toContain(canary);
 });
 it('refuses symlinked diagnostic output without writing through it',()=>{
  const dir=fixtureDirectory(); const outside=mkdtempSync(path.join(tmpdir(),'lineage-qa-outside-'));temporary.push(outside);
  symlinkSync(outside,path.join(dir,'test-results'));
  expect(()=>failedReporter()).toThrow('symlinked diagnostics output');
  expect(readdirSync(outside)).toEqual([]);
 });
 it('cleans successful artifacts',async()=>{
  const dir=fixtureDirectory();mkdirSync(path.join(dir,'test-results'));writeFileSync(path.join(dir,'test-results/test.txt'),'public');const cleanup=new FailureOnlyReporter();cleanup.onEnd({status:'passed'} as FullResult);await cleanup.onExit();expect(readdirSync(dir)).toEqual([]);
 });
 it('refuses unknown origins before any workspace access',async()=>{
  const get=vi.fn();await expect(assertPublicWorkspace({get},'http://private.localhost:43118')).rejects.toThrow('unknown origin');expect(get).not.toHaveBeenCalled();
 });
 it('refuses private/unknown workspaces before content read or capture',async()=>{
  const get=vi.fn().mockResolvedValue({ok:()=>true,json:async()=>({files:[{path:canary}]}),body:async()=>Buffer.from(canary)});
  await expect(assertPublicWorkspace({get},'http://marquee-qa.localhost:43118')).rejects.toThrow('unknown workspace');expect(get).toHaveBeenCalledTimes(1);
 });
 it('validates the complete exact public corpus and refuses modified bytes',async()=>{
  const fixtures=await validatedPublicFixtures(root);const files=new Map<string,Buffer>(await Promise.all(fixtures.map(async f=>[`concepts/${f.destination}`,readFileSync(f.source)] as const)));
  files.set('concepts/complex-seatify.svg',readFileSync(path.join(root,'tests/fixtures/ux-audit/seatify-transformed.svg')));files.set('concepts/seatify-constellation.svg',readFileSync(path.join(root,'tests/fixtures/ux-audit/seatify-44.svg')));
  let corrupt=false;const get=vi.fn(async(url:string)=>({ok:()=>true,json:async()=>({files:[...files.keys()].map(path=>({path}))}),body:async()=>corrupt?Buffer.from(canary):files.get(new URL(url,'http://test').searchParams.get('path')!)!}));
  await expect(assertPublicWorkspace({get},'http://marquee-qa.localhost:43118')).resolves.toBeUndefined();corrupt=true;await expect(assertPublicWorkspace({get},'http://marquee-qa.localhost:43118')).rejects.toThrow('integrity mismatch');
 });
});
