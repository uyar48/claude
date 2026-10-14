// Bridges Node http requests to the Web-standard handlers in api/ (the same
// signature Vercel uses: `export async function GET(request: Request)`), so
// the API also works under `vite dev` and the local preview server.

import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import fs from 'node:fs';

export type Handler = (req: Request) => Response | Promise<Response>;
export type HandlerModule = Partial<Record<'GET' | 'POST' | 'PUT' | 'DELETE', Handler>>;

/** "/api/push/test?x=1" → "<root>/api/push/test.ts" (or null if no such file). */
export function resolveApiFile(root: string, url: string): string | null {
  const pathname = url.split('?')[0];
  if (!pathname.startsWith('/api/')) return null;
  const rel = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  if (rel.includes('..')) return null;
  const file = path.join(root, `${rel}.ts`);
  return fs.existsSync(file) ? file : null;
}

export async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.url ?? '/', `http://${host}`);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else if (v !== undefined) headers.set(k, v);
  }
  let body: Buffer | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    body = Buffer.concat(chunks);
  }
  return new Request(url, { method: req.method, headers, body: body ? new Uint8Array(body) : undefined });
}

export async function sendWebResponse(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((v, k) => res.setHeader(k, v));
  const buf = Buffer.from(await response.arrayBuffer());
  res.end(buf);
}

export async function runHandler(mod: HandlerModule, req: IncomingMessage, res: ServerResponse) {
  const method = (req.method ?? 'GET').toUpperCase() as keyof HandlerModule;
  const fn = mod[method];
  if (!fn) {
    res.statusCode = 405;
    res.end('Method Not Allowed');
    return;
  }
  try {
    await sendWebResponse(res, await fn(await toWebRequest(req)));
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.end('Internal error');
  }
}
