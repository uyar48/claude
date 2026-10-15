import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { course, getText, getWord } from '../../content';
import { addActive, goalDays, minutesOn, streakInfo } from '../../core/progress';
import {
  distinctTypes,
  finalGrades,
  nextExercise,
  recordAnswer,
  type ExerciseType,
  type SessionContext,
  type SessionState,
} from '../../core/session';
import { localDate } from '../../core/time';
import { speaker } from '../../audio/speaker';
import { IconClose } from '../components/Icons';
import { Picture, useHasPhoto } from '../components/Picture';
import { EXERCISE_LABEL, ExerciseView } from '../exercises/ExerciseView';
import type { ExerciseOutcome } from '../exercises/types';
import { useAppState, useRuntime } from '../hooks';
import { startLesson } from '../lesson/start';

/** Longest time one exercise may count as active (idle time is not learning). */
const CAP_MS: Partial<Record<ExerciseType, number>> = {
  reading: 8 * 60_000,
  scene: 3 * 60_000,
  match: 3 * 60_000,
  'build-sentence': 2 * 60_000,
  'speed-round': 90_000,
};
const DEFAULT_CAP_MS = 90_000;

/** Visible time since start() — the clock stops while the app is in the background. */
function useActiveClock() {
  const acc = useRef(0);
  const since = useRef<number | null>(null);
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden' && since.current !== null) {
        acc.current += performance.now() - since.current;
        since.current = null;
      } else if (document.visibilityState === 'visible' && since.current === null) {
        since.current = performance.now();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  return useMemo(
    () => ({
      start() {
        acc.current = 0;
        since.current = document.visibilityState === 'hidden' ? null : performance.now();
      },
      read() {
        return acc.current + (since.current === null ? 0 : performance.now() - since.current);
      },
    }),
    [],
  );
}

interface Finished {
  number: number;
  session: SessionState;
  minutes: number;
  questions: { correct: number; total: number };
}

export function LessonScreen() {
  const rt = useRuntime();
  const state = useAppState();
  const navigate = useNavigate();
  const hasPhoto = useHasPhoto();
  const clock = useActiveClock();
  const [finished, setFinished] = useState<Finished | null>(null);
  const questions = useRef({ correct: 0, total: 0 });
  const advancing = useRef(false);
  const answering = useRef(false);
  const progress = state.progress;

  const ctx = useCallback(
    (): SessionContext => ({ course, cards: rt.store.getState().cards, hasVisual: hasPhoto }),
    [rt, hasPhoto],
  );

  const finish = useCallback(
    async (session: SessionState) => {
      const p = rt.store.getState().progress;
      if (!p) return;
      for (const g of finalGrades(session)) await rt.store.grade(g.wordId, g.grade, 'lesson');
      const now = Date.now();
      const entry = rt.store.getState().lessons.find((l) => l.id === p.lessonId);
      if (entry) {
        await rt.store.putLesson({
          ...entry,
          completedAt: now,
          newWordIds: session.introduced,
          textIds: session.usedTexts,
          updatedAt: now,
        });
      }
      setFinished({ number: p.number, session, minutes: session.activeMs / 60_000, questions: questions.current });
      questions.current = { correct: 0, total: 0 };
      await rt.store.setProgress(null);
      void rt.sync?.sync();
    },
    [rt],
  );

  /** Shows the next exercise, or ends the lesson. */
  const advance = useCallback(
    async (session: SessionState) => {
      const step = nextExercise(session, ctx());
      const p = rt.store.getState().progress;
      if (!p) return;
      if (!step.exercise) return finish(step.state);
      await rt.store.setProgress({ ...p, session: step.state, current: step.exercise });
      if (step.exercise.type === 'intro') await rt.store.introduceWords([step.exercise.wordId!]);
      clock.start();
      window.scrollTo(0, 0);
    },
    [rt, ctx, finish, clock],
  );

  useEffect(() => {
    if (finished) return;
    if (!progress) {
      navigate('/', { replace: true });
      return;
    }
    if (!progress.current && !advancing.current) {
      advancing.current = true;
      void advance(progress.session).finally(() => (advancing.current = false));
    }
  }, [progress, finished, navigate, advance]);

  // A resumed exercise starts its clock when shown.
  const currentKey = progress?.current?.key;
  useEffect(() => {
    if (currentKey) clock.start();
  }, [currentKey, clock]);

  useEffect(() => () => speaker.stop(), []);

  async function onDone(out: ExerciseOutcome) {
    const p = rt.store.getState().progress;
    if (!p?.current || answering.current) return;
    answering.current = true;
    try {
      const ex = p.current;
      const ms = Math.min(CAP_MS[ex.type] ?? DEFAULT_CAP_MS, clock.read());
      const { state: session, grades } = recordAnswer(p.session, ex, { correct: out.correct, ms, perWord: out.perWord });
      for (const g of grades) await rt.store.grade(g.wordId, g.grade, 'lesson');
      if (out.questions) {
        questions.current = {
          correct: questions.current.correct + out.questions.correct,
          total: questions.current.total + out.questions.total,
        };
      }

      const now = Date.now();
      const s = rt.store.getState();
      const entry = s.lessons.find((l) => l.id === p.lessonId);
      if (entry) {
        const graded = out.correct !== null ? 1 : Object.keys(out.perWord ?? {}).length;
        const right = out.correct === true ? 1 : Object.values(out.perWord ?? {}).filter(Boolean).length;
        await rt.store.putLesson({
          ...addActive(entry, ms, localDate(now, s.settings.timezone)),
          reviewed: entry.reviewed + graded,
          correct: entry.correct + right,
          textIds: ex.textId ? [...new Set([...entry.textIds, ex.textId])] : entry.textIds,
          updatedAt: now,
        });
      }
      await rt.store.setProgress({
        ...p,
        session,
        current: null,
        tapped: [...new Set([...p.tapped, ...(out.tapped ?? [])])],
      });
    } finally {
      answering.current = false;
    }
  }

  async function oneMore() {
    speaker.unlock();
    // Start first, so the screen never sees "no lesson" in between.
    await startLesson(rt);
    setFinished(null);
  }

  if (finished) {
    return <FinishScreen info={finished} onMore={oneMore} onEnough={() => navigate('/', { replace: true })} />;
  }
  if (!progress) return null;

  const { session } = progress;
  const left = Math.max(0, session.targetMs - session.activeMs);
  return (
    <div className="screen lesson">
      <header className="lesson-head">
        <button className="icon-btn" aria-label="Dersi duraklat" onClick={() => navigate('/')}>
          <IconClose />
        </button>
        <div className="time-bar" aria-label="Ders ilerlemesi">
          <span style={{ width: `${Math.min(100, (session.activeMs / session.targetMs) * 100)}%` }} />
        </div>
        <span className="muted small time-left">~{Math.max(1, Math.round(left / 60_000))} dk</span>
      </header>
      {progress.current && (
        <>
          <p className="ex-label muted small">
            {progress.number}. ders · {EXERCISE_LABEL[progress.current.type]}
          </p>
          <ExerciseView key={progress.current.key} ex={progress.current} onDone={(o) => void onDone(o)} />
        </>
      )}
    </div>
  );
}

