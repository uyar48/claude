// Downloads word pictures from free stock-photo sources.
//
//   npm run fetch-images                      concrete words of the course
//   npm run fetch-images -- --words house,tea only these words
//   npm run fetch-images -- --force           search again, replace candidates
//   npm run fetch-images -- --prune           delete pictures no word uses
//
// For each word up to 5 candidates are saved as 800×600 JPEGs (4:3) in
// public/media/img/, and their source, author and license go into
// content/media/credits.json (also copied next to the pictures). Words that
// already have 5 downloaded candidates are skipped.
//
// Sources in order: Pexels (PEXELS_API_KEY), Pixabay (PIXABAY_API_KEY), then
// Openverse and Wikimedia Commons, which need no key. Keys are free; they are
// read from the environment and never written anywhere.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import type { Course } from '../src/content/courseTypes';
import type { ImageCandidate, ImageCredits, WordImages } from '../src/content/types';
import {
  openverse,
  pexels,
  pickCandidates,
  pixabay,
  politeFetch,
  wikimedia,
  type Found,
  type ResponseCache,
  type StockSource,
} from './media/stock';

const ROOT = path.resolve(import.meta.dirname, '..');
const COURSE = path.join(ROOT, 'content/build/course.json');
const CREDITS = path.join(ROOT, 'content/media/credits.json');
const IMG_DIR = path.join(ROOT, 'public/media/img');
const CACHE_DIR = path.join(ROOT, '.media-cache/stock');
const PER_WORD = 5;
const WIDTH = 800;
const HEIGHT = 600;

export const KEY_HELP: Record<string, string> = {
  PEXELS_API_KEY:
    'PEXELS_API_KEY yok: Pexels atlandı. Ücretsiz anahtar: https://www.pexels.com/api/ → ortam ayarlarına PEXELS_API_KEY olarak ekle.',
  PIXABAY_API_KEY:
    'PIXABAY_API_KEY yok: Pixabay atlandı. Ücretsiz anahtar: https://pixabay.com/api/docs/ → ortam ayarlarına PIXABAY_API_KEY olarak ekle.',
};

function fileCache(dir: string): ResponseCache {
  fs.mkdirSync(dir, { recursive: true });
  const file = (key: string) => path.join(dir, `${key.replace(/[^a-z0-9]+/gi, '_').slice(0, 120)}.json`);
  return {
    get(key, maxAgeMs) {
      try {
        const f = file(key);
        if (Date.now() - fs.statSync(f).mtimeMs > maxAgeMs) return null;
        return JSON.parse(fs.readFileSync(f, 'utf8'));
      } catch {
        return null;
      }
    },
    set(key, value) {
      fs.writeFileSync(file(key), JSON.stringify(value));
    },
  };
}

/** Wraps a source so search results are reused for 24 h (polite to free APIs). */
function cached(src: StockSource, cache: ResponseCache): StockSource {
  return {
    id: src.id,
    async search(query, n) {
      const key = `${src.id}-search-${query}-${n}`;
      const hit = cache.get(key, 24 * 3600_000) as Found[] | null;
      if (hit) return hit;
      const found = await src.search(query, n);
      cache.set(key, found);
      return found;
    },
  };
}

export async function toJpeg(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize(WIDTH, HEIGHT, { fit: 'cover', position: sharp.strategy.attention })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
}

/** Very dark or flat pictures (night shots, blank walls) are poor word pictures. */
export async function tooDark(jpeg: Buffer): Promise<boolean> {
  const st = await sharp(jpeg).stats();
  const mean = st.channels.slice(0, 3).reduce((a, c) => a + c.mean, 0) / 3;
  return mean < 25 || st.channels.slice(0, 3).every((c) => c.stdev < 15);
}

export function fileName(word: string, c: Pick<Found, 'source' | 'id'>): string {
  return `${word}-${c.source}-${c.id.replace(/[^a-z0-9]+/gi, '').slice(0, 24)}.jpg`;
}

