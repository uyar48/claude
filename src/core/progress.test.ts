// Progress follows completed lessons, not the calendar (BRIEF-v2, Sorun 1).
import { describe, expect, it } from 'vitest';
import courseJson from '../../content/build/course.json';
import type { Course } from '../content/courseTypes';
import {
  REVIEW_CAP_PER_DAY,
  addActive,
  clampNewWords,
  goalDays,
  goalMet,
  minutesOn,
  nextLessonNumber,
  planNextLesson,
  recentAccuracy,
  streakInfo,
  type LessonLogEntry,
} from './progress';
import { decide } from './scheduler';
import { defaultSettings, normalizeSettings } from './settings';
import { introduce, newCard, review, type Card } from './srs';
import { DAY, HOUR, MINUTE, localDate } from './time';

const course = courseJson as unknown as Course;
const TZ = 'Europe/Istanbul';
/** 2026-10-14 19:30 in Istanbul (UTC+3). */
const T0 = Date.UTC(2026, 9, 14, 16, 30);

function entry(id: string, number: number, start: number): LessonLogEntry {
  return {
    id,
    number,
    date: localDate(start, TZ),
    startedAt: start,
    completedAt: null,
    activeMs: 0,
    dayMs: {},
    textIds: [],
    newWordIds: [],
    reviewed: 0,
    correct: 0,
    updatedAt: start,
  };
}

/** Plays one whole lesson: every word answered well, `minutes` of active time. */
function playLesson(cards: Map<string, Card>, log: LessonLogEntry[], start: number, minutes = 30) {
  const plan = planNextLesson({ course, cards, log, now: start, tz: TZ, newPerLesson: 10 });
  let e = log.find((l) => l.id === plan.resumeId) ?? entry(`L${plan.number}`, plan.number, start);
  for (const w of plan.reviewWords) cards.set(w, review(cards.get(w)!, 'good', start + MINUTE));
  for (const w of plan.newWords) {
    const c = introduce(cards.get(w) ?? newCard(w), start + 5 * MINUTE);
    cards.set(w, review(c, 'good', start + 20 * MINUTE));
  }
  // Active time is added minute by minute, on the local day it happens.
  for (let m = 0; m < minutes; m++) e = addActive(e, MINUTE, localDate(start + m * MINUTE, TZ));
  e = { ...e, completedAt: start + minutes * MINUTE, newWordIds: plan.newWords, updatedAt: start + minutes * MINUTE };
  const i = log.findIndex((l) => l.id === e.id);
  if (i >= 0) log[i] = e;
  else log.push(e);
  return plan;
}

describe('lesson sequence', () => {
  it('"Bir ders daha": finishing a lesson opens the next one at once, with new words', () => {
    const cards = new Map<string, Card>();
    const log: LessonLogEntry[] = [];
    const first = playLesson(cards, log, T0);
    expect(first.number).toBe(1);
    expect(first.newWords).toEqual(course.order.slice(0, 10));

    // Same evening, right away.
    const second = playLesson(cards, log, T0 + 31 * MINUTE);
    expect(second.number).toBe(2);
    expect(second.newWords).toEqual(course.order.slice(10, 20));
    const third = planNextLesson({ course, cards, log, now: T0 + 62 * MINUTE, tz: TZ, newPerLesson: 10 });
    expect(third.number).toBe(3);
    expect(third.newWords).toEqual(course.order.slice(20, 30));
  });

  it('skipping days locks nothing, skips nothing and builds no debt', () => {
    const cards = new Map<string, Card>();
    const log: LessonLogEntry[] = [];
    playLesson(cards, log, T0);
    const after5Days = planNextLesson({ course, cards, log, now: T0 + 5 * DAY, tz: TZ, newPerLesson: 10 });
    expect(after5Days.number).toBe(2);
    // Still exactly the next 10 words — not 50 "owed" words.
    expect(after5Days.newWords).toEqual(course.order.slice(10, 20));
    expect(after5Days.reviewWords).toHaveLength(10);
  });

  it('an unfinished lesson is resumed, not skipped', () => {
    const log = [{ ...entry('L1', 1, T0), completedAt: T0 + HOUR }, entry('L2', 2, T0 + 2 * HOUR)];
    expect(nextLessonNumber(log)).toBe(2);
    const plan = planNextLesson({ course, cards: new Map(), log, now: T0 + 3 * DAY, tz: TZ, newPerLesson: 10 });
    expect(plan.resumeId).toBe('L2');
    expect(plan.number).toBe(2);
  });

  it('new words per lesson are adjustable between 6 and 15', () => {
    const plan = (n: number) => planNextLesson({ course, cards: new Map(), log: [], now: T0, tz: TZ, newPerLesson: n });
    expect(plan(6).newWords).toHaveLength(6);
    expect(plan(15).newWords).toHaveLength(15);
    expect(plan(40).newWords).toHaveLength(15);
    expect(plan(2).newWords).toHaveLength(6);
    expect(clampNewWords(Number.NaN)).toBe(10);
  });
});

