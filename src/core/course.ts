// Pure helpers over the course data: word order, sentence tokens, coverage.

import type { Course, CourseSentence, CourseText, CourseWord } from '../content/courseTypes.js';
import type { Card } from './srs.js';

export const SENTENCE_COVERAGE = 0.95;

/** Lemmas the learner can read: starter words + every introduced card. */
export function knownLemmas(course: Course, cards: ReadonlyMap<string, Card>, extra: Iterable<string> = []): Set<string> {
  const known = new Set(course.starterKnown);
  for (const c of cards.values()) if (c.state !== 'new') known.add(c.wordId);
  for (const id of extra) known.add(id);
  return known;
}

/** The next n words in course order that have not been introduced yet. */
export function nextNewWords(course: Course, cards: ReadonlyMap<string, Card>, n: number): string[] {
  const out: string[] = [];
  for (const id of course.order) {
    if (out.length >= n) break;
    if ((cards.get(id)?.state ?? 'new') === 'new') out.push(id);
  }
  return out;
}

export interface SentenceToken {
  text: string;
  /** Lemma for word tokens (null for names/unknown), undefined for punctuation/space. */
  lemma?: string | null;
}

/** Splits a sentence for display, tapping and gaps. "I'm" stays one token (lemma of "I"). */
export function sentenceTokens(course: Course, text: string): SentenceToken[] {
  const out: SentenceToken[] = [];
  let last = 0;
  for (const m of text.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ text: text.slice(last, start) });
    const head = m[0].split(/['’]/)[0].toLowerCase();
    out.push({ text: m[0], lemma: course.forms[head] ?? null });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Share of word tokens the learner knows (names count as known). */
export function sentenceCoverage(course: Course, text: string, known: ReadonlySet<string>): number {
  let total = 0;
  let ok = 0;
  for (const m of text.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)) {
    for (const part of m[0].split(/['’]/)) {
      total++;
      const lemma = course.forms[part.toLowerCase()];
      if (!lemma) {
        if (/^[A-Z]/.test(part)) ok++; // a name
        continue;
      }
      if (known.has(lemma)) ok++;
    }
  }
  return total === 0 ? 1 : ok / total;
}

export function sentenceUsable(course: Course, s: CourseSentence | CourseText, known: ReadonlySet<string>): boolean {
  if (!s.lemmas.every((l) => known.has(l))) {
    // Allow up to 5 % unknown running words (only matters for long texts).
    const text = 'en' in s ? s.en : s.sentences.map((x) => x.en).join(' ');
    return sentenceCoverage(course, text, known) >= SENTENCE_COVERAGE;
  }
  return true;
}

export function wordOf(course: Course, id: string): CourseWord {
  const w = course.words[id];
  if (!w) throw new Error(`Unknown word ${id}`);
  return w;
}

/** The learner's unit: the unit of the next word to learn (the last unit when all are learned). */
export function learnerUnit(course: Course, cards: ReadonlyMap<string, Card>): number {
  const next = nextNewWords(course, cards, 1)[0];
  if (next) return course.words[next].unit;
  return course.units.at(-1)?.n ?? 1;
}

/** How often each text was read in finished or started lessons. */
export function readCounts(log: ReadonlyArray<{ textIds: string[] }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of log) for (const t of l.textIds ?? []) out[t] = (out[t] ?? 0) + 1;
  return out;
}
