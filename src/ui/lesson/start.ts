import { content } from '../../content';
import { planLesson } from '../../core/lesson';
import { localDate } from '../../core/time';
import type { Runtime } from '../../data/runtime';
import type { LessonProgress } from '../../data/store';

export function currentPlan(rt: Runtime, now: number) {
  const s = rt.store.getState();
  return planLesson({
    content,
    cards: s.cards,
    log: s.lessons,
    now,
    tz: s.settings.timezone,
    durationMin: s.settings.lessonMinutes,
    newPerDay: s.settings.newPerDay,
  });
}

/** Resumes today's unfinished lesson, or starts a new one. */
export async function startLesson(rt: Runtime, now = Date.now()): Promise<LessonProgress> {
  const s = rt.store.getState();
  const today = localDate(now, s.settings.timezone);
  if (s.progress && s.progress.plan.date === today) return s.progress;

  const plan = currentPlan(rt, now);
  const progress: LessonProgress = {
    lessonId: crypto.randomUUID(),
    plan,
    segmentIndex: 0,
    startedAt: now,
    reviewed: 0,
    correct: 0,
    tapped: [],
  };
  await rt.store.setProgress(progress);
  await rt.store.putLesson({
    id: progress.lessonId,
    date: today,
    startedAt: now,
    completedAt: null,
    textIds: [],
    newWordIds: plan.newWordIds,
    reviewed: 0,
    correct: 0,
    updatedAt: now,
  });
  return progress;
}

/** Other unit words to use as wrong options, introduced ones first. */
export function distractors(rt: Runtime, wordId: string, n: number, seed: number): string[] {
  const cards = rt.store.getState().cards;
  const others = content.words.map((w) => w.id).filter((id) => id !== wordId);
  const score = (id: string) => ((cards.get(id)?.state ?? 'new') !== 'new' ? 0 : 1);
  const mixed = others
    .map((id, i) => ({ id, k: score(id) * 1000 + ((i * 7919 + seed * 104729) % 997) }))
    .sort((a, b) => a.k - b.k)
    .slice(0, n)
    .map((x) => x.id);
  return mixed;
}

/** Inserts the answer at a deterministic position among the distractors. */
export function withAnswer(answer: string, wrong: string[], seed: number): { ids: string[]; index: number } {
  const index = seed % (wrong.length + 1);
  const ids = [...wrong];
  ids.splice(index, 0, answer);
  return { ids, index };
}
