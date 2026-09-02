import type { IncomingMessage, ServerResponse } from "node:http";

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

export async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new HttpError(413, "Request body exceeds the payload limit.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function readJsonBody(request: IncomingMessage, limit: number): Promise<unknown> {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) throw new HttpError(415, "Request body must use application/json.");
  const body = await readBody(request, limit);
  try { return JSON.parse(body.toString("utf8")) as unknown; } catch { throw new HttpError(400, "Request body is not valid JSON."); }
}

export function requireOrigin(request: IncomingMessage, expectedOrigin: string): void {
  if (request.headers.origin !== expectedOrigin) throw new HttpError(403, "Request did not originate from the configured local editor.");
}

export function requireEventStreamOrigin(request: IncomingMessage, expectedOrigin: string): void {
  if (request.headers.origin !== undefined) {
    requireOrigin(request, expectedOrigin);
    return;
  }
  const expectedHost = new URL(expectedOrigin).host;
  if (request.headers.host !== expectedHost
    || request.headers["sec-fetch-site"] !== "same-origin"
    || request.headers["sec-fetch-mode"] !== "cors"
    || request.headers["sec-fetch-dest"] !== "empty") {
    throw new HttpError(403, "Request did not originate from the configured local editor.");
  }
}
