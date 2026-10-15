// Pictures and audio for course words, sentences and texts.
//
// Pictures are stock photos (Pexels / Pixabay / Wikimedia Commons / Openverse)
// downloaded by scripts/fetch-images.ts. A word shows the candidate picked on
// /admin/review, otherwise the script's default. Words without a picture
// (abstract and function words, or rejected photos) use their emoji, and are
// otherwise taught with a sentence and audio.

import type { MediaChoice } from '../data/merge';
import { course, credits, getText, media } from './index';
import { sentenceAudioKey, wordAudioKey, type AudioAsset, type ImageCandidate, type Voice } from './types';

export const IMAGE_BASE = '/media/img/';
export const AUDIO_BASE = '/media/audio/';

export type Choices = Readonly<Record<string, MediaChoice>>;

export interface Picked extends ImageCandidate {
  src: string;
}

export function imageFor(wordId: string, choices: Choices = {}): Picked | null {
  const entry = credits.words[wordId];
  const choice = choices[wordId];
  if (choice?.rejected) return null;
  if (!entry || entry.candidates.length === 0) return null;
  const picked =
    (choice?.choice && entry.candidates.find((c) => c.file === choice.choice)) || entry.candidates[entry.default] || null;
  return picked ? { ...picked, src: IMAGE_BASE + picked.file } : null;
}

/** Emoji shown when a word has no photo. */
export function emojiFor(wordId: string): string | null {
  return course.words[wordId]?.emoji ?? null;
}

/** Short credit line ("Foto: Ana Lima / Pexels") — Pexels asks for it to be visible. */
export function creditLine(c: ImageCandidate): string {
  const site = { pexels: 'Pexels', pixabay: 'Pixabay', wikimedia: 'Wikimedia Commons', openverse: 'Openverse' }[c.source];
  return `Foto: ${c.author} / ${site}`;
}

type Clip = AudioAsset & { url: string };
const clip = (a: AudioAsset | undefined): Clip | null => (a ? { ...a, url: AUDIO_BASE + a.file } : null);

export function wordAudio(wordId: string, voice: Voice = 'female'): Clip | null {
  return clip(media.audio[wordAudioKey(wordId, voice)] ?? media.audio[wordAudioKey(wordId, voice === 'female' ? 'male' : 'female')]);
}

export function textSentenceAudio(textId: string, index: number): Clip | null {
  return clip(media.audio[sentenceAudioKey(textId, index)]);
}

/** Clip for a course sentence (Tatoeba or own), keyed by sentence id. */
export function sentenceAudio(sentenceId: string): Clip | null {
  return clip(media.audio[`s:${sentenceId}`]);
}

/** Every media URL the given words and texts need, for the offline cache. */
export function mediaUrls(wordIds: Iterable<string>, textIds: Iterable<string> = [], choices: Choices = {}): string[] {
  const urls = new Set<string>();
  for (const id of wordIds) {
    const img = imageFor(id, choices);
    if (img) urls.add(img.src);
    for (const v of ['female', 'male'] as const) {
      const a = wordAudio(id, v);
      if (a) urls.add(a.url);
    }
  }
  for (const t of textIds) {
    getText(t).sentences.forEach((_, i) => {
      const a = textSentenceAudio(t, i);
      if (a) urls.add(a.url);
    });
  }
  return [...urls];
}

/** For the "Görsel kaynakları" screen. */
export function imageStatus(choices: Choices = {}) {
  const words = course.order.map((id) => course.words[id]);
  const concrete = words.filter((w) => w.kind === 'concrete');
  const withPhoto = words.filter((w) => imageFor(w.id, choices));
  const bySource: Record<string, number> = {};
  for (const w of withPhoto) {
    const s = imageFor(w.id, choices)!.source;
    bySource[s] = (bySource[s] ?? 0) + 1;
  }
  return {
    words: words.length,
    concrete: concrete.length,
    concreteWithPhoto: concrete.filter((w) => imageFor(w.id, choices)).length,
    withPhoto: withPhoto.length,
    withEmojiOnly: words.filter((w) => !imageFor(w.id, choices) && w.emoji).length,
    neither: words.filter((w) => !imageFor(w.id, choices) && !w.emoji).length,
    bySource,
    missingKeys: credits.missingKeys,
    generatedAt: credits.generatedAt,
  };
}
