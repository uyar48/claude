import { useEffect, useMemo, useRef, useState } from 'react';
import { getText } from '../../content';
import type { QuestionOption } from '../../content/types';
import { speaker } from '../../audio/speaker';
import { Choice } from '../components/Choice';
import { IconSpeaker } from '../components/Icons';
import { useRuntime } from '../hooks';
import { distractors, withAnswer } from './start';

interface QuizItem {
  key: string;
  prompt: string;
  options: QuestionOption[];
  answer: number;
  /** Vocabulary item: graded in the spaced-repetition engine. */
  wordId?: string;
}

export interface QuizResult {
  correct: number;
  total: number;
}

/** Closed-book quiz: the text is hidden. Comprehension questions + today's new words by ear. */
export function QuizStep({ textId, newWordIds, onDone }: { textId: string; newWordIds: string[]; onDone: (r: QuizResult) => void }) {
  const rt = useRuntime();
  const items = useMemo<QuizItem[]>(() => {
    const t = getText(textId);
    const qs: QuizItem[] = t.questions.map((q) => ({ key: q.id, prompt: q.prompt, options: q.options, answer: q.answer }));
    const vocab = newWordIds.slice(0, 2).map((id, i): QuizItem => {
      const { ids, index } = withAnswer(id, distractors(rt, id, 2, 31 + i), 5 + i);
      return { key: `v-${id}`, prompt: 'Duyduğun kelimenin resmini seç.', options: ids.map((x) => ({ image: x })), answer: index, wordId: id };
    });
    return [...qs, ...vocab];
  }, [textId, newWordIds, rt]);

  const [i, setI] = useState(0);
  const [correct, setCorrect] = useState(0);
  const item = items[i];
  const answered = useRef(-1);

  useEffect(() => {
    if (item?.wordId) void speaker.word(item.wordId);
  }, [item]);

  function next(ok: boolean) {
    if (answered.current === i) return; // ignore double taps
    answered.current = i;
    if (item.wordId) void rt.store.grade(item.wordId, ok ? 'good' : 'again', 'quiz');
    const c = correct + (ok ? 1 : 0);
    setCorrect(c);
    if (i + 1 < items.length) setI(i + 1);
    else onDone({ correct: c, total: items.length });
  }

  return (
    <div className="step">
      <p className="step-count">
        Soru {i + 1} / {items.length} <span className="muted">· metin kapalı</span>
      </p>
      <h3 className="q">{item.prompt}</h3>
      {item.wordId && (
        <button className="btn btn-secondary big-listen" onClick={() => speaker.word(item.wordId!)}>
          <IconSpeaker /> Dinle
        </button>
      )}
      <Choice key={item.key} options={item.options} answer={item.answer} onNext={next} />
    </div>
  );
}
