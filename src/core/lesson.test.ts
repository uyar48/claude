import { describe, expect, it } from 'vitest';
import unit1 from '../../content/level0/unit1.json';
import type { UnitContent } from '../content/types';
import { COVERAGE_THRESHOLD, coverage } from './coverage';
import {
  completedToday,
  dueTodayCount,
  knownWordSet,
  planLesson,
  scaleSegments,
  textText,
  type LessonLogEntry,
  type PlanInput,
} from './lesson';
import { introduce, newCard, review, type Card } from './srs';
import { streak } from './streak';
import { DAY, HOUR, MINUTE, localDate } from './time';
import { tokenize, words } from './tokenize';

const content = unit1 as UnitContent;
const TZ = 'Europe/Istanbul';
const DAY1 = Date.UTC(2026, 9, 14, 16, 30); // 19:30 Istanbul

function input(cards: Map<string, Card>, log: LessonLogEntry[], now: number, over: Partial<PlanInput> = {}): PlanInput {
  return { content, cards, log, now, tz: TZ, durationMin: 30, newPerDay: 5, ...over };
}

/** Simulates finishing a lesson: introduce + answer every review and new word correctly. */
function doLesson(cards: Map<string, Card>, log: LessonLogEntry[], now: number) {
  const plan = planLesson(input(cards, log, now));
  for (const id of plan.reviewWordIds) cards.set(id, review(cards.get(id)!, 'good', now));
  for (const id of plan.newWordIds) {
    const c = introduce(cards.get(id) ?? newCard(id), now);
    cards.set(id, review(c, 'good', now + 20 * MINUTE)); // quiz later in the lesson
  }
  log.push({
    id: `l${log.length}`,
    date: localDate(now, TZ),
    startedAt: now,
    completedAt: now + 30 * MINUTE,
    textIds: [plan.textId!, ...plan.extraTextIds].filter(Boolean),
    newWordIds: plan.newWordIds,
    reviewed: plan.reviewWordIds.length,
    correct: plan.reviewWordIds.length,
    updatedAt: now,
  });
  return plan;
}

