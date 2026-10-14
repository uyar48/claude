// Local preview of the production build: serves dist/ with SPA fallback and
// runs api/*.ts like Vercel would. Usage: npm run build && npm run preview
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveApiFile, runHandler, type HandlerModule } from './node-web';

const root = process.cwd();
const dist = path.join(root, 'dist');
const port = Number(process.env.PORT ?? 4173);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.map': 'application/json',
};

http
  .createServer(async (req, res) => {
    const url = req.url ?? '/';
    const api = resolveApiFile(root, url);
    if (api) {
      const mod = (await import(pathToFileURL(api).href)) as HandlerModule;
      return runHandler(mod, req, res);
    }
    const pathname = decodeURIComponent(url.split('?')[0]);
    let file = path.join(dist, pathname);
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (/\.[a-z0-9]+$/i.test(pathname)) {
        res.statusCode = 404;
        return res.end('Not found');
      }
      file = path.join(dist, 'index.html');
    }
    res.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
    if (pathname === '/sw.js') res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, () => console.log(`Preview: http://localhost:${port}`));
