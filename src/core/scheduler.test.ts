import { describe, expect, it } from 'vitest';
import {
  IGNORE_AFTER_MS,
  applyEngagement,
  backoffLevel,
  decide,
  ignoredStreak,
  inQuietHours,
  type SchedulerInput,
  type SentNotification,
} from './scheduler';
import { defaultSettings } from './settings';
import { DAY, HOUR, MINUTE, parseHm } from './time';

const TZ = 'Europe/Istanbul';
/** Epoch ms for a given Istanbul wall-clock time (UTC+3, no DST). */
function ist(date: string, hm: string): number {
  return Date.parse(`${date}T00:00:00Z`) + parseHm(hm) * MINUTE - 3 * HOUR;
}

function input(over: Partial<SchedulerInput> = {}): SchedulerInput {
  const s = defaultSettings();
  return {
    now: ist('2026-10-14', '19:35'),
    timezone: TZ,
    settings: s.notifications,
    lessonMinutes: 30,
    lessonCompletedToday: false,
    dueCount: 4,
    history: [],
    ...over,
  };
}

let seq = 0;
function sent(kind: 'lesson' | 'review' | 'test', at: number, engagedAt: number | null = null): SentNotification {
  return { id: `n${seq++}`, kind, sentAt: at, engagedAt };
}

describe('quiet hours', () => {
  const q = { start: '22:00', end: '08:00' };
  it('wraps past midnight', () => {
    expect(inQuietHours(parseHm('21:59'), q)).toBe(false);
    expect(inQuietHours(parseHm('22:00'), q)).toBe(true);
    expect(inQuietHours(parseHm('03:00'), q)).toBe(true);
    expect(inQuietHours(parseHm('07:59'), q)).toBe(true);
    expect(inQuietHours(parseHm('08:00'), q)).toBe(false);
  });
  it('supports same-day ranges and disabled (start = end)', () => {
    expect(inQuietHours(parseHm('13:30'), { start: '13:00', end: '14:00' })).toBe(true);
    expect(inQuietHours(parseHm('14:00'), { start: '13:00', end: '14:00' })).toBe(false);
    expect(inQuietHours(parseHm('03:00'), { start: '00:00', end: '00:00' })).toBe(false);
  });
});

describe('daily lesson reminder', () => {
  it('fires inside the window after the chosen time', () => {
    const d = decide(input());
    expect(d?.kind).toBe('lesson');
    expect(d?.title).toBe('Bugünkü dersin hazır');
    expect(d?.body).toContain('4 tekrar');
  });

  it('uses Istanbul local time regardless of server zone', () => {
    // 16:35 UTC = 19:35 Istanbul
    expect(decide(input({ now: Date.UTC(2026, 9, 14, 16, 35) }))?.kind).toBe('lesson');
    // 19:35 UTC = 22:35 Istanbul → quiet
    expect(decide(input({ now: Date.UTC(2026, 9, 14, 19, 35) }))).toBeNull();
  });

  it('does not fire before the chosen time or after the window', () => {
    expect(decide(input({ now: ist('2026-10-14', '19:29') }))).toBeNull();
    expect(decide(input({ now: ist('2026-10-14', '21:30'), settings: { ...defaultSettings().notifications, quietHours: { start: '23:00', end: '08:00' } } }))).toBeNull();
  });

  it('is sent at most once per day', () => {
    const now = ist('2026-10-14', '19:50');
    const history = [sent('lesson', ist('2026-10-14', '19:30'))];
    expect(decide(input({ now, history }))).toBeNull();
  });

  it('is skipped when today’s lesson is already done', () => {
    expect(decide(input({ lessonCompletedToday: true, dueCount: 0 }))).toBeNull();
  });

  it('respects the per-type switch', () => {
    const s = defaultSettings().notifications;
    expect(decide(input({ settings: { ...s, lesson: { ...s.lesson, enabled: false } } }))).toBeNull();
  });

  it('never fires during quiet hours even if the chosen time is inside them', () => {
    const s = defaultSettings().notifications;
    const settings = { ...s, lesson: { enabled: true, time: '23:00' } };
    expect(decide(input({ settings, now: ist('2026-10-14', '23:05') }))).toBeNull();
  });

  it('respects custom quiet hours', () => {
    const s = defaultSettings().notifications;
    const settings = { ...s, quietHours: { start: '19:00', end: '07:00' } };
    expect(decide(input({ settings }))).toBeNull();
  });
});

