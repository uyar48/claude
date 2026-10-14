// Row mapping between local records (camelCase) and Postgres rows (snake_case).
// Conflicts are resolved last-write-wins on `updatedAt` (see Store.applyRemote
// and the sync_* SQL functions).

import type { Card } from '../core/srs';
import type { LessonLogEntry } from '../core/lesson';

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
  date: string;
  started_at: number;
  completed_at: number | null;
  text_ids: string[];
  new_word_ids: string[];
  reviewed: number;
  correct: number;
  updated_at: number;
}

export const lessonToRow = (l: LessonLogEntry): LessonRow => ({
  id: l.id,
  date: l.date,
  started_at: l.startedAt,
  completed_at: l.completedAt,
  text_ids: l.textIds,
  new_word_ids: l.newWordIds,
  reviewed: l.reviewed,
  correct: l.correct,
  updated_at: l.updatedAt,
});

export const rowToLesson = (r: LessonRow): LessonLogEntry => ({
  id: r.id,
  date: r.date,
  startedAt: Number(r.started_at),
  completedAt: num(r.completed_at),
  textIds: r.text_ids ?? [],
  newWordIds: r.new_word_ids ?? [],
  reviewed: Number(r.reviewed),
  correct: Number(r.correct),
  updatedAt: Number(r.updated_at),
});
