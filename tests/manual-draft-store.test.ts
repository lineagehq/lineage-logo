import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MANUAL_DRAFT_HISTORY_POLICY, MANUAL_DRAFT_MAX_AGE_MS, MANUAL_DRAFT_MAX_BYTES,
  discardManualDraft, manualDraftDigest, manualDraftStorageKey, readManualDraft,
  retireManualDraft, validateManualDraftSvg, writeManualDraft,
  MANUAL_DRAFT_MAX_RECORDS,
} from "../src/client/manual-draft-store";
const sourceSvg = '<svg xmlns="http://www.w3.org/2000/svg"><rect id="mark" fill="red"/></svg>';
const svg = sourceSvg.replace('fill="red"', 'fill="blue"');
const identity = { workspaceId: "opaque-workspace-123", sourcePath: "concepts/東京 brand 🌕.svg" };
const context = { selectionIds: ["mark"], zoom: 1.25, previewBackground: "dark" as const };
const input = { ...identity, sourceSvg, svg, revision: 4, context };
const now = 1_700_000_000_000;
function storage() { const values = new Map<string, string>();return { values, get length() { return values.size; }, key: (index:number) => [...values.keys()][index] ?? null, getItem: (key:string) => values.get(key) ?? null, setItem: (key:string,value:string) => { values.set(key,value); }, removeItem: (key:string) => {values.delete(key);} }; }
function saved(store=storage(), patch:Partial<typeof input>={}) { const result=writeManualDraft(store,{...input,...patch},now);expect(result.status).toBe("saved");if(result.status!=="saved")throw new Error("fixture save failed");return {store,...result}; }
function mutate(store:ReturnType<typeof storage>, patch:Record<string,unknown>) {const key=manualDraftStorageKey(identity);const record=`${key}.record.${store.getItem(key)}`;store.setItem(record,JSON.stringify({...JSON.parse(store.getItem(record)!),...patch}));}
describe("synchronous manual draft recovery",()=>{
 it("cannot delete a new tab draft published between the retirement check and deletion",()=>{
  const {store,token}=saved();const remove=store.removeItem;let replaced=false;
  store.removeItem=(key:string)=>{
   if(!replaced&&key.includes(".record.")){replaced=true;const newer=writeManualDraft(store,{...input,revision:5,svg:svg.replace("blue","green")},now+1);expect(newer.status).toBe("saved");}
   remove(key);
  };
  expect(discardManualDraft(store,identity,token)).toEqual({status:"retired"});
  expect(readManualDraft(store,{...identity,sourceSvg},now+1)).toMatchObject({status:"ready",draft:{revision:5,svg:svg.replace("blue","green")}});
 });
 it("bounds orphan records while preserving recent in-flight writes",()=>{
  const {store}=saved();const key=manualDraftStorageKey(identity);
  for(let index=0;index<MANUAL_DRAFT_MAX_RECORDS;index++)store.setItem(`${key}.record.${manualDraftDigest(String(index))}`,JSON.stringify({timestamp:now}));
  expect(writeManualDraft(store,input,now)).toMatchObject({status:"failure",reason:"storage-write-failed"});
  expect(writeManualDraft(store,input,now+10*60*1000).status).toBe("saved");expect(store.values.size).toBe(2);
  for(let index=0;index<20;index++)expect(writeManualDraft(store,{...input,revision:index},now+10*60*1000+index).status).toBe("saved");
  expect(store.values.size).toBe(2);
 });

 it("persists the final committed edit synchronously with Unicode source identity and exact hashes",()=>{
  const {store,draft}=saved();expect(draft.sourcePath).toBe(identity.sourcePath);expect(draft.draftDigest).toBe(createHash("sha256").update(svg).digest("hex"));
  expect(readManualDraft(store,{...identity,sourceSvg},now)).toMatchObject({status:"ready",draft:{svg,revision:4,context}});
  expect(MANUAL_DRAFT_HISTORY_POLICY).toBe("reset-on-restore");
  expect(draft).not.toHaveProperty("history");expect(store.values.size).toBe(2);
 });
 it("preserves passive CSS, local resources, embedded raster and manual metadata",()=>{
  const styled='<svg xmlns="http://www.w3.org/2000/svg"><style>@media (min-width:1px){.mark{fill:blue}}</style><defs><linearGradient id="p"/></defs><g data-lineage-locked="true" style="fill:url(\'#p\');stroke:red"><text xml:space="preserve" aria-label="url(http://example.test) is text">two  words</text><image href="data:image/png;base64,AAAA"/></g></svg>';
  const {store}=saved(storage(),{svg:styled});expect(readManualDraft(store,{...identity,sourceSvg},now)).toMatchObject({status:"ready",draft:{svg:styled}});
 });
 it.each([
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
  '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.test/a.png"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><style>@import "remote.css";</style></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(https://example.test/p)"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><rect style="background:image-set(\'remote.png\' 1x)"/></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="u\\72l(https://example.test/p)"/></svg>',
  '<!DOCTYPE svg [<!ENTITY a SYSTEM "file:///private">]><svg xmlns="http://www.w3.org/2000/svg"/>',
  '<svg xmlns="http://www.w3.org/2000/svg"><g></svg>',
 ])("refuses unsafe or malformed recovered artwork",bad=>{expect(validateManualDraftSvg(bad)).toBe(false);expect(writeManualDraft(storage(),{...input,svg:bad},now)).toMatchObject({status:"refused",reason:"unsafe-svg"});});
 it("bounds the complete encoded record including JSON escaping and context",()=>{
  const quoted='<svg xmlns="http://www.w3.org/2000/svg"><text>'+ '"'.repeat(MANUAL_DRAFT_MAX_BYTES/2)+'</text></svg>';
  expect(new TextEncoder().encode(quoted).byteLength).toBeLessThan(MANUAL_DRAFT_MAX_BYTES);
  const store=storage();expect(writeManualDraft(store,{...input,svg:quoted},now)).toMatchObject({reason:"oversized"});expect(store.values.size).toBe(0);
 });
 it.each([
  ["workspaceId","different-workspace","wrong-workspace"], ["sourcePath","concepts/other.svg","wrong-source"],
  ["timestamp",now+1,"future"], ["timestamp",now-MANUAL_DRAFT_MAX_AGE_MS-1,"expired"],
  ["revision",-1,"malformed"], ["revision",1.2,"malformed"], ["extra","field","malformed"],
  ["context",{...context,unexpected:true},"malformed"], ["svg",sourceSvg,"integrity"],
 ])("refuses corrupt %s with an opaque discard token",(field,value,reason)=>{
  const {store}=saved();mutate(store,{[field as string]:value});const result=readManualDraft(store,{...identity,sourceSvg},now);expect(result).toMatchObject({status:"refused",reason,token:expect.stringMatching(/^[a-f0-9]{64}$/)});
 });
 it("rejects changed source, while same-named folders have separate opaque storage slots",()=>{
  const {store}=saved();expect(readManualDraft(store,{...identity,sourceSvg:svg},now)).toMatchObject({reason:"changed-source"});expect(readManualDraft(store,{...identity,workspaceId:"other-opaque-workspace",sourceSvg},now)).toEqual({status:"none"});
 });
 it("verifies metadata integrity as well as SVG bytes",()=>{
  const {store}=saved();mutate(store,{revision:5});expect(readManualDraft(store,{...identity,sourceSvg},now)).toMatchObject({reason:"integrity"});
 });
 it("returns visible failures for unavailable, full and no-op storage without throwing",()=>{
  const failed={getItem:()=>{throw new Error("private")},setItem:()=>{throw new Error("quota")},removeItem:()=>{throw new Error("denied")}};
  expect(writeManualDraft(failed,input,now)).toMatchObject({status:"failure",reason:"storage-write-failed"});expect(readManualDraft(failed,{...identity,sourceSvg},now)).toMatchObject({status:"failure",reason:"storage-unavailable"});
  const noop={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};expect(writeManualDraft(noop,input,now)).toMatchObject({status:"failure",reason:"storage-write-failed"});
 });
 it("retires exactly the saved capture and preserves a subsequent committed edit",()=>{
  const {store,draft}=saved();const newer=writeManualDraft(store,{...input,svg:svg.replace("blue","green"),revision:5},now+1);expect(newer.status).toBe("saved");expect(retireManualDraft(store,draft)).toEqual({status:"changed"});expect(readManualDraft(store,{...identity,sourceSvg},now+1)).toMatchObject({status:"ready",draft:{revision:5}});
  if(newer.status!=="saved")throw new Error("save failed");expect(retireManualDraft(store,newer.draft)).toEqual({status:"retired"});expect(readManualDraft(store,{...identity,sourceSvg},now+1)).toEqual({status:"none"});
 });
 it("explicitly discards even malformed records, comparing the exact captured token",()=>{
  const store=storage(),key=manualDraftStorageKey(identity);store.setItem(key,"broken JSON");const rejected=readManualDraft(store,{...identity,sourceSvg},now);if(rejected.status!=="refused"||!rejected.token)throw new Error("missing refusal token");expect(discardManualDraft(store,identity,rejected.token)).toEqual({status:"retired"});
  store.setItem(key,"new malformed JSON");expect(discardManualDraft(store,identity,rejected.token)).toEqual({status:"changed"});expect(store.getItem(key)).toBe("new malformed JSON");
 });
 it.each(["pending-agent","provisional-agent"] as const)("does not cross %s authority",authority=>{
  const {store,draft,token}=saved();const before=store.getItem(manualDraftStorageKey(identity));
  for(const result of [readManualDraft(store,{...identity,sourceSvg},now,authority),writeManualDraft(store,input,now,authority),retireManualDraft(store,draft,authority),discardManualDraft(store,identity,token,authority)])expect(result).toMatchObject({status:"refused",reason:"agent-authority"});
  expect(store.getItem(manualDraftStorageKey(identity))).toBe(before);
 });
 it("detects failed removals and does not mutate the captured context",()=>{
  const {store,draft}=saved();input.context.selectionIds.push("later");expect(draft.context.selectionIds).toEqual(["mark"]);input.context.selectionIds.pop();store.removeItem=()=>{};expect(retireManualDraft(store,draft)).toMatchObject({status:"failure",reason:"storage-remove-failed"});
 });
 it("checks safety again even when a hostile record recomputes integrity hashes",()=>{
  const {store,draft}=saved();const hostile={...draft,svg:'<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'};hostile.draftDigest=manualDraftDigest(hostile.svg);const {integrity:_,...body}=hostile;hostile.integrity=manualDraftDigest(JSON.stringify(body));const raw=JSON.stringify(hostile),token=manualDraftDigest(raw),key=manualDraftStorageKey(identity);store.setItem(key,token);store.setItem(`${key}.record.${token}`,raw);expect(readManualDraft(store,{...identity,sourceSvg},now)).toMatchObject({reason:"unsafe-svg"});
 });
});
