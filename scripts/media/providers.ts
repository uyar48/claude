// Provider adapters for the one-off media pipeline. Each adapter only knows how
// to turn a prompt/text into bytes; caching, hashing and the manifest live in
// generate-media.ts. Keys come from the environment, never from the code.

import sharp from 'sharp';
import type { WordTiming } from '../../src/content/types';
import { estimateTimings, timingsFromCharacters, timingsFromRecognized } from '../../src/core/timing';

export interface ImageProvider {
  id: string;
  model: string;
  /** Returns a 1200×900 WebP (or SVG for placeholders). */
  generate(prompt: string, word: string): Promise<{ data: Buffer; ext: 'webp' | 'svg' }>;
}

export interface SpeechResult {
  data: Buffer;
  ext: 'mp3' | 'wav';
  timings: WordTiming[] | null;
  timingSource?: 'provider' | 'alignment' | 'estimate';
  duration?: number;
}

export interface TtsProvider {
  id: string;
  model: string;
  voices: Record<'female' | 'male', string>;
  synthesize(text: string, voice: 'female' | 'male', withTimings: boolean): Promise<SpeechResult>;
}

// ---------- helpers ----------

export async function fetchRetry(url: string, init: RequestInit, tries = 4): Promise<Response> {
  let last: Response | null = null;
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, init);
    if (res.ok) return res;
    last = res;
    if (res.status !== 429 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 1500 * 2 ** i));
  }
  const body = last ? await last.text().catch(() => '') : '';
  throw new Error(`${url} → ${last?.status}: ${body.slice(0, 400)}`);
}

async function toWebp(input: Buffer): Promise<Buffer> {
  return sharp(input).resize(1200, 900, { fit: 'cover', position: 'attention' }).webp({ quality: 82 }).toBuffer();
}

// ---------- images ----------

/** Google Imagen 4 (Gemini API). Default model: Imagen 4 Ultra. */
export function googleImagen(apiKey: string, model = process.env.IMAGE_MODEL_GOOGLE || 'imagen-4.0-ultra-generate-001'): ImageProvider {
  return {
    id: 'google',
    model,
    async generate(prompt) {
      const res = await fetchRetry(`https://generativelanguage.googleapis.com/v1beta/models/${model}:predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: { sampleCount: 1, aspectRatio: '4:3', personGeneration: 'allow_adult' },
        }),
      });
      const json = (await res.json()) as { predictions?: Array<{ bytesBase64Encoded?: string }> };
      const b64 = json.predictions?.[0]?.bytesBase64Encoded;
      if (!b64) throw new Error(`Imagen returned no image (maybe filtered): ${JSON.stringify(json).slice(0, 300)}`);
      return { data: await toWebp(Buffer.from(b64, 'base64')), ext: 'webp' };
    },
  };
}

/** OpenAI GPT Image. 1536×1024 output is centre-cropped to 4:3. */
export function openaiImage(apiKey: string, model = process.env.IMAGE_MODEL_OPENAI || 'gpt-image-2'): ImageProvider {
  return {
    id: 'openai',
    model,
    async generate(prompt) {
      const res = await fetchRetry('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, prompt, n: 1, size: '1536x1024', quality: 'high' }),
      });
      const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
      const b64 = json.data?.[0]?.b64_json;
      if (!b64) throw new Error('OpenAI returned no image');
      return { data: await toWebp(Buffer.from(b64, 'base64')), ext: 'webp' };
    },
  };
}

/** No key: a flat colour card with the word (SVG, a few hundred bytes). */
export function placeholderImage(): ImageProvider {
  return {
    id: 'placeholder',
    model: 'flat-v1',
    async generate(_prompt, word) {
      let h = 0;
      for (const ch of word) h = (h * 31 + ch.charCodeAt(0)) % 360;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
<rect width="1200" height="900" fill="hsl(${h} 28% 42%)"/>
<text x="600" y="470" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-size="150"
 font-family="'Iowan Old Style', Georgia, serif">${word.replace(/[<&>]/g, '')}</text>
</svg>`;
      return { data: Buffer.from(svg), ext: 'svg' };
    },
  };
}

// ---------- speech ----------

const LEARNER_STYLE = 'Clear, calm, natural American English for a beginner learner. Moderate pace, no extra words.';

/** ElevenLabs (default Eleven v3) with character timestamps → word timings. */
export function elevenlabs(apiKey: string, model = process.env.TTS_MODEL_ELEVENLABS || 'eleven_v3'): TtsProvider {
  const voices = {
    // Premade American voices (Matilda, Eric); override with any voice ID.
    female: process.env.ELEVENLABS_VOICE_FEMALE || 'XrExE9yKIg1WjnnlVkGX',
    male: process.env.ELEVENLABS_VOICE_MALE || 'cjVigY5qzO86Huf0OWal',
  };
  return {
    id: 'elevenlabs',
    model,
    voices,
    async synthesize(text, voice) {
      const res = await fetchRetry(
        `https://api.elevenlabs.io/v1/text-to-speech/${voices[voice]}/with-timestamps?output_format=mp3_44100_128`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
          body: JSON.stringify({ text, model_id: model }),
        },
      );
      const json = (await res.json()) as {
        audio_base64: string;
        alignment?: { character_start_times_seconds: number[]; character_end_times_seconds: number[] };
      };
      const a = json.alignment;
      const timings = a ? timingsFromCharacters(text, a.character_start_times_seconds, a.character_end_times_seconds) : null;
      return {
        data: Buffer.from(json.audio_base64, 'base64'),
        ext: 'mp3',
        timings,
        timingSource: timings ? 'provider' : undefined,
        duration: a?.character_end_times_seconds.at(-1),
      };
    },
  };
}

