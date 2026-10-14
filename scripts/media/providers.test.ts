// Adapter request/response handling with a stubbed fetch (no network, no keys).
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { elevenlabs, googleImagen, googleTts, makeImageProvider, makeTtsProvider, openaiImage, openaiTts, placeholderImage } from './providers';

type Call = { url: string; init: RequestInit };

function stubFetch(responses: Array<(call: Call) => Response>) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch');
    return next(call);
  });
  return calls;
}

const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });

async function png(w: number, h: number) {
  return sharp({ create: { width: w, height: h, channels: 3, background: '#888' } }).png().toBuffer();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('image adapters', () => {
  it('Imagen: 4:3 request with the key in a header, WebP 1200×900 out', async () => {
    const img = (await png(1408, 1056)).toString('base64');
    const calls = stubFetch([() => json({ predictions: [{ bytesBase64Encoded: img, mimeType: 'image/png' }] })]);
    const out = await googleImagen('KEY').generate('a cup of coffee', 'coffee');
    expect(calls[0].url).toContain('imagen-4.0-ultra-generate-001:predict');
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('KEY');
    expect(JSON.parse(String(calls[0].init.body)).parameters.aspectRatio).toBe('4:3');
    const meta = await sharp(out.data).metadata();
    expect([out.ext, meta.format, meta.width, meta.height]).toEqual(['webp', 'webp', 1200, 900]);
  });

  it('GPT Image: bearer auth, landscape output cropped to 4:3', async () => {
    const img = (await png(1536, 1024)).toString('base64');
    const calls = stubFetch([() => json({ data: [{ b64_json: img }] })]);
    const out = await openaiImage('KEY').generate('a key', 'key');
    expect(calls[0].url).toBe('https://api.openai.com/v1/images/generations');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer KEY');
    const meta = await sharp(out.data).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 900]);
  });

  it('retries on 429 and reports filtered results clearly', async () => {
    stubFetch([() => new Response('slow down', { status: 429 }), () => json({ predictions: [] })]);
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const p = googleImagen('KEY').generate('x', 'x');
    const assertion = expect(p).rejects.toThrow(/no image/);
    await vi.runAllTimersAsync();
    await assertion;
    vi.useRealTimers();
  });

  it('placeholder: plain colour + word, no network', async () => {
    const out = await placeholderImage().generate('', 'coffee');
    expect(out.ext).toBe('svg');
    expect(out.data.toString()).toContain('>coffee</text>');
  });

  it('provider selection follows the env keys', () => {
    expect(makeImageProvider('google')).toBeNull();
    vi.stubEnv('IMAGE_API_KEY', 'k');
    expect(makeImageProvider('google')?.id).toBe('google');
    vi.stubEnv('IMAGE_API_KEY_OPENAI', 'k2');
    expect(makeImageProvider('openai')?.model).toBe('gpt-image-2');
    expect(makeTtsProvider('browser')).toBeNull();
  });
});

describe('speech adapters', () => {
  it('ElevenLabs: timestamps endpoint, character alignment → word timings', async () => {
    const text = 'I am home.';
    const starts = [...text].map((_, i) => i * 0.1);
    const calls = stubFetch([
      () =>
        json({
          audio_base64: Buffer.from('mp3').toString('base64'),
          alignment: {
            characters: [...text],
            character_start_times_seconds: starts,
            character_end_times_seconds: starts.map((s) => s + 0.1),
          },
        }),
    ]);
    const r = await elevenlabs('KEY').synthesize(text, 'male', true);
    expect(calls[0].url).toContain('/with-timestamps');
    expect(JSON.parse(String(calls[0].init.body)).model_id).toBe('eleven_v3');
    expect(r.timingSource).toBe('provider');
    expect(r.timings?.map((t) => t.i)).toEqual([0, 1, 2]);
  });

  it('OpenAI TTS: speech then word-timestamp alignment', async () => {
    const calls = stubFetch([
      () => new Response(Buffer.from('mp3-bytes')),
      () => json({ words: [{ word: 'I', start: 0, end: 0.2 }, { word: 'go', start: 0.3, end: 0.5 }] }),
    ]);
    const r = await openaiTts('KEY').synthesize('I go.', 'female', true);
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ model: 'gpt-4o-mini-tts', voice: 'coral' });
    expect(calls[1].url).toContain('/audio/transcriptions');
    expect(r.timingSource).toBe('alignment');
    expect(r.timings).toEqual([
      { i: 0, start: 0, end: 0.2 },
      { i: 1, start: 0.3, end: 0.5 },
    ]);
  });

  it('Gemini TTS: PCM wrapped as a valid WAV', async () => {
    const pcm = Buffer.alloc(48000); // 1 s at 24 kHz, 16-bit mono
    stubFetch([
      () => json({ candidates: [{ content: { parts: [{ inlineData: { data: pcm.toString('base64'), mimeType: 'audio/L16;codec=pcm;rate=24000' } }] } }] }),
    ]);
    const r = await googleTts('KEY').synthesize('Good morning.', 'female', true);
    expect(r.ext).toBe('wav');
    expect(r.data.subarray(0, 4).toString()).toBe('RIFF');
    expect(r.data.readUInt32LE(24)).toBe(24000);
    expect(r.duration).toBeCloseTo(1);
  });
});
