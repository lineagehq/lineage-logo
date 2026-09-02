import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream, readFileSync, writeSync } from "node:fs";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const bootstrapMetadataAllowanceBytes = 4096;
const canonicalEditorBytes = readFileSync(new URL("../editor/index.html", import.meta.url));
const canonicalEditorBase64 = canonicalEditorBytes.toString("base64");
const canonicalEditorBase64Bytes = Buffer.byteLength(canonicalEditorBase64, "utf8");
const canonicalEditorSha256 = createHash("sha256").update(canonicalEditorBytes).digest("hex");
const maximumBootstrapBytes = canonicalEditorBase64Bytes + bootstrapMetadataAllowanceBytes;

function tokenMatches(actual, expected) {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function exactLoopbackOrigin(value) {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === "http:" && parsed.origin === value && parsed.pathname === "/" && !parsed.search && !parsed.hash
      && !parsed.username && !parsed.password && Boolean(parsed.port)
      && (host === "127.0.0.1" || host === "[::1]" || host === "localhost" || host.endsWith(".localhost"));
  } catch {
    return false;
  }
}

export async function readOneBootstrap(fd = 3) {
  const stream = createReadStream(null, { fd, autoClose: false });
  const chunks = [];
  let bodyBytes = 0;
  for await (const chunk of stream) {
    bodyBytes += chunk.byteLength;
    if (bodyBytes > maximumBootstrapBytes) throw new Error("bootstrap exceeds the canonical editor plus 4096 metadata bytes");
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks, bodyBytes).toString("utf8");
  const lines = body.split("\n").filter((line) => line.trim());
  if (lines.length !== 1) throw new Error("bootstrap must be supplied exactly once");
  const payload = JSON.parse(lines[0]);
  if (!payload || typeof payload !== "object" || Object.keys(payload).sort().join(",") !== "bootstrap,controlCredential,editorHtmlBase64,editorSha256,idleTimeoutMs,profileId") throw new Error("invalid private bootstrap envelope");
  const bootstrap = payload.bootstrap;
  if (!bootstrap || Object.keys(bootstrap).sort().join(",") !== "bootstrapCredential,expiresAt,pluginId,processId,sessionId,type"
    || bootstrap.type !== "bootstrap" || ![bootstrap.pluginId, bootstrap.processId, bootstrap.sessionId].every((value) => typeof value === "string" && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value) && value.length <= 128)
    || typeof bootstrap.bootstrapCredential !== "string" || !/^[A-Za-z0-9_-]{16,256}$/.test(bootstrap.bootstrapCredential)
    || !Number.isInteger(bootstrap.expiresAt) || bootstrap.expiresAt <= Date.now()) throw new Error("invalid bootstrap binding");
  if (typeof payload.profileId !== "string" || !payload.profileId || typeof payload.controlCredential !== "string" || payload.controlCredential.length < 16) throw new Error("invalid private bootstrap binding");
  if (!Number.isInteger(payload.idleTimeoutMs) || payload.idleTimeoutMs < 25 || payload.idleTimeoutMs > 300_000) throw new Error("invalid idle timeout");
  if (typeof payload.editorHtmlBase64 !== "string" || payload.editorHtmlBase64.length < 16 || !/^[a-f0-9]{64}$/.test(payload.editorSha256)) throw new Error("invalid verified editor bytes");
  const suppliedBase64Bytes = Buffer.byteLength(payload.editorHtmlBase64, "utf8");
  if (bodyBytes - suppliedBase64Bytes > bootstrapMetadataAllowanceBytes) throw new Error("bootstrap metadata exceeds 4096 bytes");
  const suppliedEditorBytes = Buffer.from(payload.editorHtmlBase64, "base64");
  if (suppliedEditorBytes.toString("base64") !== payload.editorHtmlBase64) throw new Error("editor HTML must use canonical base64");
  if (suppliedBase64Bytes !== canonicalEditorBase64Bytes) throw new Error("editor HTML base64 length does not match the canonical artifact");
  if (payload.editorSha256 !== canonicalEditorSha256 || createHash("sha256").update(suppliedEditorBytes).digest("hex") !== canonicalEditorSha256) throw new Error("editor HTML digest does not match the canonical artifact");
  if (suppliedEditorBytes.length !== canonicalEditorBytes.length || !timingSafeEqual(suppliedEditorBytes, canonicalEditorBytes)) throw new Error("editor HTML bytes do not match the canonical artifact");
  return payload;
}

