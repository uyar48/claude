// Course data (NGSL words, Tatoeba + own sentences, texts) and the media
// manifests. Everything is bundled so lessons work offline.

import courseJson from '../../content/build/course.json';
import creditsJson from '../../content/media/credits.json';
import manifestJson from './media-manifest.json';
import type { Course, CourseGrammar, CourseSentence, CourseText, CourseWord } from './courseTypes';
import type { ImageCredits, MediaManifest } from './types';

export const course = courseJson as unknown as Course;
export const media = manifestJson as MediaManifest;
export const credits = creditsJson as unknown as ImageCredits;

const sentenceById = new Map(course.sentences.map((s) => [s.id, s]));
const textById = new Map(course.texts.map((t) => [t.id, t]));

export function getWord(id: string): CourseWord {
  const w = course.words[id];
  if (!w) throw new Error(`Unknown word ${id}`);
  return w;
}

export function getText(id: string): CourseText {
  const t = textById.get(id);
  if (!t) throw new Error(`Unknown text ${id}`);
  return t;
}

export function getGrammar(id: string): CourseGrammar {
  const g = (course.grammar ?? []).find((x) => x.id === id);
  if (!g) throw new Error(`Unknown grammar card ${id}`);
  return g;
}

export function getSentence(id: string): CourseSentence {
  const s = sentenceById.get(id);
  if (!s) throw new Error(`Unknown sentence ${id}`);
  return s;
}

/** Looks up a running-text word form ("houses", "I'm") → course word, if taught. */
export function lookup(form: string): { word?: CourseWord; lemma?: string } {
  const head = form.split(/['’]/)[0].toLowerCase();
  const lemma = course.forms[head];
  if (!lemma) return {};
  return { word: course.words[lemma], lemma };
}

/** Short example sentences for a word (own sentences first, then shortest). */
export function examplesFor(wordId: string, known?: ReadonlySet<string>, n = 1): CourseSentence[] {
  const all = course.sentences.filter((s) => s.lemmas.includes(wordId));
  const usable = known ? all.filter((s) => s.lemmas.every((l) => l === wordId || known.has(l))) : all;
  const pool = usable.length ? usable : all;
  return [...pool]
    .sort((a, b) => (a.src === b.src ? 0 : a.src === 'okuma' ? -1 : 1) || a.en.length - b.en.length)
    .slice(0, n);
}

export function exampleFor(wordId: string, known?: ReadonlySet<string>): CourseSentence | null {
  return examplesFor(wordId, known, 1)[0] ?? null;
}
