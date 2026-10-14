// Spaced-repetition engine (SM-2 style with learning steps).
//
//   new ──introduce──▶ learning ──pass all steps──▶ known
//                         ▲                          │
//                         └──────── lapse ───────────┘
//
// • learning: fixed steps (10 min, then 1 day). A miss restarts the steps.
// • known: on success the interval grows by the ease factor; on a miss the
//   interval is halved, ease drops by 0.2 (min 1.3) and the card relearns.
// • Deterministic: no random fuzz, so tests can assert exact due dates.

import { DAY, MINUTE } from './time.js';

export type CardState = 'new' | 'learning' | 'known';

export interface Card {
  wordId: string;
  state: CardState;
  /** Index into LEARNING_STEPS while learning. */
  step: number;
  ease: number;
  /** Current/last review interval in days (0 while never graduated). */
  intervalDays: number;
  reps: number;
  lapses: number;
  /** Epoch ms when the card should next be reviewed (null for new cards). */
  dueAt: number | null;
  introducedAt: number | null;
  lastReviewedAt: number | null;
  /** Last modification (epoch ms) — used for last-write-wins sync. */
  updatedAt: number;
}

export const LEARNING_STEPS = [10 * MINUTE, 1 * DAY];
export const GRADUATING_INTERVAL_DAYS = 3;
export const START_EASE = 2.5;
export const MIN_EASE = 1.3;
export const EASE_PENALTY = 0.2;
export const EASE_BONUS = 0.15;
export const LAPSE_MULTIPLIER = 0.5;
export const MAX_INTERVAL_DAYS = 365;

export function newCard(wordId: string, now = 0): Card {
  return {
    wordId,
    state: 'new',
    step: 0,
    ease: START_EASE,
    intervalDays: 0,
    reps: 0,
    lapses: 0,
    dueAt: null,
    introducedAt: null,
    lastReviewedAt: null,
    updatedAt: now,
  };
}

/** First exposure (picture card in a lesson, or tapping an unknown word). */
export function introduce(card: Card, now: number): Card {
  if (card.state !== 'new') return card;
  return {
    ...card,
    state: 'learning',
    step: 0,
    introducedAt: now,
    dueAt: now + LEARNING_STEPS[0],
    updatedAt: now,
  };
}

export type Grade = 'again' | 'good' | 'easy';

export function review(card: Card, grade: Grade, now: number): Card {
  if (card.state === 'new') card = introduce(card, now);
  const base = { ...card, reps: card.reps + 1, lastReviewedAt: now, updatedAt: now };

  if (card.state === 'learning') {
    if (grade === 'again') {
      return { ...base, step: 0, dueAt: now + LEARNING_STEPS[0] };
    }
    const nextStep = grade === 'easy' ? LEARNING_STEPS.length : card.step + 1;
    if (nextStep < LEARNING_STEPS.length) {
      return { ...base, step: nextStep, dueAt: now + LEARNING_STEPS[nextStep] };
    }
    // Graduate. A relearning card returns to its (already shortened) interval.
    const interval = Math.max(
      card.intervalDays > 0 ? card.intervalDays : GRADUATING_INTERVAL_DAYS,
      grade === 'easy' ? GRADUATING_INTERVAL_DAYS + 1 : 1,
    );
    return { ...base, state: 'known', step: 0, intervalDays: interval, dueAt: now + interval * DAY };
  }

  // known
  if (grade === 'again') {
    const interval = Math.max(1, Math.round(card.intervalDays * LAPSE_MULTIPLIER));
    return {
      ...base,
      state: 'learning',
      step: 0,
      lapses: card.lapses + 1,
      ease: Math.max(MIN_EASE, round2(card.ease - EASE_PENALTY)),
      intervalDays: interval,
      dueAt: now + LEARNING_STEPS[0],
    };
  }
  const ease = grade === 'easy' ? round2(card.ease + EASE_BONUS) : card.ease;
  const factor = grade === 'easy' ? ease * 1.3 : ease;
  const interval = Math.min(
    MAX_INTERVAL_DAYS,
    Math.max(card.intervalDays + 1, Math.round(card.intervalDays * factor)),
  );
  return { ...base, ease, intervalDays: interval, dueAt: now + interval * DAY };
}

/**
 * Tapped while reading: the word goes on the review list. New words are
 * introduced; others become due now without touching their interval/ease.
 */
export function markForReview(card: Card, now: number): Card {
  if (card.state === 'new') return introduce({ ...card }, now);
  if (card.dueAt !== null && card.dueAt <= now) return card;
  return { ...card, dueAt: now, updatedAt: now };
}

export function isDue(card: Card, at: number): boolean {
  return card.state !== 'new' && card.dueAt !== null && card.dueAt <= at;
}

/** Due cards, most overdue first; learning cards before known ones on ties. */
export function dueCards(cards: Iterable<Card>, at: number): Card[] {
  return [...cards]
    .filter((c) => isDue(c, at))
    .sort((a, b) => (a.dueAt! - b.dueAt!) || stateRank(a) - stateRank(b) || a.wordId.localeCompare(b.wordId));
}

function stateRank(c: Card): number {
  return c.state === 'learning' ? 0 : 1;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
