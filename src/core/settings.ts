import { DEFAULT_TZ } from './time.js';

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

export interface Settings {
  timezone: string;
  lessonMinutes: number;
  newPerDay: number;
  notifications: NotificationSettings;
  updatedAt: number;
}

export const LESSON_MINUTE_OPTIONS = [15, 20, 30, 45] as const;

export function defaultSettings(): Settings {
  return {
    timezone: DEFAULT_TZ,
    lessonMinutes: 30,
    newPerDay: 5,
    notifications: {
      lesson: { enabled: true, time: '19:30' },
      review: { enabled: true, time: '12:30' },
      quietHours: { start: '22:00', end: '08:00' },
    },
    updatedAt: 0,
  };
}

/** Fills missing fields (e.g. settings saved by an older app version). */
export function normalizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<Settings>;
  const n = (r.notifications ?? {}) as Partial<NotificationSettings>;
  return {
    timezone: typeof r.timezone === 'string' ? r.timezone : d.timezone,
    lessonMinutes: typeof r.lessonMinutes === 'number' ? r.lessonMinutes : d.lessonMinutes,
    newPerDay: typeof r.newPerDay === 'number' ? r.newPerDay : d.newPerDay,
    notifications: {
      lesson: { ...d.notifications.lesson, ...(n.lesson ?? {}) },
      review: { ...d.notifications.review, ...(n.review ?? {}) },
      quietHours: { ...d.notifications.quietHours, ...(n.quietHours ?? {}) },
    },
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
  };
}
