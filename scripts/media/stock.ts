// Free stock-photo sources for word pictures. Each adapter searches and returns
// candidates with everything needed for attribution; downloading, cropping and
// credits.json live in scripts/fetch-images.ts.
//
//   Pexels    free key (PEXELS_API_KEY) — credit photographer + link to Pexels
//   Pixabay   free key (PIXABAY_API_KEY) — no hotlinking: download and host
//             ourselves; API responses are cached for 24 h
//   Openverse no key — openly licensed photos (Flickr, Wikimedia Commons …)
//   Wikimedia no key — Commons search (fallback when Openverse is unavailable)

import type { ImageCandidate, ImageSource } from '../../src/content/types';

export interface Found extends Omit<ImageCandidate, 'file'> {
  /** Stable id at the source, used for the file name. */
  id: string;
  /** Where to download the picture from. */
  download: string;
  /** Extra request headers for the download. */
  headers?: Record<string, string>;
}

export interface StockSource {
  id: ImageSource;
  search(query: string, n: number): Promise<Found[]>;
}

export const USER_AGENT = 'OkumaApp/2.0 (personal English reading app; https://github.com/uyar48/claude)';

/** Licenses that allow cropping and resizing (no "ND"). */
const ALLOWED_LICENSES = ['cc0', 'pdm', 'by', 'by-sa', 'by-nc', 'by-nc-sa'];

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** Fetch with polite retries on 429/5xx (honours Retry-After). */
export function politeFetch(
  base: Fetcher = fetch,
  opts: { gapMs?: number; tries?: number; timeoutMs?: number; maxWaitMs?: number } = {},
): Fetcher {
  const gap = opts.gapMs ?? 0;
  let last = 0;
  return async (url, init) => {
    let res: Response | null = null;
    for (let i = 0; i < (opts.tries ?? 4); i++) {
      const wait = last + gap - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      try {
        res = await base(url, {
          ...init,
          headers: { 'User-Agent': USER_AGENT, ...(init?.headers ?? {}) },
          signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
        });
      } catch (e) {
        // Timeout or network error: try again, then give up.
        if (i === (opts.tries ?? 4) - 1) throw e;
        await sleep(2000 * 2 ** i);
        continue;
      }
      if (res.ok || (res.status !== 429 && res.status < 500)) return res;
      const retry = Number(res.headers.get('retry-after'));
      const maxWait = opts.maxWaitMs ?? 30_000;
      await sleep(Math.min(maxWait, Number.isFinite(retry) && retry > 0 ? retry * 1000 : 2000 * 2 ** i));
    }
    return res!;
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return (await res.json()) as T;
}

// ---------- Pexels ----------

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  alt?: string;
  photographer: string;
  photographer_url: string;
  src: { original: string; large2x: string; large: string; medium: string };
}

export function pexels(apiKey: string, f: Fetcher = fetch): StockSource {
  return {
    id: 'pexels',
    async search(query, n) {
      const url = `https://api.pexels.com/v1/search?${new URLSearchParams({
        query,
        per_page: String(Math.max(n * 2, 10)),
        orientation: 'landscape',
        size: 'medium',
      })}`;
      const data = await json<{ photos: PexelsPhoto[] }>(await f(url, { headers: { Authorization: apiKey } }), 'Pexels');
      return data.photos.map((p) => ({
        id: String(p.id),
        source: 'pexels' as const,
        url: p.url,
        title: p.alt || undefined,
        author: p.photographer,
        authorUrl: p.photographer_url,
        license: 'Pexels License',
        licenseUrl: 'https://www.pexels.com/license/',
        width: p.width,
        height: p.height,
        download: p.src.large,
      }));
    },
  };
}

// ---------- Pixabay ----------

interface PixabayHit {
  id: number;
  pageURL: string;
  tags: string;
  webformatURL: string;
  largeImageURL: string;
  imageWidth: number;
  imageHeight: number;
  user: string;
  user_id: number;
}

export interface ResponseCache {
  get(key: string, maxAgeMs: number): unknown | null;
  set(key: string, value: unknown): void;
}

export const PIXABAY_CACHE_MS = 24 * 60 * 60 * 1000;

export function pixabay(apiKey: string, cache: ResponseCache, f: Fetcher = fetch): StockSource {
  return {
    id: 'pixabay',
    async search(query, n) {
      // Pixabay asks clients to cache API responses for 24 hours.
      const key = `pixabay:${query}`;
      let data = cache.get(key, PIXABAY_CACHE_MS) as { hits: PixabayHit[] } | null;
      if (!data) {
        const url = `https://pixabay.com/api/?${new URLSearchParams({
          key: apiKey,
          q: query,
          image_type: 'photo',
          orientation: 'horizontal',
          safesearch: 'true',
          per_page: String(Math.max(n * 2, 10)),
        })}`;
        data = await json<{ hits: PixabayHit[] }>(await f(url), 'Pixabay');
        cache.set(key, data);
      }
      return data.hits.map((h) => ({
        id: String(h.id),
        source: 'pixabay' as const,
        url: h.pageURL,
        title: h.tags,
        author: h.user,
        authorUrl: `https://pixabay.com/users/${encodeURIComponent(h.user)}-${h.user_id}/`,
        license: 'Pixabay Content License',
        licenseUrl: 'https://pixabay.com/service/license-summary/',
        width: h.imageWidth,
        height: h.imageHeight,
        download: h.largeImageURL,
      }));
    },
  };
}

// ---------- Openverse ----------

interface OpenverseImage {
  id: string;
  title: string | null;
  foreign_landing_url: string;
  creator: string | null;
  creator_url: string | null;
  license: string;
  license_version: string | null;
  license_url: string | null;
  provider: string;
  width: number | null;
  height: number | null;
  mature?: boolean;
}

