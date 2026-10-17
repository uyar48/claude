import { useEffect, useRef, useState } from 'react';
import { getWord } from '../../content';
import { dictationVerdict } from '../../core/answer';
import { speaker } from '../../audio/speaker';
import { IconSpeaker } from '../components/Icons';
import { Feedback } from './Feedback';
import type { ExerciseProps } from './types';

/** Listen and type the word. Two tries; the second one gets the first letter as a hint. */
export function Dictation({ ex, onDone }: ExerciseProps) {
  const word = getWord(ex.wordId!);
  const [value, setValue] = useState('');
  const [tries, setTries] = useState(0);
  const [verdict, setVerdict] = useState<'right' | 'close' | 'wrong' | null>(null);
  const [finished, setFinished] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void speaker.word(word.id);
  }, [word.id]);

  function check(e?: React.FormEvent) {
    e?.preventDefault();
    if (finished || !value.trim()) return;
    const v = dictationVerdict(value, word.en);
    const n = tries + 1;
    setTries(n);
    setVerdict(v);
    if (v !== 'wrong' || n >= 2) {
      setFinished(true);
      void speaker.word(word.id);
    } else {
      setValue('');
      input.current?.focus();
    }
  }

  const firstTry = finished && verdict !== 'wrong' && tries === 1;

  return (
    <div className="ex dictation">
      <p className="hint">Dinle ve kelimeyi yaz.</p>
      <div className="row center gap">
        <button className="big-listen" aria-label="Yeniden dinle" onClick={() => speaker.word(word.id)}>
          <IconSpeaker />
        </button>
      </div>
      <p className="muted small center">
        {word.en.length} harf{tries >= 1 && !finished ? ` · "${word.en[0]}" ile başlıyor` : ''}
      </p>
      <form onSubmit={check} className="dictation-form">
        <input
          ref={input}
          className="dictation-input"
          lang="en"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
          aria-label="Duyduğun kelime"
          disabled={finished}
          autoFocus
        />
        {!finished && (
          <button className="btn btn-primary" type="submit" disabled={!value.trim()}>
            Kontrol et
          </button>
        )}
      </form>
      {!finished && tries === 1 && <p className="note">Bir daha dene.</p>}
      {!finished && (
        <button className="link small" onClick={() => (setFinished(true), setVerdict('wrong'), setTries(2))}>
          Bilmiyorum, göster
        </button>
      )}
      {finished && (
        <Feedback
          ok={verdict !== 'wrong'}
          auto={verdict === 'right'}
          text={
            verdict === 'right'
              ? tries === 1
                ? 'Doğru.'
                : 'Tamam, doğru.'
              : verdict === 'close'
                ? `Neredeyse — doğrusu: ${word.en}`
                : `Doğrusu: ${word.en} (${word.tr})`
          }
          onNext={() => onDone({ correct: firstTry })}
        />
      )}
    </div>
  );
}
