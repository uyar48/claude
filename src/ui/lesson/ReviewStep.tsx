import { useEffect, useMemo, useRef, useState } from 'react';
import { getWord } from '../../content';
import { speaker } from '../../audio/speaker';
import { Choice } from '../components/Choice';
import { IconSpeaker } from '../components/Icons';
import { Picture } from '../components/Picture';
import { useRuntime } from '../hooks';
import { distractors, withAnswer } from './start';

export interface StepStats {
  reviewed: number;
  correct: number;
}

type Kind = 'listen' | 'picture' | 'recall';
const KINDS: Kind[] = ['listen', 'picture', 'recall'];

interface Item {
  wordId: string;
  kind: Kind;
  /** First attempt is graded; repeats after a miss are practice only. */
  graded: boolean;
  seed: number;
}

/** Spaced-repetition review of today's due words with three exercise types. */
export function ReviewStep({ wordIds, onDone }: { wordIds: string[]; onDone: (s: StepStats) => void }) {
  const rt = useRuntime();
  const initial = useMemo<Item[]>(
    () => wordIds.map((wordId, i) => ({ wordId, kind: KINDS[i % KINDS.length], graded: true, seed: i + 1 })),
    [wordIds],
  );
  const [queue, setQueue] = useState(initial);
  const [pos, setPos] = useState(0);
  const [stats, setStats] = useState<StepStats>({ reviewed: 0, correct: 0 });
  const item = queue[pos];
  const answered = useRef(-1);

  function answer(correct: boolean) {
    if (!item || answered.current === pos) return; // ignore double taps
    answered.current = pos;
    let s = stats;
    if (item.graded) {
      void rt.store.grade(item.wordId, correct ? 'good' : 'again', 'review');
      s = { reviewed: stats.reviewed + 1, correct: stats.correct + (correct ? 1 : 0) };
      setStats(s);
    }
    const next = !correct && item.graded
      ? [...queue, { ...item, graded: false, kind: 'recall' as Kind, seed: item.seed + 50 }]
      : queue;
    setQueue(next);
    if (pos + 1 >= next.length) onDone(s);
    else setPos(pos + 1);
  }

  if (!item) return null;
  const total = initial.length;
  const doneGraded = stats.reviewed;
  return (
    <div className="step">
      <p className="step-count">
        {Math.min(doneGraded + (item.graded ? 1 : 0), total)} / {total}
        {!item.graded && <span className="muted"> · bir kez daha</span>}
      </p>
      <Exercise key={`${pos}-${item.wordId}`} item={item} rt={rt} onAnswer={answer} />
    </div>
  );
}

function Exercise({ item, rt, onAnswer }: { item: Item; rt: ReturnType<typeof useRuntime>; onAnswer: (c: boolean) => void }) {
  const word = getWord(item.wordId);
  const { ids, index } = useMemo(
    () => withAnswer(item.wordId, distractors(rt, item.wordId, 3, item.seed), item.seed),
    [item, rt],
  );
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (item.kind === 'listen' || item.kind === 'recall') void speaker.word(item.wordId);
  }, [item]);

  if (item.kind === 'listen') {
    return (
      <div className="exercise">
        <h3 className="q">Duyduğun kelimenin resmini seç.</h3>
        <button className="btn btn-secondary big-listen" onClick={() => speaker.word(item.wordId)}>
          <IconSpeaker /> Tekrar dinle
        </button>
        <Choice options={ids.map((id) => ({ image: id }))} answer={index} onNext={onAnswer} />
      </div>
    );
  }
  if (item.kind === 'picture') {
    return (
      <div className="exercise">
        <h3 className="q">Bu resim hangi kelime?</h3>
        <Picture wordId={item.wordId} size="md" />
        <Choice
          options={ids.map((id) => ({ en: getWord(id).en }))}
          answer={index}
          layout="grid"
          onAnswer={() => void speaker.word(item.wordId)}
          onNext={onAnswer}
        />
      </div>
    );
  }
  return (
    <div className="exercise">
      <h3 className="q">Bu kelimenin anlamını hatırla.</h3>
      <div className="recall-word" lang="en">
        {word.en}
        <button className="icon-btn" aria-label="Dinle" onClick={() => speaker.word(item.wordId)}>
          <IconSpeaker />
        </button>
      </div>
      {!revealed ? (
        <button className="btn btn-primary wide" onClick={() => setRevealed(true)}>
          Anlamını göster
        </button>
      ) : (
        <>
          <Picture wordId={item.wordId} size="md" />
          <p className="meaning">{word.tr}</p>
          <div className="row gap">
            <button className="btn btn-secondary grow" onClick={() => onAnswer(false)}>
              Bilemedim
            </button>
            <button className="btn btn-primary grow" onClick={() => onAnswer(true)}>
              Bildim
            </button>
          </div>
        </>
      )}
    </div>
  );
}
