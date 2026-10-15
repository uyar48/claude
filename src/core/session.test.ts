import { describe, expect, it } from 'vitest';
import courseJson from '../../content/build/course.json';
import type { Course } from '../content/courseTypes';
import { nextNewWords } from './course';
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

function simulate(cards: Map<string, Card>, opts: { minutes: number; newWords: number; id?: string; wrongEvery?: number }): Run {
  const ctx: SessionContext = { course, cards, hasVisual };
  let state = createSession({
    id: opts.id ?? 'lesson-a',
    number: 1,
    targetMinutes: opts.minutes,
    newWords: nextNewWords(course, cards, opts.newWords),
    reviewWords: dueWords(cards, T0),
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
