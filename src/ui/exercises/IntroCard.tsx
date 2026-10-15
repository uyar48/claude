import { useEffect, useMemo } from 'react';
import { course, examplesFor, getWord } from '../../content';
import { emojiFor, imageFor } from '../../content/media';
import { knownLemmas } from '../../core/course';
import { speaker } from '../../audio/speaker';
import { IconSpeaker } from '../components/Icons';
import { Picture } from '../components/Picture';
import { useAppState } from '../hooks';
import type { ExerciseProps } from './types';

/**
 * New word: picture (or emoji), the word with audio, meaning and an example.
 * Words without a picture or emoji are taught with two sentences instead.
 */
export function IntroCard({ ex, onDone }: ExerciseProps) {
  const word = getWord(ex.wordId!);
  const { cards, mediaChoices } = useAppState();
  const visual = Boolean(imageFor(word.id, mediaChoices) || emojiFor(word.id));
  const examples = useMemo(
    () => examplesFor(word.id, knownLemmas(course, cards, [word.id]), visual ? 1 : 2),
    [word.id, cards, visual],
  );

  // Say the word; a word without a picture is followed by its first sentence.
  const first = examples[0]?.id;
  useEffect(() => {
    let cancelled = false;
    void speaker.word(word.id).then(() => {
      if (!cancelled && !visual && first) void speaker.courseSentence(first);
    });
    return () => {
      cancelled = true;
    };
  }, [word.id, visual, first]);

  return (
    <div className="ex intro">
      <p className="eyebrow">Yeni kelime</p>
      {visual && <Picture wordId={word.id} size="lg" credit />}
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
      {examples.map((example) => (
        <p key={example.id} className="example">
          <button className="link en" lang="en" onClick={() => speaker.courseSentence(example.id)}>
            {example.en}
          </button>
          <span className="tr">{example.tr}</span>
        </p>
      ))}
      <button className="btn btn-primary wide big" onClick={() => onDone({ correct: null })} autoFocus>
        Devam
      </button>
    </div>
  );
}
