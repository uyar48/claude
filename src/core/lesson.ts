// Builds the daily lesson plan from content + learner state. Pure function so
// the same plan can be computed on any device (and for "tomorrow" when
// pre-caching media).

import type { UnitContent, Text } from '../content/types.js';
import { coverage, COVERAGE_THRESHOLD } from './coverage.js';
import { dueCards, type Card } from './srs.js';
import { endOfLocalDay, localDate } from './time.js';
import { words as tokenWords } from './tokenize.js';

export type SegmentKind = 'review' | 'new' | 'reading' | 'quiz' | 'summary';

/** Minutes per segment for the default 30-minute lesson. */
export const BASE_SEGMENT_MINUTES: Record<SegmentKind, number> = {
  review: 8,
  new: 4,
  reading: 12,
  quiz: 4,
  summary: 2,
};
export const BASE_DURATION = 30;
export const MAX_REVIEWS_PER_LESSON = 60;

export interface LessonLogEntry {
  id: string;
  /** Local date (YYYY-MM-DD) in the user's zone when completed. */
  date: string;
  startedAt: number;
  completedAt: number | null;
  textIds: string[];
  newWordIds: string[];
  reviewed: number;
  correct: number;
  updatedAt: number;
}

export interface Segment {
  kind: SegmentKind;
  minutes: number;
}

export interface LessonPlan {
  number: number;
  date: string;
  durationMin: number;
  reviewWordIds: string[];
  newWordIds: string[];
  textId: string | null;
  extraTextIds: string[];
  textCoverage: number | null;
  segments: Segment[];
}

export interface PlanInput {
  content: UnitContent;
  cards: ReadonlyMap<string, Card>;
  log: readonly LessonLogEntry[];
  now: number;
  tz: string;
  durationMin: number;
  newPerDay: number;
}

export function knownWordSet(content: UnitContent, cards: ReadonlyMap<string, Card>, extra: Iterable<string> = []) {
  const known = new Set<string>();
  for (const f of content.functionWords) known.add(f.en.toLowerCase());
  for (const c of cards.values()) {
    if (c.state !== 'new') known.add(wordForm(content, c.wordId));
  }
  for (const id of extra) known.add(wordForm(content, id));
  return known;
}

function wordForm(content: UnitContent, wordId: string): string {
  return (content.words.find((w) => w.id === wordId)?.en ?? wordId).toLowerCase();
}

export function introducedOn(cards: ReadonlyMap<string, Card>, date: string, tz: string): number {
  let n = 0;
  for (const c of cards.values()) if (c.introducedAt !== null && localDate(c.introducedAt, tz) === date) n++;
  return n;
}

export function pickNewWords(input: PlanInput): string[] {
  const today = localDate(input.now, input.tz);
  const budget = Math.max(0, input.newPerDay - introducedOn(input.cards, today, input.tz));
  if (budget === 0) return [];
  return [...input.content.words]
    .map((w, i) => ({ w, i }))
    .sort((a, b) => a.w.day - b.w.day || a.i - b.i)
    .filter(({ w }) => (input.cards.get(w.id)?.state ?? 'new') === 'new')
    .slice(0, budget)
    .map(({ w }) => w.id);
}

export function textText(t: Text): string[] {
  return t.sentences.map((s) => s.en);
}

export interface TextChoice {
  textId: string | null;
  extraTextIds: string[];
  coverage: number | null;
}

export function pickTexts(input: PlanInput, newWordIds: string[]): TextChoice {
  const known = knownWordSet(input.content, input.cards, newWordIds);
  const newForms = new Set(newWordIds.map((id) => wordForm(input.content, id)));
  const timesRead = new Map<string, number>();
  for (const e of input.log) {
    if (e.completedAt === null) continue;
    for (const id of e.textIds) timesRead.set(id, (timesRead.get(id) ?? 0) + 1);
  }
  const candidates = input.content.texts
    .map((t) => {
      const cov = coverage(textText(t), known);
      const forms = new Set(tokenWords(textText(t).join(' ')));
      const newHits = [...newForms].filter((f) => forms.has(f)).length;
      const read = timesRead.get(t.id) ?? 0;
      return { t, cov: cov.ratio, score: newHits * 10 + (read === 0 ? 5 : 0) - read };
    })
    .filter((c) => c.cov >= COVERAGE_THRESHOLD)
    .sort((a, b) => b.score - a.score || a.t.order - b.t.order);
  if (candidates.length === 0) return { textId: null, extraTextIds: [], coverage: null };
  const [main, ...rest] = candidates;
  const extra = rest.filter((c) => (timesRead.get(c.t.id) ?? 0) === 0).slice(0, 1);
  return { textId: main.t.id, extraTextIds: extra.map((c) => c.t.id), coverage: main.cov };
}

export function scaleSegments(durationMin: number): Record<SegmentKind, number> {
  const f = durationMin / BASE_DURATION;
  const out = {} as Record<SegmentKind, number>;
  for (const [k, v] of Object.entries(BASE_SEGMENT_MINUTES)) {
    out[k as SegmentKind] = Math.max(1, Math.round(v * f));
  }
  return out;
}

export function planLesson(input: PlanInput): LessonPlan {
  const date = localDate(input.now, input.tz);
  const dayEnd = endOfLocalDay(input.now, input.tz);
  const reviewWordIds = dueCards(input.cards.values(), dayEnd - 1)
    .slice(0, MAX_REVIEWS_PER_LESSON)
    .map((c) => c.wordId);
  const newWordIds = pickNewWords(input);
  const texts = pickTexts(input, newWordIds);
  const minutes = scaleSegments(input.durationMin);

  const segments: Segment[] = [];
  if (reviewWordIds.length) segments.push({ kind: 'review', minutes: minutes.review });
  if (newWordIds.length) segments.push({ kind: 'new', minutes: minutes.new });
  if (texts.textId) {
    segments.push({ kind: 'reading', minutes: minutes.reading });
    segments.push({ kind: 'quiz', minutes: minutes.quiz });
  }
  segments.push({ kind: 'summary', minutes: minutes.summary });

  return {
    number: input.log.filter((e) => e.completedAt !== null).length + 1,
    date,
    durationMin: input.durationMin,
    reviewWordIds,
    newWordIds,
    textId: texts.textId,
    extraTextIds: texts.extraTextIds,
    textCoverage: texts.coverage,
    segments,
  };
}

/** Number of cards due before the end of the local day. */
export function dueTodayCount(cards: Iterable<Card>, now: number, tz: string): number {
  return dueCards(cards, endOfLocalDay(now, tz) - 1).length;
}

export function completedToday(log: readonly LessonLogEntry[], now: number, tz: string): boolean {
  const today = localDate(now, tz);
  return log.some((e) => e.completedAt !== null && e.date === today);
}
