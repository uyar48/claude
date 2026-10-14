import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getText, getWord } from '../../content';
import { lessonMediaUrls } from '../../content/media';
import type { SegmentKind } from '../../core/lesson';
import { streak } from '../../core/streak';
import { DAY, localDate } from '../../core/time';
import type { LessonProgress } from '../../data/store';
import { cacheMedia } from '../../push/precache';
import { speaker } from '../../audio/speaker';
import { IconClose } from '../components/Icons';
import { Picture } from '../components/Picture';
import { percent } from '../format';
import { useAppState, useRuntime } from '../hooks';
import { NewWordsStep } from '../lesson/NewWordsStep';
import { QuizStep } from '../lesson/QuizStep';
import { ReadingStep } from '../lesson/ReadingStep';
import { ReviewStep } from '../lesson/ReviewStep';
import { currentPlan } from '../lesson/start';

export const SEGMENT_LABEL: Record<SegmentKind, string> = {
  review: 'Tekrar',
  new: 'Yeni kelimeler',
  reading: 'Okuma ve dinleme',
  quiz: 'Mini sınav',
  summary: 'Özet',
};

interface Extra {
  textIds: string[];
  quiz: { correct: number; total: number } | null;
  blanks: { firstTry: number; total: number } | null;
}

export function LessonScreen() {
  const rt = useRuntime();
  const { progress } = useAppState();
  const navigate = useNavigate();
  const [extra, setExtra] = useState<Extra>({ textIds: [], quiz: null, blanks: null });

  useEffect(() => {
    if (!progress) navigate('/', { replace: true });
  }, [progress, navigate]);
  useEffect(() => () => speaker.stop(), []);
  if (!progress) return null;

  const { plan } = progress;
  const seg = plan.segments[progress.segmentIndex];

  async function advance(patch: Partial<LessonProgress> = {}) {
    const p = rt.store.getState().progress!;
    await rt.store.setProgress({ ...p, ...patch, segmentIndex: p.segmentIndex + 1 });
    window.scrollTo(0, 0);
  }

  return (
    <div className="screen lesson">
      <header className="lesson-head">
        <button className="icon-btn" aria-label="Dersi duraklat" onClick={() => navigate('/')}>
          <IconClose />
        </button>
        <div className="segments" aria-label="Ders bölümleri">
          {plan.segments.map((s, i) => (
            <span
              key={s.kind}
              className={`seg ${i < progress.segmentIndex ? 'done' : i === progress.segmentIndex ? 'now' : ''}`}
              style={{ flexGrow: s.minutes }}
              title={SEGMENT_LABEL[s.kind]}
            />
          ))}
        </div>
      </header>
      <div className="seg-title">
        <h1>{SEGMENT_LABEL[seg.kind]}</h1>
        <span className="muted small">~{seg.minutes} dk</span>
      </div>

      {seg.kind === 'review' && (
        <ReviewStep
          wordIds={plan.reviewWordIds}
          onDone={(s) => advance({ reviewed: progress.reviewed + s.reviewed, correct: progress.correct + s.correct })}
        />
      )}
      {seg.kind === 'new' && <NewWordsStep wordIds={plan.newWordIds} onDone={() => advance()} />}
      {seg.kind === 'reading' && plan.textId && (
        <ReadingStep
          textId={plan.textId}
          extraTextIds={plan.extraTextIds}
          onDone={(r) => {
            setExtra((e) => ({ ...e, textIds: r.textIds, blanks: { firstTry: r.blanksFirstTry, total: r.blanksTotal } }));
            void advance({ tapped: [...new Set([...progress.tapped, ...r.tapped])] });
          }}
        />
      )}
      {seg.kind === 'quiz' && plan.textId && (
        <QuizStep
          textId={plan.textId}
          newWordIds={plan.newWordIds}
          onDone={(q) => {
            setExtra((e) => ({ ...e, quiz: q }));
            void advance();
          }}
        />
      )}
      {seg.kind === 'summary' && <Summary progress={progress} extra={extra} />}
    </div>
  );
}

function Summary({ progress, extra }: { progress: LessonProgress; extra: Extra }) {
  const rt = useRuntime();
  const state = useAppState();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const { plan } = progress;
  const tz = state.settings.timezone;
  const today = localDate(Date.now(), tz);
  const textIds = extra.textIds.length ? extra.textIds : plan.textId ? [plan.textId] : [];
  const dates = state.lessons.filter((l) => l.completedAt !== null).map((l) => l.date);
  const newStreak = streak([...dates, today], today);

  async function finish() {
    setSaving(true);
    const now = Date.now();
    await rt.store.putLesson({
      id: progress.lessonId,
      date: today,
      startedAt: progress.startedAt,
      completedAt: now,
      textIds,
      newWordIds: plan.newWordIds,
      reviewed: progress.reviewed,
      correct: progress.correct,
      updatedAt: now,
    });
    await rt.store.setProgress(null);
    void rt.sync?.sync();
    // Pre-cache tomorrow's lesson media for offline use.
    const next = currentPlan(rt, now + DAY);
    void cacheMedia(lessonMediaUrls(next)).then((r) =>
      rt.store.kvSet('offlineReady', { date: next.date, ...r }),
    );
    navigate('/', { replace: true });
  }

  return (
    <div className="step summary">
      <div className="panel">
        <h2>Bugünkü ders tamam.</h2>
        <ul className="stats">
          {plan.reviewWordIds.length > 0 && (
            <li>
              <strong>{progress.reviewed}</strong> tekrar
              {progress.reviewed > 0 && <span className="muted"> · {percent(progress.correct / progress.reviewed)} doğru</span>}
            </li>
          )}
          {plan.newWordIds.length > 0 && (
            <li>
              <strong>{plan.newWordIds.length}</strong> yeni kelime
            </li>
          )}
          {textIds.map((id) => (
            <li key={id}>
              Okunan metin: <strong lang="en">{getText(id).title}</strong>
            </li>
          ))}
          {extra.quiz && (
            <li>
              Mini sınav: <strong>{extra.quiz.correct} / {extra.quiz.total}</strong>
            </li>
          )}
          {progress.tapped.length > 0 && (
            <li>
              Dokunarak baktığın kelimeler tekrar listende: <span lang="en">{progress.tapped.map((id) => getWord(id).en).join(', ')}</span>
            </li>
          )}
          <li>
            Seri: <strong>{newStreak} gün</strong>
          </li>
        </ul>
      </div>
      {plan.newWordIds.length > 0 && (
        <div className="mini-grid">
          {plan.newWordIds.map((id) => (
            <Picture key={id} wordId={id} size="sm" label />
          ))}
        </div>
      )}
      <button className="btn btn-primary wide big" onClick={finish} disabled={saving}>
        Bitir
      </button>
    </div>
  );
}
