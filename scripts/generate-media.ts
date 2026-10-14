// One-off media generation (never runs inside the app).
//
//   npm run media                       # everything that is missing
//   npm run media -- --compare-images google,openai --words 10
//   npm run media -- --compare-tts elevenlabs,openai,google --words 3
//   npm run media -- --only images|audio  --force  --dry-run
//
// Providers: IMAGE_PROVIDER=google|openai|placeholder, TTS_PROVIDER=elevenlabs|openai|google|browser
// Keys:      IMAGE_API_KEY / TTS_API_KEY (or IMAGE_API_KEY_GOOGLE, TTS_API_KEY_OPENAI …)
// Review:    content/media-review.json (exported from /admin/review) keeps approved files
//            and regenerates the ones marked "Yeniden üret".
//
// Every output is stored under its content hash, so the same input is never
// generated twice. Without keys the app keeps working: placeholder pictures and
// the browser's own voice.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { AudioAsset, ImageAsset, MediaManifest, UnitContent, Voice } from '../src/content/types';
import { exampleAudioKey, sentenceAudioKey, wordAudioKey } from '../src/content/types';
import {
  ensureTimings,
  imageKey,
  makeImageProvider,
  makeTtsProvider,
  ttsKey,
  type ImageProvider,
  type ImageProviderId,
  type TtsProvider,
  type TtsProviderId,
} from './media/providers';

const ROOT = process.cwd();
const CONTENT = path.join(ROOT, 'content/level0/unit1.json');
const MANIFEST = path.join(ROOT, 'src/content/media-manifest.json');
const REVIEW = path.join(ROOT, 'content/media-review.json');
const IMG_DIR = path.join(ROOT, 'public/media/images');
const AUDIO_DIR = path.join(ROOT, 'public/media/audio');

interface Review {
  imageProvider?: string | null;
  ttsProvider?: string | null;
  approved?: { images?: string[]; audio?: string[] };
  regenerate?: { images?: string[]; audio?: string[] };
}

const { values: args } = parseArgs({
  options: {
    only: { type: 'string' },
    force: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    'compare-images': { type: 'string' },
    'compare-tts': { type: 'string' },
    words: { type: 'string' },
    /** Column name for a comparison run, e.g. "v3 · Matilda/Eric" (default: provider id). */
    label: { type: 'string' },
    review: { type: 'string' },
  },
});

const unit = JSON.parse(fs.readFileSync(CONTENT, 'utf8')) as UnitContent;
const manifest: MediaManifest = fs.existsSync(MANIFEST)
  ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
  : { images: {}, audio: {} };
manifest.images ??= {};
manifest.audio ??= {};
const review: Review = readReview();
const dry = args['dry-run'];

function readReview(): Review {
  const raw = args.review ?? (fs.existsSync(REVIEW) ? fs.readFileSync(REVIEW, 'utf8') : '');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as Review;
  } catch {
    throw new Error('media-review JSON could not be parsed');
  }
}

const hash = (parts: unknown) => crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 20);

/** Words in teaching order (day, then file order). */
const orderedWords = unit.words.map((w, i) => ({ w, i })).sort((a, b) => a.w.day - b.w.day || a.i - b.i).map((x) => x.w);

function imagePrompt(wordId: string): string {
  const w = unit.words.find((x) => x.id === wordId)!;
  return `${w.imagePrompt} ${unit.unit.imageStyle}`;
}

// ---------- images ----------

async function makeImage(p: ImageProvider, wordId: string, variant: number): Promise<ImageAsset> {
  const prompt = imagePrompt(wordId);
  const h = hash({ kind: 'image', provider: p.id, model: p.model, prompt, variant });
  const existing = ['webp', 'svg'].map((ext) => `${h}.${ext}`).find((f) => fs.existsSync(path.join(IMG_DIR, f)));
  const base = { provider: p.id, model: p.model, hash: h, placeholder: p.id === 'placeholder' || undefined, variant: variant || undefined };
  if (existing) return { file: existing, ...base };
  if (dry) return { file: `${h}.(dry)`, ...base };
  const word = unit.words.find((x) => x.id === wordId)!.en;
  console.log(`  image ${wordId} ← ${p.id}/${p.model}`);
  const out = await p.generate(prompt, word);
  const file = `${h}.${out.ext}`;
  fs.writeFileSync(path.join(IMG_DIR, file), out.data);
  return { file, ...base };
}

