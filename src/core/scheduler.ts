// Notification scheduler. Pure: given the clock, settings and recent history it
// decides whether (and what) to send right now. The server cron calls it every
// ~10 minutes; at most one notification is returned per call.
//
// Rules
// • Each type (daily lesson, due reviews) is sent at most once per local day,
//   inside a 2-hour window after the user's chosen time.
// • Lesson reminder is skipped if today's lesson is done; review reminder is
//   skipped if nothing is due today.
// • Never during quiet hours (default 22:00–08:00, Europe/Istanbul).
// • At least 3 hours between two notifications.
// • Back-off: every 3 consecutive ignored notifications lower the frequency
//   (daily → every 2 days → every 4 days → weekly, max 1 per day). Any app use
//   resets it.

import type { NotificationSettings } from './settings.js';
import { HOUR, daysBetween, localDate, localParts, parseHm } from './time.js';

export type NotificationKind = 'lesson' | 'review' | 'test';

export interface SentNotification {
  id: string;
  kind: NotificationKind;
  sentAt: number;
  engagedAt: number | null;
}

export interface SchedulerInput {
  now: number;
  timezone: string;
  settings: NotificationSettings;
  lessonMinutes: number;
  lessonCompletedToday: boolean;
  /** Cards due before the end of the local day. */
  dueCount: number;
  history: readonly SentNotification[];
}

export interface PlannedNotification {
  kind: 'lesson' | 'review';
  title: string;
  body: string;
  url: string;
  tag: string;
  backoffLevel: number;
}

export const SEND_WINDOW_MINUTES = 120;
export const MIN_GAP_MS = 3 * HOUR;
/** A notification without app activity for this long counts as ignored. */
export const IGNORE_AFTER_MS = 12 * HOUR;
/** App activity this soon after a notification counts as engagement. */
export const ENGAGE_WINDOW_MS = 24 * HOUR;
export const IGNORED_PER_LEVEL = 3;
/** Minimum local days between notifications per back-off level. */
export const MIN_DAYS_BY_LEVEL = [0, 2, 4, 7];

export function inQuietHours(minutes: number, quiet: { start: string; end: string }): boolean {
  const s = parseHm(quiet.start);
  const e = parseHm(quiet.end);
  if (s === e) return false;
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

/** Marks notifications as engaged when the app was used after them. */
export function applyEngagement(
  history: readonly SentNotification[],
  lastActiveAt: number | null,
): SentNotification[] {
  return history.map((n) => {
    if (n.engagedAt !== null || lastActiveAt === null || n.kind === 'test') return n;
    if (lastActiveAt >= n.sentAt && lastActiveAt - n.sentAt <= ENGAGE_WINDOW_MS) {
      return { ...n, engagedAt: lastActiveAt };
    }
    return n;
  });
}

/** Consecutive ignored notifications, newest first; stops at the first engaged one. */
export function ignoredStreak(history: readonly SentNotification[], now: number): number {
  const sorted = history.filter((n) => n.kind !== 'test').sort((a, b) => b.sentAt - a.sentAt);
  let count = 0;
  for (const n of sorted) {
    if (n.engagedAt !== null) break;
    if (now - n.sentAt < IGNORE_AFTER_MS) continue; // still pending
    count++;
  }
  return count;
}

export function backoffLevel(history: readonly SentNotification[], now: number): number {
  return Math.min(MIN_DAYS_BY_LEVEL.length - 1, Math.floor(ignoredStreak(history, now) / IGNORED_PER_LEVEL));
}

export function decide(input: SchedulerInput): PlannedNotification | null {
  const { now, timezone: tz, settings } = input;
  const local = localParts(now, tz);
  if (inQuietHours(local.minutes, settings.quietHours)) return null;

  const sent = input.history.filter((n) => n.kind !== 'test').sort((a, b) => b.sentAt - a.sentAt);
  const sentToday = sent.filter((n) => localDate(n.sentAt, tz) === local.date);
  const level = backoffLevel(input.history, now);
  const dailyCap = level === 0 ? 2 : 1;
  if (sentToday.length >= dailyCap) return null;

  const last = sent[0];
  if (last && now - last.sentAt < MIN_GAP_MS) return null;
  if (level > 0 && last && daysBetween(localDate(last.sentAt, tz), local.date) < MIN_DAYS_BY_LEVEL[level]) {
    return null;
  }

  const candidates: Array<{ kind: 'lesson' | 'review'; at: number }> = [];
  for (const kind of ['lesson', 'review'] as const) {
    const setting = settings[kind];
    if (!setting.enabled) continue;
    const at = parseHm(setting.time);
    if (local.minutes < at || local.minutes >= at + SEND_WINDOW_MINUTES) continue;
    if (sentToday.some((n) => n.kind === kind)) continue;
    if (kind === 'lesson' && input.lessonCompletedToday) continue;
    if (kind === 'review' && input.dueCount <= 0) continue;
    candidates.push({ kind, at });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.at - b.at);
  return compose(candidates[0].kind, input, level);
}

export function compose(kind: 'lesson' | 'review', input: SchedulerInput, level: number): PlannedNotification {
  const tag = `okuma-${kind}`;
  if (level > 0) {
    return {
      kind,
      tag,
      url: '/?from=push',
      backoffLevel: level,
      title: 'Kaldığın yerden devam',
      body: 'Ara vermek sorun değil. Hazır olduğunda kısa bir dersle devam edebilirsin.',
    };
  }
  if (kind === 'lesson') {
    return {
      kind,
      tag,
      url: '/?from=push',
      backoffLevel: level,
      title: 'Bugünkü dersin hazır',
      body:
        input.dueCount > 0
          ? `${input.dueCount} tekrar ve yeni kelimeler. Yaklaşık ${input.lessonMinutes} dakika.`
          : `Yaklaşık ${input.lessonMinutes} dakika. Hazır olduğunda başla.`,
    };
  }
  return {
    kind,
    tag,
    url: '/?from=push',
    backoffLevel: level,
    title: 'Tekrar zamanı',
    body: `${input.dueCount} kelime tekrar için hazır. Birkaç dakika yeter.`,
  };
}
