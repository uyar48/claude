import { describe, expect, it } from 'vitest';
import courseJson from '../../content/build/course.json';
import type { Course } from '../content/courseTypes';
import { learnerUnit, nextNewWords } from './course';
import { pickGrammar } from './progress';
import {
  DIFFICULTY,
  createSession,
  finalGrades,
  nextExercise,
  recordAnswer,
  type Exercise,
  type ExerciseType,
  type SessionContext,
  type SessionState,
} from './session';
import { introduce, newCard, review, type Card } from './srs';
import { DAY, MINUTE } from './time';

const course = courseJson as unknown as Course;
const T0 = Date.UTC(2026, 9, 14, 16, 30);

/** Seconds a learner typically spends on each exercise type. */
const SECONDS: Record<ExerciseType, number> = {
  intro: 25,
  match: 45,
  'word-to-picture': 10,
  'picture-to-word': 10,
  'listen-picture': 12,
  'en-tr': 10,
  'tr-en': 14,
  dictation: 25,
  'fill-blank': 20,
  'build-sentence': 35,
  reading: 240,
  scene: 70,
  'speed-round': 60,
  grammar: 40,
};

/** The brief's exercise categories (picture↔word, translate, … ). */
const CATEGORY: Partial<Record<ExerciseType, string>> = {
  match: 'picture-word',
  'word-to-picture': 'picture-word',
  'picture-to-word': 'picture-word',
  'listen-picture': 'listen-picture',
  'en-tr': 'translate',
  'tr-en': 'translate',
  dictation: 'dictation',
  'fill-blank': 'fill-blank',
  'build-sentence': 'build-sentence',
  reading: 'reading',
  scene: 'scene',
  'speed-round': 'speed-round',
};

const hasVisual = (w: string) => course.words[w]?.kind === 'concrete';

/** The live learner's state: the ten Sabah words started, some already known. */
function startedCards(): Map<string, Card> {
  const cards = new Map<string, Card>();
  for (const w of course.order.slice(0, 10)) {
    let c = introduce(newCard(w, T0 - 3 * DAY), T0 - 3 * DAY);
    c = review(c, 'good', T0 - 3 * DAY + 20 * MINUTE);
    if (['house', 'door', 'window', 'table', 'water'].includes(w)) c = review(c, 'good', T0 - 2 * DAY);
    cards.set(w, c);
  }
  return cards;
}

function dueWords(cards: Map<string, Card>, now: number): string[] {
  return [...cards.values()].filter((c) => c.state !== 'new' && c.dueAt !== null && c.dueAt <= now).map((c) => c.wordId);
}

interface Run {
  state: SessionState;
  exercises: Exercise[];
}

function simulate(
  cards: Map<string, Card>,
  opts: {
    minutes: number;
    newWords: number;
    id?: string;
    wrongEvery?: number;
    grammar?: Array<{ id: string; word: string }>;
    readCounts?: Record<string, number>;
  },
): Run {
  const ctx: SessionContext = { course, cards, hasVisual, unit: learnerUnit(course, cards), readCounts: opts.readCounts };
  let state = createSession({
    id: opts.id ?? 'lesson-a',
    number: 1,
    targetMinutes: opts.minutes,
    newWords: nextNewWords(course, cards, opts.newWords),
    reviewWords: dueWords(cards, T0),
    grammar: opts.grammar,
  });
  const exercises: Exercise[] = [];
  for (let i = 0; i < 1000; i++) {
    const step = nextExercise(state, ctx);
    state = step.state;
    if (!step.exercise) break;
    const ex = step.exercise;
    exercises.push(ex);
    const correct = ex.type === 'intro' ? null : opts.wrongEvery ? i % opts.wrongEvery !== 0 : true;
    const perWord = ex.words && !ex.wordId ? Object.fromEntries(ex.words.map((w) => [w, true])) : undefined;
    state = recordAnswer(state, ex, { correct: perWord ? null : correct, ms: SECONDS[ex.type] * 1000, perWord }).state;
  }
  return { state, exercises };
}

