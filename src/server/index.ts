import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { listSvgFiles, readWorkspaceSvg, resolveWorkspaceRoot } from "./workspace.js";

const HOST = "127.0.0.1";
const STATIC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/client");

function getArgument(name: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? "") : "";
}

const PORT = Number(getArgument("--port") || process.env.LINEAGE_LOGO_PORT || 4173);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  throw new Error("Port must be an integer between 1024 and 65535.");
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function securityHeaders(response: ServerResponse): void {
  response.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self' http://${HOST}:${PORT}`,
  );
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
}

async function serveStatic(pathname: string, response: ServerResponse): Promise<void> {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const candidate = path.resolve(STATIC_ROOT, requested);
  if (!candidate.startsWith(`${STATIC_ROOT}${path.sep}`)) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  try {
    const info = await stat(candidate);
    if (!info.isFile()) throw new Error("Not a file");
  } catch {
    sendJson(response, 404, { error: "Build the client with npm run build." });
    return;
  }

  const extension = path.extname(candidate);
  const contentType = extension === ".html"
    ? "text/html; charset=utf-8"
    : extension === ".js"
      ? "text/javascript; charset=utf-8"
      : extension === ".css"
        ? "text/css; charset=utf-8"
        : "application/octet-stream";
  response.writeHead(200, { "Content-Type": contentType });
  createReadStream(candidate).pipe(response);
}

const workspaceRoot = await resolveWorkspaceRoot(getArgument("--workspace"));

const server = createServer(async (request, response) => {
  securityHeaders(response);
  const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);

  try {
    if (request.method === "GET" && url.pathname === "/api/workspace") {
      sendJson(response, 200, {
        rootName: path.basename(workspaceRoot),
        files: await listSvgFiles(workspaceRoot),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/svg") {
      const svg = await readWorkspaceSvg(workspaceRoot, url.searchParams.get("path") ?? "");
      response.writeHead(200, {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(svg);
      return;
    }

    if (request.method === "GET") {
      await serveStatic(url.pathname, response);
      return;
    }

    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(response, 400, {
      error: error instanceof Error ? error.message : "Request failed",
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Lineage Logo server: http://${HOST}:${PORT}`);
  console.log(`Workspace: ${workspaceRoot}`);
});
