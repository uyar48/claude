// Row mapping between local records (camelCase) and Postgres rows (snake_case).
// Conflicts are resolved last-write-wins on `updatedAt` (see Store.applyRemote
// and the sync_* SQL functions).

import type { Card } from '../core/srs';
import type { LessonLogEntry } from '../core/progress';

// ---------- row mapping (snake_case in Postgres) ----------

export interface CardRow {
  word_id: string;
  state: Card['state'];
  step: number;
  ease: number;
  interval_days: number;
  reps: number;
  lapses: number;
  due_at: number | null;
  introduced_at: number | null;
  last_reviewed_at: number | null;
  updated_at: number;
}

export const cardToRow = (c: Card): CardRow => ({
  word_id: c.wordId,
  state: c.state,
  step: c.step,
  ease: c.ease,
  interval_days: c.intervalDays,
  reps: c.reps,
  lapses: c.lapses,
  due_at: c.dueAt,
  introduced_at: c.introducedAt,
  last_reviewed_at: c.lastReviewedAt,
  updated_at: c.updatedAt,
});

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export const rowToCard = (r: CardRow): Card => ({
  wordId: r.word_id,
  state: r.state,
  step: Number(r.step),
  ease: Number(r.ease),
  intervalDays: Number(r.interval_days),
  reps: Number(r.reps),
  lapses: Number(r.lapses),
  dueAt: num(r.due_at),
  introducedAt: num(r.introduced_at),
  lastReviewedAt: num(r.last_reviewed_at),
  updatedAt: Number(r.updated_at),
});

export interface LessonRow {
  id: string;
  number: number;
  date: string;
  started_at: number;
  completed_at: number | null;
  active_ms: number;
  day_ms: Record<string, number>;
  text_ids: string[];
  new_word_ids: string[];
  reviewed: number;
  correct: number;
  updated_at: number;
}

export const lessonToRow = (l: LessonLogEntry): LessonRow => ({
  id: l.id,
  number: l.number,
  date: l.date,
  started_at: l.startedAt,
  completed_at: l.completedAt,
  active_ms: l.activeMs,
  day_ms: l.dayMs,
  text_ids: l.textIds,
  new_word_ids: l.newWordIds,
  reviewed: l.reviewed,
  correct: l.correct,
  updated_at: l.updatedAt,
});

export const rowToLesson = (r: LessonRow): LessonLogEntry => ({
  id: r.id,
  number: Number(r.number ?? 0),
  date: r.date,
  startedAt: Number(r.started_at),
  completedAt: num(r.completed_at),
  activeMs: Number(r.active_ms ?? 0),
  dayMs: Object.fromEntries(Object.entries(r.day_ms ?? {}).map(([d, ms]) => [d, Number(ms)])),
  textIds: r.text_ids ?? [],
  newWordIds: r.new_word_ids ?? [],
  reviewed: Number(r.reviewed),
  correct: Number(r.correct),
  updatedAt: Number(r.updated_at),
});

// ---------- media choices (picked on /admin/review) ----------

export interface MediaChoice {
  wordId: string;
  /** Chosen candidate file, or null. */
  choice: string | null;
  /** No picture: the word is taught with emoji / sentence + audio. */
  rejected: boolean;
  updatedAt: number;
}

export interface MediaChoiceRow {
  word_id: string;
  choice: string | null;
  rejected: boolean;
  updated_at: number;
}

export const choiceToRow = (c: MediaChoice): MediaChoiceRow => ({
  word_id: c.wordId,
  choice: c.choice,
  rejected: c.rejected,
  updated_at: c.updatedAt,
});

export const rowToChoice = (r: MediaChoiceRow): MediaChoice => ({
  wordId: r.word_id,
  choice: r.choice ?? null,
  rejected: Boolean(r.rejected),
  updatedAt: Number(r.updated_at),
});

/**
 * Lessons saved by v1 have no sequence number or active time. Number them in
 * the order they were started and estimate their active time (≤ 45 min) —
 * the same rule as migration 0003, so every device agrees.
 */
export function upgradeLessons(lessons: LessonLogEntry[]): LessonLogEntry[] {
  const sorted = [...lessons].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  let n = 0;
  return sorted.map((l) => {
    n = Math.max(n + 1, l.number || 0);
    if (l.number && l.dayMs) return l;
    const est = l.completedAt === null ? 0 : Math.min(l.completedAt - l.startedAt, 45 * 60_000);
    const activeMs = l.activeMs ?? est;
    return { ...l, number: l.number || n, activeMs, dayMs: l.dayMs ?? (activeMs ? { [l.date]: activeMs } : {}) };
  });
}
