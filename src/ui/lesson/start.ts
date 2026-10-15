import { course } from '../../content';
import { mediaUrls } from '../../content/media';
import { planNextLesson, type LessonLogEntry, type NextLesson } from '../../core/progress';
import { createSession } from '../../core/session';
import { localDate } from '../../core/time';
import type { Runtime } from '../../data/runtime';
import type { LessonProgress } from '../../data/store';
import { cacheMedia } from '../../push/precache';

export function nextLesson(rt: Runtime, now = Date.now()): NextLesson {
  const s = rt.store.getState();
  return planNextLesson({
    course,
    cards: s.cards,
    log: s.lessons,
    now,
    tz: s.settings.timezone,
    newPerLesson: s.settings.newPerLesson,
  });
}

/**
 * Resumes the lesson in progress, or starts the next one in the sequence.
 * There is no daily limit: a finished lesson is followed by the next at once.
 * Starting a lesson also ends a break ("Ara ver").
 */
export async function startLesson(rt: Runtime, now = Date.now()): Promise<LessonProgress> {
  const s = rt.store.getState();
  if (s.progress) return s.progress;
  if (s.settings.paused) await rt.store.updateSettings((x) => ({ ...x, paused: false, pausedAt: null }));

  const plan = nextLesson(rt, now);
  const id = plan.resumeId ?? crypto.randomUUID();
  const session = createSession({
    id,
    number: plan.number,
    targetMinutes: s.settings.goalMinutes,
    newWords: plan.newWords,
    reviewWords: plan.reviewWords,
  });
  const progress: LessonProgress = { lessonId: id, number: plan.number, startedAt: now, session, current: null, tapped: [] };
  await rt.store.setProgress(progress);
  if (!plan.resumeId) {
    const entry: LessonLogEntry = {
      id,
      number: plan.number,
      date: localDate(now, s.settings.timezone),
      startedAt: now,
      completedAt: null,
      activeMs: 0,
      dayMs: {},
      textIds: [],
      newWordIds: [],
      reviewed: 0,
      correct: 0,
      updatedAt: now,
    };
    await rt.store.putLesson(entry);
  }
  void cacheMedia(lessonMedia(rt, plan));
  return progress;
}

/** Media of a lesson: its words, the texts it may read, recently learned words. */
export function lessonMedia(rt: Runtime, plan: NextLesson): string[] {
  const s = rt.store.getState();
  const recent = [...s.cards.values()]
    .filter((c) => c.state !== 'new')
    .sort((a, b) => (b.introducedAt ?? 0) - (a.introducedAt ?? 0))
    .slice(0, 30)
    .map((c) => c.wordId);
  const maxOrder = Math.max(0, ...plan.newWords.map((w) => course.words[w]?.order ?? 0));
  const texts = course.texts.filter((t) => t.maxOrder <= maxOrder).map((t) => t.id);
  return mediaUrls([...plan.newWords, ...plan.reviewWords, ...recent], texts, s.mediaChoices);
}