export function licenseName(license: string, version?: string | null): string {
  const l = license.toLowerCase();
  if (l === 'cc0') return 'CC0 1.0';
  if (l === 'pdm') return 'Public Domain Mark';
  return `CC ${l.toUpperCase()}${version ? ` ${version}` : ''}`;
}

export function openverse(f: Fetcher = fetch): StockSource {
  return {
    id: 'openverse',
    async search(query, n) {
      const url = `https://api.openverse.org/v1/images/?${new URLSearchParams({
        q: query,
        page_size: String(Math.max(n * 4, 20)),
        category: 'photograph',
        license: ALLOWED_LICENSES.join(','),
        mature: 'false',
      })}`;
      const data = await json<{ results: OpenverseImage[] }>(await f(url), 'Openverse');
      return data.results
        .filter((r) => !r.mature && ALLOWED_LICENSES.includes(r.license.toLowerCase()))
        .map((r) => ({
          id: r.id,
          source: 'openverse' as const,
          url: r.foreign_landing_url,
          title: r.title ?? undefined,
          author: r.creator || 'bilinmiyor',
          authorUrl: r.creator_url ?? undefined,
          license: licenseName(r.license, r.license_version),
          licenseUrl: r.license_url ?? undefined,
          width: r.width ?? 0,
          height: r.height ?? 0,
          // Openverse's own image proxy (the original hosts rate-limit hard).
          download: `https://api.openverse.org/v1/images/${r.id}/thumb/?full_size=true&compressed=false`,
          provider: r.provider,
        }));
    },
  };
}

// ---------- Wikimedia Commons ----------

interface CommonsPage {
  pageid: number;
  title: string;
  imageinfo?: Array<{
    url: string;
    thumburl?: string;
    descriptionurl: string;
    width: number;
    height: number;
    mime: string;
    extmetadata?: Record<string, { value: string }>;
  }>;
}

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

export function wikimedia(f: Fetcher = fetch): StockSource {
  return {
    id: 'wikimedia',
    async search(query, n) {
      const url = `https://commons.wikimedia.org/w/api.php?${new URLSearchParams({
        action: 'query',
        format: 'json',
        generator: 'search',
        gsrsearch: `filetype:bitmap ${query}`,
        gsrnamespace: '6',
        gsrlimit: String(Math.max(n * 3, 15)),
        prop: 'imageinfo',
        iiprop: 'url|size|mime|extmetadata',
        iiurlwidth: '1024',
      })}`;
      const data = await json<{ query?: { pages: Record<string, CommonsPage> } }>(await f(url), 'Wikimedia');
      return Object.values(data.query?.pages ?? {}).flatMap((p): Found[] => {
        const info = p.imageinfo?.[0];
        if (!info || !/jpeg|png|webp/.test(info.mime)) return [];
        const meta = info.extmetadata ?? {};
        const short = (meta.LicenseShortName?.value ?? '').trim();
        if (!short || /ND|non-free|fair use/i.test(short)) return [];
        return [
          {
            id: String(p.pageid),
            source: 'wikimedia',
            url: info.descriptionurl,
            title: stripHtml(meta.ObjectName?.value ?? p.title.replace(/^File:/, '')),
            author: stripHtml(meta.Artist?.value ?? '') || 'bilinmiyor',
            license: short,
            licenseUrl: meta.LicenseUrl?.value,
            width: info.width,
            height: info.height,
            download: info.thumburl ?? info.url,
          },
        ];
      });
    },
  };
}

// ---------- ranking ----------

/**
 * Orders candidates: landscape-ish pictures big enough for 800×600 first, and
 * titles that mention the word. Source order (Pexels, Pixabay, …) is kept as
 * the main key by the caller.
 */
/** Titles that should never reach a learner's lesson. */
export const BLOCKED_TITLE =
  /\b(nude|naked|nsfw|sexy|erotic|lingerie|topless|bikini|porn|sex|fetish|grave|cemetery|funeral|corpse|dead|death|blood|gun|rifle|weapon|war|drunk|cigarette|smok\w*|drugs?|skull|kill\w*|protest|riot|crash|accident)\b/i;

export function score(c: Found, word: string): number {
  if (BLOCKED_TITLE.test(`${c.title ?? ''} ${c.url}`)) return -100;
  const ratio = c.width && c.height ? c.width / c.height : 4 / 3;
  let s = 0;
  if (ratio >= 1.1 && ratio <= 1.9) s += 2;
  else if (ratio < 0.9) s -= 2;
  if (c.width >= 800) s += 1;
  const title = (c.title ?? '').toLowerCase();
  if (new RegExp(`\\b${word}`).test(title)) s += 2;
  // Drawings, stamps, logos, maps … are rarely good word pictures.
  if (/\b(stamp|logo|map|diagram|drawing|illustration|poster|sign|text|cartoon|icon|painting)\b/.test(title)) s -= 3;
  return s;
}

/**
 * Up to n candidates: the sources take turns in priority order (best of
 * Pexels, best of Pixabay, second of Pexels …), so the default (first) comes
 * from the preferred source and the reviewer still sees variety.
 */
export function pickCandidates(lists: Found[][], word: string, n: number): Found[] {
  const ranked = lists.map((l) => [...l].filter((c) => score(c, word) >= 0).sort((a, b) => score(b, word) - score(a, word)));
  const out: Found[] = [];
  const seen = new Set<string>();
  for (let i = 0; out.length < n && ranked.some((l) => i < l.length); i++) {
    for (const list of ranked) {
      const c = list[i];
      if (!c || out.length >= n) continue;
      const k = `${c.source}:${c.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
  }
  return out;
}