describe('due review reminder', () => {
  it('fires at the review time when cards are due', () => {
    const d = decide(input({ now: ist('2026-10-14', '12:40'), dueCount: 6 }));
    expect(d?.kind).toBe('review');
    expect(d?.body).toBe('6 kelime tekrar için hazır. Birkaç dakika yeter.');
  });

  it('does not fire when nothing is due', () => {
    expect(decide(input({ now: ist('2026-10-14', '12:40'), dueCount: 0 }))).toBeNull();
  });

  it('keeps 3 hours between notifications', () => {
    const s = defaultSettings().notifications;
    const settings = { ...s, review: { enabled: true, time: '18:00' } };
    const history = [sent('review', ist('2026-10-14', '18:00'))];
    expect(decide(input({ settings, history, now: ist('2026-10-14', '19:35') }))).toBeNull();
    // review at 16:00, lesson at 19:30 → 3.5h gap is fine
    const history2 = [sent('review', ist('2026-10-14', '16:00'))];
    expect(decide(input({ settings, history: history2, now: ist('2026-10-14', '19:35') }))?.kind).toBe('lesson');
  });

  it('ignores test notifications for caps and gaps', () => {
    const history = [sent('test', ist('2026-10-14', '19:20'))];
    expect(decide(input({ history }))?.kind).toBe('lesson');
  });
});

describe('back-off after ignored notifications', () => {
  /** n lesson reminders on consecutive days before 2026-10-14, all ignored. */
  function ignoredDays(n: number, endDate = '2026-10-13'): SentNotification[] {
    const end = ist(endDate, '19:30');
    return Array.from({ length: n }, (_, i) => sent('lesson', end - i * DAY));
  }

  it('counts consecutive ignored notifications, newest first', () => {
    const now = ist('2026-10-14', '19:35');
    expect(ignoredStreak(ignoredDays(2), now)).toBe(2);
    const h = [...ignoredDays(2), sent('lesson', ist('2026-10-11', '19:30'), ist('2026-10-11', '20:00'))];
    expect(ignoredStreak(h, now)).toBe(2);
  });

  it('a recent notification is pending, not ignored', () => {
    const now = ist('2026-10-14', '19:35');
    const h = [sent('lesson', now - (IGNORE_AFTER_MS - MINUTE))];
    expect(ignoredStreak(h, now)).toBe(0);
  });

  it('2 ignored → still daily', () => {
    expect(decide(input({ history: ignoredDays(2) }))?.kind).toBe('lesson');
  });

  it('3 ignored in a row → frequency drops to every other day', () => {
    const history = ignoredDays(3); // last one sent yesterday
    expect(backoffLevel(history, ist('2026-10-14', '19:35'))).toBe(1);
    expect(decide(input({ history }))).toBeNull();
    // the day after, it may send again, with a gentle text
    const d = decide(input({ history, now: ist('2026-10-15', '19:35') }));
    expect(d?.kind).toBe('lesson');
    expect(d?.title).toBe('Kaldığın yerden devam');
    expect(d?.body).not.toMatch(/kaçırdın|unuttun/i);
  });

  it('at a reduced level only one notification per day', () => {
    const history = ignoredDays(3, '2026-10-12');
    const morning = sent('review', ist('2026-10-14', '12:30'));
    expect(decide(input({ history: [...history, morning] }))).toBeNull();
  });

  it('6 and 9 ignored → every 4 days, then weekly', () => {
    const now = ist('2026-10-14', '19:35');
    expect(backoffLevel(ignoredDays(6), now)).toBe(2);
    expect(backoffLevel(ignoredDays(9), now)).toBe(3);
    expect(backoffLevel(ignoredDays(30), now)).toBe(3);
    const h6 = ignoredDays(6, '2026-10-11'); // last sent 3 days ago
    expect(decide(input({ history: h6 }))).toBeNull();
    expect(decide(input({ history: h6, now: ist('2026-10-15', '19:35') }))?.kind).toBe('lesson');
  });

  it('using the app resets the back-off', () => {
    const history = ignoredDays(3);
    const engaged = applyEngagement(history, ist('2026-10-13', '21:00'));
    expect(ignoredStreak(engaged, ist('2026-10-14', '19:35'))).toBe(0);
    expect(decide(input({ history: engaged }))?.title).toBe('Bugünkü dersin hazır');
  });

  it('engagement only counts activity after the notification', () => {
    const n = sent('lesson', ist('2026-10-13', '19:30'));
    expect(applyEngagement([n], ist('2026-10-13', '18:00'))[0].engagedAt).toBeNull();
    expect(applyEngagement([n], ist('2026-10-13', '19:45'))[0].engagedAt).toBe(ist('2026-10-13', '19:45'));
    expect(applyEngagement([n], ist('2026-10-15', '19:45'))[0].engagedAt).toBeNull();
  });
});

describe('message tone', () => {
  it('is short, Turkish and never blaming', () => {
    const msgs = [
      decide(input()),
      decide(input({ dueCount: 0 })),
      decide(input({ now: ist('2026-10-14', '12:40') })),
    ];
    for (const m of msgs) {
      expect(m).not.toBeNull();
      expect(m!.title.length).toBeLessThanOrEqual(30);
      expect(m!.body.length).toBeLessThanOrEqual(90);
      expect(`${m!.title} ${m!.body}`).not.toMatch(/kaçırdın|unuttun|yine|neden|maalesef/i);
    }
  });
});
