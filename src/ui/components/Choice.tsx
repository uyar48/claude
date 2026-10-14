import { useState } from 'react';
import type { QuestionOption } from '../../content/types';
import { IconCheck } from './Icons';
import { Picture } from './Picture';

/**
 * One-attempt multiple choice. Shows right/wrong, then a "Devam" button.
 * Options are English text or pictures.
 */
export function Choice({
  options,
  answer,
  onAnswer,
  onNext,
  layout,
}: {
  options: QuestionOption[];
  answer: number;
  onAnswer?: (correct: boolean) => void;
  onNext: (correct: boolean) => void;
  layout?: 'grid' | 'list';
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const pictures = options.some((o) => o.image);
  const correct = picked === answer;

  function pick(i: number) {
    if (picked !== null) return;
    setPicked(i);
    onAnswer?.(i === answer);
  }

  return (
    <div className="choice">
      <div className={`options ${pictures || layout === 'grid' ? 'options-grid' : 'options-list'}`}>
        {options.map((o, i) => {
          const state = picked === null ? '' : i === answer ? 'right' : i === picked ? 'wrong' : 'dim';
          return (
            <button key={i} className={`option ${state}`} onClick={() => pick(i)} disabled={picked !== null} lang="en">
              {o.image ? <Picture wordId={o.image} size="sm" /> : <span>{o.en}</span>}
              {state === 'right' && (
                <span className="badge-ok">
                  <IconCheck />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <div className={`feedback ${correct ? 'ok' : 'no'}`}>
          <span>{correct ? 'Doğru.' : 'Doğrusu işaretli.'}</span>
          <button className="btn btn-primary" onClick={() => onNext(correct)} autoFocus>
            Devam
          </button>
        </div>
      )}
    </div>
  );
}
