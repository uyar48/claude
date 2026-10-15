import { useEffect, useMemo, useState } from 'react';
import { course, getSentence, getWord } from '../../content';
import { knownLemmas, sentenceTokens } from '../../core/course';
import { hashString } from '../../core/session';
import { speaker } from '../../audio/speaker';
import { IconPlay } from '../components/Icons';
import { shuffle } from '../components/MatchGame';
import { useAppState } from '../hooks';
import { Feedback } from './Feedback';
import type { ExerciseProps } from './types';

/** Fill the gap in a real sentence; the Turkish meaning is shown. Retry until right. */
export function FillBlankExercise({ ex, onDone }: ExerciseProps) {
  const { cards } = useAppState();
  const sent = getSentence(ex.sentenceId!);
  const tokens = useMemo(() => sentenceTokens(course, sent.en), [sent.en]);
  const gap = tokens[ex.gapIndex!];
  const options = useMemo(() => {
    const target = getWord(ex.wordId!);
    const known = [...knownLemmas(course, cards)].filter((id) => id !== target.id && course.words[id]);
    const seed = hashString(ex.key);
    const samePos = shuffle(
      known.filter((id) => course.words[id].pos === target.pos),
      seed,
    );
    const other = shuffle(
      known.filter((id) => course.words[id].pos !== target.pos),
      seed + 1,
    );
    const capital = /^[A-Z]/.test(gap.text);
    const fmt = (s: string) => (capital ? s[0].toUpperCase() + s.slice(1) : s);
    const wrong = [...samePos, ...other]
      .map((id) => fmt(course.words[id].en))
      .filter((w, i, a) => w.toLowerCase() !== gap.text.toLowerCase() && a.indexOf(w) === i)
      .slice(0, 3);
    return shuffle([gap.text, ...wrong], seed + 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ex.key]);
  const [tries, setTries] = useState<string[]>([]);
  const solved = tries.includes(gap.text);

  function pick(o: string) {
    if (solved || tries.includes(o)) return;
    setTries((t) => [...t, o]);
    if (o === gap.text) void speaker.courseSentence(sent.id);
  }

  return (
    <div className="ex blank">
      <p className="hint">Boşluğa hangi kelime gelir?</p>
      <p className="blank-sentence" lang="en">
        {tokens.map((t, i) =>
          i === ex.gapIndex ? (
            <span key={i} className={`gap ${solved ? 'filled' : ''}`}>
              {solved ? t.text : ' '}
            </span>
          ) : (
            <span key={i}>{t.text}</span>
          ),
        )}
      </p>
      <p className="muted center">{sent.tr}</p>
      <div className="options options-list">
        {options.map((o) => (
          <button
            key={o}
            lang="en"
            className={`option ${tries.includes(o) ? (o === gap.text ? 'right' : 'wrong') : solved ? 'dim' : ''}`}
            onClick={() => pick(o)}
            disabled={solved || tries.includes(o)}
          >
            {o}
          </button>
        ))}
      </div>
      {solved && (
        <Feedback
          ok
          auto={tries.length === 1}
          text={tries.length === 1 ? 'Doğru.' : 'Tamam, doğrusu bu.'}
          onNext={() => onDone({ correct: tries.length === 1 })}
        />
      )}
    </div>
  );
}

const clean = (s: string) => s.toLowerCase().replace(/’/g, "'");

/** Put the English words in order; the Turkish sentence is the guide. */
export function BuildSentence({ ex, onDone }: ExerciseProps) {
  const sent = getSentence(ex.sentenceId!);
  const words = useMemo(
    () => sentenceTokens(course, sent.en).filter((t) => t.lemma !== undefined).map((t) => t.text),
    [sent.en],
  );
  const tiles = useMemo(() => {
    const idx = words.map((_, i) => i);
    return shuffle(idx, hashString(ex.key));
  }, [words, ex.key]);
  const [placed, setPlaced] = useState<number[]>([]);
  const [checked, setChecked] = useState<boolean | null>(null);
  const end = sent.en.trim().match(/[.?!]$/)?.[0] ?? '.';

  useEffect(() => () => speaker.stop(), []);

  function check() {
    const ok = placed.map((i) => clean(words[i])).join(' ') === words.map(clean).join(' ');
    setChecked(ok);
    void speaker.courseSentence(sent.id);
  }

  return (
    <div className="ex build">
      <p className="hint">Kelimeleri sırayla dokunarak cümleyi kur.</p>
      <p className="prompt-tr">{sent.tr}</p>
      <div className={`build-line ${checked === null ? '' : checked ? 'ok' : 'no'}`} lang="en" aria-label="Kurduğun cümle">
        {placed.length === 0 && <span className="muted small">…</span>}
        {placed.map((i, k) => (
          <button
            key={`${i}-${k}`}
            className="tile placed"
            disabled={checked !== null}
            onClick={() => setPlaced((p) => p.filter((x) => x !== i))}
          >
            {words[i]}
          </button>
        ))}
        {placed.length === words.length && <span className="end">{end}</span>}
      </div>
      <div className="tiles" lang="en">
        {tiles.map((i) => (
          <button
            key={i}
            className={`tile ${placed.includes(i) ? 'used' : ''}`}
            disabled={placed.includes(i) || checked !== null}
            onClick={() => setPlaced((p) => [...p, i])}
          >
            {words[i]}
          </button>
        ))}
      </div>
      {checked === null ? (
        <button className="btn btn-primary wide" disabled={placed.length !== words.length} onClick={check}>
          Kontrol et
        </button>
      ) : (
        <>
          {!checked && (
            <p className="correct-line" lang="en">
              <button className="sent-play" aria-label="Doğru cümleyi dinle" onClick={() => speaker.courseSentence(sent.id)}>
                <IconPlay />
              </button>
              {sent.en}
            </p>
          )}
          <Feedback ok={checked} auto={false} text={checked ? 'Doğru.' : 'Doğrusu yukarıda.'} onNext={() => onDone({ correct: checked })} />
        </>
      )}
    </div>
  );
}
