import { useEffect, useMemo } from 'react';
import { course, exampleFor, getWord } from '../../content';
import { knownLemmas } from '../../core/course';
import { speaker } from '../../audio/speaker';
import { IconSpeaker } from '../components/Icons';
import { Picture } from '../components/Picture';
import { useAppState } from '../hooks';
import type { ExerciseProps } from './types';

/** New word: picture (or emoji), the word with audio, meaning and an example. */
export function IntroCard({ ex, onDone }: ExerciseProps) {
  const word = getWord(ex.wordId!);
  const { cards } = useAppState();
  const example = useMemo(() => exampleFor(word.id, knownLemmas(course, cards, [word.id])), [word.id, cards]);

  useEffect(() => {
    void speaker.word(word.id);
  }, [word.id]);

  return (
    <div className="ex intro">
      <p className="eyebrow">Yeni kelime</p>
      <Picture wordId={word.id} size="lg" credit />
      <div className="card-word">
        <span className="en" lang="en">
          {word.en}
        </span>
        <button className="icon-btn" aria-label="Kelimeyi dinle" onClick={() => speaker.word(word.id)}>
          <IconSpeaker />
        </button>
      </div>
      <p className="meaning">
        {word.tr}
        {word.pos && <span className="muted small"> · {word.pos}</span>}
      </p>
      {example && (
        <p className="example">
          <button className="link en" lang="en" onClick={() => speaker.courseSentence(example.id)}>
            {example.en}
          </button>
          <span className="tr">{example.tr}</span>
        </p>
      )}
      <button className="btn btn-primary wide big" onClick={() => onDone({ correct: null })} autoFocus>
        Devam
      </button>
    </div>
  );
}
