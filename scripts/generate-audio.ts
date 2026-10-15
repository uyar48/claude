// Speech for the course with Kokoro-82M (Apache 2.0), run locally — no key,
// no paid service:
//
//   npm run generate-audio                    everything that is missing
//   npm run generate-audio -- --only words    words | texts | sentences
//   npm run generate-audio -- --limit 50      at most 50 new clips
//
// Clips (MP3, mono, 48 kb/s) go to public/media/audio/<hash>.mp3 and into
// src/content/media-manifest.json under the keys the app looks up:
//   word:<id>:female        the word on its own
//   sent:<textId>:<i>       sentence i of a reading text (the text's voice)
//   s:<sentenceId>          a course sentence (Tatoeba or own)
// A clip is only made again when its text or voice changes (content hash).
// Clips made earlier by another engine are kept while their text is the same.
// Without a clip the app reads with the device's voice (speechSynthesis).

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { Course } from '../src/content/courseTypes';
import type { AudioAsset, MediaManifest } from '../src/content/types';

const ROOT = path.resolve(import.meta.dirname, '..');
const MANIFEST = path.join(ROOT, 'src/content/media-manifest.json');
const COURSE = path.join(ROOT, 'content/build/course.json');
const AUDIO_DIR = path.join(ROOT, 'public/media/audio');

export const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const VOICES = { female: 'af_heart', male: 'am_michael' } as const;

export interface Clip {
  key: string;
  text: string;
  voice: 'female' | 'male';
}

export function clipsFor(course: Course): Clip[] {
  const out: Clip[] = [];
  for (const id of course.order) out.push({ key: `word:${id}:female`, text: course.words[id].en, voice: 'female' });
  for (const t of course.texts) t.sentences.forEach((s, i) => out.push({ key: `sent:${t.id}:${i}`, text: s.en, voice: t.voice }));
  // Course sentences alternate voices so listening is not always the same speaker.
  for (const s of course.sentences) {
    const voice = parseInt(crypto.createHash('md5').update(s.id).digest('hex').slice(0, 2), 16) % 2 ? 'male' : 'female';
    out.push({ key: `s:${s.id}`, text: s.en, voice });
  }
  return out;
}

const hash = (parts: unknown) => crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 20);

export function kokoroHash(c: Clip, dtype: string): string {
  return hash({ kind: 'audio', provider: 'kokoro', model: MODEL, dtype, voice: VOICES[c.voice], text: c.text });
}

/** True when an existing clip (any engine) was made from exactly this text. */
export function stillValid(a: AudioAsset, c: Clip, dtype: string): boolean {
  if (a.provider === 'kokoro') return a.hash === kokoroHash(c, dtype);
  // Same formula generate-media (v1) used.
  return a.hash === hash({ kind: 'audio', provider: a.provider, model: a.model, voice: a.voice, text: c.text, variant: a.variant ?? 0 });
}

function toMp3(samples: Float32Array, rate: number, dest: string) {
  const tmp = path.join(os.tmpdir(), `kokoro-${process.pid}.f32`);
  fs.writeFileSync(tmp, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(rate), '-ac', '1', '-i', tmp, '-ac', '1', '-b:a', '48k', dest]);
  fs.unlinkSync(tmp);
}

function sortKeys<T>(o: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}

async function main() {
  const { values } = parseArgs({
    options: {
      only: { type: 'string' },
      limit: { type: 'string' },
      dtype: { type: 'string', default: 'q8' },
      keep: { type: 'boolean', default: false },
    },
  });
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    console.error('ffmpeg bulunamadı. Kur: sudo apt install ffmpeg (macOS: brew install ffmpeg).');
    process.exit(1);
  }
  const dtype = values.dtype!;
  const course = JSON.parse(fs.readFileSync(COURSE, 'utf8')) as Course;
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) as MediaManifest;
  manifest.audio ??= {};
  fs.mkdirSync(AUDIO_DIR, { recursive: true });

  const all = clipsFor(course);
  const prefix = { words: 'word:', texts: 'sent:', sentences: 's:' }[values.only ?? ''] ?? '';
  const wanted = all.filter((c) => c.key.startsWith(prefix));
  const todo = wanted.filter((c) => {
    const cur = manifest.audio[c.key];
    return !(cur && fs.existsSync(path.join(AUDIO_DIR, cur.file)) && stillValid(cur, c, dtype));
  });
  const limit = values.limit ? Number(values.limit) : Infinity;
  console.log(`${wanted.length} clips wanted, ${todo.length} to make${Number.isFinite(limit) ? ` (limit ${limit})` : ''}.`);

  if (todo.length) {
    const { KokoroTTS } = await import('kokoro-js');
    const tts = await KokoroTTS.from_pretrained(MODEL, { dtype: dtype as 'q8', device: 'cpu' });
    let made = 0;
    const t0 = Date.now();
    for (const c of todo.slice(0, limit)) {
      const h = kokoroHash(c, dtype);
      const file = `${h}.mp3`;
      const dest = path.join(AUDIO_DIR, file);
      const audio = await tts.generate(c.text, { voice: VOICES[c.voice] });
      const duration = audio.audio.length / audio.sampling_rate;
      if (!fs.existsSync(dest)) toMp3(audio.audio, audio.sampling_rate, dest);
      manifest.audio[c.key] = {
        file,
        provider: 'kokoro',
        model: `Kokoro-82M (${dtype})`,
        voice: VOICES[c.voice],
        hash: h,
        duration: Math.round(duration * 100) / 100,
        // No word timings from Kokoro: the app estimates them from the duration.
      };
      made++;
      if (made % 25 === 0) {
        save(manifest);
        const per = (Date.now() - t0) / made;
        console.log(`${made} / ${Math.min(todo.length, limit)} · ~${Math.round((per * (Math.min(todo.length, limit) - made)) / 60000)} min left`);
      }
    }
    console.log(`${made} clips made.`);
  }

  // Drop clips the course no longer uses (e.g. v1 example sentences).
  if (!values.keep && !prefix) {
    const keys = new Set(all.map((c) => c.key));
    for (const k of Object.keys(manifest.audio)) if (!keys.has(k)) delete manifest.audio[k];
    const used = new Set(Object.values(manifest.audio).map((a) => a.file));
    for (const f of fs.readdirSync(AUDIO_DIR)) if (!used.has(f)) fs.unlinkSync(path.join(AUDIO_DIR, f));
  }
  save(manifest);
}

function save(manifest: MediaManifest) {
  // Estimated timings are recomputed by the app; only real ones are stored.
  for (const a of Object.values(manifest.audio)) {
    if (a.timingSource === 'estimate') {
      delete a.timings;
      delete a.timingSource;
    }
  }
  const out: MediaManifest = {
    generatedAt: new Date().toISOString(),
    ttsProvider: 'kokoro',
    audio: sortKeys(manifest.audio),
  };
  fs.writeFileSync(MANIFEST, JSON.stringify(out, null, 2) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