function FinishScreen({ info, onMore, onEnough }: { info: Finished; onMore: () => void; onEnough: () => void }) {
  const state = useAppState();
  const [starting, setStarting] = useState(false);
  const tz = state.settings.timezone;
  const today = localDate(Date.now(), tz);
  const goal = state.settings.goalMinutes;
  const todayMin = minutesOn(state.lessons, today);
  const streak = streakInfo(goalDays(state.lessons, goal), today);
  const { session } = info;
  const graded = session.history.filter((h) => h.correct !== null);
  const right = graded.filter((h) => h.correct).length;
  const types = distinctTypes(session).filter((t) => t !== 'intro');

  return (
    <div className="screen finish">
      <div className="panel">
        <p className="eyebrow">{info.number}. ders tamam</p>
        <h1>Güzel iş!</h1>
        <ul className="stats">
          <li>
            <strong>{Math.round(info.minutes)} dk</strong> çalıştın · {types.length} farklı alıştırma
          </li>
          {session.introduced.length > 0 && (
            <li>
              <strong>{session.introduced.length}</strong> yeni kelime
            </li>
          )}
          {graded.length > 0 && (
            <li>
              <strong>
                {right} / {graded.length}
              </strong>{' '}
              doğru cevap
            </li>
          )}
          {session.usedTexts.map((id) => (
            <li key={id}>
              Okunan metin: <strong lang="en">{getText(id).title}</strong>
            </li>
          ))}
          {info.questions.total > 0 && (
            <li>
              Okuma soruları: <strong>{info.questions.correct} / {info.questions.total}</strong>
            </li>
          )}
          <li>
            Bugün: <strong>{Math.round(todayMin)} / {goal} dk</strong>
            {todayMin >= goal ? ' · günlük hedef tamam' : ''}
          </li>
          {streak.days > 0 && (
            <li>
              Seri: <strong>{streak.days} gün</strong>
              {streak.frozen > 0 && <span className="muted"> · ara verdiğin günler seriyi bozmadı</span>}
            </li>
          )}
        </ul>
      </div>
      {session.introduced.length > 0 && (
        <div className="mini-grid">
          {session.introduced.map((id) => (
            <div key={id} className="mini-word">
              <Picture wordId={id} size="sm" />
              <span lang="en">{getWord(id).en}</span>
              <span className="muted tiny">{getWord(id).tr}</span>
            </div>
          ))}
        </div>
      )}
      <div className="stack">
        <button
          className="btn btn-primary wide big"
          disabled={starting}
          onClick={() => {
            setStarting(true);
            onMore();
          }}
        >
          Bir ders daha
        </button>
        <button className="btn btn-secondary wide big" onClick={onEnough}>
          Bugünlük bu kadar
        </button>
      </div>
    </div>
  );
}