describe('daily goal and streak', () => {
  it('a lesson that crosses midnight counts on both days', () => {
    const start = Date.UTC(2026, 9, 14, 20, 50); // 23:50 Istanbul
    const log: LessonLogEntry[] = [];
    playLesson(new Map(), log, start, 30);
    expect(minutesOn(log, '2026-10-14')).toBe(10);
    expect(minutesOn(log, '2026-10-15')).toBe(20);
    expect(goalMet(log, '2026-10-15', 20)).toBe(true);
    expect(goalMet(log, '2026-10-14', 20)).toBe(false);
    // The new day starts fresh: the next lesson is available immediately.
    const next = planNextLesson({ course, cards: new Map(), log, now: start + 35 * MINUTE, tz: TZ, newPerLesson: 10 });
    expect(next.number).toBe(2);
  });

  it('meeting the goal earlier in the day stays met after midnight', () => {
    const log: LessonLogEntry[] = [];
    playLesson(new Map(), log, T0, 30); // 19:30–20:00
    const late = Date.UTC(2026, 9, 14, 20, 50); // 23:50, continues past midnight
    playLesson(new Map(), log, late, 30);
    expect(goalDays(log, 30)).toEqual(new Set(['2026-10-14']));
    expect(minutesOn(log, '2026-10-14')).toBe(40);
  });

  it('a missed day freezes the streak instead of resetting it', () => {
    const days = new Set(['2026-10-10', '2026-10-11', '2026-10-13', '2026-10-14']);
    expect(streakInfo(days, '2026-10-14')).toEqual({ days: 4, frozen: 1, todayDone: true });
    // Today not done yet: no loss either.
    expect(streakInfo(days, '2026-10-16')).toEqual({ days: 4, frozen: 2, todayDone: false });
    expect(streakInfo(new Set(), '2026-10-16')).toEqual({ days: 0, frozen: 0, todayDone: false });
  });

  it('the user may keep going after the goal', () => {
    const cards = new Map<string, Card>();
    const log: LessonLogEntry[] = [];
    playLesson(cards, log, T0, 30);
    playLesson(cards, log, T0 + 31 * MINUTE, 30);
    expect(minutesOn(log, '2026-10-14')).toBe(60);
    expect(goalDays(log, 30).size).toBe(1);
  });
});

describe('break (Ara ver) and coming back', () => {
  it('no notifications while paused, any length of time', () => {
    const s = { ...defaultSettings(), paused: true, pausedAt: T0 };
    for (const days of [1, 10, 90]) {
      const at = Date.UTC(2026, 9, 14 + days, 16, 35); // 19:35 Istanbul
      const out = decide({
        now: at,
        timezone: TZ,
        settings: s.notifications,
        goalMinutes: 30,
        goalMetToday: false,
        paused: s.paused,
        nextLesson: 5,
        dueCount: 80,
        history: [],
      });
      expect(out).toBeNull();
    }
  });

  it(`after a long break the review queue is capped at ${REVIEW_CAP_PER_DAY} cards per day`, () => {
    const cards = new Map<string, Card>();
    const log: LessonLogEntry[] = [];
    for (let i = 0; i < 7; i++) playLesson(cards, log, T0 + i * 31 * MINUTE);
    const back = T0 + 30 * DAY;
    const plan = planNextLesson({ course, cards, log, now: back, tz: TZ, newPerLesson: 10 });
    expect(plan.reviewWords).toHaveLength(REVIEW_CAP_PER_DAY);
    expect(plan.reviewsDeferred).toBe(70 - REVIEW_CAP_PER_DAY);
    // Oldest due first.
    const dues = plan.reviewWords.map((w) => cards.get(w)!.dueAt!);
    expect([...dues].sort((a, b) => a - b)).toEqual(dues);

    // Do 25 of them; the next lesson the same day only gets the rest of the cap.
    for (const w of plan.reviewWords.slice(0, 25)) cards.set(w, review(cards.get(w)!, 'good', back + MINUTE));
    const again = planNextLesson({ course, cards, log, now: back + HOUR, tz: TZ, newPerLesson: 10 });
    expect(again.reviewWords).toHaveLength(REVIEW_CAP_PER_DAY - 25);
    // Next day the cap is fresh.
    const tomorrow = planNextLesson({ course, cards, log, now: back + DAY, tz: TZ, newPerLesson: 10 });
    expect(tomorrow.reviewWords).toHaveLength(REVIEW_CAP_PER_DAY);
  });

  it('old settings migrate: 15-minute lessons become a 20-minute goal, 10 new words, not paused', () => {
    const s = normalizeSettings({ lessonMinutes: 15, newPerDay: 5, timezone: TZ });
    expect(s.goalMinutes).toBe(20);
    expect(s.newPerLesson).toBe(10);
    expect(s.paused).toBe(false);
    expect(normalizeSettings({ goalMinutes: 45, newPerLesson: 12 })).toMatchObject({ goalMinutes: 45, newPerLesson: 12 });
  });
});

describe('recent accuracy (sets the pace of the next lesson)', () => {
  const done = (n: number, reviewed: number, correct: number): LessonLogEntry => ({
    ...entry(`l${n}`, n, T0 + n * HOUR),
    completedAt: T0 + n * HOUR + 30 * MINUTE,
    reviewed,
    correct,
  });

  it('uses the last three finished lessons', () => {
    const log = [done(1, 40, 10), done(2, 40, 36), done(3, 40, 34), done(4, 40, 38)];
    expect(recentAccuracy(log)).toBeCloseTo(108 / 120);
    // A lesson in progress does not count.
    expect(recentAccuracy([...log, { ...entry('open', 5, T0 + 9 * HOUR), reviewed: 10, correct: 0 }])).toBeCloseTo(108 / 120);
  });

  it('needs enough answers', () => {
    expect(recentAccuracy([])).toBeNull();
    expect(recentAccuracy([done(1, 10, 10)])).toBeNull();
  });
});

describe('unit test results in settings', () => {
  it('are kept and cleaned', () => {
    const s = normalizeSettings({
      unitTests: { '1': { score: 17, total: 20, best: 15, tries: 2, at: 5 }, '2': { score: 1, total: 0 }, x: null },
    });
    expect(s.unitTests).toEqual({ '1': { score: 17, total: 20, best: 17, tries: 2, at: 5 } });
    expect(defaultSettings().unitTests).toEqual({});
  });
});