/** OpenAI gpt-4o-mini-tts. No timestamps: forced alignment with speech-to-text, else estimate. */
export function openaiTts(apiKey: string, model = process.env.TTS_MODEL_OPENAI || 'gpt-4o-mini-tts'): TtsProvider {
  const voices = {
    female: process.env.OPENAI_VOICE_FEMALE || 'coral',
    male: process.env.OPENAI_VOICE_MALE || 'onyx',
  };
  return {
    id: 'openai',
    model,
    voices,
    async synthesize(text, voice, withTimings) {
      const res = await fetchRetry('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, voice: voices[voice], input: text, instructions: LEARNER_STYLE, response_format: 'mp3' }),
      });
      const data = Buffer.from(await res.arrayBuffer());
      if (!withTimings) return { data, ext: 'mp3', timings: null };
      try {
        const words = await openaiWordTimestamps(apiKey, data);
        return { data, ext: 'mp3', timings: timingsFromRecognized(text, words), timingSource: 'alignment', duration: words.at(-1)?.end };
      } catch (err) {
        console.warn(`  alignment failed (${(err as Error).message}); using estimate`);
        return { data, ext: 'mp3', timings: null };
      }
    },
  };
}

/** Speech-to-text with word timestamps, used as forced alignment. */
export async function openaiWordTimestamps(apiKey: string, mp3: Buffer) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(mp3)], { type: 'audio/mpeg' }), 'clip.mp3');
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('language', 'en');
  const res = await fetchRetry('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const json = (await res.json()) as { words?: Array<{ word: string; start: number; end: number }> };
  if (!json.words?.length) throw new Error('no words');
  return json.words;
}

/** Google Gemini TTS (generative voices). Returns 24 kHz PCM, wrapped as WAV. */
export function googleTts(apiKey: string, model = process.env.TTS_MODEL_GOOGLE || 'gemini-2.5-flash-preview-tts'): TtsProvider {
  const voices = {
    female: process.env.GOOGLE_VOICE_FEMALE || 'Kore',
    male: process.env.GOOGLE_VOICE_MALE || 'Charon',
  };
  return {
    id: 'google',
    model,
    voices,
    async synthesize(text, voice) {
      const res = await fetchRetry(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Say clearly and calmly in American English: ${text}` }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voices[voice] } } },
          },
        }),
      });
      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data: string; mimeType: string } }> } }>;
      };
      const inline = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
      if (!inline) throw new Error('Gemini TTS returned no audio');
      const rate = Number(/rate=(\d+)/.exec(inline.mimeType)?.[1] ?? 24000);
      const pcm = Buffer.from(inline.data, 'base64');
      return { data: wav(pcm, rate), ext: 'wav', timings: null, duration: pcm.length / 2 / rate };
    },
  };
}

function wav(pcm: Buffer, rate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Fills in estimated timings when a provider gave none (last resort). */
export function ensureTimings(text: string, r: SpeechResult): SpeechResult {
  if (r.timings?.length) return r;
  if (!r.duration) return r;
  return { ...r, timings: estimateTimings(text, r.duration), timingSource: 'estimate' };
}

// ---------- selection from env ----------

export type ImageProviderId = 'google' | 'openai' | 'placeholder';
export type TtsProviderId = 'elevenlabs' | 'openai' | 'google' | 'browser';

const env = (k: string) => process.env[k]?.trim() || undefined;

export function imageKey(id: ImageProviderId): string | undefined {
  return env(`IMAGE_API_KEY_${id.toUpperCase()}`) ?? env('IMAGE_API_KEY');
}
export function ttsKey(id: TtsProviderId): string | undefined {
  return env(`TTS_API_KEY_${id.toUpperCase()}`) ?? env('TTS_API_KEY');
}

export function makeImageProvider(id: ImageProviderId): ImageProvider | null {
  if (id === 'placeholder') return placeholderImage();
  const key = imageKey(id);
  if (!key) return null;
  return id === 'google' ? googleImagen(key) : openaiImage(key);
}

export function makeTtsProvider(id: TtsProviderId): TtsProvider | null {
  if (id === 'browser') return null;
  const key = ttsKey(id);
  if (!key) return null;
  if (id === 'elevenlabs') return elevenlabs(key);
  if (id === 'openai') return openaiTts(key);
  return googleTts(key);
}
