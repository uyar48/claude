// Progress is tied to completion, not to the calendar:
// • lessons run in a fixed sequence; finishing one opens the next at once,
// • missed days lock nothing, skip nothing and build no "debt",
// • the daily goal (minutes) marks a streak day; a missed day freezes the
//   streak instead of resetting it,
// • reviews are capped per day so a backlog (e.g. after a break) melts gently.

import type { Course } from '../content/courseTypes.js';
import { nextNewWords } from './course.js';
import type { Card } from './srs.js';
import { addDays, daysBetween, localDate } from './time.js';

export const REVIEW_CAP_PER_DAY = 40;
export const GOAL_OPTIONS = [20, 30, 45] as const;
export const NEW_WORDS_MIN = 6;
export const NEW_WORDS_MAX = 15;
export const NEW_WORDS_DEFAULT = 10;
/** Grammar cards per lesson at most (new ones first, then catch-ups). */
export const GRAMMAR_PER_LESSON = 2;

export interface LessonLogEntry {
  id: string;
  /** Sequence number of the lesson (1, 2, 3 …). */
  number: number;
  /** Local date (YYYY-MM-DD) the lesson was last worked on. */
  date: string;
  startedAt: number;
  completedAt: number | null;
  /** Active learning time in ms (idle time is not counted). */
  activeMs: number;
  /** Active ms per local day — a lesson that crosses midnight counts on both days. */
  dayMs: Record<string, number>;
  textIds: string[];
  newWordIds: string[];
  reviewed: number;
  correct: number;
  updatedAt: number;
}

/**
 * Share of right answers in the last finished lessons (null with too few
 * answers). It sets the pace at the start of the next lesson.
 */
export function recentAccuracy(log: readonly LessonLogEntry[], lessons = 3, minAnswers = 15): number | null {
  const done = log
    .filter((l) => l.completedAt !== null && l.reviewed > 0)
    .sort((a, b) => b.number - a.number)
    .slice(0, lessons);
  const answers = done.reduce((a, l) => a + l.reviewed, 0);
  if (answers < minAnswers) return null;
  return done.reduce((a, l) => a + l.correct, 0) / answers;
}

export function completedLessons(log: readonly LessonLogEntry[]): number {
  return log.filter((l) => l.completedAt !== null).length;
}

/** The lesson to show next: an unfinished one, or the next number in the sequence. */
export function nextLessonNumber(log: readonly LessonLogEntry[]): number {
  const open = log.find((l) => l.completedAt === null);
  if (open) return open.number;
  return log.reduce((m, l) => Math.max(m, l.number || 0), 0) + 1;
}

/** Active ms per day of one entry (older entries only have date + activeMs). */
export function entryDays(l: LessonLogEntry): Record<string, number> {
  if (l.dayMs && Object.keys(l.dayMs).length) return l.dayMs;
  return l.activeMs ? { [l.date]: l.activeMs } : {};
}

/** Adds active time to an entry on the given local day. */
export function addActive(l: LessonLogEntry, ms: number, date: string): LessonLogEntry {
  const days = { ...entryDays(l) };
  days[date] = (days[date] ?? 0) + Math.max(0, ms);
  return { ...l, activeMs: (l.activeMs || 0) + Math.max(0, ms), dayMs: days, date };
}

export function minutesOn(log: readonly LessonLogEntry[], date: string, extraMs = 0): number {
  const ms = log.reduce((a, l) => a + (entryDays(l)[date] ?? 0), 0) + extraMs;
  return ms / 60_000;
}

export function goalMet(log: readonly LessonLogEntry[], date: string, goalMinutes: number, extraMs = 0): boolean {
  return minutesOn(log, date, extraMs) >= goalMinutes;
}

/** Days on which the goal was met. */
export function goalDays(log: readonly LessonLogEntry[], goalMinutes: number): Set<string> {
  const byDay = new Map<string, number>();
  for (const l of log) for (const [d, ms] of Object.entries(entryDays(l))) byDay.set(d, (byDay.get(d) ?? 0) + ms);
  return new Set([...byDay].filter(([, ms]) => ms >= goalMinutes * 60_000).map(([d]) => d));
}

