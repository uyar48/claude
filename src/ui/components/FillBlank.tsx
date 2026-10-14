import { useState } from 'react';
import type { Blank } from '../../content/types';
import { speaker } from '../../audio/speaker';
import { getText } from '../../content';

/** Fill-in-the-blank: tap the word that completes the sentence. Retry until right. */
export function FillBlank({ blank, textId, onDone }: { blank: Blank; textId: string; onDone: (firstTry: boolean) => void }) {
  const [tries, setTries] = useState<number[]>([]);
  const solved = tries.includes(blank.answer);
  const [before, after] = blank.sentence.split('___');

  function pick(i: number) {
    if (solved || tries.includes(i)) return;
    setTries((t) => [...t, i]);
    if (i !== blank.answer) return;
    const filled = blank.sentence.replace('___', blank.options[i]);
    const idx = getText(textId).sentences.findIndex((x) => x.en === filled);
    void (idx >= 0 ? speaker.sentence(textId, idx, () => {}) : speaker.text(filled));
  }

  return (
    <div className="blank">
      <p className="blank-sentence" lang="en">
        {before}
        <span className={`gap ${solved ? 'filled' : ''}`}>{solved ? blank.options[blank.answer] : ' '}</span>
        {after}
      </p>
      <div className="options options-list">
        {blank.options.map((o, i) => (
          <button
            key={i}
            lang="en"
            className={`option ${tries.includes(i) ? (i === blank.answer ? 'right' : 'wrong') : solved ? 'dim' : ''}`}
            onClick={() => pick(i)}
            disabled={solved || tries.includes(i)}
          >
            {o}
          </button>
        ))}
      </div>
      {solved && (
        <div className="feedback ok">
          <span>{tries.length === 1 ? 'Doğru.' : 'Tamam, doğrusu bu.'}</span>
          <button className="btn btn-primary" onClick={() => onDone(tries.length === 1)} autoFocus>
            Devam
          </button>
        </div>
      )}
    </div>
  );
}
