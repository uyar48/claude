import type { LessonPlan } from '../core/lesson';
import { content, getText, media } from './index';
import { exampleAudioKey, sentenceAudioKey, wordAudioKey, type AudioAsset, type ImageAsset, type Voice } from './types';

export const IMAGE_BASE = '/media/images/';
export const AUDIO_BASE = '/media/audio/';

export function imageFor(wordId: string): (ImageAsset & { url: string }) | null {
  const a = media.images[wordId];
  return a ? { ...a, url: IMAGE_BASE + a.file } : null;
}

export function wordAudio(wordId: string, voice: Voice = 'female'): (AudioAsset & { url: string }) | null {
  const a = media.audio[wordAudioKey(wordId, voice)] ?? media.audio[wordAudioKey(wordId, voice === 'female' ? 'male' : 'female')];
  return a ? { ...a, url: AUDIO_BASE + a.file } : null;
}

export function sentenceAudio(textId: string, index: number): (AudioAsset & { url: string }) | null {
  const a = media.audio[sentenceAudioKey(textId, index)];
  return a ? { ...a, url: AUDIO_BASE + a.file } : null;
}

export function exampleAudio(wordId: string): (AudioAsset & { url: string }) | null {
  const a = media.audio[exampleAudioKey(wordId)];
  return a ? { ...a, url: AUDIO_BASE + a.file } : null;
}

/** Every media URL a lesson needs, for offline caching. */
export function lessonMediaUrls(plan: LessonPlan): string[] {
  const urls = new Set<string>();
  const words = new Set([...plan.reviewWordIds, ...plan.newWordIds]);
  for (const textId of [plan.textId, ...plan.extraTextIds]) {
    if (!textId) continue;
    const t = getText(textId);
    t.sentences.forEach((_, i) => {
      const a = sentenceAudio(textId, i);
      if (a) urls.add(a.url);
    });
    for (const q of t.questions) for (const o of q.options) if (o.image) words.add(o.image);
    // Tap-to-read can open any unit word that occurs in the text.
    const forms = new Set(t.sentences.flatMap((s) => s.en.toLowerCase().match(/[a-z]+/g) ?? []));
    for (const w of content.words) if (forms.has(w.en)) words.add(w.id);
  }
  for (const id of words) {
    const img = imageFor(id);
    if (img) urls.add(img.url);
    for (const v of ['female', 'male'] as const) {
      const a = wordAudio(id, v);
      if (a) urls.add(a.url);
    }
    const ex = exampleAudio(id);
    if (ex) urls.add(ex.url);
  }
  return [...urls];
}

/** What the media pipeline could not produce (for the setup checklist). */
export function mediaStatus() {
  const imgs = Object.values(media.images);
  const placeholders = imgs.filter((i) => i.placeholder).length;
  return {
    images: imgs.length,
    placeholders,
    audio: Object.keys(media.audio).length,
    missingKeys: media.missingKeys ?? [],
    imageProvider: media.imageProvider ?? null,
    ttsProvider: media.ttsProvider ?? null,
  };
}