export async function runHost({ bootstrapFd = 3 } = {}) {
  const payload = await readOneBootstrap(bootstrapFd);
  const { bootstrap, controlCredential, idleTimeoutMs, profileId } = payload;
  const editorHtml = Buffer.from(payload.editorHtmlBase64, "base64");
  let processAuthority;
  let closing = false;
  const controlServer = createServer((request, response) => {
    const presented = request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7) : "";
    if (!tokenMatches(presented, controlCredential)) { response.writeHead(401, { "content-type": "application/json" }); response.end('{"error":"authority_denied"}\n'); return; }
    if (request.method === "GET" && request.url === "/health") { response.writeHead(200, { "content-type": "application/json" }); response.end(`${JSON.stringify({ ok: true, pluginId: bootstrap.pluginId, profileId })}\n`); return; }
    if (request.method === "POST" && request.url === "/authority") {
      if (processAuthority) { response.writeHead(409, { "content-type": "application/json" }); response.end('{"error":"capability_replayed"}\n'); return; }
      let body = "";
      request.on("data", (chunk) => { body += chunk.toString("utf8"); if (body.length > 32 * 1024) request.destroy(); });
      request.on("end", () => {
        try {
          const authority = JSON.parse(body);
          const binding = authority?.binding;
          if (!["binding,expiresAt,processCapability", "binding,expiresAt,processCapability,serverOrigin"].includes(Object.keys(authority ?? {}).sort().join(","))
            || typeof authority.processCapability !== "string" || authority.processCapability.length < 16
            || binding?.profileId !== profileId || binding?.pluginId !== bootstrap.pluginId || binding?.processId !== bootstrap.processId || binding?.sessionId !== bootstrap.sessionId
            || binding?.source !== "process" || !Number.isInteger(authority.expiresAt) || authority.expiresAt <= Date.now()
            || (authority.serverOrigin !== undefined && !exactLoopbackOrigin(authority.serverOrigin))) throw new Error("invalid authority");
          processAuthority = authority; response.writeHead(204); response.end();
        } catch { response.writeHead(400, { "content-type": "application/json" }); response.end('{"error":"invalid_authority"}\n'); }
      });
      return;
    }
    if (request.method === "POST" && request.url === "/shutdown") { closing = true; response.writeHead(202, { "content-type": "application/json" }); response.end('{"ok":true}\n'); setImmediate(() => { controlServer.close(); editorServer.close(); }); return; }
    response.writeHead(404, { "content-type": "application/json" }); response.end('{"error":"not_found"}\n');
  });
  const editorServer = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/editor/index.html") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-ancestors http://localhost:* http://*.localhost:*",
      });
      response.end(editorHtml); return;
    }
    response.writeHead(404, { "content-type": "application/json" }); response.end('{"error":"not_found"}\n');
  });
  await new Promise((resolve, reject) => { controlServer.once("error", reject); controlServer.listen(0, "127.0.0.1", resolve); });
  await new Promise((resolve, reject) => { editorServer.once("error", reject); editorServer.listen(0, "127.0.0.1", resolve); });
  const controlAddress = controlServer.address();
  const editorAddress = editorServer.address();
  if (!controlAddress || typeof controlAddress === "string" || !editorAddress || typeof editorAddress === "string") throw new Error("host did not bind TCP ports");
  const controlOrigin = `http://127.0.0.1:${controlAddress.port}`;
  const editorOrigin = `http://lineage-logo-editor.localhost:${editorAddress.port}`;
  writeSync(bootstrapFd, `${JSON.stringify({ type: "host.ready", controlOrigin, editorOrigin, pluginId: bootstrap.pluginId, profileId })}\n`);
  const timer = setTimeout(() => { closing = true; controlServer.close(); editorServer.close(); }, idleTimeoutMs); timer.unref();
  await new Promise((resolve, reject) => { controlServer.once("close", resolve); controlServer.once("error", reject); });
  clearTimeout(timer);
  return { reason: closing ? "shutdown" : "closed" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runHost().then(() => process.exit(0)).catch((error) => { process.stderr.write(`Lineage Logo editor host failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exit(1); });