async function main() {
  const { values } = parseArgs({
    options: {
      words: { type: 'string' },
      force: { type: 'boolean', default: false },
      prune: { type: 'boolean', default: false },
    },
  });
  const course = JSON.parse(fs.readFileSync(COURSE, 'utf8')) as Course;
  const credits: ImageCredits = fs.existsSync(CREDITS)
    ? JSON.parse(fs.readFileSync(CREDITS, 'utf8'))
    : { generatedAt: null, missingKeys: [], words: {} };
  credits.words ??= {};
  fs.mkdirSync(IMG_DIR, { recursive: true });

  const words = values.words
    ? values.words.split(',').map((w) => w.trim()).filter(Boolean)
    : course.order.filter((id) => course.words[id].kind === 'concrete');

  const cache = fileCache(CACHE_DIR);
  const missingKeys: string[] = [];
  const primary: StockSource[] = [];
  if (process.env.PEXELS_API_KEY) primary.push(cached(pexels(process.env.PEXELS_API_KEY, politeFetch(fetch, { gapMs: 400 })), cache));
  else missingKeys.push('PEXELS_API_KEY');
  if (process.env.PIXABAY_API_KEY) primary.push(pixabay(process.env.PIXABAY_API_KEY, cache, politeFetch(fetch, { gapMs: 800 })));
  else missingKeys.push('PIXABAY_API_KEY');
  // Openverse allows 20 anonymous requests per minute — searches and
  // downloads share one paced fetcher.
  const ovFetch = politeFetch(fetch, { gapMs: 3500, maxWaitMs: 20_000 });
  const fallback: StockSource[] = [cached(openverse(ovFetch), cache), cached(wikimedia(politeFetch(fetch, { gapMs: 1500 })), cache)];
  // Downloads: two tries, short waits — a busy host just means the next candidate.
  const dl = { tries: 2, maxWaitMs: 5000 };
  const fetchers: Record<string, ReturnType<typeof politeFetch>> = {
    openverse: ovFetch,
    wikimedia: politeFetch(fetch, { gapMs: 1500, ...dl }),
    pexels: politeFetch(fetch, { gapMs: 200, ...dl }),
    pixabay: politeFetch(fetch, { gapMs: 200, ...dl }),
  };
  for (const k of missingKeys) console.log(KEY_HELP[k]);

  const report = { words: 0, skipped: 0, downloaded: 0, failed: [] as string[] };
  for (const id of words) {
    const w = course.words[id];
    if (!w) {
      console.warn(`? ${id}: not a course word`);
      continue;
    }
    const prev = credits.words[id];
    const complete =
      prev && prev.candidates.length >= PER_WORD && prev.candidates.every((c) => fs.existsSync(path.join(IMG_DIR, c.file)));
    if (complete && !values.force) {
      report.skipped++;
      continue;
    }
    report.words++;
    const query = w.query || w.en;

    const search = async (sources: StockSource[]) => {
      const lists: Found[][] = [];
      for (const s of sources) {
        try {
          lists.push(await s.search(query, PER_WORD));
        } catch (e) {
          console.warn(`  ${s.id}: ${(e as Error).message}`);
        }
      }
      return lists;
    };
    let pool = pickCandidates(await search(primary), id, PER_WORD * 2);
    if (pool.length < PER_WORD * 2) pool = [...pool, ...pickCandidates(await search(fallback), id, PER_WORD * 2)];

    const kept: ImageCandidate[] = [];
    for (const c of pool) {
      if (kept.length >= PER_WORD) break;
      const file = fileName(id, c);
      const dest = path.join(IMG_DIR, file);
      if (!fs.existsSync(dest)) {
        try {
          const res = await fetchers[c.source](c.download, { headers: c.headers });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const jpeg = await toJpeg(Buffer.from(await res.arrayBuffer()));
          fs.writeFileSync(dest, jpeg);
          report.downloaded++;
        } catch (e) {
          console.warn(`  ${id}: ${c.source} ${c.id} skipped (${(e as Error).message})`);
          continue;
        }
      }
      if (await tooDark(fs.readFileSync(dest))) {
        console.warn(`  ${id}: ${c.source} ${c.id} skipped (too dark or flat)`);
        fs.unlinkSync(dest);
        continue;
      }
      const { download: _d, headers: _h, id: _id, ...meta } = c;
      kept.push({ file, ...meta });
    }
    if (!kept.length) {
      report.failed.push(id);
      console.warn(`✗ ${id}: no picture found for "${query}"`);
      continue;
    }
    // Keep the default the reviewer saw before, if it is still there.
    const prevDefault = prev?.candidates[prev.default]?.file;
    const def = Math.max(0, kept.findIndex((c) => c.file === prevDefault));
    credits.words[id] = { default: def, candidates: kept, query } satisfies WordImages;
    console.log(`✓ ${id}: ${kept.length} (${[...new Set(kept.map((c) => c.source))].join(', ')})`);
    writeCredits(credits, missingKeys); // progress survives an interrupted run
  }

  if (values.prune) {
    const used = new Set(Object.values(credits.words).flatMap((e) => e.candidates.map((c) => c.file)));
    for (const f of fs.readdirSync(IMG_DIR)) {
      if (f.endsWith('.jpg') && !used.has(f)) fs.unlinkSync(path.join(IMG_DIR, f));
    }
  }
  writeCredits(credits, missingKeys);
  console.log(
    `\n${report.words} words searched, ${report.skipped} already complete, ${report.downloaded} pictures downloaded.` +
      (report.failed.length ? ` No picture: ${report.failed.join(', ')}` : ''),
  );
}

function writeCredits(credits: ImageCredits, missingKeys: string[]) {
  const out = {
    note: 'Written by scripts/fetch-images.ts. Candidates per word with source, author and license.',
    ...credits,
    generatedAt: new Date().toISOString(),
    missingKeys,
  };
  const text = JSON.stringify(out, null, 2) + '\n';
  fs.writeFileSync(CREDITS, text);
  fs.writeFileSync(path.join(IMG_DIR, 'credits.json'), text);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
