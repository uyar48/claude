import { DEFAULT_TZ } from './time.js';
import { GOAL_OPTIONS, NEW_WORDS_DEFAULT, clampNewWords } from './progress.js';

export interface NotificationTypeSetting {
  enabled: boolean;
  /** Local time "HH:MM". */
  time: string;
}

export interface NotificationSettings {
  lesson: NotificationTypeSetting;
  review: NotificationTypeSetting;
  quietHours: { start: string; end: string };
}

/** Result of a unit test (scores are right answers). */
export interface UnitTestResult {
  score: number;
  total: number;
  best: number;
  tries: number;
  at: number;
}

export interface Settings {
  timezone: string;
  /** Daily goal in active minutes (20 / 30 / 45); also the length of one lesson. */
  goalMinutes: number;
  /** New words per lesson (6–15). */
  newPerLesson: number;
  /** "Ara ver": no notifications, no time limit. */
  paused: boolean;
  pausedAt: number | null;
  /** Grammar cards already shown (ids). */
  grammarSeen: string[];
  /** Unit test results by unit number. */
  unitTests: Record<string, UnitTestResult>;
  notifications: NotificationSettings;
  updatedAt: number;
}

export { GOAL_OPTIONS };

export function defaultSettings(): Settings {
  return {
    timezone: DEFAULT_TZ,
    goalMinutes: 30,
    newPerLesson: NEW_WORDS_DEFAULT,
    paused: false,
    pausedAt: null,
    grammarSeen: [],
    unitTests: {},
    notifications: {
      lesson: { enabled: true, time: '19:30' },
      review: { enabled: true, time: '12:30' },
      quietHours: { start: '22:00', end: '08:00' },
    },
    updatedAt: 0,
  };
}

/** Nearest allowed goal (old 15-minute lessons become 20). */
export function normalizeGoal(n: unknown, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return GOAL_OPTIONS.reduce((best, g) => (Math.abs(g - n) < Math.abs(best - n) ? g : best), GOAL_OPTIONS[0]);
}

/** Fills missing fields and migrates settings saved by an older app version. */
export function normalizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<Settings> & { lessonMinutes?: number; newPerDay?: number };
  const n = (r.notifications ?? {}) as Partial<NotificationSettings>;
  return {
    timezone: typeof r.timezone === 'string' ? r.timezone : d.timezone,
    goalMinutes: normalizeGoal(r.goalMinutes ?? r.lessonMinutes, d.goalMinutes),
    // v1 stored "newPerDay" (5); v2 starts everyone on the new default.
    newPerLesson: typeof r.newPerLesson === 'number' ? clampNewWords(r.newPerLesson) : d.newPerLesson,
    paused: r.paused === true,
    pausedAt: typeof r.pausedAt === 'number' ? r.pausedAt : null,
    grammarSeen: Array.isArray(r.grammarSeen) ? r.grammarSeen.filter((x): x is string => typeof x === 'string') : [],
    unitTests: normalizeUnitTests(r.unitTests),
    notifications: {
      lesson: { ...d.notifications.lesson, ...(n.lesson ?? {}) },
      review: { ...d.notifications.review, ...(n.review ?? {}) },
      quietHours: { ...d.notifications.quietHours, ...(n.quietHours ?? {}) },
    },
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
  };
}

function normalizeUnitTests(raw: unknown): Record<string, UnitTestResult> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, UnitTestResult> = {};
  for (const [unit, v] of Object.entries(raw as Record<string, Partial<UnitTestResult>>)) {
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
    if (!v || typeof v !== 'object' || !(num(v.total) > 0)) continue;
    out[unit] = { score: num(v.score), total: num(v.total), best: Math.max(num(v.best), num(v.score)), tries: num(v.tries), at: num(v.at) };
  }
  return out;
}
