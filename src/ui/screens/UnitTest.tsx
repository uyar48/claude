import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { course, getWord } from '../../content';
import { learnerUnit, unitTestOpen } from '../../core/course';
import { unitTestExercises } from '../../core/session';
import type { UnitTestResult } from '../../core/settings';
import { speaker } from '../../audio/speaker';
import { IconBack, IconClose } from '../components/Icons';
import { Picture, useHasPhoto } from '../components/Picture';
import { EXERCISE_LABEL, ExerciseView } from '../exercises/ExerciseView';
import type { ExerciseOutcome } from '../exercises/types';
import { useAppState, useRuntime } from '../hooks';

const pct = (score: number, total: number) => Math.round((score / Math.max(1, total)) * 100);

/**
 * "Ünite N testi": one question per word of the unit, no time limit. The
 * result is kept (synced); missed words come back in the next reviews.
 */
export function UnitTestScreen() {
  const params = useParams();
  const unit = Number(params.unit);
  const rt = useRuntime();
  const state = useAppState();
  const navigate = useNavigate();
  const hasPhoto = useHasPhoto();
  const meta = course.units.find((u) => u.n === unit);
  const open = meta !== undefined && unitTestOpen(course, state.cards, unit);

  // Built once when the test starts (later card changes do not reshuffle it).
  const [seed] = useState(() => Math.floor(Math.random() * 1e9));
  const exercises = useMemo(() => {
    if (!open) return [];
    const cards = rt.store.getState().cards;
    return unitTestExercises({ course, cards, hasVisual: hasPhoto, unit: learnerUnit(course, cards) }, unit, seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, unit, seed]);

  const [index, setIndex] = useState(0);
  const answers = useRef<Array<{ wordId: string; correct: boolean }>>([]);
  const [result, setResult] = useState<{ saved: UnitTestResult; missed: string[] } | null>(null);
  const busy = useRef(false);

  if (!meta) return <NotOpen text="Böyle bir ünite yok." />;
  if (!open && !result) return <NotOpen text={`${meta.titleTr} testi, ünitenin bütün kelimelerini öğrenince açılır.`} />;

  async function onDone(out: ExerciseOutcome) {
    if (busy.current) return;
    busy.current = true;
    try {
      const ex = exercises[index];
      answers.current = [...answers.current, { wordId: ex.wordId!, correct: out.correct === true }];
      if (index + 1 < exercises.length) {
        setIndex(index + 1);
        window.scrollTo(0, 0);
        return;
      }
      const score = answers.current.filter((a) => a.correct).length;
      const total = answers.current.length;
      const missed = answers.current.filter((a) => !a.correct).map((a) => a.wordId);
      const prev = rt.store.getState().settings.unitTests[String(unit)];
      const saved: UnitTestResult = {
        score,
        total,
        best: Math.max(score, prev ? Math.round((prev.best / prev.total) * total) : 0),
        tries: (prev?.tries ?? 0) + 1,
        at: Date.now(),
      };
      await rt.store.updateSettings((s) => ({ ...s, unitTests: { ...s.unitTests, [String(unit)]: saved } }));
      await rt.store.reviewSoon(missed);
      speaker.stop();
      setResult({ saved, missed });
      void rt.sync?.sync();
    } finally {
      busy.current = false;
    }
  }

  if (result) {
    const { saved, missed } = result;
    const score = pct(saved.score, saved.total);
    return (
      <div className="screen finish unit-test-done">
        <div className="panel">
          <p className="eyebrow">{meta.titleTr} testi</p>
          <h1>%{score}</h1>
          <ul className="stats">
            <li>
              <strong>
                {saved.score} / {saved.total}
              </strong>{' '}
              doğru
            </li>
            {saved.tries > 1 && pct(saved.best, saved.total) > score && <li>En iyi sonucun: %{pct(saved.best, saved.total)}</li>}
            <li>
              {score >= 85
                ? 'Bu ünite iyi oturmuş.'
                : score >= 60
                  ? 'Fena değil; eksik kalan kelimeler tekrarlarda gelecek.'
                  : 'Bu ünite biraz daha tekrar istiyor; eksik kelimeler sıradaki derslerde gelecek.'}
            </li>
          </ul>
        </div>
        {missed.length > 0 && (
          <>
            <p className="muted small">Yanlış ya da boş kalan kelimeler sıradaki dersin tekrarlarına eklendi:</p>
            <div className="mini-grid">
              {missed.map((id) => (
                <div key={id} className="mini-word">
                  <Picture wordId={id} size="sm" />
                  <span lang="en">{getWord(id).en}</span>
                  <span className="muted tiny">{getWord(id).tr}</span>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="stack">
          <button className="btn btn-primary wide big" onClick={() => navigate('/ilerleme', { replace: true })}>
            İlerlemeye dön
          </button>
          <button className="btn btn-secondary wide big" onClick={() => navigate('/', { replace: true })}>
            Ana sayfa
          </button>
        </div>
      </div>
    );
  }

  const ex = exercises[index];
  if (!ex) return <NotOpen text="Bu ünite için soru hazırlanamadı." />;
  return (
    <div className="screen lesson unit-test">
      <header className="lesson-head">
        <button className="icon-btn" aria-label="Testi bırak" onClick={() => (speaker.stop(), navigate('/ilerleme'))}>
          <IconClose />
        </button>
        <div className="time-bar" aria-label="Test ilerlemesi">
          <span style={{ width: `${(index / exercises.length) * 100}%` }} />
        </div>
        <span className="muted small time-left">
          {index + 1} / {exercises.length}
        </span>
      </header>
      <p className="ex-label muted small">
        {meta.titleTr.split(':')[0]} testi · {EXERCISE_LABEL[ex.type]}
      </p>
      <ExerciseView key={ex.key} ex={ex} onDone={(o) => void onDone(o)} />
    </div>
  );
}

function NotOpen({ text }: { text: string }) {
  return (
    <div className="screen settings">
      <header className="top">
        <Link to="/ilerleme" className="icon-btn" aria-label="Geri">
          <IconBack />
        </Link>
        <h1>Ünite testi</h1>
        <span />
      </header>
      <p className="muted">{text}</p>
    </div>
  );
}