function maxRun(types: ExerciseType[]): number {
  let best = 0;
  let run = 0;
  types.forEach((t, i) => {
    run = i > 0 && types[i - 1] === t ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return best;
}

describe('lesson session engine', () => {
  const run = simulate(startedCards(), { minutes: 30, newWords: 10 });
  const types = run.exercises.map((e) => e.type);

  it('fills the target time and then ends', () => {
    expect(run.state.phase).toBe('done');
    // A finished lesson always reaches the daily goal it was built for.
    expect(run.state.activeMs).toBeGreaterThanOrEqual(30 * MINUTE);
    expect(run.state.activeMs).toBeLessThanOrEqual(33 * MINUTE);
  });

  it('uses at least 8 of the exercise categories', () => {
    const cats = new Set(types.map((t) => CATEGORY[t]).filter(Boolean));
    expect(cats.size).toBeGreaterThanOrEqual(8);
  });

  it('never shows the same type more than twice in a row', () => {
    expect(maxRun(types)).toBeLessThanOrEqual(2);
  });

  it('introduces all new words and reviews the due ones', () => {
    expect(run.state.introduced).toHaveLength(10);
    expect(run.exercises.filter((e) => e.type === 'intro')).toHaveLength(10);
    expect(run.state.reviewed.length).toBeGreaterThan(0);
  });

  it('gets harder in the middle and ends with an easy speed round', () => {
    const graded = types.filter((t) => t !== 'intro' && t !== 'speed-round');
    const third = Math.floor(graded.length / 3);
    const avg = (xs: ExerciseType[]) => xs.reduce((a, t) => a + DIFFICULTY[t], 0) / xs.length;
    expect(avg(graded.slice(-third))).toBeGreaterThan(avg(graded.slice(0, third)));
    expect(types.at(-1)).toBe('speed-round');
  });

  it('builds valid exercises', () => {
    for (const ex of run.exercises) {
      if (ex.answer !== undefined) expect(ex.words![ex.answer]).toBe(ex.wordId);
      if (ex.words) expect(new Set(ex.words).size).toBe(ex.words.length);
      if (ex.type === 'fill-blank' || ex.type === 'build-sentence') {
        const sent = course.sentences.find((s) => s.id === ex.sentenceId);
        expect(sent?.lemmas).toContain(ex.wordId);
      }
      if (ex.type === 'reading') expect(course.texts.some((t) => t.id === ex.textId)).toBe(true);
    }
    const sentences = run.exercises.filter((e) => e.sentenceId).map((e) => e.sentenceId);
    expect(new Set(sentences).size).toBe(sentences.length);
  });

  it('is deterministic for the same lesson id', () => {
    const again = simulate(startedCards(), { minutes: 30, newWords: 10 });
    expect(again.exercises.map((e) => e.key + e.type + e.wordId)).toEqual(run.exercises.map((e) => e.key + e.type + e.wordId));
  });

  it('grades new words that went well', () => {
    const grades = finalGrades(run.state);
    expect(grades.length).toBeGreaterThanOrEqual(8);
    expect(grades.every((g) => g.grade === 'good')).toBe(true);
  });

  it('respects the daily goal length (20 and 45 minutes)', () => {
    for (const minutes of [20, 45]) {
      const r = simulate(startedCards(), { minutes, newWords: 10, id: `l-${minutes}` });
      expect(r.state.activeMs).toBeGreaterThanOrEqual(minutes * MINUTE);
      expect(r.state.activeMs).toBeLessThanOrEqual((minutes + 3) * MINUTE);
      expect(maxRun(r.exercises.map((e) => e.type))).toBeLessThanOrEqual(2);
    }
  });

  it('works with 6 and 15 new words and with mistakes', () => {
    for (const n of [6, 15]) {
      const r = simulate(startedCards(), { minutes: 30, newWords: n, id: `n-${n}`, wrongEvery: 4 });
      expect(r.state.introduced).toHaveLength(n);
      expect(r.state.phase).toBe('done');
      expect(maxRun(r.exercises.map((e) => e.type))).toBeLessThanOrEqual(2);
    }
  });

  it('grades a due review word once, on its first exercise', () => {
    const cards = startedCards();
    const ctx: SessionContext = { course, cards, hasVisual };
    let s = createSession({ id: 'g', number: 1, targetMinutes: 30, newWords: [], reviewWords: ['house'] });
    const first = nextExercise(s, ctx);
    expect(first.exercise?.wordId).toBe('house');
    const r1 = recordAnswer(first.state, first.exercise!, { correct: false, ms: 5000 });
    expect(r1.grades).toEqual([{ wordId: 'house', grade: 'again' }]);
    s = r1.state;
    const r2 = recordAnswer(s, first.exercise!, { correct: true, ms: 5000 });
    expect(r2.grades).toEqual([]);
  });
});

/** A learner who has learned the first `n` words of the course. */
function learnedCards(n: number): Map<string, Card> {
  const cards = new Map<string, Card>();
  for (const w of course.order.slice(0, n)) {
    let c = introduce(newCard(w, T0 - 30 * DAY), T0 - 30 * DAY);
    c = review(c, 'good', T0 - 30 * DAY + 20 * MINUTE);
    c = review(c, 'good', T0 - 29 * DAY);
    c = review(c, 'good', T0 - 20 * DAY);
    cards.set(w, c);
  }
  return cards;
}

describe('grammar cards', () => {
  it('a card comes right after the intro of its word; earlier words get a catch-up card after the warm-up', () => {
    const cards = startedCards(); // next words: the, be, a, i, have …
    const grammar = pickGrammar(course, cards, nextNewWords(course, cards, 10), new Set());
    expect(grammar.map((g) => g.id)).toEqual(['g-the', 'g-be']);
    const run = simulate(cards, { minutes: 30, newWords: 10, grammar, id: 'g1' });
    const types = run.exercises.map((e) => e.type + (e.wordId ? `:${e.wordId}` : e.grammarId ? `:${e.grammarId}` : ''));
    expect(types.indexOf('grammar:g-the')).toBe(types.indexOf('intro:the') + 1);
    expect(types.indexOf('grammar:g-be')).toBe(types.indexOf('intro:be') + 1);
    expect(run.exercises.filter((e) => e.type === 'grammar')).toHaveLength(2);

    // Words learned before, cards not seen yet: shown as catch-ups (two at most).
    const later = learnedCards(40);
    const seen = new Set(['g-the', 'g-be']);
    const catchUp = pickGrammar(course, later, nextNewWords(course, later, 10), seen);
    expect(catchUp).toHaveLength(2);
    const run2 = simulate(later, { minutes: 20, newWords: 10, grammar: catchUp, id: 'g2' });
    const g = run2.exercises.filter((e) => e.type === 'grammar').map((e) => e.grammarId);
    expect(g).toEqual(catchUp.map((c) => c.id));
  });

  it('new-word cards go first and seen cards never come back', () => {
    const cards = learnedCards(100); // next words: any, after, day …
    const seen = new Set((course.grammar ?? []).filter((x) => x.order < 100).map((x) => x.id));
    const g = pickGrammar(course, cards, nextNewWords(course, cards, 10), seen);
    expect(g.map((x) => x.id)).toEqual(['g-some-any', 'g-should']);
    expect(pickGrammar(course, cards, [], new Set([...seen, 'g-some-any', 'g-should']))).toEqual([]);
  });
});

describe('graded difficulty', () => {
  it('a Unit 1 learner only gets Unit 1 sentences and texts', () => {
    const run = simulate(startedCards(), { minutes: 30, newWords: 10, id: 'u1' });
    for (const e of run.exercises) {
      if (e.sentenceId) expect(course.sentences.find((x) => x.id === e.sentenceId)!.unit).toBe(1);
      if (e.textId) expect(course.texts.find((x) => x.id === e.textId)!.unit).toBe(1);
    }
  });

  it('later units use longer sentences, step by step', () => {
    const avgWords = (unit: number) => {
      const xs = course.sentences.filter((x) => x.unit === unit).map((x) => x.en.split(/\s+/).length);
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    expect(avgWords(3)).toBeGreaterThan(avgWords(1));
    expect(avgWords(5)).toBeGreaterThan(avgWords(2));
    const max = (unit: number) => Math.max(...course.sentences.filter((x) => x.unit === unit).map((x) => x.en.split(/\s+/).length));
    expect(max(1)).toBeLessThanOrEqual(9);
    expect(max(2)).toBeLessThanOrEqual(10);
    expect(max(5)).toBeLessThanOrEqual(16);
    // A Unit 3 learner may meet Unit 3 sentences but none from later units.
    const run = simulate(learnedCards(200), { minutes: 30, newWords: 10, id: 'u3' });
    const units = run.exercises.filter((e) => e.sentenceId).map((e) => course.sentences.find((x) => x.id === e.sentenceId)!.unit);
    expect(Math.max(...units)).toBeLessThanOrEqual(3);
  });

  it('texts not read before come first', () => {
    const cards = learnedCards(60);
    const first = simulate(cards, { minutes: 30, newWords: 10, id: 'r1' });
    const read = first.state.usedTexts;
    expect(read.length).toBeGreaterThan(0);
    const counts = Object.fromEntries(read.map((t) => [t, 1]));
    const second = simulate(cards, { minutes: 30, newWords: 10, id: 'r2', readCounts: counts });
    expect(second.state.usedTexts[0]).not.toBe(read[0]);
  });
});