export interface StreakInfo {
  /** Goal days in the current streak (missed days never reset it). */
  days: number;
  /** Missed days that were bridged by a freeze. */
  frozen: number;
  todayDone: boolean;
}

export function streakInfo(days: ReadonlySet<string>, today: string): StreakInfo {
  const sorted = [...days].filter((d) => d <= today).sort();
  if (sorted.length === 0) return { days: 0, frozen: 0, todayDone: false };
  const todayDone = days.has(today);
  const end = todayDone ? today : addDays(today, -1);
  const span = Math.max(0, daysBetween(sorted[0], end) + 1);
  return { days: sorted.length, frozen: Math.max(0, span - sorted.length), todayDone };
}

/** How many review cards the next lesson may still use today. */
export function reviewBudget(reviewsToday: number): number {
  return Math.max(0, REVIEW_CAP_PER_DAY - reviewsToday);
}

export function reviewsOn(reviewTimes: Iterable<number>, date: string, tz: string): number {
  let n = 0;
  for (const t of reviewTimes) if (localDate(t, tz) === date) n++;
  return n;
}

export function clampNewWords(n: number): number {
  if (!Number.isFinite(n)) return NEW_WORDS_DEFAULT;
  return Math.min(NEW_WORDS_MAX, Math.max(NEW_WORDS_MIN, Math.round(n)));
}

// ---------- the next lesson ----------

export interface NextLesson {
  number: number;
  /** An unfinished lesson to resume (same id), if any. */
  resumeId: string | null;
  newWords: string[];
  reviewWords: string[];
  /** Due cards left over for later because of the daily review cap. */
  reviewsDeferred: number;
  /** Grammar cards for this lesson (at most GRAMMAR_PER_LESSON). */
  grammar: Array<{ id: string; word: string }>;
}

/**
 * Grammar cards not seen yet: first those brought by this lesson's new words,
 * then those whose word was learned earlier — two at most, in course order.
 */
export function pickGrammar(
  course: Course,
  cards: ReadonlyMap<string, Card>,
  newWords: readonly string[],
  seen: ReadonlySet<string>,
): Array<{ id: string; word: string }> {
  const open = (course.grammar ?? []).filter((g) => !seen.has(g.id));
  const fresh = open.filter((g) => newWords.includes(g.word));
  const learned = open.filter((g) => !newWords.includes(g.word) && (cards.get(g.word)?.state ?? 'new') !== 'new');
  return [...fresh, ...learned].slice(0, GRAMMAR_PER_LESSON).map((g) => ({ id: g.id, word: g.word }));
}

/** Reviews done today: cards reviewed today that were introduced before today. */
export function reviewsDoneToday(cards: ReadonlyMap<string, Card>, now: number, tz: string): number {
  const today = localDate(now, tz);
  let n = 0;
  for (const c of cards.values()) {
    if (c.lastReviewedAt === null || localDate(c.lastReviewedAt, tz) !== today) continue;
    if (c.introducedAt !== null && localDate(c.introducedAt, tz) === today) continue;
    n++;
  }
  return n;
}

/**
 * What the next lesson contains. Depends only on progress (cards + log), never
 * on how many days passed: new words follow the course order, reviews are the
 * due cards (oldest first) up to the daily cap.
 */
export function planNextLesson(input: {
  course: Course;
  cards: ReadonlyMap<string, Card>;
  log: readonly LessonLogEntry[];
  now: number;
  tz: string;
  newPerLesson: number;
  grammarSeen?: ReadonlySet<string>;
}): NextLesson {
  const open = input.log.find((l) => l.completedAt === null) ?? null;
  const due = [...input.cards.values()]
    .filter((c) => c.state !== 'new' && c.dueAt !== null && c.dueAt <= input.now && input.course.words[c.wordId])
    .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
  const budget = reviewBudget(reviewsDoneToday(input.cards, input.now, input.tz));
  const newWords = nextNewWords(input.course, input.cards, clampNewWords(input.newPerLesson));
  return {
    number: nextLessonNumber(input.log),
    resumeId: open?.id ?? null,
    newWords,
    grammar: pickGrammar(input.course, input.cards, newWords, input.grammarSeen ?? new Set()),
    reviewWords: due.slice(0, budget).map((c) => c.wordId),
    reviewsDeferred: Math.max(0, due.length - budget),
  };
}