async function images(missing: Set<string>) {
  const chosen = (process.env.IMAGE_PROVIDER || review.imageProvider || 'google') as ImageProviderId;
  let p = makeImageProvider(chosen);
  if (!p) {
    missing.add(chosen === 'google' || chosen === 'openai' ? 'IMAGE_API_KEY' : `IMAGE_PROVIDER=${chosen}`);
    console.warn(`! IMAGE_API_KEY yok (${chosen}) → yer tutucu görseller (düz renk + kelime).`);
    p = makeImageProvider('placeholder')!;
  }
  manifest.imageProvider = p.id;
  const approved = new Set(review.approved?.images ?? []);
  const regen = new Set(review.regenerate?.images ?? []);
  for (const w of orderedWords) {
    const cur = manifest.images[w.id];
    if (cur && approved.has(w.id) && !cur.placeholder) continue; // keep what the user approved
    if (cur && !cur.placeholder && p.id === 'placeholder' && !regen.has(w.id)) continue; // never downgrade
    let variant = cur?.variant ?? 0;
    if (regen.has(w.id) || (args.force && cur?.provider === p.id)) variant++;
    try {
      manifest.images[w.id] = await makeImage(p, w.id, variant);
    } catch (err) {
      console.error(`  ✗ image ${w.id}: ${(err as Error).message}`);
    }
  }
}

async function compareImages(ids: ImageProviderId[], n: number, missing: Set<string>) {
  manifest.compare ??= {};
  manifest.compare.images ??= {};
  for (const id of ids) {
    const p = makeImageProvider(id);
    if (!p) {
      missing.add(`IMAGE_API_KEY_${id.toUpperCase()}`);
      console.warn(`! ${id}: anahtar yok (IMAGE_API_KEY_${id.toUpperCase()} veya IMAGE_API_KEY), atlandı.`);
      continue;
    }
    for (const w of orderedWords.slice(0, n)) {
      try {
        (manifest.compare.images[w.id] ??= {})[id] = await makeImage(p, w.id, 0);
      } catch (err) {
        console.error(`  ✗ ${id} ${w.id}: ${(err as Error).message}`);
      }
    }
  }
}

// ---------- audio ----------

interface Clip {
  key: string;
  text: string;
  voice: Voice;
  timings: boolean;
}

function clips(): Clip[] {
  const out: Clip[] = [];
  for (const w of orderedWords) {
    for (const v of ['female', 'male'] as const) out.push({ key: wordAudioKey(w.id, v), text: w.en, voice: v, timings: false });
    out.push({ key: exampleAudioKey(w.id), text: w.example, voice: 'female', timings: false });
  }
  for (const t of unit.texts) {
    t.sentences.forEach((s, i) => out.push({ key: sentenceAudioKey(t.id, i), text: s.en, voice: t.voice, timings: true }));
  }
  return out;
}

async function makeClip(p: TtsProvider, c: Clip, variant: number): Promise<AudioAsset> {
  const h = hash({ kind: 'audio', provider: p.id, model: p.model, voice: p.voices[c.voice], text: c.text, variant });
  const base = { provider: p.id, model: p.model, voice: p.voices[c.voice], hash: h, variant: variant || undefined };
  const metaFile = path.join(AUDIO_DIR, `${h}.json`);
  for (const ext of ['mp3', 'wav']) {
    if (fs.existsSync(path.join(AUDIO_DIR, `${h}.${ext}`))) {
      const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
      return { file: `${h}.${ext}`, ...base, ...meta };
    }
  }
  if (dry) return { file: `${h}.(dry)`, ...base };
  console.log(`  audio ${c.key} ← ${p.id}/${p.voices[c.voice]}`);
  let r = await p.synthesize(c.text, c.voice, c.timings);
  if (c.timings) r = ensureTimings(c.text, r);
  const file = `${h}.${r.ext}`;
  fs.writeFileSync(path.join(AUDIO_DIR, file), r.data);
  const meta = { duration: r.duration, timings: c.timings ? r.timings ?? undefined : undefined, timingSource: c.timings ? r.timingSource : undefined };
  fs.writeFileSync(metaFile, JSON.stringify(meta));
  return { file, ...base, ...meta };
}

