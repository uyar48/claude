import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Plugin } from 'vite';

const SW_SOURCE = 'src/sw/sw.js';
/** Public files that belong to the app shell (media is cached per lesson). */
const SHELL_PUBLIC = ['/manifest.webmanifest', '/icons/icon-192.png', '/icons/apple-touch-icon.png'];

/**
 * Emits /sw.js with the list of built assets injected, so the service worker
 * can precache the app shell. In dev it serves the same file with an empty list.
 */
export function serviceWorkerPlugin(): Plugin {
  let root = process.cwd();
  return {
    name: 'okuma-sw',
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/sw.js') return next();
        res.setHeader('Content-Type', 'text/javascript');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(render(root, [], 'dev', mediaFiles(root)));
      });
    },
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((f) => !f.endsWith('.map'))
        .map((f) => `/${f}`);
      const urls = ['/', ...assets, ...SHELL_PUBLIC];
      const media = mediaFiles(root);
      const version = crypto.createHash('sha256').update([...urls, media.version].join('|')).digest('hex').slice(0, 12);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: render(root, urls, version, media) });
    },
  };
}

/**
 * Pictures and audio of this release. Their names change when their content
 * does, so the list (and its hash) identifies the media version.
 */
export function mediaFiles(root: string): { files: string[]; version: string } {
  const files: string[] = [];
  for (const dir of ['img', 'audio']) {
    const abs = path.join(root, 'public/media', dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).sort()) if (/\.(jpe?g|png|webp|mp3|m4a)$/.test(f)) files.push(`/media/${dir}/${f}`);
  }
  const version = crypto.createHash('sha256').update(files.join('|')).digest('hex').slice(0, 10);
  return { files, version };
}

function render(root: string, urls: string[], version: string, media: { files: string[]; version: string }): string {
  const src = fs.readFileSync(path.join(root, SW_SOURCE), 'utf8');
  return src
    .replace('self.__PRECACHE__', JSON.stringify(urls))
    .replace('self.__SW_VERSION__', JSON.stringify(version))
    .replace('self.__MEDIA_FILES__', JSON.stringify(media.files))
    .replace('self.__MEDIA_VERSION__', JSON.stringify(media.version));
}
