import { useEffect, useState } from 'react';
import { getWord } from '../../content';
import { speaker } from '../../audio/speaker';
import { IconSpeaker } from '../components/Icons';
import { MatchGame } from '../components/MatchGame';
import { Picture } from '../components/Picture';
import { useRuntime } from '../hooks';

/** Picture cards for today's new words (picture → sound → Turkish), then a drag-and-drop match. */
export function NewWordsStep({ wordIds, onDone }: { wordIds: string[]; onDone: () => void }) {
  const { store } = useRuntime();
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<'cards' | 'match'>('cards');

  function next() {
    // Advance the UI first; the card is saved in the background.
    void store.introduceWords([wordIds[i]]);
    if (i + 1 < wordIds.length) setI(i + 1);
    else setPhase('match');
  }

  if (phase === 'match') {
    return (
      <div className="step">
        <h3 className="q">Eşleştir</h3>
        <MatchGame wordIds={wordIds} onDone={() => onDone()} />
      </div>
    );
  }
  return (
    <div className="step">
      <p className="step-count">
        Yeni kelime {i + 1} / {wordIds.length}
      </p>
      <PictureCard key={wordIds[i]} wordId={wordIds[i]} onNext={next} />
    </div>
  );
}

function PictureCard({ wordId, onNext }: { wordId: string; onNext: () => void }) {
  const word = getWord(wordId);
  const [stage, setStage] = useState<'picture' | 'meaning'>('picture');

  useEffect(() => {
    const t = setTimeout(() => void speaker.word(wordId, 'female'), 400);
    return () => clearTimeout(t);
  }, [wordId]);

  return (
    <div className="picture-card">
      <Picture wordId={wordId} size="lg" />
      <div className="card-word" lang="en">
        <span>{word.en}</span>
        <button className="icon-btn" aria-label="Kadın sesiyle dinle" onClick={() => speaker.word(wordId, 'female')}>
          <IconSpeaker />
        </button>
        <button className="icon-btn alt" aria-label="Erkek sesiyle dinle" onClick={() => speaker.word(wordId, 'male')}>
          <IconSpeaker />
        </button>
      </div>
      {stage === 'picture' ? (
        <button className="btn btn-primary wide" onClick={() => setStage('meaning')}>
          Türkçesini göster
        </button>
      ) : (
        <>
          <p className="meaning">{word.tr}</p>
          <p className="example">
            <button className="link" lang="en" onClick={() => speaker.example(wordId)}>
              {word.example}
            </button>
            <span className="tr">{word.exampleTr}</span>
          </p>
          <button className="btn btn-primary wide" onClick={onNext}>
            Devam
          </button>
        </>
      )}
    </div>
  );
}