async function audio(missing: Set<string>) {
  const chosen = (process.env.TTS_PROVIDER || review.ttsProvider || 'elevenlabs') as TtsProviderId;
  const p = makeTtsProvider(chosen);
  if (!p) {
    if (chosen !== 'browser') {
      missing.add('TTS_API_KEY');
      console.warn(`! TTS_API_KEY yok (${chosen}) → uygulama tarayıcının sesini (speechSynthesis) kullanır.`);
    }
    return;
  }
  manifest.ttsProvider = p.id;
  const approved = new Set(review.approved?.audio ?? []);
  const regen = new Set(review.regenerate?.audio ?? []);
  for (const c of clips()) {
    const cur = manifest.audio[c.key];
    if (cur && approved.has(c.key)) continue;
    let variant = cur?.variant ?? 0;
    if (regen.has(c.key) || (args.force && cur?.provider === p.id)) variant++;
    try {
      manifest.audio[c.key] = await makeClip(p, c, variant);
    } catch (err) {
      console.error(`  ✗ audio ${c.key}: ${(err as Error).message}`);
    }
  }
}

async function compareTts(ids: TtsProviderId[], n: number, missing: Set<string>) {
  manifest.compare ??= {};
  manifest.compare.audio ??= {};
  const samples: Clip[] = [];
  for (const w of orderedWords.slice(0, n)) {
    for (const v of ['female', 'male'] as const) samples.push({ key: wordAudioKey(w.id, v), text: w.en, voice: v, timings: false });
  }
  // One sentence per voice, read with timings like in the lesson.
  for (const voice of ['female', 'male'] as const) {
    const t = unit.texts.find((x) => x.voice === voice);
    if (t) samples.push({ key: sentenceAudioKey(t.id, 0), text: t.sentences[0].en, voice, timings: true });
  }
  for (const id of ids) {
    const p = makeTtsProvider(id);
    if (!p) {
      missing.add(`TTS_API_KEY_${id.toUpperCase()}`);
      console.warn(`! ${id}: anahtar yok (TTS_API_KEY_${id.toUpperCase()} veya TTS_API_KEY), atlandı.`);
      continue;
    }
    for (const c of samples) {
      try {
        (manifest.compare.audio[c.key] ??= {})[args.label ?? id] = await makeClip(p, c, 0);
      } catch (err) {
        console.error(`  ✗ ${id} ${c.key}: ${(err as Error).message}`);
      }
    }
  }
}

// ---------- main ----------

async function main() {
  fs.mkdirSync(IMG_DIR, { recursive: true });
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  const missing = new Set<string>();
  const n = Number(args.words ?? 10);

  if (args['compare-images']) {
    await compareImages(args['compare-images'].split(',').map((s) => s.trim()) as ImageProviderId[], n, missing);
  }
  if (args['compare-tts']) {
    await compareTts(args['compare-tts'].split(',').map((s) => s.trim()) as TtsProviderId[], Number(args.words ?? 3), missing);
  }
  if (!args['compare-images'] && !args['compare-tts']) {
    if (args.only !== 'audio') await images(missing);
    if (args.only !== 'images') await audio(missing);
  }

  // Report missing keys only for the main providers (comparison runs are optional).
  manifest.missingKeys = [...missing].filter((k) => k === 'IMAGE_API_KEY' || k === 'TTS_API_KEY');
  if (!imageKey('google') && !imageKey('openai') && !manifest.missingKeys.includes('IMAGE_API_KEY')) {
    if (Object.values(manifest.images).some((i) => i.placeholder)) manifest.missingKeys.push('IMAGE_API_KEY');
  }
  if (!ttsKey('elevenlabs') && !ttsKey('openai') && !ttsKey('google') && Object.keys(manifest.audio).length === 0) {
    if (!manifest.missingKeys.includes('TTS_API_KEY')) manifest.missingKeys.push('TTS_API_KEY');
  }
  manifest.generatedAt = new Date().toISOString();

  if (dry) {
    console.log(JSON.stringify(manifest, null, 2).slice(0, 2000));
    return;
  }
  fs.writeFileSync(MANIFEST, JSON.stringify(sortKeys(manifest), null, 2) + '\n');
  const imgs = Object.values(manifest.images);
  console.log(
    `\n✓ ${imgs.length} görsel (${imgs.filter((i) => i.placeholder).length} yer tutucu), ${Object.keys(manifest.audio).length} ses klibi.`,
  );
  if (manifest.missingKeys.length) console.log(`  Eksik anahtar: ${manifest.missingKeys.join(', ')}`);
}

function sortKeys<T>(v: T): T {
  if (Array.isArray(v)) return v.map(sortKeys) as T;
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, sortKeys(x)]),
    ) as T;
  }
  return v;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
