import { describe, expect, it } from 'vitest';
import { licenseName, openverse, pexels, pickCandidates, pixabay, score, type Found, type ResponseCache } from './stock';

const found = (over: Partial<Found>): Found => ({
  id: 'x',
  source: 'openverse',
  url: 'https://example.org/p',
  title: 'cup of tea',
  author: 'A',
  license: 'CC BY 2.0',
  width: 1024,
  height: 768,
  download: 'https://example.org/x.jpg',
  ...over,
});

const reply = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 });

describe('stock photo sources', () => {
  it('Pexels: photographer credit, Pexels license, landscape search with the key header', async () => {
    let seen: RequestInit | undefined;
    let url = '';
    const src = pexels('KEY', async (u, init) => {
      url = u;
      seen = init;
      return reply({
        photos: [
          {
            id: 7,
            width: 4000,
            height: 3000,
            url: 'https://www.pexels.com/photo/7/',
            alt: 'Cup of tea',
            photographer: 'Ana Lima',
            photographer_url: 'https://www.pexels.com/@ana',
            src: { original: 'o', large2x: 'l2', large: 'https://images.pexels.com/7-large.jpg', medium: 'm' },
          },
        ],
      })();
    });
    const [p] = await src.search('cup of tea', 5);
    expect((seen?.headers as Record<string, string>).Authorization).toBe('KEY');
    expect(url).toContain('orientation=landscape');
    expect(p).toMatchObject({ source: 'pexels', author: 'Ana Lima', license: 'Pexels License', download: 'https://images.pexels.com/7-large.jpg' });
  });

  it('Pixabay: API answers are cached for 24 hours', async () => {
    const store = new Map<string, unknown>();
    const cache: ResponseCache = { get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) };
    let calls = 0;
    const f = async () => {
      calls++;
      return reply({
        hits: [
          { id: 1, pageURL: 'https://pixabay.com/p-1/', tags: 'tea, cup', webformatURL: 'w', largeImageURL: 'L', imageWidth: 1280, imageHeight: 853, user: 'bob', user_id: 9 },
        ],
      })();
    };
    const src = pixabay('KEY', cache, f);
    await src.search('tea', 5);
    const [hit] = await src.search('tea', 5);
    expect(calls).toBe(1);
    expect(hit).toMatchObject({ source: 'pixabay', author: 'bob', download: 'L' });
  });

  it('Openverse: no ND licenses, mature results dropped, downloads through the Openverse proxy', async () => {
    const src = openverse(
      reply({
        results: [
          { id: 'a1', title: 'Tea', foreign_landing_url: 'https://flickr.com/1', creator: 'C', creator_url: null, license: 'by-sa', license_version: '2.0', license_url: 'https://cc/by-sa', provider: 'flickr', width: 1024, height: 700 },
          { id: 'a2', title: 'Tea', foreign_landing_url: 'https://flickr.com/2', creator: 'D', creator_url: null, license: 'by-nd', license_version: '2.0', license_url: null, provider: 'flickr', width: 1024, height: 700 },
          { id: 'a3', title: 'Tea', foreign_landing_url: 'https://flickr.com/3', creator: 'E', creator_url: null, license: 'by', license_version: '2.0', license_url: null, provider: 'flickr', width: 1024, height: 700, mature: true },
        ],
      }),
    );
    const out = await src.search('tea', 5);
    expect(out.map((o) => o.id)).toEqual(['a1']);
    expect(out[0].license).toBe('CC BY-SA 2.0');
    expect(out[0].download).toBe('https://api.openverse.org/v1/images/a1/thumb/?full_size=true&compressed=false');
    expect(licenseName('cc0')).toBe('CC0 1.0');
  });
});

describe('choosing candidates', () => {
  it('drops unsuitable titles and prefers landscape photos that name the word', () => {
    expect(score(found({ title: 'nude and a cup of tea' }), 'tea')).toBeLessThan(0);
    expect(score(found({ title: 'Cup o’ tea at the grave' }), 'tea')).toBeLessThan(0);
    expect(score(found({ title: 'Tea stamp set' }), 'tea')).toBeLessThan(score(found({ title: 'Tea' }), 'tea'));
    expect(score(found({ width: 600, height: 900 }), 'tea')).toBeLessThan(score(found({}), 'tea'));
  });

  it('sources take turns in priority order and duplicates are skipped', () => {
    const px = [found({ id: 'p1', source: 'pexels' }), found({ id: 'p2', source: 'pexels' }), found({ id: 'p3', source: 'pexels' })];
    const pb = [found({ id: 'b1', source: 'pixabay' }), found({ id: 'b1', source: 'pixabay' })];
    const out = pickCandidates([px, pb], 'tea', 5);
    expect(out.map((c) => c.id)).toEqual(['p1', 'b1', 'p2', 'p3']);
    expect(pickCandidates([px], 'tea', 2)).toHaveLength(2);
  });
});

describe('AI pictures', () => {
  it('are never candidates', () => {
    expect(score(found({ title: 'a loaf of bread on a café terrace - fusion style-tpz ai hd' }), 'bread')).toBeLessThan(0);
    expect(score(found({ title: 'Bread, Midjourney render' }), 'bread')).toBeLessThan(0);
  });
});

describe('loose matches in open collections', () => {
  it('need the word or a search word in the title', () => {
    expect(score(found({ source: 'wikimedia', title: 'Carina Nebula' }), 'car')).toBeLessThan(0);
    expect(score(found({ source: 'openverse', title: 'Portrait of a lady' }), 'woman', 'woman portrait')).toBeGreaterThanOrEqual(0);
    // Pexels/Pixabay results are tagged by people: no title rule.
    expect(score(found({ source: 'pexels', title: 'Sunset drive' }), 'car')).toBeGreaterThanOrEqual(0);
  });
});
