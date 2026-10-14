import { describe, expect, it } from 'vitest';
import {
  EASE_PENALTY,
  GRADUATING_INTERVAL_DAYS,
  LEARNING_STEPS,
  MIN_EASE,
  START_EASE,
  dueCards,
  introduce,
  isDue,
  markForReview,
  newCard,
  review,
  type Card,
} from './srs';
import { DAY, MINUTE } from './time';

const T0 = Date.UTC(2026, 9, 14, 9, 0); // 14 Oct 2026 12:00 Istanbul

function graduate(now = T0): Card {
  let c = introduce(newCard('coffee'), now);
  c = review(c, 'good', now + 10 * MINUTE); // step 1 → due in 1 day
  c = review(c, 'good', now + 10 * MINUTE + DAY); // graduates
  return c;
}

describe('srs: states', () => {
  it('new cards are not due and have no due date', () => {
    const c = newCard('tea');
    expect(c.state).toBe('new');
    expect(c.dueAt).toBeNull();
    expect(isDue(c, T0 + 1000 * DAY)).toBe(false);
  });

  it('introduce moves new → learning, due after the first step', () => {
    const c = introduce(newCard('tea'), T0);
    expect(c.state).toBe('learning');
    expect(c.introducedAt).toBe(T0);
    expect(c.dueAt).toBe(T0 + LEARNING_STEPS[0]);
  });

  it('introduce is idempotent for already introduced cards', () => {
    const c = introduce(newCard('tea'), T0);
    expect(introduce(c, T0 + DAY)).toBe(c);
  });

  it('learning: correct answers walk the steps, then graduate to known', () => {
    let c = introduce(newCard('tea'), T0);
    c = review(c, 'good', T0 + 10 * MINUTE);
    expect(c.state).toBe('learning');
    expect(c.step).toBe(1);
    expect(c.dueAt).toBe(T0 + 10 * MINUTE + LEARNING_STEPS[1]);

    const t2 = T0 + 10 * MINUTE + DAY;
    c = review(c, 'good', t2);
    expect(c.state).toBe('known');
    expect(c.intervalDays).toBe(GRADUATING_INTERVAL_DAYS);
    expect(c.dueAt).toBe(t2 + GRADUATING_INTERVAL_DAYS * DAY);
  });

  it('learning: a miss restarts the steps', () => {
    let c = introduce(newCard('tea'), T0);
    c = review(c, 'good', T0 + 10 * MINUTE);
    c = review(c, 'again', T0 + DAY);
    expect(c.state).toBe('learning');
    expect(c.step).toBe(0);
    expect(c.dueAt).toBe(T0 + DAY + LEARNING_STEPS[0]);
  });

  it('reviewing a new card introduces it first', () => {
    const c = review(newCard('egg'), 'good', T0);
    expect(c.state).toBe('learning');
    expect(c.step).toBe(1);
  });
});

describe('srs: intervals', () => {
  it('correct answers lengthen the interval by the ease factor', () => {
    let c = graduate();
    const intervals = [c.intervalDays];
    let t = c.dueAt!;
    for (let i = 0; i < 4; i++) {
      c = review(c, 'good', t);
      intervals.push(c.intervalDays);
      expect(c.dueAt).toBe(t + c.intervalDays * DAY);
      t = c.dueAt!;
    }
    expect(intervals).toEqual([3, 8, 20, 50, 125]);
    for (let i = 1; i < intervals.length; i++) expect(intervals[i]).toBeGreaterThan(intervals[i - 1]);
    expect(c.ease).toBe(START_EASE);
  });

  it('a wrong answer shortens the interval, lowers ease and sends the card to relearning', () => {
    let c = graduate();
    c = review(c, 'good', c.dueAt!); // 8 days
    c = review(c, 'good', c.dueAt!); // 20 days
    expect(c.intervalDays).toBe(20);
    const t = c.dueAt!;
    c = review(c, 'again', t);
    expect(c.state).toBe('learning');
    expect(c.lapses).toBe(1);
    expect(c.intervalDays).toBe(10);
    expect(c.ease).toBeCloseTo(START_EASE - EASE_PENALTY);
    expect(c.dueAt).toBe(t + LEARNING_STEPS[0]);

    // Relearning: pass the steps again and return to the shortened interval.
    c = review(c, 'good', t + 10 * MINUTE);
    c = review(c, 'good', t + 10 * MINUTE + DAY);
    expect(c.state).toBe('known');
    expect(c.intervalDays).toBe(10);
  });

  it('ease never drops below the minimum', () => {
    let c = graduate();
    for (let i = 0; i < 20; i++) {
      c = review(c, 'again', T0 + i * DAY);
      c = review(c, 'good', T0 + i * DAY + 10 * MINUTE);
      c = review(c, 'good', T0 + (i + 1) * DAY);
    }
    expect(c.ease).toBe(MIN_EASE);
  });

  it('easy grows faster than good', () => {
    const base = graduate();
    const good = review(base, 'good', base.dueAt!);
    const easy = review(base, 'easy', base.dueAt!);
    expect(easy.intervalDays).toBeGreaterThan(good.intervalDays);
  });

  it('interval is capped at one year', () => {
    let c = graduate();
    for (let i = 0; i < 12; i++) c = review(c, 'easy', c.dueAt!);
    expect(c.intervalDays).toBe(365);
  });
});

describe('srs: tapping while reading', () => {
  it('a tapped new word is introduced', () => {
    const c = markForReview(newCard('bag'), T0);
    expect(c.state).toBe('learning');
    expect(isDue(c, T0 + LEARNING_STEPS[0])).toBe(true);
  });

  it('a tapped known word becomes due now without changing its interval', () => {
    const k = graduate();
    const c = markForReview(k, T0 + 2 * DAY);
    expect(c.dueAt).toBe(T0 + 2 * DAY);
    expect(c.intervalDays).toBe(k.intervalDays);
    expect(c.ease).toBe(k.ease);
  });
});

describe('srs: queue', () => {
  it('returns due cards, most overdue first', () => {
    const a = { ...introduce(newCard('a'), T0), dueAt: T0 + 5 * MINUTE };
    const b = { ...introduce(newCard('b'), T0), dueAt: T0 + 1 * MINUTE };
    const c = { ...introduce(newCard('c'), T0), dueAt: T0 + DAY };
    const n = newCard('n');
    expect(dueCards([a, b, c, n], T0 + 10 * MINUTE).map((x) => x.wordId)).toEqual(['b', 'a']);
  });
});