describe('tokenize', () => {
  it('keeps punctuation and indexes words', () => {
    const t = tokenize('Good morning. I am at home.');
    expect(t.filter((x) => x.norm).map((x) => x.wordIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(t.map((x) => x.text).join('')).toBe('Good morning. I am at home.');
    expect(words("I'm at home")).toEqual(["i'm", 'at', 'home']);
  });
});

describe('coverage', () => {
  it('counts running words, not types', () => {
    const r = coverage('the man and the woman', new Set(['the', 'and', 'man']));
    expect(r.total).toBe(5);
    expect(r.known).toBe(4);
    expect(r.ratio).toBeCloseTo(0.8);
    expect(r.unknownWords).toEqual(['woman']);
  });
});

describe('unit 1 content', () => {
  const allKnown = knownWordSet(content, new Map(), content.words.map((w) => w.id));

  it('has 20 words and 5 texts with 3 + 3 questions each', () => {
    expect(content.words).toHaveLength(20);
    expect(content.texts).toHaveLength(5);
    for (const t of content.texts) {
      expect(t.questions).toHaveLength(3);
      expect(t.blanks).toHaveLength(3);
    }
  });

  it('every text is fully covered by the unit vocabulary', () => {
    for (const t of content.texts) expect(coverage(textText(t), allKnown).ratio).toBe(1);
  });

  it('questions and blanks are well-formed', () => {
    const ids = new Set(content.words.map((w) => w.id));
    for (const t of content.texts) {
      for (const q of t.questions) {
        expect(q.answer).toBeLessThan(q.options.length);
        for (const o of q.options) {
          expect(Boolean(o.en) !== Boolean(o.image)).toBe(true);
          if (o.image) expect(ids.has(o.image)).toBe(true);
        }
      }
      for (const b of t.blanks) {
        expect(b.sentence.split('___')).toHaveLength(2);
        expect(b.answer).toBeLessThan(b.options.length);
        const filled = b.sentence.replace('___', b.options[b.answer]);
        expect(t.sentences.some((s) => s.en === filled)).toBe(true);
      }
    }
  });

  it('example sentences only use unit words', () => {
    for (const w of content.words) {
      expect(coverage(w.example, allKnown).ratio).toBe(1);
      expect(words(w.example)).toContain(w.en);
    }
  });
});

describe('lesson planner', () => {
  it('day 1: no reviews, 5 new words, a ≥95% text', () => {
    const plan = planLesson(input(new Map(), [], DAY1));
    expect(plan.number).toBe(1);
    expect(plan.reviewWordIds).toEqual([]);
    expect(plan.newWordIds).toEqual(['house', 'door', 'window', 'table', 'water']);
    expect(plan.textId).toBe('t5');
    expect(plan.textCoverage).toBeGreaterThanOrEqual(COVERAGE_THRESHOLD);
    expect(plan.segments.map((s) => s.kind)).toEqual(['new', 'reading', 'quiz', 'summary']);
  });

  it('texts under 95% coverage are never offered', () => {
    const plan = planLesson(input(new Map(), [], DAY1, { newPerDay: 0 }));
    expect(plan.textId).toBeNull();
    expect(plan.segments.map((s) => s.kind)).toEqual(['summary']);
  });

  it('four days introduce all 20 words, every text becomes readable, reviews come back', () => {
    const cards = new Map<string, Card>();
    const log: LessonLogEntry[] = [];
    const texts: string[] = [];
    for (let d = 0; d < 4; d++) {
      const plan = doLesson(cards, log, DAY1 + d * DAY);
      expect(plan.newWordIds).toHaveLength(5);
      if (d > 0) expect(plan.reviewWordIds.length).toBeGreaterThan(0);
      texts.push(plan.textId!, ...plan.extraTextIds);
      const known = knownWordSet(content, cards);
      expect(coverage(textText(content.texts.find((t) => t.id === plan.textId)!), known).ratio).toBeGreaterThanOrEqual(
        COVERAGE_THRESHOLD,
      );
    }
    expect([...cards.values()].filter((c) => c.state !== 'new')).toHaveLength(20);
    expect(new Set(texts)).toEqual(new Set(['t1', 't2', 't3', 't4', 't5']));
    // Day 5: no new words left, still a full lesson with reviews and reading.
    const plan5 = planLesson(input(cards, log, DAY1 + 4 * DAY));
    expect(plan5.newWordIds).toEqual([]);
    expect(plan5.reviewWordIds.length).toBeGreaterThan(0);
    expect(plan5.textId).not.toBeNull();
    expect(plan5.number).toBe(5);
  });

  it('the daily new-word limit holds across several lessons on the same day', () => {
    const cards = new Map<string, Card>();
    const log: LessonLogEntry[] = [];
    doLesson(cards, log, DAY1);
    const second = planLesson(input(cards, log, DAY1 + HOUR));
    expect(second.newWordIds).toEqual([]);
    const tomorrow = planLesson(input(cards, log, DAY1 + DAY));
    expect(tomorrow.newWordIds).toHaveLength(5);
  });

  it('reviews include cards due later today', () => {
    const cards = new Map<string, Card>();
    const c = { ...introduce(newCard('tea'), DAY1 - DAY), dueAt: DAY1 + HOUR }; // due 20:30 today
    cards.set('tea', c);
    expect(planLesson(input(cards, [], DAY1)).reviewWordIds).toEqual(['tea']);
    expect(dueTodayCount(cards.values(), DAY1, TZ)).toBe(1);
  });

  it('scales segment minutes with lesson length (30 min = 8/4/12/4/2)', () => {
    expect(scaleSegments(30)).toEqual({ review: 8, new: 4, reading: 12, quiz: 4, summary: 2 });
    const s15 = scaleSegments(15);
    expect(Object.values(s15).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(16);
  });

  it('knows whether today is done', () => {
    const cards = new Map<string, Card>();
    const log: LessonLogEntry[] = [];
    expect(completedToday(log, DAY1, TZ)).toBe(false);
    doLesson(cards, log, DAY1);
    expect(completedToday(log, DAY1 + HOUR, TZ)).toBe(true);
    expect(completedToday(log, DAY1 + DAY, TZ)).toBe(false);
  });
});

describe('streak', () => {
  it('counts consecutive days and survives an unfinished today', () => {
    expect(streak(['2026-10-12', '2026-10-13'], '2026-10-14')).toBe(2);
    expect(streak(['2026-10-12', '2026-10-13', '2026-10-14'], '2026-10-14')).toBe(3);
    expect(streak(['2026-10-11', '2026-10-13'], '2026-10-14')).toBe(1);
    expect(streak(['2026-10-11'], '2026-10-14')).toBe(0);
    expect(streak([], '2026-10-14')).toBe(0);
  });
});
