import { useEffect, useState } from 'react';
import { getWord } from '../../content';
import { speaker } from '../../audio/speaker';
import { IconCheck, IconSpeaker } from '../components/Icons';
import { Picture, useHasPhoto } from '../components/Picture';
import { Feedback } from './Feedback';
import type { ExerciseProps } from './types';

const PROMPT: Record<string, string> = {
  'word-to-picture': 'Bu kelimenin resmi hangisi?',
  'picture-to-word': 'Resimdeki ne?',
  'listen-picture': 'Dinle ve doğru olanı seç.',
  'en-tr': 'Türkçesi hangisi?',
  'tr-en': 'İngilizcesi hangisi?',
};

/** One-attempt multiple choice over the exercise's option words. */
export function ChoiceExercise({ ex, onDone }: ExerciseProps) {
  const hasPhoto = useHasPhoto();
  const target = getWord(ex.wordId!);
  const options = ex.words!;
  const [picked, setPicked] = useState<number | null>(null);
  const correct = picked === ex.answer;

  const pictureOptions =
    ex.type === 'word-to-picture' || (ex.type === 'listen-picture' && options.every((w) => hasPhoto(w)));
  const optionText = (w: string) => (ex.type === 'en-tr' ? getWord(w).tr : getWord(w).en);

  useEffect(() => {
    if (ex.type === 'word-to-picture' || ex.type === 'listen-picture' || ex.type === 'en-tr') void speaker.word(target.id);
  }, [ex.key, ex.type, target.id]);

  function pick(i: number) {
    if (picked !== null) return;
    setPicked(i);
    if (ex.type === 'tr-en' || ex.type === 'picture-to-word') void speaker.word(target.id);
  }

  return (
    <div className="ex choice-ex">
      <p className="hint">{PROMPT[ex.type]}</p>
      <div className="prompt">
        {ex.type === 'picture-to-word' && <Picture wordId={target.id} size="lg" />}
        {(ex.type === 'word-to-picture' || ex.type === 'en-tr') && (
          <div className="card-word">
            <span className="en" lang="en">
              {target.en}
            </span>
            <button className="icon-btn" aria-label="Kelimeyi dinle" onClick={() => speaker.word(target.id)}>
              <IconSpeaker />
            </button>
          </div>
        )}
        {ex.type === 'listen-picture' && (
          <button className="big-listen" aria-label="Yeniden dinle" onClick={() => speaker.word(target.id)}>
            <IconSpeaker />
          </button>
        )}
        {ex.type === 'tr-en' && <p className="prompt-tr">{target.tr}</p>}
      </div>

      <div className={`options ${pictureOptions ? 'options-grid' : 'options-list'}`}>
        {options.map((w, i) => {
          const state = picked === null ? '' : i === ex.answer ? 'right' : i === picked ? 'wrong' : 'dim';
          return (
            <button
              key={w}
              className={`option ${state}`}
              onClick={() => pick(i)}
              disabled={picked !== null}
              lang={ex.type === 'en-tr' ? 'tr' : 'en'}
              aria-label={pictureOptions ? `Seçenek ${i + 1}` : undefined}
            >
              {pictureOptions ? <Picture wordId={w} size="sm" /> : <span>{optionText(w)}</span>}
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
        <Feedback
          ok={correct}
          text={correct ? 'Doğru.' : `Doğrusu: ${target.en} = ${target.tr}`}
          onNext={() => onDone({ correct })}
        />
      )}
    </div>
  );
}
