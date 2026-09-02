#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const editorHtml = await readFile(new URL("../dist/node-editor-plugin/package/editor/index.html", import.meta.url), "utf8");
const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect id="mark" x="20" y="20" width="60" height="60" fill="#336699"/></svg>';
const sourceBytes = new TextEncoder().encode(source);
const checksum = createHash("sha256").update(sourceBytes).digest("hex");
const binding = "browser_smoke_binding_1234";
const listen = (server) => new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const editorServer = createServer((request, response) => {
  if (request.url === "/editor/index.html") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-ancestors http://*.localhost:*" });
    response.end(editorHtml); return;
  }
  response.writeHead(404); response.end();
});
await listen(editorServer);
const editorAddress = editorServer.address();
if (!editorAddress || typeof editorAddress === "string") throw new Error("editor smoke server failed to bind");
let parentHtml = "";
const parentServer = createServer((request, response) => {
  if (request.url === "/") { response.writeHead(200, { "content-type": "text/html; charset=utf-8" }); response.end(parentHtml); return; }
  response.writeHead(404); response.end();
});
await listen(parentServer);
const parentAddress = parentServer.address();
if (!parentAddress || typeof parentAddress === "string") throw new Error("parent smoke server failed to bind");
const parentOrigin = `http://lineage-plugin-smoke.localhost:${parentAddress.port}`;
const editorOrigin = `http://lineage-logo-editor.localhost:${editorAddress.port}`;
parentHtml = `<!doctype html><meta charset="utf-8"><iframe id="editor" sandbox="allow-scripts" src="${editorOrigin}/editor/index.html#lineageParentOrigin=${encodeURIComponent(parentOrigin)}&lineageChannelBinding=${binding}&lineageProtocol=1.3"></iframe><script>
window.received=[];
addEventListener("message", event => {
  const frame=document.querySelector("#editor");
  if(event.source!==frame.contentWindow||event.origin!=="null"||event.data?.type!=="lineage.node-editor.connect"||event.data.channelBinding!==${JSON.stringify(binding)}||Object.keys(event.data).sort().join(",")!=="channelBinding,type"||event.ports.length!==1)return;
  const port=event.ports[0];
  port.onmessage=message=>{ const data=message.data; window.received.push({type:data?.type,dirty:data?.dirty,summary:data?.summary,mimeType:data?.mimeType,payload:data?.payload instanceof ArrayBuffer?Array.from(new Uint8Array(data.payload)):undefined}); };
  port.postMessage({type:"lineage.node-editor.connected",channelBinding:${JSON.stringify(binding)},message:"Editor ready. Changes stay local until you save."});
  const payload=new Uint8Array(${JSON.stringify([...sourceBytes])}).buffer;
  port.postMessage({type:"lineage.node-editor.document",mimeType:"image/svg+xml",sizeBytes:payload.byteLength,checksumSha256:${JSON.stringify(checksum)},payload},[payload]);
});
</script>`;

const browser = await chromium.launch({ headless: true });
const requests = [];
try {
  const page = await browser.newPage();
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(parentOrigin);
  const frame = page.frameLocator("#editor");
  await frame.locator("#status").getByText("Current immutable SVG loaded", { exact: false }).waitFor();
  await frame.locator("#artboard rect").click({ force: true });
  await frame.locator("#fill").fill("#ff0000");
  await page.waitForFunction(() => window.received.some((message) => message.type === "lineage.node-editor.dirty" && message.dirty === true));
  await frame.locator("#save").click();
  await page.waitForFunction(() => window.received.some((message) => message.type === "lineage.node-editor.save"));
  const saved = await page.evaluate(() => window.received.find((message) => message.type === "lineage.node-editor.save"));
  assert.equal(saved.mimeType, "image/svg+xml");
  assert.equal(saved.summary, "Manual correction in Lineage Logo");
  const markup = new TextDecoder().decode(new Uint8Array(saved.payload));
  assert.match(markup, /fill="#ff0000"/);
  assert.doesNotMatch(markup, /data-lineage-(?:hover|secondary|review-highlight)/);
  await frame.locator("#cancel").click();
  await page.waitForFunction(() => window.received.some((message) => message.type === "lineage.node-editor.cancel"));
  assert.deepEqual([...new Set(requests.map((url) => new URL(url).origin))].sort(), [editorOrigin, parentOrigin].sort());
  console.log(JSON.stringify({ browser: "passed", dirty: true, savedBytes: saved.payload.length, cancellation: true, networkOrigins: [parentOrigin, editorOrigin] }));
} finally {
  await browser.close();
  await Promise.all([new Promise((resolve) => editorServer.close(resolve)), new Promise((resolve) => parentServer.close(resolve))]);
}
